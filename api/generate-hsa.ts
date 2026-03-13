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

  return {
    snapshotCount: snapshots.length, trackingHours, books,
    opening: { time: firstTime, books: openingBooks, consensusSpread: openingConsensusSpread, consensusTotal: openingConsensusTotal },
    current: { time: lastTime, books: currentBooks, consensusSpread: currentConsensusSpread, consensusTotal: currentConsensusTotal },
    spreadMovement, totalMovement, spreadDirection, totalDirection, velocityPerHour, maxBookDisagreement, timeline,
    sharpIndicators: { steamMove, steamDetail, frozenLine, crossedKeyNumber, keyNumbersNear },
  };
}

// ── HSA Prompt Builder ─────────────────────────────────────────────

function buildHsaPrompt(league: string, awayTeam: string, homeTeam: string, gameTime: string, summary: OddsSummary): string {
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

=== LINE MOVEMENT TIMELINE ===
${timelineStr}

=== OUTPUT FORMAT ===
Start your response with EXACTLY this header line (no asterisks, no markdown):
${headerLine}

Then write the analysis using EXACTLY these numbered sections. Each section header must be on its own line formatted as: "N. Section Name:" followed by the analysis paragraph.

REQUIRED SECTIONS:

1. Line Movement: Describe exactly what happened to the spread from open to current. Use specific numbers for each book. Identify whether the movement was sharp (fast, coordinated across books) or grinding (slow, public-driven). Flag if any key numbers were crossed (3, 7, 10 in basketball). If the line moved AGAINST where public money would logically go, explicitly call it a contra-public move.

2. Book Protection: Explain WHY the books moved the line the direction they did. Are they responding to sharp money or managing public liability? If the line moved down while the favorite is getting public action, that's books respecting sharp money on the underdog. If books are aligned, explain what that consensus means. If one book is an outlier, identify which one and what it signals.

3. Market Context: Analyze the totals movement alongside the spread. Do they tell the same story or different stories? A total moving over while the spread tightens can signal different sharp action on each market. Also assess book disagreement - are all books aligned or is there an outlier shading differently?

4. Money Pattern: Describe the velocity and pattern of the movement. Was it a single steam move (sharp) or slow grinding (public)? Did the line move early and hold (sharp respect) or is it still moving (ongoing action)? Characterize whether this is accumulation, a single sharp hit, or public momentum.

5. Sharp Read: Give a DIRECT, OPINIONATED assessment. State clearly what the market signals indicate. Use language like "FOLLOW THE SIGNAL" or "FADE THE PUBLIC" or "NO EDGE - PASS" or "SHARP CONSENSUS" depending on what the data shows. Name the specific side and number the market is pointing to (e.g., "Rutgers +10.5"). Be honest - if there's no clear signal, say "PASS - no actionable edge detected."

6. Confirmation Factors: List 3-5 specific things to monitor that would CONFIRM or KILL the signal:
- What further line movement would strengthen the signal
- What reverse movement would kill it
- What key number thresholds matter
- Any situational factors (conference tournament context, rivalry, travel, etc.)
- What would indicate the sharp money was wrong

End with a one-sentence closing summary of the overall market read.

Add "Disclaimer: For research purposes only." at the very end.

FORMAT RULES:
- Write in direct, confident, analyst voice - like a sharp bettor briefing his crew
- Use specific numbers everywhere (spreads, totals, juice, specific book names)
- Do NOT use asterisks, bold markdown, or any markdown formatting
- Do NOT use bullet points with dashes in sections 1-5, write in flowing paragraphs
- Section 6 (Confirmation Factors) SHOULD use dashes for the list items
- Each numbered section should be 2-4 sentences
- Total length: 300-500 words`;
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

  const { league, home_team, away_team, game_time } = req.body || {};

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

    if (existing?.length) {
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

    // Build prompt and call Claude
    const prompt = buildHsaPrompt(league, away_team, home_team, game_time, summary);

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
