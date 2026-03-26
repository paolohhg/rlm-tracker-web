// ══════════════════════════════════════════════════════════════════════════════
//  Confidence Scorer — Weighted Scorecard
//
//  Takes a SignalClassification + MarketState and produces:
//    - numeric score (0-100)
//    - confidence bucket (HIGH / MODERATE / LOW / PASS)
//    - breakdown of each scoring factor
//    - human-readable explanation of why the score landed where it did
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketState,
  SignalClassification,
  ScoredSignal,
  ScoreBreakdown,
  ConfidenceBucket,
  SignalWeights,
} from '../types';
import { DEFAULT_SIGNAL_WEIGHTS, CONFIDENCE_THRESHOLDS, SIGNAL_TYPE_FLOORS, FBC_BOOSTS } from '../config/signal-weights';
import { getMarketThresholds } from '../config/league-thresholds';
import { computeWeightedCoordination, isSharpLed } from '../classify/book-intelligence';

/**
 * Score a classified signal and produce a confidence assessment.
 *
 * @param state - Normalized market state.
 * @param classification - Output from classifySignal().
 * @param weights - Optional override for scoring weights.
 */
export function scoreSignal(
  state: MarketState,
  classification: SignalClassification,
  weights: SignalWeights = DEFAULT_SIGNAL_WEIGHTS,
): ScoredSignal {
  const T = getMarketThresholds(state.league, state.market_type);
  const explanation: string[] = [];

  // ── 1. Move Magnitude (0 to weights.move_magnitude) ─────────────────
  const absMove = Math.abs(state.move);
  const magnitudeRatio = Math.min(1, absMove / T.steam_move);
  const moveMagnitude = Math.round(magnitudeRatio * weights.move_magnitude);
  if (moveMagnitude > 0) {
    explanation.push(
      `Move size: ${absMove.toFixed(1)} pts (${Math.round(magnitudeRatio * 100)}% of steam threshold) → +${moveMagnitude} pts.`,
    );
  }

  // ── 2. Book Coordination (0 to weights.book_coordination) ───────────
  const consensusDir = Math.sign(state.move);
  const coordination = computeWeightedCoordination(
    state.books, consensusDir, T.meaningful_move,
  );
  const bookCoordination = Math.round(coordination * weights.book_coordination);
  const movedCount = state.books_moved_consensus.length;
  if (bookCoordination > 0) {
    explanation.push(
      `Book coordination: ${movedCount}/${state.total_books} books moved together (weighted: ${(coordination * 100).toFixed(0)}%) → +${bookCoordination} pts.`,
    );
  }

  // ── 3. Book Tier Weight (0 to weights.book_tier_weight) ─────────────
  let bookTierWeight = 0;
  const sharpLed = isSharpLed(state.books, consensusDir, T.meaningful_move);
  if (sharpLed) {
    bookTierWeight = weights.book_tier_weight;
    explanation.push(
      `Sharp-led move (${classification.leadership.leader}) → +${bookTierWeight} pts.`,
    );
  } else if (movedCount >= 2) {
    // Partial credit for retail coordination
    bookTierWeight = Math.round(weights.book_tier_weight * 0.4);
    if (bookTierWeight > 0) {
      explanation.push(
        `Retail-led coordination → +${bookTierWeight} pts.`,
      );
    }
  }

  // ── 4. Velocity (0 to weights.velocity) ─────────────────────────────
  let velocity = 0;
  if (state.velocity > 0 && absMove >= T.meaningful_move) {
    const velRatio = Math.min(1, state.velocity / (T.steam_move / 0.5)); // normalize to ~2x meaningful per hour
    velocity = Math.round(velRatio * weights.velocity);
    if (velocity > 0) {
      explanation.push(
        `Velocity: ${state.velocity.toFixed(2)} pts/hr → +${velocity} pts.`,
      );
    }
  }

  // ── 5. Key Number Crossing (0 or weights.key_number_crossing) ───────
  let keyNumberCrossing = 0;
  if (classification.key_number_crossed) {
    keyNumberCrossing = weights.key_number_crossing;
    explanation.push(
      `Crossed key number ${classification.crossed_number} → +${keyNumberCrossing} pts.`,
    );
  }

  // ── 6. Public Divergence (0 to weights.public_divergence) ───────────
  let publicDivergence = 0;
  const pub = state.public_data;
  if (pub.home_ticket_pct != null) {
    const publicPct = Math.max(
      pub.home_ticket_pct ?? 50,
      pub.away_ticket_pct ?? 50,
    );
    const publicOnHome = (pub.home_ticket_pct ?? 50) > 50;
    const moveAgainstPublic =
      (publicOnHome && state.move > 0) || (!publicOnHome && state.move < 0);

    if (moveAgainstPublic && absMove >= T.meaningful_move) {
      // Scale by how heavy the public is
      const publicStrength = Math.min(1, (publicPct - 50) / 30); // 80% = max
      publicDivergence = Math.round(publicStrength * weights.public_divergence);

      // Bonus for money divergence
      if (pub.home_money_pct != null) {
        const moneyOnPublicSide = publicOnHome ? pub.home_money_pct : (100 - pub.home_money_pct);
        const ticketOnPublicSide = publicPct;
        const divergence = ticketOnPublicSide - moneyOnPublicSide;
        if (divergence > 10) {
          publicDivergence = Math.min(weights.public_divergence, publicDivergence + 3);
          explanation.push(
            `Ticket/money divergence: ${divergence.toFixed(0)}% gap → bonus.`,
          );
        }
      }

      if (publicDivergence > 0) {
        explanation.push(
          `Public divergence: ${publicPct}% public on opposite side → +${publicDivergence} pts.`,
        );
      }
    }
  }

  // ── 7. Reversal Penalty (0 to weights.reversal_penalty) ─────────────
  let reversalPenalty = 0;
  if (classification.type === 'FAKE_STEAM') {
    reversalPenalty = weights.reversal_penalty; // Negative value
    explanation.push(
      `Reversal/fake steam detected → ${reversalPenalty} pts.`,
    );
  }

  // ── 8. Stale Market Penalty (0 to weights.stale_market_penalty) ─────
  let staleMarketPenalty = 0;
  if (state.hours_tracked > 12 && absMove < T.meaningful_move) {
    staleMarketPenalty = weights.stale_market_penalty; // Negative value
    explanation.push(
      `Stale market: ${state.hours_tracked.toFixed(0)}h tracked with minimal movement → ${staleMarketPenalty} pts.`,
    );
  }

  // ── 9. Incomplete Board Penalty ─────────────────────────────────────
  let incompleteBoardPenalty = 0;
  if (state.total_books < 3) {
    incompleteBoardPenalty = weights.incomplete_board_penalty; // Negative value
    explanation.push(
      `Incomplete board: only ${state.total_books} book(s) tracked → ${incompleteBoardPenalty} pts.`,
    );
  }

  // ── FULL_BOOK_CONSENSUS Boosts ────────────────────────────────────
  let fbcBoost = 0;
  if (classification.type === 'FULL_BOOK_CONSENSUS') {
    fbcBoost += FBC_BOOSTS.BASE;
    explanation.push(`Full Book Consensus base boost → +${FBC_BOOSTS.BASE} pts.`);

    // Sharp-led boost
    const sharpLedFbc = isSharpLed(state.books, Math.sign(state.move), getMarketThresholds(state.league, state.market_type).meaningful_move);
    if (sharpLedFbc) {
      fbcBoost += FBC_BOOSTS.SHARP_LED;
      explanation.push(`Sharp book led FBC → +${FBC_BOOSTS.SHARP_LED} pts.`);
    }

    // Against-public boost (elite signal)
    const pubFbc = state.public_data;
    if (pubFbc.home_ticket_pct != null) {
      const publicOnHomeFbc = pubFbc.home_ticket_pct > 50;
      const moveTowardHomeFbc = state.move < 0;
      const moveAgainstPublicFbc = (publicOnHomeFbc && !moveTowardHomeFbc) || (!publicOnHomeFbc && moveTowardHomeFbc);
      if (moveAgainstPublicFbc) {
        fbcBoost += FBC_BOOSTS.AGAINST_PUBLIC;
        explanation.push(`FBC against public → +${FBC_BOOSTS.AGAINST_PUBLIC} pts (elite signal).`);
      }
    }

    // Key number crossing bonus
    if (classification.key_number_crossed) {
      fbcBoost += FBC_BOOSTS.KEY_NUMBER_CROSSED;
      explanation.push(`FBC crossed key number → +${FBC_BOOSTS.KEY_NUMBER_CROSSED} pts.`);
    }
  }

  // ── Compute Total ──────────────────────────────────────────────────
  const rawTotal =
    moveMagnitude +
    bookCoordination +
    bookTierWeight +
    velocity +
    keyNumberCrossing +
    publicDivergence +
    reversalPenalty +
    staleMarketPenalty +
    incompleteBoardPenalty +
    fbcBoost;

  // Apply signal-type floor
  const floor = SIGNAL_TYPE_FLOORS[classification.type] ?? 0;
  const clamped = Math.max(0, Math.min(100, Math.max(rawTotal, floor)));

  const breakdown: ScoreBreakdown = {
    move_magnitude: moveMagnitude,
    book_coordination: bookCoordination,
    book_tier_weight: bookTierWeight,
    velocity,
    key_number_crossing: keyNumberCrossing,
    public_divergence: publicDivergence,
    reversal_penalty: reversalPenalty,
    stale_market_penalty: staleMarketPenalty,
    incomplete_board_penalty: incompleteBoardPenalty,
    raw_total: rawTotal,
    clamped_total: clamped,
  };

  // ── Confidence Bucket ──────────────────────────────────────────────
  const confidence = scoreToConfidence(clamped);

  return {
    score: clamped,
    confidence,
    breakdown,
    explanation,
  };
}

function scoreToConfidence(score: number): ConfidenceBucket {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MODERATE) return 'MODERATE';
  if (score >= CONFIDENCE_THRESHOLDS.LOW) return 'LOW';
  return 'PASS';
}
