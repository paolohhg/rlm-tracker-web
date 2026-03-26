// ══════════════════════════════════════════════════════════════════════════════
//  Signal Output Builder — Action-Network-Style Structured Output
//
//  Produces a clean, readable output structure for every analyzed market.
//  Inspired by Action Network's clarity — opener, current, movement,
//  public context, book comparison, signal classification, explanation.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketState,
  SignalClassification,
  ScoredSignal,
  SignalOutput,
} from '../types';
import { describeBookParticipation } from '../classify/book-intelligence';
import { buildExplanation } from './explanation-builder';

/**
 * Build the final Action-Network-style signal output.
 */
export function buildSignalOutput(
  state: MarketState,
  classification: SignalClassification,
  scored: ScoredSignal,
): SignalOutput {
  const { direction, leadership, disagreement } = classification;

  // ── Header ─────────────────────────────────────────────────────────
  const matchup = `${state.away_team} @ ${state.home_team}`;

  // ── Lines ──────────────────────────────────────────────────────────
  const opener = formatLineDisplay(state.market_type, state.opener, state.home_team, state.away_team);
  const current = formatLineDisplay(state.market_type, state.current, state.home_team, state.away_team);

  // ── Movement Summary ───────────────────────────────────────────────
  const lineMovementSummary = direction.description;

  const movementTracker = buildMovementTracker(state, classification);

  // ── Public Betting ─────────────────────────────────────────────────
  const publicBettingSummary = buildPublicSummary(state);

  // ── Book Comparison ────────────────────────────────────────────────
  const bookComparisonSummary = buildBookComparison(state, classification);

  // ── Market Lean ────────────────────────────────────────────────────
  const marketLean = buildMarketLean(state, direction);

  // ── Explanation ────────────────────────────────────────────────────
  const explanation = buildExplanation(state, classification, scored);

  // ── Detail ─────────────────────────────────────────────────────────
  const detail = {
    line_movement: direction.description,
    book_leadership: describeBookParticipation(leadership),
    public_data: publicBettingSummary,
    market_state: describeMarketState(classification),
    confirmation_factors: scored.explanation.filter(e => !e.includes('→ -')),
    invalidation_factors: scored.explanation.filter(e => e.includes('→ -')),
  };

  return {
    matchup,
    league: state.league,
    market: state.market_type,
    opener,
    current,
    line_movement_summary: lineMovementSummary,
    movement_tracker: movementTracker,
    public_betting_summary: publicBettingSummary,
    book_comparison_summary: bookComparisonSummary,
    signal_type: classification.type,
    market_lean: marketLean,
    confidence: scored.confidence,
    confidence_score: scored.score,
    explanation,
    detail,
    score_breakdown: scored.breakdown,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLineDisplay(
  marketType: string,
  line: number,
  homeTeam: string,
  awayTeam: string,
): string {
  if (marketType === 'total') return `O/U ${line}`;
  if (marketType === 'moneyline') {
    return `${homeTeam} ${line > 0 ? '+' : ''}${line}`;
  }
  // Spread — show from home perspective with team name
  return `${homeTeam} ${line > 0 ? '+' : ''}${line}`;
}

function buildMovementTracker(
  state: MarketState,
  classification: SignalClassification,
): string {
  const parts: string[] = [];
  const { direction } = classification;

  parts.push(`Opener: ${formatSpread(state.opener)}`);
  parts.push(`Current: ${formatSpread(state.current)}`);
  parts.push(`Move: ${state.move > 0 ? '+' : ''}${state.move.toFixed(1)}`);

  if (direction.toward_team) {
    parts.push(`Direction: Toward ${direction.toward_team}`);
  }

  parts.push(`Velocity: ${state.velocity.toFixed(2)} pts/hr`);
  parts.push(`Books: ${state.books_moved_consensus.length}/${state.total_books} moved`);

  if (classification.key_number_crossed) {
    parts.push(`Key number ${classification.crossed_number} crossed`);
  }

  return parts.join(' | ');
}

function buildPublicSummary(state: MarketState): string {
  const pub = state.public_data;
  if (pub.home_ticket_pct == null) return 'No public data available.';

  const parts: string[] = [];

  const ticketHome = pub.home_ticket_pct;
  const ticketAway = pub.away_ticket_pct ?? (100 - ticketHome);
  parts.push(`Tickets: ${state.home_team} ${ticketHome}% / ${state.away_team} ${ticketAway}%`);

  if (pub.home_money_pct != null) {
    const moneyHome = pub.home_money_pct;
    const moneyAway = pub.away_money_pct ?? (100 - moneyHome);
    parts.push(`Money: ${state.home_team} ${moneyHome}% / ${state.away_team} ${moneyAway}%`);

    // Flag divergence
    const divergence = Math.abs(ticketHome - moneyHome);
    if (divergence >= 8) {
      const sharpSide = moneyHome > ticketHome ? state.home_team : state.away_team;
      parts.push(`Sharp indicator: ${divergence}% ticket/money divergence toward ${sharpSide}`);
    }
  }

  return parts.join('. ') + '.';
}

function buildBookComparison(
  state: MarketState,
  classification: SignalClassification,
): string {
  const parts: string[] = [];

  // List each book's position
  for (const b of state.books) {
    const moveStr = b.move !== 0
      ? ` (${b.move > 0 ? '+' : ''}${b.move.toFixed(1)})`
      : ' (held)';
    parts.push(`${b.display_name}: ${formatSpread(b.current_line)}${moveStr}`);
  }

  // Disagreement
  if (classification.disagreement.is_significant) {
    parts.push(`Book disagreement: ${classification.disagreement.max_spread} pts`);
  }

  return parts.join(' | ');
}

function buildMarketLean(
  state: MarketState,
  direction: import('../types').DirectionalMove,
): string {
  if (!direction.toward_team) return 'PASS';

  if (state.market_type === 'total') {
    return `${direction.toward_team} ${state.current}`;
  }

  if (state.market_type === 'moneyline') {
    return `${direction.toward_team} ML`;
  }

  // Spread — show the team the line is moving toward with their spread
  const towardHome = state.move < 0;
  if (towardHome) {
    return `${state.home_team} ${formatSpread(state.current)}`;
  }
  const awaySpread = -state.current;
  return `${state.away_team} ${formatSpread(awaySpread)}`;
}

function describeMarketState(classification: SignalClassification): string {
  const labels: Record<string, string> = {
    REVERSE_LINE_MOVEMENT: 'Reverse line movement — line moving against public side',
    STEAM_MOVE: 'Steam move — coordinated multi-book movement',
    MARKET_AGREEMENT: 'Market agreement — public, money, and line aligned',
    BOOK_DISAGREEMENT: 'Book disagreement — fragmented market, no consensus',
    FROZEN_LINE: 'Frozen line — public pressure but books resisting movement',
    FAKE_STEAM: 'Fake steam — move retraced or lacked confirmation',
    NOISE: 'Noise — no meaningful signal detected',
  };
  return labels[classification.type] ?? classification.type;
}

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
}
