-- Add game_time to rlm_alerts so we can filter out past-tipoff games
-- Without this, stale alerts (e.g. yesterday's Liberty steam) persist on the board
ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS game_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rlm_alerts_game_time ON rlm_alerts (game_time);
