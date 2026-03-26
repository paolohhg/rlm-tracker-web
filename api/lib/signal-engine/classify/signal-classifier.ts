// ══════════════════════════════════════════════════════════════════════════════
//  Core Signal Classifier — 7-Signal Taxonomy
//
//  Takes a MarketState and classifies it into exactly one of:
//    REVERSE_LINE_MOVEMENT | STEAM_MOVE | MARKET_AGREEMENT |
//    BOOK_DISAGREEMENT | FROZEN_LINE | FAKE_STEAM | NOISE
//
//  Classification order matters — earlier checks take priority.
//  Each classifier is a pure function that returns { match, factors }.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketState,
  SignalType,
  SignalClassification,
  DirectionalMove,
  MarketThresholds,
  NormalizedBook,
} from '../types';
import { getMarketThresholds } from '../config/league-thresholds';
import {
  detectLeaderFollower,
  computeBookDisagreement,
  computeWeightedCoordination,
  isSharpLed,
} from './book-intelligence';

// ── Spread Direction Logic ───────────────────────────────────────────────────

/**
 * Build a directional move description anchored to opener → current.
 *
 * NON-NEGOTIABLE RULE: Movement direction is always relative to the
 * team being analyzed.
 *   - Underdog (+): smaller number = toward that team (+6 → +4 = toward)
 *   - Favorite (-): more negative = toward that team (-4 → -6 = toward)
 *
 * For spreads (home perspective):
 *   move < 0 → toward home team (whether fav or dog)
 *   move > 0 → toward away team (whether fav or dog)
 */
export function buildDirectionalMove(
  state: MarketState,
): DirectionalMove {
  const { move, opener, current, home_team, away_team, market_type } = state;
  const absMoveVal = Math.abs(move);

  if (absMoveVal < 0.001) {
    return {
      toward_team: '',
      away_from_team: '',
      magnitude: 0,
      description: `${formatLine(market_type, opener)} — no movement.`,
    };
  }

  let towardTeam: string;
  let awayFromTeam: string;

  if (market_type === 'total') {
    towardTeam = move > 0 ? 'Over' : 'Under';
    awayFromTeam = move > 0 ? 'Under' : 'Over';
  } else {
    // For spread and moneyline: negative move = toward home
    towardTeam = move < 0 ? home_team : away_team;
    awayFromTeam = move < 0 ? away_team : home_team;
  }

  // Build opener-anchored description
  let description: string;
  if (market_type === 'total') {
    description =
      `Total moved from ${opener} to ${current}, ` +
      `which is movement toward the ${towardTeam.toLowerCase()}.`;
  } else if (market_type === 'spread') {
    const openerLabel = formatSpreadForTeam(opener, home_team, away_team);
    const currentLabel = formatSpreadForTeam(current, home_team, away_team);
    description =
      `Spread moved from ${openerLabel} to ${currentLabel}, ` +
      `which is movement toward ${towardTeam} and against ${awayFromTeam}.`;
  } else {
    // Moneyline
    description =
      `Moneyline moved from ${formatML(opener)} to ${formatML(current)} (home), ` +
      `which is movement toward ${towardTeam}.`;
  }

  return {
    toward_team: towardTeam,
    away_from_team: awayFromTeam,
    magnitude: Math.round(absMoveVal * 10) / 10,
    description,
  };
}

// ── Signal Classification Entry Point ────────────────────────────────────────

/**
 * Classify a MarketState into one of 8 signal types.
 *
 * Classification priority (first match wins):
 *   1. FULL_BOOK_CONSENSUS — all (≥4) books moved same direction within time window
 *   2. FAKE_STEAM — isolated move without confirmation
 *   3. STEAM_MOVE — coordinated fast move (checked BEFORE disagreement
 *      because a one-book holdout does not negate coordinated action)
 *   4. REVERSE_LINE_MOVEMENT — line vs public
 *   5. BOOK_DISAGREEMENT — fragmented market with no clear consensus
 *   6. MARKET_AGREEMENT — public, money, line aligned
 *   7. FROZEN_LINE — public pressure but no movement
 *   8. NOISE — everything else
 */
