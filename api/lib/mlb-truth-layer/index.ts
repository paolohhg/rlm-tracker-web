// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Public API
//
//  Flow: raw snapshots → normalize → validate → derive signals → write HSA
//        → post-write verify
//
//  Usage in generate-hsa.ts:
//    const truth = buildMLBTruthObject(snapshots, home, away, gameTime);
//    if (!truth.validation.is_valid) return buildBlockedOutput(truth);
//    const input = buildMLBHSAInput(truth);
//    // Pass input to Claude
//    // After generation: verifyGeneratedMLBHSA(narrative, truth)
// ══════════════════════════════════════════════════════════════════════════════

export type { MlbTruthObject, RawOddsSnapshot, PitcherInfo, MlbHsaWriterInput } from './types';
export { normalizeMLBMarket } from './normalize';
export { validateMLBTruth } from './validate';
export { deriveMLBSignals } from './signal';
export { verifyGeneratedMLBHSA, buildBlockedOutput } from './verify';

import type { RawOddsSnapshot, MlbTruthObject, PitcherInfo } from './types';
import { normalizeMLBMarket } from './normalize';
import { validateMLBTruth } from './validate';
import { deriveMLBSignals } from './signal';

/**
 * Build a fully validated MLB truth object from raw snapshots.
 * Single entry point for the MLB truth layer.
 */
export function buildMLBTruthObject(
  snapshots: RawOddsSnapshot[],
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  pitchers?: PitcherInfo,
  publicData?: { home_ticket_pct: number | null; away_ticket_pct: number | null; home_money_pct: number | null; away_money_pct: number | null },
): MlbTruthObject {
  // Step 1: Normalize raw data into canonical form
  const truth = normalizeMLBMarket(snapshots, homeTeam, awayTeam, gameTime, pitchers);

  // Step 2: Inject public data if available
  if (publicData) truth.public_data = publicData;

  // Step 3: Validate market integrity
  truth.validation = validateMLBTruth(truth);

  // Step 4: Derive signals (only if valid)
  if (truth.validation.is_valid) {
    truth.signal_summary = deriveMLBSignals(truth);
  }

  return truth;
}

/**
 * Build the structured input that the HSA writer receives.
 * The writer may ONLY use facts from this output — no raw snapshot parsing.
 */
export function buildMLBHSAInput(truth: MlbTruthObject): string {
  const ml = truth.market_state.moneyline;
  const rl = truth.market_state.run_line;
  const tot = truth.market_state.total;
  const sig = truth.signal_summary;
  const dt = truth.derived_truth;

  const lines: string[] = [
    '=== MLB TRUTH OBJECT (AUTHORITATIVE — USE ONLY THESE FACTS) ===',
    'IMPORTANT: All facts below are pre-validated. Do NOT infer or override.',
    'Do NOT parse raw sportsbook data. Use ONLY the values in this section.',
    'Do NOT treat ±1.5 run line sign differences as movement.',
    '',
    `MATCHUP: ${truth.away_team} @ ${truth.home_team}`,
    `FAVORITE: ${dt.favorite_team} (ML ${ml.consensus_side === 'home' ? ml.home_current : ml.away_current})`,
    `UNDERDOG: ${dt.underdog_team} (ML ${ml.consensus_side === 'home' ? ml.away_current : ml.home_current})`,
    `MARKET REGIME: ${dt.market_regime}`,
    `STRONGEST MARKET: ${dt.strongest_market}`,
    `PITCHER STATUS: ${dt.pitcher_context}`,
    '',
    '── MONEYLINE (PRIMARY SIGNAL) ──',
    `${truth.home_team} ML: ${ml.home_open} → ${ml.home_current} (delta: ${ml.home_delta >= 0 ? '+' : ''}${ml.home_delta})`,
    `${truth.away_team} ML: ${ml.away_open} → ${ml.away_current} (delta: ${ml.away_delta >= 0 ? '+' : ''}${ml.away_delta})`,
    `ML Direction: ${dt.moneyline_direction}`,
    `Books: ${ml.books_reporting}`,
  ];

  if (ml.per_book_home.length > 0) {
    lines.push(`Per-book ${truth.home_team} ML: ${ml.per_book_home.map(b => `${b.book} ${b.value}`).join(', ')}`);
  }
  if (ml.per_book_away.length > 0) {
    lines.push(`Per-book ${truth.away_team} ML: ${ml.per_book_away.map(b => `${b.book} ${b.value}`).join(', ')}`);
  }

  lines.push(
    '',
    '── RUN LINE (STRUCTURAL ±1.5 — DO NOT INFER MOVEMENT FROM SIGN) ──',
    `${rl.favored_team ?? '?'} -1.5 / ${rl.underdog_team ?? '?'} +1.5`,
    `Line changed: ${rl.line_changed ? 'YES (alt line detected)' : 'NO (structurally fixed at ±1.5)'}`,
    `Price changed: ${rl.price_changed ? `YES (favorite juice: ${rl.open_favorite_price} → ${rl.current_favorite_price}, delta: ${rl.favorite_price_delta})` : 'NO'}`,
    `Books: ${rl.books_reporting}`,
    '',
    '── TOTAL ──',
    `Total: ${tot.open} → ${tot.current} (delta: ${tot.number_delta >= 0 ? '+' : ''}${tot.number_delta})`,
    `Direction: ${tot.direction}`,
    `Number moved: ${tot.number_moved ? 'YES' : 'NO'}`,
    `Juice shift only: ${tot.juice_shift_only ? `YES (over juice: ${tot.over_price_delta}, under juice: ${tot.under_price_delta})` : 'NO'}`,
    `Books: ${tot.books_reporting}`,
  );

  if (tot.per_book.length > 0) {
    lines.push(`Per-book: ${tot.per_book.map(b => `${b.book} ${b.value}`).join(', ')}`);
  }

  lines.push(
    '',
    '── SIGNAL SUMMARY (PRE-COMPUTED — RESPECT THESE) ──',
    `Side: ${sig.side_signal} | Confidence: ${sig.confidence}`,
    `Side Reason: ${sig.side_reason}`,
    `Total: ${sig.total_signal}`,
    `Total Reason: ${sig.total_reason}`,
    `Status: ${sig.status}`,
    '',
    `USE THIS CONFIDENCE: ${sig.confidence}`,
    `USE THIS STATUS: ${sig.status}`,
  );

  // Public data
  const pub = truth.public_data;
  if (pub.home_ticket_pct != null) {
    lines.push('', '── PUBLIC DATA ──');
    lines.push(`Tickets: ${truth.home_team} ${pub.home_ticket_pct}% / ${truth.away_team} ${pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)}%`);
    if (pub.home_money_pct != null) {
      lines.push(`Money: ${truth.home_team} ${pub.home_money_pct}% / ${truth.away_team} ${pub.away_money_pct ?? (100 - pub.home_money_pct)}%`);
    }
  }

  // Warnings
  if (truth.validation.warnings.length > 0) {
    lines.push('', '── WARNINGS (reduce confidence or note in narrative) ──');
    for (const w of truth.validation.warnings) lines.push(`⚠ ${w}`);
  }

  return lines.join('\n');
}
