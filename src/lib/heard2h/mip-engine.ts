// ── Layer 1 — MIP Engine (Mispricing Index) ─────────────────────────────────

import type {
  GameInput, DerivedMetrics, MipResult, MipTotalsResult,
  MipSidesResult, MipVerdict, MipFlag,
} from './types';

// ── Derived Metrics ──────────────────────────────────────────────────────────

export function computeDerived(input: GameInput): DerivedMetrics {
  const halftime_total_points = input.ht_home_score + input.ht_away_score;
  const halftime_margin = input.ht_home_score - input.ht_away_score;

  return {
    pregame_implied_2H_total: input.pregame_total - input.first_half_total,
    first_half_total_delta: halftime_total_points - input.first_half_total,
    halftime_total_points,
    halftime_margin,
    second_half_total_mispricing: input.sh_total_open - (input.pregame_total - input.first_half_total),
    first_half_margin_delta: halftime_margin - Math.abs(input.first_half_spread),
    market_power_adjustment: input.sh_spread_open - input.pregame_spread,
    line_movement_ht: input.sh_total_curr - input.sh_total_open,
  };
}

// ── Verdict from score ───────────────────────────────────────────────────────

export function scoreToVerdict(score: number): MipVerdict {
  if (score >= 7) return 'strong_play';
  if (score >= 5) return 'play';
  if (score >= 3) return 'lean';
  return 'no_play';
}

// ── Totals MIP ───────────────────────────────────────────────────────────────

export function computeTotalsMip(input: GameInput, derived: DerivedMetrics): MipTotalsResult {
  const isNcaab = input.sport === 'ncaab';
  let score = 0;
  const breakdown: string[] = [];
  const flags: MipFlag[] = [];

  // Base: 1H miss
  const absDelta = Math.abs(derived.first_half_total_delta);
  if (isNcaab) {
    if (absDelta >= 8) {
      score += 2;
      breakdown.push(`1H miss ${derived.first_half_total_delta > 0 ? '+' : ''}${derived.first_half_total_delta.toFixed(1)} (NCAAB ≥8): +2`);
    } else if (absDelta >= 5) {
      score += 1;
      breakdown.push(`1H miss ${derived.first_half_total_delta > 0 ? '+' : ''}${derived.first_half_total_delta.toFixed(1)} (NCAAB ≥5): +1`);
    }
  } else {
    if (absDelta >= 10) {
      score += 2;
      breakdown.push(`1H miss ${derived.first_half_total_delta > 0 ? '+' : ''}${derived.first_half_total_delta.toFixed(1)} (≥10): +2`);
    } else if (absDelta >= 6) {
      score += 1;
      breakdown.push(`1H miss ${derived.first_half_total_delta > 0 ? '+' : ''}${derived.first_half_total_delta.toFixed(1)} (≥6): +1`);
    }
  }

  // Base: 2H total mispricing (uses opener)
  const absMisprice = Math.abs(derived.second_half_total_mispricing);
  if (isNcaab) {
    if (absMisprice >= 3.0) {
      score += 3;
      breakdown.push(`2H mispricing ${derived.second_half_total_mispricing > 0 ? '+' : ''}${derived.second_half_total_mispricing.toFixed(1)} (NCAAB ≥3.0): +3`);
    } else if (absMisprice >= 1.5) {
      score += 2;
      breakdown.push(`2H mispricing ${derived.second_half_total_mispricing > 0 ? '+' : ''}${derived.second_half_total_mispricing.toFixed(1)} (NCAAB ≥1.5): +2`);
    }
  } else {
    if (absMisprice >= 3.5) {
      score += 3;
      breakdown.push(`2H mispricing ${derived.second_half_total_mispricing > 0 ? '+' : ''}${derived.second_half_total_mispricing.toFixed(1)} (≥3.5): +3`);
    } else if (absMisprice >= 2.0) {
      score += 2;
      breakdown.push(`2H mispricing ${derived.second_half_total_mispricing > 0 ? '+' : ''}${derived.second_half_total_mispricing.toFixed(1)} (≥2.0): +2`);
    }
  }

  // Confirmation (manual checkboxes)
  if (input.confirm_sharp_total_aligns) {
    score += 1;
    breakdown.push('Sharp total aligns with 2H read: +1');
  }
  if (input.confirm_no_structural_reason) {
    score += 1;
    breakdown.push('No structural reason for adjustment: +1');
  }
  if (input.confirm_micro_rlm) {
    score += 1;
    breakdown.push(`Micro-RLM / juice confirms in HT window${isNcaab ? ' (primary signal)' : ' (bonus only)'}: +1`);
  }

  // Flags
  if (derived.second_half_total_mispricing <= -3.5) flags.push('2H_TOTAL_SUPPRESSION');
  if (derived.second_half_total_mispricing >= 3.5) flags.push('2H_TOTAL_INFLATION');
  if (isNcaab && input.confirm_micro_rlm) flags.push('NCAAB_RLM_CONFIRMED');

  return { score: Math.min(score, 8), verdict: scoreToVerdict(Math.min(score, 8)), breakdown, flags };
}

