// ══════════════════════════════════════════════════════════════════════════════
//  Market Consensus Helpers — REAL BOOK LINES ONLY
//
//  Core principle: If a bettor cannot place a bet at a number, it must NEVER
//  appear in output. No averages. No smoothing. No interpolation.
//  Only real sportsbook lines.
//
//  Used by: odds-summarizer, generate-hsa, slate, hsa-slate, lifecycle engine
// ══════════════════════════════════════════════════════════════════════════════

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConsensusResult {
  /** Mode (most common value) — always a real book line */
  consensus: number;
  /** Minimum real line observed */
  min: number;
  /** Maximum real line observed */
  max: number;
  /** Number of books at the consensus (mode) value */
  aligned_books: number;
  /** Total books reporting */
  total_books: number;
  /** Books NOT at consensus value */
  outlier_books: OutlierBook[];
  /** Whether all books agree */
  all_aligned: boolean;
  /** Whether majority agrees (>50%) */
  majority_aligned: boolean;
  /** Display string for output */
  display: string;
}

export interface OutlierBook {
  book: string;
  line: number;
}

export interface MarketRange {
  min: number;
  max: number;
  spread: number;
  display: string;
}

// ── Validation ─────────────────────────────────────────────────────────────

/** Valid spread/total increments: whole numbers or .5 */
export function isValidSpreadTotal(n: number): boolean {
  const remainder = Math.abs(n) % 1;
  return remainder === 0 || remainder === 0.5;
}

/** Valid moneyline: must be an integer */
export function isValidMoneyline(n: number): boolean {
  return Number.isInteger(n);
}

/**
 * Validate a betting line. If invalid, log error and return nearest real value.
 * For spreads/totals: snap to nearest .5
 * For moneylines: round to nearest integer
 */
export function validateLine(
  value: number,
  market: 'spread' | 'total' | 'moneyline',
  context?: string,
): number {
  if (market === 'moneyline') {
    if (!isValidMoneyline(value)) {
      console.error(`[MARKET GUARDRAIL] Invalid ML ${value}${context ? ` (${context})` : ''} — snapping to ${Math.round(value)}`);
      return Math.round(value);
    }
    return value;
  }

  // spread or total
  if (!isValidSpreadTotal(value)) {
    const snapped = Math.round(value * 2) / 2;
    console.error(`[MARKET GUARDRAIL] Invalid ${market} ${value}${context ? ` (${context})` : ''} — this is a synthetic number. Snapping to nearest real line: ${snapped}`);
    return snapped;
  }
  return value;
}

// ── Core Consensus Functions ───────────────────────────────────────────────

/**
 * Compute consensus (MODE) from an array of real book lines.
 * Returns the most frequently occurring value — always a real book line.
 * On ties, returns the value closest to the median.
 */
export function getConsensus(lines: number[]): number | null {
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0];

  // Count frequency of each value
  const freq = new Map<number, number>();
  for (const l of lines) {
    freq.set(l, (freq.get(l) || 0) + 1);
  }

  // Find max frequency
  let maxFreq = 0;
  for (const count of freq.values()) {
    if (count > maxFreq) maxFreq = count;
  }

  // Get all values with max frequency (handle ties)
  const candidates = [...freq.entries()]
    .filter(([, count]) => count === maxFreq)
    .map(([val]) => val);

  if (candidates.length === 1) return candidates[0];

  // On tie: return the value closest to the median of all lines
  const sorted = [...lines].sort((a, b) => a - b);
  const medianValue = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianValue) - Math.abs(b - medianValue));
  return candidates[0];
}

/**
 * Get market range from real book lines.
 */
export function getMarketRange(lines: number[]): MarketRange | null {
  if (lines.length === 0) return null;
  const min = Math.min(...lines);
  const max = Math.max(...lines);
  const spread = max - min;
  const display = min === max ? `${min}` : `${min}–${max}`;
  return { min, max, spread, display };
}

/**
 * Get outlier books — those not matching consensus.
 */
