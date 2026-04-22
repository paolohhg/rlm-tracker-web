// ══════════════════════════════════════════════════════════════════════════════
//  HEARD ALERT Detection — MLB & NHL
//
//  Top-tier signal: Pinnacle-led, coordinated sharp market events.
//  Sits ABOVE all existing signals (STEAM, RLM, SHARP_ACCUMULATION).
//
//  Alert Types:
//    HEARD_ALERT_MLB       — ML move on MLB underdog/favorite
//    HEARD_ALERT_TOTAL_MLB — Total move on MLB
//    HEARD_ALERT_NHL       — ML move on NHL underdog/favorite
//    HEARD_ALERT_TOTAL_NHL — Total move on NHL
// ══════════════════════════════════════════════════════════════════════════════

import { centMove } from "../../../api/lib/hsa/odds/cent-line.ts";

// ── Book Weights ─────────────────────────────────────────────────────────────

const BOOK_WEIGHTS: Record<string, number> = {
  pinnacle: 1.0,
  circa: 0.9,
  draftkings: 0.7,
  fanduel: 0.7,
  betmgm: 0.6,
  caesars: 0.6,
  espnbet: 0.5,
  pointsbetus: 0.5,
  fanatics: 0.5,
};

function getBookWeight(book: string): number {
  return BOOK_WEIGHTS[book.toLowerCase()] ?? 0.5;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

/** Calculate ML delta in cents (absolute difference) */
export function calcMLDelta(openML: number, currentML: number): number {
  return Math.abs(centMove(openML, currentML));
}

/** Determine which book moved first in the consensus direction */
export function getLeadingBook(
  bookMoves: { book: string; openML: number; currML: number; firstAt: string; lastAt: string }[],
  consensusDirection: number, // -1 = toward home (more negative), +1 = toward away
): { leader: string | null; isSharp: boolean; followerBooks: string[]; windowMinutes: number } {
  // Filter to books that actually moved in the consensus direction
  const movers = bookMoves
    .filter(b => {
      const delta = centMove(b.openML, b.currML);
      return Math.sign(delta) === consensusDirection || (consensusDirection < 0 && delta < 0) || (consensusDirection > 0 && delta > 0);
    })
    .sort((a, b) => new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime());

  if (movers.length === 0) return { leader: null, isSharp: false, followerBooks: [], windowMinutes: 0 };

  const leader = movers[0].book;
  const followers = movers.slice(1).map(b => b.book);

  const firstTime = new Date(movers[0].lastAt).getTime();
  const lastTime = movers.length > 1 ? new Date(movers[movers.length - 1].lastAt).getTime() : firstTime;
  const windowMinutes = Math.round((lastTime - firstTime) / 60000);

  return {
    leader,
    isSharp: leader.toLowerCase() === 'pinnacle',
    followerBooks: followers,
    windowMinutes,
  };
}

/** Count books that moved and compute weighted participation */
export function calcParticipation(
  bookMoves: { book: string; moved: boolean }[],
): { count: number; total: number; rate: number; weightedRate: number } {
  const total = bookMoves.length;
  const movedBooks = bookMoves.filter(b => b.moved);
  const count = movedBooks.length;

  const totalWeight = bookMoves.reduce((sum, b) => sum + getBookWeight(b.book), 0);
  const movedWeight = movedBooks.reduce((sum, b) => sum + getBookWeight(b.book), 0);

  return {
    count,
    total,
    rate: total > 0 ? count / total : 0,
    weightedRate: totalWeight > 0 ? movedWeight / totalWeight : 0,
  };
}

/** Check if a move was retraced (reversed in the next snapshot) */
export function detectRetrace(
  bookMoves: { book: string; openML: number; currML: number }[],
  consensusDirection: number,
): boolean {
  // A retrace is when >50% of movers reversed direction
  const movers = bookMoves.filter(b => {
    const delta = centMove(b.openML, b.currML);
    return Math.abs(delta) > 0 && Math.sign(delta) === consensusDirection;
  });

  // Check if any mover has reversed (currML moved back toward openML)
  // Since we only have open and current, we can't detect mid-session retrace.
  // We check if the move is very small relative to what we'd expect —
  // indicating it may have partially retraced.
  // For now, return false (no retrace) — the hold condition is checked
  // by verifying the move persists across the next polling window.
  return false;
}

// ── Alert Type ───────────────────────────────────────────────────────────────

export type HeardAlertType =
  | 'HEARD_ALERT_MLB'
  | 'HEARD_ALERT_TOTAL_MLB'
  | 'HEARD_ALERT_NHL'
  | 'HEARD_ALERT_TOTAL_NHL'
  | null;

export interface HeardAlertResult {
  type: HeardAlertType;
  sharpSide: string;
  moveData: {
    openML: number;
    currentML: number;
    deltaCents: number;
    market: 'moneyline' | 'total';
  };
  booksInvolved: {
    leader: string;
    followers: string[];
    count: number;
    total: number;
    participationRate: number;
    weightedParticipation: number;
  };
  timing: {
    windowMinutes: number;
  };
  confidence: number;
  summary: string;
}

// ── MLB Thresholds ───────────────────────────────────────────────────────────

const MLB_ML_THRESHOLDS = {
  UNDERDOG_MIN_CENTS: 80,
  FAVORITE_MIN_CENTS: 60,
  MAX_WINDOW_MINUTES: 120,
  MIN_BOOKS: 4,
  MIN_PARTICIPATION_RATE: 0.70,
  MIN_WEIGHTED_PARTICIPATION: 0.75,
};

const MLB_TOTAL_THRESHOLDS = {
  MIN_MOVE: 0.5, // 0.5 with full coord + key number, or 1.0 standalone
  FULL_COORD_MOVE: 0.5,
  STANDALONE_MOVE: 1.0,
  MAX_WINDOW_MINUTES: 90,
  MIN_BOOKS: 4,
  KEY_NUMBERS: [7.5, 8, 8.5, 9],
};

// ── NHL Thresholds ───────────────────────────────────────────────────────────

const NHL_ML_THRESHOLDS = {
  UNDERDOG_MIN_CENTS: 70,
  FAVORITE_MIN_CENTS: 50,
  MAX_WINDOW_MINUTES: 90,
  MIN_BOOKS: 4,
  MIN_PARTICIPATION_RATE: 0.70,
  MIN_WEIGHTED_PARTICIPATION: 0.75,
};

const NHL_TOTAL_THRESHOLDS = {
  MIN_MOVE: 0.5,
  MAX_WINDOW_MINUTES: 60,
  MIN_BOOKS: 4,
  KEY_NUMBERS: [5.5, 6, 6.5],
};

// ── MLB Moneyline Detection ──────────────────────────────────────────────────

export function detectHeardAlertMLB(
  bookMLs: { book: string; openML: number; currML: number; openProb: number; currProb: number; firstAt?: string; lastAt?: string }[],
  homeTeam: string,
  awayTeam: string,
  homeBetsPct: number | null,
  homeMoneyPct: number | null,
): HeardAlertResult | null {
  return detectHeardAlertML(
    bookMLs, homeTeam, awayTeam, homeBetsPct, homeMoneyPct,
    'MLB', MLB_ML_THRESHOLDS,
  );
}

// ── NHL Moneyline Detection ──────────────────────────────────────────────────

export function detectHeardAlertNHL(
  bookMLs: { book: string; openML: number; currML: number; openProb: number; currProb: number; firstAt?: string; lastAt?: string }[],
  homeTeam: string,
  awayTeam: string,
  homeBetsPct: number | null,
  homeMoneyPct: number | null,
): HeardAlertResult | null {
  return detectHeardAlertML(
    bookMLs, homeTeam, awayTeam, homeBetsPct, homeMoneyPct,
    'NHL', NHL_ML_THRESHOLDS,
  );
}

// ── Generic ML Detection ─────────────────────────────────────────────────────

function detectHeardAlertML(
  bookMLs: { book: string; openML: number; currML: number; openProb: number; currProb: number; firstAt?: string; lastAt?: string }[],
  homeTeam: string,
  awayTeam: string,
  homeBetsPct: number | null,
  homeMoneyPct: number | null,
  league: 'MLB' | 'NHL',
  thresholds: typeof MLB_ML_THRESHOLDS,
): HeardAlertResult | null {
  if (bookMLs.length < thresholds.MIN_BOOKS) return null;

  // Compute per-book deltas (in cents, from home perspective)
  const deltas = bookMLs.map(b => ({
    book: b.book,
    delta: centMove(b.openML, b.currML),
    absDelta: Math.abs(centMove(b.openML, b.currML)),
    moved: Math.abs(centMove(b.openML, b.currML)) >= 3, // 3-cent minimum to count as "moved"
    openML: b.openML,
    currML: b.currML,
    firstAt: b.firstAt ?? '',
    lastAt: b.lastAt ?? '',
  }));

  // Determine consensus direction
  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);
  if (totalDelta === 0) return null;
  const consensusDir = Math.sign(totalDelta); // -1 = toward home (favorite strengthening), +1 = toward away

  // A. Pinnacle must lead
  const leadership = getLeadingBook(
    deltas.map(d => ({ book: d.book, openML: d.openML, currML: d.currML, firstAt: d.firstAt, lastAt: d.lastAt })),
    consensusDir,
  );
  if (!leadership.isSharp) return null; // Pinnacle must be leader

  // B. Book coordination
  const participation = calcParticipation(deltas.map(d => ({ book: d.book, moved: d.moved })));
  if (participation.count < thresholds.MIN_BOOKS) return null;
  if (participation.rate < thresholds.MIN_PARTICIPATION_RATE && participation.weightedRate < thresholds.MIN_WEIGHTED_PARTICIPATION) return null;

  // C. Time window
  if (leadership.windowMinutes > thresholds.MAX_WINDOW_MINUTES) return null;

  // D. Move size — determine if underdog or favorite
  const avgOpenHome = bookMLs.reduce((s, b) => s + b.openML, 0) / bookMLs.length;
  const avgCurrHome = bookMLs.reduce((s, b) => s + b.currML, 0) / bookMLs.length;
  const homeIsUnderdog = avgOpenHome > 0;
  const moveTowardHome = consensusDir < 0;

  // Which side is the sharp side?
  const sharpSide = moveTowardHome ? homeTeam : awayTeam;
  const sharpIsUnderdog = (moveTowardHome && homeIsUnderdog) || (!moveTowardHome && !homeIsUnderdog);

  // Compute consensus ML delta in cents — cent-line first per book, then average.
  // (Averaging American odds before subtracting is invalid regardless of sign-flip:
  // avg(-110, +105) = -2.5 is not a valid odds value.)
  const perBookDeltas = bookMLs.map(b => centMove(b.openML, b.currML));
  const avgDelta = Math.abs(perBookDeltas.reduce((s, d) => s + d, 0) / perBookDeltas.length);

  // Apply thresholds based on underdog vs favorite
  if (sharpIsUnderdog) {
    if (avgDelta < thresholds.UNDERDOG_MIN_CENTS) return null;
  } else {
    if (avgDelta < thresholds.FAVORITE_MIN_CENTS) return null;
  }

  // E. Sharp confirmation (at least one)
  let hasSharpConfirmation = false;
  if (homeBetsPct != null && homeMoneyPct != null) {
    const publicOnSharpSide = moveTowardHome ? homeBetsPct > 50 : (100 - homeBetsPct) > 50;
    const moneyOnSharpSide = moveTowardHome ? homeMoneyPct > homeBetsPct : (100 - homeMoneyPct) > (100 - homeBetsPct);
    // RLM: public on opposite side
    if (!publicOnSharpSide) hasSharpConfirmation = true;
    // Money divergence: money% > bets% on sharp side
    if (moneyOnSharpSide) hasSharpConfirmation = true;
  } else {
    // No splits data — allow based on Pinnacle leadership alone (conservative)
    hasSharpConfirmation = true;
  }
  if (!hasSharpConfirmation) return null;

  // F. Hold condition (no immediate reversal)
  if (detectRetrace(deltas, consensusDir)) return null;

  // All conditions met — HEARD ALERT
  const alertType: HeardAlertType = league === 'MLB' ? 'HEARD_ALERT_MLB' : 'HEARD_ALERT_NHL';
  const confidence = Math.min(100, 85 + Math.floor(avgDelta / 20));

  return {
    type: alertType,
    sharpSide,
    moveData: {
      openML: Math.round(avgOpenHome),
      currentML: Math.round(avgCurrHome),
      deltaCents: Math.round(avgDelta),
      market: 'moneyline',
    },
    booksInvolved: {
      leader: leadership.leader!,
      followers: leadership.followerBooks,
      count: participation.count,
      total: participation.total,
      participationRate: participation.rate,
      weightedParticipation: participation.weightedRate,
    },
    timing: { windowMinutes: leadership.windowMinutes },
    confidence,
    summary: `HEARD ALERT — Pinnacle led a ${participation.count}/${participation.total}-book ML move toward ${sharpSide} (${sharpIsUnderdog ? 'underdog' : 'favorite'}). ${Math.round(avgDelta)}c move in ${leadership.windowMinutes} min.`,
  };
}