// ── Sides MIP ────────────────────────────────────────────────────────────────

export function computeSidesMip(input: GameInput, derived: DerivedMetrics): MipSidesResult {
  const isNcaab = input.sport === 'ncaab';
  let score = 0;
  const breakdown: string[] = [];
  const flags: MipFlag[] = [];

  // Base: sharp side exists
  if (input.sharp_side === 'fav' || input.sharp_side === 'dog') {
    score += 2;
    breakdown.push(`Sharp side exists (${input.sharp_side}): +2`);
  }

  // Base: spread deviation
  const absMarginDelta = Math.abs(derived.first_half_margin_delta);
  if (isNcaab) {
    if (absMarginDelta >= 4) {
      score += 2;
      breakdown.push(`Margin delta ${derived.first_half_margin_delta > 0 ? '+' : ''}${derived.first_half_margin_delta.toFixed(1)} (NCAAB ≥4): +2`);
    } else if (absMarginDelta >= 2.5) {
      score += 1;
      breakdown.push(`Margin delta ${derived.first_half_margin_delta > 0 ? '+' : ''}${derived.first_half_margin_delta.toFixed(1)} (NCAAB ≥2.5): +1`);
    }
  } else {
    if (absMarginDelta >= 5) {
      score += 2;
      breakdown.push(`Margin delta ${derived.first_half_margin_delta > 0 ? '+' : ''}${derived.first_half_margin_delta.toFixed(1)} (≥5): +2`);
    } else if (absMarginDelta >= 3) {
      score += 1;
      breakdown.push(`Margin delta ${derived.first_half_margin_delta > 0 ? '+' : ''}${derived.first_half_margin_delta.toFixed(1)} (≥3): +1`);
    }
  }

  // Base: 2H line still supports pregame sharp side
  const sharp_supported =
    (input.sharp_side === 'fav' && input.sh_spread_open < 0) ||
    (input.sharp_side === 'dog' && input.sh_spread_open > 0);

  if (input.sharp_side && sharp_supported) {
    score += 2;
    breakdown.push(`2H line supports sharp side (${input.sharp_side}, spread ${input.sh_spread_open}): +2`);
  }

  // Confirmation (manual)
  if (input.confirm_2h_line_soft) {
    score += 1;
    breakdown.push('2H line too soft vs pregame power rating: +1');
  }
  if (input.confirm_side_rlm) {
    score += 1;
    breakdown.push('Micro-RLM / juice confirms side: +1');
  }
  if (input.confirm_no_foul_injury) {
    score += 1;
    breakdown.push('No foul/injury reason against the side: +1');
  }

  // Flags
  if (derived.first_half_margin_delta >= 7) flags.push('2H_SIDE_UNDERCORRECTION');
  if (derived.first_half_margin_delta <= -7) flags.push('2H_SIDE_OVERCORRECTION');
  if (input.sharp_side) {
    flags.push(sharp_supported ? 'SHARP_SIDE_CONTINUATION' : 'SHARP_SIDE_ABANDONED');
  }

  return {
    score: Math.min(score, 8),
    verdict: scoreToVerdict(Math.min(score, 8)),
    breakdown,
    flags,
    sharp_supported,
  };
}

// ── Full MIP ─────────────────────────────────────────────────────────────────

export function computeMip(input: GameInput): MipResult {
  const derived = computeDerived(input);
  return {
    totals: computeTotalsMip(input, derived),
    sides: computeSidesMip(input, derived),
    derived,
  };
}