export function getOutliers(
  bookLines: Array<{ book: string; line: number }>,
  consensus: number,
): OutlierBook[] {
  return bookLines
    .filter(bl => bl.line !== consensus)
    .map(bl => ({ book: bl.book, line: bl.line }));
}

/**
 * Full consensus analysis for a set of book lines.
 */
export function analyzeConsensus(
  bookLines: Array<{ book: string; line: number }>,
): ConsensusResult | null {
  if (bookLines.length === 0) return null;

  const lines = bookLines.map(bl => bl.line);
  const consensus = getConsensus(lines);
  if (consensus === null) return null;

  const range = getMarketRange(lines)!;
  const outliers = getOutliers(bookLines, consensus);
  const aligned = bookLines.length - outliers.length;
  const allAligned = outliers.length === 0;
  const majorityAligned = aligned > bookLines.length / 2;

  return {
    consensus,
    min: range.min,
    max: range.max,
    aligned_books: aligned,
    total_books: bookLines.length,
    outlier_books: outliers,
    all_aligned: allAligned,
    majority_aligned: majorityAligned,
    display: formatMarketDisplay(consensus, aligned, bookLines.length, outliers),
  };
}

// ── Display Formatting ─────────────────────────────────────────────────────

/**
 * Format market display following strict rules:
 * - All aligned → single number: "150.5"
 * - Majority aligned → consensus + note: "150.5 (4/5 books; Pinnacle 151)"
 * - Split market → real range: "150.5–151"
 */
export function formatMarketDisplay(
  consensus: number,
  alignedBooks: number,
  totalBooks: number,
  outliers: OutlierBook[],
): string {
  if (outliers.length === 0) {
    return `${consensus}`;
  }

  if (alignedBooks > totalBooks / 2) {
    const outlierStr = outliers.map(o => `${o.book} ${o.line}`).join('; ');
    return `${consensus} (${alignedBooks}/${totalBooks} books; ${outlierStr})`;
  }

  // Split market — show range
  const allLines = [consensus, ...outliers.map(o => o.line)];
  const min = Math.min(...allLines);
  const max = Math.max(...allLines);
  return `${min}–${max}`;
}

/**
 * Format moneyline display:
 * - All same → single price: "-145"
 * - Different → range: "-145 to -155"
 */
export function formatMoneylineDisplay(
  bookLines: Array<{ book: string; line: number }>,
): string {
  if (bookLines.length === 0) return '—';

  const lines = bookLines.map(bl => bl.line);
  const unique = [...new Set(lines)].sort((a, b) => a - b);

  if (unique.length === 1) {
    return `${unique[0]}`;
  }

  // Check if clustered (within 10 points)
  const range = Math.max(...lines) - Math.min(...lines);
  const consensus = getConsensus(lines);

  if (range <= 10 && consensus !== null) {
    const outliers = getOutliers(bookLines, consensus);
    if (outliers.length === 0) return `${consensus}`;
    const outlierStr = outliers.map(o => `${o.book} ${o.line}`).join('; ');
    return `${consensus} (${bookLines.length - outliers.length}/${bookLines.length}; ${outlierStr})`;
  }

  return `${Math.min(...lines)} to ${Math.max(...lines)}`;
}

// ── Movement Helpers ───────────────────────────────────────────────────────

/**
 * Compute movement between two consensus values.
 * Both values must be real book lines. Returns the difference.
 */
export function computeMovement(
  openingConsensus: number | null,
  currentConsensus: number | null,
): number | null {
  if (openingConsensus === null || currentConsensus === null) return null;
  return currentConsensus - openingConsensus;
}

/**
 * Format movement as a real line-to-line description.
 * NEVER outputs synthetic intermediate values.
 */
export function formatMovement(
  openingLine: number,
  currentLine: number,
  bookName?: string,
): string {
  if (openingLine === currentLine) {
    return bookName
      ? `${bookName} held at ${currentLine}`
      : `held at ${currentLine}`;
  }
  return bookName
    ? `${bookName} moved ${openingLine} → ${currentLine}`
    : `${openingLine} → ${currentLine}`;
}
