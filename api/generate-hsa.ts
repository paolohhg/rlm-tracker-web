import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
// Dynamic import to prevent module-load crash if lifecycle engine has issues
type MarketAnalysis = import('./lib/market-lifecycle-engine').MarketAnalysis;

// ── HSA System Prompt (inlined to avoid Vercel bundler issues) ────

const HSA_SYSTEM_PROMPT = `You are the Heard Sports Analysis (HSA) engine used by Heard Sports Intelligence.
Your role is to interpret sportsbook market behavior and produce professional market intelligence.
You are NOT a handicapper, pick service, betting advisor, or gambling recommendation engine.
Your analysis explains how sportsbooks are reacting to betting activity.
You never recommend placing a wager.
You never provide a "pick".
You never instruct users to act on a signal.
The analysis must read like professional trading desk market commentary.

PRIMARY PURPOSE
Analyze sportsbook market behavior using:
Opening line vs current line, Line movement direction, Line movement velocity, Disagreement between sportsbooks, Coordination across sportsbooks, Betting ticket percentages, Betting money percentages, Reverse line movement, Steam moves, Market pressure, Timing of movement, Totals movement.

Your job is to interpret what sportsbooks appear to be reacting to.
Do NOT predict game outcomes.
Do NOT speculate about team performance.
Focus on market behavior only.

STRICT LANGUAGE RULES
Never use: pick, best bet, lock, play, hammer, must bet, take this team, bet this, wager, recommend, betting, correlated play, betting opportunity
Never instruct the user to act.
Never use directive language.
Never say things like: "follow the signal", "bettors should take", "you should bet", "this is a play"
Instead describe the market using neutral analysis language.

APPROVED TERMINOLOGY
Use professional market language:
Market Lean, Market Bias, Pressure Direction, Signal Strength, Book Alignment, Sharp Indication, Market Efficiency, Price Discovery, Steam Move, Reverse Line Movement, PASS, WATCH, ACTIVE

Market Lean is NOT a betting recommendation.
Market Lean simply describes the direction sportsbooks appear to be adjusting toward.

STATUS TAGS
Each analysis must include one of the following: PASS, WATCH, ACTIVE

PASS - Market appears efficient with no meaningful signal.
WATCH - Movement or pressure is developing but not confirmed.
ACTIVE - Clear market signal detected from sportsbook behavior.

PASS is a valuable outcome and should be used frequently when signals are weak or balanced.
Do not force conviction.

SIGNAL INTERPRETATION
Reverse Line Movement - Public betting majority on one side while the line moves the opposite direction.
Steam Move - Rapid coordinated movement across multiple sportsbooks in a short window.
Book Coordination - Several sportsbooks adjusting together in the same direction.
Market Pressure - Gradual movement over time suggesting sustained action entering the market.
Price Discovery - Early disagreement between sportsbooks followed by convergence.

CONFIDENCE SCALE
Confidence reflects clarity of the market signal, NOT certainty of game outcome.
Low, Moderate, High

OUTPUT STRUCTURE
Return analysis using the following structure. Do NOT use markdown formatting, asterisks, or bold. Use plain text only.

Heard Sports Analysis
[Matchup]
[League] | [PASS / WATCH / ACTIVE]

HSI SIGNAL SUMMARY
Reverse Line Movement: [Yes/No - if Yes, state which side the line moved TOWARD despite public on the other side, e.g. "Yes - line moved toward Warriors +7 despite 62% public on Celtics"]
Steam Move: [Yes/No - if Yes, state the direction and magnitude, e.g. "Yes - 1.5-point move toward Under 218 in 20 minutes"]
Book Alignment: [Name every book. State which moved, which held, and the lead book. e.g. "DraftKings led move to Hawks +3.5, ESPNBet and BetMGM followed within 20 min, FanDuel held +4" or "All 4 books (DraftKings, FanDuel, BetMGM, ESPNBet) aligned at Hawks +3.5"]
Public Bias: [REQUIRED FORMAT - Two parts separated by a pipe. Part 1: State public side with ticket %. Part 2: State the SHARP SIDE explicitly. Examples:
"Public: 68% tickets on Celtics | Sharp side: Warriors +7.5 (reverse line movement + money divergence)"
"Public: 55% tickets on Hawks | Sharp side: No divergence detected - public and sharp aligned on Hawks"
"Public: 51% tickets on Wizards, 55% money on Wizards | Sharp side: NEUTRAL - slim margins show no meaningful sharp/public split"
You MUST always include "Sharp side:" followed by a specific team+number, "No divergence detected", or "NEUTRAL". Never leave the sharp side ambiguous.]

Market Lean: [Specific team + number or Over/Under + number, e.g. "Warriors +7.5" or "Under 218.5" or "PASS"]
Confidence: [Low / Moderate / High]

1. Line Movement
Describe the opening spread vs current spread with per-book detail. Name which books moved the spread and which held. State the exact move path per book when available (e.g. "DraftKings: -7 → -7.5, FanDuel: -7 → -7.5"). Explain if the movement crossed key numbers or represents meaningful price discovery.

2. Book Behavior
Name every sportsbook that moved and every sportsbook that held. State which book moved first (lead book) and which followed. Include exact move paths per book (e.g. "DraftKings moved -7 → -7.5, FanDuel followed -7 → -7.5, while BetMGM held -7"). State the time window of coordination. Do NOT use generic phrases like "books coordinated" — name every book explicitly.

3. Public Positioning
Interpret ticket percentage vs money percentage. Identify any divergence between recreational betting patterns and larger wagers.

4. Money Pattern
Describe movement velocity and timing. Explain whether the movement appears to be gradual market pressure or a sharp steam move.

5. Market Lean
State clearly which side the market pressure is pointing toward, including the specific team name and current number (e.g. "Market pressure points toward Team +7.5" or "Sportsbook adjustments lean toward the Under 218.5"). If the market shows no directional lean, state "PASS - market appears efficiently priced with no exploitable signal." This is a description of where sportsbooks are adjusting, NOT a wagering instruction.

6. Confirmation Factors
List factors that would strengthen or weaken the current market interpretation. Examples: line moving further in current direction, line reversing direction, public percentages shifting significantly, additional steam moves.

7. Totals Intel
Analyze totals market behavior with explicit sportsbook attribution. You MUST include:
- Exact sportsbook names that moved the total (e.g. "DraftKings, ESPNBet, and BetMGM moved the total from 151 to 151.5")
- How many books moved out of total tracked (e.g. "3/4 books")
- Which book moved first (lead book) if detectable
- Which books followed
- Exact move path (e.g. "151 → 151.5")
- Time window of coordination (e.g. "within 27 minutes")
- Which books did NOT move (e.g. "while FanDuel held 151")
- Whether the totals signal is stronger than the spread signal
State confidence level (Low / Moderate / High). If no totals signal exists, say PASS.
Do NOT use generic phrases like "books coordinated on totals" or "market moved". Name every book.

End with: Disclaimer: For research purposes only.

FINAL GUIDELINES
Never instruct the reader to place a bet.
Never use the phrase "follow the signal".
Never describe an analysis as a betting opportunity.
Never use gambling tout language.
Describe what the market is doing, not what someone should do.
The Public Bias field MUST always contain "Sharp side:" with an explicit conclusion. Vague descriptions of public percentages without a sharp-side verdict are not acceptable.
The Market Lean field MUST always name a specific team + number, Over/Under + number, or PASS. Never leave it directionally ambiguous.

CRITICAL SPORTSBOOK ATTRIBUTION RULE
Every section that discusses line movement MUST name exact sportsbooks.
Never write generic phrases like "books moved", "multiple sportsbooks", "sportsbooks coordinated", or "market shifted".
Always write: "[BookName], [BookName], and [BookName] moved X → Y within Z minutes, while [BookName] held X."
Use the BOOK COORDINATION INTEL section provided in the input data as your source of truth for which books moved, held, led, and followed.`;

