// ── Layer 2 — Tempo Layer (Fair 2H Total Engine) ────────────────────────────

import type {
  GameInput, DerivedMetrics, TempoResult, TempoAdjustments, EdgeVerdict,
} from './types';

const NCAAB_PPP = 1.04;

// ── Adjustment 1: Tempo ──────────────────────────────────────────────────────

interface TempoCalc {
  adjustment: number;
  reason: string;
}

function computeTempoAdj(input: GameInput, derived: DerivedMetrics): TempoCalc {
  // Need box score data for tempo calculation
  if (
    input.fav_fga == null || input.fav_oreb == null || input.fav_tov == null ||
    input.fav_fta == null || input.opp_fga == null || input.opp_oreb == null ||
    input.opp_tov == null || input.opp_fta == null
  ) {
    return { adjustment: 0, reason: 'No box score data — tempo adjustment skipped' };
  }

  // Estimate actual 1H possessions per team: FGA - OREB + TOV + (0.475 * FTA)
  const favPoss = input.fav_fga - input.fav_oreb + input.fav_tov + (0.475 * input.fav_fta);
  const oppPoss = input.opp_fga - input.opp_oreb + input.opp_tov + (0.475 * input.opp_fta);
  const actualPoss = (favPoss + oppPoss) / 2;

  // Market-implied half possessions (primary anchor)
  const marketImpliedPoss = input.first_half_total / NCAAB_PPP;
  const paceDeviation = actualPoss - marketImpliedPoss;

  // Combined PPP (efficiency)
  const combinedPPP = derived.halftime_total_points / actualPoss;

  // Determine pace and efficiency categories
  const paceNormal = Math.abs(paceDeviation) < 3;
  const paceFast = paceDeviation >= 3;
  const paceSlow = paceDeviation <= -3;
  const effNormal = combinedPPP >= 0.95 && combinedPPP <= 1.12;
  const effLow = combinedPPP < 0.95;
  const effHigh = combinedPPP > 1.12;

  let adjustment = 0;
  let caseLabel = '';

  if (paceNormal && effLow) {
    // Case 1: normal pace, cold shooting → regression expected, over lean
    adjustment = Math.abs(paceDeviation) < 1 ? 1 : (combinedPPP < 0.85 ? 3 : 2);
    caseLabel = `Case 1: Normal pace (dev ${paceDeviation.toFixed(1)}), low efficiency (PPP ${combinedPPP.toFixed(2)}) → over lean`;
  } else if (paceSlow && effNormal) {
    // Case 2: slow pace, normal efficiency → true under
    adjustment = paceDeviation <= -5 ? -3 : -2;
    caseLabel = `Case 2: Slow pace (dev ${paceDeviation.toFixed(1)}), normal efficiency → under lean`;
  } else if (paceFast && effHigh) {
    // Case 3: fast pace, hot shooting → unsustainable, under lean
    adjustment = paceDeviation >= 5 ? -3 : -2;
    caseLabel = `Case 3: Fast pace (dev ${paceDeviation.toFixed(1)}), high efficiency (PPP ${combinedPPP.toFixed(2)}) → under lean`;
  } else if (paceFast && effLow) {
    // Case 4: fast pace, cold shooting → could explode, strong over lean
    adjustment = paceDeviation >= 5 ? 4 : 3;
    caseLabel = `Case 4: Fast pace (dev ${paceDeviation.toFixed(1)}), low efficiency (PPP ${combinedPPP.toFixed(2)}) → strong over lean`;
  } else if (paceSlow && effLow) {
    adjustment = 0;
    caseLabel = `Slow pace + low efficiency — ambiguous, no adjustment`;
  } else if (paceSlow && effHigh) {
    adjustment = -1;
    caseLabel = `Slow pace + high efficiency — slightly under lean`;
  } else if (paceNormal && effHigh) {
    adjustment = -1;
    caseLabel = `Normal pace + high efficiency — slight under lean`;
  } else {
    adjustment = 0;
    caseLabel = `Normal pace + normal efficiency — no adjustment`;
  }

  return {
    adjustment,
    reason: `${caseLabel}. Actual poss: ${actualPoss.toFixed(1)}, market-implied: ${marketImpliedPoss.toFixed(1)}, pace dev: ${paceDeviation.toFixed(1)}, combined PPP: ${combinedPPP.toFixed(2)}`,
  };
}

