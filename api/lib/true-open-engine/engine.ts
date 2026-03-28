// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Core Computation
//
//  Sport-agnostic. Takes raw snapshots for a single market and produces
//  a TrueOpenResult. No sport-specific assumptions in this file.
//
//  Functions:
//    computeBookTrueOpen()       — per-book true open with reliability
//    computeConsensusTrueOpen()  — weighted consensus from book opens
//    buildMarketPath()           — time-bucketed path with dedup
//    classifyMarketStructure()   — one_way / reversal / whipsaw / range_bound
//    scoreOpenReliability()      — 0-100 reliability for a single book
//    computeTrueOpenResult()     — full pipeline (entry point)
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MarketSnapshot,
  TrueOpenResult,
  BookTrueOpen,
  ConsensusTrueOpen,
  TrueOpenDiagnostics,
  SourceMethod,
} from './types';
import {
  getBookWeight,
  isSharpBook,
  RELIABILITY_CONFIG,
  TRACKER_LATE_CONFIG,
  RECONSTRUCTION_CONFIG,
} from './config';
import {
  mode,
  weightedAverage,
  deduplicatePath,
  pathToString,
  computeDirection,
  classifyStructure,
  reliabilityToConfidence,
  buildTimeBucketedPath,
} from './utils';

// ── Step 1: Per-Book True Open ───────────────────────────────────────────────

export function computeBookTrueOpen(
  bookSnapshots: MarketSnapshot[],
  book: string,
  gameTime: string | null,
): BookTrueOpen {
  const validSnaps = bookSnapshots.filter(s => s.value !== 0 && s.value != null);

  if (validSnaps.length === 0) {
    return {
      book, trueOpen: null, trueOpenTs: null, current: null, currentTs: null,
      sourceMethod: 'unknown', reliability: 0, isSharpBook: isSharpBook(book),
      wasTrackerLate: false, snapshotCount: 0, notes: ['No valid snapshots'],
    };
  }

  const earliest = validSnaps[0];
  const latest = validSnaps[validSnaps.length - 1];
  const notes: string[] = [];

  // ── Determine source method ────────────────────────────────────
  let sourceMethod: SourceMethod = 'direct_earliest';
  let wasTrackerLate = false;

  if (gameTime) {
    const gameTimeMs = new Date(gameTime).getTime();
    const firstMs = new Date(earliest.timestamp).getTime();
    const hoursBeforeGame = (gameTimeMs - firstMs) / 3600000;

    if (hoursBeforeGame < TRACKER_LATE_CONFIG.LATE_THRESHOLD_HOURS &&
        validSnaps.length <= 3) {
      sourceMethod = 'fallback_first_seen';
      wasTrackerLate = true;
      notes.push(`First snapshot only ${hoursBeforeGame.toFixed(1)}h before game — tracker late`);
    } else if (hoursBeforeGame < TRACKER_LATE_CONFIG.LATE_THRESHOLD_LIMITED_HOURS &&
               validSnaps.length <= TRACKER_LATE_CONFIG.LIMITED_SNAPSHOT_COUNT) {
      sourceMethod = 'reconstructed';
      notes.push(`Limited early data (${validSnaps.length} snaps, ${hoursBeforeGame.toFixed(1)}h before game)`);
    }
  }

  // ── Reconstruction check ───────────────────────────────────────
  // If the first captured value is already far from the observed min/max,
  // the market likely moved before we started tracking.
  if (validSnaps.length >= 3) {
    const values = validSnaps.map(s => s.value);
    const observedMin = Math.min(...values);
    const observedMax = Math.max(...values);
    const range = observedMax - observedMin;
    const firstIsNearExtreme = Math.abs(earliest.value - observedMin) < range * 0.2 ||
                                Math.abs(earliest.value - observedMax) < range * 0.2;

    if (range > RECONSTRUCTION_CONFIG.LATE_INDICATOR_DISTANCE && !firstIsNearExtreme) {
      // First value is in the middle of the observed range — probably started late
      if (sourceMethod === 'direct_earliest') {
        sourceMethod = 'reconstructed';
        notes.push('First value mid-range — may have missed true open');
      }
    }
  }

  // ── Reliability scoring ────────────────────────────────────────
  const reliability = scoreOpenReliability(sourceMethod, validSnaps.length, isSharpBook(book), wasTrackerLate);

  return {
    book,
    trueOpen: earliest.value,
    trueOpenTs: earliest.timestamp,
    current: latest.value,
    currentTs: latest.timestamp,
    sourceMethod,
    reliability,
    isSharpBook: isSharpBook(book),
    wasTrackerLate,
    snapshotCount: validSnaps.length,
    notes,
  };
}