// ── Types ──────────────────────────────────────────────────────────

interface OddsSnapshot {
  bookmaker: string;
  spread: number;
  spread_home_price: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price: number;
  fetched_at: string;
  // Fields from DB that may be present
  league?: string;
  game_time?: string;
  home_team?: string;
  away_team?: string;
  book_type?: string;
}

// ── Canonical Market Classification ──────────────────────────────

interface NormalizedOddsRow {
  eventId: string;
  sport: string;
  book: string;
  bookType: string;
  marketType: 'spread' | 'total' | 'moneyline';
  period: 'full_game' | 'first_half' | 'second_half' | 'live';
  betType: 'main' | 'alternate' | 'team_total' | 'live';
  side: 'home' | 'away' | 'over' | 'under' | null;
  line: number | null;
  price: number | null;
  timestamp: string;
  sourceLabel: string;
  usable: boolean;
  skipReason: string | null;
  // Original raw row for reconstruction
  raw: OddsSnapshot;
}

// League-specific sanity bounds for full-game totals
const TOTAL_SANITY_BOUNDS: Record<string, { min: number; max: number }> = {
  NBA:   { min: 180, max: 280 },
  NCAAB: { min: 100, max: 220 },
  MLB:   { min: 4, max: 16 },
  NHL:   { min: 3.5, max: 9.5 },
};

// League-specific sanity bounds for full-game spreads
const SPREAD_SANITY_BOUNDS: Record<string, { max: number }> = {
  NBA:   { max: 30 },
  NCAAB: { max: 40 },
  MLB:   { max: 5 },
  NHL:   { max: 3.5 },
};

function classifyOddsRow(
  row: OddsSnapshot,
  league: string,
  gameTime: string,
): NormalizedOddsRow[] {
  const eventId = `${league}|${row.home_team || ''}|${row.away_team || ''}|${gameTime}`;
  const sport = league === 'MLB' ? 'baseball' : league === 'NHL' ? 'hockey' : 'basketball';
  const book = row.bookmaker;
  const bookType = row.book_type || 'square';
  const timestamp = row.fetched_at;

  const results: NormalizedOddsRow[] = [];
  const totalBounds = TOTAL_SANITY_BOUNDS[league] || { min: 50, max: 350 };
  const spreadBounds = SPREAD_SANITY_BOUNDS[league] || { max: 50 };

  // Classify spread market
  if (row.spread != null && row.spread !== 0) {
    const absSpread = Math.abs(row.spread);
    let usable = true;
    let skipReason: string | null = null;

    if (absSpread > spreadBounds.max) {
      usable = false;
      skipReason = `spread ${row.spread} exceeds ${league} max ${spreadBounds.max}`;
    }

    results.push({
      eventId, sport, book, bookType,
      marketType: 'spread',
      period: 'full_game',
      betType: 'main',
      side: 'home',
      line: row.spread,
      price: row.spread_home_price,
      timestamp,
      sourceLabel: `${book} spread ${row.spread}`,
      usable,
      skipReason,
      raw: row,
    });
  }

  // Classify total market
  if (row.total != null && row.total !== 0) {
    let usable = true;
    let skipReason: string | null = null;

    if (row.total < totalBounds.min || row.total > totalBounds.max) {
      usable = false;
      skipReason = `total ${row.total} outside ${league} bounds [${totalBounds.min}-${totalBounds.max}]`;
    }

    results.push({
      eventId, sport, book, bookType,
      marketType: 'total',
      period: 'full_game',
      betType: 'main',
      side: 'over',
      line: row.total,
      price: row.total_over_price,
      timestamp,
      sourceLabel: `${book} total ${row.total}`,
      usable,
      skipReason,
      raw: row,
    });
  }

  // Classify moneyline market
  if (row.moneyline_home != null && row.moneyline_home !== 0) {
    results.push({
      eventId, sport, book, bookType,
      marketType: 'moneyline',
      period: 'full_game',
      betType: 'main',
      side: 'home',
      line: null,
      price: row.moneyline_home,
      timestamp,
      sourceLabel: `${book} ML home ${row.moneyline_home}`,
      usable: true,
      skipReason: null,
      raw: row,
    });
  }

  return results;
}

function canonicalMarketKey(row: NormalizedOddsRow): string {
  return `${row.eventId}|${row.book}|${row.marketType}|${row.period}|${row.betType}`;
}

interface BookLine {
  book: string;
  spread: number;
  spreadPrice: number;
  total: number;
  totalOverPrice: number;
  mlHome: number;
  mlAway: number;
}

interface TimelinePoint {
  minutesBefore: number;
  label: string;
  books: BookLine[];
  consensusSpread: number;
  consensusTotal: number;
}

interface OddsSummary {
  snapshotCount: number;
  trackingHours: number;
  books: string[];
  opening: { time: string; books: BookLine[]; consensusSpread: number; consensusTotal: number };
  current: { time: string; books: BookLine[]; consensusSpread: number; consensusTotal: number };
  spreadMovement: number;
  totalMovement: number;
  spreadDirection: string;
  totalDirection: string;
  velocityPerHour: number;
  maxBookDisagreement: number;
  timeline: TimelinePoint[];
  sharpIndicators: {
    steamMove: boolean;
    steamDetail: string | null;
    frozenLine: boolean;
    crossedKeyNumber: boolean;
    keyNumbersNear: number[];
  };
  totalSharpIndicators: {
    totalSteamMove: boolean;
    totalSteamDetail: string | null;
    totalSteamDirection: 'over' | 'under' | null;
    frozenTotal: boolean;
    totalVelocityPerHour: number;
    highestTotalSeen: number;
    lowestTotalSeen: number;
    totalBookDisagreement: number;
  };
}

