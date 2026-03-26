// ══════════════════════════════════════════════════════════════════════════════
//  Signal Scoring Weights
//
//  Defines how much each factor contributes to the confidence score.
//  All weights are max-point values. The total of positive weights = 100.
//  Penalties can reduce the score below the sum of positive contributions.
// ══════════════════════════════════════════════════════════════════════════════

import type { SignalWeights } from '../types';

/**
 * Default scoring weights.
 * Positive weights sum to 100. Penalties deducted separately.
 */
export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  // Positive factors (sum = 100)
  move_magnitude: 20,       // How large is the move relative to league threshold?
  book_coordination: 15,    // What fraction of books moved in the same direction?
  book_tier_weight: 15,     // Were the movers sharp books or retail?
  velocity: 10,             // How fast did the move happen?
  key_number_crossing: 10,  // Did the move cross a key number?
  public_divergence: 15,    // Is the move against public sentiment?

  // Penalties (deducted from score)
  reversal_penalty: -15,    // Did the move retrace significantly?
  stale_market_penalty: -10, // Is the data old (>8h without new snapshots)?
  incomplete_board_penalty: -5, // Are we missing books we normally track?
};

/**
 * Thresholds for converting raw score to confidence bucket.
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 65,
  MODERATE: 40,
  LOW: 20,
  // Below LOW = PASS
} as const;

/**
 * Per-signal-type minimum score floors.
 * Even if individual factors are low, certain signal types carry baseline confidence.
 */
export const SIGNAL_TYPE_FLOORS: Record<string, number> = {
  FULL_BOOK_CONSENSUS: 55,  // Base floor — all books agree
  REVERSE_LINE_MOVEMENT: 35,
  STEAM_MOVE: 40,
  MARKET_AGREEMENT: 15,
  BOOK_DISAGREEMENT: 10,
  FROZEN_LINE: 20,
  FAKE_STEAM: 5,
  NOISE: 0,
};

/**
 * FULL_BOOK_CONSENSUS scoring boosts (applied on top of standard scoring).
 *
 * Base boost: +30 confidence
 * Sharp book leads: +50
 * Against public: +70 (elite signal)
 * Key number crossed: +10 bonus
 * Reversal after: penalty (handled by FAKE_STEAM classifier)
 */
export const FBC_BOOSTS = {
  BASE: 30,
  SHARP_LED: 50,
  AGAINST_PUBLIC: 70,
  KEY_NUMBER_CROSSED: 10,
} as const;
