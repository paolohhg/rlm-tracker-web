-- ============================================================
-- MLB Expansion Schema
-- Migration: 004_mlb_expansion.sql
-- Created: March 15, 2026
-- ============================================================

-- ── 1. Update odds_snapshots — add MLB fields ────────────────
ALTER TABLE odds_snapshots
  ADD COLUMN IF NOT EXISTS moneyline_home       NUMERIC,
  ADD COLUMN IF NOT EXISTS moneyline_away       NUMERIC,
  ADD COLUMN IF NOT EXISTS moneyline_home_open  NUMERIC,
  ADD COLUMN IF NOT EXISTS moneyline_away_open  NUMERIC,
  ADD COLUMN IF NOT EXISTS runline_home         NUMERIC,
  ADD COLUMN IF NOT EXISTS runline_away         NUMERIC,
  ADD COLUMN IF NOT EXISTS runline_home_price   NUMERIC,
  ADD COLUMN IF NOT EXISTS runline_away_price   NUMERIC,
  ADD COLUMN IF NOT EXISTS total_under_price    NUMERIC,
  ADD COLUMN IF NOT EXISTS book_type            TEXT DEFAULT 'square'; -- 'sharp' | 'square'

-- ── 2. Update rlm_alerts — add MLB signal fields ─────────────
ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS moneyline_move        NUMERIC,
  ADD COLUMN IF NOT EXISTS home_ml_open          NUMERIC,
  ADD COLUMN IF NOT EXISTS home_ml_current       NUMERIC,
  ADD COLUMN IF NOT EXISTS sp_alert              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS weather_alert         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS movement_time_bucket  TEXT,   -- 'overnight_sharp' | 'morning_sharp' | 'pregame' | 'late'
  ADD COLUMN IF NOT EXISTS buyback_confirmed     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cross_market_confirmed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS edge_score            NUMERIC,
  ADD COLUMN IF NOT EXISTS edge_grade            TEXT;   -- 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D'

-- ── 3. New table: mlb_game_context ───────────────────────────
CREATE TABLE IF NOT EXISTS mlb_game_context (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   TEXT NOT NULL,
  game_time                 TIMESTAMPTZ,
  league                    TEXT NOT NULL DEFAULT 'MLB',
  home_team                 TEXT NOT NULL,
  away_team                 TEXT NOT NULL,

  -- Pitchers
  home_starter              TEXT,
  away_starter              TEXT,
  starter_confirmed         BOOLEAN DEFAULT false,

  -- Home pitcher stats
  home_sp_era               NUMERIC,
  home_sp_xera              NUMERIC,
  home_sp_fip               NUMERIC,
  home_sp_xfip              NUMERIC,
  home_sp_k_rate            NUMERIC,
  home_sp_bb_rate           NUMERIC,
  home_sp_regression_score  NUMERIC,  -- ERA - xERA

  -- Away pitcher stats
  away_sp_era               NUMERIC,
  away_sp_xera              NUMERIC,
  away_sp_fip               NUMERIC,
  away_sp_xfip              NUMERIC,
  away_sp_k_rate            NUMERIC,
  away_sp_bb_rate           NUMERIC,
  away_sp_regression_score  NUMERIC,

  -- Bullpen
  home_bullpen_pitches_24h  INTEGER,
  away_bullpen_pitches_24h  INTEGER,
  home_bullpen_pitches_48h  INTEGER,
  away_bullpen_pitches_48h  INTEGER,
  home_closer_used          BOOLEAN DEFAULT false,
  away_closer_used          BOOLEAN DEFAULT false,
  home_bullpen_era          NUMERIC,
  away_bullpen_era          NUMERIC,

  -- Lineup
  home_lineup_posted        BOOLEAN DEFAULT false,
  away_lineup_posted        BOOLEAN DEFAULT false,
  missing_regulars_home     TEXT,
  missing_regulars_away     TEXT,
  home_lineup_hand_split    TEXT,   -- 'vs_lhp' | 'vs_rhp' | 'neutral'
  away_lineup_hand_split    TEXT,

  -- Weather
  temperature               NUMERIC,
  wind_speed                NUMERIC,
  wind_direction            TEXT,
  humidity                  NUMERIC,
  precip_probability        NUMERIC,

  -- Ballpark
  ballpark                  TEXT,
  park_factor_runs          NUMERIC,
  park_factor_hr            NUMERIC,
  is_coors                  BOOLEAN DEFAULT false,

  -- Misc
  doubleheader_flag         BOOLEAN DEFAULT false,
  doubleheader_game         INTEGER,  -- 1 or 2

  -- Context signals (array of confirmed signals)
  context_signals           JSONB DEFAULT '[]',

  -- Edge grade
  edge_score                NUMERIC,
  edge_grade                TEXT,

  -- Timestamps
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER mlb_game_context_updated_at
  BEFORE UPDATE ON mlb_game_context
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS mlb_ctx_game_id   ON mlb_game_context (game_id);
CREATE INDEX IF NOT EXISTS mlb_ctx_game_time ON mlb_game_context (game_time);
CREATE INDEX IF NOT EXISTS mlb_ctx_teams     ON mlb_game_context (home_team, away_team);
CREATE INDEX IF NOT EXISTS mlb_ctx_grade     ON mlb_game_context (edge_grade);

-- RLS
ALTER TABLE mlb_game_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated"
  ON mlb_game_context FOR ALL
  USING (true) WITH CHECK (true);

-- ── 4. New table: mlb_pitcher_stats ──────────────────────────
-- Cache for pitcher data (scraped from Baseball Savant)
CREATE TABLE IF NOT EXISTS mlb_pitcher_stats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name     TEXT NOT NULL,
  team            TEXT,
  season          INTEGER DEFAULT 2026,
  era             NUMERIC,
  xera            NUMERIC,
  fip             NUMERIC,
  xfip            NUMERIC,
  k_rate          NUMERIC,
  bb_rate         NUMERIC,
  whiff_rate      NUMERIC,
  hard_hit_rate   NUMERIC,
  barrel_rate     NUMERIC,
  avg_innings     NUMERIC,  -- avg innings last 5 starts
  velocity_trend  TEXT,     -- 'up' | 'down' | 'stable'
  regression_score NUMERIC, -- ERA - xERA
  last_scraped    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mlb_pitcher_name_season
  ON mlb_pitcher_stats (player_name, season);

ALTER TABLE mlb_pitcher_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated"
  ON mlb_pitcher_stats FOR ALL
  USING (true) WITH CHECK (true);
