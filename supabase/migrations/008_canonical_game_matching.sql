-- ============================================================================
--  008 — Canonical Game Matching Layer (for hsa-runner)
--
--  Creates:
--    team_aliases          – raw_name → canonical_name lookup
--    normalize_team_name() – SQL equivalent of useGamesFeed.ts normalizeTeamName()
--    build_canonical_game_id() – deterministic game ID from league/teams/time
--    games_master           – registry of canonical games
--    games_master_populate() – on-demand scan of odds_snapshots → upsert games_master
--    find_matching_game()   – fuzzy time-tolerant lookup returning canonical_game_id
--
--  Does NOT modify any existing tables.
-- ============================================================================

-- ── team_aliases ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_aliases (
  raw_name text PRIMARY KEY,
  canonical_name text NOT NULL
);

-- Seed from useGamesFeed.ts normalizeTeamName() alias map.
-- These are post-preprocessing aliases (already lowercased, punctuation stripped).
INSERT INTO team_aliases (raw_name, canonical_name) VALUES
  -- NBA
  ('ny',                          'new york knicks'),
  ('new york',                    'new york knicks'),
  ('lal',                         'los angeles lakers'),
  ('lac',                         'la clippers'),
  ('los angeles clippers',        'la clippers'),
  ('mil',                         'milwaukee bucks'),
  ('orl',                         'orlando magic'),
  ('sa',                          'san antonio spurs'),
  ('hou',                         'houston rockets'),
  ('no',                          'new orleans pelicans'),
  ('wsh',                         'washington wizards'),
  ('sac',                         'sacramento kings'),
  ('chi',                         'chicago bulls'),
  ('phx',                         'phoenix suns'),
  ('cha',                         'charlotte hornets'),
  ('por',                         'portland trail blazers'),
  ('ind',                         'indiana pacers'),
  ('cle',                         'cleveland cavaliers'),
  ('bos',                         'boston celtics'),
  ('mia',                         'miami heat'),
  ('det',                         'detroit pistons'),
  ('tor',                         'toronto raptors'),
  ('dal',                         'dallas mavericks'),
  -- College
  ('md',                          'maryland'),
  ('ill',                         'illinois'),
  ('neb',                         'nebraska'),
  ('msu',                         'michigan state'),
  ('byu',                         'brigham young'),
  ('uconn',                       'connecticut'),
  ('unc',                         'north carolina'),
  ('usc',                         'southern california'),
  ('vcu',                         'virginia commonwealth'),
  ('smu',                         'southern methodist'),
  ('tcu',                         'texas christian'),
  ('lsu',                         'louisiana state'),
  ('ole miss',                    'mississippi'),
  ('st marys',                    'saint marys'),
  ('st marys gaels',              'saint marys'),
  ('saint marys gaels',           'saint marys'),
  ('etsu',                        'east tennessee state'),
  ('furman paladins',             'furman'),
  ('troy trojans',                'troy'),
  ('georgia southern eagles',     'georgia southern'),
  -- Odds API → ESPN divergences
  ('loyola chi ramblers',         'loyola chicago ramblers'),
  ('csu northridge matadors',     'cal state northridge matadors')
ON CONFLICT (raw_name) DO NOTHING;


