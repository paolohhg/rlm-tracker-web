// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Core Computation
//
//  Sport-agnostic. Takes raw snapshots for a single market (e.g., "spread"
//  for one game) and produces a TrueOpenResult with book-level opens,
//  consensus open, market path, structure detection, and diagnostics.
//
//  No sport-specific assumptions. No hardcoded thresholds for specific leagues.
//  Downstream consumers (MLB truth layer, NHL classifier, etc.) interpret
//  the universal output through their own sport-specific lenses.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketSnapshot,
  TrueOpenResult,
  BookTrueOpen,
  ConsensusTrueOpen,
  TrueOpenDiagnostics,
  SourceMethod,
  MarketDirection,
  MarketStructure,
  ConfidenceLabel,
} from './types';

// ── Sharp Book Classification ────────────────────────────────────────────────

const SHARP_BOOKS = new Set([
  'pinnacle', 'circa', 'bookmaker', 'heritage',
]);

function isSharp(book: string): boolean {
  return SHARP_BOOKS.has(book.toLowerCase());
}

// ── MODE consensus (most common value) ───────────────────────────────────────

function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
  let maxFreq = 0;
  for (const count of freq.values()) if (count > maxFreq) maxFreq = count;
  const candidates = [...freq.entries()].filter(([, c]) => c === maxFreq).map(([v]) => v);
  if (candidates.length === 1) return candidates[0];
  // Tiebreak: closest to median
  const sorted = [...nums].sort((a, b) => a - b);
  const medianVal = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianVal) - Math.abs(b - medianVal));
  return candidates[0];
}

// ── Main Engine ──────────────────────────────────────────────────────────────

/**
 * Compute the True Open for a single market of a single game.
 *
 * @param snapshots - ALL snapshots for this market, across all books, chronological
 * @param marketType - 'spread' | 'total' | 'moneyline' | any string
 * @param league - 'NBA' | 'MLB' | etc.
 * @param gameId - Unique game identifier
 * @param gameTime - ISO timestamp of game start (for tracker delay calculation)
 * @param side - 'home' | 'away' | 'over' | 'under' | null
 */