// ── Odds Summarizer ────────────────────────────────────────────────

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function toBookLine(snap: OddsSnapshot): BookLine {
  return {
    book: snap.bookmaker,
    spread: snap.spread,
    spreadPrice: snap.spread_home_price,
    total: snap.total,
    totalOverPrice: snap.total_over_price,
    mlHome: snap.moneyline_home,
    mlAway: snap.moneyline_away,
  };
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

const KEY_NUMBERS: Record<string, number[]> = {
  NBA:   [3, 4, 5, 6, 7, 8, 10, 14],
  NCAAB: [3, 4, 5, 6, 7, 8, 10, 14],
  MLB:   [1.5],
  NHL:   [1.5],
};

function summarizeOdds(snapshots: OddsSnapshot[], gameTime: string, league: string = 'NBA'): OddsSummary {
  if (!snapshots.length) {
    return {
      snapshotCount: 0, trackingHours: 0, books: [],
      opening: { time: '', books: [], consensusSpread: 0, consensusTotal: 0 },
      current: { time: '', books: [], consensusSpread: 0, consensusTotal: 0 },
      spreadMovement: 0, totalMovement: 0, spreadDirection: 'stable', totalDirection: 'stable',
      velocityPerHour: 0, maxBookDisagreement: 0, timeline: [],
      sharpIndicators: { steamMove: false, steamDetail: null, frozenLine: false, crossedKeyNumber: false, keyNumbersNear: [] },
      totalSharpIndicators: { totalSteamMove: false, totalSteamDetail: null, totalSteamDirection: null, frozenTotal: false, totalVelocityPerHour: 0, highestTotalSeen: 0, lowestTotalSeen: 0, totalBookDisagreement: 0 },
    };
  }

  // Filter out snapshots where book hasn't posted a real spread (0 = no line)
  const withSpread = snapshots.filter((s) => s.spread !== 0 && s.spread != null);
  const sorted = [...(withSpread.length ? withSpread : snapshots)].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
  );

  const books = [...new Set(sorted.map((s) => s.bookmaker))];
  const firstTime = sorted[0].fetched_at;
  const lastTime = sorted[sorted.length - 1].fetched_at;
  const trackingHours = round1(minutesBetween(firstTime, lastTime) / 60);

  const openingByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    if (!openingByBook[s.bookmaker]) openingByBook[s.bookmaker] = s;
  }
  const openingBooks = Object.values(openingByBook).map(toBookLine);
  const openingSpreads = openingBooks.filter((b) => b.spread !== 0);
  const openingTotals = openingBooks.filter((b) => b.total !== 0);
  const openingConsensusSpread = roundHalf(avg(openingSpreads.map((b) => b.spread)));
  const openingConsensusTotal = roundHalf(avg(openingTotals.map((b) => b.total)));

  const currentByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    currentByBook[s.bookmaker] = s;
  }
  const currentBooks = Object.values(currentByBook).map(toBookLine);
  const currentSpreadsValid = currentBooks.filter((b) => b.spread !== 0);
  const currentTotalsValid = currentBooks.filter((b) => b.total !== 0);
  const currentConsensusSpread = roundHalf(avg(currentSpreadsValid.map((b) => b.spread)));
  const currentConsensusTotal = roundHalf(avg(currentTotalsValid.map((b) => b.total)));

  const spreadMovement = round1(currentConsensusSpread - openingConsensusSpread);
  const totalMovement = round1(currentConsensusTotal - openingConsensusTotal);

  const spreadDirection =
    Math.abs(spreadMovement) < 0.5 ? 'stable'
      : spreadMovement < 0 ? 'toward home favorite'
        : 'toward away / home underdog';

  const totalDirection =
    Math.abs(totalMovement) < 0.5 ? 'stable'
      : totalMovement > 0 ? 'over' : 'under';

  const velocityPerHour = trackingHours > 0 ? round1(Math.abs(spreadMovement) / trackingHours) : 0;

  const currentSpreads = currentBooks.map((b) => b.spread).filter((s) => s !== 0);
  const maxBookDisagreement =
    currentSpreads.length > 1
      ? round1(Math.max(...currentSpreads) - Math.min(...currentSpreads))
      : 0;

  // Timeline: sample every ~30 min
  const gameTimeMs = new Date(gameTime).getTime();
  const timeGroups: Record<string, OddsSnapshot[]> = {};
  for (const s of sorted) {
    const bucket = Math.floor(new Date(s.fetched_at).getTime() / (30 * 60000));
    const key = String(bucket);
    if (!timeGroups[key]) timeGroups[key] = [];
    timeGroups[key].push(s);
  }

  const timeline: TimelinePoint[] = Object.values(timeGroups).map((group) => {
    const mid = group[Math.floor(group.length / 2)];
    const minsBefore = Math.round((gameTimeMs - new Date(mid.fetched_at).getTime()) / 60000);
    const label = minsBefore > 60 ? `${Math.round(minsBefore / 60)}h before` : `${minsBefore}m before`;
    const booksInGroup: Record<string, OddsSnapshot> = {};
    for (const s of group) booksInGroup[s.bookmaker] = s;
    const bl = Object.values(booksInGroup).map(toBookLine);
    const validSpreads = bl.filter((b) => b.spread !== 0);
    const validTotals = bl.filter((b) => b.total !== 0);
    return {
      minutesBefore: minsBefore, label, books: bl,
      consensusSpread: roundHalf(avg(validSpreads.map((b) => b.spread))),
      consensusTotal: roundHalf(avg(validTotals.map((b) => b.total))),
    };
  });
  timeline.sort((a, b) => b.minutesBefore - a.minutesBefore);

  // Sharp indicators
  let steamMove = false;
  let steamDetail: string | null = null;
  for (let i = 1; i < timeline.length; i++) {
    const diff = Math.abs(timeline[i].consensusSpread - timeline[i - 1].consensusSpread);
    const timeDiff = timeline[i - 1].minutesBefore - timeline[i].minutesBefore;
    if (diff >= 1 && timeDiff <= 30) {
      steamMove = true;
      steamDetail = `${diff}-point move in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      break;
    }
  }

  const frozenLine = trackingHours >= 2 && Math.abs(spreadMovement) < 0.5;

  const openAbsSpread = Math.abs(openingConsensusSpread);
  const currentAbsSpread = Math.abs(currentConsensusSpread);
  const leagueKeyNumbers = KEY_NUMBERS[league] || KEY_NUMBERS.NBA;
  const crossedKeyNumber = leagueKeyNumbers.some(
    (k) => (openAbsSpread < k && currentAbsSpread >= k) || (openAbsSpread > k && currentAbsSpread <= k)
  );
  const keyNumbersNear = leagueKeyNumbers.filter((k) => Math.abs(currentAbsSpread - k) <= 1);

  // Totals sharp indicators
  let totalSteamMove = false;
  let totalSteamDetail: string | null = null;
  let totalSteamDirection: 'over' | 'under' | null = null;
  for (let i = 1; i < timeline.length; i++) {
    const diff = timeline[i].consensusTotal - timeline[i - 1].consensusTotal;
    const absDiff = Math.abs(diff);
    const timeDiff = timeline[i - 1].minutesBefore - timeline[i].minutesBefore;
    if (absDiff >= 1 && timeDiff <= 30) {
      totalSteamMove = true;
      totalSteamDirection = diff > 0 ? 'over' : 'under';
      totalSteamDetail = `${absDiff}-point total move in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      break;
    }
  }

  const frozenTotal = trackingHours >= 2 && Math.abs(totalMovement) < 0.5;
  const totalVelocityPerHour = trackingHours > 0 ? round1(Math.abs(totalMovement) / trackingHours) : 0;

  const timelineTotals = timeline.map((t) => t.consensusTotal).filter((t) => t > 0);
  const highestTotalSeen = timelineTotals.length ? round1(Math.max(...timelineTotals)) : openingConsensusTotal;
  const lowestTotalSeen = timelineTotals.length ? round1(Math.min(...timelineTotals)) : openingConsensusTotal;

  const currentTotalsArr = currentBooks.map((b) => b.total).filter((t) => t > 0);
  const totalBookDisagreement = currentTotalsArr.length > 1 ? round1(Math.max(...currentTotalsArr) - Math.min(...currentTotalsArr)) : 0;

  // Anomaly detection: flag suspiciously wide total ranges (possible data contamination)
  const totalRange = highestTotalSeen - lowestTotalSeen;
  if (totalRange > 15 && highestTotalSeen > 0 && lowestTotalSeen > 0) {
    console.warn(`[HSA ANOMALY] Total range ${totalRange}pts (${lowestTotalSeen}–${highestTotalSeen}) — possible market contamination`);
  }

  return {
    snapshotCount: snapshots.length, trackingHours, books,
    opening: { time: firstTime, books: openingBooks, consensusSpread: openingConsensusSpread, consensusTotal: openingConsensusTotal },
    current: { time: lastTime, books: currentBooks, consensusSpread: currentConsensusSpread, consensusTotal: currentConsensusTotal },
    spreadMovement, totalMovement, spreadDirection, totalDirection, velocityPerHour, maxBookDisagreement, timeline,
    sharpIndicators: { steamMove, steamDetail, frozenLine, crossedKeyNumber, keyNumbersNear },
    totalSharpIndicators: { totalSteamMove, totalSteamDetail, totalSteamDirection, frozenTotal, totalVelocityPerHour, highestTotalSeen, lowestTotalSeen, totalBookDisagreement },
  };
}

