// ══════════════════════════════════════════════════════════════════════════════
//  generate-hsa cent-line fixture tests
//
//  Covers ML-delta computations inside api/generate-hsa.ts that now route
//  through centMove(). The computations are embedded in the Vercel handler
//  (not exported), so these tests verify the call-shape semantics directly
//  against the cent-line primitive and the per-book helper pattern used
//  inside the handler.
//
//  Run: npx tsx api/__tests__/generate-hsa.cent-line.test.ts
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

// ──────────────────────────────────────────────────────────────────────────────
// Site 1a: mlHomeMovement / mlAwayMovement use centMove(open, current)
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 1a: consensus ML movement (sign-flip) ===');
{
  // mlHomeMovement when openingConsensusMlHome=-110, current=+110 → 20
  const openingConsensusMlHome = -110;
  const currentConsensusMlHome = +110;
  const mlHomeMovement = (openingConsensusMlHome !== 0 && currentConsensusMlHome !== 0)
    ? centMove(openingConsensusMlHome, currentConsensusMlHome)
    : 0;
  assertEqual(mlHomeMovement, 20, 'mlHomeMovement: -110 → +110 = 20');
}
{
  // mlAwayMovement equivalent: -120 → +115
  const openingConsensusMlAway = -120;
  const currentConsensusMlAway = +115;
  const mlAwayMovement = (openingConsensusMlAway !== 0 && currentConsensusMlAway !== 0)
    ? centMove(openingConsensusMlAway, currentConsensusMlAway)
    : 0;
  assertEqual(mlAwayMovement, 35, 'mlAwayMovement: -120 → +115 = 35');
}

console.log('\n=== Site 1a: same-sign regression ===');
{
  // Same-sign case that old raw subtraction got right by accident:
  // opening=-180, current=-165 → 15
  const openingConsensusMlHome = -180;
  const currentConsensusMlHome = -165;
  const mlHomeMovement = (openingConsensusMlHome !== 0 && currentConsensusMlHome !== 0)
    ? centMove(openingConsensusMlHome, currentConsensusMlHome)
    : 0;
  assertEqual(mlHomeMovement, 15, 'regression: -180 → -165 = 15');
}
{
  // Same-sign dog strengthening: +140 → +155 = 15
  const openingConsensusMlAway = +140;
  const currentConsensusMlAway = +155;
  const mlAwayMovement = (openingConsensusMlAway !== 0 && currentConsensusMlAway !== 0)
    ? centMove(openingConsensusMlAway, currentConsensusMlAway)
    : 0;
  assertEqual(mlAwayMovement, 15, 'regression: +140 → +155 = 15');
}

console.log('\n=== Site 1a: zero-guard still returns 0 ===');
{
  const mlHomeMovement = (0 !== 0 && 110 !== 0) ? centMove(0, 110) : 0;
  assertEqual(mlHomeMovement, 0, 'missing open ML → movement = 0 (no throw)');
}

// ──────────────────────────────────────────────────────────────────────────────
// Site 1b: per-book `move` field uses centMove for moneyline markets
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 1b: per-book move (market-gated) ===');
{
  const market: 'moneyline' | 'spread' | 'total' = 'moneyline';
  const openLine = -110;
  const currentLine = +110;
  const move = market === 'moneyline'
    ? centMove(openLine, currentLine)
    : (currentLine - openLine);
  assertEqual(move, 20, 'moneyline market: -110 → +110 = 20');
}
{
  const market: 'moneyline' | 'spread' | 'total' = 'spread';
  const openLine = -3.5;
  const currentLine = -2.5;
  const move = market === 'moneyline'
    ? centMove(openLine, currentLine)
    : (currentLine - openLine);
  assertEqual(move, 1, 'spread market: -3.5 → -2.5 = 1 (raw sub preserved)');
}
{
  const market: 'moneyline' | 'spread' | 'total' = 'total';
  const openLine = 220.5;
  const currentLine = 222;
  const move = market === 'moneyline'
    ? centMove(openLine, currentLine)
    : (currentLine - openLine);
  assertEqual(move, 1.5, 'total market: 220.5 → 222 = 1.5 (raw sub preserved)');
}

// ──────────────────────────────────────────────────────────────────────────────
// Site 1c: per-book MLB moneyline block uses centMove
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 1c: per-book MLB ML detail block ===');
{
  const ob = { mlHome: -105, mlAway: -115 };
  const cb = { mlHome: +105, mlAway: -100 };
  const homeMove = centMove(ob.mlHome, cb.mlHome);
  const awayMove = centMove(ob.mlAway, cb.mlAway);
  assertEqual(homeMove, 10, 'homeMove: -105 → +105 = 10 (sign-flip)');
  assertEqual(awayMove, 15, 'awayMove: -115 → -100 = 15 (same-sign regression)');
}
{
  // Regression: a "held" book where both sides moved <3 cents
  const ob = { mlHome: -150, mlAway: +130 };
  const cb = { mlHome: -151, mlAway: +131 };
  const homeMove = centMove(ob.mlHome, cb.mlHome);
  const awayMove = centMove(ob.mlAway, cb.mlAway);
  const moved = Math.abs(homeMove) >= 3 || Math.abs(awayMove) >= 3;
  assertEqual(moved, false, 'regression: tiny per-book move still classifies as HELD');
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`generate-hsa cent-line tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All generate-hsa cent-line tests passed');
}