// ── MLB Total Detection ──────────────────────────────────────────────────────

export function detectHeardAlertTotalMLB(
  bookTotals: { book: string; open: number; current: number; firstAt: string; lastAt: string }[],
): HeardAlertResult | null {
  return detectHeardAlertTotal(bookTotals, 'MLB', MLB_TOTAL_THRESHOLDS);
}

// ── NHL Total Detection ──────────────────────────────────────────────────────

export function detectHeardAlertTotalNHL(
  bookTotals: { book: string; open: number; current: number; firstAt: string; lastAt: string }[],
): HeardAlertResult | null {
  return detectHeardAlertTotal(bookTotals, 'NHL', NHL_TOTAL_THRESHOLDS);
}

// ── Generic Total Detection ──────────────────────────────────────────────────

function detectHeardAlertTotal(
  bookTotals: { book: string; open: number; current: number; firstAt: string; lastAt: string }[],
  league: 'MLB' | 'NHL',
  thresholds: typeof MLB_TOTAL_THRESHOLDS,
): HeardAlertResult | null {
  if (bookTotals.length < thresholds.MIN_BOOKS) return null;

  // Compute per-book deltas
  const deltas = bookTotals.map(b => ({
    book: b.book,
    delta: b.current - b.open,
    absDelta: Math.abs(b.current - b.open),
    moved: Math.abs(b.current - b.open) >= 0.25,
    firstAt: b.firstAt,
    lastAt: b.lastAt,
  }));

  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);
  if (totalDelta === 0) return null;
  const consensusDir = Math.sign(totalDelta);

  // A. Pinnacle must lead
  const movers = deltas
    .filter(d => d.moved && Math.sign(d.delta) === consensusDir)
    .sort((a, b) => new Date(a.lastAt).getTime() - new Date(b.lastAt).getTime());

  if (movers.length === 0) return null;
  const leader = movers[0].book;
  if (leader.toLowerCase() !== 'pinnacle') return null;

  // B. Coordination
  const participation = calcParticipation(deltas.map(d => ({ book: d.book, moved: d.moved })));
  if (participation.count < thresholds.MIN_BOOKS) return null;

  // C. Time window
  const firstTime = new Date(movers[0].lastAt).getTime();
  const lastTime = new Date(movers[movers.length - 1].lastAt).getTime();
  const windowMinutes = Math.round((lastTime - firstTime) / 60000);
  if (windowMinutes > thresholds.MAX_WINDOW_MINUTES) return null;

  // D. Move size
  const avgOpen = bookTotals.reduce((s, b) => s + b.open, 0) / bookTotals.length;
  const avgCurr = bookTotals.reduce((s, b) => s + b.current, 0) / bookTotals.length;
  const avgMove = Math.abs(avgCurr - avgOpen);

  if (avgMove < thresholds.MIN_MOVE) return null;

  // For 0.5 moves, require full coordination AND key number interaction
  if (avgMove < (thresholds.STANDALONE_MOVE ?? 1.0)) {
    const hitsKeyNumber = thresholds.KEY_NUMBERS.some(kn =>
      (avgOpen < kn && avgCurr >= kn) || (avgOpen > kn && avgCurr <= kn) ||
      Math.abs(avgCurr - kn) < 0.25
    );
    if (!hitsKeyNumber || participation.rate < 0.9) return null;
  }

  // E. No retrace
  // (handled by hold condition check)

  const direction = consensusDir > 0 ? 'Over' : 'Under';
  const alertType: HeardAlertType = league === 'MLB' ? 'HEARD_ALERT_TOTAL_MLB' : 'HEARD_ALERT_TOTAL_NHL';
  const confidence = Math.min(100, 85 + Math.floor(avgMove * 10));

  return {
    type: alertType,
    sharpSide: direction,
    moveData: {
      openML: avgOpen,
      currentML: avgCurr,
      deltaCents: Math.round(avgMove * 100), // convert to "cents" equivalent
      market: 'total',
    },
    booksInvolved: {
      leader,
      followers: movers.slice(1).map(m => m.book),
      count: participation.count,
      total: participation.total,
      participationRate: participation.rate,
      weightedParticipation: participation.weightedRate,
    },
    timing: { windowMinutes },
    confidence,
    summary: `HEARD ALERT — Pinnacle led a ${participation.count}/${participation.total}-book total move toward ${direction}. ${avgOpen} → ${avgCurr} (${avgMove.toFixed(1)} pts) in ${windowMinutes} min.`,
  };
}