export function classifySignal(state: MarketState): SignalClassification {
  const T = getMarketThresholds(state.league, state.market_type);
  const direction = buildDirectionalMove(state);
  const consensusDir = Math.sign(state.move);
  const leadership = detectLeaderFollower(
    state.books, consensusDir, T.meaningful_move,
  );
  const disagreement = computeBookDisagreement(state.books, T);
  const keyNumberResult = checkKeyNumberCrossing(state.opener, state.current, T);

  const base = {
    direction,
    leadership,
    disagreement,
    key_number_crossed: keyNumberResult.crossed,
    crossed_number: keyNumberResult.number,
  };

  // 1. FULL_BOOK_CONSENSUS — all books moved same direction within window
  const fbcResult = checkFullBookConsensus(state, T, leadership);
  if (fbcResult.match) {
    return { type: 'FULL_BOOK_CONSENSUS', factors: fbcResult.factors, ...base };
  }

  // 2. FAKE_STEAM — isolated move without confirmation
  const fakeResult = checkFakeSteam(state, T);
  if (fakeResult.match) {
    return { type: 'FAKE_STEAM', factors: fakeResult.factors, ...base };
  }

  // 3. STEAM_MOVE — coordinated fast move
  const steamResult = checkSteam(state, T, leadership);
  if (steamResult.match) {
    return { type: 'STEAM_MOVE', factors: steamResult.factors, ...base };
  }

  // 4. REVERSE_LINE_MOVEMENT — line vs public
  const rlmResult = checkRLM(state, T, leadership);
  if (rlmResult.match) {
    return { type: 'REVERSE_LINE_MOVEMENT', factors: rlmResult.factors, ...base };
  }

  // 5. BOOK_DISAGREEMENT — fragmented market with no majority consensus
  const disagreeResult = checkBookDisagreement(state, T, disagreement);
  if (disagreeResult.match) {
    return { type: 'BOOK_DISAGREEMENT', factors: disagreeResult.factors, ...base };
  }

  // 6. MARKET_AGREEMENT — public + money + line aligned
  const agreementResult = checkMarketAgreement(state, T);
  if (agreementResult.match) {
    return { type: 'MARKET_AGREEMENT', factors: agreementResult.factors, ...base };
  }

  // 7. FROZEN_LINE — public pressure but no movement
  const frozenResult = checkFrozen(state, T);
  if (frozenResult.match) {
    return { type: 'FROZEN_LINE', factors: frozenResult.factors, ...base };
  }

  // 8. NOISE — default
  return {
    type: 'NOISE',
    factors: [
      `Move of ${Math.abs(state.move).toFixed(1)} does not meet any signal threshold.`,
    ],
    ...base,
  };
}

// ── Individual Signal Checks ─────────────────────────────────────────────────

interface CheckResult {
  match: boolean;
  factors: string[];
}

function checkFakeSteam(state: MarketState, T: MarketThresholds): CheckResult {
  const factors: string[] = [];

  // We detect fake steam by looking at books that moved away from consensus
  // AFTER an initial coordinated move.
  // Simple heuristic: if books_held > books_moved_consensus AND
  // the move exceeds meaningful but velocity is high (fast move, few followers)
  const absMove = Math.abs(state.move);
  if (absMove < T.meaningful_move) return { match: false, factors };

  const movedCount = state.books_moved_consensus.length;
  const heldCount = state.books_held.length;

  // Check for retrace: if the move from peak to current is >50% of the peak move
  // We don't have full timeline here, so we use a proxy:
  // If only 1 book moved and others held, with meaningful velocity → likely fake
  if (movedCount <= 1 && heldCount >= 3 && state.velocity > 0) {
    factors.push(
      `Only ${movedCount} book moved while ${heldCount} held — isolated move without confirmation.`,
    );
    factors.push(`Velocity: ${state.velocity.toFixed(2)} pts/hr.`);
    return { match: true, factors };
  }

  return { match: false, factors };
}

