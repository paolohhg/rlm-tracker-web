// ── Full Pipeline — Orchestrates all 3 layers ───────────────────────────────

import type { GameInput, PipelineResult } from './types';
import { computeMip, computeDerived } from './mip-engine';
import { computeTempo } from './tempo-layer';
import { computeSignals } from './signal-layer';

export function runPipeline(input: GameInput): PipelineResult {
  const mip = computeMip(input);
  const derived = computeDerived(input);

  // Tempo layer requires box score data
  const hasBoxScore =
    input.fav_fga != null && input.opp_fga != null &&
    input.fav_3pm != null && input.opp_3pm != null;

  // Run tempo if we have at least some box score fields
  const hasSomeData =
    input.fav_fouls != null || input.opp_fouls != null ||
    input.fav_3pm != null || input.opp_3pm != null ||
    input.fav_tov != null || input.opp_tov != null;

  const tempo = hasSomeData ? computeTempo(input, derived) : null;
  const signals = computeSignals(input, derived, tempo);

  return {
    input,
    mip,
    tempo,
    signals,
    has_full_data: hasBoxScore,
  };
}
