// ══════════════════════════════════════════════════════════════════════════════
//  Market Lifecycle Engine
//
//  Full-path analysis from opening → current for every market (spread, total,
//  moneyline, 1H variants). Replaces the recent-window model so that
//  stabilized markets are never downgraded to PASS.
//
//  Three-layer model:
//    1. Structural Context  — opening → current full path
//    2. Primary Signal      — the most important move/event in full history
//    3. Current State       — what the market is doing NOW relative to that signal
//
//  Used by:
//    - /api/generate-hsa  (narrative generation)
//    - /api/hsa-slate     (dashboard cards)
//    - overnight report   (morning summaries)
//    - share studio       (pregame snapshot export)
//
//  Does NOT modify ingestion (odds_snapshots, detect-rlm). Sits on top.
// ══════════════════════════════════════════════════════════════════════════════

// ── Lifecycle States ────────────────────────────────────────────────────────

export type LifecycleState =
  | 'QUIET'
  | 'INITIATION'
  | 'STEAM'
  | 'FOLLOW_THROUGH'
  | 'STABILIZATION'
  | 'SHADE_RESISTANCE'
  | 'REVERSAL'
  | 'CHAOTIC';

export type MarketType = 'spread' | 'moneyline' | 'total' | '1h_spread' | '1h_moneyline' | '1h_total';
export type ConfidenceLevel = 'PASS' | 'LOW' | 'MODERATE' | 'HIGH';

// ── League + Market Configuration ───────────────────────────────────────────
// TUNE: All thresholds configurable per league and per market.

export interface MarketThresholds {
  /** Minimum move (in native units) to count as meaningful */
  meaningful_move: number;
  /** Move size to qualify as steam */
  steam_move: number;
  /** Max minutes for a steam window */
  steam_window_minutes: number;
  /** Min books that must move together for coordination */
  coordination_min_books: number;
  /** Move velocity (units/hour) to flag as fast */
  fast_velocity: number;
  /** Band width: move within this of a level = "holding" */
  holding_band: number;
  /** Retracement % of primary move to flag reversal */
  reversal_retracement_pct: number;
  /** Min snapshots for data sufficiency */
  min_snapshots: number;
  /** Min books for data sufficiency */
  min_books: number;
}

// TUNE: Default thresholds — override per league below
const DEFAULT_THRESHOLDS: MarketThresholds = {
  meaningful_move: 1.0,
  steam_move: 1.5,
  steam_window_minutes: 30,
  coordination_min_books: 3,
  fast_velocity: 0.5,
  holding_band: 0.5,
  reversal_retracement_pct: 50,
  min_snapshots: 5,
  min_books: 2,
};

// TUNE: Per-league, per-market threshold overrides
export const LEAGUE_MARKET_THRESHOLDS: Record<string, Partial<Record<MarketType, Partial<MarketThresholds>>>> = {
  NBA: {
    spread: { meaningful_move: 1.0, steam_move: 1.5, holding_band: 0.5 },
    total: { meaningful_move: 1.5, steam_move: 2.0, holding_band: 1.0, fast_velocity: 0.75 },
    moneyline: { meaningful_move: 15, steam_move: 25, holding_band: 10, fast_velocity: 5 },
  },
  NCAAB: {
    spread: { meaningful_move: 1.0, steam_move: 1.5, holding_band: 0.5 },
    total: { meaningful_move: 1.5, steam_move: 2.0, holding_band: 1.0, fast_velocity: 0.75 },
    moneyline: { meaningful_move: 20, steam_move: 30, holding_band: 15, fast_velocity: 8 },
  },
  NHL: {
    spread: { meaningful_move: 0.5, steam_move: 0.5, holding_band: 0.25 },
    total: { meaningful_move: 0.5, steam_move: 0.5, holding_band: 0.25, fast_velocity: 0.2 },
    moneyline: { meaningful_move: 10, steam_move: 20, holding_band: 8, fast_velocity: 4 },
  },
  MLB: {
    spread: { meaningful_move: 0.5, steam_move: 0.5, holding_band: 0.25 },
    total: { meaningful_move: 0.5, steam_move: 1.0, holding_band: 0.5, fast_velocity: 0.25 },
    moneyline: { meaningful_move: 10, steam_move: 20, holding_band: 8, fast_velocity: 4 },
  },
};

/** Resolve threshold for a specific league + market, falling back to defaults */
export function getThresholds(league: string, marketType: MarketType): MarketThresholds {
  const leagueOverrides = LEAGUE_MARKET_THRESHOLDS[league];
  // Normalize 1h variants to base market for threshold lookup
  const baseMarket = marketType.replace('1h_', '') as MarketType;
  const marketOverrides = leagueOverrides?.[marketType] || leagueOverrides?.[baseMarket] || {};
  return { ...DEFAULT_THRESHOLDS, ...marketOverrides };
}

// ── Snapshot Types ──────────────────────────────────────────────────────────

export interface MarketSnapshot {
  book: string;
  line: number;          // spread value, total value, or ML odds
  price: number | null;  // juice / vig
  timestamp: string;     // ISO
}

// ── Canonical Output Object ─────────────────────────────────────────────────

