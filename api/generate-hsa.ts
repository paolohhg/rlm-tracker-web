import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

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

// ── HSA Prompt Builder ─────────────────────────────────────────────

function buildHsaPrompt(league: string, awayTeam: string, homeTeam: string, gameTime: string, summary: OddsSummary, splits?: { homeBetsPct: number; awayBetsPct: number; homeMoneyPct: number; awayMoneyPct: number; numBets: number } | null, totalsSplits?: { overTicketPct: number; underTicketPct: number; overMoneyPct: number; underMoneyPct: number } | null): string {
  const timelineStr = summary.timeline
    .map((t) => `${t.label}: spread ${t.consensusSpread} | total ${t.consensusTotal} [${t.books.map((b) => `${b.book}: ${b.spread}/${b.total}`).join(', ')}]`)
    .join('\n');

  const currentBooksStr = summary.current.books
    .map((b) => `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`)
    .join('\n');

  const openingBooksStr = summary.opening.books
    .map((b) => `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`)
    .join('\n');

  // Determine signal type for header
  const absMove = Math.abs(summary.spreadMovement);
  const signalType = summary.sharpIndicators.steamMove ? 'Steam Move Alert'
    : summary.sharpIndicators.frozenLine ? 'Frozen Line Analysis'
    : absMove >= 1.5 ? 'Contra Signal Analysis'
    : absMove >= 0.5 ? 'Line Movement Analysis'
    : 'Market Stability Analysis';

  const headerLine = `${homeTeam} ${summary.opening.consensusSpread} → ${summary.current.consensusSpread} ${signalType}`;

  // Determine which team is favored for context
  const homeFavored = summary.current.consensusSpread < 0;
  const favoriteTeam = homeFavored ? homeTeam : awayTeam;
  const underdogTeam = homeFavored ? awayTeam : homeTeam;
  const currentAbsSpreadForContext = Math.abs(summary.current.consensusSpread);

  return `You are a sharp sports betting analyst generating a "Heard Sports Analysis" (HSA) report. You specialize in identifying sharp action, reverse line movement, contra-public signals, and market inefficiencies across multiple sportsbooks.

GAME: ${awayTeam} @ ${homeTeam}
LEAGUE: ${league}
GAME TIME: ${gameTime}

IMPORTANT SPREAD CONVENTION: All spreads are from ${homeTeam} (HOME) perspective. A negative spread means ${homeTeam} is favored. A positive spread means ${awayTeam} is favored.
CURRENT MARKET: ${favoriteTeam} is favored by ${currentAbsSpreadForContext}. ${underdogTeam} is the underdog at +${currentAbsSpreadForContext}.
When making your Sharp Read, use the CORRECT team with the CORRECT sign. The favorite gets the minus (-), the underdog gets the plus (+). For example: "${underdogTeam} +${currentAbsSpreadForContext}" or "${favoriteTeam} -${currentAbsSpreadForContext}".

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
=== BETTING SPLITS (from Action Network) ===
Total bets tracked: ${splits.numBets.toLocaleString()}
Spread tickets: ${awayTeam} ${splits.awayBetsPct}% / ${homeTeam} ${splits.homeBetsPct}%
Spread money: ${awayTeam} ${splits.awayMoneyPct}% / ${homeTeam} ${splits.homeMoneyPct}%
${splits.awayBetsPct !== splits.awayMoneyPct ? `TICKET/MONEY DIVERGENCE: ${Math.abs(splits.awayBetsPct - splits.awayMoneyPct)}% gap on ${awayTeam} side (${splits.awayBetsPct}% tickets vs ${splits.awayMoneyPct}% money)` : 'Tickets and money aligned'}
${(splits.awayBetsPct > 50 && splits.awayMoneyPct < splits.awayBetsPct) || (splits.homeBetsPct > 50 && splits.homeMoneyPct < splits.homeBetsPct) ? 'NOTE: Public side getting more tickets than money - possible sharp money on opposite side' : ''}` : `
=== BETTING SPLITS ===
No betting splits data available for this game.`}
${totalsSplits ? `
=== TOTALS SPLITS (from Action Network) ===
Over tickets: ${totalsSplits.overTicketPct}% / Under tickets: ${totalsSplits.underTicketPct}%
Over money: ${totalsSplits.overMoneyPct}% / Under money: ${totalsSplits.underMoneyPct}%
${Math.abs(totalsSplits.overTicketPct - totalsSplits.overMoneyPct) >= 5 ? `TOTALS TICKET/MONEY DIVERGENCE: ${Math.abs(totalsSplits.overTicketPct - totalsSplits.overMoneyPct)}% gap (Over ${totalsSplits.overTicketPct}% tickets vs ${totalsSplits.overMoneyPct}% money)` : 'Totals tickets and money aligned'}` : `
=== TOTALS SPLITS ===
No totals splits data available for this game.`}

