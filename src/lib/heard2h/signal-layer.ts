// ── Layer 3 — Context Signals ────────────────────────────────────────────────

import type { GameInput, DerivedMetrics, SignalResult, SignalItem, MipVerdict, TempoResult } from './types';

function signalVerdict(score: number): MipVerdict {
  if (score >= 7) return 'strong_play';
  if (score >= 5) return 'play';
  if (score >= 3) return 'lean';
  return 'no_play';
}

export function computeSignals(
  input: GameInput,
  derived: DerivedMetrics,
  tempo: TempoResult | null,
): SignalResult {
  const isNcaab = input.sport === 'ncaab';
  const signals: SignalItem[] = [];

  // 1. 2H reverse line movement (sharp buyback)
  const rlmActive = !!input.signal_rlm_confirmed;
  signals.push({
    name: '2H Reverse Line Movement',
    points: 3,
    active: rlmActive,
    note: rlmActive
      ? `RLM confirmed — ${isNcaab ? 'primary signal (longer HT window)' : 'primary signal'}`
      : 'Not confirmed',
  });

  // 2. Shooting variance (unsustainable 3PT/FG%)
  let shootingVariance = false;
  if (input.fav_3pm != null && input.fav_3pa != null && input.opp_3pm != null && input.opp_3pa != null) {
    const totalAtt = input.fav_3pa + input.opp_3pa;
    if (totalAtt > 0) {
      const pct = (input.fav_3pm + input.opp_3pm) / totalAtt;
      shootingVariance = pct < 0.25 || pct > 0.45;
    }
  }
  signals.push({
    name: 'Shooting Variance',
    points: 2,
    active: shootingVariance,
    note: shootingVariance ? 'Unsustainable combined 3PT% detected' : 'Normal range',
  });

  // 3. Pre-game sharp side still supported in 2H
  const sharpSupported =
    (input.sharp_side === 'fav' && input.sh_spread_open < 0) ||
    (input.sharp_side === 'dog' && input.sh_spread_open > 0);
  const sharpActive = !!input.sharp_side && sharpSupported;
  signals.push({
    name: 'Sharp Side Continuation',
    points: 2,
    active: sharpActive,
    note: sharpActive
      ? `Sharp ${input.sharp_side} still supported (2H spread ${input.sh_spread_open})`
      : input.sharp_side ? 'Sharp side abandoned in 2H' : 'No sharp side',
  });

  // 4. 2H total dislocation
  const dislocation = Math.abs(derived.second_half_total_mispricing) >= 3.0;
  signals.push({
    name: '2H Total Dislocation',
    points: 2,
    active: dislocation,
    note: dislocation
      ? `Mispricing ${derived.second_half_total_mispricing.toFixed(1)} from implied baseline`
      : `Mispricing ${derived.second_half_total_mispricing.toFixed(1)} — within normal range`,
  });

  // 5. Pace mismatch vs total expectation (from tempo layer)
  let paceMismatch = false;
  if (tempo && tempo.adjustments.tempo !== 0) {
    paceMismatch = true;
  }
  signals.push({
    name: 'Pace Mismatch',
    points: 1,
    active: paceMismatch,
    note: paceMismatch
      ? `Tempo adjustment: ${tempo!.adjustments.tempo > 0 ? '+' : ''}${tempo!.adjustments.tempo.toFixed(1)}`
      : 'No pace mismatch detected',
  });

  // 6. Turnover regression (sloppy type only)
  const tovRegression = input.tov_type === 'sloppy' &&
    input.fav_tov != null && input.opp_tov != null &&
    (input.fav_tov + input.opp_tov) >= 8;
  signals.push({
    name: 'Turnover Regression',
    points: 1,
    active: tovRegression,
    note: tovRegression
      ? `Sloppy turnovers (${(input.fav_tov || 0) + (input.opp_tov || 0)} combined) — regression expected`
      : 'No sloppy turnover signal',
  });

  // 7. Star returning from foul trouble (manual)
  signals.push({
    name: 'Star Returning',
    points: 1,
    active: !!input.signal_star_returning,
    note: input.signal_star_returning ? 'Star player returning from foul trouble' : 'Not applicable',
  });

  // 8. Free throw differential normalizing (manual)
  signals.push({
    name: 'FT Differential Normalizing',
    points: 1,
    active: !!input.signal_ft_differential,
    note: input.signal_ft_differential ? 'FT differential expected to normalize' : 'Not applicable',
  });

  // 9. Psychological spot
  const psychPts = isNcaab ? 2 : 1;
  signals.push({
    name: 'Psychological Spot',
    points: psychPts,
    active: !!input.signal_psych_spot,
    note: input.signal_psych_spot
      ? `Psychological spot active (${isNcaab ? '+2 NCAAB weight' : '+1 NBA'})`
      : 'Not applicable',
  });

  const total_score = signals.reduce((sum, s) => sum + (s.active ? s.points : 0), 0);

  return {
    signals,
    total_score,
    verdict: signalVerdict(total_score),
  };
}
