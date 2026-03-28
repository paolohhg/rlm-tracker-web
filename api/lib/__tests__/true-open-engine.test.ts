// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine Tests — All 8 Required Cases
//
//  Run: npx tsx api/lib/__tests__/true-open-engine.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { computeTrueOpen, computeAllMarketOpens, formatTrueOpenForHSA } from '../true-open-engine';
import { classifyStructure } from '../true-open-engine/utils';
import { getMaterialMoveThreshold, BOOK_WEIGHTS } from '../true-open-engine/config';
import type { MarketSnapshot } from '../true-open-engine/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}
function assertEqual(actual: any, expected: any, name: string) {
  if (actual === expected) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function snap(book: string, value: number, ts: string): MarketSnapshot {
  return { book, value, price: -110, timestamp: ts };
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 1: True one-way totals steam
//  Open 232.5 → 230.5 with clean downward path and early data
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 1: True One-Way Totals Steam ===');
{
  const snaps = [
    snap('pinnacle', 232.5, '2026-03-25T10:00:00Z'),
    snap('draftkings', 232.5, '2026-03-25T10:00:00Z'),
    snap('fanduel', 233, '2026-03-25T10:00:00Z'),
    snap('betmgm', 232.5, '2026-03-25T10:00:00Z'),
    snap('pinnacle', 231.5, '2026-03-25T22:00:00Z'),
    snap('draftkings', 231.5, '2026-03-25T22:00:00Z'),
    snap('fanduel', 231.5, '2026-03-25T22:00:00Z'),
    snap('betmgm', 231.5, '2026-03-25T22:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T10:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T10:00:00Z'),
    snap('fanduel', 230.5, '2026-03-26T10:00:00Z'),
    snap('betmgm', 230.5, '2026-03-26T10:00:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case1', '2026-03-26T23:00:00Z');
  assertEqual(r.consensus.trueOpen, 232.5, 'C1a: True open is 232.5');
  assertEqual(r.consensus.current, 230.5, 'C1b: Current is 230.5');
  assertEqual(r.consensus.directionFromOpen, 'down', 'C1c: Direction is down');
  assertEqual(r.consensus.structure, 'one_way', 'C1d: Structure is one_way');
  assert(r.consensus.confidenceLabel === 'High', `C1e: Confidence is High (${r.consensus.confidenceLabel})`);
  assertEqual(r.diagnostics.booksWithTrueOpen, 4, 'C1f: 4 books with open');
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 2: Reversal
//  Open 229.5 → 232.5 → 230.5
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 2: Reversal ===');
{
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-25T08:00:00Z'),
    snap('draftkings', 229.5, '2026-03-25T08:00:00Z'),
    snap('fanduel', 230, '2026-03-25T08:00:00Z'),
    snap('betmgm', 229.5, '2026-03-25T08:00:00Z'),
    snap('pinnacle', 231.5, '2026-03-25T20:00:00Z'),
    snap('draftkings', 232, '2026-03-25T20:00:00Z'),
    snap('fanduel', 232.5, '2026-03-25T20:00:00Z'),
    snap('betmgm', 232, '2026-03-25T20:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T10:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T10:00:00Z'),
    snap('fanduel', 230.5, '2026-03-26T10:00:00Z'),
    snap('betmgm', 231, '2026-03-26T10:00:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case2', '2026-03-26T23:00:00Z');
  assertEqual(r.consensus.trueOpen, 229.5, 'C2a: True open is 229.5');
  assertEqual(r.consensus.current, 230.5, 'C2b: Current is 230.5');
  assertEqual(r.consensus.structure, 'reversal', 'C2c: Structure is reversal');
  assert(r.diagnostics.flags.includes('PATH_INDICATES_REVERSAL'), 'C2d: REVERSAL flag');
  assert(r.consensus.pathString != null, 'C2e: Path string exists');
  console.log(`  → Path: ${r.consensus.pathString}`);
  console.log(`  → High: ${r.consensus.marketHigh}, Low: ${r.consensus.marketLow}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 3: Whipsaw
//  229.5 → 231.5 → 230.0 → 232.0 → 230.5
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 3: Whipsaw ===');
{
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-25T08:00:00Z'),
    snap('draftkings', 229.5, '2026-03-25T08:00:00Z'),
    snap('pinnacle', 231.5, '2026-03-25T14:00:00Z'),
    snap('draftkings', 231.5, '2026-03-25T14:00:00Z'),
    snap('pinnacle', 230, '2026-03-25T20:00:00Z'),
    snap('draftkings', 230, '2026-03-25T20:00:00Z'),
    snap('pinnacle', 232, '2026-03-26T02:00:00Z'),
    snap('draftkings', 232, '2026-03-26T02:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T10:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T10:00:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case3', '2026-03-26T23:00:00Z');
  assertEqual(r.consensus.trueOpen, 229.5, 'C3a: True open is 229.5');
  assertEqual(r.consensus.structure, 'whipsaw', 'C3b: Structure is whipsaw');
  assert(r.diagnostics.flags.includes('PATH_INDICATES_WHIPSAW'), 'C3c: WHIPSAW flag');
  console.log(`  → Path: ${r.consensus.pathString}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 4: Tracker started late
//  First seen 232.5, later low 230.5, no trusted early data
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 4: Tracker Started Late ===');
{
  const snaps = [
    snap('draftkings', 232.5, '2026-03-26T22:00:00Z'),
    snap('fanduel', 232.5, '2026-03-26T22:00:00Z'),
    snap('draftkings', 231, '2026-03-26T22:30:00Z'),
    snap('fanduel', 231, '2026-03-26T22:30:00Z'),
    snap('draftkings', 230.5, '2026-03-26T22:45:00Z'),
    snap('fanduel', 230.5, '2026-03-26T22:45:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case4', '2026-03-26T23:00:00Z');
  // 3 snaps per book, 1h before game — reconstructed or fallback
  assert(r.byBook.some(b => b.sourceMethod !== 'direct_earliest'), 'C4a: Not all direct_earliest');
  assert(r.consensus.reliability < 85, `C4b: Reliability reduced (${r.consensus.reliability})`);
  assert(r.consensus.confidenceLabel !== 'High', `C4c: Not high confidence (${r.consensus.confidenceLabel})`);
  assert(r.diagnostics.trackerStartDelayMinutes != null && r.diagnostics.trackerStartDelayMinutes > 0,
    `C4d: Tracker delay detected (${r.diagnostics.trackerStartDelayMinutes} min)`);
  console.log(`  → Reliability: ${r.consensus.reliability}%, Label: ${r.consensus.confidenceLabel}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 5: Mixed book opens
//  Pinnacle 233.0, DK 233.5, FD 232.5, etc.
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 5: Mixed Book Opens ===');
{
  const snaps = [
    snap('pinnacle', 233.0, '2026-03-25T08:00:00Z'),
    snap('draftkings', 233.5, '2026-03-25T08:02:00Z'),
    snap('fanduel', 232.5, '2026-03-25T08:05:00Z'),
    snap('betmgm', 233, '2026-03-25T08:10:00Z'),
    snap('espnbet', 233, '2026-03-25T08:15:00Z'),
    snap('pinnacle', 232, '2026-03-26T14:00:00Z'),
    snap('draftkings', 232, '2026-03-26T14:00:00Z'),
    snap('fanduel', 232, '2026-03-26T14:00:00Z'),
    snap('betmgm', 232, '2026-03-26T14:00:00Z'),
    snap('espnbet', 232, '2026-03-26T14:00:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case5', '2026-03-26T23:00:00Z');
  // Consensus should be 233 (MODE of [233.0, 233.5, 232.5, 233, 233])
  assertEqual(r.consensus.trueOpen, 233, 'C5a: Consensus open is 233 (MODE)');
  assertEqual(r.consensus.trueOpenRange.low, 232.5, 'C5b: Open range low is 232.5');
  assertEqual(r.consensus.trueOpenRange.high, 233.5, 'C5c: Open range high is 233.5');
  // Pinnacle should have weight 1.5, DK 1.15, etc.
  const pinnBook = r.byBook.find(b => b.book === 'pinnacle');
  assert(pinnBook?.isSharpBook === true, 'C5d: Pinnacle marked sharp');
  assert(pinnBook?.trueOpen === 233.0, 'C5e: Pinnacle open is 233.0');
  assert(r.diagnostics.sharpBooksWithTrueOpen >= 1, 'C5f: Sharp book has open');
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 6: Missing sharp book open
//  No Pinnacle early data, only retail books
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 6: Missing Sharp Book Open ===');
{
  const snaps = [
    snap('draftkings', 220, '2026-03-25T10:00:00Z'),
    snap('fanduel', 220.5, '2026-03-25T10:00:00Z'),
    snap('betmgm', 220, '2026-03-25T10:00:00Z'),
    snap('draftkings', 218, '2026-03-26T14:00:00Z'),
    snap('fanduel', 218.5, '2026-03-26T14:00:00Z'),
    snap('betmgm', 218, '2026-03-26T14:00:00Z'),
  ];

  const r = computeTrueOpen(snaps, 'total', 'NBA', 'case6', '2026-03-26T23:00:00Z');
  assert(r.diagnostics.flags.includes('NO_SHARP_BOOK_OPEN'), 'C6a: NO_SHARP_BOOK_OPEN flag');
  assertEqual(r.diagnostics.sharpBooksWithTrueOpen, 0, 'C6b: 0 sharp books');
  assert(r.consensus.trueOpen != null, 'C6c: Still has consensus (from retail)');
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 7: Moneyline market path reconstruction
//  MLB: -135 → -120 (home ML)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 7: MLB Moneyline ===');
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

  const r = computeTrueOpen(snaps, 'moneyline', 'MLB', 'MLB|NYM|PIT', '2026-03-26T16:15:00Z', 'home');
  assertEqual(r.consensus.trueOpen, -135, 'C7a: ML true open is -135');
  assertEqual(r.consensus.current, -120, 'C7b: ML current is -120');
  assertEqual(r.consensus.directionFromOpen, 'up', 'C7c: Direction up (less negative)');
  assert(r.diagnostics.sharpBooksWithTrueOpen >= 1, 'C7d: Sharp book has open');

  // Pinnacle's individual open
  const pinn = r.byBook.find(b => b.book === 'pinnacle');
  assertEqual(pinn?.trueOpen, -128, 'C7e: Pinnacle opened at -128');
  assertEqual(pinn?.current, -112, 'C7f: Pinnacle current at -112');

  // Per-book detail preserved
  assert(r.byBook.length === 5, 'C7g: 5 books tracked individually');

  console.log(`  → Open range: ${r.consensus.trueOpenRange.low} to ${r.consensus.trueOpenRange.high}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 8: Future league config
//  Dummy league added without touching engine core
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 8: Future League (WNBA) ===');
{
  const snaps = [
    snap('draftkings', 160, '2026-03-25T10:00:00Z'),
    snap('fanduel', 160.5, '2026-03-25T10:00:00Z'),
    snap('draftkings', 158, '2026-03-26T14:00:00Z'),
    snap('fanduel', 158, '2026-03-26T14:00:00Z'),
  ];

  // WNBA just works — no engine changes needed
  const r = computeTrueOpen(snaps, 'total', 'WNBA', 'WNBA|A|B', '2026-03-26T23:00:00Z');
  // MODE of [160, 160.5] — tiebreak picks one
  assert(r.consensus.trueOpen === 160 || r.consensus.trueOpen === 160.5, `C8a: WNBA open computed (${r.consensus.trueOpen})`);
  assertEqual(r.consensus.current, 158, 'C8b: WNBA current computed');
  assertEqual(r.league, 'WNBA', 'C8c: League is WNBA');
  assert(r.consensus.structure !== 'unknown', `C8d: Structure classified (${r.consensus.structure})`);

  // Verify WNBA threshold exists in config
  const threshold = getMaterialMoveThreshold('total', 'WNBA');
  assert(threshold > 0, `C8e: WNBA threshold exists (${threshold})`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 9: Empty input
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 9: Empty Input ===');
{
  const r = computeTrueOpen([], 'spread', 'NFL', 'empty', null);
  assertEqual(r.consensus.trueOpen, null, 'C9a: No open');
  assertEqual(r.consensus.confidenceLabel, 'Unreliable', 'C9b: Unreliable');
  assert(r.diagnostics.flags.includes('INSUFFICIENT_HISTORY'), 'C9c: INSUFFICIENT_HISTORY');
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 10: HSA Format — reliability-aware language
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 10: HSA Format Output ===');
{
  // High reliability
  const snaps = [
    snap('pinnacle', 229.5, '2026-03-25T08:00:00Z'),
    snap('draftkings', 229.5, '2026-03-25T08:00:00Z'),
    snap('fanduel', 229.5, '2026-03-25T08:00:00Z'),
    snap('pinnacle', 232.5, '2026-03-26T00:00:00Z'),
    snap('draftkings', 232.5, '2026-03-26T00:00:00Z'),
    snap('fanduel', 232.5, '2026-03-26T00:00:00Z'),
    snap('pinnacle', 230.5, '2026-03-26T14:00:00Z'),
    snap('draftkings', 230.5, '2026-03-26T14:00:00Z'),
    snap('fanduel', 230.5, '2026-03-26T14:00:00Z'),
  ];
  const rHigh = computeTrueOpen(snaps, 'total', 'NBA', 'fmt1', '2026-03-26T23:00:00Z');
  const fmtHigh = formatTrueOpenForHSA(rHigh);
  assert(fmtHigh.includes('True Open:'), 'C10a: High reliability shows "True Open:"');
  assert(!fmtHigh.includes('Estimated'), 'C10b: Not estimated');

  // Low reliability (tracker late)
  const lateSnaps = [
    snap('draftkings', 230, '2026-03-26T22:30:00Z'),
    snap('draftkings', 229, '2026-03-26T22:45:00Z'),
  ];
  const rLow = computeTrueOpen(lateSnaps, 'total', 'NBA', 'fmt2', '2026-03-26T23:00:00Z');
  const fmtLow = formatTrueOpenForHSA(rLow);
  // Should use qualified language when reliability is low
  assert(fmtLow.includes('Estimated') || fmtLow.includes('unreliable') || fmtLow.includes('Observed'),
    'C10c: Low reliability uses qualified language');

  console.log(`\n  High-reliability output:\n  ${fmtHigh.split('\n').join('\n  ')}`);
  console.log(`\n  Low-reliability output:\n  ${fmtLow.split('\n').join('\n  ')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 11: Book weights are configurable
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 11: Book Weights Config ===');
{
  assert(BOOK_WEIGHTS.pinnacle === 1.5, 'C11a: Pinnacle weight is 1.5');
  assert(BOOK_WEIGHTS.draftkings === 1.15, 'C11b: DraftKings weight is 1.15');
  assert(BOOK_WEIGHTS.fanduel === 1.1, 'C11c: FanDuel weight is 1.1');
  assert(BOOK_WEIGHTS.betmgm === 1.0, 'C11d: BetMGM weight is 1.0');
  assert(BOOK_WEIGHTS.espnbet === 0.95, 'C11e: ESPNBet weight is 0.95');
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASE 12: classifyStructure uses league-aware thresholds
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Case 12: League-Aware Thresholds ===');
{
  // MLB total: threshold is 0.5
  const mlbPath = [7, 7.5, 7]; // 0.5-pt moves = material for MLB
  assertEqual(classifyStructure(mlbPath, 'total', 'MLB'), 'reversal', 'C12a: MLB 0.5-pt total move = reversal');

  // NBA total: threshold is 1.0
  const nbaPath = [220, 220.5, 220]; // 0.5-pt moves = NOT material for NBA
  assertEqual(classifyStructure(nbaPath, 'total', 'NBA'), 'range_bound', 'C12b: NBA 0.5-pt total move = range_bound');

  // NBA total with larger moves
  const nbaPath2 = [220, 222, 220]; // 2-pt moves = material for NBA
  assertEqual(classifyStructure(nbaPath2, 'total', 'NBA'), 'reversal', 'C12c: NBA 2-pt total move = reversal');
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
