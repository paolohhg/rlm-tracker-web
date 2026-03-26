// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Public API
//
//  Flow: raw snapshots → normalize → validate → derive signals → write HSA
//        → verify output
//
//  Usage in generate-hsa.ts:
//    const truth = buildMlbTruth(snapshots, home, away, gameTime);
//    if (!truth.validation.is_valid) return buildBlockedOutput(truth);
//    // Pass truth to Claude as structured input
//    // After generation, verify: verifyMlbHsa(narrative, truth)
// ══════════════════════════════════════════════════════════════════════════════

export type { MlbTruthObject, RawOddsSnapshot, MlbStartingPitchers } from './types';
export { normalizeMlbMarket } from './normalize';
export { validateMlbTruth } from './validate';
export { deriveMlbSignals } from './signal';
export { verifyMlbHsa, buildBlockedOutput } from './verify';

import type { RawOddsSnapshot, MlbTruthObject, MlbStartingPitchers } from './types';
import { normalizeMlbMarket } from './normalize';
import { validateMlbTruth } from './validate';
import { deriveMlbSignals } from './signal';

/**
 * Build a fully validated MLB truth object from raw snapshots.
 * This is the single entry point for the MLB truth layer.
 */
export function buildMlbTruth(
  snapshots: RawOddsSnapshot[],
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  pitchers?: MlbStartingPitchers,
  publicData?: { home_ticket_pct: number | null; away_ticket_pct: number | null; home_money_pct: number | null; away_money_pct: number | null },
): MlbTruthObject {
  // Step 1: Normalize
  const truth = normalizeMlbMarket(snapshots, homeTeam, awayTeam, gameTime, pitchers);

  // Step 2: Inject public data if available
  if (publicData) {
    truth.public_data = publicData;
  }

  // Step 3: Validate
  truth.validation = validateMlbTruth(truth);

  // Step 4: Derive signals (only if valid)
  if (truth.validation.is_valid) {
    truth.signal_summary = deriveMlbSignals(truth);
  }

  return truth;
}

/**
 * Build the HSA writer input from a truth object.
 * This is the ONLY data the HSA writer should use — it must not parse raw snapshots.
 */
export function buildMlbHsaInput(truth: MlbTruthObject): string {
  const ml = truth.moneyline;
  const rl = truth.run_line;
  const tot = truth.total;
  const sig = truth.signal_summary;
  const dt = truth.derived_truth;

  const sections: string[] = [
    '=== MLB TRUTH OBJECT (AUTHORITATIVE — USE ONLY THESE FACTS) ===',
    'IMPORTANT: All facts below are pre-validated. Do NOT infer or override.',
    'Do NOT parse raw sportsbook data. Use ONLY the values in this section.',
    '',
    `MATCHUP: ${truth.away_team} @ ${truth.home_team}`,
    `FAVORITE: ${dt.favorite_team} (ML ${ml.consensus_favorite_ml})`,
    `UNDERDOG: ${dt.underdog_team} (ML ${ml.consensus_underdog_ml})`,
    `MARKET REGIME: ${dt.market_regime}`,
    `PRIMARY MARKET: ${dt.primary_market}`,
    '',
    '── MONEYLINE (PRIMARY SIGNAL) ──',
    `${truth.home_team} ML: ${ml.home.open} → ${ml.home.current} (delta: ${ml.home.delta >= 0 ? '+' : ''}${ml.home.delta})`,
    `${truth.away_team} ML: ${ml.away.open} → ${ml.away.current} (delta: ${ml.away.delta >= 0 ? '+' : ''}${ml.away.delta})`,
    `Books reporting: ${ml.home.books_reporting}`,
    ml.home.books.length > 0
      ? `Per-book: ${ml.home.books.map(b => `${b.book}: ${b.value}`).join(', ')}`
      : '',
    '',
    '── RUN LINE (STRUCTURAL — RARELY MOVES) ──',
    `${rl.favorite_team} -1.5 / ${rl.underdog_team} +1.5`,
    `NOTE: Run line is structurally ±1.5 in MLB. Sign differences across books are perspective, NOT movement.`,
    rl.favorite_price_current != null ? `Favorite juice: ${rl.favorite_price_open} → ${rl.favorite_price_current} (delta: ${rl.favorite_price_delta})` : 'Favorite juice: not available',
    `Books reporting: ${rl.books_reporting}`,
    rl.has_alt_line ? 'ALT LINE DETECTED: at least one book shows a non-1.5 run line' : '',
    '',
    '── TOTAL ──',
    `Total: ${tot.open} → ${tot.current} (delta: ${tot.number_delta >= 0 ? '+' : ''}${tot.number_delta}, direction: ${tot.direction})`,
    tot.over_price_current != null ? `Over juice: ${tot.over_price_open} → ${tot.over_price_current}` : '',
    `Books reporting: ${tot.books_reporting}`,
    tot.books.length > 0
      ? `Per-book: ${tot.books.map(b => `${b.book}: ${b.value}`).join(', ')}`
      : '',
    '',
    '── SIGNAL SUMMARY (PRE-COMPUTED — RESPECT THESE) ──',
    `Side Signal: ${sig.side.type} | Confidence: ${sig.side.confidence} | Direction: ${sig.side.direction || 'none'}`,
    `Total Signal: ${sig.total.type} | Confidence: ${sig.total.confidence} | Direction: ${sig.total.direction}`,
    `Overall Status: ${sig.status}`,
    `Side Factors: ${sig.side.factors.join('; ') || 'none'}`,
    `Total Factors: ${sig.total.factors.join('; ') || 'none'}`,
  ];

  // Public data
  const pub = truth.public_data;
  if (pub.home_ticket_pct != null) {
    sections.push('', '── PUBLIC DATA ──');
    sections.push(`Tickets: ${truth.home_team} ${pub.home_ticket_pct}% / ${truth.away_team} ${pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)}%`);
    if (pub.home_money_pct != null) {
      sections.push(`Money: ${truth.home_team} ${pub.home_money_pct}% / ${truth.away_team} ${pub.away_money_pct ?? (100 - pub.home_money_pct)}%`);
    }
  }

  // Validation warnings
  if (truth.validation.warnings.length > 0) {
    sections.push('', '── WARNINGS ──');
    for (const w of truth.validation.warnings) {
      sections.push(`⚠ ${w}`);
    }
  }

  // Pitcher info
  if (truth.starting_pitchers.home || truth.starting_pitchers.away) {
    sections.push('', '── PITCHERS ──');
    if (truth.starting_pitchers.home) sections.push(`Home: ${truth.starting_pitchers.home}`);
    if (truth.starting_pitchers.away) sections.push(`Away: ${truth.starting_pitchers.away}`);
    sections.push(`Confirmed: ${truth.starting_pitchers.confirmed ? 'Yes' : 'No'}`);
  }

  return sections.filter(l => l !== '').join('\n');
}
