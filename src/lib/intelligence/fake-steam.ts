/**
 * Fake Steam Tracker — V1 Fallback Logic
 *
 * Detects large apparent market moves that are not confirmed by enough
 * sportsbooks — suggesting noise, an isolated move, or a head fake.
 *
 * V1 uses cross-book spread comparison (no timestamped per-book history required).
 * V2 (TODO) would use timestamped per-book line history for leader/follower analysis.
 */

export interface FakeSteamInput {
  /** Current spread lines from all tracked books for this game (nulls excluded) */
  bookLines: number[];
}

export interface FakeSteamResult {
  isFakeSteam: boolean;
  fakeSteamScore: number;
  fakeSteamReason: string | null;
  // V2 fields — null in V1 fallback
  followerCount: number | null;
  confirmationRate: number | null;
  // V1 computed fields
  marketRange: number | null;
  medianLine: number | null;
  outlierBookCount: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeFakeSteam(input: FakeSteamInput): FakeSteamResult {
  const none: FakeSteamResult = {
    isFakeSteam: false,
    fakeSteamScore: 0,
    fakeSteamReason: null,
    followerCount: null,
    confirmationRate: null,
    marketRange: null,
    medianLine: null,
    outlierBookCount: null,
  };

  const lines = input.bookLines.filter(l => l !== null && !isNaN(l));

  // Insufficient data — need at least 3 books
  if (lines.length < 3) return none;

  const sorted = [...lines].sort((a, b) => a - b);
  const medianVal = median(sorted);
  const minLine = sorted[0];
  const maxLine = sorted[sorted.length - 1];
  const marketRange = maxLine - minLine;
  const outlierBookCount = lines.filter(l => Math.abs(l - medianVal) >= 0.5).length;

  let score = 0;

  if (marketRange >= 1.0) score += 1;
  if (marketRange >= 1.5) score += 1;
  if (outlierBookCount <= 1) score += 1;
  if (outlierBookCount === 1 && marketRange >= 1.0) score += 1;
  // Note: outlierBookCount === 0 with wide range may reflect stale/inconsistent
  // data rather than a true fake steam move. Use softer language in reason string.
  if (outlierBookCount === 0 && marketRange >= 1.0) score += 1;

  const isFakeSteam = score >= 3;

  let fakeSteamReason: string | null = null;
  if (isFakeSteam) {
    if (outlierBookCount === 1) {
      fakeSteamReason = 'One off-market book is creating a wide range without broad confirmation';
    } else if (outlierBookCount === 0 && marketRange >= 1.0) {
      fakeSteamReason = 'Books are inconsistently split — move is not broadly confirmed';
    } else {
      fakeSteamReason = 'Market spread range is wide but confirmation is weak';
    }
  }

  return {
    isFakeSteam,
    fakeSteamScore: score,
    fakeSteamReason,
    followerCount: null,     // V2 only
    confirmationRate: null,  // V2 only
    marketRange,
    medianLine: medianVal,
    outlierBookCount,
  };
}
