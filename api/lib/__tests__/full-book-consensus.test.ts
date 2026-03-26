// ══════════════════════════════════════════════════════════════════════════════
//  FULL_BOOK_CONSENSUS Signal Regression Tests
//
//  Run: npx tsx api/lib/__tests__/full-book-consensus.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { classifySignal } from '../signal-engine/classify/signal-classifier';
import { scoreSignal } from '../signal-engine/score/confidence-scorer';
import type { MarketState, NormalizedBook, PublicData } from '../signal-engine/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function assertEqual(actual: any, expected: any, testName: string) {
  const pass = actual === expected;
  if (pass) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBook(
  book: string,
  openLine: number,
  currentLine: number,
  tier: 'TIER_1_SHARP' | 'TIER_3_RETAIL_MAJOR' = 'TIER_3_RETAIL_MAJOR',
  timestamp = '2026-03-26T14:00:00Z',
): NormalizedBook {
  return {
    book,
    tier,
    weight: tier === 'TIER_1_SHARP' ? 3.0 : 1.0,
    display_name: book,
    open_line: openLine,
    current_line: currentLine,
    move: currentLine - openLine,
    first_seen: '2026-03-26T12:00:00Z',
    last_seen: timestamp,
  };
}

function makeState(overrides: Partial<MarketState>): MarketState {
  const books = overrides.books ?? [];
  const movedBooks = books.filter(b => Math.abs(b.move) > 0.01);
  const heldBooks = books.filter(b => Math.abs(b.move) <= 0.01);

  return {
    game_key: 'TEST|Home|Away|2026-03-26',
    league: 'NBA',
    home_team: 'Home Team',
    away_team: 'Away Team',
    game_time: '2026-03-26T19:00:00Z',
    market_type: 'spread',
    opener: 0,
    current: 0,
    move: 0,
    books: [],
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
    velocity: 0,
    hours_tracked: 4,
    books_moved_consensus: movedBooks,
    books_held: heldBooks,
    total_books: books.length,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 1: 5 books move within 30 minutes → MUST trigger
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 1: 5 books move within 30 min → trigger ===');
{
  const books = [
    makeBook('Pinnacle', -5.5, -4.5, 'TIER_1_SHARP', '2026-03-26T13:00:00Z'),
    makeBook('DraftKings', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('FanDuel', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:15:00Z'),
    makeBook('BetMGM', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
    makeBook('ESPNBet', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:30:00Z'),
  ];

  const state = makeState({
    books,
    opener: -5.5,
    current: -4.5,
    move: 1.0,
    velocity: 2.0,
    public_data: { home_ticket_pct: 65, away_ticket_pct: 35, home_money_pct: 60, away_money_pct: 40 },
  });

  const classification = classifySignal(state);
  assertEqual(classification.type, 'FULL_BOOK_CONSENSUS', '1a: Signal type is FULL_BOOK_CONSENSUS');
  assert(classification.factors.some(f => f.includes('All 5 tracked books')), '1b: Factors mention all 5 books');
  assert(classification.factors.some(f => f.includes('Sharp book')), '1c: Sharp book leadership detected');

  const scored = scoreSignal(state, classification);
  assert(scored.score >= 55, `1d: Score (${scored.score}) meets FBC floor (55)`);
  assert(scored.explanation.some(e => e.includes('Full Book Consensus')), '1e: Explanation mentions FBC');
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 2: 5 books move over 4 hours → should NOT trigger
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 2: 5 books move over 4 hours → should NOT trigger ===');
{
  const books = [
    makeBook('Pinnacle', -5.5, -4.5, 'TIER_1_SHARP', '2026-03-26T10:00:00Z'),
    makeBook('DraftKings', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T11:00:00Z'),
    makeBook('FanDuel', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T12:00:00Z'),
    makeBook('BetMGM', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:00:00Z'),
    makeBook('ESPNBet', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T14:00:00Z'),
  ];

  const state = makeState({
    books,
    opener: -5.5,
    current: -4.5,
    move: 1.0,
    velocity: 0.25,
    hours_tracked: 4,
  });

  const classification = classifySignal(state);
  assert(classification.type !== 'FULL_BOOK_CONSENSUS', `2a: Signal type is NOT FBC (got ${classification.type})`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 3: Only 3 books move → should NOT trigger
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 3: Only 3 books move → should NOT trigger ===');
{
  const books = [
    makeBook('DraftKings', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:00:00Z'),
    makeBook('FanDuel', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('BetMGM', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
    makeBook('Pinnacle', -5.5, -5.5, 'TIER_1_SHARP', '2026-03-26T13:30:00Z'),  // held
    makeBook('ESPNBet', -5.5, -5.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:30:00Z'),  // held
  ];

  const state = makeState({
    books,
    opener: -5.5,
    current: -4.5,
    move: 1.0,
    velocity: 2.0,
  });

  const classification = classifySignal(state);
  assert(classification.type !== 'FULL_BOOK_CONSENSUS', `3a: Signal type is NOT FBC (got ${classification.type})`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 4: FBC against public → elite signal with high score
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 4: FBC against public → elite signal ===');
{
  const books = [
    makeBook('Pinnacle', -5.5, -4.5, 'TIER_1_SHARP', '2026-03-26T13:00:00Z'),
    makeBook('DraftKings', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('FanDuel', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:15:00Z'),
    makeBook('BetMGM', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
    makeBook('ESPNBet', -5.5, -4.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:25:00Z'),
  ];

  // Public is on home team (65%), but line moved AWAY from home (+1.0 = toward away)
  const state = makeState({
    books,
    opener: -5.5,
    current: -4.5,
    move: 1.0,
    velocity: 2.0,
    public_data: { home_ticket_pct: 65, away_ticket_pct: 35, home_money_pct: 70, away_money_pct: 30 },
  });

  const classification = classifySignal(state);
  assertEqual(classification.type, 'FULL_BOOK_CONSENSUS', '4a: Signal type is FULL_BOOK_CONSENSUS');
  assert(classification.factors.some(f => f.includes('OPPOSED') || f.includes('elite')), '4b: Public opposition noted');

  const scored = scoreSignal(state, classification);
  assert(scored.score >= 80, `4c: Elite score (${scored.score}) is ≥80`);
  assertEqual(scored.confidence, 'HIGH', '4d: Confidence is HIGH');
  assert(scored.explanation.some(e => e.includes('against public')), '4e: Against-public boost applied');
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 5: 4 books move (minimum threshold) → should still trigger
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 5: 4 books move (minimum) → should trigger ===');
{
  const books = [
    makeBook('DraftKings', -3, -2, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:00:00Z'),
    makeBook('FanDuel', -3, -2, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('BetMGM', -3, -2, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
    makeBook('ESPNBet', -3, -2, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:30:00Z'),
  ];

  const state = makeState({
    books,
    opener: -3,
    current: -2,
    move: 1.0,
    velocity: 2.0,
  });

  const classification = classifySignal(state);
  assertEqual(classification.type, 'FULL_BOOK_CONSENSUS', '5a: 4 books triggers FBC');
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 6: FBC with public aligned → MARKET_AGREEMENT overlay
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 6: FBC with public aligned → MARKET_AGREEMENT overlay ===');
{
  const books = [
    makeBook('Pinnacle', -5.5, -6.5, 'TIER_1_SHARP', '2026-03-26T13:00:00Z'),
    makeBook('DraftKings', -5.5, -6.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('FanDuel', -5.5, -6.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:15:00Z'),
    makeBook('BetMGM', -5.5, -6.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
    makeBook('ESPNBet', -5.5, -6.5, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:25:00Z'),
  ];

  // Move toward home (-1.0), public also on home (65%) = aligned
  const state = makeState({
    books,
    opener: -5.5,
    current: -6.5,
    move: -1.0,
    velocity: 2.0,
    public_data: { home_ticket_pct: 65, away_ticket_pct: 35, home_money_pct: 60, away_money_pct: 40 },
  });

  const classification = classifySignal(state);
  assertEqual(classification.type, 'FULL_BOOK_CONSENSUS', '6a: Signal type is FBC');
  assert(classification.factors.some(f => f.includes('aligned') || f.includes('MARKET_AGREEMENT')), '6b: Public alignment noted');
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 7: MLB moneyline FBC
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Test 7: MLB moneyline FBC ===');
{
  const books = [
    makeBook('Pinnacle', -130, -150, 'TIER_1_SHARP', '2026-03-26T13:00:00Z'),
    makeBook('DraftKings', -130, -145, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:10:00Z'),
    makeBook('FanDuel', -130, -148, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:15:00Z'),
    makeBook('BetMGM', -130, -150, 'TIER_3_RETAIL_MAJOR', '2026-03-26T13:20:00Z'),
  ];

  const state = makeState({
    league: 'MLB',
    market_type: 'moneyline',
    books,
    opener: -130,
    current: -150,
    move: -20,
    velocity: 5.0,
  });

  const classification = classifySignal(state);
  assertEqual(classification.type, 'FULL_BOOK_CONSENSUS', '7a: MLB ML FBC detected');
  assert(classification.factors.some(f => f.includes('All 4')), '7b: All 4 books mentioned');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`FULL_BOOK_CONSENSUS Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All FULL_BOOK_CONSENSUS tests passed');
}
