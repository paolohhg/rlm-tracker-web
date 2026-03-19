-- ============================================================
-- Three-Layer Signal Detection + Per-Market Structured Reads
-- Migration: 007_three_layer_signal_reads.sql
-- Created: March 19, 2026
--
-- Adds per-market structured read columns (side/total/moneyline),
-- granular alert_type, ML implied probability delta, composite
-- confidence score, and layer diagnostics to rlm_alerts.
-- ============================================================

-- ── 1. Per-market structured reads ─────────────────────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS side_lean          TEXT,
  ADD COLUMN IF NOT EXISTS side_confidence    TEXT,
  ADD COLUMN IF NOT EXISTS side_signal_type   TEXT,
  ADD COLUMN IF NOT EXISTS side_summary       TEXT,

  ADD COLUMN IF NOT EXISTS total_lean         TEXT,
  ADD COLUMN IF NOT EXISTS total_confidence   TEXT,
  ADD COLUMN IF NOT EXISTS total_signal_type  TEXT,
  ADD COLUMN IF NOT EXISTS total_summary      TEXT,

  ADD COLUMN IF NOT EXISTS ml_lean            TEXT,
  ADD COLUMN IF NOT EXISTS ml_confidence      TEXT,
  ADD COLUMN IF NOT EXISTS ml_signal_type     TEXT,
  ADD COLUMN IF NOT EXISTS ml_summary         TEXT;

-- ── 2. Composite signal metadata ──────────────────────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS primary_market     TEXT,     -- 'side' | 'total' | 'moneyline' | 'none'
  ADD COLUMN IF NOT EXISTS primary_signal     TEXT,     -- e.g. 'RLM_SPREAD', 'STEAM_ML', 'NO_EDGE'
  ADD COLUMN IF NOT EXISTS overall_badge      TEXT,     -- maps to signalTier for display
  ADD COLUMN IF NOT EXISTS alert_type         TEXT,     -- granular: RLM_SPREAD, STEAM_ML, SHARP_ACCUM, etc.
  ADD COLUMN IF NOT EXISTS ml_prob_delta      NUMERIC,  -- implied probability shift (%)
  ADD COLUMN IF NOT EXISTS confidence_score   INTEGER;  -- 0-100 composite score

-- ── 3. Layer diagnostics (for debugging / HSA) ───────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS spread_signal      TEXT,     -- per-layer signal: STEAM, RLM, SHADE, etc.
  ADD COLUMN IF NOT EXISTS ml_signal          TEXT,
  ADD COLUMN IF NOT EXISTS total_signal       TEXT,
  ADD COLUMN IF NOT EXISTS primary_source     TEXT;     -- 'spread' | 'ml' | 'total'

-- ── 4. Totals movement (if not already present) ──────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS total_move         NUMERIC,
  ADD COLUMN IF NOT EXISTS opening_total      NUMERIC,
  ADD COLUMN IF NOT EXISTS current_total      NUMERIC;

-- ── 5. Splits snapshot ───────────────────────────────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS home_bets_pct      NUMERIC,
  ADD COLUMN IF NOT EXISTS home_money_pct     NUMERIC;

-- ── 6. Game time for slate filtering ────────────────────────

ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS game_time          TIMESTAMPTZ;

-- ── 7. Indexes for freshness queries ────────────────────────

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_game_time
  ON odds_snapshots (game_time);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_fetched_game
  ON odds_snapshots (fetched_at, game_time);

CREATE INDEX IF NOT EXISTS idx_rlm_alerts_game_time
  ON rlm_alerts (game_time);
