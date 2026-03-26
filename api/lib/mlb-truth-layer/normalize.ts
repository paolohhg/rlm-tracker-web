// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Normalization
//
//  Converts raw odds_snapshots into the canonical MlbTruthObject.
//  All downstream consumers must use this normalized form — never raw snapshots.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  RawOddsSnapshot,
  MlbTruthObject,
  MoneylineTruth,
  RunLineTruth,
  TotalTruth,
  DerivedTruth,
  MlbBookLine,
  PitcherInfo,
} from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function nonZero(v: number | null | undefined): v is number {
  return v != null && v !== 0;
}

// ── Main Normalizer ──────────────────────────────────────────────────────────

export function normalizeMLBMarket(
  snapshots: RawOddsSnapshot[],
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  pitchers?: PitcherInfo,
): MlbTruthObject {
  if (!snapshots.length) {
    return emptyTruth(homeTeam, awayTeam, gameTime, pitchers);
  }

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
  );

  const firstTime = sorted[0].fetched_at;
  const lastTime = sorted[sorted.length - 1].fetched_at;
  const trackingHours = Math.round(
    (new Date(lastTime).getTime() - new Date(firstTime).getTime()) / 3600000 * 10
  ) / 10;

  // Per-book opening (first seen) and current (last seen) snapshots
  const openByBook: Record<string, RawOddsSnapshot> = {};
  const currByBook: Record<string, RawOddsSnapshot> = {};
  for (const s of sorted) {
    if (!openByBook[s.bookmaker]) openByBook[s.bookmaker] = s;
    currByBook[s.bookmaker] = s;
  }

  // ── Moneyline ────────────────────────────────────────────────────
  const homeOpens = Object.values(openByBook).filter(s => nonZero(s.moneyline_home)).map(s => s.moneyline_home);
  const homeCurrs = Object.values(currByBook).filter(s => nonZero(s.moneyline_home)).map(s => s.moneyline_home);
  const awayOpens = Object.values(openByBook).filter(s => nonZero(s.moneyline_away)).map(s => s.moneyline_away);
  const awayCurrs = Object.values(currByBook).filter(s => nonZero(s.moneyline_away)).map(s => s.moneyline_away);

  const homeOpen = homeOpens.length ? mode(homeOpens) : null;
  const homeCurr = homeCurrs.length ? mode(homeCurrs) : null;
  const awayOpen = awayOpens.length ? mode(awayOpens) : null;
  const awayCurr = awayCurrs.length ? mode(awayCurrs) : null;

  // Consensus: which side is favorite?
  let consensusSide: 'home' | 'away' | 'mixed' | null = null;
  if (homeCurr != null && awayCurr != null) {
    if (homeCurr < 0 && awayCurr > 0) consensusSide = 'home';
    else if (awayCurr < 0 && homeCurr > 0) consensusSide = 'away';
    else if (homeCurr < 0 && awayCurr < 0) {
      // Both negative — the more negative is the favorite
      consensusSide = homeCurr < awayCurr ? 'home' : 'away';
    } else {
      consensusSide = 'mixed';
    }
  }

  const perBookHome: MlbBookLine[] = Object.entries(currByBook)
    .filter(([, s]) => nonZero(s.moneyline_home))
    .map(([b, s]) => ({ book: displayBook(b), value: s.moneyline_home, price: null, timestamp: s.fetched_at }));
  const perBookAway: MlbBookLine[] = Object.entries(currByBook)
    .filter(([, s]) => nonZero(s.moneyline_away))
    .map(([b, s]) => ({ book: displayBook(b), value: s.moneyline_away, price: null, timestamp: s.fetched_at }));

  const moneyline: MoneylineTruth = {
    home_open: homeOpen,
    home_current: homeCurr,
    away_open: awayOpen,
    away_current: awayCurr,
    home_delta: (homeOpen != null && homeCurr != null) ? homeCurr - homeOpen : 0,
    away_delta: (awayOpen != null && awayCurr != null) ? awayCurr - awayOpen : 0,
    books_reporting: perBookHome.length,
    consensus_side: consensusSide,
    per_book_home: perBookHome,
    per_book_away: perBookAway,
  };

  // ── Run Line ─────────────────────────────────────────────────────
  // Canonical: favorite ALWAYS -1.5, underdog ALWAYS +1.5.
  // Sign in raw data is perspective-dependent and must be ignored.
  const favoriteTeam = consensusSide === 'home' ? homeTeam
    : consensusSide === 'away' ? awayTeam : homeTeam; // default to home if mixed
  const underdogTeam = favoriteTeam === homeTeam ? awayTeam : homeTeam;
  const favIsHome = favoriteTeam === homeTeam;

  // Get run line prices (juice). The spread_home_price is always from home perspective.
  const rlFavPriceOpens = Object.values(openByBook)
    .filter(s => nonZero(s.spread) && Math.abs(s.spread) === 1.5)
    .map(s => favIsHome ? s.spread_home_price : 0)
    .filter(nonZero);
  const rlFavPriceCurrs = Object.values(currByBook)
    .filter(s => nonZero(s.spread) && Math.abs(s.spread) === 1.5)
    .map(s => favIsHome ? s.spread_home_price : 0)
    .filter(nonZero);

  const rlFavPriceOpen = rlFavPriceOpens.length ? mode(rlFavPriceOpens) : null;
  const rlFavPriceCurr = rlFavPriceCurrs.length ? mode(rlFavPriceCurrs) : null;

  // Check if any book has a non-1.5 run line (actual line movement)
  const allSpreads = Object.values(currByBook).map(s => Math.abs(s.spread)).filter(nonZero);
  const lineChanged = allSpreads.some(s => s !== 1.5);
  const priceChanged = (rlFavPriceOpen != null && rlFavPriceCurr != null)
    ? Math.abs(rlFavPriceCurr - rlFavPriceOpen) >= 5 : false;

  const rlBooksReporting = Object.values(currByBook).filter(s => nonZero(s.spread)).length;

  const runLine: RunLineTruth = {
    favored_team: favoriteTeam,
    underdog_team: underdogTeam,
    favorite_rl: -1.5,
    underdog_rl: 1.5,
    open_favorite_price: rlFavPriceOpen,
    current_favorite_price: rlFavPriceCurr,
    open_dog_price: null, // away price not stored in current schema
    current_dog_price: null,
    favorite_price_delta: (rlFavPriceOpen != null && rlFavPriceCurr != null) ? rlFavPriceCurr - rlFavPriceOpen : 0,
    underdog_price_delta: 0,
    books_reporting: rlBooksReporting,
    line_changed: lineChanged,
    price_changed: priceChanged,
  };

  // ── Total ────────────────────────────────────────────────────────
  const totalOpens = Object.values(openByBook).filter(s => nonZero(s.total)).map(s => s.total);
  const totalCurrs = Object.values(currByBook).filter(s => nonZero(s.total)).map(s => s.total);
  const totalOpen = totalOpens.length ? mode(totalOpens) : null;
  const totalCurr = totalCurrs.length ? mode(totalCurrs) : null;
  const totalNumDelta = (totalOpen != null && totalCurr != null) ? totalCurr - totalOpen : 0;

  const overPriceOpens = Object.values(openByBook).filter(s => nonZero(s.total_over_price)).map(s => s.total_over_price);
  const overPriceCurrs = Object.values(currByBook).filter(s => nonZero(s.total_over_price)).map(s => s.total_over_price);
  const underPriceOpens = Object.values(openByBook).filter(s => nonZero(s.total_under_price)).map(s => s.total_under_price!);
  const underPriceCurrs = Object.values(currByBook).filter(s => nonZero(s.total_under_price)).map(s => s.total_under_price!);

  const overPriceOpen = overPriceOpens.length ? mode(overPriceOpens) : null;
  const overPriceCurr = overPriceCurrs.length ? mode(overPriceCurrs) : null;
  const underPriceOpen = underPriceOpens.length ? mode(underPriceOpens) : null;
  const underPriceCurr = underPriceCurrs.length ? mode(underPriceCurrs) : null;

  const numberMoved = Math.abs(totalNumDelta) >= 0.5;
  const overPriceDelta = (overPriceOpen != null && overPriceCurr != null) ? overPriceCurr - overPriceOpen : 0;
  const underPriceDelta = (underPriceOpen != null && underPriceCurr != null) ? underPriceCurr - underPriceOpen : 0;
  const juiceShiftOnly = !numberMoved && (Math.abs(overPriceDelta) >= 5 || Math.abs(underPriceDelta) >= 5);

  // Direction logic — check if books disagree for 'mixed'
  let totalDirection: 'up' | 'down' | 'flat' | 'mixed' = 'flat';
  if (numberMoved) {
    const bookDirections = Object.entries(currByBook)
      .filter(([b]) => openByBook[b] && nonZero(openByBook[b].total) && nonZero(currByBook[b].total))
      .map(([b]) => Math.sign(currByBook[b].total - openByBook[b].total));
    const ups = bookDirections.filter(d => d > 0).length;
    const downs = bookDirections.filter(d => d < 0).length;
    if (ups > 0 && downs > 0) totalDirection = 'mixed';
    else if (totalNumDelta > 0) totalDirection = 'up';
    else totalDirection = 'down';
  }

  const perBookTotal: MlbBookLine[] = Object.entries(currByBook)
    .filter(([, s]) => nonZero(s.total))
    .map(([b, s]) => ({ book: displayBook(b), value: s.total, price: s.total_over_price || null, timestamp: s.fetched_at }));

  const total: TotalTruth = {
    open: totalOpen,
    current: totalCurr,
    number_delta: totalNumDelta,
    over_open_price: overPriceOpen,
    over_current_price: overPriceCurr,
    under_open_price: underPriceOpen,
    under_current_price: underPriceCurr,
    over_price_delta: overPriceDelta,
    under_price_delta: underPriceDelta,
    direction: totalDirection,
    books_reporting: perBookTotal.length,
    per_book: perBookTotal,
    number_moved: numberMoved,
    juice_shift_only: juiceShiftOnly,
  };

  // ── Derived Truth ────────────────────────────────────────────────
  const mlMoved = Math.abs(moneyline.home_delta) >= 5 || Math.abs(moneyline.away_delta) >= 5;
  const totalMvd = numberMoved;

  const mlDirection: 'home' | 'away' | 'flat' | 'mixed' =
    moneyline.home_delta === 0 && moneyline.away_delta === 0 ? 'flat'
      : (homeCurr != null && homeOpen != null && homeCurr < homeOpen) ? 'home'
        : (awayCurr != null && awayOpen != null && awayCurr < awayOpen) ? 'away' : 'flat';

  // Strongest market: which has the most signal?
  const mlStrength = Math.max(Math.abs(moneyline.home_delta), Math.abs(moneyline.away_delta));
  const totalStrength = Math.abs(totalNumDelta) * 20; // Scale total to be comparable with ML cents
  const rlStrength = priceChanged ? Math.abs(runLine.favorite_price_delta) : 0;

  let strongestMarket: 'moneyline' | 'run_line' | 'total' | 'none' = 'none';
  const maxStrength = Math.max(mlStrength, totalStrength, rlStrength);
  if (maxStrength >= 5) {
    if (mlStrength >= totalStrength && mlStrength >= rlStrength) strongestMarket = 'moneyline';
    else if (totalStrength >= mlStrength && totalStrength >= rlStrength) strongestMarket = 'total';
    else strongestMarket = 'run_line';
  }

  const derivedTruth: DerivedTruth = {
    favorite_team: favoriteTeam,
    underdog_team: underdogTeam,
    run_line_consistent_with_moneyline: true, // enforced by normalization
    moneyline_direction: mlDirection,
    total_direction: totalDirection,
    strongest_market: strongestMarket,
    market_regime: mlMoved && totalMvd ? 'both_moving'
      : mlMoved ? 'ml_moving'
        : totalMvd ? 'total_moving'
          : juiceShiftOnly ? 'juice_only'
            : 'stable',
    pitcher_context: pitchers?.confirmed ? 'confirmed' : 'unconfirmed',
  };

  return {
    sport: 'MLB',
    event_id: `MLB|${homeTeam}|${awayTeam}|${gameTime}`,
    home_team: homeTeam,
    away_team: awayTeam,
    game_time_utc: gameTime,
    tracking_hours: trackingHours,
    snapshot_count: snapshots.length,
    starting_pitchers: pitchers ?? { home: null, away: null, confirmed: false },
    market_state: { moneyline, run_line: runLine, total },
    derived_truth: derivedTruth,
    signal_summary: { side_signal: 'PASS', total_signal: 'PASS', confidence: 'low', side_reason: '', total_reason: '', status: 'PASS' },
    validation: { is_valid: true, errors: [], warnings: [] },
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
  };
}

