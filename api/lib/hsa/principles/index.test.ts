// ══════════════════════════════════════════════════════════════════════════════
//  HSA Principles Index Tests
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
} from './index';
import type { Principle, PrincipleBucket } from './types';

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(
      `  ✗ FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Count assertions per brief acceptance criteria
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Count assertions ===');

{
  const r = getPrinciplesFor('spread', 'NHL');
  assertEqual(r.length, 22, "getPrinciplesFor('spread', 'NHL') returns 9+6+7 = 22");
}
{
  const r = getPrinciplesFor('total', 'MLB');
  assertEqual(r.length, 23, "getPrinciplesFor('total', 'MLB') returns 9+5+9 = 23");
}
{
  const r = getPrinciplesFor('moneyline', 'NBA');
  assertEqual(r.length, 20, "getPrinciplesFor('moneyline', 'NBA') returns 9+5+6 = 20");
}

// ══════════════════════════════════════════════════════════════════════════════
//  Bucket consistency — each principle's bucket matches its source file category
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Bucket consistency ===');

function checkBucket(arr: Principle[], expected: PrincipleBucket, label: string) {
  const bad = arr.filter((p) => p.bucket !== expected);
  assert(
    bad.length === 0,
    `${label}: all ${arr.length} principles have bucket='${expected}'${
      bad.length ? ` (violators: ${bad.map((p) => p.id).join(', ')})` : ''
    }`
  );
}

checkBucket(UNIVERSAL, 'universal', 'UNIVERSAL');
checkBucket(SPREAD_MARKET, 'market', 'SPREAD_MARKET');
checkBucket(TOTAL_MARKET, 'market', 'TOTAL_MARKET');
checkBucket(MONEYLINE_MARKET, 'market', 'MONEYLINE_MARKET');
checkBucket(NBA, 'sport', 'NBA');
checkBucket(NCAAB, 'sport', 'NCAAB');
checkBucket(NFL, 'sport', 'NFL');
checkBucket(NCAAF, 'sport', 'NCAAF');
checkBucket(MLB, 'sport', 'MLB');
checkBucket(NHL, 'sport', 'NHL');
checkBucket(WNBA, 'sport', 'WNBA');

// ══════════════════════════════════════════════════════════════════════════════
//  No duplicate IDs across the full union
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Duplicate ID check ===');

{
  const all: Principle[] = [
    ...UNIVERSAL,
    ...SPREAD_MARKET,
    ...TOTAL_MARKET,
    ...MONEYLINE_MARKET,
    ...NBA,
    ...NCAAB,
    ...NFL,
    ...NCAAF,
    ...MLB,
    ...NHL,
    ...WNBA,
  ];
  const ids = all.map((p) => p.id);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  assert(
    duplicates.length === 0,
    `No duplicate IDs across full union (${ids.length} total IDs${
      duplicates.length ? `, duplicates: ${duplicates.join(', ')}` : ''
    })`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Every principle has last_validated set
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== last_validated present on every principle ===');

{
  const all: Principle[] = [
    ...UNIVERSAL,
    ...SPREAD_MARKET,
    ...TOTAL_MARKET,
    ...MONEYLINE_MARKET,
    ...NBA,
    ...NCAAB,
    ...NFL,
    ...NCAAF,
    ...MLB,
    ...NHL,
    ...WNBA,
  ];
  const missing = all.filter((p) => !p.last_validated);
  assert(missing.length === 0, `All ${all.length} principles have last_validated set`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Composition ordering — getPrinciplesFor returns universal, then market, then sport
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Composition ordering ===');

{
  const r = getPrinciplesFor('spread', 'NHL');
  assertEqual(r[0].bucket, 'universal', 'First principle is from universal bucket');
  assertEqual(r[UNIVERSAL.length].bucket, 'market', 'After universal comes market bucket');
  assertEqual(
    r[UNIVERSAL.length + SPREAD_MARKET.length].bucket,
    'sport',
    'After market comes sport bucket'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`Principles Index Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All principles index tests passed');
}
