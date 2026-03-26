-- Emergency redesign: separate raw history from request-time reads.
--
-- Problem: odds_snapshots is too large for any query (even SELECT oldest row
-- times out). HSA and purge both fail.
--
-- Solution: latest_odds table holds ONE row per book+market+game.
-- HSA reads from latest_odds (fast, small table).
-- odds_snapshots is append-only history (never queried in request path).

-- ── latest_odds: current state table ─────────────────────────────────────────
-- One row per (game + sportsbook + market_type). Updated on each cron run.
-- This is the PRIMARY read source for HSA, dashboard, and all request-time queries.

CREATE TABLE IF NOT EXISTS latest_odds (
  id BIGSERIAL PRIMARY KEY,
  league TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_time TIMESTAMPTZ NOT NULL,
  sportsbook TEXT NOT NULL,
  book_type TEXT DEFAULT 'square',

  -- Spread / Run line
  spread NUMERIC,
  spread_home_price NUMERIC,

  -- Moneyline
  moneyline_home NUMERIC,
  moneyline_away NUMERIC,

  -- Total
  total NUMERIC,
  total_over_price NUMERIC,
  total_under_price NUMERIC,

  -- Opener (first line we ever saw for this book+game)
  opener_spread NUMERIC,
  opener_moneyline_home NUMERIC,
  opener_moneyline_away NUMERIC,
  opener_total NUMERIC,
  opener_captured_at TIMESTAMPTZ,

  -- Timestamps
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Uniqueness: one row per game + sportsbook
  UNIQUE (league, home_team, away_team, game_time, sportsbook)
);

-- Fast lookups for HSA (game-specific)
CREATE INDEX IF NOT EXISTS idx_latest_odds_game
  ON latest_odds (league, home_team, away_team, game_time);

-- Fast lookups for dashboard (all games in a league)
CREATE INDEX IF NOT EXISTS idx_latest_odds_league_time
  ON latest_odds (league, game_time);

-- ── Purge helper: index on fetched_at for odds_snapshots ─────────────────────
-- If this index can be created (table may be too large), it helps batch deletes.
-- Run manually if the CREATE INDEX times out in migration.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_snapshots_fetched_at
--   ON odds_snapshots (fetched_at);
