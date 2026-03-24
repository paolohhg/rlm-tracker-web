// ══════════════════════════════════════════════════════════════════════════════
//  NHL Signal Classifier
//
//  NHL-specific market interpretation rules for HSA generation.
//  Handles puck-line state flips, coordination thresholds, moneyline priority,
//  totals classification, and confidence scoring unique to hockey markets.
//
//  NHL puck lines are state-based around 1.5 — a flip from -1.5 to +1.5
//  is NOT a "3-point spread move" but a STATE_FLIP between favorite and
//  underdog pricing. This module prevents that misclassification.
// ══════════════════════════════════════════════════════════════════════════════

// ── NHL Signal Types ─────────────────────────────────────────────────────────

export type NhlSideSignalType =
  | 'CONFIRMED_RLM'
  | 'PARTIAL_SHARP_ENTRY'
  | 'SPLIT_MARKET'
  | 'FAKE_STEAM'
  | 'FROZEN';

export type NhlTotalsSignalType =
  | 'COORDINATED_TOTAL_MOVE'
  | 'PARTIAL_TOTAL_MOVE'
  | 'TOTAL_NOISE'
  | 'TOTAL_FROZEN';

export type NhlConfidence = 'HIGH' | 'MODERATE' | 'LOW';

export type NhlCoordinationTier = 'ISOLATED' | 'PARTIAL' | 'MEANINGFUL' | 'STRONG';

export type NhlTimeBucket = 'STEAM_WINDOW' | 'FAST_COORDINATED' | 'GRADUAL_MIGRATION' | 'SLOW_DRIFT';

export interface NhlSideClassification {
  signal_type: NhlSideSignalType;
  secondary_tag?: NhlSideSignalType;
  confidence: NhlConfidence;
  status: 'CONFIRMED' | 'NEEDS_CONFIRMATION';
  lean: string;
  puckline_state_flip: boolean;
  market_event_type?: 'PUCKLINE_STATE_FLIP';
  coordination_tier: NhlCoordinationTier;
  explanation: string;
  // Scoring breakdown for transparency
  score_breakdown?: {
    moneyline: number;
    public_divergence: number;
    coordination: number;
    puckline: number;
    velocity: number;
    total_correlation: number;
    raw_total: number;
    adjustments: string[];
  };
}