function checkBookDisagreement(
  state: MarketState,
  T: MarketThresholds,
  disagreement: import('../types').BookDisagreement,
): CheckResult {
  const factors: string[] = [];

  if (!disagreement.is_significant) return { match: false, factors };

  // If a clear majority of books moved in the same direction, this is
  // coordinated action (steam/RLM) with a holdout — NOT true disagreement.
  const movedCount = state.books_moved_consensus.length;
  if (movedCount >= Math.ceil(state.total_books * 0.6)) {
    return { match: false, factors };
  }

  factors.push(
    `Book disagreement of ${disagreement.max_spread} pts exceeds threshold (${T.disagreement_threshold}).`,
  );
  if (disagreement.outliers.length > 0) {
    factors.push(`Outlier(s): ${disagreement.outliers.join(', ')}.`);
  }
  // Describe the line groups
  for (const [line, books] of Object.entries(disagreement.line_groups)) {
    if (books.length > 0) {
      factors.push(`${books.join(', ')} at ${line}.`);
    }
  }

  return { match: true, factors };
}

function checkSteam(
  state: MarketState,
  T: MarketThresholds,
  leadership: import('../types').LeaderFollowerResult,
): CheckResult {
  const factors: string[] = [];
  const absMove = Math.abs(state.move);

  if (absMove < T.steam_move) return { match: false, factors };

  const movedCount = state.books_moved_consensus.length;
  if (movedCount < T.min_books_steam) return { match: false, factors };

  // Check velocity and time window
  const withinWindow = leadership.follow_window_minutes <= T.steam_window_minutes;
  if (!withinWindow && leadership.follow_window_minutes > 0) {
    return { match: false, factors };
  }

  factors.push(
    `${movedCount}/${state.total_books} books moved ${absMove.toFixed(1)} pts in the same direction.`,
  );
  factors.push(`Velocity: ${state.velocity.toFixed(2)} pts/hr.`);

  if (leadership.leader) {
    const sharpLed = isSharpLed(
      state.books, Math.sign(state.move), T.meaningful_move,
    );
    if (sharpLed) {
      factors.push(`Sharp-led: ${leadership.leader} moved first.`);
    } else {
      factors.push(`Led by ${leadership.leader}.`);
    }
  }

  if (leadership.follow_window_minutes > 0) {
    factors.push(`Follow window: ${leadership.follow_window_minutes} min.`);
  }

  return { match: true, factors };
}

function checkRLM(
  state: MarketState,
  T: MarketThresholds,
  leadership: import('../types').LeaderFollowerResult,
): CheckResult {
  const factors: string[] = [];
  const absMove = Math.abs(state.move);

  if (absMove < T.meaningful_move) return { match: false, factors };

  const pub = state.public_data;
  if (pub.home_ticket_pct == null) return { match: false, factors };

  const publicOnHome = pub.home_ticket_pct > 50;
  const moveTowardHome = state.move < 0;

  // RLM = public on one side, line moves to the OTHER side
  const isRLM = (publicOnHome && !moveTowardHome) || (!publicOnHome && moveTowardHome);
  if (!isRLM) return { match: false, factors };

  const publicTeam = publicOnHome ? state.home_team : state.away_team;
  const publicPct = publicOnHome ? pub.home_ticket_pct : (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct));
  const moveTeam = moveTowardHome ? state.home_team : state.away_team;

  factors.push(
    `Public ${publicPct}% on ${publicTeam}, but line moved toward ${moveTeam}.`,
  );

  // Stronger if money also confirms public side (true RLM, not just split action)
  if (pub.home_money_pct != null) {
    const moneyOnPublicSide = publicOnHome ? pub.home_money_pct : (100 - pub.home_money_pct);
    if (moneyOnPublicSide > 50) {
      factors.push(
        `Money also on ${publicTeam} (${moneyOnPublicSide}%) — genuine reverse line movement.`,
      );
    } else {
      factors.push(
        `Money diverges from tickets (${moneyOnPublicSide}% on ${publicTeam}) — ` +
        `sharp money may be driving the opposite side.`,
      );
    }
  }

  // Book coordination
  const movedCount = state.books_moved_consensus.length;
  if (movedCount >= 2) {
    factors.push(`${movedCount} books moved against public.`);
  }

  // Sharp-led?
  const sharpLed = isSharpLed(
    state.books, Math.sign(state.move), T.meaningful_move,
  );
  if (sharpLed) {
    factors.push('Move was sharp-led.');
  }

  return { match: true, factors };
}