export interface PrimarySignal {
  state: LifecycleState;
  direction: string;         // 'toward_home' | 'toward_away' | 'over' | 'under' | 'none'
  start_line: number;
  end_line: number;
  distance: number;
  books_involved: number;
  velocity_per_hour: number;
  start_time: string;
  end_time: string;
  confidence: ConfidenceLevel;
}

export interface CurrentState {
  state: LifecycleState;
  line_now: number;
  move_since_primary: number;
  books_aligned_now: number;
  retracement_amount: number;
  holding_near_level: boolean;
}

export interface StructuralContext {
  total_move_from_open: number;
  largest_absolute_move: number;
  percent_retraced: number;
  time_at_current_band_minutes: number;
}

export interface DataQuality {
  books_seen_total: number;
  snapshot_density_score: number;   // 0–1, snapshots per expected interval
  insufficient_data: boolean;
}

export interface FinalRead {
  signal_status: 'PASS' | 'WATCH' | 'ACTIVE';
  market_lean: string;              // e.g. "Nebraska -13.5", "Under 157.5", "PASS"
  confidence: ConfidenceLevel;
  summary_mode: string;             // human-readable summary sentence
}

export interface MarketAnalysis {
  market_type: MarketType;
  opening_line: number;
  current_line: number;
  primary_signal: PrimarySignal;
  current_state: CurrentState;
  structural_context: StructuralContext;
  data_quality: DataQuality;
  final_read: FinalRead;

  // ── Additional computed fields (required by spec) ───────────────────
  opening_timestamp: string;
  first_consensus_line: number;
  first_consensus_timestamp: string;
  latest_snapshot_timestamp: string;
  consensus_current_line: number;
  books_reporting_now: number;

  // Full-path movement
  max_favorable_move_from_open: number;
  max_adverse_move_from_open: number;
  largest_absolute_move_from_open: number;
  largest_move_start_time: string;
  largest_move_end_time: string;
  largest_move_duration_minutes: number;
  largest_move_books_involved: number;
  largest_move_velocity: number;
  largest_move_direction: string;

  // Recent windows
  move_last_30m: number;
  move_last_2h: number;
  move_last_8h: number;
  move_since_midnight: number;
  move_since_last_hsa: number;        // requires lastHsaTimestamp param
  books_coordinated_last_30m: number;
  books_coordinated_last_2h: number;
  books_coordinated_last_8h: number;

  // Stability
  time_at_current_band_minutes: number;
  has_held_post_move: boolean;
  has_retraced: boolean;
  retracement_amount: number;
  percent_of_primary_move_retraced: number;
  books_still_aligned: number;
  books_diverging_now: number;

