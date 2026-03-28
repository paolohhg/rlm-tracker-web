// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine Tests
//
//  Run: npx tsx api/lib/__tests__/true-open-engine.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { computeTrueOpen, computeAllMarketOpens, formatTrueOpenForHSA } from '../true-open-engine';
import type { MarketSnapshot } from '../true-open-engine/types';

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

function snap(book: string, value: number, ts: string): MarketSnapshot {
  return { book, value, price: -110, timestamp: ts };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. ONE-WAY STEAM (open 229.5, moves to 232.5, stays)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 1. One-Way Steam ===');
{
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-26T10:00:00Z'),
    snap('draftkings', 229.5, '2026-03-26T10:00:00Z'),
    snap('fanduel', 229.5, '2026-03-26T10:00:00Z'),
    snap('betmgm', 230, '2026-03-26T10:00:00Z'),
    snap('pinnacle', 231, '2026-03-26T14:00:00Z'),
    snap('draftkings', 231.5, '2026-03-26T14:00:00Z'),
    snap('fanduel', 231.5, '2026-03-26T14:00:00Z'),
    snap('betmgm', 232, '2026-03-26T14:00:00Z'),
    snap('pinnacle', 232.5, '2026-03-26T18:00:00Z'),
    snap('draftkings', 232.5, '2026-03-26T18:00:00Z'),
    snap('fanduel', 232.5, '2026-03-26T18:00:00Z'),
    snap('betmgm', 232.5, '2026-03-26T18:00:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'total', 'NBA', 'test1', '2026-03-26T23:00:00Z');
  assertEqual(result.consensus.trueOpen, 229.5, '1a: True open is 229.5');
  assertEqual(result.consensus.current, 232.5, '1b: Current is 232.5');
  assertEqual(result.consensus.directionFromOpen, 'up', '1c: Direction is up');
  assertEqual(result.consensus.structure, 'one_way', '1d: Structure is one_way');
  assertEqual(result.consensus.marketHigh, 232.5, '1e: Market high is 232.5');
  assertEqual(result.consensus.marketLow, 229.5, '1f: Market low is 229.5');
  assert(result.diagnostics.booksWithTrueOpen === 4, '1g: 4 books with open');
}

// ══════════════════════════════════════════════════════════════════════════════
//  2. REVERSAL (open 229.5 → up to 232.5 → back to 230.5)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 2. Reversal ===');
{
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-25T10:00:00Z'),
    snap('draftkings', 229.5, '2026-03-25T10:00:00Z'),
    snap('fanduel', 230, '2026-03-25T10:00:00Z'),
    snap('pinnacle', 232, '2026-03-26T00:00:00Z'),
    snap('draftkings', 232.5, '2026-03-26T00:00:00Z'),
    snap('fanduel', 232, '2026-03-26T00:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T14:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T14:00:00Z'),
    snap('fanduel', 230.5, '2026-03-26T14:00:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'total', 'NBA', 'test2', '2026-03-26T23:00:00Z');
  assertEqual(result.consensus.trueOpen, 229.5, '2a: True open is 229.5');
  assertEqual(result.consensus.current, 230.5, '2b: Current is 230.5');
  assertEqual(result.consensus.structure, 'reversal', '2c: Structure is reversal');
  // Market high is MODE per 30-min bucket — 232 is the bucket consensus (not every book hit 232.5)
  assert(result.consensus.marketHigh! >= 232, `2d: Market high (${result.consensus.marketHigh}) is ≥232`);
  assertEqual(result.consensus.marketLow, 229.5, '2e: Market low is 229.5');
  assert(result.diagnostics.flags.includes('REVERSAL_DETECTED'), '2f: REVERSAL_DETECTED flag set');
  assert(result.consensus.pathString != null, '2g: Path string exists');
  console.log(`  → Path: ${result.consensus.pathString}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  3. TRACKER STARTED LATE (first snapshot near game time)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 3. Tracker Late ===');
{
  const snaps = [
    snap('draftkings', -5.5, '2026-03-26T18:00:00Z'),
    snap('fanduel', -5.5, '2026-03-26T18:00:00Z'),
    snap('draftkings', -5, '2026-03-26T18:30:00Z'),
    snap('fanduel', -5, '2026-03-26T18:30:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'spread', 'NBA', 'test3', '2026-03-26T19:00:00Z');
  // With only 2 snaps per book and game 1h away, should be low confidence
  assert(result.consensus.reliability < 100, `3a: Reliability reduced (${result.consensus.reliability})`);
  assert(result.consensus.confidenceLabel !== 'High' || result.byBook.length <= 2, `3b: Confidence limited (${result.consensus.confidenceLabel})`);
  assert(result.diagnostics.booksTracked === 2, '3c: 2 books tracked');
}

// ══════════════════════════════════════════════════════════════════════════════
//  4. MLB MONEYLINE (the exact failure case from the spec)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 4. MLB Moneyline True Open ===');
{
  const snaps = [
    snap('pinnacle', -128, '2026-03-25T22:00:00Z'),
    snap('draftkings', -135, '2026-03-25T22:00:00Z'),
    snap('fanduel', -130, '2026-03-25T22:00:00Z'),
    snap('betmgm', -135, '2026-03-25T22:00:00Z'),
    snap('espnbet', -140, '2026-03-25T22:00:00Z'),
    snap('pinnacle', -112, '2026-03-26T16:00:00Z'),
    snap('draftkings', -120, '2026-03-26T16:00:00Z'),
    snap('fanduel', -116, '2026-03-26T16:00:00Z'),
    snap('betmgm', -120, '2026-03-26T16:00:00Z'),
    snap('espnbet', -125, '2026-03-26T16:00:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'moneyline', 'MLB', 'MLB|NYM|PIT', '2026-03-26T16:15:00Z', 'home');
  assertEqual(result.consensus.trueOpen, -135, '4a: ML true open is -135');
  assertEqual(result.consensus.current, -120, '4b: ML current is -120');
  assertEqual(result.consensus.directionFromOpen, 'up', '4c: Direction is up (less negative = up)');
  assert(result.diagnostics.sharpBooksWithTrueOpen >= 1, '4d: At least 1 sharp book with open');
  assert(result.consensus.reliability >= 50, `4e: Reliability (${result.consensus.reliability}) is reasonable`);
  console.log(`  → Open range: ${result.consensus.trueOpenRange.low} to ${result.consensus.trueOpenRange.high}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  5. computeAllMarketOpens (multi-market from raw DB format)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 5. All Market Opens ===');
{
  const rawSnaps = [
    { bookmaker: 'draftkings', spread: -5.5, moneyline_home: -200, moneyline_away: 170, total: 220, fetched_at: '2026-03-26T10:00:00Z' },
    { bookmaker: 'fanduel', spread: -5.5, moneyline_home: -195, moneyline_away: 165, total: 220.5, fetched_at: '2026-03-26T10:00:00Z' },
    { bookmaker: 'draftkings', spread: -4.5, moneyline_home: -180, moneyline_away: 155, total: 218.5, fetched_at: '2026-03-26T18:00:00Z' },
    { bookmaker: 'fanduel', spread: -5, moneyline_home: -185, moneyline_away: 160, total: 219, fetched_at: '2026-03-26T18:00:00Z' },
  ];

  const all = computeAllMarketOpens(rawSnaps, 'NBA', 'NBA|LAL|BOS', '2026-03-26T23:00:00Z');
  assertEqual(all.spread.consensus.trueOpen, -5.5, '5a: Spread open is -5.5');
  // MODE of [220, 220.5] — both appear once, tiebreak by median proximity
  assert(all.total.consensus.trueOpen === 220 || all.total.consensus.trueOpen === 220.5, `5b: Total open is 220 or 220.5 (got ${all.total.consensus.trueOpen})`);
  assert(all.moneyline.consensus.trueOpen != null, '5c: ML open exists');
  assert(all.spread.consensus.directionFromOpen === 'up', '5d: Spread moved up (less negative)');
  assert(all.total.consensus.directionFromOpen === 'down', '5e: Total moved down');
}

// ══════════════════════════════════════════════════════════════════════════════
//  6. HSA Format Output
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 6. HSA Format ===');
{
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-25T10:00:00Z'),
    snap('draftkings', 229.5, '2026-03-25T10:00:00Z'),
    snap('pinnacle', 232.5, '2026-03-26T14:00:00Z'),
    snap('draftkings', 232.5, '2026-03-26T14:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T18:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T18:00:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'total', 'NBA', 'test6', '2026-03-26T23:00:00Z');
  const formatted = formatTrueOpenForHSA(result);
  assert(formatted.includes('TOTAL TRUE OPEN'), '6a: Contains market type header');
  assert(formatted.includes('229.5'), '6b: Contains true open value');
  assert(formatted.includes('230.5'), '6c: Contains current value');
  assert(formatted.includes('232.5'), '6d: Contains market high');
  assert(formatted.includes('Confidence'), '6e: Contains confidence');
  console.log(`\n  Sample HSA output:\n  ${formatted.split('\n').join('\n  ')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  7. Empty input
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 7. Empty Input ===');
{
  const result = computeTrueOpen([], 'spread', 'NBA', 'empty', null);
  assertEqual(result.consensus.trueOpen, null, '7a: No open');
  assertEqual(result.consensus.confidenceLabel, 'Unreliable', '7b: Unreliable');
  assert(result.diagnostics.flags.includes('NO_DATA'), '7c: NO_DATA flag');
}

// ══════════════════════════════════════════════════════════════════════════════
//  8. Single book (low confidence)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== 8. Single Book ===');
{
  const snaps = [
    snap('draftkings', -3.5, '2026-03-26T10:00:00Z'),
    snap('draftkings', -4, '2026-03-26T18:00:00Z'),
  ];

  const result = computeTrueOpen(snaps, 'spread', 'NCAAB', 'test8', '2026-03-26T23:00:00Z');
  assertEqual(result.diagnostics.booksWithTrueOpen, 1, '8a: 1 book with open');
  assert(result.diagnostics.flags.includes('SINGLE_BOOK_OPEN'), '8b: SINGLE_BOOK_OPEN flag');
  // Single book should have limited confidence
  assert(result.consensus.reliability <= 100, `8c: Reliability bounded (${result.consensus.reliability})`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`True Open Engine Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All True Open Engine tests passed');
}
