// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer Tests
//
//  Run: npx tsx api/lib/__tests__/mlb-truth-layer.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { buildMlbTruth } from '../mlb-truth-layer';
import { verifyMlbHsa, buildBlockedOutput } from '../mlb-truth-layer/verify';
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
//  NORMALIZATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Normalization ===');
{
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, 110, 1.5,  6.5, '2026-03-25T22:00:00Z'),  // opposite RL sign
    snap('pinnacle',  -128, 108, -1.5, 7,   '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, 100, 1.5,  6.5, '2026-03-26T16:00:00Z'),
    snap('pinnacle',  -112, 100, -1.5, 7,   '2026-03-26T16:00:00Z'),
  ];

  const truth = buildMlbTruth(snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z');

  assert(truth.validation.is_valid, 'N1: Truth object is valid');
  assertEqual(truth.derived_truth.favorite_team, 'New York Mets', 'N2: Mets are the ML favorite');
  assertEqual(truth.derived_truth.underdog_team, 'Pittsburgh Pirates', 'N3: Pirates are the ML underdog');
  assertEqual(truth.run_line.favorite_rl, -1.5, 'N4: Favorite RL is -1.5');
  assertEqual(truth.run_line.underdog_rl, 1.5, 'N5: Underdog RL is +1.5');
  assertEqual(truth.run_line.favorite_team, 'New York Mets', 'N6: RL favorite matches ML favorite');
  assert(truth.derived_truth.run_line_consistent_with_moneyline, 'N7: RL consistent with ML');
  assertEqual(truth.derived_truth.primary_market, 'moneyline', 'N8: Primary market is moneyline');
  assert(Math.abs(truth.moneyline.home.delta) >= 10, `N9: Home ML delta (${truth.moneyline.home.delta}) shows real movement`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  VALIDATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Validation ===');
{
  // Empty snapshots = invalid
  const emptyTruth = buildMlbTruth([], 'Home', 'Away', '2026-03-26T16:00:00Z');
  assert(!emptyTruth.validation.is_valid, 'V1: Empty snapshots → invalid');
  assert(emptyTruth.validation.errors.length > 0, 'V2: Has error messages');

  // Normal snapshots = valid
  const snaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -115, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
  ];
  const validTruth = buildMlbTruth(snaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assert(validTruth.validation.is_valid, 'V3: Normal snapshots → valid');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SIGNAL DERIVATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Signal Derivation ===');
{
  // 15-cent ML move = meaningful signal
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, 110, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('betmgm',    -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('betmgm',    -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
  ];

  const truth = buildMlbTruth(snaps, 'Mets', 'Pirates', '2026-03-26T16:15:00Z');
  assert(truth.signal_summary.side.type !== 'PASS', `S1: Side signal is not PASS (got ${truth.signal_summary.side.type})`);
  assert(truth.signal_summary.side.confidence !== 'Low', `S2: Side confidence is not Low (got ${truth.signal_summary.side.confidence})`);
  assertEqual(truth.signal_summary.side.primary_market, 'moneyline', 'S3: Primary market is moneyline');

  // Static board = PASS
  const staticSnaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -120, 100, -1.5, 7, '2026-03-26T14:00:00Z'),
  ];
  const staticTruth = buildMlbTruth(staticSnaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assertEqual(staticTruth.signal_summary.side.type, 'PASS', 'S4: Static board → PASS');
  assertEqual(staticTruth.derived_truth.market_regime, 'stable', 'S5: Market regime is stable');
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST-WRITE VERIFICATION TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Post-Write Verification ===');
{
  const snaps = [
    snap('draftkings', -135, 115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('draftkings', -120, 100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
  ];
  const truth = buildMlbTruth(snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z');

  // Good narrative — should pass
  const goodNarrative = 'Pittsburgh Pirates @ New York Mets\nMLB | WATCH | Pirates +100 ML | Moderate\nMoneyline moved toward Pirates.';
  const goodResult = verifyMlbHsa(goodNarrative, truth);
  assert(goodResult.violations.length === 0, 'PW1: Good narrative passes verification');

  // Bad: calls underdog the favorite
  const badFav = 'Pittsburgh Pirates are favored in this matchup.';
  const badFavResult = verifyMlbHsa(badFav, truth);
  assert(badFavResult.violations.length > 0, 'PW2: Incorrectly labeling underdog as favorite → violation');

  // Bad: uses "run line flip" language
  const badFlip = 'The run line flipped from -1.5 to +1.5, a 3-point move.';
  const badFlipResult = verifyMlbHsa(badFlip, truth);
  assert(badFlipResult.violations.length > 0, 'PW3: "run line flip" language → violation');
  assert(badFlipResult.violations.some(v => v.includes('3-point move')), 'PW4: "3-point move" caught');

  // Bad: claims "static board" when ML moved
  const badStatic = 'The board is entirely static with zero movement across all markets.';
  const truthWithMovement = buildMlbTruth(snaps, 'New York Mets', 'Pittsburgh Pirates', '2026-03-26T16:15:00Z');
  const badStaticResult = verifyMlbHsa(badStatic, truthWithMovement);
  assert(badStaticResult.violations.length > 0, 'PW5: "static board" when ML moved → violation');
}

// ══════════════════════════════════════════════════════════════════════════════
//  BLOCKED OUTPUT TEST
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Blocked Output ===');
{
  const emptyTruth = buildMlbTruth([], 'Home', 'Away', '2026-03-26T16:00:00Z');
  const blocked = buildBlockedOutput(emptyTruth);
  assert(blocked.includes('BLOCKED'), 'B1: Blocked output contains BLOCKED');
  assert(blocked.includes('validation'), 'B2: Blocked output mentions validation');
  assert(blocked.includes('Disclaimer'), 'B3: Blocked output has disclaimer');
}

// ══════════════════════════════════════════════════════════════════════════════
//  RL SIGN NORMALIZATION TEST
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== RL Sign Normalization ===');
{
  // Books report mixed signs: -1.5 and +1.5
  const snaps = [
    snap('draftkings', -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, 100, 1.5,  7, '2026-03-26T10:00:00Z'),  // opposite sign
    snap('espnbet',   -120, 100, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('pinnacle',  -115, 100, 1.5,  7, '2026-03-26T10:00:00Z'),  // opposite sign
  ];

  const truth = buildMlbTruth(snaps, 'Home', 'Away', '2026-03-26T18:00:00Z');
  assertEqual(truth.run_line.favorite_rl, -1.5, 'RL1: Favorite always -1.5');
  assertEqual(truth.run_line.underdog_rl, 1.5, 'RL2: Underdog always +1.5');
  assert(truth.validation.is_valid, 'RL3: Valid despite mixed signs');
  // The truth layer normalizes signs — the HSA writer never sees the inconsistency
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
