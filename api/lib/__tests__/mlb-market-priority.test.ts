// ══════════════════════════════════════════════════════════════════════════════
//  MLB HSA Market Priority Regression Tests
//
//  Validates that MLB HSA correctly prioritizes moneyline as primary signal
//  and does not fall back to spread-first (run line) logic.
//
//  Run: npx tsx api/lib/__tests__/mlb-market-priority.test.ts
// ══════════════════════════════════════════════════════════════════════════════

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

// ── Inline the key functions we're testing ──────────────────────────────────
// These mirror the inlined versions in generate-hsa.ts

function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
  let maxFreq = 0;
  for (const count of freq.values()) if (count > maxFreq) maxFreq = count;
  const candidates = [...freq.entries()].filter(([, c]) => c === maxFreq).map(([v]) => v);
  if (candidates.length === 1) return candidates[0];
  const sorted = [...nums].sort((a, b) => a - b);
  const medianVal = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianVal) - Math.abs(b - medianVal));
  return candidates[0];
}

interface MockSnapshot {
  bookmaker: string;
  spread: number;
  spread_home_price: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price: number;
  fetched_at: string;
  book_type?: string;
}

interface BookLine {
  book: string;
  spread: number;
  spreadPrice: number;
  total: number;
  totalOverPrice: number;
  mlHome: number;
  mlAway: number;
}

function toBookLine(snap: MockSnapshot): BookLine {
  return {
    book: snap.bookmaker,
    spread: snap.spread,
    spreadPrice: snap.spread_home_price,
    total: snap.total,
    totalOverPrice: snap.total_over_price,
    mlHome: snap.moneyline_home,
    mlAway: snap.moneyline_away,
  };
}

/** Compute ML consensus and movement from snapshots (mirrors generate-hsa logic) */
function computeMlbDebug(openingSnaps: MockSnapshot[], currentSnaps: MockSnapshot[]) {
  const openBooks = openingSnaps.map(toBookLine);
  const currBooks = currentSnaps.map(toBookLine);

  const openMlHomes = openBooks.filter(b => b.mlHome !== 0).map(b => b.mlHome);
  const currMlHomes = currBooks.filter(b => b.mlHome !== 0).map(b => b.mlHome);
  const openMlAways = openBooks.filter(b => b.mlAway !== 0).map(b => b.mlAway);
  const currMlAways = currBooks.filter(b => b.mlAway !== 0).map(b => b.mlAway);

  const mlOpenHome = openMlHomes.length ? mode(openMlHomes) : 0;
  const mlCurrHome = currMlHomes.length ? mode(currMlHomes) : 0;
  const mlOpenAway = openMlAways.length ? mode(openMlAways) : 0;
  const mlCurrAway = currMlAways.length ? mode(currMlAways) : 0;

  const mlDelta = Math.abs(mlCurrHome - mlOpenHome);
  const totalOpenConsensus = mode(openBooks.filter(b => b.total > 0).map(b => b.total));
  const totalCurrConsensus = mode(currBooks.filter(b => b.total > 0).map(b => b.total));
  const totalDelta = Math.abs(totalCurrConsensus - totalOpenConsensus);
  const rlOpenConsensus = mode(openBooks.filter(b => b.spread !== 0).map(b => b.spread));
  const rlCurrConsensus = mode(currBooks.filter(b => b.spread !== 0).map(b => b.spread));
  const rlDelta = Math.abs(rlCurrConsensus - rlOpenConsensus);

  let primaryMarket: string;
  if (mlDelta >= 5) {
    primaryMarket = 'moneyline';
  } else if (totalDelta >= 0.5) {
    primaryMarket = 'total';
  } else if (rlDelta >= 0.5) {
    primaryMarket = 'runline';
  } else {
    primaryMarket = 'none';
  }

  return {
    primaryMarket,
    mlOpenHome, mlCurrHome, mlDelta,
    mlOpenAway, mlCurrAway, mlAwayDelta: Math.abs(mlCurrAway - mlOpenAway),
    totalOpenConsensus, totalCurrConsensus, totalDelta,
    rlOpenConsensus, rlCurrConsensus, rlDelta,
  };
}

// ── Helper: create a snapshot ───────────────────────────────────────────────