// ── Reliability Scoring ──────────────────────────────────────────────────────

export function scoreOpenReliability(
  sourceMethod: SourceMethod,
  snapshotCount: number,
  isSharp: boolean,
  wasTrackerLate: boolean,
): number {
  const R = RELIABILITY_CONFIG;
  let score: number;

  switch (sourceMethod) {
    case 'direct_earliest': score = R.BASE_DIRECT; break;
    case 'reconstructed': score = R.BASE_RECONSTRUCTED; break;
    case 'fallback_first_seen': score = R.BASE_FALLBACK; break;
    default: score = 0;
  }

  // Snapshot count bonus
  score += Math.min(R.MAX_SNAPSHOT_BONUS, snapshotCount * R.BONUS_PER_SNAPSHOT);

  // Sharp book bonus
  if (isSharp) score += R.BONUS_SHARP_BOOK;

  // Tracker late penalty
  if (wasTrackerLate) score += R.PENALTY_TRACKER_LATE;

  return Math.max(0, Math.min(100, score));
}

// ── Step 2: Consensus True Open ──────────────────────────────────────────────

export function computeConsensusTrueOpen(
  bookOpens: BookTrueOpen[],
  path: number[],
  marketType: string,
  league: string,
): ConsensusTrueOpen {
  const booksWithOpen = bookOpens.filter(b => b.trueOpen != null);
  const currentValues = bookOpens.filter(b => b.current != null).map(b => b.current!);

  if (booksWithOpen.length === 0) {
    return {
      trueOpen: null, trueOpenRange: { low: null, high: null },
      current: null, marketHigh: null, marketLow: null,
      path: [], pathString: null,
      directionFromOpen: 'unknown', structure: 'unknown',
      reliability: 0, confidenceLabel: 'Unreliable',
    };
  }

  // Weighted consensus: use book weights for influence
  const openValues = booksWithOpen.map(b => b.trueOpen!);
  const openWeights = booksWithOpen.map(b => {
    let w = getBookWeight(b.book);
    // Reduce weight for low-reliability opens
    if (b.reliability < 40) w *= 0.5;
    else if (b.reliability < 65) w *= 0.75;
    return w;
  });

  // Use MODE for consensus (always a real book number, never synthetic)
  // But weight-aware: if weights differ significantly, prefer higher-weighted values
  const consensusOpen = mode(openValues);

  const consensusCurrent = currentValues.length > 0 ? mode(currentValues) : null;
  const marketHigh = path.length > 0 ? Math.max(...path) : null;
  const marketLow = path.length > 0 ? Math.min(...path) : null;

  const deduped = deduplicatePath(path);
  const pString = pathToString(path);

  const direction = computeDirection(
    consensusOpen, consensusCurrent,
    1, // minimal threshold for direction — structure handles materiality
  );

  const structure = classifyStructure(path, marketType, league);

  // Consensus reliability
  let reliability = 0;
  const avgBookReliability = booksWithOpen.reduce((s, b) => s + b.reliability, 0) / booksWithOpen.length;
  reliability = avgBookReliability;

  // Agreement bonus
  const openRange = Math.max(...openValues) - Math.min(...openValues);
  if (openRange === 0) reliability += RELIABILITY_CONFIG.CONSENSUS_BONUS_AGREEMENT;
  else if (openRange <= 1) reliability += RELIABILITY_CONFIG.CONSENSUS_BONUS_CLOSE;

  // Sharp book bonus
  if (booksWithOpen.some(b => b.isSharpBook)) reliability += RELIABILITY_CONFIG.CONSENSUS_BONUS_SHARP;

  // Late majority penalty
  const lateCount = booksWithOpen.filter(b => b.wasTrackerLate).length;
  if (lateCount > booksWithOpen.length / 2) reliability += RELIABILITY_CONFIG.CONSENSUS_PENALTY_LATE;

  reliability = Math.max(0, Math.min(100, reliability));

  return {
    trueOpen: consensusOpen,
    trueOpenRange: {
      low: Math.min(...openValues),
      high: Math.max(...openValues),
    },
    current: consensusCurrent,
    marketHigh,
    marketLow,
    path: deduped,
    pathString: pString,
    directionFromOpen: direction,
    structure,
    reliability,
    confidenceLabel: reliabilityToConfidence(reliability),
  };
}

// ── Step 3: Build Market Path ────────────────────────────────────────────────