// ── Per-Book Coordination Intel ───────────────────────────────────

interface BookMoveDetail {
  book: string;
  openLine: number;
  currentLine: number;
  move: number;
  /** Timestamp of first snapshot for this book */
  firstAt: string;
  /** Timestamp of last snapshot for this book */
  lastAt: string;
  /** Timestamp of first snapshot where line actually changed from opening */
  firstMoveAt: string;
}

interface MarketCoordination {
  /** Books that moved in the consensus direction */
  movedBooks: BookMoveDetail[];
  /** Books that did not move (or moved against consensus) */
  heldBooks: BookMoveDetail[];
  /** Lead book — the one whose last snapshot is earliest among movers */
  leadBook: string | null;
  /** Follow books — movers other than the lead */
  followBooks: string[];
  /** Time window in minutes between first and last mover */
  timeWindowMinutes: number;
  /** Total books tracked */
  totalBooks: number;
  /** Consensus direction description */
  direction: string;
  /** Move path string, e.g. "151 → 151.5" */
  movePath: string;
}

function computeBookCoordination(
  sorted: OddsSnapshot[],
  openingByBook: Record<string, OddsSnapshot>,
  currentByBook: Record<string, OddsSnapshot>,
  market: 'total' | 'spread' | 'moneyline',
): MarketCoordination | null {
  const books = Object.keys(currentByBook);
  if (books.length === 0) return null;

  // Helper: extract the market value from a snapshot
  function val(s: OddsSnapshot): number {
    if (market === 'total') return s.total;
    if (market === 'spread') return s.spread;
    return s.moneyline_home;
  }

  // Extract per-book open/current values
  const details: BookMoveDetail[] = [];
  for (const book of books) {
    const open = openingByBook[book];
    const curr = currentByBook[book];
    if (!open || !curr) continue;

    const openLine = round1(val(open));
    const currentLine = round1(val(curr));

    // Skip books with zeroed/missing lines (e.g. total zeroed by classification filter)
    if (market === 'moneyline') {
      if (openLine === 0 && currentLine === 0) continue;
    } else {
      if (openLine === 0 || currentLine === 0) continue;
    }

    // Find when this book FIRST moved away from its opening line
    const bookSnaps = sorted.filter(s => s.bookmaker === book);
    let firstMoveAt = curr.fetched_at; // fallback
    for (const snap of bookSnaps) {
      const snapVal = round1(val(snap));
      if (snapVal !== 0 && snapVal !== openLine) {
        firstMoveAt = snap.fetched_at;
        break;
      }
    }

    details.push({
      book,
      openLine,
      currentLine,
      move: round1(currentLine - openLine),
      firstAt: open.fetched_at,
      lastAt: curr.fetched_at,
      firstMoveAt,
    });
  }

  if (details.length === 0) return null;

  // Consensus direction
  const moves = details.map(d => d.move).filter(m => m !== 0);
  if (moves.length === 0) return null;
  const consensusSign = Math.sign(moves.reduce((a, b) => a + b, 0));
  if (consensusSign === 0) return null;

  // Use a low threshold so we capture books that moved even slightly
  const threshold = market === 'moneyline' ? 3 : 0.1;

  const movedBooks = details.filter(d => Math.sign(d.move) === consensusSign && Math.abs(d.move) >= threshold);
  const heldBooks = details.filter(d => !movedBooks.includes(d));

  if (movedBooks.length === 0) return null;

  // Lead book = mover whose line changed earliest (firstMoveAt)
  const sortedMovers = [...movedBooks].sort(
    (a, b) => new Date(a.firstMoveAt).getTime() - new Date(b.firstMoveAt).getTime()
  );
  const leadBook = sortedMovers[0]?.book ?? null;
  const followBooks = sortedMovers.slice(1).map(b => b.book);

  // Time window between first book to move and last book to move
  const moveTimestamps = movedBooks.map(b => new Date(b.firstMoveAt).getTime());
  const windowMin = Math.round((Math.max(...moveTimestamps) - Math.min(...moveTimestamps)) / 60000);

  // Direction label
  let direction: string;
  if (market === 'total') {
    direction = consensusSign > 0 ? 'Over' : 'Under';
  } else if (market === 'spread') {
    direction = consensusSign < 0 ? 'toward home favorite' : 'toward away underdog';
  } else {
    direction = consensusSign > 0 ? 'toward home' : 'toward away';
  }

  // Move path (average opening → average current among movers)
  const avgOpen = round1(avg(movedBooks.map(b => b.openLine)));
  const avgCurr = round1(avg(movedBooks.map(b => b.currentLine)));
  const movePath = `${avgOpen} → ${avgCurr}`;

  return {
    movedBooks, heldBooks, leadBook, followBooks,
    timeWindowMinutes: windowMin,
    totalBooks: details.length,
    direction, movePath,
  };
}

