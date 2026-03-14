-- ============================================================
-- Heard Method Betting Cycles
-- Migration: 003_hm_cycles.sql
-- Created: March 13, 2026
-- ============================================================
-- Tracks full HM betting cycles (1H + optional 2H recovery).
-- Record is at CYCLE level:
--   win  = 1H win, OR 1H loss + 2H win (recovery)
--   loss = 1H loss + 2H loss (full sweep)
-- ============================================================

CREATE TABLE IF NOT EXISTS hm_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Game info
  game_id         text NOT NULL,        -- e.g. "NBA|Lakers|Celtics|2026-03-13"
  league          text NOT NULL,        -- 'NBA' | 'NCAAB'
  away_team       text NOT NULL,
  home_team       text NOT NULL,
  game_date       date NOT NULL,
  game_time       timestamptz,

  -- Signal info
  signal_tier     text,                 -- 'DOUBLE NO-NARRATIVE RLM' | 'NO-NARRATIVE RLM' | etc.
  sharp_side      text NOT NULL,        -- team name (the sharp side)
  sharp_spread    text NOT NULL,        -- e.g. '+4.5' or '-7'

  -- 1H bet
  h1_units        numeric(10,2) NOT NULL DEFAULT 1,   -- base unit size
  h1_result       text NOT NULL DEFAULT 'pending',    -- 'win' | 'loss' | 'push' | 'pending'
  h1_score        text,                               -- e.g. '48-52' at halftime

  -- 2H recovery (only if 1H lost)
  h2_triggered    boolean NOT NULL DEFAULT false,
  h2_units        numeric(10,2),        -- auto = h1_units * 2
  h2_result       text DEFAULT 'n/a',  -- 'win' | 'loss' | 'push' | 'pending' | 'n/a'
  h2_score        text,                -- final score

  -- Cycle outcome
  cycle_result    text NOT NULL DEFAULT 'pending',    -- 'win' | 'loss' | 'push' | 'pending'
  -- win  = h1 win, OR (h1 loss + h2 win)
  -- loss = h1 loss + h2 loss

  -- P&L (in units)
  -- win via 1H:         +h1_units
  -- win via 2H recovery: net = h2_units - h1_units = h1_units (break even on loss, profit on 2H)
  -- loss:               -(h1_units + h2_units)
  net_units       numeric(10,2),        -- calculated on resolution

  -- Notes
  notes           text,

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER hm_cycles_updated_at
  BEFORE UPDATE ON hm_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS hm_cycles_game_id     ON hm_cycles (game_id);
CREATE INDEX IF NOT EXISTS hm_cycles_game_date   ON hm_cycles (game_date);
CREATE INDEX IF NOT EXISTS hm_cycles_league      ON hm_cycles (league);
CREATE INDEX IF NOT EXISTS hm_cycles_result      ON hm_cycles (cycle_result);

-- Enable Row Level Security
ALTER TABLE hm_cycles ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read/write their own records
-- (adjust if you add user_id later)
CREATE POLICY "Allow all for authenticated"
  ON hm_cycles
  FOR ALL
  USING (true)
  WITH CHECK (true);