  // Data quality extended
  data_coverage_score: number;
  books_seen_total: number;
  books_seen_in_primary_move: number;
  snapshot_density_score: number;
  insufficient_data: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Core Analysis Pipeline
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze a single market (spread, total, or ML) using the full lifecycle model.
 *
 * @param snapshots  All snapshots for this game+market, chronologically sorted
 * @param marketType Which market this is
 * @param league     League code for threshold lookup
 * @param homeTeam   Home team name (for lean labels)
 * @param awayTeam   Away team name (for lean labels)
 */
export function analyzeMarket(
  snapshots: MarketSnapshot[],
  marketType: MarketType,
  league: string,
  homeTeam: string,
  awayTeam: string,
  lastHsaTimestamp?: string,
): MarketAnalysis {
  const T = getThresholds(league, marketType);

  // ── Sort chronologically ────────────────────────────────────────────────
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // ── Opening & Current ───────────────────────────────────────────────────
  const openingByBook: Record<string, MarketSnapshot> = {};
  const currentByBook: Record<string, MarketSnapshot> = {};
  for (const s of sorted) {
    if (!openingByBook[s.book]) openingByBook[s.book] = s;
    currentByBook[s.book] = s;
  }

  const allBooks = new Set(sorted.map(s => s.book));
  const openingLines = Object.values(openingByBook).map(s => s.line);
  const currentLines = Object.values(currentByBook).map(s => s.line);

  const openingLine = mode(openingLines) ?? 0;
  const currentLine = mode(currentLines) ?? 0;
  const openingTimestamp = sorted[0]?.timestamp || '';
  const latestTimestamp = sorted[sorted.length - 1]?.timestamp || '';

  // First consensus = median of first batch (snapshots within first 30 min)
  const firstBatchEnd = new Date(new Date(openingTimestamp).getTime() + 30 * 60000);
  const firstBatch = sorted.filter(s => new Date(s.timestamp) <= firstBatchEnd);
  const firstConsensusLine = mode(firstBatch.map(s => s.line)) ?? openingLine;
  const firstConsensusTimestamp = firstBatch.length
    ? firstBatch[Math.floor(firstBatch.length / 2)].timestamp
    : openingTimestamp;

  const consensusCurrentLine = mode(currentLines) ?? 0;
  const booksReportingNow = Object.keys(currentByBook).length;

  // ── Data quality ────────────────────────────────────────────────────────
  const trackingMs = new Date(latestTimestamp).getTime() - new Date(openingTimestamp).getTime();
  const trackingHours = trackingMs / 3600000;
  // Expected: ~1 snapshot per book per 10 min
  const expectedSnapshots = Math.max(1, allBooks.size * Math.ceil(trackingHours * 6));
  const snapshotDensity = Math.min(1, sorted.length / expectedSnapshots);
  const insufficientData = sorted.length < T.min_snapshots || allBooks.size < T.min_books;

  // ── Build consensus timeline (30-min buckets) ───────────────────────────
  const timeline = buildConsensusTimeline(sorted);

  // ── Full-path movement metrics ──────────────────────────────────────────
  const totalMoveFromOpen = round2(consensusCurrentLine - openingLine);

  // Track max/min consensus values and when they occurred
  let maxConsensus = openingLine;
  let minConsensus = openingLine;
  let maxConsensusTime = openingTimestamp;
  let minConsensusTime = openingTimestamp;

  for (const tp of timeline) {
    if (tp.consensus > maxConsensus) {
      maxConsensus = tp.consensus;
      maxConsensusTime = tp.timestamp;
    }
    if (tp.consensus < minConsensus) {
      minConsensus = tp.consensus;
      minConsensusTime = tp.timestamp;
    }
  }

  // Determine favorable/adverse relative to the direction of the primary move
  const moveDirection = totalMoveFromOpen >= 0 ? 1 : -1;
  const maxFavorableMove = round2(moveDirection >= 0
    ? maxConsensus - openingLine
    : openingLine - minConsensus);
  const maxAdverseMove = round2(moveDirection >= 0
    ? openingLine - minConsensus
    : maxConsensus - openingLine);

  const largestAbsoluteMove = Math.max(
    Math.abs(maxConsensus - openingLine),
    Math.abs(minConsensus - openingLine),
  );

  // Find the time range of the largest move
  const largestMoveResult = findLargestMove(timeline, openingLine);

  // ── Recent window movements ─────────────────────────────────────────────
  const nowMs = new Date(latestTimestamp).getTime();
  const move30m = computeRecentMove(timeline, nowMs, 30);
  const move2h = computeRecentMove(timeline, nowMs, 120);
  const move8h = computeRecentMove(timeline, nowMs, 480);

  // Move since midnight UTC
  const midnightToday = new Date(latestTimestamp);
  midnightToday.setUTCHours(0, 0, 0, 0);
  const moveSinceMidnight = computeRecentMove(timeline, nowMs, (nowMs - midnightToday.getTime()) / 60000);

  // Move since last HSA generation
  const moveSinceLastHsa = lastHsaTimestamp
    ? computeRecentMove(timeline, nowMs, (nowMs - new Date(lastHsaTimestamp).getTime()) / 60000)
    : 0;

  // Books coordinated in recent windows
  const booksCoord30m = countBooksCoordinated(sorted, nowMs, 30);
  const booksCoord2h = countBooksCoordinated(sorted, nowMs, 120);
  const booksCoord8h = countBooksCoordinated(sorted, nowMs, 480);

  // ── Primary signal detection ────────────────────────────────────────────
  const primarySignal = detectPrimarySignal(
    sorted, timeline, openingLine, T, league, marketType, homeTeam, awayTeam,
  );

  // ── Current state evaluation ────────────────────────────────────────────
  const currentState = evaluateCurrentState(
    consensusCurrentLine, primarySignal, timeline, T, sorted,
  );

  // ── Stability metrics ───────────────────────────────────────────────────
  const timeAtBand = computeTimeAtCurrentBand(timeline, consensusCurrentLine, T.holding_band);
  const hasHeld = currentState.state === 'STABILIZATION' || currentState.holding_near_level;
  const retracementAmount = currentState.retracement_amount;
  const pctRetraced = primarySignal.distance !== 0
    ? round2(Math.abs(retracementAmount) / Math.abs(primarySignal.distance) * 100) : 0;

  // Books alignment
  const primaryDir = primarySignal.direction;
  const booksAligned = countBooksAligned(currentByBook, openingByBook, primaryDir);
  const booksDiverging = booksReportingNow - booksAligned;

  // ── Structural context ──────────────────────────────────────────────────
  const structuralContext: StructuralContext = {
    total_move_from_open: totalMoveFromOpen,
    largest_absolute_move: round2(largestAbsoluteMove),
    percent_retraced: pctRetraced,
    time_at_current_band_minutes: timeAtBand,
  };

  // ── Data quality object ─────────────────────────────────────────────────
  const dataQuality: DataQuality = {
    books_seen_total: allBooks.size,
    snapshot_density_score: round2(snapshotDensity),
    insufficient_data: insufficientData,
  };

  // ── Confidence scoring ──────────────────────────────────────────────────
  const confidence = computeConfidence(
    totalMoveFromOpen, primarySignal, currentState, structuralContext,
    dataQuality, T, move30m, move2h,
  );

  // ── Final read ──────────────────────────────────────────────────────────
  const finalRead = buildFinalRead(
    marketType, league, homeTeam, awayTeam,
    openingLine, consensusCurrentLine, totalMoveFromOpen,
    primarySignal, currentState, confidence, insufficientData, T,
  );

  return {
    market_type: marketType,
    opening_line: openingLine,
    current_line: consensusCurrentLine,
    primary_signal: primarySignal,
    current_state: currentState,
    structural_context: structuralContext,
    data_quality: dataQuality,
    final_read: finalRead,

    opening_timestamp: openingTimestamp,
    first_consensus_line: round2(firstConsensusLine),
    first_consensus_timestamp: firstConsensusTimestamp,
    latest_snapshot_timestamp: latestTimestamp,
    consensus_current_line: round2(consensusCurrentLine),
    books_reporting_now: booksReportingNow,

    max_favorable_move_from_open: maxFavorableMove,
    max_adverse_move_from_open: maxAdverseMove,
    largest_absolute_move_from_open: round2(largestAbsoluteMove),
    largest_move_start_time: largestMoveResult.startTime,
    largest_move_end_time: largestMoveResult.endTime,
    largest_move_duration_minutes: largestMoveResult.durationMinutes,
    largest_move_books_involved: largestMoveResult.booksInvolved,
    largest_move_velocity: largestMoveResult.velocity,
    largest_move_direction: largestMoveResult.direction,

    move_last_30m: move30m,
    move_last_2h: move2h,
    move_last_8h: move8h,
    move_since_midnight: moveSinceMidnight,
    move_since_last_hsa: moveSinceLastHsa,
    books_coordinated_last_30m: booksCoord30m,
    books_coordinated_last_2h: booksCoord2h,
    books_coordinated_last_8h: booksCoord8h,

    time_at_current_band_minutes: timeAtBand,
    has_held_post_move: hasHeld,
    has_retraced: Math.abs(retracementAmount) > T.holding_band,
    retracement_amount: retracementAmount,
    percent_of_primary_move_retraced: pctRetraced,
    books_still_aligned: booksAligned,
    books_diverging_now: booksDiverging,

    data_coverage_score: round2(snapshotDensity),
    books_seen_total: allBooks.size,
    books_seen_in_primary_move: primarySignal.books_involved,
    snapshot_density_score: round2(snapshotDensity),
    insufficient_data: insufficientData,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  Primary Signal Detection
// ══════════════════════════════════════════════════════════════════════════════

interface TimelinePoint {
  consensus: number;
  timestamp: string;
  bookCount: number;
  books: string[];
}

function detectPrimarySignal(
  sorted: MarketSnapshot[],
  timeline: TimelinePoint[],
  openingLine: number,
  T: MarketThresholds,
  league: string,
  marketType: MarketType,
  homeTeam: string,
  awayTeam: string,
): PrimarySignal {
  if (timeline.length < 2) {
    return emptyPrimarySignal();
  }

  // Find the largest sustained move in the timeline
  // Walk through timeline, track the move that covers the most distance
  let bestMoveStart = 0;
  let bestMoveEnd = 0;
  let bestDistance = 0;

  for (let i = 0; i < timeline.length; i++) {
    for (let j = i + 1; j < timeline.length; j++) {
      const dist = Math.abs(timeline[j].consensus - timeline[i].consensus);
      if (dist > bestDistance) {
        bestDistance = dist;
        bestMoveStart = i;
        bestMoveEnd = j;
      }
    }
  }

  const startLine = timeline[bestMoveStart].consensus;
  const endLine = timeline[bestMoveEnd].consensus;
  const distance = round2(endLine - startLine);
  const startTime = timeline[bestMoveStart].timestamp;
  const endTime = timeline[bestMoveEnd].timestamp;
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const durationHours = durationMs / 3600000;
  const velocity = durationHours > 0 ? round2(Math.abs(distance) / durationHours) : 0;

  // Count books involved in the move window
  const moveWindowSnaps = sorted.filter(s => {
    const t = new Date(s.timestamp).getTime();
    return t >= new Date(startTime).getTime() && t <= new Date(endTime).getTime();
  });
  const booksInMove = new Set(moveWindowSnaps.map(s => s.book));

  // Determine direction
  const direction = classifyDirection(distance, marketType);

  // Classify the primary signal state
  const absDistance = Math.abs(distance);
  let state: LifecycleState = 'QUIET';

  if (absDistance < T.meaningful_move) {
    // Check for shade/resistance: books disagree but line barely moves
    const bookDisagreement = computeBookDisagreement(sorted);
    if (bookDisagreement > T.holding_band * 2 && absDistance < T.meaningful_move) {
      state = 'SHADE_RESISTANCE';
    } else {
      state = 'QUIET';
    }
  } else if (absDistance >= T.steam_move && durationHours <= T.steam_window_minutes / 60) {
    state = 'STEAM';
  } else if (absDistance >= T.meaningful_move && velocity >= T.fast_velocity) {
    state = 'STEAM';
  } else if (absDistance >= T.meaningful_move) {
    // Check if the move continued after initial formation
    const midIdx = Math.floor((bestMoveStart + bestMoveEnd) / 2);
    const firstHalfDist = Math.abs(timeline[midIdx].consensus - startLine);
    const secondHalfDist = Math.abs(endLine - timeline[midIdx].consensus);
    if (secondHalfDist > firstHalfDist * 0.3) {
      state = 'FOLLOW_THROUGH';
    } else {
      state = 'INITIATION';
    }
  }

  // Confidence for the primary signal itself
  let confidence: ConfidenceLevel = 'PASS';
  if (state !== 'QUIET') {
    if (absDistance >= T.steam_move && booksInMove.size >= T.coordination_min_books) {
      confidence = 'HIGH';
    } else if (absDistance >= T.meaningful_move && booksInMove.size >= 2) {
      confidence = 'MODERATE';
    } else {
      confidence = 'LOW';
    }
  }

  return {
    state,
    direction,
    start_line: round2(startLine),
    end_line: round2(endLine),
    distance: round2(distance),
    books_involved: booksInMove.size,
    velocity_per_hour: velocity,
    start_time: startTime,
    end_time: endTime,
    confidence,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  Current State Evaluation
// ══════════════════════════════════════════════════════════════════════════════

function evaluateCurrentState(
  currentLine: number,
  primary: PrimarySignal,
  timeline: TimelinePoint[],
  T: MarketThresholds,
  sorted: MarketSnapshot[],
): CurrentState {
  const moveSincePrimary = round2(currentLine - primary.end_line);
  const retracementAmount = round2(currentLine - primary.end_line);

  // Count books currently aligned with primary signal direction
  const latestByBook: Record<string, MarketSnapshot> = {};
  for (const s of sorted) latestByBook[s.book] = s;
  const currentLines = Object.values(latestByBook).map(s => s.line);
  const booksAligned = currentLines.filter(line => {
    if (primary.distance > 0) return line >= primary.end_line - T.holding_band;
    if (primary.distance < 0) return line <= primary.end_line + T.holding_band;
    return true;
  }).length;

  const holdingNear = Math.abs(moveSincePrimary) <= T.holding_band;

  // Determine current lifecycle state
  let state: LifecycleState;

  if (primary.state === 'QUIET') {
    state = 'QUIET';
  } else if (holdingNear) {
    // Market holding near the primary signal end point = STABILIZATION
    state = 'STABILIZATION';
  } else {
    // Which direction did the market move since the primary signal?
    const primaryDirection = Math.sign(primary.distance);
    const recentDirection = Math.sign(moveSincePrimary);

    if (recentDirection === primaryDirection) {
      // Continued in same direction
      state = 'FOLLOW_THROUGH';
    } else if (Math.abs(moveSincePrimary) > Math.abs(primary.distance) * (T.reversal_retracement_pct / 100)) {
      // Retraced significantly
      state = 'REVERSAL';
    } else {
      // Minor retracement but not enough for reversal, still stabilizing
      state = 'STABILIZATION';
    }
  }

  // Check for CHAOTIC: high disagreement among current books
  const bookDisagreement = currentLines.length > 1
    ? Math.max(...currentLines) - Math.min(...currentLines)
    : 0;
  if (bookDisagreement > T.holding_band * 4 && primary.state !== 'QUIET') {
    state = 'CHAOTIC';
  }

  return {
    state,
    line_now: round2(currentLine),
    move_since_primary: round2(moveSincePrimary),
    books_aligned_now: booksAligned,
    retracement_amount: round2(retracementAmount),
    holding_near_level: holdingNear,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  Confidence Scoring (weighted, full-history)
// ══════════════════════════════════════════════════════════════════════════════

function computeConfidence(
  totalMoveFromOpen: number,
  primary: PrimarySignal,
  current: CurrentState,
  structural: StructuralContext,
  quality: DataQuality,
  T: MarketThresholds,
  move30m: number,
  move2h: number,
): ConfidenceLevel {
  if (primary.state === 'QUIET' && Math.abs(totalMoveFromOpen) < T.meaningful_move) {
    return 'PASS';
  }

  // HARD RULE: If a meaningful primary signal exists, NEVER return PASS
  // due to recent inactivity. Recent quiet = STABILIZATION, not PASS.
  let score = 0;

  // ── Move size from opening (0–25 pts) ─────────────────────────────────
  // TUNE: weight for move magnitude
  const absMove = Math.abs(totalMoveFromOpen);
  if (absMove >= T.steam_move * 1.5) score += 25;
  else if (absMove >= T.steam_move) score += 20;
  else if (absMove >= T.meaningful_move) score += 12;

  // ── Coordination strength (0–25 pts) ──────────────────────────────────
  // TUNE: weight for book agreement
  if (primary.books_involved >= T.coordination_min_books + 2) score += 25;
  else if (primary.books_involved >= T.coordination_min_books) score += 18;
  else if (primary.books_involved >= 2) score += 10;

  // ── Velocity (0–15 pts) ───────────────────────────────────────────────
  // TUNE: weight for speed of move
  if (primary.velocity_per_hour >= T.fast_velocity * 2) score += 15;
  else if (primary.velocity_per_hour >= T.fast_velocity) score += 10;
  else if (primary.velocity_per_hour > 0) score += 5;

  // ── Persistence after move (0–15 pts) ─────────────────────────────────
  // TUNE: reward holding, penalize reversal
  if (current.state === 'STABILIZATION' && current.holding_near_level) score += 15;
  else if (current.state === 'FOLLOW_THROUGH') score += 12;
  else if (current.state === 'REVERSAL') score -= 10;
  else if (current.state === 'CHAOTIC') score -= 5;

  // ── Retracement penalty (0 to -10 pts) ────────────────────────────────
  // TUNE: penalty for retracement
  if (structural.percent_retraced > 75) score -= 10;
  else if (structural.percent_retraced > 50) score -= 5;

  // ── Current consensus alignment (0–10 pts) ────────────────────────────
  // TUNE: weight for current book alignment
  const alignPct = current.books_aligned_now / Math.max(1, quality.books_seen_total);
  if (alignPct >= 0.8) score += 10;
  else if (alignPct >= 0.6) score += 6;

  // ── Data quality (0–10 pts) ───────────────────────────────────────────
  // TUNE: weight for data coverage
  if (quality.snapshot_density_score >= 0.7) score += 10;
  else if (quality.snapshot_density_score >= 0.4) score += 5;
  if (quality.insufficient_data) score -= 15;

  // ── Recent activity adjusts urgency but does NOT erase signal ─────────
  // TUNE: recent movement adds urgency points
  if (Math.abs(move30m) >= T.meaningful_move) score += 5;
  if (Math.abs(move2h) >= T.meaningful_move) score += 3;

  // Clamp and classify
  score = Math.max(0, Math.min(100, score));

  // TUNE: confidence thresholds
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MODERATE';
  if (score >= 10) return 'LOW';
  return 'PASS';
}

// ══════════════════════════════════════════════════════════════════════════════
//  Final Read Builder
// ══════════════════════════════════════════════════════════════════════════════

function buildFinalRead(
  marketType: MarketType,
  league: string,
  homeTeam: string,
  awayTeam: string,
  openingLine: number,
  currentLine: number,
  totalMove: number,
  primary: PrimarySignal,
  current: CurrentState,
  confidence: ConfidenceLevel,
  insufficientData: boolean,
  T: MarketThresholds,
): FinalRead {
  // HARD RULE: PASS only if full history shows no meaningful movement
  if (insufficientData) {
    return {
      signal_status: 'PASS',
      market_lean: 'PASS',
      confidence: 'PASS',
      summary_mode: 'Insufficient data for analysis.',
    };
  }

  if (primary.state === 'QUIET' && Math.abs(totalMove) < T.meaningful_move) {
    return {
      signal_status: 'PASS',
      market_lean: 'PASS',
      confidence: 'PASS',
      summary_mode: 'No meaningful movement from opening. Market appears efficiently priced.',
    };
  }

  // Build lean label
  const leanLabel = buildLeanLabel(marketType, currentLine, primary.direction, homeTeam, awayTeam);

  // Signal status
  let signalStatus: 'PASS' | 'WATCH' | 'ACTIVE';
  if (confidence === 'HIGH') signalStatus = 'ACTIVE';
  else if (confidence === 'MODERATE') signalStatus = 'ACTIVE';
  else if (confidence === 'LOW') signalStatus = 'WATCH';
  else signalStatus = 'PASS';

  // Summary mode
  const summary = buildSummaryMode(primary, current, totalMove, marketType, T, homeTeam, awayTeam);

  return {
    signal_status: signalStatus,
    market_lean: leanLabel,
    confidence,
    summary_mode: summary,
  };
}

function buildLeanLabel(
  marketType: MarketType,
  currentLine: number,
  direction: string,
  homeTeam: string,
  awayTeam: string,
): string {
  if (marketType === 'total' || marketType === '1h_total') {
    if (direction === 'over') return `Over ${currentLine}`;
    if (direction === 'under') return `Under ${currentLine}`;
    return 'PASS';
  }

  if (marketType === 'moneyline' || marketType === '1h_moneyline') {
    if (direction === 'toward_home') return `${homeTeam} ML`;
    if (direction === 'toward_away') return `${awayTeam} ML`;
    return 'PASS';
  }

  // Spread — currentLine is from HOME perspective (negative = home favored)
  // toward_home: home team getting more favored, show home team + their line
  // toward_away: away team getting more favored, show away team + flipped line
  if (direction === 'toward_home') {
    return `${homeTeam} ${currentLine > 0 ? '+' : ''}${currentLine}`;
  }
  if (direction === 'toward_away') {
    const awayLine = -currentLine;
    return `${awayTeam} ${awayLine > 0 ? '+' : ''}${awayLine}`;
  }
  return 'PASS';
}

function buildSummaryMode(
  primary: PrimarySignal,
  current: CurrentState,
  totalMove: number,
  marketType: MarketType,
  T: MarketThresholds,
  homeTeam: string,
  awayTeam: string,
): string {
  const absMove = Math.abs(totalMove);
  const moveDesc = absMove >= T.steam_move ? 'strong' : 'meaningful';
  // Convert internal direction codes to team-relative readable text
  const dirDesc = directionToLabel(primary.direction, marketType, homeTeam, awayTeam);

  const stateDesc: Record<LifecycleState, string> = {
    QUIET: 'No significant activity.',
    INITIATION: `Early ${moveDesc} ${dirDesc} move forming.`,
    STEAM: `Fast coordinated ${dirDesc} steam across ${primary.books_involved} books.`,
    FOLLOW_THROUGH: `${moveDesc} ${dirDesc} move with continued follow-through.`,
    STABILIZATION: `${moveDesc} ${dirDesc} signal with market now stabilized at new level.`,
    SHADE_RESISTANCE: 'Books resisting movement or holding unevenly.',
    REVERSAL: `Prior ${dirDesc} move partially reversed — watch for continuation.`,
    CHAOTIC: 'Conflicting signals across books — weak consensus.',
  };

  const primaryDesc = stateDesc[primary.state] || '';
  const currentDesc = current.state !== primary.state
    ? ` Currently: ${stateDesc[current.state] || current.state}.`
    : '';

  return `${primaryDesc}${currentDesc}`.trim();
}

/** Convert internal direction codes to readable team-relative labels. */
function directionToLabel(
  direction: string,
  marketType: MarketType,
  homeTeam: string,
  awayTeam: string,
): string {
  if (marketType === 'total' || marketType === '1h_total') {
    if (direction === 'over') return 'over';
    if (direction === 'under') return 'under';
    return '';
  }
  if (direction === 'toward_home') return `toward ${homeTeam}`;
  if (direction === 'toward_away') return `toward ${awayTeam}`;
  return '';
}

// ══════════════════════════════════════════════════════════════════════════════
//  Helper Functions
// ══════════════════════════════════════════════════════════════════════════════

function buildConsensusTimeline(sorted: MarketSnapshot[]): TimelinePoint[] {
  if (!sorted.length) return [];

  // Group into 30-min buckets
  const buckets = new Map<number, MarketSnapshot[]>();
  for (const s of sorted) {
    const bucket = Math.floor(new Date(s.timestamp).getTime() / (30 * 60000));
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(s);
  }

  const timeline: TimelinePoint[] = [];
  for (const [, snaps] of buckets) {
    // Latest per book in this bucket
    const byBook: Record<string, MarketSnapshot> = {};
    for (const s of snaps) byBook[s.book] = s;
    const lines = Object.values(byBook).map(s => s.line);
    const books = Object.keys(byBook);
    const midSnap = snaps[Math.floor(snaps.length / 2)];

    timeline.push({
      consensus: mode(lines) ?? 0,
      timestamp: midSnap.timestamp,
      bookCount: books.length,
      books,
    });
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return timeline;
}

function findLargestMove(
  timeline: TimelinePoint[],
  openingLine: number,
): { startTime: string; endTime: string; durationMinutes: number; booksInvolved: number; velocity: number; direction: string } {
  if (timeline.length < 2) {
    return { startTime: '', endTime: '', durationMinutes: 0, booksInvolved: 0, velocity: 0, direction: 'none' };
  }

  let bestStart = 0;
  let bestEnd = 0;
  let bestDist = 0;

  for (let i = 0; i < timeline.length; i++) {
    for (let j = i + 1; j < timeline.length; j++) {
      const dist = Math.abs(timeline[j].consensus - timeline[i].consensus);
      if (dist > bestDist) {
        bestDist = dist;
        bestStart = i;
        bestEnd = j;
      }
    }
  }

  const startTime = timeline[bestStart].timestamp;
  const endTime = timeline[bestEnd].timestamp;
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const durationMinutes = Math.round(durationMs / 60000);
  const durationHours = durationMs / 3600000;
  const velocity = durationHours > 0 ? round2(bestDist / durationHours) : 0;

  // Books involved across the move window
  const allBooksInWindow = new Set<string>();
  for (let i = bestStart; i <= bestEnd; i++) {
    for (const b of timeline[i].books) allBooksInWindow.add(b);
  }

  const moveVal = timeline[bestEnd].consensus - timeline[bestStart].consensus;
  const direction = moveVal > 0 ? 'up' : moveVal < 0 ? 'down' : 'none';

  return {
    startTime,
    endTime,
    durationMinutes,
    booksInvolved: allBooksInWindow.size,
    velocity,
    direction,
  };
}

function computeRecentMove(
  timeline: TimelinePoint[],
  nowMs: number,
  windowMinutes: number,
): number {
  const cutoff = nowMs - windowMinutes * 60000;
  const inWindow = timeline.filter(tp => new Date(tp.timestamp).getTime() >= cutoff);
  if (inWindow.length < 2) return 0;
  return round2(inWindow[inWindow.length - 1].consensus - inWindow[0].consensus);
}

function computeTimeAtCurrentBand(
  timeline: TimelinePoint[],
  currentLine: number,
  bandWidth: number,
): number {
  // Walk backwards from end of timeline, count how long we've been within band
  let minutes = 0;
  for (let i = timeline.length - 1; i >= 1; i--) {
    if (Math.abs(timeline[i].consensus - currentLine) <= bandWidth) {
      const gap = new Date(timeline[i].timestamp).getTime() - new Date(timeline[i - 1].timestamp).getTime();
      minutes += gap / 60000;
    } else {
      break;
    }
  }
  return Math.round(minutes);
}

function computeBookDisagreement(sorted: MarketSnapshot[]): number {
  // Get latest snapshot per book
  const byBook: Record<string, MarketSnapshot> = {};
  for (const s of sorted) byBook[s.book] = s;
  const lines = Object.values(byBook).map(s => s.line);
  if (lines.length < 2) return 0;
  return Math.max(...lines) - Math.min(...lines);
}

function countBooksAligned(
  currentByBook: Record<string, MarketSnapshot>,
  openingByBook: Record<string, MarketSnapshot>,
  direction: string,
): number {
  let aligned = 0;
  for (const [book, current] of Object.entries(currentByBook)) {
    const opening = openingByBook[book];
    if (!opening) continue;
    const move = current.line - opening.line;
    if (direction === 'toward_home' || direction === 'under') {
      if (move < 0) aligned++;
    } else if (direction === 'toward_away' || direction === 'over') {
      if (move > 0) aligned++;
    }
  }
  return aligned;
}

/**
 * Count books that moved in the same direction within a recent time window.
 * "Coordinated" = majority of books moved the same way.
 */
function countBooksCoordinated(
  sorted: MarketSnapshot[],
  nowMs: number,
  windowMinutes: number,
): number {
  const cutoff = nowMs - windowMinutes * 60000;
  const inWindow = sorted.filter(s => new Date(s.timestamp).getTime() >= cutoff);
  if (inWindow.length < 2) return 0;

  // Get first and last per book in window
  const firstByBook: Record<string, MarketSnapshot> = {};
  const lastByBook: Record<string, MarketSnapshot> = {};
  for (const s of inWindow) {
    if (!firstByBook[s.book]) firstByBook[s.book] = s;
    lastByBook[s.book] = s;
  }

  let movedUp = 0;
  let movedDown = 0;
  for (const [book, last] of Object.entries(lastByBook)) {
    const first = firstByBook[book];
    if (!first) continue;
    const move = last.line - first.line;
    if (move > 0) movedUp++;
    else if (move < 0) movedDown++;
  }

  return Math.max(movedUp, movedDown);
}

function classifyDirection(distance: number, marketType: MarketType): string {
  if (Math.abs(distance) < 0.001) return 'none';

  if (marketType === 'total' || marketType === '1h_total') {
    return distance > 0 ? 'over' : 'under';
  }
  // For spread: negative = toward home (more negative = bigger home fav)
  // For ML: negative = toward away (lower home ML = home more favored... but American odds are tricky)
  // Keep it simple: negative move = toward_home for spread
  return distance < 0 ? 'toward_home' : 'toward_away';
}

function emptyPrimarySignal(): PrimarySignal {
  return {
    state: 'QUIET',
    direction: 'none',
    start_line: 0,
    end_line: 0,
    distance: 0,
    books_involved: 0,
    velocity_per_hour: 0,
    start_time: '',
    end_time: '',
    confidence: 'PASS',
  };
}

/**
 * Compute consensus via MODE (most common value) — always a real book line.
 * Replaces median() to prevent synthetic values from averaging two middle values.
 * On ties, returns the value closest to the median position.
 */
function mode(nums: number[]): number | null {
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];

  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);

  let maxFreq = 0;
  for (const count of freq.values()) {
    if (count > maxFreq) maxFreq = count;
  }

  const candidates = [...freq.entries()]
    .filter(([, count]) => count === maxFreq)
    .map(([val]) => val);

  if (candidates.length === 1) return candidates[0];

  // On tie, pick closest to median position
  const sorted = [...nums].sort((a, b) => a - b);
  const medianVal = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianVal) - Math.abs(b - medianVal));
  return candidates[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Convenience: Analyze all markets for a game from raw odds_snapshots rows
// ══════════════════════════════════════════════════════════════════════════════

export interface RawOddsRow {
  bookmaker: string;
  spread: number | null;
  spread_home_price?: number | null;
  total: number | null;
  total_over_price: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  fetched_at: string;
}

/**
 * Convert raw odds_snapshots rows into per-market MarketSnapshot arrays,
 * then run lifecycle analysis on each.
 */
export function analyzeGameMarkets(
  rows: RawOddsRow[],
  league: string,
  homeTeam: string,
  awayTeam: string,
): {
  spread: MarketAnalysis | null;
  total: MarketAnalysis | null;
  moneyline: MarketAnalysis | null;
} {
  const spreadSnaps: MarketSnapshot[] = [];
  const totalSnaps: MarketSnapshot[] = [];
  const mlSnaps: MarketSnapshot[] = [];

  for (const r of rows) {
    if (r.spread != null && r.spread !== 0) {
      spreadSnaps.push({
        book: r.bookmaker,
        line: r.spread,
        price: r.spread_home_price ?? null,
        timestamp: r.fetched_at,
      });
    }
    if (r.total != null && r.total > 0) {
      totalSnaps.push({
        book: r.bookmaker,
        line: r.total,
        price: r.total_over_price ?? null,
        timestamp: r.fetched_at,
      });
    }
    if (r.moneyline_home != null && r.moneyline_home !== 0) {
      mlSnaps.push({
        book: r.bookmaker,
        line: r.moneyline_home,
        price: null,
        timestamp: r.fetched_at,
      });
    }
  }

  return {
    spread: spreadSnaps.length >= 2
      ? analyzeMarket(spreadSnaps, 'spread', league, homeTeam, awayTeam)
      : null,
    total: totalSnaps.length >= 2
      ? analyzeMarket(totalSnaps, 'total', league, homeTeam, awayTeam)
      : null,
    moneyline: mlSnaps.length >= 2
      ? analyzeMarket(mlSnaps, 'moneyline', league, homeTeam, awayTeam)
      : null,
  };
}
