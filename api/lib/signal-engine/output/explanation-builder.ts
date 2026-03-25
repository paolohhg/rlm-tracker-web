// ══════════════════════════════════════════════════════════════════════════════
//  Explanation Builder — Plain-English Signal Narratives
//
//  Every explanation is:
//    1. Anchored to opener → current
//    2. Team-relative (never "moved toward +6.5")
//    3. Identifies sharp vs retail, leader vs follower
//    4. Explains why the engine scored it that way
// ══════════════════════════════════════════════════════════════════════════════

import type { MarketState, SignalClassification, ScoredSignal } from '../types';
import { describeBookParticipation } from '../classify/book-intelligence';

/**
 * Build a complete plain-English explanation for a signal.
 */
export function buildExplanation(
  state: MarketState,
  classification: SignalClassification,
  scored: ScoredSignal,
): string {
  const paragraphs: string[] = [];

  // ── Paragraph 1: Movement anchored to opener ───────────────────────
  paragraphs.push(classification.direction.description);

  // ── Paragraph 2: Signal classification ─────────────────────────────
  paragraphs.push(buildSignalParagraph(classification));

  // ── Paragraph 3: Book intelligence ─────────────────────────────────
  const bookParagraph = buildBookParagraph(state, classification);
  if (bookParagraph) paragraphs.push(bookParagraph);

  // ── Paragraph 4: Public context ────────────────────────────────────
  const publicParagraph = buildPublicParagraph(state, classification);
  if (publicParagraph) paragraphs.push(publicParagraph);

  // ── Paragraph 5: Confidence rationale ──────────────────────────────
  paragraphs.push(buildConfidenceParagraph(scored));

  return paragraphs.join(' ');
}

function buildSignalParagraph(classification: SignalClassification): string {
  const type = classification.type;
  const factors = classification.factors;

  const typeLabels: Record<string, string> = {
    REVERSE_LINE_MOVEMENT: 'Reverse line movement detected.',
    STEAM_MOVE: 'Steam move detected.',
    MARKET_AGREEMENT: 'Market agreement — public and line aligned.',
    BOOK_DISAGREEMENT: 'Book disagreement — market fragmented.',
    FROZEN_LINE: 'Frozen line — market resisting public pressure.',
    FAKE_STEAM: 'Potential fake steam — move lacks full confirmation.',
    NOISE: 'No meaningful signal — market noise.',
  };

  const parts: string[] = [typeLabels[type] ?? type];

  // Add the most important factor
  if (factors.length > 0) {
    parts.push(factors[0]);
  }

  return parts.join(' ');
}

function buildBookParagraph(
  state: MarketState,
  classification: SignalClassification,
): string | null {
  const { leadership } = classification;
  if (!leadership.leader && state.books_moved_consensus.length === 0) return null;

  const participation = describeBookParticipation(leadership);
  const parts = [participation + '.'];

  // Add disagreement context
  if (classification.disagreement.is_significant) {
    parts.push(
      `Book disagreement: ${classification.disagreement.max_spread} pts spread across books.`,
    );
    if (classification.disagreement.outliers.length > 0) {
      parts.push(`Outlier(s): ${classification.disagreement.outliers.join(', ')}.`);
    }
  }

  return parts.join(' ');
}

function buildPublicParagraph(
  state: MarketState,
  classification: SignalClassification,
): string | null {
  const pub = state.public_data;
  if (pub.home_ticket_pct == null) return null;

  const parts: string[] = [];
  const publicPct = Math.max(
    pub.home_ticket_pct ?? 50,
    pub.away_ticket_pct ?? 50,
  );
  const publicTeam = (pub.home_ticket_pct ?? 50) > 50
    ? state.home_team
    : state.away_team;

  parts.push(`Public: ${publicPct}% on ${publicTeam}.`);

  if (pub.home_money_pct != null) {
    const moneyPctOnPublicSide = (pub.home_ticket_pct ?? 50) > 50
      ? pub.home_money_pct
      : (100 - pub.home_money_pct);
    const divergence = publicPct - moneyPctOnPublicSide;

    if (divergence > 8) {
      parts.push(
        `Money diverges: only ${moneyPctOnPublicSide}% of money on ${publicTeam} vs ${publicPct}% of tickets — sharp money likely opposite side.`,
      );
    } else if (moneyPctOnPublicSide > 50) {
      parts.push(`Money aligned with public at ${moneyPctOnPublicSide}%.`);
    }
  }

  if (classification.type === 'REVERSE_LINE_MOVEMENT') {
    const moveTeam = classification.direction.toward_team;
    if (moveTeam && moveTeam !== publicTeam) {
      parts.push(`Line moved toward ${moveTeam} despite public favoring ${publicTeam}.`);
    }
  } else if (classification.type === 'MARKET_AGREEMENT') {
    parts.push(`Line moved with public — consensus pressure, not sharp signal.`);
  }

  return parts.join(' ');
}

function buildConfidenceParagraph(scored: ScoredSignal): string {
  const { score, confidence, explanation } = scored;

  const parts: string[] = [
    `Confidence: ${confidence} (score: ${score}/100).`,
  ];

  // Summarize top contributors
  const positives = explanation.filter(e => e.includes('→ +'));
  const negatives = explanation.filter(e => e.includes('→ -') || e.includes('→ '));

  if (positives.length > 0) {
    parts.push(`Key factors: ${positives.slice(0, 3).join(' ')}`.replace(/\.$/, '.'));
  }

  if (negatives.length > 0) {
    const penalties = negatives.filter(e => e.includes('penalty') || e.includes('Reversal'));
    if (penalties.length > 0) {
      parts.push(`Penalties: ${penalties.join(' ')}`.replace(/\.$/, '.'));
    }
  }

  return parts.join(' ');
}
