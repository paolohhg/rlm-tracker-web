// ══════════════════════════════════════════════════════════════════════════════
//  Signal Engine V2 — Comprehensive Test Suite
//
//  Tests:
//    1. Spread direction correctness
//    2. RLM detection
//    3. Steam detection
//    4. Market agreement
//    5. Book disagreement
//    6. Frozen line
//    7. Fake steam / retrace
//    8. Book tier weighting
//    9. Missing data robustness
//   10. League config correctness
// ══════════════════════════════════════════════════════════════════════════════

import {
  analyzeMarket,
  buildMarketState,
  classifySignal,
  scoreSignal,
  buildDirectionalMove,
  getBookConfig,
  isSharpBook,
  getBooksByTier,
  getLeagueConfig,
  getMarketThresholds,
  isMLPrimary,
  detectLeaderFollower,
  computeBookDisagreement,
  computeWeightedCoordination,
  isSharpLed,
} from '../index';
import type { MarketState, NormalizedBook, PublicData, MarketSnapshot } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeBook(
  book: string,
  openLine: number,
  currentLine: number,
  timestamp?: string,
): NormalizedBook {
  const config = getBookConfig(book);
  return {
    book,
    tier: config.tier,
    weight: config.weight,
    display_name: config.display_name,
    open_line: openLine,
    current_line: currentLine,
    move: currentLine - openLine,
    first_seen: '2026-03-25T10:00:00Z',
    last_seen: timestamp ?? '2026-03-25T12:00:00Z',
  };
}

function makeState(overrides: Partial<MarketState>): MarketState {
  const defaults: MarketState = {
    game_key: 'test_game',
    league: 'NBA',
    home_team: 'Suns',
    away_team: 'Nuggets',
    game_time: '2026-03-25T19:00:00Z',
    market_type: 'spread',
    opener: -4.5,
    current: -4.5,
    move: 0,
    books: [],
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
    velocity: 0,
    hours_tracked: 4,
    books_moved_consensus: [],
    books_held: [],
    total_books: 0,
  };
  return { ...defaults, ...overrides };
}

