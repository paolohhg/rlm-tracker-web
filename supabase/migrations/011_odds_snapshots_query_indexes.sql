-- Fix "canceling statement due to statement timeout" on HSA odds queries.
-- The generate-hsa endpoint queries:
--   WHERE league = X AND home_team = X AND away_team = X
--     AND game_time >= X AND game_time <= X
--   ORDER BY fetched_at DESC LIMIT 1000
--
-- Without a covering index, PostgreSQL does a full table scan on odds_snapshots
-- which times out as the table grows.

-- Primary index for HSA game-specific queries (most critical)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_snapshots_game_lookup
  ON odds_snapshots (league, home_team, away_team, game_time, fetched_at DESC);

-- Index for fetch-odds edge function "already seen" check
-- (SELECT home_team, away_team, league WHERE fetched_at >= X)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_snapshots_recent_games
  ON odds_snapshots (fetched_at, league, home_team, away_team);

-- Index for cache-check query in generate-hsa
-- (SELECT spread, total WHERE league = X AND home_team = X AND away_team = X ORDER BY fetched_at DESC LIMIT 1)
-- Covered by idx_odds_snapshots_game_lookup above.
