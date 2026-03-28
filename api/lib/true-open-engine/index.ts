// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Public API
//
//  Universal, sport-agnostic true open detection.
//
//  Usage:
//    import { computeTrueOpen, computeAllMarketOpens } from './true-open-engine';
//    const result = computeTrueOpen(snapshots, 'total', 'NBA', gameId, gameTime);
// ══════════════════════════════════════════════════════════════════════════════

export type {
  TrueOpenResult,
  BookTrueOpen,
  ConsensusTrueOpen,
  TrueOpenDiagnostics,
  MarketSnapshot,
  SourceMethod,
  MarketDirection,
  MarketStructure,
  ConfidenceLabel,
} from './types';

export {
  computeTrueOpen,
  computeBookTrueOpen,
  computeConsensusTrueOpen,
  buildMarketPath,
  scoreOpenReliability,
} from './engine';

export {
  getBookWeight,
  isSharpBook,
  getMaterialMoveThreshold,
  BOOK_WEIGHTS,
  SHARP_BOOKS,
  MATERIAL_MOVE_THRESHOLDS,
} from './config';

export {
  mode,
  weightedAverage,
  deduplicatePath,
  pathToString,
  computeDirection,
  classifyStructure,
  reliabilityToConfidence,
  buildTimeBucketedPath,
} from './utils';

import { computeTrueOpen } from './engine';
import type { TrueOpenResult, MarketSnapshot } from './types';

// ── Raw DB Snapshot ──────────────────────────────────────────────────────────

interface RawDbSnapshot {
  bookmaker?: string;
  sportsbook?: string;
  spread: number;
  spread_home_price?: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price?: number;
  fetched_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Compute True Open for ALL markets of a single game from raw DB snapshots.
 */
export function computeAllMarketOpens(
  rawSnapshots: RawDbSnapshot[],
  league: string,
  gameId: string,
  gameTime: string | null,
): {
  spread: TrueOpenResult;
  total: TrueOpenResult;
  moneyline: TrueOpenResult;
} {
  const book = (s: RawDbSnapshot) => s.bookmaker ?? s.sportsbook ?? 'unknown';
  const ts = (s: RawDbSnapshot) => s.fetched_at ?? s.updated_at ?? new Date().toISOString();

  const spreadSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.spread != null && s.spread !== 0)
    .map(s => ({ book: book(s), value: s.spread, price: s.spread_home_price ?? null, timestamp: ts(s) }));

  const totalSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.total != null && s.total !== 0)
    .map(s => ({ book: book(s), value: s.total, price: s.total_over_price ?? null, timestamp: ts(s) }));

  const mlSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.moneyline_home != null && s.moneyline_home !== 0)
    .map(s => ({ book: book(s), value: s.moneyline_home, price: null, timestamp: ts(s) }));

  return {
    spread: computeTrueOpen(spreadSnaps, 'spread', league, gameId, gameTime, 'home'),
    total: computeTrueOpen(totalSnaps, 'total', league, gameId, gameTime, 'over'),
    moneyline: computeTrueOpen(mlSnaps, 'moneyline', league, gameId, gameTime, 'home'),
  };
}

/**
 * Format a TrueOpenResult into structured text for the HSA prompt.
 */
export function formatTrueOpenForHSA(result: TrueOpenResult): string {
  const c = result.consensus;
  const d = result.diagnostics;

  if (c.trueOpen == null) {
    return `${result.marketType.toUpperCase()} TRUE OPEN: No data available (${d.flags.join(', ')})`;
  }

  const lines: string[] = [
    `${result.marketType.toUpperCase()} TRUE OPEN:`,
  ];

  // Reliability-aware language
  if (c.confidenceLabel === 'High' || c.confidenceLabel === 'Moderate') {
    lines.push(`  True Open: ${c.trueOpen}`);
  } else if (c.confidenceLabel === 'Low') {
    lines.push(`  Estimated Open: ${c.trueOpen} (${c.confidenceLabel} reliability)`);
  } else {
    lines.push(`  Open data is unreliable. Observed range: ${c.trueOpenRange.low} to ${c.trueOpenRange.high}`);
  }

  lines.push(`  Current: ${c.current ?? '?'}`);
  lines.push(`  Market High: ${c.marketHigh} | Market Low: ${c.marketLow}`);
  lines.push(`  Direction: ${c.directionFromOpen} | Structure: ${c.structure}`);

  if (c.pathString) {
    lines.push(`  Path: ${c.pathString}`);
  }

  lines.push(`  Confidence: ${c.confidenceLabel} (${c.reliability}%)`);
  lines.push(`  Books: ${d.booksWithTrueOpen}/${d.booksTracked} with open (${d.sharpBooksWithTrueOpen} sharp)`);

  if (d.flags.length > 0) {
    lines.push(`  Flags: ${d.flags.join(', ')}`);
  }

  // Per-book detail
  const booksWithData = result.byBook.filter(b => b.trueOpen != null);
  if (booksWithData.length > 0) {
    lines.push('  Per-book:');
    for (const b of booksWithData) {
      const delta = b.current != null && b.trueOpen != null ? b.current - b.trueOpen : null;
      const deltaStr = delta != null ? ` (${delta >= 0 ? '+' : ''}${Math.round(delta * 10) / 10})` : '';
      lines.push(`    ${b.book}: ${b.trueOpen} → ${b.current ?? '?'}${deltaStr} [${b.sourceMethod}, ${b.reliability}%]`);
    }
  }

  return lines.join('\n');
}
