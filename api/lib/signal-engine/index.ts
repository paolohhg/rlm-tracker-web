// ══════════════════════════════════════════════════════════════════════════════
//  Signal Engine V2 — Public API
//
//  Single entry point for market signal analysis.
//  Takes raw market state → returns structured signal output.
//
//  Usage:
//    import { analyzeMarket, buildMarketState } from './signal-engine';
//    const state = buildMarketState(snapshots, splits, league, ...);
//    const output = analyzeMarket(state);
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketState,
  SignalOutput,
  SignalClassification,
  ScoredSignal,
  NormalizedBook,
  PublicData,
  League,
  MarketType,
  MarketSnapshot,
} from './types';
import { getBookConfig } from './config/book-tiers';
import { getMarketThresholds } from './config/league-thresholds';
import { classifySignal } from './classify/signal-classifier';
import { scoreSignal } from './score/confidence-scorer';
import { buildSignalOutput } from './output/signal-output';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Full analysis pipeline: MarketState → SignalOutput.
 *
 * @param state - Normalized market state (use buildMarketState to construct).
 * @returns Complete signal output with classification, scoring, and explanation.
 */
export function analyzeMarket(state: MarketState): SignalOutput {
  const classification = classifySignal(state);
  const scored = scoreSignal(state, classification);
  return buildSignalOutput(state, classification, scored);
}

/**
 * Build a normalized MarketState from raw snapshots and splits data.
 *
 * @param snapshots - Raw odds snapshots sorted by fetched_at ascending.
 * @param publicData - Public ticket/money splits.
 * @param league - League identifier.
 * @param homeTeam - Home team name.
 * @param awayTeam - Away team name.
 * @param gameTime - ISO string of game start.
 * @param marketType - Which market to analyze.
 */
export function buildMarketState(
  snapshots: MarketSnapshot[],
  publicData: PublicData,
  league: League,
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  marketType: MarketType,
): MarketState {
  if (snapshots.length === 0) {
    return emptyMarketState(league, homeTeam, awayTeam, gameTime, marketType, publicData);
  }

  const gameKey = `${homeTeam}_${awayTeam}_${gameTime}`;
  const T = getMarketThresholds(league, marketType);

  // Extract the relevant line from each snapshot based on market type
  const extractLine = (s: MarketSnapshot): number => {
    if (marketType === 'total') return s.total;
    if (marketType === 'moneyline') return s.moneyline_home;
    return s.spread;
  };

  // ── Build per-book normalized data ─────────────────────────────────
  const firstByBook: Record<string, MarketSnapshot> = {};
  const lastByBook: Record<string, MarketSnapshot> = {};

  for (const s of snapshots) {
    if (!firstByBook[s.book]) firstByBook[s.book] = s;
    lastByBook[s.book] = s;
  }

  const books: NormalizedBook[] = [];
  for (const [bookKey, first] of Object.entries(firstByBook)) {
    const last = lastByBook[bookKey];
    const config = getBookConfig(bookKey);
    const openLine = extractLine(first);
    const currentLine = extractLine(last);

    books.push({
      book: bookKey,
      tier: config.tier,
      weight: config.weight,
      display_name: config.display_name,
      open_line: openLine,
      current_line: currentLine,
      move: currentLine - openLine,
      first_seen: first.fetched_at,
      last_seen: last.fetched_at,
    });
  }

  // ── Consensus (MODE-based) ─────────────────────────────────────────
  const openLines = books.map(b => b.open_line).filter(v => v !== 0);
  const currentLines = books.map(b => b.current_line).filter(v => v !== 0);
  const opener = mode(openLines) ?? 0;
  const current = mode(currentLines) ?? 0;
  const moveVal = current - opener;

  // ── Velocity ───────────────────────────────────────────────────────
  const allTimestamps = snapshots.map(s => new Date(s.fetched_at).getTime());
  const earliest = Math.min(...allTimestamps);
  const latest = Math.max(...allTimestamps);
  const hoursTracked = (latest - earliest) / (1000 * 60 * 60);
  const velocity = hoursTracked > 0 ? Math.abs(moveVal) / hoursTracked : 0;

  // ── Split books into moved-consensus vs held ───────────────────────
  const consensusDir = Math.sign(moveVal);
  const booksMoved: NormalizedBook[] = [];
  const booksHeld: NormalizedBook[] = [];

  for (const b of books) {
    const movedWithConsensus =
      consensusDir !== 0 &&
      Math.sign(b.move) === consensusDir &&
      Math.abs(b.move) >= T.meaningful_move * 0.5;
    if (movedWithConsensus) {
      booksMoved.push(b);
    } else {
      booksHeld.push(b);
    }
  }

  return {
    game_key: gameKey,
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    game_time: gameTime,
    market_type: marketType,
    opener,
    current,
    move: moveVal,
    books,
    public_data: publicData,
    velocity: Math.round(velocity * 100) / 100,
    hours_tracked: Math.round(hoursTracked * 100) / 100,
    books_moved_consensus: booksMoved,
    books_held: booksHeld,
    total_books: books.length,
  };
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export { classifySignal } from './classify/signal-classifier';
export { scoreSignal } from './score/confidence-scorer';
export { buildSignalOutput } from './output/signal-output';
export { getBookConfig, isSharpBook, getBooksByTier } from './config/book-tiers';
export { getLeagueConfig, getMarketThresholds, isMLPrimary } from './config/league-thresholds';
export { buildDirectionalMove } from './classify/signal-classifier';
export {
  detectLeaderFollower,
  computeBookDisagreement,
  computeWeightedCoordination,
  isSharpLed,
  describeBookParticipation,
} from './classify/book-intelligence';

// Re-export types
export type {
  MarketState,
  SignalOutput,
  SignalClassification,
  ScoredSignal,
  SignalType,
  ConfidenceBucket,
  BookTier,
  BookConfig,
  NormalizedBook,
  League,
  MarketType,
  MarketSnapshot,
  PublicData,
  LeaderFollowerResult,
  BookDisagreement,
  ScoreBreakdown,
  DirectionalMove,
  MoveDirection,
  MarketThresholds,
  LeagueConfig,
  SignalWeights,
} from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyMarketState(
  league: League,
  homeTeam: string,
  awayTeam: string,
  gameTime: string,
  marketType: MarketType,
  publicData: PublicData,
): MarketState {
  return {
    game_key: `${homeTeam}_${awayTeam}_${gameTime}`,
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    game_time: gameTime,
    market_type: marketType,
    opener: 0,
    current: 0,
    move: 0,
    books: [],
    public_data: publicData,
    velocity: 0,
    hours_tracked: 0,
    books_moved_consensus: [],
    books_held: [],
    total_books: 0,
  };
}

/**
 * MODE — most frequent value. Ties broken by value closest to median.
 */
function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const freq = new Map<number, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  let maxFreq = 0;
  for (const f of freq.values()) {
    if (f > maxFreq) maxFreq = f;
  }
  const candidates = [...freq.entries()]
    .filter(([, f]) => f === maxFreq)
    .map(([v]) => v);

  if (candidates.length === 1) return candidates[0];

  // Tie-break: closest to median
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - median) - Math.abs(b - median));
  return candidates[0];
}