function formatCoordinationBlock(
  label: string,
  coord: MarketCoordination | null,
): string {
  if (!coord || coord.movedBooks.length === 0) {
    return `${label} COORDINATION: All books held their opening ${label.toLowerCase()} lines. Mention each book by name and state they held.`;
  }

  const lines: string[] = [`${label} COORDINATION:`];
  const movedNames = coord.movedBooks.map(b => b.book).join(', ');
  const ratio = `${coord.movedBooks.length}/${coord.totalBooks}`;
  lines.push(`  Books moved (${ratio}): ${movedNames}`);
  lines.push(`  Move path: ${coord.movePath} (${coord.direction})`);
  lines.push(`  Time window: ${coord.timeWindowMinutes} minutes`);

  if (coord.leadBook) {
    lines.push(`  Lead book (moved first): ${coord.leadBook}`);
  }
  if (coord.followBooks.length > 0) {
    lines.push(`  Followed by: ${coord.followBooks.join(', ')}`);
  }

  if (coord.heldBooks.length > 0) {
    const heldNames = coord.heldBooks.map(b => `${b.book} (still at ${b.currentLine})`).join(', ');
    lines.push(`  Books that DID NOT move: ${heldNames}`);
  } else {
    lines.push(`  ALL ${coord.totalBooks} books moved — no holdouts`);
  }

  // Per-book detail
  lines.push('  Per-book move detail (USE THESE EXACT VALUES IN YOUR OUTPUT):');
  for (const b of coord.movedBooks) {
    lines.push(`    ${b.book}: ${b.openLine} → ${b.currentLine} (${b.move > 0 ? '+' : ''}${b.move}) [MOVED]`);
  }
  for (const b of coord.heldBooks) {
    const moveLabel = b.move === 0 ? 'unchanged' : `${b.move > 0 ? '+' : ''}${b.move}, against consensus`;
    lines.push(`    ${b.book}: ${b.openLine} → ${b.currentLine} (${moveLabel}) [HELD]`);
  }

  return lines.join('\n');
}

// ── HSA User Message Builder ──────────────────────────────────────

function buildHsaUserMessage(
  league: string,
  awayTeam: string,
  homeTeam: string,
  gameTime: string,
  summary: OddsSummary,
  splits?: { homeBetsPct: number; awayBetsPct: number; homeMoneyPct: number; awayMoneyPct: number; numBets: number } | null,
  totalsSplits?: { overTicketPct: number; underTicketPct: number; overMoneyPct: number; underMoneyPct: number } | null,
): string {
  const timelineStr = summary.timeline
    .map((t) => `${t.label}: spread ${t.consensusSpread} | total ${t.consensusTotal} [${t.books.map((b) => `${b.book}: ${b.spread}/${b.total}`).join(', ')}]`)
    .join('\n');

  const currentBooksStr = summary.current.books
    .map((b) => `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`)
    .join('\n');

  const openingBooksStr = summary.opening.books
    .map((b) => `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`)
    .join('\n');

  const homeFavored = summary.current.consensusSpread < 0;
  const favoriteTeam = homeFavored ? homeTeam : awayTeam;
  const underdogTeam = homeFavored ? awayTeam : homeTeam;
  const currentAbsSpread = Math.abs(summary.current.consensusSpread);

  return `Analyze this game's market behavior and return the HSA structured analysis.

GAME: ${awayTeam} @ ${homeTeam}
LEAGUE: ${league}
GAME TIME: ${gameTime}

SPREAD CONVENTION: All spreads are from ${homeTeam} (HOME) perspective. Negative = ${homeTeam} favored.
CURRENT MARKET: ${favoriteTeam} favored by ${currentAbsSpread}. ${underdogTeam} is the underdog at +${currentAbsSpread}.

=== MARKET DATA ===
Tracking: ${summary.snapshotCount} snapshots over ${summary.trackingHours} hours
Books: ${summary.books.join(', ')}

OPENING LINES:
${openingBooksStr}
Consensus: spread ${summary.opening.consensusSpread} | total ${summary.opening.consensusTotal}

CURRENT LINES:
${currentBooksStr}
Consensus: spread ${summary.current.consensusSpread} | total ${summary.current.consensusTotal}

MOVEMENT:
Spread: ${summary.spreadMovement > 0 ? '+' : ''}${summary.spreadMovement} (${summary.spreadDirection})
Total: ${summary.totalMovement > 0 ? '+' : ''}${summary.totalMovement} (${summary.totalDirection})
Velocity: ${summary.velocityPerHour} pts/hr
Max book disagreement: ${summary.maxBookDisagreement} pts

SHARP INDICATORS:
Steam move: ${summary.sharpIndicators.steamMove ? `YES - ${summary.sharpIndicators.steamDetail}` : 'No'}
Frozen line: ${summary.sharpIndicators.frozenLine ? 'YES - line barely moved despite extended tracking' : 'No'}
Crossed key number: ${summary.sharpIndicators.crossedKeyNumber ? 'YES' : 'No'}
Key numbers nearby: ${summary.sharpIndicators.keyNumbersNear.length ? summary.sharpIndicators.keyNumbersNear.join(', ') : 'none'}

TOTALS SHARP INDICATORS:
Total steam move: ${summary.totalSharpIndicators.totalSteamMove ? `YES - ${summary.totalSharpIndicators.totalSteamDetail} (${summary.totalSharpIndicators.totalSteamDirection})` : 'No'}
Frozen total: ${summary.totalSharpIndicators.frozenTotal ? 'YES - total barely moved despite extended tracking' : 'No'}
Total velocity: ${summary.totalSharpIndicators.totalVelocityPerHour} pts/hr
Total book disagreement: ${summary.totalSharpIndicators.totalBookDisagreement} pts
Highest total seen: ${summary.totalSharpIndicators.highestTotalSeen} / Lowest: ${summary.totalSharpIndicators.lowestTotalSeen}
${splits ? `
=== BETTING SPLITS ===
Total bets tracked: ${splits.numBets.toLocaleString()}
Spread tickets: ${awayTeam} ${splits.awayBetsPct}% / ${homeTeam} ${splits.homeBetsPct}%
Spread money: ${awayTeam} ${splits.awayMoneyPct}% / ${homeTeam} ${splits.homeMoneyPct}%
${splits.awayBetsPct !== splits.awayMoneyPct ? `TICKET/MONEY DIVERGENCE: ${Math.abs(splits.awayBetsPct - splits.awayMoneyPct)}% gap on ${awayTeam} side` : 'Tickets and money aligned'}` : `
=== BETTING SPLITS ===
No betting splits data available for this game.`}
${totalsSplits ? `
=== TOTALS SPLITS ===
Over tickets: ${totalsSplits.overTicketPct}% / Under tickets: ${totalsSplits.underTicketPct}%
Over money: ${totalsSplits.overMoneyPct}% / Under money: ${totalsSplits.underMoneyPct}%
${Math.abs(totalsSplits.overTicketPct - totalsSplits.overMoneyPct) >= 5 ? `TOTALS DIVERGENCE: ${Math.abs(totalsSplits.overTicketPct - totalsSplits.overMoneyPct)}% gap` : 'Totals tickets and money aligned'}` : `
=== TOTALS SPLITS ===
No totals splits data available for this game.`}

=== LINE MOVEMENT TIMELINE ===
${timelineStr}`;
}

