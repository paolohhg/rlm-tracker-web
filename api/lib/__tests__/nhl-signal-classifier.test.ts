// ══════════════════════════════════════════════════════════════════════════════
//  NHL Signal Classifier Tests
//
//  Run: npx tsx api/lib/__tests__/nhl-signal-classifier.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import {
  isPucklineStateFlip,
  getNhlCoordinationTier,
  getNhlTimeBucket,
  getNhlSignalType,
  getNhlTotalsSignalType,
  describeNhlSpreadMove,
  type NhlClassifierInput,
} from '../nhl-signal-classifier';

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

// Helper to create a base input with defaults
function baseInput(overrides: Partial<NhlClassifierInput> = {}): NhlClassifierInput {
  return {
    league: 'NHL',
    homeTeam: 'Chicago Blackhawks',
    awayTeam: 'Nashville Predators',
    openingSpread: -1.5,
    currentSpread: -1.5,
    spreadBooksMovedCount: 0,
    spreadBooksHeldCount: 4,
    spreadBooksMoved: [],
    spreadBooksHeld: ['DraftKings', 'FanDuel', 'BetMGM', 'ESPNBet'],
    spreadMoveTimeWindowMinutes: 0,
    openingMlHome: -130,
    currentMlHome: -130,
    mlBooksMovedCount: 0,
    mlDirection: 'none',
    publicTicketPctHome: 40,
    publicMoneyPctHome: 40,
    openingTotal: 6,
    currentTotal: 6,
    totalBooksMovedCount: 0,
    totalBooksHeldCount: 4,
    totalBooksMoved: [],
    totalBooksHeld: ['DraftKings', 'FanDuel', 'BetMGM', 'ESPNBet'],
    movePersistedSnapshots: 1,
    hasSnappedBack: false,
    fakeSteamTriggered: false,
    fakeSteamScore: 0,
    ...overrides,
  };
}

// ── Helper function tests ────────────────────────────────────────────────────

console.log('\n=== isPucklineStateFlip ===');
assert(isPucklineStateFlip(-1.5, 1.5) === true, '-1.5 → +1.5 is a state flip');
assert(isPucklineStateFlip(1.5, -1.5) === true, '+1.5 → -1.5 is a state flip');
assert(isPucklineStateFlip(-1.5, -1.5) === false, '-1.5 → -1.5 is NOT a state flip');
assert(isPucklineStateFlip(-2.5, 1.5) === false, '-2.5 → +1.5 is NOT a state flip');
assert(isPucklineStateFlip(-1.5, -2.5) === false, '-1.5 → -2.5 is NOT a state flip');

console.log('\n=== getNhlCoordinationTier ===');
assert(getNhlCoordinationTier(0) === 'ISOLATED', '0 books = ISOLATED');
assert(getNhlCoordinationTier(1) === 'ISOLATED', '1 book = ISOLATED');
assert(getNhlCoordinationTier(2) === 'PARTIAL', '2 books = PARTIAL');
assert(getNhlCoordinationTier(3) === 'MEANINGFUL', '3 books = MEANINGFUL');
assert(getNhlCoordinationTier(4) === 'STRONG', '4 books = STRONG');
assert(getNhlCoordinationTier(5) === 'STRONG', '5 books = STRONG');

console.log('\n=== getNhlTimeBucket ===');
assert(getNhlTimeBucket(10) === 'STEAM_WINDOW', '10min = STEAM_WINDOW');
assert(getNhlTimeBucket(20) === 'STEAM_WINDOW', '20min = STEAM_WINDOW');
assert(getNhlTimeBucket(30) === 'FAST_COORDINATED', '30min = FAST_COORDINATED');
assert(getNhlTimeBucket(45) === 'FAST_COORDINATED', '45min = FAST_COORDINATED');
assert(getNhlTimeBucket(90) === 'GRADUAL_MIGRATION', '90min = GRADUAL_MIGRATION');
assert(getNhlTimeBucket(150) === 'SLOW_DRIFT', '150min = SLOW_DRIFT');

console.log('\n=== describeNhlSpreadMove ===');
const flipDesc = describeNhlSpreadMove(-1.5, 1.5, 2, true);
assert(!flipDesc.includes('point'), 'State flip description does NOT contain "point"');
assert(flipDesc.includes('state'), 'State flip description contains "state"');
assert(flipDesc.includes('favorite'), 'State flip description contains "favorite"');

