// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Post-Write Verification
//
//  Compares written HSA output against the canonical truth object.
//  Rejects output if it contradicts validated facts.
// ══════════════════════════════════════════════════════════════════════════════

import type { MlbTruthObject } from './types';

export interface VerificationResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
}

export function verifyMlbHsa(narrative: string, truth: MlbTruthObject): VerificationResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const lower = narrative.toLowerCase();

  const favTeam = truth.derived_truth.favorite_team.toLowerCase();
  const dogTeam = truth.derived_truth.underdog_team.toLowerCase();

  // ── 1. Favorite/Underdog labels ────────────────────────────────
  // The HSA must not call the underdog the favorite or vice versa
  if (lower.includes(`${dogTeam} favored`) || lower.includes(`${dogTeam} is the favorite`) || lower.includes(`${dogTeam} are favored`)) {
    violations.push(
      `HSA incorrectly labels ${truth.derived_truth.underdog_team} as favorite. ` +
      `Truth: ${truth.derived_truth.favorite_team} is the ML favorite at ${truth.moneyline.consensus_favorite_ml}.`
    );
  }

  // ── 2. Run line flip language ──────────────────────────────────
  const flipPhrases = [
    'run line flip', 'run line flipped', 'rl flip', 'rl flipped',
    '3-point move', '3 point move', 'three-point move',
    'consensus flip', 'spread flip', 'spread flipped',
  ];
  for (const phrase of flipPhrases) {
    if (lower.includes(phrase)) {
      violations.push(
        `HSA uses forbidden language "${phrase}". MLB run line is structurally ±1.5 — sign differences are not flips.`
      );
    }
  }

  // ── 3. Run line movement claims ────────────────────────────────
  // If ML is the primary market, HSA should not claim run line "moved"
  if (truth.derived_truth.primary_market === 'moneyline') {
    const rlMovePhrases = [
      'run line moved', 'spread moved from', 'spread moved to',
      'run line shifted', 'rl moved',
    ];
    for (const phrase of rlMovePhrases) {
      if (lower.includes(phrase)) {
        // Only a violation if the run line number didn't actually move
        if (!truth.run_line.has_alt_line) {
          violations.push(
            `HSA claims run line moved, but RL is structurally static at ±1.5 with no alt lines. ` +
            `Primary market is moneyline.`
          );
        }
      }
    }
  }

  // ── 4. Moneyline direction ─────────────────────────────────────
  if (truth.signal_summary.side.type !== 'PASS' && truth.signal_summary.side.direction) {
    const direction = truth.signal_summary.side.direction.toLowerCase();
    // If signal says "toward Team A" but narrative says "toward Team B"
    // This is a directional claim check
    if (direction.includes(favTeam) && lower.includes(`toward ${dogTeam}`) && !lower.includes(`toward ${favTeam}`)) {
      warnings.push(
        `HSA may have reversed ML direction. Signal says "${truth.signal_summary.side.direction}" but narrative only mentions toward ${truth.derived_truth.underdog_team}.`
      );
    }
  }

  // ── 5. Confidence label consistency ────────────────────────────
  const sideConf = truth.signal_summary.side.confidence.toLowerCase();
  const confMatch = narrative.match(/Confidence:\s*(Low|Moderate|Elevated|High)/i);
  if (confMatch) {
    const hsaConf = confMatch[1].toLowerCase();
    if (hsaConf !== sideConf) {
      warnings.push(
        `HSA confidence "${confMatch[1]}" differs from truth "${truth.signal_summary.side.confidence}".`
      );
    }
  }

  // ── 6. Status tag consistency ──────────────────────────────────
  const statusMatch = narrative.match(/\b(PASS|WATCH|ACTIVE)\b/);
  if (statusMatch) {
    const hsaStatus = statusMatch[1];
    if (hsaStatus !== truth.signal_summary.status) {
      // PASS when truth says WATCH/ACTIVE is a violation
      if (hsaStatus === 'PASS' && truth.signal_summary.status !== 'PASS') {
        violations.push(
          `HSA says PASS but truth object says ${truth.signal_summary.status}. ` +
          `Side signal: ${truth.signal_summary.side.type} (${truth.signal_summary.side.confidence}).`
        );
      } else {
        warnings.push(
          `HSA status "${hsaStatus}" differs from truth "${truth.signal_summary.status}".`
        );
      }
    }
  }

  // ── 7. Static board claims when market moved ───────────────────
  if (truth.derived_truth.market_regime !== 'stable') {
    const staticPhrases = ['static board', 'no movement', 'entirely static', 'all books held', 'zero movement'];
    for (const phrase of staticPhrases) {
      if (lower.includes(phrase)) {
        violations.push(
          `HSA claims "${phrase}" but truth shows market_regime="${truth.derived_truth.market_regime}". ` +
          `ML delta: home ${truth.moneyline.home.delta}, away ${truth.moneyline.away.delta}. ` +
          `Total delta: ${truth.total.number_delta}.`
        );
        break;
      }
    }
  }

  // ── 8. Total direction ─────────────────────────────────────────
  if (truth.total.direction !== 'stable' && Math.abs(truth.total.number_delta) >= 0.5) {
    if (truth.total.direction === 'over' && lower.includes('total moved under')) {
      violations.push(`HSA says total moved under, but truth shows total moved over (${truth.total.open} → ${truth.total.current}).`);
    }
    if (truth.total.direction === 'under' && lower.includes('total moved over')) {
      violations.push(`HSA says total moved over, but truth shows total moved under (${truth.total.open} → ${truth.total.current}).`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Build a blocked output for invalid market state.
 * Used when validation.is_valid === false.
 */
export function buildBlockedOutput(truth: MlbTruthObject): string {
  const errors = truth.validation.errors.join('; ');
  return [
    `${truth.away_team} @ ${truth.home_team}`,
    `MLB | BLOCKED | Market state failed validation`,
    '',
    'ANALYSIS BLOCKED',
    `This game's market data failed validation and cannot be analyzed.`,
    `Errors: ${errors}`,
    truth.validation.warnings.length > 0
      ? `Warnings: ${truth.validation.warnings.join('; ')}`
      : '',
    '',
    'No HSA output is generated when the underlying data is invalid.',
    'This prevents incorrect market narration.',
    '',
    'Disclaimer: For research purposes only.',
  ].filter(l => l !== '').join('\n');
}
