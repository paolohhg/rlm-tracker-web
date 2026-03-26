-- Fix "canceling statement due to statement timeout" on HSA odds queries.
--
-- STEP 1: Run the batch delete manually first (see below) to shrink the table.
-- STEP 2: Then these indexes can be created without timing out.
--
-- Manual batch delete (run repeatedly in SQL Editor until DELETE 0):
--   DELETE FROM odds_snapshots
--   WHERE id IN (
--     SELECT id FROM odds_snapshots
--     WHERE fetched_at < NOW() - INTERVAL '7 days'
--     ORDER BY fetched_at ASC LIMIT 50000
--   );

-- Primary index for HSA game-specific queries (most critical)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_snapshots_game_lookup
  ON odds_snapshots (league, home_team, away_team, game_time, fetched_at DESC);

-- Index for fetch-odds edge function "already seen" check
-- (SELECT home_team, away_team, league WHERE fetched_at >= X)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odds_snapshots_recent_games
  ON odds_snapshots (fetched_at, league, home_team, away_team);

-- RPC function for batch purge (called by /api/purge-old-snapshots cron)
CREATE OR REPLACE FUNCTION purge_old_snapshots(retention_days INT DEFAULT 7, batch_size INT DEFAULT 50000)
RETURNS INT AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM odds_snapshots
  WHERE id IN (
    SELECT id FROM odds_snapshots
    WHERE fetched_at < NOW() - (retention_days || ' days')::INTERVAL
    ORDER BY fetched_at ASC
    LIMIT batch_size
  );
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;
