-- ============================================================================
-- HSI Universal Expansion — NHL + Universal Scoring
-- ============================================================================
-- 1. Add universal scoring columns to rlm_alerts
-- 2. Create nhl_game_context table
-- ============================================================================

-- 1. UNIVERSAL SCORING COLUMNS ON rlm_alerts ────────────────────────────────
ALTER TABLE rlm_alerts
  ADD COLUMN IF NOT EXISTS score_coordination      NUMERIC,  -- 0-25
  ADD COLUMN IF NOT EXISTS score_velocity           NUMERIC,  -- 0-20
  ADD COLUMN IF NOT EXISTS score_pressure_vs_public NUMERIC,  -- 0-20
  ADD COLUMN IF NOT EXISTS score_stability          NUMERIC,  -- 0-15
  ADD COLUMN IF NOT EXISTS score_breadth            NUMERIC,  -- 0-10
  ADD COLUMN IF NOT EXISTS score_context            NUMERIC,  -- -10 to +10
  ADD COLUMN IF NOT EXISTS hsa_score                NUMERIC;  -- 0-100 composite

-- 2. NHL GAME CONTEXT TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nhl_game_context (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              TEXT NOT NULL,
  game_time            TIMESTAMPTZ,
  league               TEXT NOT NULL DEFAULT 'NHL',
  home_team            TEXT NOT NULL,
  away_team            TEXT NOT NULL,

  -- Goalie data
  home_goalie          TEXT,
  away_goalie          TEXT,
  home_goalie_status   TEXT DEFAULT 'unconfirmed'
                       CHECK (home_goalie_status IN ('confirmed','unconfirmed','backup')),
  away_goalie_status   TEXT DEFAULT 'unconfirmed'
                       CHECK (away_goalie_status IN ('confirmed','unconfirmed','backup')),
  home_goalie_record   TEXT,          -- e.g. "25-12-3"
  away_goalie_record   TEXT,
  home_goalie_gaa      NUMERIC,       -- goals against average
  away_goalie_gaa      NUMERIC,
  home_goalie_sv_pct   NUMERIC,       -- save percentage e.g. 0.915
  away_goalie_sv_pct   NUMERIC,

  -- Key scratches / injuries
  home_scratches       TEXT[],
  away_scratches       TEXT[],
  home_b2b             BOOLEAN DEFAULT false,
  away_b2b             BOOLEAN DEFAULT false,

  -- Computed context
  context_signals      JSONB DEFAULT '[]',
  edge_score           NUMERIC,
  edge_grade           TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (home_team, away_team, game_time)
);

CREATE INDEX IF NOT EXISTS idx_nhl_ctx_game_id   ON nhl_game_context (game_id);
CREATE INDEX IF NOT EXISTS idx_nhl_ctx_game_time ON nhl_game_context (game_time);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_nhl_context_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nhl_context_updated_at ON nhl_game_context;
CREATE TRIGGER trg_nhl_context_updated_at
  BEFORE UPDATE ON nhl_game_context
  FOR EACH ROW
  EXECUTE FUNCTION update_nhl_context_timestamp();

-- RLS
ALTER TABLE nhl_game_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read nhl_context"
  ON nhl_game_context FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service write nhl_context"
  ON nhl_game_context FOR ALL TO service_role USING (true) WITH CHECK (true);
