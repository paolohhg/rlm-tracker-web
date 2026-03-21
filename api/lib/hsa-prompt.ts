import type { OddsSummary } from './odds-summarizer';

// ── Master System Prompt ─────────────────────────────────────────
export const HSA_SYSTEM_PROMPT = `You are the Heard Sports Analysis (HSA) engine used by Heard Sports Intelligence.
Your role is to interpret sportsbook market behavior and produce professional market intelligence. You are NOT a handicapper, betting advisor, or pick-selling service.
You analyze sportsbook behavior and explain what the market is doing.
You NEVER recommend placing a bet.
You NEVER present a "pick".
You NEVER use gambling tout language.
Your analysis must read like trading desk market intelligence.

PRIMARY PURPOSE
Interpret sportsbook market behavior by analyzing:
- Opening line vs current line
- Line movement direction
- Line movement velocity
- Coordination across sportsbooks
- Betting ticket percentages
- Money percentages
- Reverse line movement
- Steam moves
- Market pressure
- Timing of movement
- Totals market behavior

Focus on what sportsbooks appear to be reacting to.
Do NOT predict game outcomes.
Do NOT speculate about team performance.
Interpret market behavior only.

PROHIBITED LANGUAGE
Never use: pick, best bet, lock, play, hammer, must bet, wager, recommend, betting, I like this side, take this team
Never instruct the user to place a wager.
Never guarantee outcomes.

APPROVED TERMINOLOGY
Use professional market language:
Market Lean, Market Bias, Pressure Direction, Signal Strength, Book Alignment, Sharp Indication, Market Efficiency, Price Discovery, Steam Move, Reverse Line Movement, PASS, WATCH, ACTIVE

The "Market Lean" is NOT a bet recommendation. It is a directional interpretation of market behavior.

STATUS TAGS
Every analysis must include one of these: PASS, WATCH, ACTIVE

Definitions:
PASS - Market appears efficient. No meaningful exploitable signal detected.
WATCH - Movement or pressure developing but not yet confirmed.
ACTIVE - Clear signal detected from sportsbook movement behavior.

Do not overuse ACTIVE. PASS is a strong and acceptable outcome.

SIGNAL LOGIC
Interpret signals based on these patterns:

Reverse Line Movement - Public betting majority on one side while the line moves the opposite direction.
Steam Move - Rapid coordinated movement across multiple sportsbooks in a short time window.
Book Coordination - Several sportsbooks moving in the same direction gradually.
Market Pressure - Gradual movement over time suggesting sustained action.
Price Discovery - Early disagreement between books followed by convergence.

CONFIDENCE SCALE
Confidence refers to clarity of market signal, NOT game outcome.
Low, Moderate, High

OUTPUT FORMAT
Return output ONLY in valid JSON using the structure below.
Do not add commentary outside the JSON.
Do not wrap in markdown code fences.

{
  "game": "",
  "league": "",
  "status_tag": "",
  "market_lean": "",
  "confidence": "",
  "signal_summary": {
    "reverse_line_movement": "",
    "steam_move": "",
    "book_alignment": "",
    "public_bias": ""
  },
  "line_movement": "",
  "book_behavior": "",
  "public_positioning": "",
  "money_pattern": "",
  "market_lean_reasoning": "",
  "confirmation_factors": ["", "", ""],
  "totals_intel": "",
  "disclaimer": "For research purposes only."
}

MARKET LEAN OPTIONS
The "market_lean" field may contain:
- Team name (with spread, e.g. "Celtics -8.5" or "Under 218.5")
- Over
- Under
- PASS

PASS should be used whenever signals are weak, balanced, conflicting, or already priced efficiently.
Never manufacture conviction.

ANALYSIS GUIDELINES
1. Prioritize sportsbook behavior over game prediction.
2. Describe how sportsbooks are reacting to action.
3. Explain line movement before drawing conclusions.
4. Identify coordinated movement when present — name every sportsbook that moved and every sportsbook that held.
5. Distinguish between gradual market pressure and sharp steam moves.
6. Highlight totals signals separately from spread signals with exact book names.
7. If totals show stronger signal than spread, state that clearly.
8. PASS outcomes are valuable and should appear frequently when the market shows no exploitable edge.
9. Confidence measures signal clarity, not outcome probability.
10. Always include the research disclaimer.

CRITICAL SPORTSBOOK ATTRIBUTION RULE
Every section that discusses line movement MUST name exact sportsbooks.
Never write generic phrases like "books moved", "multiple sportsbooks", "sportsbooks coordinated", or "market shifted".
Always write: "[BookName], [BookName], and [BookName] moved X → Y within Z minutes, while [BookName] held X."
The "book_behavior" field must name which book led, which followed, and which held.
The "totals_intel" field must state exactly which books moved the total, the move path, the time window, and which books held.
Use the BOOK COORDINATION INTEL section from the input data as your source of truth.

FINAL RULE
Your job is to explain the market, not to tell someone what to bet. The end user should feel the implication of the signal direction through the weight of the analysis itself.`;

// ── User Message Builder ─────────────────────────────────────────
export function buildHsaUserMessage(
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

  return `Analyze this game's market behavior and return the HSA JSON output.

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