function checkMarketAgreement(
  state: MarketState,
  T: MarketThresholds,
): CheckResult {
  const factors: string[] = [];
  const absMove = Math.abs(state.move);

  if (absMove < T.meaningful_move) return { match: false, factors };

  const pub = state.public_data;
  if (pub.home_ticket_pct == null) return { match: false, factors };

  const publicOnHome = pub.home_ticket_pct > 50;
  const moveTowardHome = state.move < 0;

  // MARKET_AGREEMENT = public AND line both going the same direction
  const publicAligned = (publicOnHome && moveTowardHome) || (!publicOnHome && !moveTowardHome);
  if (!publicAligned) return { match: false, factors };

  const publicTeam = publicOnHome ? state.home_team : state.away_team;
  const publicPct = publicOnHome ? pub.home_ticket_pct : (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct));

  factors.push(
    `Public ${publicPct}% on ${publicTeam} and line moved with them — market agreement.`,
  );

  // Check if money also aligns
  if (pub.home_money_pct != null) {
    const moneyAligned = publicOnHome
      ? pub.home_money_pct > 50
      : pub.home_money_pct < 50;
    if (moneyAligned) {
      factors.push('Money % also aligned — consensus pressure, not sharp action.');
    }
  }

  factors.push(`This is NOT reverse line movement.`);

  return { match: true, factors };
}

function checkFrozen(
  state: MarketState,
  T: MarketThresholds,
): CheckResult {
  const factors: string[] = [];
  const absMove = Math.abs(state.move);

  // Must be below frozen threshold
  if (absMove > T.frozen_threshold) return { match: false, factors };

  // Must have meaningful public pressure
  const pub = state.public_data;
  if (pub.home_ticket_pct == null) return { match: false, factors };

  const publicPct = Math.max(
    pub.home_ticket_pct ?? 50,
    pub.away_ticket_pct ?? 50,
  );
  if (publicPct < 60) return { match: false, factors };

  // Must have tracked long enough
  const minHours = state.market_type === 'moneyline' ? 2 : 3;
  if (state.hours_tracked < minHours) return { match: false, factors };

  const publicTeam = (pub.home_ticket_pct ?? 50) > 50
    ? state.home_team
    : state.away_team;

  factors.push(
    `${publicPct}% public on ${publicTeam} but line has not moved (${absMove.toFixed(1)} pts in ${state.hours_tracked.toFixed(1)}h).`,
  );
  factors.push('Books are resisting public pressure — possible sharp resistance.');

  if (state.total_books >= 3) {
    factors.push(`${state.total_books} books holding steady.`);
  }

  return { match: true, factors };
}

// ── FULL_BOOK_CONSENSUS ──────────────────────────────────────────────────────
// All tracked books (≥4) moved in the same direction within a time window.
// This is the strongest coordination signal — overrides "static board" logic.

const FULL_BOOK_CONSENSUS_WINDOW_MINUTES = 60;
const FULL_BOOK_CONSENSUS_MIN_BOOKS = 4;

