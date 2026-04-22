// ══════════════════════════════════════════════════════════════════════════════
//  compute-hsa-score cent-line fixture tests
//
//  The compute-hsa-score scoring function `scoreBreadth()` lives inside a Deno
//  edge function that cannot be directly imported under tsx. These tests
//  exercise the exact call-shape used by the edge function at index.ts:137-143
//  against the cent-line primitive.
//
//  Run: npx tsx api/__tests__/compute-hsa-score.cent-line.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { centMove } from '../lib/hsa/odds/cent-line';

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

// Mirror of the exact guard+compute shape at
// supabase/functions/compute-hsa-score/index.ts:137-143
function breadthBonus(
  firstSpread: number | null,
  lastSpread: number | null,
  firstMlHome: number | null,
  lastMlHome: number | null
): number {
  if (firstMlHome == null || lastMlHome == null || firstSpread == null || lastSpread == null) {
    return 0;
  }
  const spreadMove = lastSpread - firstSpread;
  const mlMove = centMove(firstMlHome, lastMlHome);
  if (Math.sign(spreadMove) === Math.sign(mlMove) && Math.abs(mlMove) >= 5) {
    return 5;
  }
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sign-flip cases — the cases that the old raw-subtraction bug corrupted.
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Sign-flip with real meaningful move passes ===');
// spread -2.5 → -3.5 (home getting more favored: negative direction, Math.sign = -1)
// ML -110 → -125 (home getting more favored: Math.sign(centMove(-110,-125)) = -1, abs = 15)
// Before fix: raw was -15, still passed. Regression sanity.
assertEqual(breadthBonus(-2.5, -3.5, -110, -125), 5, 'same-sign favored: spread + ML move both toward home (bonus=5)');

// Edge case: ML crosses sign with real 20-cent move, spread also moves toward away
// spread +2.5 → +3.5 (toward away: Math.sign = +1)
// ML -110 → +110 (home weakening, centMove = +20, Math.sign = +1)
assertEqual(breadthBonus(+2.5, +3.5, -110, +110), 5, 'sign-flip: -110 → +110 with spread moving toward away (bonus=5)');

console.log('\n=== Below threshold does not award bonus ===');
// spread moves toward home, ML barely moves
// -110 → -108 under threshold 5
assertEqual(breadthBonus(-2.5, -3.5, -110, -108), 0, 'same-sign: ML delta 2c < 5 threshold (no bonus)');

// -110 → +105 (delta = 15 cents, same sign as spread toward away +1)
// But spread has to move same direction. If spread went toward home, Math.sign mismatches.
// spread -3 → -4 (home more favored, sign = -1), ML -110 → +105 (sign = +1 after centMove) → mismatch
assertEqual(breadthBonus(-3, -4, -110, +105), 0, 'sign-flip with mismatched spread direction (no bonus)');

console.log('\n=== Same-sign regression: old raw-subtraction path still correct ===');
// Both values on favorite side
assertEqual(breadthBonus(-2.5, -4, -180, -200), 5, 'regression: -180 → -200, spread -2.5 → -4 (bonus=5)');
// Both values on dog side
assertEqual(breadthBonus(+2.5, +4, +140, +160), 5, 'regression: +140 → +160, spread +2.5 → +4 (bonus=5)');

console.log('\n=== Null guards preserved ===');
assertEqual(breadthBonus(null, -3, -110, +110), 0, 'null first.spread → no bonus (no crash)');
assertEqual(breadthBonus(-2, -3, null, +110), 0, 'null first.moneyline_home → no bonus (no crash)');

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`compute-hsa-score cent-line tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All compute-hsa-score cent-line tests passed');
}