// ── CASE A: 2-book NHL RLM with state flip and split market ─────────────────

console.log('\n=== CASE A: 2-book NHL RLM with state flip and split market ===');
// RLM scenario: public on Chicago (home, 60%) but line moves AWAY from Chicago
// (spread goes from -1.5 to +1.5 = toward_away = against public Chicago side)
const caseA = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,
  spreadBooksMovedCount: 2,
  spreadBooksHeldCount: 2,
  spreadBooksMoved: ['DraftKings', 'FanDuel'],
  spreadBooksHeld: ['BetMGM', 'ESPNBet'],
  spreadMoveTimeWindowMinutes: 15,
  openingMlHome: -130,
  currentMlHome: -120,
  mlBooksMovedCount: 1,
  mlDirection: 'toward_away',
  publicTicketPctHome: 60, // public on Chicago (home), line moved toward away = RLM
  publicMoneyPctHome: 45,
}));

assert(caseA.signal_type === 'PARTIAL_SHARP_ENTRY', 'Case A: signal_type = PARTIAL_SHARP_ENTRY');
assert(caseA.confidence === 'MODERATE', 'Case A: confidence = MODERATE');
assert(caseA.status === 'NEEDS_CONFIRMATION', 'Case A: status = NEEDS_CONFIRMATION');
assert(caseA.puckline_state_flip === true, 'Case A: puckline_state_flip = true');
assert(!caseA.explanation.includes('3-point'), 'Case A: no "3-point" in explanation');
assert(caseA.explanation.includes('state') || caseA.explanation.includes('partial'), 'Case A: explanation mentions state or partial');

// ── CASE B: 3+ book coordinated NHL move against public with persistence ────

console.log('\n=== CASE B: 3+ book coordinated move with persistence ===');
// RLM: public on Chicago (home 65%), line moved toward_away = against public
const caseB = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,
  spreadBooksMovedCount: 3,
  spreadBooksHeldCount: 1,
  spreadBooksMoved: ['DraftKings', 'FanDuel', 'BetMGM'],
  spreadBooksHeld: ['ESPNBet'],
  spreadMoveTimeWindowMinutes: 15,
  openingMlHome: -130,
  currentMlHome: 110,
  mlBooksMovedCount: 3,
  mlDirection: 'toward_away',
  publicTicketPctHome: 65, // public on Chicago (home), line moved away = RLM
  publicMoneyPctHome: 45,
  movePersistedSnapshots: 3,
  hasSnappedBack: false,
}));

assert(caseB.signal_type === 'CONFIRMED_RLM', 'Case B: signal_type = CONFIRMED_RLM');
assert(caseB.confidence === 'HIGH', 'Case B: confidence = HIGH (3+ books + ML confirms + persists)');
assert(caseB.puckline_state_flip === true, 'Case B: puckline_state_flip = true');

// ── CASE C: One rogue book flips while rest hold ─────────────────────────────

console.log('\n=== CASE C: One rogue book flips ===');
const caseC = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,
  spreadBooksMovedCount: 1,
  spreadBooksHeldCount: 3,
  spreadBooksMoved: ['DraftKings'],
  spreadBooksHeld: ['FanDuel', 'BetMGM', 'ESPNBet'],
  spreadMoveTimeWindowMinutes: 5,
  fakeSteamTriggered: true,
  fakeSteamScore: 4,
  publicTicketPctHome: 35,
}));

assert(caseC.signal_type === 'FAKE_STEAM', 'Case C: signal_type = FAKE_STEAM');
assert(caseC.confidence === 'LOW', 'Case C: confidence = LOW');

// ── CASE D: State flip without moneyline confirmation ────────────────────────

console.log('\n=== CASE D: State flip without ML confirmation ===');
// RLM: public on Chicago (home 60%), line moved toward away = against public
// BUT moneyline does NOT confirm
const caseD = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,
  spreadBooksMovedCount: 3,
  spreadBooksHeldCount: 1,
  spreadBooksMoved: ['DraftKings', 'FanDuel', 'BetMGM'],
  spreadBooksHeld: ['ESPNBet'],
  spreadMoveTimeWindowMinutes: 20,
  openingMlHome: -130,
  currentMlHome: -128,  // ML barely moved — does NOT confirm
  mlBooksMovedCount: 0,
  mlDirection: 'none',
  publicTicketPctHome: 60,
  publicMoneyPctHome: 45,
  movePersistedSnapshots: 2,
}));

