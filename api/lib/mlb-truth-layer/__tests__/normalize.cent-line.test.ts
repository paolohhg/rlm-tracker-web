// ══════════════════════════════════════════════════════════════════════════════
//  mlb-truth-layer normalize cent-line fixtures
//
//  Exercises the three centMove() wiring sites in normalize.ts:
//    - home_delta / away_delta (lines 117-118)
//    - favorite_price_delta (line 163)
//    - overPriceDelta / underPriceDelta (lines 188-189)
//
//  Run: npx tsx api/lib/mlb-truth-layer/__tests__/normalize.cent-line.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import { normalizeMLBMarket } from '../normalize';
import type { RawOddsSnapshot } from '../types';

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

function snap(
  bookmaker: string,
  fetched_at: string,
  overrides: Partial<RawOddsSnapshot>
): RawOddsSnapshot {
  return {
    bookmaker,
    spread: -1.5,
    spread_home_price: -110,
    moneyline_home: 0,
    moneyline_away: 0,
    total: 8.5,
    total_over_price: -110,
    total_under_price: -110,
    fetched_at,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// home_delta / away_delta — ML sign-flip
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== ML home_delta / away_delta (sign-flip) ===');
{
  // All 4 books post identical -110 open on home and +110 current — clean ±100 flip
  const books = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const snaps: RawOddsSnapshot[] = [];
  for (const b of books) {
    snaps.push(snap(b, '2026-04-20T10:00:00Z', { moneyline_home: -110, moneyline_away: +100 }));
    snaps.push(snap(b, '2026-04-20T22:00:00Z', { moneyline_home: +110, moneyline_away: -120 }));
  }
  const truth = normalizeMLBMarket(snaps, 'Home', 'Away', '2026-04-21T01:00:00Z');
  assertEqual(truth.market_state.moneyline.home_delta, 20, 'home_delta: -110 → +110 = 20');
  assertEqual(truth.market_state.moneyline.away_delta, -20, 'away_delta: +100 → -120 = -20 (dog shortening)');
}

console.log('\n=== ML home_delta same-sign regression ===');
{
  const books = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const snaps: RawOddsSnapshot[] = [];
  for (const b of books) {
    snaps.push(snap(b, '2026-04-20T10:00:00Z', { moneyline_home: -180, moneyline_away: +160 }));
    snaps.push(snap(b, '2026-04-20T22:00:00Z', { moneyline_home: -165, moneyline_away: +145 }));
  }
  const truth = normalizeMLBMarket(snaps, 'Home', 'Away', '2026-04-21T01:00:00Z');
  assertEqual(truth.market_state.moneyline.home_delta, 15, 'regression: -180 → -165 = 15');
  assertEqual(truth.market_state.moneyline.away_delta, -15, 'regression: +160 → +145 = -15');
}

// ──────────────────────────────────────────────────────────────────────────────
// favorite_price_delta — run-line juice sign-flip
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Run-line favorite_price_delta (sign-flip) ===');
{
  // Home is favorite (moneyline_home < 0); run line spread_home_price flips across ±100
  const books = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const snaps: RawOddsSnapshot[] = [];
  for (const b of books) {
    snaps.push(snap(b, '2026-04-20T10:00:00Z', {
      moneyline_home: -160,
      moneyline_away: +140,
      spread: 1.5,        // home favorite lays the runs
      spread_home_price: -110,
    }));
    snaps.push(snap(b, '2026-04-20T22:00:00Z', {
      moneyline_home: -160,
      moneyline_away: +140,
      spread: 1.5,
      spread_home_price: +110,
    }));
  }
  const truth = normalizeMLBMarket(snaps, 'Home', 'Away', '2026-04-21T01:00:00Z');
  assertEqual(truth.market_state.run_line.favorite_price_delta, 20, 'favorite_price_delta: -110 → +110 = 20');
}

// ──────────────────────────────────────────────────────────────────────────────
// Over/under price deltas — total juice sign-flip
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Total juice delta carries cent semantics ===');
{
  // Total number stays 8.5; juice moves across ±100 on the over side
  const books = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const snaps: RawOddsSnapshot[] = [];
  for (const b of books) {
    snaps.push(snap(b, '2026-04-20T10:00:00Z', {
      total: 8.5,
      total_over_price: -105,
      total_under_price: -115,
    }));
    snaps.push(snap(b, '2026-04-20T22:00:00Z', {
      total: 8.5,
      total_over_price: +105,
      total_under_price: -130,
    }));
  }
  const truth = normalizeMLBMarket(snaps, 'Home', 'Away', '2026-04-21T01:00:00Z');
  // over: -105 → +105 cent-line delta = +10
  // under: -115 → -130 cent-line delta = -15
  // juiceShiftOnly uses Math.abs on both — surfaces via number_moved=false and the
  // juice fields that feed signal.ts.
  // Truth layer doesn't expose overPriceDelta/underPriceDelta directly (they go
  // into juice_shift_only). Cross-check via total.juice_shift_only being true.
  assertEqual(truth.market_state.total.juice_shift_only, true, 'juice_shift_only=true when either delta crosses 5c post-centMove');
}

console.log('\n=== Regression: same-sign total juice below threshold no-ops ===');
{
  const books = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const snaps: RawOddsSnapshot[] = [];
  for (const b of books) {
    snaps.push(snap(b, '2026-04-20T10:00:00Z', {
      total: 8.5,
      total_over_price: -110,
      total_under_price: -110,
    }));
    snaps.push(snap(b, '2026-04-20T22:00:00Z', {
      total: 8.5,
      total_over_price: -112,
      total_under_price: -108,
    }));
  }
  const truth = normalizeMLBMarket(snaps, 'Home', 'Away', '2026-04-21T01:00:00Z');
  assertEqual(truth.market_state.total.juice_shift_only, false, 'regression: sub-5c per-side delta stays below juice_shift_only gate');
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`mlb-truth-layer normalize cent-line tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All mlb-truth-layer normalize cent-line tests passed');
}
