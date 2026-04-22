-- Durable persistence for HEARD_ALERT detections.
--
-- Problem: HEARD_ALERT_MLB / HEARD_ALERT_NHL are computed by
-- supabase/functions/detect-rlm/heard-alert.ts on every cron poll, but nothing
-- persists between polls. Every refresh recomputes and discards.
--
-- Solution: two append-only tables —
--   heard_alerts: one row per (game_id, alert_type) first-fire, IMMUTABLE after
--     insert except for resolved_at.
--   heard_alert_observations: one row per subsequent detection, carrying the
--     direction_vs_first diagnostic (confirmation | drift | reversal | flat |
--     initial) and signed magnitude delta so UIs can render trajectories like
--     "HEARD fired 2h ago at 47c, now at 65c CONFIRMING."
--
-- Both side alerts (_MLB / _NHL) and total alerts (_TOTAL_MLB / _TOTAL_NHL) are
-- allowed by the CHECK constraint so the schema is forward-compatible with a
-- future brief wiring the total detectors. Only side alerts are written by the
-- current write path.

-- ── heard_alerts: first-fire record, one row per (game, alert_type) ─────────

CREATE TABLE heard_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'HEARD_ALERT_MLB',
    'HEARD_ALERT_NHL',
    'HEARD_ALERT_TOTAL_MLB',
    'HEARD_ALERT_TOTAL_NHL'
  )),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_sharp_side TEXT,
  first_avg_delta_cents NUMERIC,
  first_confidence NUMERIC,
  first_participation_rate NUMERIC,
  first_leading_book TEXT,
  game_starts_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, alert_type)
);

CREATE INDEX idx_heard_alerts_game_id ON heard_alerts(game_id);
CREATE INDEX idx_heard_alerts_first_detected_at
  ON heard_alerts(first_detected_at DESC);
CREATE INDEX idx_heard_alerts_unresolved
  ON heard_alerts(resolved_at) WHERE resolved_at IS NULL;

-- ── heard_alert_observations: per-poll trajectory rows ──────────────────────

CREATE TABLE heard_alert_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heard_alert_id UUID NOT NULL REFERENCES heard_alerts(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  avg_delta_cents NUMERIC,
  confidence NUMERIC,
  participation_rate NUMERIC,
  sharp_side TEXT,
  leading_book TEXT,
  books_moved_count INTEGER,
  direction_vs_first TEXT CHECK (direction_vs_first IN (
    'confirmation',
    'drift',
    'reversal',
    'flat',
    'initial'
  )),
  magnitude_delta_vs_first NUMERIC
);

CREATE INDEX idx_heard_observations_alert_id
  ON heard_alert_observations(heard_alert_id, observed_at DESC);
