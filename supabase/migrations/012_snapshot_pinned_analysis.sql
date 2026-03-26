-- Snapshot-pinned HSA analysis architecture.
-- Each analysis is tied to a specific market snapshot, making it deterministic.
-- The same snapshot always produces the same analysis.

-- Add snapshot metadata columns to claude_analyses
ALTER TABLE claude_analyses
  ADD COLUMN IF NOT EXISTS snapshot_id TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confidence_label TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC,
  ADD COLUMN IF NOT EXISTS status_tag TEXT,
  ADD COLUMN IF NOT EXISTS market_lean TEXT,
  ADD COLUMN IF NOT EXISTS signal_summary JSONB,
  ADD COLUMN IF NOT EXISTS truth_object_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT true;

-- When a new analysis is inserted for a game, mark previous as NOT latest
-- This lets the frontend always query WHERE is_latest = true for the dashboard
-- while preserving all historical versions for audit
CREATE OR REPLACE FUNCTION set_latest_analysis()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE claude_analyses
  SET is_latest = false
  WHERE game_id = NEW.game_id
    AND id != NEW.id
    AND is_latest = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_latest_analysis ON claude_analyses;
CREATE TRIGGER trg_set_latest_analysis
  AFTER INSERT ON claude_analyses
  FOR EACH ROW EXECUTE FUNCTION set_latest_analysis();

-- Index for fast latest-per-game lookup
CREATE INDEX IF NOT EXISTS idx_analyses_game_latest
  ON claude_analyses (game_id, is_latest) WHERE is_latest = true;

-- Index for snapshot-based lookup
CREATE INDEX IF NOT EXISTS idx_analyses_snapshot
  ON claude_analyses (game_id, snapshot_id);