// Confidence should be capped at MODERATE because ML doesn't confirm
assert(caseD.confidence === 'MODERATE' || caseD.confidence === 'LOW',
  'Case D: confidence capped at MODERATE (no ML confirmation)');
assert(caseD.puckline_state_flip === true, 'Case D: puckline_state_flip = true');

// ── CASE E: Single-book NHL total move from 6 to 5.5 ────────────────────────

console.log('\n=== CASE E: Single-book total move ===');
const caseE = getNhlTotalsSignalType({
  openingTotal: 6,
  currentTotal: 5.5,
  booksMovedCount: 1,
  booksHeldCount: 3,
  booksMoved: ['DraftKings'],
  booksHeld: ['FanDuel', 'BetMGM', 'ESPNBet'],
});

assert(caseE.signal_type === 'TOTAL_NOISE', 'Case E: signal_type = TOTAL_NOISE');
assert(caseE.confidence === 'LOW', 'Case E: confidence = LOW');

// ── CASE F: Stable aligned NHL market ────────────────────────────────────────

console.log('\n=== CASE F: Stable aligned market ===');
const caseF = getNhlSignalType(baseInput({
  // All defaults — no movement
}));

assert(caseF.signal_type === 'FROZEN', 'Case F: signal_type = FROZEN');
assert(caseF.confidence === 'LOW', 'Case F: confidence = LOW');
assert(caseF.lean === 'PASS', 'Case F: lean = PASS');

// ── Additional: Coordinated total move ───────────────────────────────────────

console.log('\n=== CASE G: 3-book coordinated total move ===');
const caseG = getNhlTotalsSignalType({
  openingTotal: 6,
  currentTotal: 5.5,
  booksMovedCount: 3,
  booksHeldCount: 1,
  booksMoved: ['DraftKings', 'FanDuel', 'BetMGM'],
  booksHeld: ['ESPNBet'],
});

assert(caseG.signal_type === 'COORDINATED_TOTAL_MOVE', 'Case G: signal_type = COORDINATED_TOTAL_MOVE');
assert(caseG.confidence === 'MODERATE' || caseG.confidence === 'HIGH', 'Case G: confidence >= MODERATE');

// ── Additional: Total noise from toggling ────────────────────────────────────

console.log('\n=== CASE H: Toggling total noise ===');
const caseH = getNhlTotalsSignalType({
  openingTotal: 5.5,
  currentTotal: 6,
  booksMovedCount: 1,
  booksHeldCount: 3,
  booksMoved: ['DraftKings'],
  booksHeld: ['FanDuel', 'BetMGM', 'ESPNBet'],
  hasToggledRepeatedly: true,
});

assert(caseH.signal_type === 'TOTAL_NOISE', 'Case H: signal_type = TOTAL_NOISE');
assert(caseH.confidence === 'LOW', 'Case H: confidence = LOW');

// ── Nashville @ Chicago example ──────────────────────────────────────────────

console.log('\n=== Nashville @ Chicago Example ===');
// Spec scenario: Nashville @ Chicago (Nashville away, Chicago home)
// - Public roughly on Nashville (62% away = 38% home)
// - Some books flip Chicago puck line from -1.5 (fav) to +1.5 (dog)
// - Moneyline shortened toward Chicago (ML moves toward_home)
// - Only 2 books confirmed the puck-line flip
// - Market is split
//
// Because ML is the primary NHL indicator, the lean follows ML direction
// toward Chicago. The puck-line state flip is secondary / chaotic.
// Expected: PARTIAL_SHARP_ENTRY, SPLIT_MARKET, MODERATE, lean = Chicago +1.5
const nashvilleChicago = getNhlSignalType(baseInput({
  homeTeam: 'Chicago Blackhawks',
  awayTeam: 'Nashville Predators',
  openingSpread: -1.5,        // Chicago was PL favorite
  currentSpread: 1.5,         // Some books flipped to Chicago underdog (state flip)
  spreadBooksMovedCount: 2,
  spreadBooksHeldCount: 2,
  spreadBooksMoved: ['DraftKings', 'FanDuel'],
  spreadBooksHeld: ['BetMGM', 'ESPNBet'],
  spreadMoveTimeWindowMinutes: 20,
  openingMlHome: 130,         // Chicago was ML underdog
  currentMlHome: 110,         // ML shortened toward Chicago
  mlBooksMovedCount: 2,
  mlDirection: 'toward_home', // ML moved toward Chicago (primary indicator)
  publicTicketPctHome: 38,    // 62% on Nashville (public on Nashville)
  publicMoneyPctHome: 45,
  movePersistedSnapshots: 2,
  hasSnappedBack: false,
  fakeSteamTriggered: false,
  fakeSteamScore: 0,
}));

