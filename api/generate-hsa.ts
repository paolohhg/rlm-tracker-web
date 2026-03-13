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

  const sorted = [...snapshots].sort(
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
  const openingConsensusSpread = round1(avg(openingBooks.map((b) => b.spread)));
  const openingConsensusTotal = round1(avg(openingBooks.map((b) => b.total)));

  const currentByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    currentByBook[s.bookmaker] = s;
  }
  const currentBooks = Object.values(currentByBook).map(toBookLine);
  const currentConsensusSpread = round1(avg(currentBooks.map((b) => b.spread)));
  const currentConsensusTotal = round1(avg(currentBooks.map((b) => b.total)));

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

  const currentSpreads = currentBooks.map((b) => b.spread);
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
    return {
      minutesBefore: minsBefore, label, books: bl,
      consensusSpread: round1(avg(bl.map((b) => b.spread))),
      consensusTotal: round1(avg(bl.map((b) => b.total))),
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

  return `You are a sharp sports betting analyst generating a "Heard Sports Analysis" (HSA) narrative. You analyze odds movement data across multiple sportsbooks to identify sharp action, market inefficiencies, and line movement patterns.

GAME: ${awayTeam} @ ${homeTeam}
LEAGUE: ${league}
GAME TIME: ${gameTime}

=== MARKET SUMMARY ===
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

=== ANALYSIS INSTRUCTIONS ===
Write a 150-250 word narrative analysis covering these areas IN ORDER OF IMPORTANCE:

1. LINE MOVEMENT STORY: What happened to the spread from open to now? Did it move sharply or gradually? Did it cross any key numbers (3, 7, 10 in basketball)?

2. SHARP vs PUBLIC: Is the line moving in a direction that suggests sharp money? Consider: if one book moved first and others followed, that's sharp action. If books disagree, the outlier may be reacting to sharps.

3. BOOK DISAGREEMENT: Are the books aligned or is one shading differently? Which book is the outlier and in which direction? This often signals one book reacting to sharp action.

4. TOTALS CONTEXT: Has the total moved? In which direction? Does it tell a different story than the spread? Totals movement can confirm or contradict spread-side action.

5. VELOCITY & TIMING: How fast did the line move? Rapid movement suggests steam/sharp action. Slow grinding movement suggests public action.

FORMAT RULES:
- Write in direct, confident analyst voice
- Lead with the most significant finding
- Use specific numbers (e.g., "opened -3.5, now -4.5 across all three books")
- End with a one-sentence "BOTTOM LINE:" assessment
- Do NOT give betting advice or picks - describe what the market is telling us
- Do NOT use bullet points - write in flowing paragraphs
- Do NOT use markdown formatting`;
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
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const narrative =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!narrative) {
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

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
