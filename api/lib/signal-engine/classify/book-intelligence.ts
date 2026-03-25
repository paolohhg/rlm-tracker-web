// ══════════════════════════════════════════════════════════════════════════════
//  Book Intelligence Layer
//
//  Classifies books by tier and uses that to:
//    1. Weight moves — a Pinnacle move outranks an ESPNBet move
//    2. Detect leader/follower — who moved first, who followed
//    3. Measure disagreement — are books aligned or fragmented?
//    4. Compute weighted coordination — tier-adjusted book agreement
// ══════════════════════════════════════════════════════════════════════════════

import type {
  NormalizedBook,
  BookTier,
  LeaderFollowerResult,
  BookDisagreement,
  MarketThresholds,
} from '../types';
import { getBookConfig } from '../config/book-tiers';

// ── Leader / Follower Detection ──────────────────────────────────────────────

/**
 * Detect which book led the move and who followed.
 *
 * Leader = the book that first moved in the consensus direction.
 * Among books that moved at the same time, the one with the higher
 * tier (lower leader_priority) is treated as the leader.
 *
 * @param books - All normalized books for this market.
 * @param consensusDirection - Sign of the consensus move (+1 or -1).
 * @param meaningfulThreshold - Minimum move to count as "moved".
 */
export function detectLeaderFollower(
  books: NormalizedBook[],
  consensusDirection: number,
  meaningfulThreshold: number,
): LeaderFollowerResult {
  const empty: LeaderFollowerResult = {
    leader: null,
    leader_tier: null,
    followers: [],
    holders: [],
    follow_window_minutes: 0,
  };

  if (consensusDirection === 0 || books.length === 0) return empty;

  // Split into movers (same direction as consensus) and holders
  const movers: NormalizedBook[] = [];
  const holders: string[] = [];

  for (const b of books) {
    const movedWithConsensus =
      Math.sign(b.move) === consensusDirection &&
      Math.abs(b.move) >= meaningfulThreshold * 0.5;
    if (movedWithConsensus) {
      movers.push(b);
    } else {
      holders.push(b.display_name);
    }
  }

  if (movers.length === 0) {
    return { ...empty, holders: books.map(b => b.display_name) };
  }

  // Sort movers by timestamp (earliest first), then by tier priority (sharp first)
  movers.sort((a, b) => {
    const timeDiff = new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime();
    if (Math.abs(timeDiff) > 5 * 60 * 1000) return timeDiff; // >5 min gap → time wins
    // Within 5 minutes, sharp book gets credit as leader
    const configA = getBookConfig(a.book);
    const configB = getBookConfig(b.book);
    return configA.leader_priority - configB.leader_priority;
  });

  const leader = movers[0];
  const followers = movers.slice(1).map(b => b.display_name);

  // Time window between leader and last follower
  let windowMinutes = 0;
  if (movers.length > 1) {
    const leaderTime = new Date(leader.last_seen).getTime();
    const lastFollowerTime = new Date(movers[movers.length - 1].last_seen).getTime();
    windowMinutes = Math.round(Math.abs(lastFollowerTime - leaderTime) / 60000);
  }

  return {
    leader: leader.display_name,
    leader_tier: leader.tier,
    followers,
    holders,
    follow_window_minutes: windowMinutes,
  };
}

// ── Book Disagreement ────────────────────────────────────────────────────────

/**
 * Compute how fragmented the book market is.
 * Groups books by their current line and checks if disagreement
 * exceeds the league-specific threshold.
 */