export interface NhlTotalsClassification {
  signal_type: NhlTotalsSignalType;
  confidence: NhlConfidence;
  explanation: string;
  books_moved: number;
  total_books: number;
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface NhlClassifierInput {
  league: string;
  homeTeam: string;
  awayTeam: string;
  // Spread/puck-line data
  openingSpread: number;
  currentSpread: number;
  spreadBooksMovedCount: number;
  spreadBooksHeldCount: number;
  spreadBooksMoved: string[];   // book names that moved
  spreadBooksHeld: string[];    // book names that held
  spreadMoveTimeWindowMinutes: number;
  // Moneyline data
  openingMlHome: number;
  currentMlHome: number;
  mlBooksMovedCount: number;
  mlDirection: 'toward_home' | 'toward_away' | 'none';
  // Public data
  publicTicketPctHome: number;  // 0-100
  publicMoneyPctHome: number;   // 0-100
  // Totals data
  openingTotal: number;
  currentTotal: number;
  totalBooksMovedCount: number;
  totalBooksHeldCount: number;
  totalBooksMoved: string[];
  totalBooksHeld: string[];
  // Lifecycle / persistence data
  movePersistedSnapshots: number; // how many snapshots the move has held
  hasSnappedBack: boolean;
  // Fake steam from existing detector
  fakeSteamTriggered: boolean;
  fakeSteamScore: number;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Helper Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Detect if a puck-line move is a state flip (favorite ↔ underdog)
 * rather than a numeric spread move.
 *
 * NHL puck lines are anchored at 1.5 — moving from -1.5 to +1.5 is a
 * state change, not a 3-point spread travel.
 */
export function isPucklineStateFlip(oldLine: number, newLine: number): boolean {
  return (oldLine === -1.5 && newLine === 1.5) ||
         (oldLine === 1.5 && newLine === -1.5);
}

/**
 * Classify the coordination tier based on how many books moved.
 *
 * NHL coordination thresholds:
 *   1 book  = ISOLATED
 *   2 books = PARTIAL (probe)
 *   3 books = MEANINGFUL
 *   4+ books = STRONG
 */
export function getNhlCoordinationTier(booksMovedCount: number): NhlCoordinationTier {
  if (booksMovedCount <= 1) return 'ISOLATED';
  if (booksMovedCount === 2) return 'PARTIAL';
  if (booksMovedCount === 3) return 'MEANINGFUL';
  return 'STRONG';
}

/**
 * Classify move timing into NHL time buckets.
 */
export function getNhlTimeBucket(minutes: number): NhlTimeBucket {
  if (minutes <= 20) return 'STEAM_WINDOW';
  if (minutes <= 45) return 'FAST_COORDINATED';
  if (minutes <= 120) return 'GRADUAL_MIGRATION';
  return 'SLOW_DRIFT';
}

/**
 * Check if the moneyline confirms the spread/puck-line direction.
 *
 * For NHL, if the spread moved toward the away team (home spread went from
 * -1.5 to +1.5, i.e. home is now underdog), the ML should also be moving
 * toward the away team (home ML getting more positive / less negative).
 */
function mlConfirmsSpreadDirection(
  openingMlHome: number,
  currentMlHome: number,
  spreadDirection: 'toward_home' | 'toward_away' | 'none',
): boolean {
  if (spreadDirection === 'none') return false;
  const mlMove = currentMlHome - openingMlHome;
  // ML moving positive = away team becoming more favored
  // ML moving negative = home team becoming more favored
  if (spreadDirection === 'toward_away' && mlMove > 5) return true;
  if (spreadDirection === 'toward_home' && mlMove < -5) return true;
  return false;
}

/**
 * Detect if RLM (reverse line movement) exists:
 * public favors one side, line moves the other way.
 */
function detectRlm(
  publicTicketPctHome: number,
  spreadDirection: 'toward_home' | 'toward_away' | 'none',
): boolean {
  if (spreadDirection === 'none') return false;
  const publicSide = publicTicketPctHome >= 50 ? 'home' : 'away';
  // RLM = line moves OPPOSITE to where public money is
  if (publicSide === 'home' && spreadDirection === 'toward_away') return true;
  if (publicSide === 'away' && spreadDirection === 'toward_home') return true;
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
//  NHL Side Signal Classification
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Classify an NHL side market signal using the NHL-specific ladder.
 *
 * Priority order: CONFIRMED_RLM > PARTIAL_SHARP_ENTRY > SPLIT_MARKET > FAKE_STEAM > FROZEN
 *
 * NHL weighting for side scoring:
 *   moneyline:           40
 *   public vs price:     20
 *   coordination:        20
 *   puck line:           10
 *   timing/velocity:      5
 *   total correlation:    5
 */
export function getNhlSignalType(input: NhlClassifierInput): NhlSideClassification {
  const isStateFlip = isPucklineStateFlip(input.openingSpread, input.currentSpread);
  const coordTier = getNhlCoordinationTier(input.spreadBooksMovedCount);
  const timeBucket = getNhlTimeBucket(input.spreadMoveTimeWindowMinutes);

  // Determine spread direction
  const spreadDelta = input.currentSpread - input.openingSpread;
  const spreadDirection: 'toward_home' | 'toward_away' | 'none' =
    spreadDelta < -0.1 ? 'toward_home' :
    spreadDelta > 0.1 ? 'toward_away' : 'none';

  const hasRlm = detectRlm(input.publicTicketPctHome, spreadDirection);
  const mlConfirms = mlConfirmsSpreadDirection(
    input.openingMlHome, input.currentMlHome, spreadDirection,
  );

  // Build lean label
  const leanTeam = spreadDirection === 'toward_home' ? input.homeTeam :
                   spreadDirection === 'toward_away' ? input.awayTeam : 'PASS';
  const leanLine = spreadDirection !== 'none'
    ? `${leanTeam} ${input.currentSpread > 0 ? '+' : ''}${input.currentSpread}`
    : 'PASS';

  // ── NHL Weighted Score ─────────────────────────────────────────────────
  const adjustments: string[] = [];

  // Moneyline (max 40)
  let mlScore = 0;
  if (mlConfirms && input.mlBooksMovedCount >= 3) mlScore = 40;
  else if (mlConfirms && input.mlBooksMovedCount >= 2) mlScore = 30;
  else if (mlConfirms) mlScore = 20;
  else if (input.mlDirection !== 'none') mlScore = 10;

  // Public vs price divergence (max 20)
  let publicScore = 0;
  if (hasRlm) {
    const publicMajority = Math.max(input.publicTicketPctHome, 100 - input.publicTicketPctHome);
    const moneyDivergence = Math.abs(input.publicTicketPctHome - input.publicMoneyPctHome);
    if (publicMajority >= 65 && moneyDivergence >= 10) publicScore = 20;
    else if (publicMajority >= 55 && moneyDivergence >= 5) publicScore = 15;
    else if (publicMajority >= 52) publicScore = 10;
  }

  // Coordination (max 20)
  let coordScore = 0;
  if (coordTier === 'STRONG') coordScore = 20;
  else if (coordTier === 'MEANINGFUL') coordScore = 15;
  else if (coordTier === 'PARTIAL') coordScore = 8;
  else coordScore = 2;

  // Puck line (max 10)
  let puckScore = 0;
  if (isStateFlip && mlConfirms) puckScore = 10;
  else if (isStateFlip && !mlConfirms) puckScore = 3; // state flip without ML = weak
  else if (Math.abs(spreadDelta) >= 0.5) puckScore = 6;

  // Velocity/timing (max 5)
  let velocityScore = 0;
  if (timeBucket === 'STEAM_WINDOW') velocityScore = 5;
  else if (timeBucket === 'FAST_COORDINATED') velocityScore = 4;
  else if (timeBucket === 'GRADUAL_MIGRATION') velocityScore = 2;

  // Total correlation (max 5)
  let totalCorrelationScore = 0;
  if (input.totalBooksMovedCount >= 3) totalCorrelationScore = 5;
  else if (input.totalBooksMovedCount >= 2) totalCorrelationScore = 3;

  let rawTotal = mlScore + publicScore + coordScore + puckScore + velocityScore + totalCorrelationScore;

  // ── Auto-downgrade conditions ──────────────────────────────────────────
  if (input.spreadBooksMovedCount <= 2 && input.spreadBooksHeldCount >= 3) {
    rawTotal -= 10;
    adjustments.push('Downgrade: only 2 books moved, 3+ held');
  }
  if (input.fakeSteamTriggered) {
    rawTotal -= 10;
    adjustments.push('Downgrade: fake steam detector triggered');
  }
  if (isStateFlip && !mlConfirms) {
    rawTotal -= 8;
    adjustments.push('Downgrade: puck-line state flip without ML confirmation');
  }
  if (input.hasSnappedBack) {
    rawTotal -= 10;
    adjustments.push('Downgrade: move reversed (snapback)');
  }
  if (input.spreadBooksMovedCount > 0 && input.spreadBooksHeldCount > 0 &&
      input.spreadBooksMovedCount <= input.spreadBooksHeldCount &&
      input.movePersistedSnapshots < 3) {
    rawTotal -= 5;
    adjustments.push('Downgrade: split market without persistence');
  }

  // ── Auto-upgrade conditions ────────────────────────────────────────────
  if (input.spreadBooksMovedCount >= 3 && mlConfirms) {
    rawTotal += 5;
    adjustments.push('Upgrade: 3+ books + ML confirms');
  }
  if (input.movePersistedSnapshots >= 3 && input.spreadBooksMovedCount >= 2) {
    rawTotal += 5;
    adjustments.push('Upgrade: move persisted 3+ snapshots');
  }

  rawTotal = Math.max(0, Math.min(100, rawTotal));

  const scoreBreakdown = {
    moneyline: mlScore,
    public_divergence: publicScore,
    coordination: coordScore,
    puckline: puckScore,
    velocity: velocityScore,
    total_correlation: totalCorrelationScore,
    raw_total: rawTotal,
    adjustments,
  };

  // ── Classification Ladder ──────────────────────────────────────────────

  // FROZEN: no meaningful movement
  if (spreadDirection === 'none' && input.mlDirection === 'none') {
    return {
      signal_type: 'FROZEN',
      confidence: 'LOW',
      status: 'CONFIRMED',
      lean: 'PASS',
      puckline_state_flip: false,
      coordination_tier: coordTier,
      explanation: 'Market stable with no meaningful puck-line or moneyline movement. No actionable signal detected.',
      score_breakdown: scoreBreakdown,
    };
  }

  // FAKE_STEAM: isolated move, no confirmation, or fake steam triggered
  if (input.fakeSteamTriggered && coordTier === 'ISOLATED') {
    return {
      signal_type: 'FAKE_STEAM',
      confidence: 'LOW',
      status: 'CONFIRMED',
      lean: leanLine,
      puckline_state_flip: isStateFlip,
      coordination_tier: coordTier,
      explanation: `Isolated move by a single book without market-wide confirmation. ${
        isStateFlip ? 'The puck line flipped state, but this appears driven by one book rather than coordinated sharp action.' : ''
      } Fake steam detector flagged this move.`,
      score_breakdown: scoreBreakdown,
    };
  }

  // CONFIRMED_RLM: true reverse line movement with broad confirmation
  if (hasRlm &&
      coordTier !== 'ISOLATED' && coordTier !== 'PARTIAL' &&
      input.movePersistedSnapshots >= 2 &&
      !input.hasSnappedBack &&
      rawTotal >= 55) {
    // If fake steam is also triggered, cap at MODERATE
    const confidence: NhlConfidence =
      input.fakeSteamTriggered ? 'MODERATE' :
      (rawTotal >= 70 && mlConfirms) ? 'HIGH' : 'MODERATE';

    return {
      signal_type: 'CONFIRMED_RLM',
      confidence,
      status: 'CONFIRMED',
      lean: leanLine,
      puckline_state_flip: isStateFlip,
      ...(isStateFlip ? { market_event_type: 'PUCKLINE_STATE_FLIP' as const } : {}),
      coordination_tier: coordTier,
      explanation: `Reverse line movement detected: public tickets favor ${
        input.publicTicketPctHome >= 50 ? input.homeTeam : input.awayTeam
      } but the market moved toward ${leanTeam}. ${
        input.spreadBooksMovedCount
      } books coordinated in the move${
        mlConfirms ? ', and the moneyline confirms the direction' : ''
      }. ${isStateFlip ? 'The puck line flipped state from favorite to underdog pricing.' : ''}`,
      score_breakdown: scoreBreakdown,
    };
  }

  // PARTIAL_SHARP_ENTRY: RLM exists but only 2 books, or incomplete confirmation
  if (hasRlm && input.spreadBooksMovedCount >= 2) {
    // Hard cap: 2-book move can never be HIGH
    const confidence: NhlConfidence =
      (rawTotal >= 55 && mlConfirms) ? 'MODERATE' : 'MODERATE';

    const secondaryTag: NhlSideSignalType | undefined =
      (input.spreadBooksMovedCount <= input.spreadBooksHeldCount) ? 'SPLIT_MARKET' : undefined;

    return {
      signal_type: 'PARTIAL_SHARP_ENTRY',
      ...(secondaryTag ? { secondary_tag: secondaryTag } : {}),
      confidence,
      status: 'NEEDS_CONFIRMATION',
      lean: leanLine,
      puckline_state_flip: isStateFlip,
      ...(isStateFlip ? { market_event_type: 'PUCKLINE_STATE_FLIP' as const } : {}),
      coordination_tier: coordTier,
      explanation: `The market shows reverse line movement toward ${leanTeam} against public ${
        input.publicTicketPctHome >= 50 ? input.homeTeam : input.awayTeam
      } tickets, but only ${input.spreadBooksMovedCount} of ${
        input.spreadBooksMovedCount + input.spreadBooksHeldCount
      } books confirmed the move. ${
        isStateFlip
          ? 'The puck line flipped state, but broad coordination is still incomplete.'
          : 'Because confirmation is incomplete, this is classified as a partial sharp entry rather than confirmed steam.'
      }${!mlConfirms ? ' Moneyline has not confirmed the direction.' : ''}`,
      score_breakdown: scoreBreakdown,
    };
  }

  // SPLIT_MARKET: books divided, some flipped, others held
  if (input.spreadBooksMovedCount > 0 && input.spreadBooksHeldCount > 0) {
    const confidence: NhlConfidence = hasRlm ? 'MODERATE' : 'LOW';

    return {
      signal_type: 'SPLIT_MARKET',
      confidence,
      status: 'NEEDS_CONFIRMATION',
      lean: leanLine,
      puckline_state_flip: isStateFlip,
      ...(isStateFlip ? { market_event_type: 'PUCKLINE_STATE_FLIP' as const } : {}),
      coordination_tier: coordTier,
      explanation: `Books are divided: ${input.spreadBooksMoved.join(', ')} moved while ${
        input.spreadBooksHeld.join(', ')
      } held. ${
        isStateFlip
          ? 'The puck line flipped state at some books but not others — no full market convergence.'
          : 'No full market convergence detected.'
      }${hasRlm ? ' Reverse line movement present but market remains split.' : ''}`,
      score_breakdown: scoreBreakdown,
    };
  }

  // FAKE_STEAM fallback: 1 book moved with wider market disagreement
  if (input.spreadBooksMovedCount === 1 || input.fakeSteamTriggered) {
    return {
      signal_type: 'FAKE_STEAM',
      confidence: 'LOW',
      status: 'CONFIRMED',
      lean: leanLine,
      puckline_state_flip: isStateFlip,
      coordination_tier: coordTier,
      explanation: `Isolated move without confirmation from the broader market. ${
        isStateFlip ? 'The puck-line state flip appears to be a single-book adjustment, not coordinated sharp action.' : ''
      }`,
      score_breakdown: scoreBreakdown,
    };
  }

  // Default: FROZEN
  return {
    signal_type: 'FROZEN',
    confidence: 'LOW',
    status: 'CONFIRMED',
    lean: 'PASS',
    puckline_state_flip: false,
    coordination_tier: coordTier,
    explanation: 'No meaningful signal detected in NHL side market.',
    score_breakdown: scoreBreakdown,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  NHL Totals Classification
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Classify NHL totals signal independently from side logic.
 *
 * NHL totals are commonly 5.5 / 6 / 6.5.
 * Repeated toggling between 5.5 and 6 without broad confirmation = noise.
 */
export function getNhlTotalsSignalType(input: {
  openingTotal: number;
  currentTotal: number;
  booksMovedCount: number;
  booksHeldCount: number;
  booksMoved: string[];
  booksHeld: string[];
  hasToggledRepeatedly?: boolean;
}): NhlTotalsClassification {
  const totalBooks = input.booksMovedCount + input.booksHeldCount;
  const moveDelta = Math.abs(input.currentTotal - input.openingTotal);

  // TOTAL_FROZEN: no movement
  if (moveDelta < 0.25 && input.booksMovedCount === 0) {
    return {
      signal_type: 'TOTAL_FROZEN',
      confidence: 'LOW',
      explanation: 'Totals line stable with no book movement. No signal.',
      books_moved: 0,
      total_books: totalBooks,
    };
  }

  // Repeated toggling between adjacent values = noise/price discovery
  if (input.hasToggledRepeatedly && input.booksMovedCount <= 2) {
    return {
      signal_type: 'TOTAL_NOISE',
      confidence: 'LOW',
      explanation: `Total toggling between adjacent values (${input.openingTotal} ↔ ${input.currentTotal}) without broad confirmation — likely price discovery noise.`,
      books_moved: input.booksMovedCount,
      total_books: totalBooks,
    };
  }

  // 1-book move = weak / noise
  if (input.booksMovedCount <= 1) {
    return {
      signal_type: 'TOTAL_NOISE',
      confidence: 'LOW',
      explanation: `Single-book total move from ${input.openingTotal} to ${input.currentTotal} (${
        input.booksMoved[0] || 'unknown book'
      }) — isolated move without confirmation.`,
      books_moved: input.booksMovedCount,
      total_books: totalBooks,
    };
  }

  // 2-book move = partial / watch
  if (input.booksMovedCount === 2) {
    return {
      signal_type: 'PARTIAL_TOTAL_MOVE',
      confidence: 'LOW',
      explanation: `Partial total movement: ${input.booksMoved.join(' and ')} moved from ${
        input.openingTotal
      } to ${input.currentTotal}, but ${
        input.booksHeld.length > 0 ? input.booksHeld.join(', ') + ' held' : 'confirmation incomplete'
      }.`,
      books_moved: input.booksMovedCount,
      total_books: totalBooks,
    };
  }

  // 3+ books = meaningful coordinated total move
  return {
    signal_type: 'COORDINATED_TOTAL_MOVE',
    confidence: moveDelta >= 1.0 ? 'HIGH' : 'MODERATE',
    explanation: `Coordinated total move: ${input.booksMoved.join(', ')} moved from ${
      input.openingTotal
    } to ${input.currentTotal} (${input.booksMovedCount}/${totalBooks}-book coordination).${
      input.booksHeld.length > 0 ? ` ${input.booksHeld.join(', ')} held.` : ' All books aligned.'
    }`,
    books_moved: input.booksMovedCount,
    total_books: totalBooks,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  NHL Move Description Helper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate NHL-appropriate move description text.
 * Prevents "3-point steam" language for puck-line state flips.
 */
export function describeNhlSpreadMove(
  openLine: number,
  currentLine: number,
  booksMovedCount: number,
  isFlip: boolean,
): string {
  if (isFlip) {
    if (openLine === -1.5 && currentLine === 1.5) {
      return 'The puck line flipped state from favorite (-1.5) to underdog (+1.5) pricing';
    }
    if (openLine === 1.5 && currentLine === -1.5) {
      return 'The puck line flipped state from underdog (+1.5) to favorite (-1.5) pricing';
    }
  }

  const delta = Math.abs(currentLine - openLine);
  if (delta < 0.25) return 'The puck line has not moved meaningfully';

  const direction = currentLine > openLine ? 'toward underdog' : 'toward favorite';
  return `The puck line moved ${delta} points ${direction} across ${booksMovedCount} book${booksMovedCount !== 1 ? 's' : ''}`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  NHL HSA Output Wording Builder
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build NHL-specific classification block to inject into the HSA prompt.
 * This gives Claude pre-computed classification so it doesn't misinterpret
 * puck-line moves as spread steam.
 */
export function buildNhlClassificationBlock(
  sideClassification: NhlSideClassification,
  totalsClassification: NhlTotalsClassification | null,
): string {
  const lines: string[] = [
    '=== NHL MARKET CLASSIFICATION (PRE-COMPUTED — DO NOT OVERRIDE) ===',
    'IMPORTANT: The classification below was computed by the NHL signal classifier.',
    'You MUST use these classifications and language in your output.',
    'Do NOT describe puck-line state flips as point-based steam moves.',
    'Do NOT label 2-book moves as "high confidence steam" or "confirmed steam".',
    '',
  ];

  lines.push('NHL SIDE SIGNAL:');
  lines.push(`  Signal Type: ${sideClassification.signal_type}`);
  if (sideClassification.secondary_tag) {
    lines.push(`  Secondary: ${sideClassification.secondary_tag}`);
  }
  lines.push(`  Confidence: ${sideClassification.confidence}`);
  lines.push(`  Status: ${sideClassification.status}`);
  lines.push(`  Lean: ${sideClassification.lean}`);
  lines.push(`  Coordination: ${sideClassification.coordination_tier} (${
    sideClassification.coordination_tier === 'ISOLATED' ? '1 book' :
    sideClassification.coordination_tier === 'PARTIAL' ? '2 books' :
    sideClassification.coordination_tier === 'MEANINGFUL' ? '3 books' :
    '4+ books'
  })`);
  if (sideClassification.puckline_state_flip) {
    lines.push('  Puck Line: STATE FLIP detected — do NOT describe as a numeric point move');
    lines.push('  Use language: "The puck line flipped state from favorite to underdog pricing"');
    lines.push('  FORBIDDEN: "3-point steam move", "3-point move"');
  }
  lines.push(`  Explanation: ${sideClassification.explanation}`);

  if (sideClassification.score_breakdown) {
    const sb = sideClassification.score_breakdown;
    lines.push(`  Score: ${sb.raw_total}/100 (ML:${sb.moneyline} Public:${sb.public_divergence} Coord:${sb.coordination} PL:${sb.puckline} Vel:${sb.velocity} Tot:${sb.total_correlation})`);
    if (sb.adjustments.length > 0) {
      lines.push(`  Adjustments: ${sb.adjustments.join('; ')}`);
    }
  }
  lines.push('');

  if (totalsClassification) {
    lines.push('NHL TOTALS SIGNAL:');
    lines.push(`  Signal Type: ${totalsClassification.signal_type}`);
    lines.push(`  Confidence: ${totalsClassification.confidence}`);
    lines.push(`  Books Moved: ${totalsClassification.books_moved}/${totalsClassification.total_books}`);
    lines.push(`  Explanation: ${totalsClassification.explanation}`);
    lines.push('');
  }

  lines.push('NHL OUTPUT RULES:');
  lines.push('  - Use "state flip" for puck-line ±1.5 transitions');
  lines.push('  - Use "partial sharp entry" when only 2 books confirmed');
  lines.push('  - Use "split market" when books are divided');
  lines.push('  - Use "needs confirmation" when status is NEEDS_CONFIRMATION');
  lines.push('  - NEVER say "3-point steam" for a puck-line state flip');
  lines.push('  - NEVER say "high confidence steam" with only 2 books');
  lines.push('  - NEVER say "market-wide confirmation" when books are split');

  return lines.join('\n');
}