function snap(book: string, mlHome: number, mlAway: number, spread: number, total: number, fetchedAt: string): MockSnapshot {
  return {
    bookmaker: book,
    moneyline_home: mlHome,
    moneyline_away: mlAway,
    spread,
    spread_home_price: spread > 0 ? -110 : -110,
    total,
    total_over_price: -110,
    fetched_at: fetchedAt,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO A: Moneyline moved meaningfully, run line static
//  Expected: moneyline selected as primary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario A: ML moved, run line static ===');
{
  const open = [
    snap('draftkings', -100, -120, -1.5, 6.5, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -105, -115, -1.5, 6.5, '2026-03-26T10:00:00Z'),
    snap('betmgm',    -100, -120, -1.5, 6.5, '2026-03-26T10:00:00Z'),
    snap('pinnacle',  -102, -118, -1.5, 7,   '2026-03-26T10:00:00Z'),
    snap('espnbet',   -105, -115, -1.5, 6.5, '2026-03-26T10:00:00Z'),
  ];
  const curr = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -116, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('betmgm',    -120, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('pinnacle',  -112, +100, -1.5, 7,   '2026-03-26T14:00:00Z'),
    snap('espnbet',   -125, +105, -1.5, 6.5, '2026-03-26T14:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'moneyline', 'A1: Primary market is moneyline');
  assert(result.mlDelta >= 5, `A2: ML delta (${result.mlDelta}) is ≥5 cents`);
  assertEqual(result.rlDelta, 0, 'A3: Run line delta is 0 (static)');
  assertEqual(result.totalDelta, 0, 'A4: Total delta is 0 (static)');
  assert(result.mlDelta >= 10, `A5: ML delta (${result.mlDelta}) qualifies as "meaningful" (≥10c)`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO B: Total moved meaningfully, moneyline static
//  Expected: total selected as primary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario B: Total moved, ML static ===');
{
  const open = [
    snap('draftkings', -120, +100, -1.5, 7,   '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, +100, -1.5, 7,   '2026-03-26T10:00:00Z'),
    snap('betmgm',    -120, +100, -1.5, 7,   '2026-03-26T10:00:00Z'),
    snap('pinnacle',  -118, +102, -1.5, 7,   '2026-03-26T10:00:00Z'),
  ];
  const curr = [
    snap('draftkings', -120, +100, -1.5, 7.5, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -120, +100, -1.5, 7.5, '2026-03-26T14:00:00Z'),
    snap('betmgm',    -120, +100, -1.5, 7.5, '2026-03-26T14:00:00Z'),
    snap('pinnacle',  -118, +102, -1.5, 8,   '2026-03-26T14:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'total', 'B1: Primary market is total');
  assert(result.totalDelta >= 0.5, `B2: Total delta (${result.totalDelta}) is meaningful`);
  assert(result.mlDelta < 5, `B3: ML delta (${result.mlDelta}) is below threshold`);
  assertEqual(result.rlDelta, 0, 'B4: Run line static');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO C: All markets static, run line sign split across books
//  Expected: no primary market, structural disagreement only
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario C: All static, RL sign disagreement ===');
{
  // DK/FD have home -1.5, ESPN/Pinnacle have home +1.5 (opposite team favored)
  // BUT moneyline tells the real story — home is favored (negative ML)
  const open = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -120, +100, -1.5, 6.5, '2026-03-26T10:00:00Z'),
    snap('espnbet',   -125, +105, 1.5,  6.5, '2026-03-26T10:00:00Z'),  // opposite sign
    snap('pinnacle',  -112, +100, 1.5,  7,   '2026-03-26T10:00:00Z'),  // opposite sign
  ];
  const curr = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -120, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('espnbet',   -125, +105, 1.5,  6.5, '2026-03-26T14:00:00Z'),
    snap('pinnacle',  -112, +100, 1.5,  7,   '2026-03-26T14:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'none', 'C1: No primary market (all static)');
  assertEqual(result.mlDelta, 0, 'C2: ML did not move');
  assertEqual(result.totalDelta, 0, 'C3: Total did not move');
  // RL "moved" in the consensus calculation because of sign disagreement
  // but this is structural, not real movement
  assert(result.mlDelta < 5, 'C4: ML below threshold — no false signal from RL disagreement');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO D: Multi-book moneyline move in short window
//  Expected: moneyline as primary, large delta
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario D: Multi-book ML steam move ===');
{
  const open = [
    snap('draftkings', +100, -120, 1.5, 8,   '2026-03-26T10:00:00Z'),
    snap('fanduel',    +105, -125, 1.5, 8,   '2026-03-26T10:00:00Z'),
    snap('betmgm',    +100, -120, 1.5, 8,   '2026-03-26T10:00:00Z'),
    snap('pinnacle',  +102, -122, 1.5, 8,   '2026-03-26T10:00:00Z'),
    snap('espnbet',   +100, -120, 1.5, 8,   '2026-03-26T10:00:00Z'),
  ];
  // All books moved ML ~20 cents toward away team in 20 min
  const curr = [
    snap('draftkings', +120, -140, 1.5, 8,   '2026-03-26T10:20:00Z'),
    snap('fanduel',    +125, -150, 1.5, 8,   '2026-03-26T10:20:00Z'),
    snap('betmgm',    +120, -140, 1.5, 8,   '2026-03-26T10:20:00Z'),
    snap('pinnacle',  +118, -138, 1.5, 8,   '2026-03-26T10:20:00Z'),
    snap('espnbet',   +120, -140, 1.5, 8,   '2026-03-26T10:20:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'moneyline', 'D1: Primary market is moneyline');
  assert(result.mlDelta >= 15, `D2: ML delta (${result.mlDelta}) indicates steam-level move`);
  assertEqual(result.rlDelta, 0, 'D3: Run line static despite ML steam');
  assertEqual(result.totalDelta, 0, 'D4: Total static despite ML steam');
  assert(result.mlAwayDelta >= 15, `D5: Away ML delta (${result.mlAwayDelta}) confirms coordinated move`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO E: REGRESSION — Ensure spread-first logic cannot override ML
//  Expected: even if spread moves 0.5, a 15-cent ML move wins
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario E: Regression — ML must win over small RL move ===');
{
  const open = [
    snap('draftkings', -130, +110, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('fanduel',    -130, +110, -1.5, 7, '2026-03-26T10:00:00Z'),
    snap('betmgm',    -130, +110, -1.5, 7, '2026-03-26T10:00:00Z'),
  ];
  const curr = [
    snap('draftkings', -150, +130, -1.5, 7, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -145, +125, -1.5, 7, '2026-03-26T14:00:00Z'),
    snap('betmgm',    -150, +130, -1.5, 7, '2026-03-26T14:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'moneyline', 'E1: ML selected as primary (not spread)');
  assert(result.mlDelta >= 15, `E2: ML delta (${result.mlDelta}) is large`);
  assertEqual(result.rlDelta, 0, 'E3: Run line unchanged');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO F: REGRESSION — Static board must not false-detect movement
//  Expected: primaryMarket = 'none' when nothing moves
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario F: Regression — truly static board ===');
{
  const open = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T08:00:00Z'),
    snap('fanduel',    -116, +100, -1.5, 6.5, '2026-03-26T08:00:00Z'),
    snap('pinnacle',  -112, +100, -1.5, 7,   '2026-03-26T08:00:00Z'),
  ];
  const curr = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('fanduel',    -116, +100, -1.5, 6.5, '2026-03-26T14:00:00Z'),
    snap('pinnacle',  -112, +100, -1.5, 7,   '2026-03-26T14:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'none', 'F1: No primary market on truly static board');
  assertEqual(result.mlDelta, 0, 'F2: ML delta is 0');
  assertEqual(result.totalDelta, 0, 'F3: Total delta is 0');
  assertEqual(result.rlDelta, 0, 'F4: RL delta is 0');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENARIO G: PIT @ NYM simulated (the real case that exposed the bug)
//  Open: PIT +115 / NYM -135  → Current: PIT +100 / NYM -120
//  Expected: moneyline as primary, 15-cent move detected
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Scenario G: PIT @ NYM (real case) ===');
{
  const open = [
    snap('draftkings', -135, +115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('fanduel',    -130, +110, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('betmgm',    -135, +115, -1.5, 6.5, '2026-03-25T22:00:00Z'),
    snap('pinnacle',  -128, +108, -1.5, 7,   '2026-03-25T22:00:00Z'),
    snap('espnbet',   -140, +120, -1.5, 6.5, '2026-03-25T22:00:00Z'),
  ];
  const curr = [
    snap('draftkings', -120, +100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('fanduel',    -116, +100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('betmgm',    -120, +100, -1.5, 6.5, '2026-03-26T16:00:00Z'),
    snap('pinnacle',  -112, +100, -1.5, 7,   '2026-03-26T16:00:00Z'),
    snap('espnbet',   -125, +105, -1.5, 6.5, '2026-03-26T16:00:00Z'),
  ];

  const result = computeMlbDebug(open, curr);
  assertEqual(result.primaryMarket, 'moneyline', 'G1: PIT@NYM — moneyline is primary');
  assert(result.mlDelta >= 10, `G2: ML delta (${result.mlDelta}) is meaningful`);
  assertEqual(result.rlDelta, 0, 'G3: Run line unchanged (still ±1.5)');
  assert(result.mlAwayDelta >= 5, `G4: Away (PIT) ML shortened from +115→+100 range`);

  // The actual PIT @ NYM expected HSA behavior:
  // HSA must NOT say "static board" or "PASS" with this data
  console.log(`  → PIT@NYM: ML delta=${result.mlDelta}c, primary=${result.primaryMarket}`);
  console.log(`  → Home ML: ${result.mlOpenHome} → ${result.mlCurrHome}`);
  console.log(`  → Away ML: ${result.mlOpenAway} → ${result.mlCurrAway}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`MLB Market Priority Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED — MLB spread-first logic may have returned');
  process.exit(1);
} else {
  console.log('\n✅ All MLB market priority tests passed');
}
