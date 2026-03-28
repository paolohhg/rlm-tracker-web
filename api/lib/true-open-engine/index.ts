// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Public API
//
//  Universal, sport-agnostic open detection. Works for any market type,
//  any league, any book set.
//
//  Usage:
//    import { computeTrueOpen, computeAllMarketOpens } from './true-open-engine';
//
//    const spreadOpen = computeTrueOpen(spreadSnaps, 'spread', 'NBA', gameId, gameTime);
//    const allOpens = computeAllMarketOpens(rawSnapshots, 'NBA', gameId, gameTime);
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

export { computeTrueOpen } from './engine';

import { computeTrueOpen } from './engine';
import type { TrueOpenResult, MarketSnapshot } from './types';

/**
 * Raw odds snapshot from the database (matches odds_snapshots / latest_odds schema).
 */
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
 *
 * Returns an object with spread, total, and moneyline TrueOpenResults.
 * Works for any league without sport-specific assumptions.
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

  // Extract market-specific snapshots
  const spreadSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.spread != null && s.spread !== 0)
    .map(s => ({ book: book(s), value: s.spread, price: s.spread_home_price ?? null, timestamp: ts(s) }));

  const totalSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.total != null && s.total !== 0)
    .map(s => ({ book: book(s), value: s.total, price: s.total_over_price ?? null, timestamp: ts(s) }));

  const mlHomeSnaps: MarketSnapshot[] = rawSnapshots
    .filter(s => s.moneyline_home != null && s.moneyline_home !== 0)
    .map(s => ({ book: book(s), value: s.moneyline_home, price: null, timestamp: ts(s) }));

  return {
    spread: computeTrueOpen(spreadSnaps, 'spread', league, gameId, gameTime, 'home'),
    total: computeTrueOpen(totalSnaps, 'total', league, gameId, gameTime, 'over'),
    moneyline: computeTrueOpen(mlHomeSnaps, 'moneyline', league, gameId, gameTime, 'home'),
  };
}

/**
 * Format a TrueOpenResult into a structured text block for the HSA prompt.
 * This replaces any ad-hoc "opening line" logic in the HSA pipeline.
 */
export function formatTrueOpenForHSA(result: TrueOpenResult): string {
  const c = result.consensus;
  const d = result.diagnostics;

  if (c.trueOpen == null) {
    return `${result.marketType.toUpperCase()} TRUE OPEN: No data available (${d.flags.join(', ')})`;
  }

  const lines: string[] = [
    `${result.marketType.toUpperCase()} TRUE OPEN:`,
    `  Open: ${c.trueOpen} → Current: ${c.current ?? '?'}`,
    `  Market High: ${c.marketHigh} | Market Low: ${c.marketLow}`,
    `  Direction: ${c.directionFromOpen} | Structure: ${c.structure}`,
  ];

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
      const deltaStr = delta != null ? ` (${delta >= 0 ? '+' : ''}${delta})` : '';
      lines.push(`    ${b.book}: ${b.trueOpen} → ${b.current ?? '?'}${deltaStr} [${b.sourceMethod}]`);
    }
  }

  return lines.join('\n');
}
