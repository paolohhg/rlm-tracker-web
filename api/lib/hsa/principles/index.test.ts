// ══════════════════════════════════════════════════════════════════════════════
//  Principles foundation — selector + integrity tests
//
//  Run: npx tsx api/lib/hsa/principles/index.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import {
  getPrinciplesFor,
  UNIVERSAL,
  SPREAD_MARKET,
  TOTAL_MARKET,
  MONEYLINE_MARKET,
  NBA,
  NCAAB,
  NFL,
  NCAAF,
  MLB,
  NHL,
  WNBA,
  type League,
  type Market,
} from './index';

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

function assertEqual<T>(actual: T, expected: T, testName: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(
      `  ✗ FAIL: ${testName} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// ── Bucket counts (sanity for the spec's expected sums) ─────────────────────
console.log('\nBucket counts:');
assertEqual(UNIVERSAL.length, 9, 'UNIVERSAL has 9 principles');
assertEqual(SPREAD_MARKET.length, 6, 'SPREAD_MARKET has 6 principles');
assertEqual(TOTAL_MARKET.length, 5, 'TOTAL_MARKET has 5 principles');
assertEqual(MONEYLINE_MARKET.length, 5, 'MONEYLINE_MARKET has 5 principles');
assertEqual(NBA.length, 6, 'NBA has 6 principles');
assertEqual(NCAAB.length, 7, 'NCAAB has 7 principles');
assertEqual(NFL.length, 7, 'NFL has 7 principles');
assertEqual(NCAAF.length, 6, 'NCAAF has 6 principles');
assertEqual(MLB.length, 9, 'MLB has 9 principles');
assertEqual(NHL.length, 7, 'NHL has 7 principles');
assertEqual(WNBA.length, 3, 'WNBA has 3 principles');

// ── getPrinciplesFor: count assertions from spec Part 6 ─────────────────────
console.log('\ngetPrinciplesFor counts:');
assertEqual(
  getPrinciplesFor('spread', 'NHL').length,
  9 + 6 + 7,
  "getPrinciplesFor('spread','NHL') = 22"
);
assertEqual(
  getPrinciplesFor('total', 'MLB').length,
  9 + 5 + 9,
  "getPrinciplesFor('total','MLB') = 23"
);
assertEqual(
  getPrinciplesFor('moneyline', 'NBA').length,
  9 + 5 + 6,
  "getPrinciplesFor('moneyline','NBA') = 20"
);

// ── Bucket integrity: every returned principle has bucket matching source ──
console.log('\nBucket integrity:');
const markets: Market[] = ['spread', 'total', 'moneyline'];
const leagues: League[] = ['NBA', 'NCAAB', 'NFL', 'NCAAF', 'MLB', 'NHL', 'WNBA'];

for (const m of markets) {
  for (const l of leagues) {
    const merged = getPrinciplesFor(m, l);
    const universalCount = merged.filter(p => p.bucket === 'universal').length;
    const marketCount = merged.filter(p => p.bucket === 'market').length;
    const sportCount = merged.filter(p => p.bucket === 'sport').length;
    const total = universalCount + marketCount + sportCount;
    assert(
      total === merged.length,
      `${m}/${l}: every principle has a known bucket value`
    );
    assert(
      universalCount === UNIVERSAL.length,
      `${m}/${l}: universal-bucket count matches UNIVERSAL`
    );
  }
}

// ── No duplicate IDs across the full union ──────────────────────────────────
console.log('\nID uniqueness:');
const allBuckets = [
  UNIVERSAL,
  SPREAD_MARKET,
  TOTAL_MARKET,
  MONEYLINE_MARKET,
  NBA,
  NCAAB,
  NFL,
  NCAAF,
  MLB,
  NHL,
  WNBA,
];
const allIds = allBuckets.flatMap(b => b.map(p => p.id));
const uniqueIds = new Set(allIds);
assertEqual(uniqueIds.size, allIds.length, 'no duplicate IDs across all principle files');

// ── last_validated set on every principle ───────────────────────────────────
console.log('\nlast_validated:');
const all = allBuckets.flat();
const allValidated = all.every(p => p.last_validated === '2026-04-19');
assert(allValidated, 'every principle has last_validated = 2026-04-19');

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`Principles tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All principles tests passed');
}