=== LINE MOVEMENT TIMELINE ===
${timelineStr}

=== OUTPUT FORMAT ===
Start your response with EXACTLY this header line (no asterisks, no markdown):
${headerLine}

Then write the analysis using EXACTLY these numbered sections. Each section header must be on its own line formatted as: "N. Section Name:" followed by the analysis paragraph.

REQUIRED SECTIONS:

1. Line Movement: Describe exactly what happened to the spread from open to current. Use specific numbers for each book. Identify whether the movement was sharp (fast, coordinated across books) or grinding (slow, public-driven). Flag if any key numbers were crossed (3, 7, 10 in basketball). If the line moved AGAINST where public money would logically go, explicitly call it a contra-public move.

2. Book Protection: Explain WHY the books moved the line the direction they did. Are they responding to sharp money or managing public liability? If the line moved down while the favorite is getting public action, that's books respecting sharp money on the underdog. If books are aligned, explain what that consensus means. If one book is an outlier, identify which one and what it signals.

3. Public Narrative: Using the betting splits data, describe what the public is doing vs where the money is going. State the ticket percentages and money percentages for each side. Identify any ticket/money divergence - when one side has more tickets but the other side has more money, that signals sharp action. If 65%+ of tickets are on one side but money is closer to even or reversed, that's a strong contra-public indicator. If no splits data is available, analyze the totals movement alongside the spread for market context clues.

4. Money Pattern: Describe the velocity and pattern of the movement. Was it a single steam move (sharp) or slow grinding (public)? Did the line move early and hold (sharp respect) or is it still moving (ongoing action)? Connect the money pattern to the betting splits - does the money flow match or contradict the public ticket distribution?

5. Sharp Read: Give a DIRECT, OPINIONATED assessment. State clearly what the market signals indicate. Use language like "FOLLOW THE SIGNAL" or "FADE THE PUBLIC" or "NO EDGE - PASS" or "SHARP CONSENSUS" depending on what the data shows. Name the specific side and number the market is pointing to (e.g., "Rutgers +10.5"). Be honest - if there's no clear signal, say "PASS - no actionable edge detected."

6. Confirmation Factors: List 3-5 specific things to monitor that would CONFIRM or KILL the signal:
- What further line movement would strengthen the signal
- What reverse movement would kill it
- What key number thresholds matter
- Any situational factors (conference tournament context, rivalry, travel, etc.)
- What would indicate the sharp money was wrong

7. Totals Intel: Analyze the totals market independently from the spread. Cover these points in flowing prose: (a) Is the total moving with or against public over/under betting? If over tickets are heavy but the total dropped, that is a totals RLM signal toward the under, and vice versa. (b) Is there a ticket/money divergence on totals (e.g. 70% over tickets but only 48% over money)? (c) Is the total frozen while public bets one side heavily? (d) Was there a steam move on the total? State the likely sharp total side (Over or Under) with a confidence level (Low / Medium / Medium-High / High), or say PASS if no totals signal. If totals data is insufficient, say so briefly and move on.

End with a one-sentence closing summary of the overall market read covering BOTH spread and totals.

Add "Disclaimer: For research purposes only." at the very end.

