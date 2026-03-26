// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Normalization
//
//  Converts raw odds_snapshots into the canonical MlbTruthObject.
//  All downstream consumers (HSA writer, signal engine, dashboard)
//  must use this normalized form — never raw snapshots.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  RawOddsSnapshot,
  MlbTruthObject,
  MlbMoneyline,
  MlbRunLine,
  MlbTotal,
  MlbBookLine,
  MlbMarketSide,
  MlbDerivedTruth,
  MlbStartingPitchers,
} from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** MODE consensus — most common value, never averaged */
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

const BOOK_DISPLAY: Record<string, string> = {
  draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM',
  pinnacle: 'Pinnacle', caesars: 'Caesars', pointsbetus: 'PointsBet',
  espnbet: 'ESPNBet', fanatics: 'Fanatics',
};

function displayBook(raw: string): string {
  return BOOK_DISPLAY[raw.toLowerCase()] || raw;
}

// ── Main Normalizer ──────────────────────────────────────────────────────────

export function normalizeMlbMarket(
  snapshots: RawOddsSnapshot[],
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  pitchers?: MlbStartingPitchers,
): MlbTruthObject {
  if (!snapshots.length) {
    return emptyTruthObject(homeTeam, awayTeam, gameTime, pitchers);
  }

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
  );

  const firstTime = sorted[0].fetched_at;
  const lastTime = sorted[sorted.length - 1].fetched_at;
  const trackingHours = Math.round(
    (new Date(lastTime).getTime() - new Date(firstTime).getTime()) / 3600000 * 10
  ) / 10;

  // Build per-book opening and current snapshots
  const openByBook: Record<string, RawOddsSnapshot> = {};
  const currByBook: Record<string, RawOddsSnapshot> = {};
  for (const s of sorted) {
    if (!openByBook[s.bookmaker]) openByBook[s.bookmaker] = s;
    currByBook[s.bookmaker] = s;
  }

  // ── Moneyline ────────────────────────────────────────────────
  const mlHome = buildMarketSide(openByBook, currByBook, s => s.moneyline_home, null);
  const mlAway = buildMarketSide(openByBook, currByBook, s => s.moneyline_away, null);

  const consensusFav: 'home' | 'away' =
    mlHome.current !== 0 && mlAway.current !== 0
      ? (mlHome.current < mlAway.current ? 'home' : 'away')  // more negative = favorite
      : (mlHome.current < 0 ? 'home' : 'away');

  const moneyline: MlbMoneyline = {
    home: mlHome,
    away: mlAway,
    consensus_favorite: consensusFav,
    consensus_favorite_ml: consensusFav === 'home' ? mlHome.current : mlAway.current,
    consensus_underdog_ml: consensusFav === 'home' ? mlAway.current : mlHome.current,
  };

  // ── Run Line ─────────────────────────────────────────────────
  // Canonical: favorite is ALWAYS -1.5, underdog is ALWAYS +1.5
  const favoriteTeam = consensusFav === 'home' ? homeTeam : awayTeam;
  const underdogTeam = consensusFav === 'home' ? awayTeam : homeTeam;

  // Get run line prices (juice) — normalize so favorite always has -1.5 perspective
  const rlFavPrices = buildRunLinePrices(openByBook, currByBook, consensusFav === 'home');
  const rlDogPrices = buildRunLinePrices(openByBook, currByBook, consensusFav !== 'home');

  // Check for alt lines (non-1.5 run lines)
  const allSpreads = Object.values(currByBook)
    .map(s => Math.abs(s.spread))
    .filter(s => s > 0);
  const hasAltLine = allSpreads.some(s => s !== 1.5);

  const runLine: MlbRunLine = {
    favorite_team: favoriteTeam,
    underdog_team: underdogTeam,
    favorite_rl: -1.5,
    underdog_rl: 1.5,
    favorite_price_open: rlFavPrices.openPrice,
    favorite_price_current: rlFavPrices.currPrice,
    favorite_price_delta: rlFavPrices.priceDelta,
    underdog_price_open: rlDogPrices.openPrice,
    underdog_price_current: rlDogPrices.currPrice,
    underdog_price_delta: rlDogPrices.priceDelta,
    has_alt_line: hasAltLine,
    books_reporting: Object.keys(currByBook).filter(
      b => currByBook[b].spread !== 0
    ).length,
  };

  // ── Total ────────────────────────────────────────────────────
  const totalSide = buildMarketSide(openByBook, currByBook, s => s.total, s => s.total_over_price);
  const overPriceOpen = getFirstNonZero(openByBook, s => s.total_over_price);
  const overPriceCurr = getLastNonZero(currByBook, s => s.total_over_price);

  const total: MlbTotal = {
    open: totalSide.open,
    current: totalSide.current,
    number_delta: totalSide.delta,
    direction: Math.abs(totalSide.delta) < 0.25 ? 'stable'
      : totalSide.delta > 0 ? 'over' : 'under',
    over_price_open: overPriceOpen,
    over_price_current: overPriceCurr,
    over_price_delta: (overPriceOpen != null && overPriceCurr != null)
      ? overPriceCurr - overPriceOpen : 0,
    books_reporting: totalSide.books_reporting,
    books: totalSide.books,
  };

  // ── Derived Truth ────────────────────────────────────────────
  const mlMoved = Math.abs(mlHome.delta) >= 5 || Math.abs(mlAway.delta) >= 5;
  const totalMoved = Math.abs(total.number_delta) >= 0.5;

  const derivedTruth: MlbDerivedTruth = {
    favorite_team: favoriteTeam,
    underdog_team: underdogTeam,
    run_line_consistent_with_moneyline: true, // We enforce this via normalization
    primary_market: 'moneyline',
    market_regime: mlMoved && totalMoved ? 'both_moving'
      : mlMoved ? 'ml_moving'
        : totalMoved ? 'total_moving'
          : 'stable',
  };

  return {
    sport: 'MLB',
    event_id: `MLB|${homeTeam}|${awayTeam}|${gameTime}`,
    home_team: homeTeam,
    away_team: awayTeam,
    game_time: gameTime,
    tracking_hours: trackingHours,
    snapshot_count: snapshots.length,
    starting_pitchers: pitchers ?? { home: null, away: null, confirmed: false },
    moneyline,
    run_line: runLine,
    total,
    derived_truth: derivedTruth,
    signal_summary: {
      side: { type: 'PASS', confidence: 'Low', direction: '', primary_market: 'moneyline', factors: [] },
      total: { type: 'PASS', confidence: 'Low', direction: 'stable', factors: [] },
      status: 'PASS',
    },
    validation: { is_valid: true, errors: [], warnings: [] },
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
  };
}