export function computeTrueOpen(
  snapshots: MarketSnapshot[],
  marketType: string,
  league: string,
  gameId: string,
  gameTime: string | null,
  side: string | null = null,
): TrueOpenResult {
  if (snapshots.length === 0) {
    return emptyResult(marketType, league, gameId, side);
  }

  // Sort chronologically
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // ── Step 1: Per-book true opens ────────────────────────────────

  // Group by book
  const bookGroups: Record<string, MarketSnapshot[]> = {};
  for (const s of sorted) {
    if (!bookGroups[s.book]) bookGroups[s.book] = [];
    bookGroups[s.book].push(s);
  }

  const byBook: BookTrueOpen[] = [];
  const allFirstTimestamps: number[] = [];

  for (const [book, snaps] of Object.entries(bookGroups)) {
    const validSnaps = snaps.filter(s => s.value !== 0 && s.value != null);
    if (validSnaps.length === 0) {
      byBook.push({
        book, trueOpen: null, trueOpenTs: null, current: null, currentTs: null,
        sourceMethod: 'unknown', reliability: 0, isSharpBook: isSharp(book),
        wasTrackerLate: false, snapshotCount: 0, notes: ['No valid snapshots'],
      });
      continue;
    }

    const earliest = validSnaps[0];
    const latest = validSnaps[validSnaps.length - 1];
    const firstTs = new Date(earliest.timestamp).getTime();
    allFirstTimestamps.push(firstTs);

    // Determine source method
    let sourceMethod: SourceMethod = 'direct_earliest';
    let wasTrackerLate = false;
    const notes: string[] = [];

    // If we only have 1-2 snapshots and the first one is very recent
    // relative to game time, we probably started tracking late
    if (gameTime) {
      const gameTimeMs = new Date(gameTime).getTime();
      const hoursBeforeGame = (gameTimeMs - firstTs) / 3600000;
      if (hoursBeforeGame < 1 && validSnaps.length <= 3) {
        sourceMethod = 'fallback_first_seen';
        wasTrackerLate = true;
        notes.push(`First snapshot only ${hoursBeforeGame.toFixed(1)}h before game`);
      } else if (hoursBeforeGame < 4 && validSnaps.length <= 5) {
        sourceMethod = 'reconstructed';
        notes.push(`Limited early data (${validSnaps.length} snaps, ${hoursBeforeGame.toFixed(1)}h before game)`);
      }
    }

    // Reliability score
    let reliability = 50; // base
    if (sourceMethod === 'direct_earliest') reliability = 85;
    else if (sourceMethod === 'reconstructed') reliability = 60;
    else if (sourceMethod === 'fallback_first_seen') reliability = 30;

    // Bonus for more snapshots (more data = more confidence in open)
    reliability += Math.min(15, validSnaps.length * 2);

    // Bonus for sharp book (more likely to have accurate early numbers)
    if (isSharp(book)) reliability += 5;

    reliability = Math.min(100, reliability);

    byBook.push({
      book,
      trueOpen: earliest.value,
      trueOpenTs: earliest.timestamp,
      current: latest.value,
      currentTs: latest.timestamp,
      sourceMethod,
      reliability,
      isSharpBook: isSharp(book),
      wasTrackerLate,
      snapshotCount: validSnaps.length,
      notes,
    });
  }

  // ── Step 2: Consensus true open ────────────────────────────────

  const booksWithOpen = byBook.filter(b => b.trueOpen != null);
  const openValues = booksWithOpen.map(b => b.trueOpen!);
  const currentValues = byBook.filter(b => b.current != null).map(b => b.current!);

  const consensusOpen = openValues.length > 0 ? mode(openValues) : null;
  const consensusCurrent = currentValues.length > 0 ? mode(currentValues) : null;

  // ── Step 3: Market path (time-bucketed consensus) ──────────────

  // Group all snapshots into 30-min buckets and compute MODE per bucket
  const bucketMs = 30 * 60 * 1000;
  const buckets: Record<number, number[]> = {};
  for (const s of sorted) {
    if (s.value === 0 || s.value == null) continue;
    const bucket = Math.floor(new Date(s.timestamp).getTime() / bucketMs);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(s.value);
  }

  const sortedBucketKeys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  const path: number[] = sortedBucketKeys.map(k => mode(buckets[k]));

  // Market high / low from path
  const marketHigh = path.length > 0 ? Math.max(...path) : null;
  const marketLow = path.length > 0 ? Math.min(...path) : null;

  // ── Step 4: Direction and structure detection ──────────────────

  let directionFromOpen: MarketDirection = 'unknown';
  let structure: MarketStructure = 'unknown';

  if (consensusOpen != null && consensusCurrent != null && path.length >= 2) {
    const totalMove = consensusCurrent - consensusOpen;
    const absMove = Math.abs(totalMove);

    // Direction from open to current
    if (absMove < 0.01) {
      directionFromOpen = 'flat';
    } else if (totalMove > 0) {
      directionFromOpen = 'up';
    } else {
      directionFromOpen = 'down';
    }

    // Structure: analyze direction changes in the path
    const directions: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const diff = path[i] - path[i - 1];
      if (Math.abs(diff) > 0.01) {
        directions.push(Math.sign(diff));
      }
    }

    const uniqueDirs = new Set(directions);
    const dirChanges = directions.reduce((count, d, i) =>
      i > 0 && d !== directions[i - 1] ? count + 1 : count, 0);

    if (directions.length === 0 || uniqueDirs.size === 0) {
      structure = 'range_bound';
    } else if (uniqueDirs.size === 1) {
      structure = 'one_way';
    } else if (dirChanges === 1) {
      structure = 'reversal';
    } else if (dirChanges >= 2) {
      // Check if the range is small relative to the move
      const range = (marketHigh ?? 0) - (marketLow ?? 0);
      if (range > 0 && absMove / range < 0.3) {
        structure = 'range_bound';
      } else {
        structure = 'whipsaw';
      }
    }
  } else if (path.length <= 1) {
    directionFromOpen = 'flat';
    structure = 'range_bound';
  }

  // ── Step 5: Path string ────────────────────────────────────────

  let pathString: string | null = null;
  if (path.length >= 2) {
    // Deduplicate consecutive same values
    const deduped = [path[0]];
    for (let i = 1; i < path.length; i++) {
      if (path[i] !== deduped[deduped.length - 1]) {
        deduped.push(path[i]);
      }
    }
    pathString = deduped.join(' → ');
  }

  // ── Step 6: Consensus reliability ──────────────────────────────

  let consensusReliability = 0;
  if (booksWithOpen.length === 0) {
    consensusReliability = 0;
  } else {
    // Base: average of per-book reliability
    const avgBookReliability = booksWithOpen.reduce((s, b) => s + b.reliability, 0) / booksWithOpen.length;
    consensusReliability = avgBookReliability;

    // Bonus for agreement (all books agree on similar open)
    if (openValues.length >= 2) {
      const openRange = Math.max(...openValues) - Math.min(...openValues);
      if (openRange === 0) consensusReliability += 10;
      else if (openRange <= 1) consensusReliability += 5;
    }

    // Bonus for having sharp book opens
    const sharpOpens = booksWithOpen.filter(b => b.isSharpBook).length;
    if (sharpOpens > 0) consensusReliability += 5;

    // Penalty for tracker-late on majority of books
    const lateBooks = booksWithOpen.filter(b => b.wasTrackerLate).length;
    if (lateBooks > booksWithOpen.length / 2) consensusReliability -= 15;

    consensusReliability = Math.max(0, Math.min(100, consensusReliability));
  }

  const confidenceLabel: ConfidenceLabel =
    consensusReliability >= 75 ? 'High'
      : consensusReliability >= 50 ? 'Moderate'
        : consensusReliability >= 25 ? 'Low'
          : 'Unreliable';

  const consensus: ConsensusTrueOpen = {
    trueOpen: consensusOpen,
    trueOpenRange: {
      low: openValues.length > 0 ? Math.min(...openValues) : null,
      high: openValues.length > 0 ? Math.max(...openValues) : null,
    },
    current: consensusCurrent,
    marketHigh,
    marketLow,
    path,
    pathString,
    directionFromOpen,
    structure,
    reliability: consensusReliability,
    confidenceLabel,
  };

  // ── Step 7: Diagnostics ────────────────────────────────────────

  const firstRecordedTs = allFirstTimestamps.length > 0
    ? new Date(Math.min(...allFirstTimestamps)).toISOString()
    : null;

  let trackerStartDelayMinutes: number | null = null;
  if (gameTime && firstRecordedTs) {
    const gameTimeMs = new Date(gameTime).getTime();
    const firstMs = new Date(firstRecordedTs).getTime();
    // Typical markets open 12-48h before game. If our first snapshot is
    // much closer than that, we started late.
    const hoursBeforeGame = (gameTimeMs - firstMs) / 3600000;
    if (hoursBeforeGame < 12) {
      // Estimate: markets usually open ~24h before. Our delay = 24h - actual hours.
      trackerStartDelayMinutes = Math.max(0, Math.round((24 - hoursBeforeGame) * 60));
    }
  }

  const flags: string[] = [];
  if (booksWithOpen.length === 0) flags.push('NO_BOOK_OPENS');
  if (booksWithOpen.length === 1) flags.push('SINGLE_BOOK_OPEN');
  if (booksWithOpen.every(b => b.wasTrackerLate)) flags.push('ALL_BOOKS_TRACKER_LATE');
  if (booksWithOpen.some(b => b.wasTrackerLate) && !booksWithOpen.every(b => b.wasTrackerLate)) {
    flags.push('PARTIAL_TRACKER_LATE');
  }
  if (structure === 'reversal') flags.push('REVERSAL_DETECTED');
  if (structure === 'whipsaw') flags.push('WHIPSAW_DETECTED');
  if (consensusReliability < 25) flags.push('UNRELIABLE_OPEN');
  if (byBook.filter(b => b.isSharpBook && b.trueOpen != null).length === 0) {
    flags.push('NO_SHARP_BOOK_OPEN');
  }

  const diagnostics: TrueOpenDiagnostics = {
    booksTracked: byBook.length,
    booksWithTrueOpen: booksWithOpen.length,
    sharpBooksWithTrueOpen: booksWithOpen.filter(b => b.isSharpBook).length,
    firstRecordedTs,
    marketEarliestTs: firstRecordedTs, // Same unless we have external opener data
    trackerStartDelayMinutes,
    flags,
  };

  return {
    marketType,
    league,
    gameId,
    side,
    byBook,
    consensus,
    diagnostics,
  };
}

// ── Empty Result ─────────────────────────────────────────────────────────────

function emptyResult(
  marketType: string, league: string, gameId: string, side: string | null,
): TrueOpenResult {
  return {
    marketType, league, gameId, side,
    byBook: [],
    consensus: {
      trueOpen: null, trueOpenRange: { low: null, high: null },
      current: null, marketHigh: null, marketLow: null,
      path: [], pathString: null,
      directionFromOpen: 'unknown', structure: 'unknown',
      reliability: 0, confidenceLabel: 'Unreliable',
    },
    diagnostics: {
      booksTracked: 0, booksWithTrueOpen: 0, sharpBooksWithTrueOpen: 0,
      firstRecordedTs: null, marketEarliestTs: null,
      trackerStartDelayMinutes: null,
      flags: ['NO_DATA'],
    },
  };
}
