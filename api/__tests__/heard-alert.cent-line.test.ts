// ══════════════════════════════════════════════════════════════════════════════
//  heard-alert cent-line fixtures
//
//  Covers the five wiring sites in supabase/functions/detect-rlm/heard-alert.ts:
//    5a: calcMLDelta() now routes through centMove
//    5b: getLeadingBook() direction filter
//    5c: detectRetrace() direction filter (dormant; coverage for future re-enable)
//    5d: deltas[] construction — delta / absDelta / moved all cent-line
//    5e: avgDelta — per-book cent-moves averaged, not averaged-then-subtracted
//
//  The edge function uses Deno-style imports ("../../../api/lib/hsa/..."),
//  so we import the Node-resolvable copies directly here and exercise the
//  exported helpers. The 5e refactor is covered by a local mirror of the
//  exact shape in index.ts:260-272.
//
//  Run: npx tsx api/__tests__/heard-alert.cent-line.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { centMove } from '../lib/hsa/odds/cent-line';
import { calcMLDelta, getLeadingBook, detectRetrace } from '../../supabase/functions/detect-rlm/heard-alert';

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
// Site 5a: calcMLDelta — sign-flip correctness
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 5a: calcMLDelta ===');
assertEqual(calcMLDelta(-110, +110), 20, '-110 → +110 = 20 (sign-flip)');
assertEqual(calcMLDelta(+110, -110), 20, '+110 → -110 = 20 (sign-flip)');
assertEqual(calcMLDelta(-180, -165), 15, 'regression: same-sign favorite → 15');
assertEqual(calcMLDelta(+140, +155), 15, 'regression: same-sign dog → 15');
assertEqual(calcMLDelta(-110, -110), 0, 'no move → 0');

// ──────────────────────────────────────────────────────────────────────────────
// Site 5b: getLeadingBook — movers survive sign-flip
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 5b: getLeadingBook direction filter ===');
{
  // All books moved in the same direction (away/positive consensus), pinnacle first
  const bookMoves = [
    { book: 'pinnacle', openML: -110, currML: +110, firstAt: '2026-04-20T10:00:00Z', lastAt: '2026-04-20T10:30:00Z' },
    { book: 'draftkings', openML: -105, currML: +105, firstAt: '2026-04-20T10:00:00Z', lastAt: '2026-04-20T11:00:00Z' },
    { book: 'fanduel', openML: -108, currML: +102, firstAt: '2026-04-20T10:00:00Z', lastAt: '2026-04-20T11:15:00Z' },
  ];
  const r = getLeadingBook(bookMoves, +1);
  assertEqual(r.leader, 'pinnacle', 'leader is earliest mover (pinnacle) after sign-flip');
  assertEqual(r.isSharp, true, 'pinnacle leading marks isSharp=true');
  assertEqual(r.followerBooks.length, 2, 'two follower books after pinnacle');
}
{
  // A book that moved the wrong way is excluded
  const bookMoves = [
    { book: 'pinnacle', openML: -110, currML: +110, firstAt: '2026-04-20T10:00:00Z', lastAt: '2026-04-20T10:30:00Z' },
    { book: 'bad-book', openML: +105, currML: -105, firstAt: '2026-04-20T10:00:00Z', lastAt: '2026-04-20T10:45:00Z' },
  ];
  const r = getLeadingBook(bookMoves, +1);
  assertEqual(r.leader, 'pinnacle', 'wrong-direction book excluded from movers');
}

// ──────────────────────────────────────────────────────────────────────────────
// Site 5c: detectRetrace — dormant but wired
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 5c: detectRetrace (always-false stub, sign-flip safe) ===');
{
  const bookMoves = [
    { book: 'pinnacle', openML: -110, currML: +110 },
    { book: 'draftkings', openML: -105, currML: +105 },
  ];
  assertEqual(detectRetrace(bookMoves, +1), false, 'stub returns false (unchanged semantics)');
}

// ──────────────────────────────────────────────────────────────────────────────
// Site 5e: avgDelta — per-book cent-moves averaged
// Mirror of the refactored shape in heard-alert.ts:260-272.
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Site 5e: per-book avgDelta ===');
{
  // All 4 books flip from -110 to +110 cleanly → each contributes +20; avg = 20
  const bookMLs = [
    { book: 'pinnacle', openML: -110, currML: +110 },
    { book: 'draftkings', openML: -110, currML: +110 },
    { book: 'fanduel', openML: -110, currML: +110 },
    { book: 'betmgm', openML: -110, currML: +110 },
  ];
  const perBookDeltas = bookMLs.map(b => centMove(b.openML, b.currML));
  const avgDelta = Math.abs(perBookDeltas.reduce((s, d) => s + d, 0) / perBookDeltas.length);
  assertEqual(avgDelta, 20, 'uniform sign-flip across 4 books → avgDelta = 20');
}
{
  // Mixed magnitudes but all same direction
  const bookMLs = [
    { book: 'a', openML: -110, currML: +105 },  // +15
    { book: 'b', openML: -110, currML: +110 },  // +20
    { book: 'c', openML: -108, currML: +102 },  // +10
    { book: 'd', openML: -115, currML: +115 },  // +30
  ];
  const perBookDeltas = bookMLs.map(b => centMove(b.openML, b.currML));
  const avgDelta = Math.abs(perBookDeltas.reduce((s, d) => s + d, 0) / perBookDeltas.length);
  assertEqual(avgDelta, 18.75, 'mixed-magnitude signflips: avg of per-book centMove = 18.75');
}
{
  // Regression: same-sign moves (old raw-math worked by accident)
  const bookMLs = [
    { book: 'a', openML: -180, currML: -170 }, // +10
    { book: 'b', openML: -175, currML: -165 }, // +10
    { book: 'c', openML: -185, currML: -175 }, // +10
    { book: 'd', openML: -190, currML: -180 }, // +10
  ];
  const perBookDeltas = bookMLs.map(b => centMove(b.openML, b.currML));
  const avgDelta = Math.abs(perBookDeltas.reduce((s, d) => s + d, 0) / perBookDeltas.length);
  assertEqual(avgDelta, 10, 'regression: uniform same-sign move → avgDelta = 10');
}
{
  // Divergence between the old "average-then-subtract" path and the new
  // "per-book-centMove-then-average" path. All books move ~25 cents across
  // the ±100 boundary in the same direction. Old path inflates to ~225.
  const bookMLs = [
    { book: 'a', openML: -110, currML: +110 }, // +20
    { book: 'b', openML: -115, currML: +115 }, // +30
  ];
  const perBookDeltas = bookMLs.map(b => centMove(b.openML, b.currML));
  const avgDelta = Math.abs(perBookDeltas.reduce((s, d) => s + d, 0) / perBookDeltas.length);
  assertEqual(avgDelta, 25, 'new path: uniform sign-flips produce ~25c true consensus');

  // OLD broken path for the same input:
  const avgOpenHome = bookMLs.reduce((s, b) => s + b.openML, 0) / bookMLs.length;
  const avgCurrHome = bookMLs.reduce((s, b) => s + b.currML, 0) / bookMLs.length;
  const oldBrokenDelta = Math.abs(avgCurrHome - avgOpenHome);
  assertEqual(oldBrokenDelta, 225, 'old broken path: averaging first inflates to 225 cents (phantom)');
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`heard-alert cent-line tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All heard-alert cent-line tests passed');
}