FORMAT RULES:
- Write in direct, confident, analyst voice - like a sharp bettor briefing his crew
- Use specific numbers everywhere (spreads, totals, juice, specific book names)
- Do NOT use asterisks, bold markdown, or any markdown formatting
- Do NOT use bullet points with dashes in sections 1-5 and 7, write in flowing paragraphs
- Section 6 (Confirmation Factors) SHOULD use dashes for the list items
- Each numbered section should be 2-4 sentences
- Total length: 400-600 words`;
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

    // Build prompt and call Claude
    const prompt = buildHsaPrompt(league, away_team, home_team, game_time, summary, splitsData, totalsSplitsData);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const narrative =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!narrative) {
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

    // Extract bet signal from Sharp Read section
    const sharpReadMatch = narrative.match(/5\.\s*Sharp Read:\s*(.*?)(?=\n\n|\n6\.)/s);
    const sharpReadText = sharpReadMatch?.[1]?.trim() || '';
    // Extract the action (FOLLOW THE SIGNAL, FADE THE PUBLIC, NO EDGE - PASS, etc.)
    const actionMatch = sharpReadText.match(/(FOLLOW THE SIGNAL|FADE THE PUBLIC|NO EDGE\s*[-–—]\s*PASS|SHARP CONSENSUS|PASS)/i);
    const signalAction = actionMatch?.[1]?.toUpperCase() || '';
    // Extract team and spread from Sharp Read (e.g., "Kentucky +10.5" or "Michigan -12.5")
    const betMatch = sharpReadText.match(/(?:on\s+|[-–—]\s*)([\w\s.'']+?)\s+([+-]\d+\.?\d*)/);
    const betTeam = betMatch?.[1]?.trim() || '';
    const betSpread = betMatch?.[2] || '';

    // Extract totals signal from Totals Intel section
    const totalsIntelMatch = narrative.match(/7\.\s*Totals Intel:\s*(.*?)(?=\n\n|End|Disclaimer|$)/s);
    const totalsIntelText = totalsIntelMatch?.[1]?.trim() || '';
    const totalsSharpSideMatch = totalsIntelText.match(/sharp total side[:\s]*(Over|Under)/i);
    const totalsSharpSide = totalsSharpSideMatch?.[1] || null;
    const totalsConfidenceMatch = totalsIntelText.match(/(Low|Medium-High|Medium|High)\s*confidence/i) || totalsIntelText.match(/confidence[:\s]*(Low|Medium-High|Medium|High)/i);
    const totalsConfidence = totalsConfidenceMatch?.[1] || null;

    // Derive totals signal type from indicators + Claude response
    let totalsSignalType: string | null = null;
    if (totalsSharpSide) {
      const side = totalsSharpSide.toUpperCase();
      if (summary.totalSharpIndicators.totalSteamMove) {
        totalsSignalType = `TOTAL_STEAM_${side}`;
      } else if (summary.totalMovement !== 0 && totalsSplitsData) {
        // Check for RLM: public bets one way, total moves the other
        const publicOver = totalsSplitsData.overTicketPct > totalsSplitsData.underTicketPct;
        const totalMovedDown = summary.totalMovement < 0;
        const totalMovedUp = summary.totalMovement > 0;
        if ((publicOver && totalMovedDown) || (!publicOver && totalMovedUp)) {
          totalsSignalType = `TOTAL_RLM_${side}`;
        } else {
          totalsSignalType = `TOTAL_SHARP_${side}`;
        }
      } else {
        totalsSignalType = `TOTAL_SHARP_${side}`;
      }
    }

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
      signal_action: signalAction,
      bet_team: betTeam,
      bet_spread: betSpread,
      totals_open: totalsOpen,
      totals_current: totalsCurrent,
      totals_move: totalsMove,
      totals_signal_type: totalsSignalType,
      totals_sharp_side: totalsSharpSide,
      totals_confidence: totalsConfidence,
      totals_velocity: summary.totalSharpIndicators.totalVelocityPerHour,
      highest_total_seen: summary.totalSharpIndicators.highestTotalSeen,
      lowest_total_seen: summary.totalSharpIndicators.lowestTotalSeen,
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