// ── Vercel Handler ─────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { league, home_team, away_team, game_time, force } = req.body || {};

  if (!league || !home_team || !away_team || !game_time) {
    return res.status(400).json({
      error: 'Missing required fields: league, home_team, away_team, game_time',
    });
  }

  try {
    // Check cache: return existing analysis if < 2h old
    const { data: existing } = await supabase
      .from('claude_analyses')
      .select('*')
      .eq('league', league)
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .order('created_at', { ascending: false })
      .limit(1);

    // Cache check: return existing analysis only if:
    //   1. Less than 30 min old (was 2h — too stale for moving markets)
    //   2. Not force-refreshed
    //   3. Current odds haven't moved meaningfully since cached analysis
    if (existing?.length && !force) {
      const age = Date.now() - new Date(existing[0].created_at).getTime();
      const thirtyMin = 30 * 60 * 1000;
      if (age < thirtyMin && existing[0].analysis) {
        // Quick-check: has the line moved since this analysis was cached?
        // Fetch the latest snapshot to compare
        const { data: latestSnap } = await supabase
          .from('odds_snapshots')
          .select('spread, total')
          .eq('league', league)
          .eq('home_team', home_team)
          .eq('away_team', away_team)
          .order('fetched_at', { ascending: false })
          .limit(1);

        let lineMovedSignificantly = false;
        if (latestSnap?.length && existing[0].analysis) {
          const text = existing[0].analysis as string;
          // Extract the consensus total/spread from cached text
          const totalMatch = text.match(/total.*?(\d{2,3}(?:\.\d)?)/i);
          const cachedTotal = totalMatch ? parseFloat(totalMatch[1]) : null;
          const currentTotal = latestSnap[0].total;
          if (cachedTotal && currentTotal && Math.abs(currentTotal - cachedTotal) >= 1.0) {
            lineMovedSignificantly = true;
          }
          const currentSpread = latestSnap[0].spread;
          // Check spread movement by looking at what the analysis mentions
          if (currentSpread != null) {
            const spreadMatch = text.match(/consensus.*?(-?\d+(?:\.\d)?)/i);
            const cachedSpread = spreadMatch ? parseFloat(spreadMatch[1]) : null;
            if (cachedSpread != null && Math.abs(currentSpread - cachedSpread) >= 1.0) {
              lineMovedSignificantly = true;
            }
          }
        }

        if (!lineMovedSignificantly) {
          return res.status(200).json({
            narrative: existing[0].analysis,
            cached: true,
            created_at: existing[0].created_at,
          });
        }
        // Line moved — fall through to regenerate
      }
    }

    // ── When force-refreshing, pull fresh odds first ──────────────
    if (force) {
      try {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          await fetch(`${supabaseUrl}/functions/v1/fetch-odds`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
          });
        }
      } catch { /* non-critical — continue with existing data */ }
    }

    // Fetch odds snapshots scoped to this specific game
    // Filter by league + game_time window to prevent cross-game contamination
    //
    // IMPORTANT: Supabase default limit is 1000 rows. With 5+ books polling
    // every 10 min over 24h, that's easily exceeded. To ensure we always
    // get the LATEST snapshots, we:
    //   1. Order descending (newest first)
    //   2. Limit to 1000 (guaranteed to include current lines)
    //   3. Reverse in-memory for the summarizer (expects ascending)
    const gameTimeDate = new Date(game_time);
    const windowStart = new Date(gameTimeDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(gameTimeDate.getTime() + 4 * 60 * 60 * 1000).toISOString();

    const { data: oddsDesc, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('league', league)
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .gte('game_time', windowStart)
      .lte('game_time', windowEnd)
      .order('fetched_at', { ascending: false })
      .limit(1000);

    // Reverse to ascending for summarizer (it expects chronological order)
    const odds = oddsDesc ? [...oddsDesc].reverse() : null;

    if (oddsError) {
      return res.status(500).json({ error: 'Failed to fetch odds', detail: oddsError.message });
    }

    if (!odds?.length) {
      return res.status(404).json({ error: 'No odds data found for this game' });
    }

    // ── Canonical Market Classification ──────────────────────────
    // Classify every raw row, validate against league bounds, filter to usable full-game main markets
    const allClassified: NormalizedOddsRow[] = [];
    for (const row of odds) {
      allClassified.push(...classifyOddsRow(row as OddsSnapshot, league, game_time));
    }

    const usableRows = allClassified.filter(r => r.usable);
    const skippedRows = allClassified.filter(r => !r.usable);

    // Debug logging: show exactly what feeds into the analysis
    console.log(`[HSA DEBUG] ${league} | ${away_team} @ ${home_team} | game_time=${game_time}`);
    console.log(`[HSA DEBUG] Query window: ${windowStart} to ${windowEnd}`);
    console.log(`[HSA DEBUG] Raw query rows: ${odds.length} | Classified: ${allClassified.length} | Usable: ${usableRows.length} | Skipped: ${skippedRows.length}`);

    if (skippedRows.length > 0) {
      for (const r of skippedRows) {
        console.log(`[HSA SKIP] ${r.book} | ${r.marketType} | line=${r.line} | reason=${r.skipReason}`);
      }
    }

    // Log data ranges for verification
    const usableTotals = usableRows.filter(r => r.marketType === 'total').map(r => r.line!).filter(l => l > 0);
    const usableSpreads = usableRows.filter(r => r.marketType === 'spread').map(r => r.line!).filter(l => l !== 0);
    if (usableTotals.length > 0) {
      console.log(`[HSA DEBUG] Total range: ${Math.min(...usableTotals)} to ${Math.max(...usableTotals)} (${usableTotals.length} rows)`);
    }
    if (usableSpreads.length > 0) {
      console.log(`[HSA DEBUG] Spread range: ${Math.min(...usableSpreads)} to ${Math.max(...usableSpreads)} (${usableSpreads.length} rows)`);
    }
    const distinctGameTimes = [...new Set(odds.map((r: any) => r.game_time))];
    if (distinctGameTimes.length > 1) {
      console.warn(`[HSA WARNING] Multiple game_time values in results: ${distinctGameTimes.join(', ')}`);
    }
    const books = [...new Set(usableRows.map(r => r.book))];
    console.log(`[HSA DEBUG] Books: ${books.join(', ')}`);

    // Build clean OddsSnapshot array from usable full-game main rows only
    // De-duplicate: one raw row produces spread+total+ML classifications,
    // but summarizeOdds expects the original flat row format.
    // Collect unique raw rows where at least one market is usable.
    const usableRawRowSet = new Set<OddsSnapshot>();
    for (const r of usableRows) {
      if (r.period === 'full_game' && r.betType === 'main') {
        usableRawRowSet.add(r.raw);
      }
    }

    // For rows where total was flagged unusable but spread was fine,
    // zero out the total so it doesn't contaminate the summarizer
    const cleanSnapshots: OddsSnapshot[] = [...usableRawRowSet].map(raw => {
      const totalClassified = allClassified.find(
        c => c.raw === raw && c.marketType === 'total'
      );
      const spreadClassified = allClassified.find(
        c => c.raw === raw && c.marketType === 'spread'
      );

      return {
        ...raw,
        total: (totalClassified && totalClassified.usable) ? raw.total : 0,
        total_over_price: (totalClassified && totalClassified.usable) ? raw.total_over_price : 0,
        spread: (spreadClassified && spreadClassified.usable) ? raw.spread : 0,
        spread_home_price: (spreadClassified && spreadClassified.usable) ? raw.spread_home_price : 0,
      };
    });

    if (!cleanSnapshots.length) {
      return res.status(404).json({ error: 'No usable odds data after market classification' });
    }

    // Preprocess clean odds into structured summary
    const summary = summarizeOdds(cleanSnapshots, game_time, league);

    // Fetch betting splits from splits_snapshots table
    let splitsData: { homeBetsPct: number; awayBetsPct: number; homeMoneyPct: number; awayMoneyPct: number; numBets: number } | null = null;
    const { data: splitsRows } = await supabase
      .from('splits_snapshots')
      .select('*')
      .eq('league', league)
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .order('fetched_at', { ascending: false })
      .limit(1);

    let totalsSplitsData: { overTicketPct: number; underTicketPct: number; overMoneyPct: number; underMoneyPct: number } | null = null;

    if (splitsRows?.length) {
      const s = splitsRows[0];
      splitsData = {
        homeBetsPct: s.home_ticket_pct,
        awayBetsPct: s.away_ticket_pct,
        homeMoneyPct: s.home_money_pct,
        awayMoneyPct: s.away_money_pct,
        numBets: s.num_bets ?? 0,
      };
      if (s.total_over_ticket_pct != null && s.total_under_ticket_pct != null) {
        totalsSplitsData = {
          overTicketPct: s.total_over_ticket_pct,
          underTicketPct: s.total_under_ticket_pct,
          overMoneyPct: s.total_over_money_pct ?? 0,
          underMoneyPct: s.total_under_money_pct ?? 0,
        };
      }
    }

    // ── Lifecycle analysis (full-path model) ───────────────────────
    // Run the lifecycle engine on all snapshots to get structural context,
    // primary signal, and current state for each market.
    // This prevents the STABILIZATION→PASS bug where quiet recent windows
    // erase meaningful prior signals.
    // Wrapped in try/catch: if lifecycle fails, HSA still generates using
    // the existing summarizer — lifecycle context is additive, not required.
    let lifecycle: { spread: MarketAnalysis | null; total: MarketAnalysis | null; moneyline: MarketAnalysis | null } = {
      spread: null, total: null, moneyline: null,
    };
    let lifecycleBlock = '';
    try {
      const { analyzeGameMarkets } = await import('./lib/market-lifecycle-engine');
      lifecycle = analyzeGameMarkets(
        cleanSnapshots as any,
        league,
        home_team,
        away_team,
      );
      lifecycleBlock = buildLifecycleContext(lifecycle);
    } catch (lcErr: any) {
      console.error('[HSA] Lifecycle analysis failed (non-fatal):', lcErr.message);
    }

    // ── Per-book coordination intel ─────────────────────────────────
    // Compute which specific books moved, led, followed, or held for
    // each market. This feeds concrete sportsbook names into the prompt
    // so the LLM produces exact attribution instead of generic prose.
    //
    // IMPORTANT: cleanSnapshots may have zeroed-out values for markets
    // flagged unusable (e.g. total=0 on a row where spread was usable).
    // We build market-specific opening/current maps that skip zero values.
    const coordSorted = [...cleanSnapshots].sort(
      (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
    );

    function buildMarketMaps(snaps: OddsSnapshot[], getter: (s: OddsSnapshot) => number) {
      const openMap: Record<string, OddsSnapshot> = {};
      const currMap: Record<string, OddsSnapshot> = {};
      for (const s of snaps) {
        const v = getter(s);
        if (v === 0) continue; // skip zeroed/missing values
        if (!openMap[s.bookmaker]) openMap[s.bookmaker] = s;
        currMap[s.bookmaker] = s;
      }
      return { openMap, currMap };
    }

    const totalMaps = buildMarketMaps(coordSorted, s => s.total);
    const spreadMaps = buildMarketMaps(coordSorted, s => s.spread);
    const mlMaps = buildMarketMaps(coordSorted, s => s.moneyline_home);

    const totalCoord = computeBookCoordination(coordSorted, totalMaps.openMap, totalMaps.currMap, 'total');
    const spreadCoord = computeBookCoordination(coordSorted, spreadMaps.openMap, spreadMaps.currMap, 'spread');
    const mlCoord = computeBookCoordination(coordSorted, mlMaps.openMap, mlMaps.currMap, 'moneyline');

    // Debug: log coordination results and input data quality
    console.log(`[HSA COORD] Books in coordSorted: ${[...new Set(coordSorted.map(s => s.bookmaker))].join(', ')}`);
    console.log(`[HSA COORD] Total maps: open=${Object.keys(totalMaps.openMap).join(',')} curr=${Object.keys(totalMaps.currMap).join(',')}`);
    console.log(`[HSA COORD] Spread maps: open=${Object.keys(spreadMaps.openMap).join(',')} curr=${Object.keys(spreadMaps.currMap).join(',')}`);
    console.log(`[HSA COORD] Total result: ${totalCoord ? `${totalCoord.movedBooks.length}/${totalCoord.totalBooks} moved (${totalCoord.movedBooks.map(b => b.book).join(', ')}) | held: ${totalCoord.heldBooks.map(b => b.book).join(', ') || 'none'} | lead: ${totalCoord.leadBook}` : 'null — no books with valid total data passed threshold'}`);
    console.log(`[HSA COORD] Spread result: ${spreadCoord ? `${spreadCoord.movedBooks.length}/${spreadCoord.totalBooks} moved (${spreadCoord.movedBooks.map(b => b.book).join(', ')})` : 'null'}`);
    console.log(`[HSA COORD] ML result: ${mlCoord ? `${mlCoord.movedBooks.length}/${mlCoord.totalBooks} moved` : 'null'}`);

    // Build raw per-book lines as a fallback so Claude always has book names
    const rawBookLines: string[] = ['BOOKS TRACKED: ' + summary.books.join(', ')];
    rawBookLines.push('PER-BOOK CURRENT LINES (use these book names in your output):');
    for (const b of summary.current.books) {
      const openBook = summary.opening.books.find(ob => ob.book === b.book);
      rawBookLines.push(`  ${b.book}: spread ${openBook?.spread ?? '?'} → ${b.spread} | total ${openBook?.total ?? '?'} → ${b.total} | ML ${openBook?.mlHome ?? '?'} → ${b.mlHome}`);
    }

    const coordBlock = [
      '\n=== BOOK COORDINATION INTEL (USE EXACT BOOK NAMES IN OUTPUT) ===',
      'IMPORTANT: You MUST use the exact sportsbook names below in sections 1, 2, and 7 of your output.',
      'Do NOT write "multiple books", "several sportsbooks", or "books coordinated".',
      'Instead write: "[BookName] and [BookName] moved X → Y, while [BookName] held X."\n',
      rawBookLines.join('\n'),
      '',
      formatCoordinationBlock('TOTALS', totalCoord),
      '',
      formatCoordinationBlock('SPREAD', spreadCoord),
      '',
      formatCoordinationBlock('MONEYLINE', mlCoord),
    ].join('\n');

    console.log(`[HSA COORD BLOCK]\n${coordBlock}`);

    // Build prompt and call Claude with system prompt
    const userMessage = buildHsaUserMessage(league, away_team, home_team, game_time, summary, splitsData, totalsSplitsData);

    // Append lifecycle context and coordination intel as structured sections
    const fullMessage = userMessage + '\n\n' + lifecycleBlock + '\n\n' + coordBlock;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: HSA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: fullMessage }],
    });

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!rawText) {
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

    // Parse structured text response — extract key fields
    const narrative = rawText;

    // Extract status tag from output
    const statusMatch = narrative.match(/\b(PASS|WATCH|ACTIVE)\b/);
    const statusTag = statusMatch?.[1] || 'WATCH';

    // Extract market lean from "Market Lean:" line
    const leanMatch = narrative.match(/Market Lean:\s*(.+)/i);
    const marketLean = leanMatch?.[1]?.trim() || 'PASS';

    // Extract confidence from "Confidence:" line
    const confMatch = narrative.match(/Confidence:\s*(Low|Moderate|High)/i);
    const confidence = confMatch?.[1] || 'Low';

    // Compute totals data
    const totalsOpen = summary.opening.consensusTotal;
    const totalsCurrent = summary.current.consensusTotal;
    const totalsMove = roundHalf(totalsCurrent - totalsOpen);

    // Store in claude_analyses
    const { error: insertError } = await supabase.from('claude_analyses').insert({
      league,
      home_team,
      away_team,
      game_id: `${league}|${home_team}|${away_team}`,
      analysis: narrative,
    });

    if (insertError) {
      console.error('Insert error:', insertError.message);
    }

    return res.status(200).json({
      narrative,
      cached: false,
      snapshot_count: summary.snapshotCount,
      tracking_hours: summary.trackingHours,
      status_tag: statusTag,
      market_lean: marketLean,
      confidence,
      totals_open: totalsOpen,
      totals_current: totalsCurrent,
      totals_move: totalsMove,
      // Lifecycle analysis attached for downstream consumers
      lifecycle: {
        spread: lifecycle.spread ? marketAnalysisSummary(lifecycle.spread) : null,
        total: lifecycle.total ? marketAnalysisSummary(lifecycle.total) : null,
        moneyline: lifecycle.moneyline ? marketAnalysisSummary(lifecycle.moneyline) : null,
      },
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
    });
  } catch (err: any) {
    console.error('HSA generation error:', err);
    return res.status(500).json({
      error: 'Failed to generate HSA',
      detail: err.message,
    });
  }
}