function checkFullBookConsensus(
  state: MarketState,
  T: MarketThresholds,
  leadership: import('../types').LeaderFollowerResult,
): CheckResult {
  const factors: string[] = [];
  const absMove = Math.abs(state.move);

  // Must have meaningful movement
  if (absMove < T.meaningful_move) return { match: false, factors };

  // Must have minimum books tracked
  if (state.total_books < FULL_BOOK_CONSENSUS_MIN_BOOKS) return { match: false, factors };

  const movedCount = state.books_moved_consensus.length;
  const heldCount = state.books_held.length;

  // ALL books must have moved in the same direction (allow 0 holdouts,
  // or at most 1 holdout if we have ≥5 books)
  const maxHoldouts = state.total_books >= 5 ? 1 : 0;
  if (heldCount > maxHoldouts) return { match: false, factors };

  // Must be within the time window
  if (leadership.follow_window_minutes > FULL_BOOK_CONSENSUS_WINDOW_MINUTES) {
    return { match: false, factors };
  }

  // All conditions met — this is full book consensus
  const windowDesc = leadership.follow_window_minutes < 1
    ? 'within the same polling window'
    : `within ${leadership.follow_window_minutes} minutes`;

  factors.push(
    `All ${movedCount} tracked books moved in the same direction ${windowDesc}.`,
  );
  factors.push(
    `Move: ${absMove.toFixed(1)} pts across ${movedCount}/${state.total_books} books.`,
  );

  // Sharp book leadership detection
  const sharpLed = isSharpLed(
    state.books, Math.sign(state.move), T.meaningful_move,
  );
  if (sharpLed && leadership.leader) {
    factors.push(`Sharp book ${leadership.leader} led the move.`);
  } else if (leadership.leader) {
    factors.push(`${leadership.leader} led the move.`);
  }

  // Public alignment detection
  const pub = state.public_data;
  if (pub.home_ticket_pct != null) {
    const publicOnHome = pub.home_ticket_pct > 50;
    const moveTowardHome = state.move < 0;
    const publicAligned = (publicOnHome && moveTowardHome) || (!publicOnHome && !moveTowardHome);
    const publicTeam = publicOnHome ? state.home_team : state.away_team;
    const publicPct = publicOnHome ? pub.home_ticket_pct : (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct));

    if (publicAligned) {
      factors.push(
        `Public aligned (${publicPct}% on ${publicTeam}) — classified as FULL_BOOK_CONSENSUS + MARKET_AGREEMENT.`,
      );
    } else {
      factors.push(
        `Public OPPOSED (${publicPct}% on ${publicTeam}) — FULL_BOOK_CONSENSUS with RLM overlay (elite signal).`,
      );
    }
  }

  // Key number crossing
  if (state.market_type !== 'moneyline') {
    const keyResult = checkKeyNumberCrossing(state.opener, state.current, T);
    if (keyResult.crossed) {
      factors.push(`Crossed key number ${keyResult.number}.`);
    }
  }

  if (heldCount > 0) {
    const heldNames = state.books_held.map(b => b.book).join(', ');
    factors.push(`${heldCount} holdout(s): ${heldNames}.`);
  }

  return { match: true, factors };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkKeyNumberCrossing(
  opener: number,
  current: number,
  T: MarketThresholds,
): { crossed: boolean; number: number | null } {
  for (const kn of T.key_numbers) {
    const openerAbs = Math.abs(opener);
    const currentAbs = Math.abs(current);
    // Crossed if one is above and the other below (or on) the key number
    if ((openerAbs < kn && currentAbs >= kn) || (openerAbs > kn && currentAbs <= kn)) {
      return { crossed: true, number: kn };
    }
    // Also check actual signed values for spreads
    if ((opener < kn && current >= kn) || (opener > kn && current <= kn)) {
      return { crossed: true, number: kn };
    }
    if ((opener < -kn && current >= -kn) || (opener > -kn && current <= -kn)) {
      return { crossed: true, number: kn };
    }
  }
  return { crossed: false, number: null };
}

function formatLine(marketType: string, line: number): string {
  if (marketType === 'total') return `${line}`;
  if (marketType === 'moneyline') return formatML(line);
  return formatSpread(line);
}

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function formatML(ml: number): string {
  return ml > 0 ? `+${ml}` : `${ml}`;
}

function formatSpreadForTeam(
  spread: number,
  homeTeam: string,
  awayTeam: string,
): string {
  // Spread is from home perspective. Show as "[Team] [line]"
  if (spread <= 0) {
    // Home is favored
    return `${homeTeam} ${formatSpread(spread)}`;
  }
  // Home is underdog — can show either way. Show home perspective.
  return `${homeTeam} ${formatSpread(spread)}`;
}
