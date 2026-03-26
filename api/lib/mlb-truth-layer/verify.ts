// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Post-Write Verification
//
//  Compares written HSA output against the canonical truth object.
//  Rejects output if it contradicts validated facts.
// ══════════════════════════════════════════════════════════════════════════════

import type { MlbTruthObject } from './types';

export interface VerificationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export function verifyGeneratedMLBHSA(narrative: string, truth: MlbTruthObject): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lower = narrative.toLowerCase();

  const dt = truth.derived_truth;
  const sig = truth.signal_summary;
  const favTeam = (dt.favorite_team ?? '').toLowerCase();
  const dogTeam = (dt.underdog_team ?? '').toLowerCase();

  // ── 1. Correct favorite/underdog ───────────────────────────────
  if (dogTeam && (lower.includes(`${dogTeam} favored`) || lower.includes(`${dogTeam} is the favorite`) || lower.includes(`${dogTeam} are favored`))) {
    errors.push(`Narrative labels ${dt.underdog_team} as favorite. Truth: ${dt.favorite_team} is the ML favorite.`);
  }

  // ── 2. Correct home/away ───────────────────────────────────────
  if (lower.includes(`${truth.away_team.toLowerCase()} (home)`) || lower.includes(`${truth.away_team.toLowerCase()} home`)) {
    // Only flag if it's clearly claiming the away team is home
    const contextCheck = lower.indexOf(`${truth.away_team.toLowerCase()} home`);
    if (contextCheck >= 0 && !lower.substring(contextCheck - 5, contextCheck).includes('@')) {
      warnings.push(`Narrative may incorrectly label ${truth.away_team} as home team.`);
    }
  }

  // ── 3. Run line direction — forbidden language ─────────────────
  const flipPhrases = [
    'run line flip', 'run line flipped', 'rl flip', 'rl flipped',
    '3-point move', '3 point move', 'three-point move', 'three point move',
    'consensus flip', 'spread flip', 'spread flipped',
  ];
  for (const phrase of flipPhrases) {
    if (lower.includes(phrase)) {
      errors.push(`Forbidden language: "${phrase}". MLB run line is structurally ±1.5 — sign differences are not flips.`);
    }
  }

  // ── 4. Run line movement claims when RL is structural ──────────
  if (!truth.market_state.run_line.line_changed) {
    const rlMovePhrases = ['run line moved', 'spread moved from', 'spread moved to', 'run line shifted'];
    for (const phrase of rlMovePhrases) {
      if (lower.includes(phrase)) {
        errors.push(`Narrative claims "${phrase}" but RL is structurally static at ±1.5.`);
      }
    }
  }

  // ── 5. Moneyline direction ─────────────────────────────────────
  if (dt.moneyline_direction === 'home' && lower.includes('moneyline moved toward') && !lower.includes(truth.home_team.toLowerCase())) {
    warnings.push(`ML direction may be wrong. Truth says toward ${truth.home_team}.`);
  }
  if (dt.moneyline_direction === 'away' && lower.includes('moneyline moved toward') && !lower.includes(truth.away_team.toLowerCase())) {
    warnings.push(`ML direction may be wrong. Truth says toward ${truth.away_team}.`);
  }

  // ── 6. Total direction ─────────────────────────────────────────
  const tot = truth.market_state.total;
  if (tot.number_moved) {
    if (tot.direction === 'up' && lower.includes('total moved under')) {
      errors.push(`Narrative says total moved under, but truth shows up (${tot.open} → ${tot.current}).`);
    }
    if (tot.direction === 'down' && lower.includes('total moved over')) {
      errors.push(`Narrative says total moved over, but truth shows down (${tot.open} → ${tot.current}).`);
    }
  }

  // ── 7. Confidence label ────────────────────────────────────────
  const confMatch = narrative.match(/Confidence:\s*(Low|Moderate|High|Elevated)/i);
  if (confMatch) {
    const hsaConf = confMatch[1].toLowerCase();
    const truthConf = sig.confidence;
    // HSA should not UPGRADE confidence above truth
    const confOrder: Record<string, number> = { low: 0, moderate: 1, elevated: 1, high: 2 };
    if ((confOrder[hsaConf] ?? 0) > (confOrder[truthConf] ?? 0)) {
      errors.push(`Narrative confidence "${confMatch[1]}" exceeds approved confidence "${truthConf}".`);
    }
  }

  // ── 8. Status tag ──────────────────────────────────────────────
  const statusMatch = narrative.match(/\b(PASS|WATCH|ACTIVE)\b/);
  if (statusMatch) {
    const hsaStatus = statusMatch[1];
    if (hsaStatus === 'PASS' && sig.status !== 'PASS') {
      errors.push(`Narrative says PASS but truth says ${sig.status}. Side: ${sig.side_signal}, Total: ${sig.total_signal}.`);
    }
    if (hsaStatus === 'ACTIVE' && sig.status === 'PASS') {
      errors.push(`Narrative says ACTIVE but truth says PASS — no signal detected.`);
    }
  }

  // ── 9. Static board claims when market moved ───────────────────
  if (dt.market_regime !== 'stable') {
    const staticPhrases = ['static board', 'no movement', 'entirely static', 'all books held', 'zero movement', 'completely flat'];
    for (const phrase of staticPhrases) {
      if (lower.includes(phrase)) {
        errors.push(`Narrative claims "${phrase}" but market_regime="${dt.market_regime}".`);
        break;
      }
    }
  }

  // ── 10. Steam/consensus/buyback claims must be supported ───────
  if (lower.includes('steam') && sig.side_signal !== 'MLB_ML_FAVORITE_STRENGTHENING' && sig.side_signal !== 'MLB_DOG_BUYBACK' && !sig.side_reason.includes('STEAM')) {
    if (sig.total_signal !== 'MLB_TOTAL_OVER_STEAM' && sig.total_signal !== 'MLB_TOTAL_UNDER_STEAM') {
      warnings.push('Narrative mentions "steam" but no steam signal in truth object.');
    }
  }
  if (lower.includes('buyback') && sig.side_signal !== 'MLB_DOG_BUYBACK') {
    warnings.push('Narrative mentions "buyback" but signal is not MLB_DOG_BUYBACK.');
  }
  if (lower.includes('full book consensus') && !sig.side_reason.includes('STEAM')) {
    warnings.push('Narrative mentions "full book consensus" — verify book count supports this.');
  }

  return { is_valid: errors.length === 0, errors, warnings };
}

/**
 * Build a blocked output for invalid market state.
 */
export function buildBlockedOutput(truth: MlbTruthObject): string {
  const errList = truth.validation.errors.join('; ');
  const warnList = truth.validation.warnings.join('; ');
  return [
    `${truth.away_team} @ ${truth.home_team}`,
    `MLB | BLOCKED | Market state failed validation`,
    '',
    'HSA blocked: MLB market state failed validation.',
    `Errors: ${errList}`,
    warnList ? `Warnings: ${warnList}` : '',
    '',
    'Review normalization and book mapping before generating analysis.',
    'No HSA output is generated when the underlying data is invalid.',
    '',
    'Disclaimer: For research purposes only.',
  ].filter(l => l !== '').join('\n');
}
