// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Configuration
//
//  All weights, thresholds, and sharp book definitions are here.
//  To add a new sport: add thresholds. Do not touch the engine.
// ══════════════════════════════════════════════════════════════════════════════

// ── Book Weights for Consensus ───────────────────────────────────────────────
// Higher = more influence on consensus true open.
// Pinnacle gets highest weight as the market-setting sharp book.

export const BOOK_WEIGHTS: Record<string, number> = {
  pinnacle: 1.5,
  circa: 1.4,
  bookmaker: 1.3,
  heritage: 1.2,
  draftkings: 1.15,
  fanduel: 1.1,
  betmgm: 1.0,
  caesars: 1.0,
  espnbet: 0.95,
  pointsbetus: 0.9,
  fanatics: 0.9,
};

export const DEFAULT_BOOK_WEIGHT = 1.0;

export function getBookWeight(book: string): number {
  return BOOK_WEIGHTS[book.toLowerCase()] ?? DEFAULT_BOOK_WEIGHT;
}

// ── Sharp Book Classification ────────────────────────────────────────────────

export const SHARP_BOOKS = new Set([
  'pinnacle', 'circa', 'bookmaker', 'heritage',
]);

export function isSharpBook(book: string): boolean {
  return SHARP_BOOKS.has(book.toLowerCase());
}

// ── Material Move Thresholds ─────────────────────────────────────────────────
// Used by structure classification to determine if a move is "material"
// (i.e., enough to count as a direction change vs noise).
// Key format: `${marketType}_${league}` or `${marketType}` for defaults.

export const MATERIAL_MOVE_THRESHOLDS: Record<string, number> = {
  // Spreads
  spread: 0.5,            // default for all sports
  spread_NBA: 0.5,
  spread_NCAAB: 0.5,
  spread_NFL: 0.5,
  spread_NCAAF: 0.5,
  spread_MLB: 0.5,        // run line rarely moves, so 0.5 is meaningful
  spread_NHL: 0.5,
  spread_WNBA: 0.5,

  // Totals
  total: 1.0,             // default
  total_NBA: 1.0,
  total_NCAAB: 1.0,
  total_NFL: 1.0,
  total_NCAAF: 1.0,
  total_MLB: 0.5,         // MLB totals are 6-9 range, 0.5 is significant
  total_NHL: 0.5,         // NHL totals are 5-7 range, 0.5 is significant
  total_WNBA: 1.0,

  // Moneylines
  moneyline: 10,          // default (cents)
  moneyline_NBA: 10,
  moneyline_NCAAB: 10,
  moneyline_NFL: 10,
  moneyline_NCAAF: 10,
  moneyline_MLB: 8,       // MLB moneyline is the primary signal market
  moneyline_NHL: 8,       // NHL moneyline is the primary signal market
  moneyline_WNBA: 10,
};

/**
 * Get the material move threshold for a market type + league combo.
 * Falls back to market-type default, then global default.
 */
export function getMaterialMoveThreshold(marketType: string, league: string): number {
  return MATERIAL_MOVE_THRESHOLDS[`${marketType}_${league}`]
    ?? MATERIAL_MOVE_THRESHOLDS[marketType]
    ?? 0.5;
}

// ── Reliability Scoring Config ───────────────────────────────────────────────

export const RELIABILITY_CONFIG = {
  /** Base reliability when we have a direct earliest snapshot */
  BASE_DIRECT: 70,
  /** Base reliability when open is reconstructed */
  BASE_RECONSTRUCTED: 45,
  /** Base reliability when using fallback first-seen */
  BASE_FALLBACK: 20,

  /** Bonus per additional snapshot (more data = higher confidence) */
  BONUS_PER_SNAPSHOT: 2,
  /** Max bonus from snapshot count */
  MAX_SNAPSHOT_BONUS: 15,

  /** Bonus if this is a sharp book */
  BONUS_SHARP_BOOK: 5,

  /** Penalty if tracker started late */
  PENALTY_TRACKER_LATE: -15,

  /** Consensus bonus if all book opens agree */
  CONSENSUS_BONUS_AGREEMENT: 10,
  /** Consensus bonus if opens are within 1 unit */
  CONSENSUS_BONUS_CLOSE: 5,
  /** Consensus bonus for having sharp book opens */
  CONSENSUS_BONUS_SHARP: 5,
  /** Consensus penalty if majority of books started late */
  CONSENSUS_PENALTY_LATE: -15,

  /** Reliability → confidence label thresholds */
  THRESHOLDS: {
    HIGH: 85,
    MODERATE: 65,
    LOW: 40,
    // Below LOW = Unreliable
  },
};

// ── Tracker Late Detection ───────────────────────────────────────────────────

export const TRACKER_LATE_CONFIG = {
  /** If first snapshot is fewer than this many hours before game, flag as late */
  LATE_THRESHOLD_HOURS: 1,
  /** If first snapshot is fewer than this many hours before game with limited data */
  LATE_THRESHOLD_LIMITED_HOURS: 4,
  /** "Limited data" = fewer than this many snapshots */
  LIMITED_SNAPSHOT_COUNT: 5,
  /** Estimated hours before game that markets typically open (for delay calc) */
  TYPICAL_MARKET_OPEN_HOURS: 24,
};

// ── Reconstruction Config ────────────────────────────────────────────────────

export const RECONSTRUCTION_CONFIG = {
  /** If first captured consensus is this far from observed min/max, flag likely late */
  LATE_INDICATOR_DISTANCE: 2.0,
  /** Minimum books needed for reconstruction */
  MIN_BOOKS_FOR_RECONSTRUCTION: 2,
};