// ── Build Helpers ────────────────────────────────────────────────────────────

function buildMarketSide(
  openByBook: Record<string, RawOddsSnapshot>,
  currByBook: Record<string, RawOddsSnapshot>,
  getValue: (s: RawOddsSnapshot) => number,
  getPrice: ((s: RawOddsSnapshot) => number) | null,
): MlbMarketSide {
  const openValues = Object.values(openByBook)
    .map(s => getValue(s))
    .filter(v => v !== 0 && v != null);
  const currValues = Object.values(currByBook)
    .map(s => getValue(s))
    .filter(v => v !== 0 && v != null);

  const openConsensus = openValues.length ? mode(openValues) : 0;
  const currConsensus = currValues.length ? mode(currValues) : 0;

  const books: MlbBookLine[] = Object.entries(currByBook)
    .filter(([, s]) => getValue(s) !== 0 && getValue(s) != null)
    .map(([book, s]) => ({
      book: displayBook(book),
      value: getValue(s),
      price: getPrice ? getPrice(s) : null,
      timestamp: s.fetched_at,
    }));

  return {
    open: openConsensus,
    current: currConsensus,
    delta: (openConsensus !== 0 && currConsensus !== 0) ? currConsensus - openConsensus : 0,
    books,
    books_reporting: books.length,
  };
}

function buildRunLinePrices(
  openByBook: Record<string, RawOddsSnapshot>,
  currByBook: Record<string, RawOddsSnapshot>,
  isHome: boolean,
): { openPrice: number | null; currPrice: number | null; priceDelta: number } {
  const getPrice = (s: RawOddsSnapshot) => isHome ? s.spread_home_price : 0; // away price not stored directly

  const openPrices = Object.values(openByBook)
    .map(s => getPrice(s))
    .filter(v => v !== 0 && v != null);
  const currPrices = Object.values(currByBook)
    .map(s => getPrice(s))
    .filter(v => v !== 0 && v != null);

  const openPrice = openPrices.length ? mode(openPrices) : null;
  const currPrice = currPrices.length ? mode(currPrices) : null;

  return {
    openPrice,
    currPrice,
    priceDelta: (openPrice != null && currPrice != null) ? currPrice - openPrice : 0,
  };
}

function getFirstNonZero(
  byBook: Record<string, RawOddsSnapshot>,
  getValue: (s: RawOddsSnapshot) => number,
): number | null {
  for (const s of Object.values(byBook)) {
    const v = getValue(s);
    if (v !== 0 && v != null) return v;
  }
  return null;
}

function getLastNonZero(
  byBook: Record<string, RawOddsSnapshot>,
  getValue: (s: RawOddsSnapshot) => number,
): number | null {
  const entries = Object.values(byBook);
  for (let i = entries.length - 1; i >= 0; i--) {
    const v = getValue(entries[i]);
    if (v !== 0 && v != null) return v;
  }
  return null;
}

function emptyTruthObject(
  homeTeam: string, awayTeam: string, gameTime: string,
  pitchers?: MlbStartingPitchers,
): MlbTruthObject {
  const emptySide: MlbMarketSide = { open: 0, current: 0, delta: 0, books: [], books_reporting: 0 };
  return {
    sport: 'MLB', event_id: `MLB|${homeTeam}|${awayTeam}|${gameTime}`,
    home_team: homeTeam, away_team: awayTeam, game_time: gameTime,
    tracking_hours: 0, snapshot_count: 0,
    starting_pitchers: pitchers ?? { home: null, away: null, confirmed: false },
    moneyline: { home: emptySide, away: emptySide, consensus_favorite: 'home', consensus_favorite_ml: 0, consensus_underdog_ml: 0 },
    run_line: { favorite_team: homeTeam, underdog_team: awayTeam, favorite_rl: -1.5, underdog_rl: 1.5, favorite_price_open: null, favorite_price_current: null, favorite_price_delta: 0, underdog_price_open: null, underdog_price_current: null, underdog_price_delta: 0, has_alt_line: false, books_reporting: 0 },
    total: { open: 0, current: 0, number_delta: 0, direction: 'stable', over_price_open: null, over_price_current: null, over_price_delta: 0, books_reporting: 0, books: [] },
    derived_truth: { favorite_team: homeTeam, underdog_team: awayTeam, run_line_consistent_with_moneyline: true, primary_market: 'moneyline', market_regime: 'stable' },
    signal_summary: { side: { type: 'PASS', confidence: 'Low', direction: '', primary_market: 'moneyline', factors: [] }, total: { type: 'PASS', confidence: 'Low', direction: 'stable', factors: [] }, status: 'PASS' },
    validation: { is_valid: false, errors: ['No snapshot data available'], warnings: [] },
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
  };
}