assert(nashvilleChicago.signal_type === 'PARTIAL_SHARP_ENTRY', 'Nashville@Chicago: signal_type = PARTIAL_SHARP_ENTRY');
assert(nashvilleChicago.secondary_tag === 'SPLIT_MARKET', 'Nashville@Chicago: secondary_tag = SPLIT_MARKET');
assert(nashvilleChicago.confidence === 'MODERATE', 'Nashville@Chicago: confidence = MODERATE');
assert(nashvilleChicago.status === 'NEEDS_CONFIRMATION', 'Nashville@Chicago: status = NEEDS_CONFIRMATION');
assert(nashvilleChicago.lean === 'Chicago Blackhawks +1.5', 'Nashville@Chicago: lean = Chicago Blackhawks +1.5');
assert(nashvilleChicago.puckline_state_flip === true, 'Nashville@Chicago: puckline_state_flip = true');
assert(!nashvilleChicago.explanation.includes('3-point'), 'Nashville@Chicago: no "3-point" language');
assert(!nashvilleChicago.explanation.includes('steam'), 'Nashville@Chicago: no "steam" language');

// ── CASE I: ML-driven lean when ML and puck line disagree ───────────────────

console.log('\n=== CASE I: ML-driven lean overrides puck-line direction ===');
// Puck line moves toward_away but ML moves toward_home.
// NHL priority: ML is primary, so lean should follow ML direction.
const caseI = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,        // PL state flip toward away
  spreadBooksMovedCount: 2,
  spreadBooksHeldCount: 2,
  spreadBooksMoved: ['DraftKings', 'FanDuel'],
  spreadBooksHeld: ['BetMGM', 'ESPNBet'],
  spreadMoveTimeWindowMinutes: 25,
  openingMlHome: 140,
  currentMlHome: 115,        // ML moved toward home (Chicago)
  mlBooksMovedCount: 2,
  mlDirection: 'toward_home',
  publicTicketPctHome: 40,   // 60% on Nashville (public on away)
  publicMoneyPctHome: 42,
  movePersistedSnapshots: 2,
}));

assert(caseI.lean.includes('Chicago'), 'Case I: lean follows ML direction (Chicago), not PL');
assert(caseI.puckline_state_flip === true, 'Case I: puckline_state_flip detected');
assert(caseI.confidence !== 'HIGH', 'Case I: not HIGH confidence (only 2 books)');

// ── CASE J: ML has no signal, falls back to spread direction ────────────────

console.log('\n=== CASE J: ML silent, lean falls back to spread direction ===');
const caseJ = getNhlSignalType(baseInput({
  openingSpread: -1.5,
  currentSpread: 1.5,
  spreadBooksMovedCount: 2,
  spreadBooksHeldCount: 2,
  spreadBooksMoved: ['DraftKings', 'FanDuel'],
  spreadBooksHeld: ['BetMGM', 'ESPNBet'],
  spreadMoveTimeWindowMinutes: 20,
  openingMlHome: -130,
  currentMlHome: -128,       // ML barely moved (no signal)
  mlBooksMovedCount: 0,
  mlDirection: 'none',       // No ML direction
  publicTicketPctHome: 60,   // Public on Chicago (home), spread moved away = RLM
  publicMoneyPctHome: 50,
}));

// With ML silent, falls back to spread direction (toward_away = Nashville)
assert(caseJ.lean.includes('Nashville'), 'Case J: lean falls back to spread direction when ML silent');
assert(caseJ.signal_type === 'PARTIAL_SHARP_ENTRY', 'Case J: still detects PARTIAL_SHARP_ENTRY from spread');

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
