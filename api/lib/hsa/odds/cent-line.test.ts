// ══════════════════════════════════════════════════════════════════════════════
//  Cent-line utility tests
//
//  Run: npx tsx api/lib/hsa/odds/cent-line.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { toCentLine, centMove } from './cent-line';

let passed = 0;
let failed = 0;

function assertEqual(actual: number, expected: number, testName: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName} — expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn: () => unknown, testName: string) {
  try {
    fn();
    failed++;
    console.error(`  ✗ FAIL: ${testName} — expected throw, none thrown`);
  } catch {
    passed++;
    console.log(`  ✓ ${testName}`);
  }
}

// ── toCentLine fixtures ─────────────────────────────────────────────────────
console.log('\ntoCentLine:');
assertEqual(toCentLine(100), 0, '+100 → 0');
assertEqual(toCentLine(-100), 0, '-100 → 0');
assertEqual(toCentLine(110), 10, '+110 → 10');
assertEqual(toCentLine(-110), -10, '-110 → -10');
assertEqual(toCentLine(150), 50, '+150 → 50');
assertEqual(toCentLine(-150), -50, '-150 → -50');
assertEqual(toCentLine(200), 100, '+200 → 100');
assertEqual(toCentLine(-200), -100, '-200 → -100');
assertEqual(toCentLine(500), 400, '+500 → 400');
assertEqual(toCentLine(-500), -400, '-500 → -400');
assertThrows(() => toCentLine(99), '+99 → throws');
assertThrows(() => toCentLine(-99), '-99 → throws');
assertThrows(() => toCentLine(0), '0 → throws');
assertThrows(() => toCentLine(50), '50 → throws');
assertThrows(() => toCentLine(-50), '-50 → throws');

// ── centMove fixtures ───────────────────────────────────────────────────────
console.log('\ncentMove:');
assertEqual(centMove(-110, 110), 20, '(-110, +110) → 20  [sign flip, real 20-cent move]');
assertEqual(centMove(110, -110), -20, '(+110, -110) → -20');
assertEqual(centMove(-105, 105), 10, '(-105, +105) → 10  [sign flip, real 10-cent move]');
assertEqual(centMove(105, -105), -10, '(+105, -105) → -10');
assertEqual(centMove(140, 155), 15, '(+140, +155) → 15  [dog price lengthens = money on fav]');
assertEqual(centMove(-180, -165), 15, '(-180, -165) → 15  [fav juice shortens = money on dog]');
assertEqual(centMove(-200, -150), 50, '(-200, -150) → 50  [fav juice reduces by 50 cents]');
assertEqual(centMove(-150, -200), -50, '(-150, -200) → -50');
assertEqual(centMove(-110, -110), 0, '(-110, -110) → 0');
assertEqual(centMove(100, -100), 0, '(+100, -100) → 0');
assertEqual(centMove(-100, 100), 0, '(-100, +100) → 0');

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`Cent-line tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All cent-line tests passed');
}