export function computeBookDisagreement(
  books: NormalizedBook[],
  thresholds: MarketThresholds,
): BookDisagreement {
  if (books.length < 2) {
    return {
      max_spread: 0,
      is_significant: false,
      line_groups: {},
      outliers: [],
    };
  }

  const lines = books.map(b => b.current_line);
  const maxLine = Math.max(...lines);
  const minLine = Math.min(...lines);
  const maxSpread = Math.abs(maxLine - minLine);

  // Group books by their current line (rounded to 0.5)
  const lineGroups: Record<number, string[]> = {};
  for (const b of books) {
    const rounded = Math.round(b.current_line * 2) / 2;
    if (!lineGroups[rounded]) lineGroups[rounded] = [];
    lineGroups[rounded].push(b.display_name);
  }

  // Find outliers: books whose line is >threshold away from the mode
  const lineFreqs: [number, number][] = Object.entries(lineGroups).map(
    ([line, bks]) => [Number(line), bks.length]
  );
  lineFreqs.sort((a, b) => b[1] - a[1]);
  const modeLine = lineFreqs[0]?.[0] ?? 0;

  const outliers: string[] = [];
  for (const b of books) {
    if (Math.abs(b.current_line - modeLine) >= thresholds.disagreement_threshold) {
      outliers.push(b.display_name);
    }
  }

  return {
    max_spread: Math.round(maxSpread * 10) / 10,
    is_significant: maxSpread >= thresholds.disagreement_threshold,
    line_groups: lineGroups,
    outliers,
  };
}

// ── Tier-Weighted Coordination Score ─────────────────────────────────────────

/**
 * Compute a tier-weighted coordination score (0-1).
 *
 * Instead of simple "N out of M books moved", this weights each book's
 * contribution by its tier weight. A Pinnacle move counts for more
 * than an ESPNBet move.
 *
 * Returns a value where:
 *   0 = no books moved
 *   1 = all books moved, all sharp
 */
export function computeWeightedCoordination(
  books: NormalizedBook[],
  consensusDirection: number,
  meaningfulThreshold: number,
): number {
  if (books.length === 0 || consensusDirection === 0) return 0;

  let weightedMoved = 0;
  let totalWeight = 0;

  for (const b of books) {
    totalWeight += b.weight;
    const movedWithConsensus =
      Math.sign(b.move) === consensusDirection &&
      Math.abs(b.move) >= meaningfulThreshold * 0.5;
    if (movedWithConsensus) {
      weightedMoved += b.weight;
    }
  }

  return totalWeight > 0 ? weightedMoved / totalWeight : 0;
}

/**
 * Check if a move was sharp-led (TIER_1 or TIER_2 book moved first
 * or moved in the consensus direction).
 */
export function isSharpLed(
  books: NormalizedBook[],
  consensusDirection: number,
  meaningfulThreshold: number,
): boolean {
  for (const b of books) {
    const isSharp = b.tier === 'TIER_1_SHARP' || b.tier === 'TIER_2_MARKET_MAKER';
    const movedWithConsensus =
      Math.sign(b.move) === consensusDirection &&
      Math.abs(b.move) >= meaningfulThreshold * 0.5;
    if (isSharp && movedWithConsensus) return true;
  }
  return false;
}

/**
 * Get a human-readable summary of book tier participation.
 * e.g. "Sharp-led (Pinnacle), followed by DraftKings, FanDuel"
 */
export function describeBookParticipation(
  leadership: LeaderFollowerResult,
): string {
  if (!leadership.leader) return 'No books moved';

  const parts: string[] = [];

  // Leader description with tier
  const tierLabel = tierToLabel(leadership.leader_tier);
  parts.push(`${tierLabel}-led (${leadership.leader})`);

  // Followers
  if (leadership.followers.length > 0) {
    parts.push(`followed by ${leadership.followers.join(', ')}`);
  }

  // Holders
  if (leadership.holders.length > 0) {
    parts.push(`${leadership.holders.join(', ')} held`);
  }

  // Time window
  if (leadership.follow_window_minutes > 0 && leadership.followers.length > 0) {
    parts.push(`follow window: ${leadership.follow_window_minutes} min`);
  }

  return parts.join('; ');
}

function tierToLabel(tier: BookTier | null): string {
  switch (tier) {
    case 'TIER_1_SHARP': return 'Sharp';
    case 'TIER_2_MARKET_MAKER': return 'Market-maker';
    case 'TIER_3_RETAIL_MAJOR': return 'Retail';
    case 'TIER_4_SOFT': return 'Soft-book';
    case 'TIER_5_UNKNOWN': return 'Unknown-book';
    default: return 'Unknown';
  }
}
