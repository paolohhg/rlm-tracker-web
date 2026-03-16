import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

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
Book Alignment: [Describe book consensus or disagreement with specific direction, e.g. "All three books moved toward Hawks +3.5" or "DraftKings shading 1 point lower than FanDuel"]
Public Bias: [State which side the public is on with ticket %, then state whether sharp money appears to be on the SAME or OPPOSITE side, e.g. "68% tickets on Celtics - sharp indicators point opposite toward Warriors"]

Market Lean: [Specific team + number or Over/Under + number, e.g. "Warriors +7.5" or "Under 218.5" or "PASS"]
Confidence: [Low / Moderate / High]

1. Line Movement
Describe the opening spread vs current spread, disagreement between sportsbooks, and how the line has moved across the market. Explain if the movement crossed key numbers or represents meaningful price discovery.

2. Book Behavior
Describe how sportsbooks reacted to market activity. Explain whether books appear to be respecting action, protecting positions, or aligning with market consensus.

3. Public Positioning
Interpret ticket percentage vs money percentage. Identify any divergence between recreational betting patterns and larger wagers.

4. Money Pattern
Describe movement velocity and timing. Explain whether the movement appears to be gradual market pressure or a sharp steam move.

5. Market Lean
State clearly which side the market pressure is pointing toward, including the specific team name and current number (e.g. "Market pressure points toward Team +7.5" or "Sportsbook adjustments lean toward the Under 218.5"). If the market shows no directional lean, state "PASS - market appears efficiently priced with no exploitable signal." This is a description of where sportsbooks are adjusting, NOT a wagering instruction.

6. Confirmation Factors
List factors that would strengthen or weaken the current market interpretation. Examples: line moving further in current direction, line reversing direction, public percentages shifting significantly, additional steam moves.

7. Totals Intel
Analyze totals market behavior separately. State the specific total number and whether sportsbook behavior leans Over or Under, with confidence level (Low / Moderate / High). If totals movement shows stronger signals than the spread, clearly state that. If no totals signal exists, say PASS.

End with: Disclaimer: For research purposes only.

FINAL GUIDELINES
Never instruct the reader to place a bet.
Never use the phrase "follow the signal".
Never describe an analysis as a betting opportunity.
Never use gambling tout language.
Describe what the market is doing, not what someone should do.`;

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

const BASKETBALL_KEY_NUMBERS = [3, 4, 5, 6, 7, 8, 10, 14];

function summarizeOdds(snapshots: OddsSnapshot[], gameTime: string): OddsSummary {
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
  const crossedKeyNumber = BASKETBALL_KEY_NUMBERS.some(
    (k) => (openAbsSpread < k && currentAbsSpread >= k) || (openAbsSpread > k && currentAbsSpread <= k)
  );
  const keyNumbersNear = BASKETBALL_KEY_NUMBERS.filter((k) => Math.abs(currentAbsSpread - k) <= 1);

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

  return {
    snapshotCount: snapshots.length, trackingHours, books,
    opening: { time: firstTime, books: openingBooks, consensusSpread: openingConsensusSpread, consensusTotal: openingConsensusTotal },
    current: { time: lastTime, books: currentBooks, consensusSpread: currentConsensusSpread, consensusTotal: currentConsensusTotal },
    spreadMovement, totalMovement, spreadDirection, totalDirection, velocityPerHour, maxBookDisagreement, timeline,
    sharpIndicators: { steamMove, steamDetail, frozenLine, crossedKeyNumber, keyNumbersNear },
    totalSharpIndicators: { totalSteamMove, totalSteamDetail, totalSteamDirection, frozenTotal, totalVelocityPerHour, highestTotalSeen, lowestTotalSeen, totalBookDisagreement },
  };
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

    if (existing?.length && !force) {
      const age = Date.now() - new Date(existing[0].created_at).getTime();
      const twoHours = 2 * 60 * 60 * 1000;
      if (age < twoHours && existing[0].analysis) {
        return res.status(200).json({
          narrative: existing[0].analysis,
          cached: true,
          created_at: existing[0].created_at,
        });
      }
    }

    // Fetch all odds snapshots for this game
    const { data: odds, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .order('fetched_at', { ascending: true });

    if (oddsError) {
      return res.status(500).json({ error: 'Failed to fetch odds', detail: oddsError.message });
    }

    if (!odds?.length) {
      return res.status(404).json({ error: 'No odds data found for this game' });
    }

    // Preprocess odds into structured summary
    const summary = summarizeOdds(odds, game_time);

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

    // Build prompt and call Claude with system prompt
    const userMessage = buildHsaUserMessage(league, away_team, home_team, game_time, summary, splitsData, totalsSplitsData);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: HSA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
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