function makeSnapshots(
  bookLines: Array<{ book: string; spread: number; time: string }>,
): MarketSnapshot[] {
  return bookLines.map(bl => ({
    book: bl.book,
    spread: bl.spread,
    spread_home_price: -110,
    moneyline_home: -150,
    moneyline_away: 130,
    total: 220,
    total_over_price: -110,
    fetched_at: bl.time,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 1: Spread Direction Correctness
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 1: Spread Direction Correctness ===');

// Case 1a: Underdog spread gets worse: +4.5 → +6.5 = away from underdog / toward favorite
{
  const state = makeState({
    home_team: 'Suns', away_team: 'Nuggets',
    opener: 4.5, current: 6.5, move: 2.0,
    market_type: 'spread',
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Nuggets', '+4.5 → +6.5: toward_team = Nuggets (away)');
  assertEq(dir.away_from_team, 'Suns', '+4.5 → +6.5: away_from = Suns (home underdog)');
  assert(
    dir.description.includes('against') && dir.description.includes('Suns'),
    '+4.5 → +6.5: description mentions against Suns',
  );
}

// Case 1b: Underdog spread improves: +6.5 → +4.5 = toward underdog
{
  const state = makeState({
    home_team: 'Suns', away_team: 'Nuggets',
    opener: 6.5, current: 4.5, move: -2.0,
    market_type: 'spread',
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Suns', '+6.5 → +4.5: toward_team = Suns (home underdog)');
  assertEq(dir.away_from_team, 'Nuggets', '+6.5 → +4.5: away_from = Nuggets');
}

// Case 1c: Favorite spread improves: -4.5 → -6.5 = toward favorite
{
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -4.5, current: -6.5, move: -2.0,
    market_type: 'spread',
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Celtics', '-4.5 → -6.5: toward_team = Celtics (home fav)');
}

// Case 1d: Favorite spread worsens: -6.5 → -4.5 = away from favorite
{
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -6.5, current: -4.5, move: 2.0,
    market_type: 'spread',
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Hawks', '-6.5 → -4.5: toward_team = Hawks (away)');
  assertEq(dir.away_from_team, 'Celtics', '-6.5 → -4.5: away_from = Celtics (home fav)');
}

// Case 1e: No movement
{
  const state = makeState({
    opener: -4.5, current: -4.5, move: 0,
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, '', 'No movement: toward_team is empty');
  assert(dir.description.includes('no movement'), 'No movement: description says no movement');
}

// Case 1f: Total movement
{
  const state = makeState({
    market_type: 'total',
    opener: 220, current: 222, move: 2,
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Over', 'Total 220 → 222: toward Over');
}

{
  const state = makeState({
    market_type: 'total',
    opener: 220, current: 218, move: -2,
  });
  const dir = buildDirectionalMove(state);
  assertEq(dir.toward_team, 'Under', 'Total 220 → 218: toward Under');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 2: RLM Detection
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 2: RLM Detection ===');

// Case 2a: Public on Team A, line moves toward Team B → RLM
{
  const books = [
    makeBook('draftkings', -4.5, -3.5),
    makeBook('fanduel', -4.5, -3.5),
    makeBook('betmgm', -4.5, -3.5),
    makeBook('caesars', -4.5, -4.5),
  ];
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -4.5, current: -3.5, move: 1.0,
    books,
    books_moved_consensus: books.slice(0, 3),
    books_held: books.slice(3),
    total_books: 4,
    velocity: 0.5,
    public_data: {
      home_ticket_pct: 65, away_ticket_pct: 35,
      home_money_pct: 60, away_money_pct: 40,
    },
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'REVERSE_LINE_MOVEMENT', '65% public on Celtics, line moves away from Celtics → RLM');
  assert(classification.factors.length > 0, 'RLM has factors');
  assert(classification.factors[0].includes('Celtics'), 'RLM factors mention Celtics');
}

// Case 2b: Public on Team A, line moves WITH Team A → NOT RLM
{
  const books = [
    makeBook('draftkings', -4.5, -5.5),
    makeBook('fanduel', -4.5, -5.5),
    makeBook('betmgm', -4.5, -5.5),
  ];
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -4.5, current: -5.5, move: -1.0,
    books,
    books_moved_consensus: books,
    books_held: [],
    total_books: 3,
    velocity: 0.5,
    public_data: {
      home_ticket_pct: 65, away_ticket_pct: 35,
      home_money_pct: 60, away_money_pct: 40,
    },
  });
  const classification = classifySignal(state);
  assert(
    classification.type !== 'REVERSE_LINE_MOVEMENT',
    'Public on Celtics + line toward Celtics = NOT RLM (got: ' + classification.type + ')',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 3: Steam Detection
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 3: Steam Detection ===');

// Case 3a: 3+ books, fast window, large move → STEAM
{
  const now = '2026-03-25T12:00:00Z';
  const books = [
    makeBook('pinnacle', -4.5, -6.0, '2026-03-25T11:45:00Z'),
    makeBook('draftkings', -4.5, -6.0, '2026-03-25T11:50:00Z'),
    makeBook('fanduel', -4.5, -6.0, '2026-03-25T11:55:00Z'),
    makeBook('betmgm', -4.5, -4.5, now),
  ];
  const state = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books,
    books_moved_consensus: books.slice(0, 3),
    books_held: books.slice(3),
    total_books: 4,
    velocity: 3.0,
    hours_tracked: 0.25,
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'STEAM_MOVE', '3 books moved 1.5 pts in 15 min → STEAM');
}

// Case 3b: Same magnitude spread across too long a window → not STEAM
{
  const books = [
    makeBook('draftkings', -4.5, -6.0, '2026-03-25T08:00:00Z'),
    makeBook('fanduel', -4.5, -6.0, '2026-03-25T10:00:00Z'),
    makeBook('betmgm', -4.5, -6.0, '2026-03-25T12:00:00Z'),
  ];
  const state = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books,
    books_moved_consensus: books,
    books_held: [],
    total_books: 3,
    velocity: 0.375, // 1.5 pts / 4 hours
    hours_tracked: 4,
  });
  const classification = classifySignal(state);
  assert(
    classification.type !== 'STEAM_MOVE',
    'Move spread over 4 hours → not STEAM (got: ' + classification.type + ')',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 4: Market Agreement
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 4: Market Agreement ===');

// Case 4a: Public, money, and line all aligned → MARKET_AGREEMENT
{
  const books = [
    makeBook('draftkings', -4.5, -5.5),
    makeBook('fanduel', -4.5, -5.5),
    makeBook('betmgm', -4.5, -5.0),
  ];
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -4.5, current: -5.5, move: -1.0,
    books,
    books_moved_consensus: books,
    books_held: [],
    total_books: 3,
    velocity: 0.3,
    public_data: {
      home_ticket_pct: 62, away_ticket_pct: 38,
      home_money_pct: 60, away_money_pct: 40,
    },
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'MARKET_AGREEMENT', 'Public + money + line aligned → MARKET_AGREEMENT');
  assert(
    classification.factors.some(f => f.includes('NOT reverse')),
    'MARKET_AGREEMENT factors clarify this is NOT RLM',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 5: Book Disagreement
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 5: Book Disagreement ===');

// Case 5a: Books showing materially different numbers
{
  const books = [
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -4.0),
    makeBook('betmgm', -4.5, -5.0),
    makeBook('caesars', -4.5, -4.0),
  ];
  const state = makeState({
    opener: -4.5, current: -5.0, move: -0.5,
    books,
    books_moved_consensus: books.filter(b => b.move < 0),
    books_held: books.filter(b => b.move >= 0),
    total_books: 4,
    velocity: 0.2,
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'BOOK_DISAGREEMENT', 'Books at -6, -4, -5, -4 → BOOK_DISAGREEMENT');
  assert(classification.disagreement.is_significant, 'Disagreement is significant');
  assertEq(classification.disagreement.max_spread, 2, 'Max disagreement = 2 pts');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 6: Frozen Line
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 6: Frozen Line ===');

// Case 6a: Public pressure but line holds
{
  const books = [
    makeBook('draftkings', -4.5, -4.5),
    makeBook('fanduel', -4.5, -4.5),
    makeBook('betmgm', -4.5, -4.5),
  ];
  const state = makeState({
    home_team: 'Celtics', away_team: 'Hawks',
    opener: -4.5, current: -4.5, move: 0,
    books,
    books_moved_consensus: [],
    books_held: books,
    total_books: 3,
    hours_tracked: 5,
    velocity: 0,
    public_data: {
      home_ticket_pct: 72, away_ticket_pct: 28,
      home_money_pct: 65, away_money_pct: 35,
    },
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'FROZEN_LINE', '72% public but no movement in 5h → FROZEN_LINE');
}

// Case 6b: Low public pressure + no movement → NOISE, not FROZEN
{
  const books = [
    makeBook('draftkings', -4.5, -4.5),
    makeBook('fanduel', -4.5, -4.5),
  ];
  const state = makeState({
    opener: -4.5, current: -4.5, move: 0,
    books,
    books_moved_consensus: [],
    books_held: books,
    total_books: 2,
    hours_tracked: 5,
    velocity: 0,
    public_data: {
      home_ticket_pct: 52, away_ticket_pct: 48,
      home_money_pct: 50, away_money_pct: 50,
    },
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'NOISE', '52% public + no movement → NOISE (not FROZEN)');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 7: Fake Steam / Retrace
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 7: Fake Steam / Retrace ===');

// Case 7a: Single book moved, others held → FAKE_STEAM
{
  const books = [
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -4.5),
    makeBook('betmgm', -4.5, -4.5),
    makeBook('caesars', -4.5, -4.5),
  ];
  const state = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books,
    books_moved_consensus: [books[0]],
    books_held: books.slice(1),
    total_books: 4,
    velocity: 1.0,
  });
  const classification = classifySignal(state);
  assertEq(classification.type, 'FAKE_STEAM', '1 book moved, 3 held → FAKE_STEAM');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 8: Book Tier Weighting
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 8: Book Tier Weighting ===');

// Case 8a: Sharp-led move scores higher than retail-led
{
  const sharpBooks = [
    makeBook('pinnacle', -4.5, -6.0),
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -6.0),
  ];
  const sharpState = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books: sharpBooks,
    books_moved_consensus: sharpBooks,
    books_held: [],
    total_books: 3,
    velocity: 1.0,
  });

  const retailBooks = [
    makeBook('espnbet', -4.5, -6.0),
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -6.0),
  ];
  const retailState = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books: retailBooks,
    books_moved_consensus: retailBooks,
    books_held: [],
    total_books: 3,
    velocity: 1.0,
  });

  const sharpClass = classifySignal(sharpState);
  const retailClass = classifySignal(retailState);
  const sharpScore = scoreSignal(sharpState, sharpClass);
  const retailScore = scoreSignal(retailState, retailClass);

  assert(
    sharpScore.score > retailScore.score,
    `Sharp-led (Pinnacle) scores higher (${sharpScore.score}) than retail-led (${retailScore.score})`,
  );
  assert(
    sharpScore.breakdown.book_tier_weight > retailScore.breakdown.book_tier_weight,
    'Sharp-led gets full book_tier_weight points',
  );
}

// Case 8b: Book config lookups
{
  assert(isSharpBook('pinnacle'), 'Pinnacle is sharp');
  assert(isSharpBook('circa'), 'Circa is sharp');
  assert(isSharpBook('bet365'), 'bet365 is sharp (TIER_2)');
  assert(!isSharpBook('draftkings'), 'DraftKings is NOT sharp');
  assert(!isSharpBook('espnbet'), 'ESPNBet is NOT sharp');
  assert(!isSharpBook('unknown_book_xyz'), 'Unknown book is NOT sharp');

  const config = getBookConfig('pinnacle');
  assertEq(config.tier, 'TIER_1_SHARP', 'Pinnacle tier = TIER_1_SHARP');
  assertEq(config.weight, 3.0, 'Pinnacle weight = 3.0');

  const unknown = getBookConfig('mystery_book');
  assertEq(unknown.tier, 'TIER_5_UNKNOWN', 'Unknown book tier = TIER_5_UNKNOWN');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 9: Missing Data Robustness
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 9: Missing Data Robustness ===');

// Case 9a: No public splits
{
  const books = [
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -6.0),
    makeBook('betmgm', -4.5, -6.0),
  ];
  const state = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books,
    books_moved_consensus: books,
    books_held: [],
    total_books: 3,
    velocity: 1.0,
    public_data: {
      home_ticket_pct: null, away_ticket_pct: null,
      home_money_pct: null, away_money_pct: null,
    },
  });
  const classification = classifySignal(state);
  assert(
    classification.type !== 'REVERSE_LINE_MOVEMENT',
    'No splits data → cannot be RLM (got: ' + classification.type + ')',
  );
  // Should still classify (probably STEAM)
  assert(classification.type !== 'NOISE', 'Still classifies as non-NOISE with 3 books moving');
}

// Case 9b: Empty snapshots
{
  const state = buildMarketState(
    [],
    { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
    'NBA', 'Suns', 'Nuggets', '2026-03-25T19:00:00Z', 'spread',
  );
  assertEq(state.total_books, 0, 'Empty snapshots → 0 books');
  assertEq(state.move, 0, 'Empty snapshots → 0 move');
  const output = analyzeMarket(state);
  assertEq(output.signal_type, 'NOISE', 'Empty state → NOISE');
}

// Case 9c: Partial books (only 1 book)
{
  const state = makeState({
    opener: -4.5, current: -6.0, move: -1.5,
    books: [makeBook('draftkings', -4.5, -6.0)],
    books_moved_consensus: [makeBook('draftkings', -4.5, -6.0)],
    books_held: [],
    total_books: 1,
    velocity: 1.0,
  });
  const classification = classifySignal(state);
  const scored = scoreSignal(state, classification);
  assert(
    scored.breakdown.incomplete_board_penalty < 0,
    'Single book → incomplete board penalty applied',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 10: League Config Correctness
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 10: League Config Correctness ===');

// Case 10a: NBA and NCAAB should NOT share identical thresholds with NHL/MLB
{
  const nba = getLeagueConfig('NBA');
  const nhl = getLeagueConfig('NHL');
  const mlb = getLeagueConfig('MLB');
  const ncaab = getLeagueConfig('NCAAB');

  assert(nba.spread.meaningful_move !== nhl.spread.meaningful_move,
    'NBA spread threshold differs from NHL');
  assert(nba.total.meaningful_move !== nhl.total.meaningful_move,
    'NBA total threshold differs from NHL');
  assert(nba.spread.key_numbers.length !== nhl.spread.key_numbers.length,
    'NBA and NHL have different key numbers');
  assert(
    nhl.spread.meaningful_move === mlb.spread.meaningful_move,
    'NHL and MLB share spread thresholds (both ML-primary)',
  );
}

// Case 10b: ML-primary detection
{
  assert(isMLPrimary('NHL'), 'NHL is ML-primary');
  assert(isMLPrimary('MLB'), 'MLB is ML-primary');
  assert(!isMLPrimary('NBA'), 'NBA is NOT ML-primary');
  assert(!isMLPrimary('NCAAB'), 'NCAAB is NOT ML-primary');
}

// Case 10c: Key numbers
{
  const nba = getMarketThresholds('NBA', 'spread');
  assert(nba.key_numbers.includes(3), 'NBA spread includes key number 3');
  assert(nba.key_numbers.includes(7), 'NBA spread includes key number 7');

  const nhl = getMarketThresholds('NHL', 'spread');
  assert(nhl.key_numbers.includes(1.5), 'NHL spread includes key number 1.5');

  const mlb = getMarketThresholds('MLB', 'total');
  assert(mlb.key_numbers.includes(7), 'MLB total includes key number 7');
}

// Case 10d: Unknown league falls back to NBA
{
  const unknown = getLeagueConfig('CRICKET');
  const nba = getLeagueConfig('NBA');
  assertEq(unknown.spread.meaningful_move, nba.spread.meaningful_move,
    'Unknown league falls back to NBA thresholds');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 11: Full Pipeline (analyzeMarket)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 11: Full Pipeline (analyzeMarket) ===');

{
  const books = [
    makeBook('pinnacle', 4.5, 3.0, '2026-03-25T11:50:00Z'),
    makeBook('draftkings', 4.5, 3.0, '2026-03-25T11:55:00Z'),
    makeBook('fanduel', 4.5, 3.0, '2026-03-25T12:00:00Z'),
    makeBook('betmgm', 4.5, 4.5, '2026-03-25T12:00:00Z'),
  ];

  const state = makeState({
    home_team: 'Suns', away_team: 'Nuggets',
    opener: 4.5, current: 3.0, move: -1.5,
    books,
    books_moved_consensus: books.slice(0, 3),
    books_held: [books[3]],
    total_books: 4,
    velocity: 3.0,
    hours_tracked: 0.5,
    public_data: {
      home_ticket_pct: 35, away_ticket_pct: 65,
      home_money_pct: 30, away_money_pct: 70,
    },
  });

  const output = analyzeMarket(state);

  assertEq(output.league, 'NBA', 'Pipeline: league = NBA');
  assertEq(output.market, 'spread', 'Pipeline: market = spread');
  assert(output.opener.includes('Suns'), 'Pipeline: opener includes team name');
  assert(output.current.includes('Suns'), 'Pipeline: current includes team name');
  assert(output.confidence_score > 0, 'Pipeline: confidence_score > 0');
  assert(output.explanation.length > 0, 'Pipeline: explanation is non-empty');
  assert(output.score_breakdown.raw_total > 0, 'Pipeline: score breakdown has values');

  // Direction correctness: +4.5 → +3.0 = toward home (Suns)
  assert(
    output.line_movement_summary.includes('Suns') && output.line_movement_summary.includes('toward'),
    'Pipeline: movement summary mentions toward Suns',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 12: Book Intelligence Utilities
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 12: Book Intelligence Utilities ===');

// Leader/follower detection
{
  const books = [
    makeBook('pinnacle', -4.5, -6.0, '2026-03-25T11:45:00Z'),
    makeBook('draftkings', -4.5, -6.0, '2026-03-25T11:55:00Z'),
    makeBook('betmgm', -4.5, -4.5, '2026-03-25T12:00:00Z'),
  ];
  const result = detectLeaderFollower(books, -1, 1.0);
  assertEq(result.leader, 'Pinnacle', 'Leader is Pinnacle (moved first + sharp)');
  assertEq(result.leader_tier, 'TIER_1_SHARP', 'Leader tier is TIER_1_SHARP');
  assert(result.followers.includes('DraftKings'), 'DraftKings is a follower');
  assert(result.holders.includes('BetMGM'), 'BetMGM is a holder');
}

// Weighted coordination
{
  const books = [
    makeBook('pinnacle', -4.5, -6.0),
    makeBook('draftkings', -4.5, -6.0),
    makeBook('betmgm', -4.5, -4.5),
  ];
  const weighted = computeWeightedCoordination(books, -1, 1.0);
  assert(weighted > 0.5, `Weighted coordination > 0.5 (got: ${weighted.toFixed(2)}) — sharp book drives it up`);

  const allRetail = [
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -6.0),
    makeBook('betmgm', -4.5, -4.5),
  ];
  const retailWeighted = computeWeightedCoordination(allRetail, -1, 1.0);
  assert(
    weighted > retailWeighted,
    `Sharp+retail coordination (${weighted.toFixed(2)}) > all-retail (${retailWeighted.toFixed(2)})`,
  );
}

// Sharp-led detection
{
  const sharpBooks = [
    makeBook('pinnacle', -4.5, -6.0),
    makeBook('draftkings', -4.5, -4.5),
  ];
  assert(isSharpLed(sharpBooks, -1, 1.0), 'Pinnacle moved → sharp-led');

  const retailOnly = [
    makeBook('draftkings', -4.5, -6.0),
    makeBook('fanduel', -4.5, -6.0),
  ];
  assert(!isSharpLed(retailOnly, -1, 1.0), 'Only retail moved → NOT sharp-led');
}

// Book tiers by group
{
  const tiers = getBooksByTier();
  assert(tiers.TIER_1_SHARP.includes('pinnacle'), 'Pinnacle in TIER_1');
  assert(tiers.TIER_3_RETAIL_MAJOR.includes('draftkings'), 'DraftKings in TIER_3');
  assert(tiers.TIER_4_SOFT.includes('pointsbetus'), 'PointsBet in TIER_4');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST 13: buildMarketState from raw snapshots
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n=== TEST 13: buildMarketState from raw snapshots ===');

{
  const snapshots = makeSnapshots([
    { book: 'draftkings', spread: -4.5, time: '2026-03-25T10:00:00Z' },
    { book: 'fanduel', spread: -4.5, time: '2026-03-25T10:00:00Z' },
    { book: 'draftkings', spread: -5.5, time: '2026-03-25T12:00:00Z' },
    { book: 'fanduel', spread: -5.5, time: '2026-03-25T12:00:00Z' },
  ]);

  const state = buildMarketState(
    snapshots,
    { home_ticket_pct: 60, away_ticket_pct: 40, home_money_pct: 55, away_money_pct: 45 },
    'NBA', 'Celtics', 'Hawks', '2026-03-25T19:00:00Z', 'spread',
  );

  assertEq(state.opener, -4.5, 'buildMarketState: opener = -4.5');
  assertEq(state.current, -5.5, 'buildMarketState: current = -5.5');
  assertEq(state.move, -1.0, 'buildMarketState: move = -1.0');
  assertEq(state.total_books, 2, 'buildMarketState: 2 books');
  assert(state.velocity > 0, 'buildMarketState: velocity > 0');
  assert(state.hours_tracked > 0, 'buildMarketState: hours > 0');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed === 0) {
  console.log('All tests passed!');
} else {
  console.log(`${failed} test(s) FAILED.`);
  process.exit(1);
}