// ── Adjustment 2: Foul/Bonus ─────────────────────────────────────────────────

function computeFoulAdj(input: GameInput): TempoCalc {
  if (input.sport === 'ncaab') {
    if (input.fav_fouls == null || input.opp_fouls == null) {
      return { adjustment: 0, reason: 'No foul data — foul adjustment skipped' };
    }

    const favStatus = bonusStatus(input.fav_fouls);
    const oppStatus = bonusStatus(input.opp_fouls);

    if (favStatus === 'double' || oppStatus === 'double') {
      return { adjustment: 3.0, reason: `Double bonus active (fav: ${input.fav_fouls} fouls [${favStatus}], opp: ${input.opp_fouls} fouls [${oppStatus}]) — guaranteed 2 FTs on every non-shooting foul` };
    }
    if (favStatus === 'bonus' && oppStatus === 'bonus') {
      return { adjustment: 2.5, reason: `Both teams in 1-and-1 (fav: ${input.fav_fouls}, opp: ${input.opp_fouls}) — elevated FT environment` };
    }
    if (favStatus === 'bonus' || oppStatus === 'bonus') {
      return { adjustment: 1.5, reason: `One team in 1-and-1 (fav: ${input.fav_fouls} [${favStatus}], opp: ${input.opp_fouls} [${oppStatus}])` };
    }
    if (favStatus === 'approaching' || oppStatus === 'approaching') {
      return { adjustment: 0.5, reason: `Approaching bonus (fav: ${input.fav_fouls}, opp: ${input.opp_fouls}) — likely hits early 2H` };
    }
    return { adjustment: -1.5, reason: `Low foul environment (fav: ${input.fav_fouls}, opp: ${input.opp_fouls}) — fewer FTs expected` };
  }

  // NBA: simpler — use fouls if available, otherwise skip
  if (input.fav_fouls == null || input.opp_fouls == null) {
    return { adjustment: 0, reason: 'No foul data — NBA foul adjustment skipped' };
  }
  const avgFouls = (input.fav_fouls + input.opp_fouls) / 2;
  if (avgFouls <= 4) return { adjustment: -1.5, reason: `Low foul env (avg ${avgFouls.toFixed(1)}/team)` };
  if (avgFouls <= 6) return { adjustment: 0, reason: `Normal foul env (avg ${avgFouls.toFixed(1)}/team)` };
  if (avgFouls <= 9) return { adjustment: 2.0, reason: `High foul env (avg ${avgFouls.toFixed(1)}/team) — near penalty` };
  return { adjustment: 3.0, reason: `Penalty active (avg ${avgFouls.toFixed(1)}/team)` };
}

function bonusStatus(fouls: number): 'double' | 'bonus' | 'approaching' | 'none' {
  if (fouls >= 10) return 'double';
  if (fouls >= 7) return 'bonus';
  if (fouls === 6) return 'approaching';
  return 'none';
}

// ── Adjustment 3: Shooting Regression ────────────────────────────────────────