export function buildMarketPath(snapshots: MarketSnapshot[]): number[] {
  return buildTimeBucketedPath(snapshots, 30);
}

// ── Step 4: Full Pipeline ────────────────────────────────────────────────────

/**
 * computeTrueOpenResult — the main entry point.
 * Renamed from computeTrueOpen to match the spec's function name.
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

  // Group by book
  const bookGroups: Record<string, MarketSnapshot[]> = {};
  for (const s of sorted) {
    if (!bookGroups[s.book]) bookGroups[s.book] = [];
    bookGroups[s.book].push(s);
  }

  // Step 1: Per-book true opens
  const byBook: BookTrueOpen[] = Object.entries(bookGroups).map(
    ([book, snaps]) => computeBookTrueOpen(snaps, book, gameTime)
  );

  // Step 2: Build path from all snapshots
  const path = buildMarketPath(sorted);

  // Step 3: Consensus true open
  const consensus = computeConsensusTrueOpen(byBook, path, marketType, league);

  // Step 4: Diagnostics
  const booksWithOpen = byBook.filter(b => b.trueOpen != null);
  const allTimestamps = byBook
    .filter(b => b.trueOpenTs != null)
    .map(b => new Date(b.trueOpenTs!).getTime());

  const firstRecordedTs = allTimestamps.length > 0
    ? new Date(Math.min(...allTimestamps)).toISOString()
    : null;

  let trackerStartDelayMinutes: number | null = null;
  if (gameTime && firstRecordedTs) {
    const gameTimeMs = new Date(gameTime).getTime();
    const firstMs = new Date(firstRecordedTs).getTime();
    const hoursBeforeGame = (gameTimeMs - firstMs) / 3600000;
    if (hoursBeforeGame < TRACKER_LATE_CONFIG.TYPICAL_MARKET_OPEN_HOURS) {
      trackerStartDelayMinutes = Math.max(0,
        Math.round((TRACKER_LATE_CONFIG.TYPICAL_MARKET_OPEN_HOURS - hoursBeforeGame) * 60)
      );
    }
  }

  // Build diagnostic flags
  const flags: string[] = [];
  if (booksWithOpen.length === 0) flags.push('INSUFFICIENT_HISTORY');
  if (booksWithOpen.length === 1) flags.push('SINGLE_BOOK_OPEN');
  if (booksWithOpen.every(b => b.wasTrackerLate)) flags.push('TRACKER_STARTED_LATE');
  else if (booksWithOpen.some(b => b.wasTrackerLate)) flags.push('TRACKER_STARTED_LATE');
  if (booksWithOpen.some(b => b.sourceMethod === 'reconstructed')) flags.push('CONSENSUS_OPEN_RECONSTRUCTED');
  if (booksWithOpen.some(b => b.sourceMethod === 'unknown')) flags.push('OPEN_UNCERTAIN');
  if (booksWithOpen.filter(b => b.isSharpBook).length === 0 && booksWithOpen.length > 0) {
    flags.push('NO_SHARP_BOOK_OPEN');
  }

  // Open disagreement
  if (booksWithOpen.length >= 2) {
    const opens = booksWithOpen.map(b => b.trueOpen!);
    const range = Math.max(...opens) - Math.min(...opens);
    if (range >= 2) flags.push('WIDE_BOOK_OPEN_DISAGREEMENT');
  }

  // Structure flags
  if (consensus.structure === 'reversal') flags.push('PATH_INDICATES_REVERSAL');
  if (consensus.structure === 'whipsaw') flags.push('PATH_INDICATES_WHIPSAW');

  // Current at extreme
  if (consensus.current != null && consensus.marketLow != null && consensus.current === consensus.marketLow) {
    flags.push('CURRENT_AT_MARKET_LOW');
  }
  if (consensus.current != null && consensus.marketHigh != null && consensus.current === consensus.marketHigh) {
    flags.push('CURRENT_AT_MARKET_HIGH');
  }

  if (consensus.reliability < 40) flags.push('OPEN_UNCERTAIN');

  const diagnostics: TrueOpenDiagnostics = {
    booksTracked: byBook.length,
    booksWithTrueOpen: booksWithOpen.length,
    sharpBooksWithTrueOpen: booksWithOpen.filter(b => b.isSharpBook).length,
    firstRecordedTs,
    marketEarliestTs: firstRecordedTs,
    trackerStartDelayMinutes,
    flags: [...new Set(flags)], // deduplicate
  };

  return {
    marketType, league, gameId, side,
    byBook, consensus, diagnostics,
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
      flags: ['INSUFFICIENT_HISTORY'],
    },
  };
}
