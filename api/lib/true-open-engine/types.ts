// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Universal Types
//
//  Sport-agnostic. Works for any market type, any league, any book set.
//  No sport-specific assumptions in these types — downstream interpreters
//  may apply sport-specific rules to the universal output.
// ══════════════════════════════════════════════════════════════════════════════

export type SourceMethod =
  | 'direct_earliest'       // We have the actual first-posted line
  | 'reconstructed'         // Inferred from earliest available + context
  | 'fallback_first_seen'   // Our tracker started late; this is our first snapshot
  | 'unknown';

export type MarketDirection = 'up' | 'down' | 'flat' | 'mixed' | 'unknown';

export type MarketStructure =
  | 'one_way'       // Moved in one direction from open to current
  | 'reversal'      // Moved one way, then reversed (e.g., up then down)
  | 'whipsaw'       // Multiple direction changes
  | 'range_bound'   // Oscillated within a narrow band
  | 'unknown';

export type ConfidenceLabel = 'High' | 'Moderate' | 'Low' | 'Unreliable';

// ── Per-Book True Open ───────────────────────────────────────────────────────

export interface BookTrueOpen {
  book: string;
  trueOpen: number | null;
  trueOpenTs: string | null;
  current: number | null;
  currentTs: string | null;
  sourceMethod: SourceMethod;
  reliability: number;          // 0-100
  isSharpBook: boolean;
  wasTrackerLate: boolean;
  /** Number of snapshots we have for this book */
  snapshotCount: number;
  notes: string[];
}

// ── Consensus True Open ──────────────────────────────────────────────────────

export interface ConsensusTrueOpen {
  trueOpen: number | null;
  trueOpenRange: {
    low: number | null;
    high: number | null;
  };
  current: number | null;
  marketHigh: number | null;
  marketLow: number | null;
  /** Ordered sequence of consensus values over time */
  path: number[];
  pathString: string | null;
  directionFromOpen: MarketDirection;
  structure: MarketStructure;
  reliability: number;          // 0-100
  confidenceLabel: ConfidenceLabel;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface TrueOpenDiagnostics {
  booksTracked: number;
  booksWithTrueOpen: number;
  sharpBooksWithTrueOpen: number;
  firstRecordedTs: string | null;
  /** Estimated time the market actually opened (may precede our tracking) */
  marketEarliestTs: string | null;
  /** How many minutes after market open did our tracker start? */
  trackerStartDelayMinutes: number | null;
  flags: string[];
}

// ── Full Result ──────────────────────────────────────────────────────────────

export interface TrueOpenResult {
  marketType: string;           // 'spread' | 'total' | 'moneyline' | any future type
  league: string;
  gameId: string;
  side: string | null;          // 'home' | 'away' | 'over' | 'under' | null

  byBook: BookTrueOpen[];
  consensus: ConsensusTrueOpen;
  diagnostics: TrueOpenDiagnostics;
}

// ── Input: Raw Snapshot ──────────────────────────────────────────────────────

export interface MarketSnapshot {
  book: string;
  value: number;              // The line/price/total number
  price: number | null;       // Juice (e.g., -110)
  timestamp: string;          // ISO timestamp
}
