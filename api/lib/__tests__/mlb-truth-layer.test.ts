// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer Tests
//
//  Run: npx tsx api/lib/__tests__/mlb-truth-layer.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { buildMLBTruthObject } from '../mlb-truth-layer';
import { verifyGeneratedMLBHSA, buildBlockedOutput } from '../mlb-truth-layer/verify';
import type { RawOddsSnapshot } from '../mlb-truth-layer/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName}`); }
}
function assertEqual(actual: any, expected: any, testName: string) {
  if (actual === expected) { passed++; console.log(`  ✓ ${testName}`); }
  else { failed++; console.error(`  ✗ FAIL: ${testName} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function snap(book: string, mlHome: number, mlAway: number, spread: number, total: number, fetchedAt: string): RawOddsSnapshot {
  return { bookmaker: book, moneyline_home: mlHome, moneyline_away: mlAway, spread, spread_home_price: -110, total, total_over_price: -110, fetched_at: fetchedAt };
}

// ══════════════════════════════════════════════════════════════════════════════
//  NORMALIZATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Normalization ===');
{
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, 110, 1.5,  6.5, '2026-03-25T22:00:00Z'),
    snap('pinnacle',  -128, 108, -1.5, 7,   '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, 100, 1.5,  6.5, '2026-03-26T16:00:00Z'),
    snap('pinnacle',  -112, 100, -1.5, 7,   '2026-03-26T16:00:00Z'),
  ];

  const truth = buildMLBTruthObject(snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z');

  assert(truth.validation.is_valid, 'N1: Truth object is valid');
  assertEqual(truth.derived_truth.favorite_team, 'New York Mets', 'N2: Mets are the ML favorite');
  assertEqual(truth.derived_truth.underdog_team, 'Pittsburgh Pirates', 'N3: Pirates are the underdog');
  assertEqual(truth.market_state.run_line.favorite_rl, -1.5, 'N4: Favorite RL is -1.5');
  assertEqual(truth.market_state.run_line.underdog_rl, 1.5, 'N5: Underdog RL is +1.5');
  assertEqual(truth.market_state.run_line.favored_team, 'New York Mets', 'N6: RL favorite = ML favorite');
  assert(truth.derived_truth.run_line_consistent_with_moneyline, 'N7: RL consistent with ML');
  assertEqual(truth.derived_truth.strongest_market, 'moneyline', 'N8: Strongest market is moneyline');
  assert(Math.abs(truth.market_state.moneyline.home_delta) >= 10, `N9: Home ML delta (${truth.market_state.moneyline.home_delta}) shows real movement`);
  assertEqual(truth.market_state.run_line.line_changed, false, 'N10: RL line did NOT change (still ±1.5)');
  assertEqual(truth.derived_truth.market_regime, 'ml_moving', 'N11: Market regime is ml_moving');
  assertEqual(truth.market_state.moneyline.consensus_side, 'home', 'N12: Consensus favorite is home');
}

// ══════════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Validation ===');
{
  const emptyTruth = buildMLBTruthObject([], 'Home', 'Away', '2026-03-26T16:00:00Z');
  assert(!emptyTruth.validation.is_valid, 'V1: Empty → invalid');
  assert(emptyTruth.validation.errors.length > 0, 'V2: Has errors');

  const normalSnaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -115, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
  ];
  const validTruth = buildMLBTruthObject(normalSnaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assert(validTruth.validation.is_valid, 'V3: Normal → valid');

  // Pitcher warning
  assert(validTruth.validation.warnings.some(w => w.includes('pitcher')), 'V4: Unconfirmed pitcher warning');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SIGNAL DERIVATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Signal Derivation ===');
{
  // 15c ML move = significant signal
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, 110, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('betmgm',    -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('betmgm',    -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
  ];

  const truth = buildMLBTruthObject(snaps, 'Mets', 'Pirates', '2026-03-26T16:15:00Z');
  assert(truth.signal_summary.side_signal !== 'PASS' && truth.signal_summary.side_signal !== 'MLB_SIDE_PASS',
    `S1: Side signal is not PASS (got ${truth.signal_summary.side_signal})`);
  assert(truth.signal_summary.confidence !== 'low', `S2: Confidence is not low (got ${truth.signal_summary.confidence})`);
  assert(truth.signal_summary.side_reason.includes('15'), 'S3: Reason mentions 15c movement');
  assertEqual(truth.signal_summary.status, 'WATCH', 'S4: Status is WATCH (pitchers unconfirmed caps confidence)');

  // Favorite strengthening detection
  assertEqual(truth.signal_summary.side_signal, 'MLB_DOG_BUYBACK', 'S5: Dog buyback detected (favorite ML weakened = dog shortened)');

  // Static board
  const staticSnaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
  ];
  const staticTruth = buildMLBTruthObject(staticSnaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assertEqual(staticTruth.signal_summary.side_signal, 'MLB_SIDE_PASS', 'S6: Static → MLB_SIDE_PASS');
  assertEqual(staticTruth.derived_truth.market_regime, 'stable', 'S7: Regime = stable');

  // Total movement
  const totalSnaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 8, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 8, '2026-03-26T14:00:00Z'),
  ];
  const totalTruth = buildMLBTruthObject(totalSnaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assert(totalTruth.signal_summary.total_signal !== 'PASS', `S8: Total signal not PASS (got ${totalTruth.signal_summary.total_signal})`);
  assertEqual(totalTruth.market_state.total.direction, 'up', 'S9: Total direction is up');
  assert(totalTruth.market_state.total.number_moved, 'S10: Total number moved');
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST-WRITE VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Post-Write Verification ===');
{
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
  ];
  const truth = buildMLBTruthObject(snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z');

  // Good narrative
  const good = 'Pittsburgh Pirates @ New York Mets\nMLB | WATCH | Pirates +100 ML | Moderate';
  assert(verifyGeneratedMLBHSA(good, truth).is_valid, 'PW1: Good narrative passes');

  // Bad: wrong favorite
  assert(!verifyGeneratedMLBHSA('Pittsburgh Pirates are favored.', truth).is_valid, 'PW2: Wrong favorite → rejected');

  // Bad: run line flip language
  assert(!verifyGeneratedMLBHSA('The run line flipped from -1.5 to +1.5, a 3-point move.', truth).is_valid, 'PW3: Flip language → rejected');

  // Bad: static board when ML moved
  assert(!verifyGeneratedMLBHSA('The board is entirely static with zero movement.', truth).is_valid, 'PW4: Static claim when moved → rejected');

  // Bad: confidence upgrade
  const highConf = 'Confidence: High\nMLB | ACTIVE';
  const highResult = verifyGeneratedMLBHSA(highConf, truth);
  assert(highResult.errors.length > 0 || highResult.warnings.length > 0, 'PW5: Confidence upgrade flagged');

  // Bad: claims run line moved when it didn't
  assert(!verifyGeneratedMLBHSA('The spread moved from -1.5 to +1.5.', truth).is_valid, 'PW6: RL moved claim → rejected');
}

// ══════════════════════════════════════════════════════════════════════════════
//  BLOCKED OUTPUT
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Blocked Output ===');
{
  const emptyTruth = buildMLBTruthObject([], 'Home', 'Away', '2026-03-26T16:00:00Z');
  const blocked = buildBlockedOutput(emptyTruth);
  assert(blocked.includes('BLOCKED'), 'B1: Contains BLOCKED');
  assert(blocked.includes('validation'), 'B2: Mentions validation');
  assert(blocked.includes('Disclaimer'), 'B3: Has disclaimer');
  console.log(`\n  Sample blocked output:\n  ${blocked.split('\n').slice(0, 4).join('\n  ')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  RL SIGN NORMALIZATION
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== RL Sign Normalization ===');
{
  const snaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, 100, 1.5,  7, '2026-03-26T10:00:00Z'),  // opposite sign
    snap('espnbet',   -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('pinnacle',  -115, 100, 1.5,  7, '2026-03-26T10:00:00Z'),  // opposite sign
  ];

  const truth = buildMLBTruthObject(snaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assertEqual(truth.market_state.run_line.favorite_rl, -1.5, 'RL1: Fav always -1.5');
  assertEqual(truth.market_state.run_line.underdog_rl, 1.5, 'RL2: Dog always +1.5');
  assert(truth.validation.is_valid, 'RL3: Valid despite mixed signs');
  assertEqual(truth.market_state.run_line.line_changed, false, 'RL4: Line did NOT change');
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXAMPLE VALID TRUTH OBJECT
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Example Valid Truth Object ===');
{
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 7, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, 110, -1.5, 7, '2026-03-25T22:00:00Z'),
    snap('betmgm',    -135, 115, -1.5, 7, '2026-03-25T22:00:00Z'),
    snap('pinnacle',  -128, 108, -1.5, 7, '2026-03-25T22:00:00Z'),
    snap('espnbet',   -140, 120, -1.5, 7, '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 7.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, 100, -1.5, 7.5, '2026-03-26T16:00:00Z'),
    snap('betmgm',    -120, 100, -1.5, 7.5, '2026-03-26T16:00:00Z'),
    snap('pinnacle',  -112, 100, -1.5, 7,   '2026-03-26T16:00:00Z'),
    snap('espnbet',   -125, 105, -1.5, 7.5, '2026-03-26T16:00:00Z'),
  ];

  const truth = buildMLBTruthObject(
    snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z',
    { home: 'F. Peralta', away: 'P. Skenes', confirmed: true },
    { home_ticket_pct: 70, away_ticket_pct: 30, home_money_pct: 64, away_money_pct: 36 },
  );

  assert(truth.validation.is_valid, 'EX1: Valid');
  assert(truth.signal_summary.status !== 'PASS', `EX2: Status is ${truth.signal_summary.status}`);
  assertEqual(truth.derived_truth.pitcher_context, 'confirmed', 'EX3: Pitchers confirmed');
  assertEqual(truth.derived_truth.market_regime, 'both_moving', 'EX4: Both ML and total moved');
  console.log(`  Side: ${truth.signal_summary.side_signal} (${truth.signal_summary.confidence})`);
  console.log(`  Total: ${truth.signal_summary.total_signal}`);
  console.log(`  Reason: ${truth.signal_summary.side_reason}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`MLB Truth Layer Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All MLB Truth Layer tests passed');
}