-- ── normalize_team_name ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_team_name(raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cleaned text;
  alias_result text;
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RETURN '';
  END IF;

  -- Lowercase
  cleaned := lower(raw);

  -- Strip accents (transliterate to ASCII)
  cleaned := unaccent(cleaned);

  -- Remove punctuation: . ' ' ( )
  cleaned := regexp_replace(cleaned, '[.''()']', '', 'g');

  -- Hyphen → space
  cleaned := replace(cleaned, '-', ' ');

  -- & → " and "
  cleaned := regexp_replace(cleaned, '\s*&\s*', ' and ', 'g');

  -- Expand abbreviations
  cleaned := regexp_replace(cleaned, ' st ', ' state ', 'g');
  cleaned := regexp_replace(cleaned, ' st$', ' state');
  cleaned := regexp_replace(cleaned, ' univ ', ' university ', 'g');
  cleaned := regexp_replace(cleaned, ' univ$', ' university');
  cleaned := regexp_replace(cleaned, '^csu ', 'cal state ');

  -- Normalize whitespace
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  cleaned := trim(cleaned);

  -- Check alias table
  SELECT canonical_name INTO alias_result
  FROM team_aliases
  WHERE team_aliases.raw_name = cleaned;

  IF alias_result IS NOT NULL THEN
    RETURN alias_result;
  END IF;

  RETURN cleaned;
END;
$$;


-- ── build_canonical_game_id ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION build_canonical_game_id(
  p_league text,
  p_home text,
  p_away text,
  p_game_time timestamptz
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN lower(p_league)
    || '|' || normalize_team_name(p_home)
    || '|' || normalize_team_name(p_away)
    || '|' || to_char(p_game_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') || 'Z';
END;
$$;


-- ── games_master ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS games_master (
  canonical_game_id       text PRIMARY KEY,
  league                  text NOT NULL,
  home_team               text NOT NULL,
  away_team               text NOT NULL,
  home_normalized         text NOT NULL,
  away_normalized         text NOT NULL,
  commence_time_utc       timestamptz NOT NULL,
  odds_provider_event_id  text,
  action_network_event_id text,
  espn_event_id           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_master_league_time
  ON games_master (league, commence_time_utc);

CREATE INDEX IF NOT EXISTS idx_games_master_normalized
  ON games_master (league, home_normalized, away_normalized);


-- ── games_master_populate ────────────────────────────────────────────────────
-- On-demand function that scans odds_snapshots for distinct games and upserts
-- into games_master. Called from /api/hsa-slate, NOT via trigger.

CREATE OR REPLACE FUNCTION games_master_populate()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  upserted integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (league, home_team, away_team, game_time)
      league, home_team, away_team, game_time
    FROM odds_snapshots
    WHERE game_time IS NOT NULL
    ORDER BY league, home_team, away_team, game_time, fetched_at ASC
  LOOP
    INSERT INTO games_master (
      canonical_game_id,
      league,
      home_team,
      away_team,
      home_normalized,
      away_normalized,
      commence_time_utc
    ) VALUES (
      build_canonical_game_id(rec.league, rec.home_team, rec.away_team, rec.game_time),
      rec.league,
      rec.home_team,
      rec.away_team,
      normalize_team_name(rec.home_team),
      normalize_team_name(rec.away_team),
      rec.game_time
    )
    ON CONFLICT (canonical_game_id) DO UPDATE SET
      updated_at = now(),
      commence_time_utc = EXCLUDED.commence_time_utc;

    upserted := upserted + 1;
  END LOOP;

  RETURN upserted;
END;
$$;


-- ── find_matching_game ───────────────────────────────────────────────────────
-- Fuzzy lookup: normalizes input names, searches games_master with a configurable
-- time tolerance window. Returns the closest canonical_game_id or NULL.

CREATE OR REPLACE FUNCTION find_matching_game(
  p_league text,
  p_raw_home text,
  p_raw_away text,
  p_approx_time timestamptz,
  p_tolerance_minutes integer DEFAULT 60
)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  norm_home text;
  norm_away text;
  result text;
BEGIN
  norm_home := normalize_team_name(p_raw_home);
  norm_away := normalize_team_name(p_raw_away);

  SELECT canonical_game_id INTO result
  FROM games_master
  WHERE lower(league) = lower(p_league)
    AND home_normalized = norm_home
    AND away_normalized = norm_away
    AND commence_time_utc BETWEEN
        (p_approx_time - (p_tolerance_minutes || ' minutes')::interval)
        AND
        (p_approx_time + (p_tolerance_minutes || ' minutes')::interval)
  ORDER BY ABS(EXTRACT(EPOCH FROM (commence_time_utc - p_approx_time)))
  LIMIT 1;

  RETURN result;
END;
$$;