// ── Empty truth ──────────────────────────────────────────────────────────────

function emptyTruth(homeTeam: string, awayTeam: string, gameTime: string, pitchers?: PitcherInfo): MlbTruthObject {
  return {
    sport: 'MLB', event_id: `MLB|${homeTeam}|${awayTeam}|${gameTime}`,
    home_team: homeTeam, away_team: awayTeam, game_time_utc: gameTime,
    tracking_hours: 0, snapshot_count: 0,
    starting_pitchers: pitchers ?? { home: null, away: null, confirmed: false },
    market_state: {
      moneyline: { home_open: null, home_current: null, away_open: null, away_current: null, home_delta: 0, away_delta: 0, books_reporting: 0, consensus_side: null, per_book_home: [], per_book_away: [] },
      run_line: { favored_team: null, underdog_team: null, favorite_rl: null, underdog_rl: null, open_favorite_price: null, current_favorite_price: null, open_dog_price: null, current_dog_price: null, favorite_price_delta: 0, underdog_price_delta: 0, books_reporting: 0, line_changed: false, price_changed: false },
      total: { open: null, current: null, number_delta: 0, over_open_price: null, over_current_price: null, under_open_price: null, under_current_price: null, over_price_delta: 0, under_price_delta: 0, direction: 'flat', books_reporting: 0, per_book: [], number_moved: false, juice_shift_only: false },
    },
    derived_truth: { favorite_team: null, underdog_team: null, run_line_consistent_with_moneyline: true, moneyline_direction: 'flat', total_direction: 'flat', strongest_market: 'none', market_regime: 'stable', pitcher_context: 'unconfirmed' },
    signal_summary: { side_signal: 'PASS', total_signal: 'PASS', confidence: 'low', side_reason: 'No data', total_reason: 'No data', status: 'PASS' },
    validation: { is_valid: false, errors: ['No snapshot data available'], warnings: [] },
    public_data: { home_ticket_pct: null, away_ticket_pct: null, home_money_pct: null, away_money_pct: null },
  };
}