function computeShootingAdj(input: GameInput): TempoCalc {
  if (
    input.fav_3pm == null || input.fav_3pa == null ||
    input.opp_3pm == null || input.opp_3pa == null
  ) {
    return { adjustment: 0, reason: 'No 3PT data — shooting adjustment skipped' };
  }

  const totalMade = input.fav_3pm + input.opp_3pm;
  const totalAttempts = input.fav_3pa + input.opp_3pa;

  if (totalAttempts === 0) {
    return { adjustment: 0, reason: 'No 3PT attempts — shooting adjustment skipped' };
  }

  const pct = totalMade / totalAttempts;
  const pctStr = `${totalMade}-of-${totalAttempts} (${(pct * 100).toFixed(1)}%)`;

  if (pct < 0.20) return { adjustment: 4.0, reason: `Extreme cold shooting: combined 3PT% ${pctStr} — strong regression expected` };
  if (pct < 0.25) return { adjustment: 3.0, reason: `Well below average shooting: combined 3PT% ${pctStr}` };
  if (pct < 0.30) return { adjustment: 1.5, reason: `Below average shooting: combined 3PT% ${pctStr}` };
  if (pct > 0.50) return { adjustment: -4.0, reason: `Extreme hot shooting: combined 3PT% ${pctStr} — regression to mean expected` };
  if (pct > 0.45) return { adjustment: -3.0, reason: `Well above average shooting: combined 3PT% ${pctStr}` };
  if (pct > 0.38) return { adjustment: -1.5, reason: `Slightly hot shooting: combined 3PT% ${pctStr}` };
  return { adjustment: 0, reason: `Normal shooting range: combined 3PT% ${pctStr}` };
}

// ── Adjustment 4: Turnover ───────────────────────────────────────────────────

function computeTurnoverAdj(input: GameInput): TempoCalc {
  if (input.fav_tov == null || input.opp_tov == null) {
    return { adjustment: 0, reason: 'No turnover data — turnover adjustment skipped' };
  }

  const totalTov = input.fav_tov + input.opp_tov;
  const tovType = input.tov_type || '';

  if (tovType === 'sloppy') {
    if (totalTov >= 10) return { adjustment: 2.0, reason: `High sloppy TOV (${totalTov} combined) — strong regression expected` };
    if (totalTov >= 8) return { adjustment: 1.0, reason: `Moderate sloppy TOV (${totalTov} combined) — regression expected` };
  } else if (tovType === 'structural') {
    if (totalTov >= 10) return { adjustment: -1.5, reason: `High structural TOV (${totalTov} combined) — press/pressure will continue` };
    if (totalTov >= 8) return { adjustment: -1.0, reason: `Moderate structural TOV (${totalTov} combined) — structural cause continues` };
  }

  return { adjustment: 0, reason: `TOV normal or type unspecified (${totalTov} combined, type: ${tovType || 'none'})` };
}

// ── Adjustment 5: Close-Game Late Foul Inflation ─────────────────────────────

function computeCloseGameAdj(input: GameInput, derived: DerivedMetrics): TempoCalc {
  const gameState = input.game_state || inferGameState(derived.halftime_margin);
  const foulEnv = (input.fav_fouls != null && input.opp_fouls != null)
    ? ((input.fav_fouls >= 7 || input.opp_fouls >= 7) ? 'high' : 'normal')
    : 'unknown';

  if (gameState === 'close' && (foulEnv === 'high')) {
    return { adjustment: 1.5, reason: `Close game + high foul environment — late intentional fouling very likely` };
  }
  if (gameState === 'close') {
    return { adjustment: 1.0, reason: `Close game (margin ${derived.halftime_margin}) — late FT inflation expected` };
  }
  if (gameState === 'blowout') {
    return { adjustment: -2.0, reason: `Blowout developing (margin ${derived.halftime_margin}) — intentional fouling removed, 2H total likely overpriced by 2-4 pts` };
  }
  return { adjustment: 0, reason: `Moderate game state (margin ${derived.halftime_margin}) — standard baseline` };
}

function inferGameState(margin: number): 'close' | 'moderate' | 'blowout' {
  const abs = Math.abs(margin);
  if (abs <= 5) return 'close';
  if (abs >= 15) return 'blowout';
  return 'moderate';
}

// ── Edge Verdict ─────────────────────────────────────────────────────────────

function edgeToVerdict(edge: number): EdgeVerdict {
  if (edge >= 4) return 'strong_over';
  if (edge >= 2) return 'over';
  if (edge <= -4) return 'strong_under';
  if (edge <= -2) return 'under';
  return 'no_edge';
}

// ── Plain-English Generator ──────────────────────────────────────────────────