// ── Lifecycle Context Builder ─────────────────────────────────────────────
// Generates a structured text block injected into the HSA prompt so Claude
// respects the full lifecycle model. Enforces the hard rule: if a meaningful
// primary signal exists, the market must NEVER be labeled PASS.

function buildLifecycleContext(lifecycle: {
  spread: MarketAnalysis | null;
  total: MarketAnalysis | null;
  moneyline: MarketAnalysis | null;
}): string {
  const sections: string[] = ['=== MARKET LIFECYCLE ANALYSIS (FULL HISTORY) ==='];
  sections.push('IMPORTANT: The lifecycle analysis below reflects the FULL line history from opening to current.');
  sections.push('If a primary signal exists (state != QUIET), you MUST NOT classify that market as PASS.');
  sections.push('Recent quiet periods = STABILIZATION, not PASS. Respect the primary signal.\n');

  for (const [label, m] of [
    ['SPREAD', lifecycle.spread],
    ['TOTAL', lifecycle.total],
    ['MONEYLINE', lifecycle.moneyline],
  ] as [string, MarketAnalysis | null][]) {
    if (!m) {
      sections.push(`${label}: No data`);
      continue;
    }

    const ps = m.primary_signal;
    const cs = m.current_state;
    const sc = m.structural_context;

    sections.push(`${label} LIFECYCLE:`);
    sections.push(`  Opening: ${m.opening_line} → Current: ${m.current_line} (total move: ${sc.total_move_from_open > 0 ? '+' : ''}${sc.total_move_from_open})`);
    sections.push(`  Primary Signal: ${ps.state} | Direction: ${ps.direction} | Distance: ${ps.distance} | Books: ${ps.books_involved} | Velocity: ${ps.velocity_per_hour}/hr`);
    sections.push(`  Signal Window: ${ps.start_line} → ${ps.end_line} (${ps.start_time} to ${ps.end_time})`);
    sections.push(`  Current State: ${cs.state} | Move since primary: ${cs.move_since_primary} | Holding: ${cs.holding_near_level} | Books aligned: ${cs.books_aligned_now}`);
    sections.push(`  Retracement: ${sc.percent_retraced.toFixed(0)}% | Time at band: ${sc.time_at_current_band_minutes}min`);
    sections.push(`  Recent: last 30m ${m.move_last_30m > 0 ? '+' : ''}${m.move_last_30m} | last 2h ${m.move_last_2h > 0 ? '+' : ''}${m.move_last_2h} | last 8h ${m.move_last_8h > 0 ? '+' : ''}${m.move_last_8h}`);
    sections.push(`  Lifecycle Read: ${m.final_read.signal_status} | Lean: ${m.final_read.market_lean} | Confidence: ${m.final_read.confidence}`);
    sections.push(`  Summary: ${m.final_read.summary_mode}`);
    sections.push('');
  }

  return sections.join('\n');
}

/** Compact summary of a MarketAnalysis for the API response */
function marketAnalysisSummary(m: MarketAnalysis) {
  return {
    market_type: m.market_type,
    opening_line: m.opening_line,
    current_line: m.current_line,
    primary_signal: m.primary_signal,
    current_state: m.current_state,
    structural_context: m.structural_context,
    data_quality: m.data_quality,
    final_read: m.final_read,
  };
}