function generatePlainEnglish(
  implied: number, delta: number, open: number, misprice: number,
  firstHalfTotal: number, adjustments: TempoAdjustments,
  reasons: Record<keyof TempoAdjustments, string>,
  fair: number, edge: number,
): string {
  const direction = delta >= 0 ? 'above' : 'below';
  const mispriceDir = misprice >= 0 ? 'above' : 'below';

  const parts: string[] = [
    `Pregame implied 2H total was ${implied.toFixed(1)}.`,
    `The first half scored ${Math.abs(delta).toFixed(1)} points ${direction} the ${firstHalfTotal.toFixed(1)}-point 1H market close.`,
    `Books posted the 2H opener at ${open.toFixed(1)}, which is ${Math.abs(misprice).toFixed(1)} points ${mispriceDir} the pregame implied baseline.`,
  ];

  for (const key of ['foul', 'shooting', 'turnover', 'close_game', 'tempo'] as (keyof TempoAdjustments)[]) {
    const val = adjustments[key];
    if (val !== 0) {
      const dir = val > 0 ? 'adds' : 'subtracts';
      parts.push(`${capitalize(key.replace('_', ' '))} ${dir} ${Math.abs(val).toFixed(1)} pts: ${reasons[key]}.`);
    }
  }

  parts.push(`Fair 2H total projects to ${fair.toFixed(1)}, giving an edge of ${edge >= 0 ? '+' : ''}${edge.toFixed(1)} vs the ${open.toFixed(1)} opener.`);

  if (edge >= 4) parts.push('This is a strong 2H over candidate.');
  else if (edge >= 2) parts.push('This is a 2H over candidate.');
  else if (edge <= -4) parts.push('This is a strong 2H under candidate.');
  else if (edge <= -2) parts.push('This is a 2H under candidate.');
  else parts.push('Edge within normal band — no play.');

  return parts.join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Main Tempo Layer Function ────────────────────────────────────────────────

export function computeTempo(input: GameInput, derived: DerivedMetrics): TempoResult {
  const implied = derived.pregame_implied_2H_total;

  const tempoCalc = computeTempoAdj(input, derived);
  const foulCalc = computeFoulAdj(input);
  const shootingCalc = computeShootingAdj(input);
  const turnoverCalc = computeTurnoverAdj(input);
  const closeGameCalc = computeCloseGameAdj(input, derived);

  const adjustments: TempoAdjustments = {
    tempo: tempoCalc.adjustment,
    foul: foulCalc.adjustment,
    shooting: shootingCalc.adjustment,
    turnover: turnoverCalc.adjustment,
    close_game: closeGameCalc.adjustment,
  };

  const adjustment_reasons: Record<keyof TempoAdjustments, string> = {
    tempo: tempoCalc.reason,
    foul: foulCalc.reason,
    shooting: shootingCalc.reason,
    turnover: turnoverCalc.reason,
    close_game: closeGameCalc.reason,
  };

  const fair = implied + adjustments.tempo + adjustments.foul + adjustments.shooting + adjustments.turnover + adjustments.close_game;
  const edge = fair - input.sh_total_open;

  const flags: string[] = [];
  if (edge >= 4) flags.push('STRONG_OVER_CANDIDATE');
  if (edge <= -4) flags.push('STRONG_UNDER_CANDIDATE');
  if (input.game_state === 'blowout' || (input.game_state == null && Math.abs(derived.halftime_margin) >= 15)) {
    flags.push('BLOWOUT_FT_INFLATION_REMOVED');
  }

  return {
    pregame_implied_2H_total: implied,
    adjustments,
    adjustment_reasons,
    fair_2H_total: fair,
    posted_2H_open: input.sh_total_open,
    posted_2H_current: input.sh_total_curr,
    edge,
    verdict: edgeToVerdict(edge),
    plain_english: generatePlainEnglish(
      implied, derived.first_half_total_delta, input.sh_total_open,
      derived.second_half_total_mispricing, input.first_half_total,
      adjustments, adjustment_reasons, fair, edge,
    ),
    flags,
  };
}
