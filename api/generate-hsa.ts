import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
// Dynamic import to prevent module-load crash if lifecycle engine has issues
type MarketAnalysis = import('./lib/market-lifecycle-engine').MarketAnalysis;

// ── HSA System Prompt (inlined to avoid Vercel bundler issues) ────

const HSA_SYSTEM_PROMPT = `You are the Heard Sports Analysis (HSA) engine. You produce concise, structured market intelligence about sportsbook behavior. You are NOT a handicapper or betting advisor. You describe what sportsbooks are doing, never what someone should bet.

FORBIDDEN LANGUAGE: pick, best bet, lock, play, hammer, must bet, take this, wager, recommend, follow the signal, betting opportunity

STATUS TAGS: PASS (efficient, no signal), WATCH (developing, unconfirmed), ACTIVE (clear signal detected). Use PASS frequently when signals are weak.

SIGNAL TYPES:
- Reverse Line Movement: public majority on one side, line moves opposite
- Steam Move: rapid coordinated movement across 3+ books within 30 min
- Full Book Consensus: all tracked books (≥4) moved same direction within 60 min (strongest signal, overrides PASS)
- Book Coordination: multiple books adjusting together
- Market Pressure: gradual sustained movement

CONFIDENCE: Low, Moderate, High — reflects signal clarity, NOT game outcome certainty.

OUTPUT STRUCTURE (use plain text, no markdown, no asterisks, no bold):

[Away Team] @ [Home Team]
[League] | [PASS/WATCH/ACTIVE] | [Market Lean: team+number or PASS] | [Confidence: Low/Moderate/High]

EXECUTIVE READ
Max 4 sentences. State WHAT moved, WHO it favors, WHY it matters. Anchor to opener → current. Do not list every book here.

PRIMARY SIGNAL
Primary Market: [Spread / Moneyline / Total]
Open: [team + number]
Current: [team + number]
Move: [X of Y books toward team]
Signal Type: [RLM / Steam / Full Book Consensus / Market Agreement / Frozen / PASS]
Lead Book: [name]
Confirmation: [what confirms or conflicts]

PUBLIC / MONEY
Tickets: [X% Team]
Money: [X% Team]
Sharp Side: [team+number / NEUTRAL / No divergence]

BOOK INTEL
Max 4 bullets. Only behavior insights — no numbers already listed above.
- Leader: [book] initiated [market] move
- Followers: [books]
- Outlier: [book] held [number]
- [Any other unique insight]

SECONDARY MARKETS
Max 3 lines. Only include if they add confirmation or conflict. Omit if no secondary signal.
[Market]: [X/Y books moved / held / mixed]

SIGNAL DRIVERS
Max 4 bullets. Why this signal matters.
- [driver]

WHAT CHANGES THE READ
Strengthens:
- [factor]
Weakens:
- [factor]

BOTTOM LINE
One sentence. No explanation, no extra commentary. State the lean + key driver + any cap on confidence.

Disclaimer: For research purposes only.

CRITICAL RULES:
1. NEVER repeat the same fact in multiple sections
2. NEVER restate book data in paragraph form if already listed
3. Each section must answer a DIFFERENT question
4. If a section adds no new information, OMIT it entirely
5. All spreads are from HOME team perspective. Away spread is opposite sign.
6. If a MARKET LEAN DIRECTIVE is provided, use that lean verbatim
7. ALWAYS name exact sportsbooks — never write "books moved" or "multiple sportsbooks"
8. Use the BOOK COORDINATION INTEL section as your source for which books moved/held/led

NHL RULES:
- Puck-line flips (-1.5 to +1.5) are STATE FLIPS, not "3-point moves"
- Signal priority: Moneyline > Public divergence > Book coordination > Puck line
- 1 book = isolated, 2 = partial, 3 = meaningful, 4+ = strong confirmation
- Respect NHL MARKET CLASSIFICATION if provided

MLB RULES:
- Primary signal market is MONEYLINE, not run line
- Evaluate: Moneyline → Total → Run line
- 5c ML move = notable, 10c = meaningful, 15c+ = significant
- NEVER say "static" or "PASS" when ML moved ≥10c
- Use ML language for Market Lean (e.g. "Pirates +100 ML")
- Static run line does NOT mean no movement`;

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

    // MLB run line normalization: the run line is structurally ±1.5.
    // Different books may report +1.5 or -1.5 for the same home team
    // depending on which team they list as favorite. This is NOT movement.
    // Normalize: always store the absolute value (1.5) for MLB run lines
    // to prevent false "3-point moves" or "consensus flips."
    let normalizedSpread = row.spread;
    if (league === 'MLB' && absSpread === 1.5) {
      // Use absolute value — sign differences are team-side perspective, not movement
      normalizedSpread = 1.5;
    }

    results.push({
      eventId, sport, book, bookType,
      marketType: 'spread',
      period: 'full_game',
      betType: 'main',
      side: 'home',
      line: normalizedSpread,
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

/** Compute a deterministic snapshot ID from the odds data.
 * Same set of per-book lines → same snapshot_id → same analysis. */
function computeSnapshotId(snapshots: OddsSnapshot[], league: string, homeTeam: string, awayTeam: string): string {
  // Hash the per-book current lines: book|spread|total|mlHome|mlAway
  // Sort by book name for determinism
  const lines = [...snapshots]
    .sort((a, b) => a.bookmaker.localeCompare(b.bookmaker))
    .map(s => `${s.bookmaker}|${s.spread}|${s.total}|${s.moneyline_home}|${s.moneyline_away}`)
    .join(';');
  // Simple hash — not crypto, just deterministic fingerprint
  let hash = 0;
  for (let i = 0; i < lines.length; i++) {
    const chr = lines.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return `${league}|${homeTeam}|${awayTeam}|${Math.abs(hash).toString(36)}`;
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
  opening: { time: string; books: BookLine[]; consensusSpread: number; consensusTotal: number; consensusMlHome: number; consensusMlAway: number };
  current: { time: string; books: BookLine[]; consensusSpread: number; consensusTotal: number; consensusMlHome: number; consensusMlAway: number };
  spreadMovement: number;
  totalMovement: number;
  spreadDirection: string;
  totalDirection: string;
  // Moneyline movement tracking (critical for MLB)
  mlHomeMovement: number;
  mlAwayMovement: number;
  mlDirection: string;
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

/**
 * Compute consensus via MODE (most common value) — always a real book line.
 * NEVER returns averaged/synthetic numbers.
 */
function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];

  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);

  let maxFreq = 0;
  for (const count of freq.values()) {
    if (count > maxFreq) maxFreq = count;
  }

  const candidates = [...freq.entries()]
    .filter(([, count]) => count === maxFreq)
    .map(([val]) => val);

  if (candidates.length === 1) return candidates[0];

  const sorted = [...nums].sort((a, b) => a - b);
  const medianVal = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianVal) - Math.abs(b - medianVal));
  return candidates[0];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Map raw lowercase bookmaker keys to proper display names */
const BOOK_DISPLAY_NAMES: Record<string, string> = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  pinnacle: 'Pinnacle',
  espnbet: 'ESPNBet',
  caesars: 'Caesars',
  pointsbetus: 'PointsBet',
  circa: 'Circa',
  bookmaker: 'Bookmaker',
  heritage: 'Heritage',
  betrivers: 'BetRivers',
  unibet: 'Unibet',
  wynnbet: 'WynnBET',
  superbook: 'SuperBook',
  hardrock: 'Hard Rock',
  fanatics: 'Fanatics',
};

function displayBookName(raw: string): string {
  return BOOK_DISPLAY_NAMES[raw.toLowerCase()] || raw;
}
function toBookLine(snap: OddsSnapshot): BookLine {
  return {
    book: displayBookName(snap.bookmaker),
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
      opening: { time: '', books: [], consensusSpread: 0, consensusTotal: 0, consensusMlHome: 0, consensusMlAway: 0 },
      current: { time: '', books: [], consensusSpread: 0, consensusTotal: 0, consensusMlHome: 0, consensusMlAway: 0 },
      spreadMovement: 0, totalMovement: 0, spreadDirection: 'stable', totalDirection: 'stable',
      mlHomeMovement: 0, mlAwayMovement: 0, mlDirection: 'stable',
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

  const books = [...new Set(sorted.map((s) => displayBookName(s.bookmaker)))];
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
  const openingConsensusSpread = mode(openingSpreads.map((b) => b.spread));
  const openingConsensusTotal = mode(openingTotals.map((b) => b.total));
  const openingMlHomes = openingBooks.filter((b) => b.mlHome !== 0 && b.mlHome != null);
  const openingMlAways = openingBooks.filter((b) => b.mlAway !== 0 && b.mlAway != null);
  const openingConsensusMlHome = openingMlHomes.length ? mode(openingMlHomes.map((b) => b.mlHome)) : 0;
  const openingConsensusMlAway = openingMlAways.length ? mode(openingMlAways.map((b) => b.mlAway)) : 0;

  const currentByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    currentByBook[s.bookmaker] = s;
  }
  const currentBooks = Object.values(currentByBook).map(toBookLine);
  const currentSpreadsValid = currentBooks.filter((b) => b.spread !== 0);
  const currentTotalsValid = currentBooks.filter((b) => b.total !== 0);
  const currentConsensusSpread = mode(currentSpreadsValid.map((b) => b.spread));
  const currentConsensusTotal = mode(currentTotalsValid.map((b) => b.total));
  const currentMlHomes = currentBooks.filter((b) => b.mlHome !== 0 && b.mlHome != null);
  const currentMlAways = currentBooks.filter((b) => b.mlAway !== 0 && b.mlAway != null);
  const currentConsensusMlHome = currentMlHomes.length ? mode(currentMlHomes.map((b) => b.mlHome)) : 0;
  const currentConsensusMlAway = currentMlAways.length ? mode(currentMlAways.map((b) => b.mlAway)) : 0;

  const spreadMovement = currentConsensusSpread - openingConsensusSpread;
  const totalMovement = currentConsensusTotal - openingConsensusTotal;

  // Moneyline movement (critical for MLB signal detection)
  const mlHomeMovement = (openingConsensusMlHome !== 0 && currentConsensusMlHome !== 0)
    ? currentConsensusMlHome - openingConsensusMlHome : 0;
  const mlAwayMovement = (openingConsensusMlAway !== 0 && currentConsensusMlAway !== 0)
    ? currentConsensusMlAway - openingConsensusMlAway : 0;

  // ML direction: if home ML gets more negative, home is being bet (favorite strengthening)
  // If away ML gets less positive, away is being bet (underdog shortening)
  const mlDirection =
    (Math.abs(mlHomeMovement) < 3 && Math.abs(mlAwayMovement) < 3) ? 'stable'
      : mlHomeMovement < 0 ? 'toward home favorite (ML shortening)'
        : mlHomeMovement > 0 ? 'toward away / home underdog (home ML drifting)'
          : 'stable';

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
      consensusSpread: mode(validSpreads.map((b) => b.spread)),
      consensusTotal: mode(validTotals.map((b) => b.total)),
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
      // NHL puck-line state flip: don't describe as numeric point move
      const prevSpread = timeline[i - 1].consensusSpread;
      const currSpread = timeline[i].consensusSpread;
      const isNhlPucklineFlip = league === 'NHL' && (
        (prevSpread === -1.5 && currSpread === 1.5) ||
        (prevSpread === 1.5 && currSpread === -1.5) ||
        (prevSpread === -1.5 && currSpread === -1.5) === false // type guard
      ) && Math.abs(prevSpread) === 1.5 && Math.abs(currSpread) === 1.5 && prevSpread !== currSpread;
      if (isNhlPucklineFlip) {
        steamDetail = `Puck-line state flip (${prevSpread} → ${currSpread}) in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      } else {
        steamDetail = `${diff}-point move in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      }
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
  const highestTotalSeen = timelineTotals.length ? Math.max(...timelineTotals) : openingConsensusTotal;
  const lowestTotalSeen = timelineTotals.length ? Math.min(...timelineTotals) : openingConsensusTotal;

  const currentTotalsArr = currentBooks.map((b) => b.total).filter((t) => t > 0);
  const totalBookDisagreement = currentTotalsArr.length > 1 ? round1(Math.max(...currentTotalsArr) - Math.min(...currentTotalsArr)) : 0;

  // Anomaly detection: flag suspiciously wide total ranges (possible data contamination)
  const totalRange = highestTotalSeen - lowestTotalSeen;
  if (totalRange > 15 && highestTotalSeen > 0 && lowestTotalSeen > 0) {
    console.warn(`[HSA ANOMALY] Total range ${totalRange}pts (${lowestTotalSeen}–${highestTotalSeen}) — possible market contamination`);
  }

  return {
    snapshotCount: snapshots.length, trackingHours, books,
    opening: { time: firstTime, books: openingBooks, consensusSpread: openingConsensusSpread, consensusTotal: openingConsensusTotal, consensusMlHome: openingConsensusMlHome, consensusMlAway: openingConsensusMlAway },
    current: { time: lastTime, books: currentBooks, consensusSpread: currentConsensusSpread, consensusTotal: currentConsensusTotal, consensusMlHome: currentConsensusMlHome, consensusMlAway: currentConsensusMlAway },
    spreadMovement, totalMovement, spreadDirection, totalDirection, mlHomeMovement, mlAwayMovement, mlDirection, velocityPerHour, maxBookDisagreement, timeline,
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

    const openLine = val(open);
    const currentLine = val(curr);

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
      const snapVal = val(snap);
      if (snapVal !== 0 && snapVal !== openLine) {
        firstMoveAt = snap.fetched_at;
        break;
      }
    }

    details.push({
      book: displayBookName(book),
      openLine,
      currentLine,
      move: currentLine - openLine,
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

  // Move path: use MODE of mover lines (real book lines, never averaged)
  const modeOpen = mode(movedBooks.map(b => b.openLine));
  const modeCurr = mode(movedBooks.map(b => b.currentLine));
  const movePath = `${modeOpen} → ${modeCurr}`;

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
  if (!coord || (coord.movedBooks.length === 0 && coord.heldBooks.length === 0)) {
    return `${label} COORDINATION: No coordination data available. Use per-book lines from PER-BOOK OPENING → CURRENT LINES section above.`;
  }
  if (coord.movedBooks.length === 0 && coord.heldBooks.length > 0) {
    const heldDetails = coord.heldBooks.map(b => `${b.book} at ${b.currentLine}`).join(', ');
    const heldNames = formatNameList(coord.heldBooks.map(b => b.book));
    const lines: string[] = [`${label} COORDINATION:`];
    lines.push(`  All ${coord.totalBooks} books held their opening ${label.toLowerCase()} lines.`);
    lines.push(`  Per-book detail: ${heldDetails}`);
    lines.push('');
    lines.push(`  >>> MANDATORY SENTENCE FOR ${label} (copy this verbatim into your ${label === 'TOTALS' ? 'section 7 Totals Intel' : 'section 2 Book Behavior'} output): <<<`);
    lines.push(`  "All tracked books held their ${label.toLowerCase()}: ${heldDetails}."`);
    return lines.join('\n');
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
  lines.push('  Per-book move detail:');
  for (const b of coord.movedBooks) {
    lines.push(`    ${b.book}: ${b.openLine} → ${b.currentLine} (${b.move > 0 ? '+' : ''}${b.move}) [MOVED]`);
  }
  for (const b of coord.heldBooks) {
    const moveLabel = b.move === 0 ? 'unchanged' : `${b.move > 0 ? '+' : ''}${b.move}, against consensus`;
    lines.push(`    ${b.book}: ${b.openLine} → ${b.currentLine} (${moveLabel}) [HELD]`);
  }

  // Pre-rendered sentence the LLM MUST include verbatim
  lines.push('');
  lines.push(`  >>> MANDATORY SENTENCE FOR ${label} (copy this verbatim into your ${label === 'TOTALS' ? 'section 7 Totals Intel' : label === 'SPREAD' ? 'section 2 Book Behavior' : 'section 2 Book Behavior'} output): <<<`);
  lines.push(`  "${renderPrewrittenSentence(coord)}"`);

  return lines.join('\n');
}

/** Pre-render a complete sentence the LLM must paste verbatim. */
function renderPrewrittenSentence(coord: MarketCoordination): string {
  const movedNames = formatNameList(coord.movedBooks.map(b => b.book));
  const ratio = `${coord.movedBooks.length}/${coord.totalBooks}`;
  const windowStr = coord.timeWindowMinutes < 1 ? 'within the same polling window' : `within ${coord.timeWindowMinutes} minutes`;

  let sentence = `${movedNames} moved the ${coord.direction.toLowerCase().includes('over') || coord.direction.toLowerCase().includes('under') ? 'total' : 'line'} ${coord.movePath} (${ratio}-book move ${windowStr})`;

  if (coord.heldBooks.length > 0) {
    const heldNames = formatNameList(coord.heldBooks.map(b => b.book));
    const heldLines = coord.heldBooks.map(b => `${b.currentLine}`);
    sentence += `, while ${heldNames} held at ${heldLines.join('/')}`;
  }
  sentence += '.';

  if (coord.leadBook && coord.followBooks.length > 0) {
    sentence += ` ${coord.leadBook} led the move; ${formatNameList(coord.followBooks)} followed.`;
  }

  return sentence;
}

/** Format ["A", "B", "C"] as "A, B, and C" */
function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Post-process LLM output to inject pre-rendered book attribution sentences.
 * The LLM consistently refuses to name sportsbooks, so we inject the detail
 * directly after each section header regardless of what the LLM wrote.
 */
function postProcessBookNames(
  text: string,
  totalCoord: MarketCoordination | null,
  spreadCoord: MarketCoordination | null,
  summary: OddsSummary,
): string {
  let result = text;

  // Build book detail sentences
  const totalSentence = buildBookSentence(totalCoord, summary, 'total');
  const spreadSentence = buildBookSentence(spreadCoord, summary, 'spread');
  console.log(`[HSA POST-PROCESS] totalSentence: ${totalSentence ?? 'NULL'}`);
  console.log(`[HSA POST-PROCESS] spreadSentence: ${spreadSentence ?? 'NULL'}`);
  console.log(`[HSA POST-PROCESS] summary.current.books count: ${summary.current.books.length}, totals: ${summary.current.books.map(b => `${b.book}=${b.total}`).join(', ')}`);
  console.log(`[HSA POST-PROCESS] summary.opening.books count: ${summary.opening.books.length}, totals: ${summary.opening.books.map(b => `${b.book}=${b.total}`).join(', ')}`);
  // Log a snippet around "7." in the raw output to debug header matching
  const idx7 = result.indexOf('7.');
  if (idx7 >= 0) {
    console.log(`[HSA POST-PROCESS] Raw text near "7.": "${result.substring(idx7, idx7 + 60).replace(/\n/g, '\\n')}"`);
  } else {
    console.log('[HSA POST-PROCESS] WARNING: No "7." found in LLM output at all');
  }

  // Helper: inject sentence right after a section header
  // Handles both "7. Totals Intel\nText..." and "7. Totals Intel Text..." formats
  function injectAfterHeader(text: string, headerPattern: RegExp, sentence: string): string {
    return text.replace(headerPattern, (match) => {
      return `${match}\nBook detail: ${sentence}`;
    });
  }

  // SECONDARY MARKETS — inject total book details
  if (totalSentence) {
    const before = result;
    result = injectAfterHeader(result, /SECONDARY MARKETS/i, totalSentence);
    if (result === before) {
      // Fallback: try old format headers
      result = injectAfterHeader(result, /\*{0,2}7\.\s*Totals?\s*Intel\*{0,2}/i, totalSentence);
      if (result === before) {
        // Last resort: append before disclaimer
        const disclaimerIdx = result.indexOf('Disclaimer:');
        if (disclaimerIdx > 0) {
          result = result.slice(0, disclaimerIdx) + `\nBook detail for totals: ${totalSentence}\n\n` + result.slice(disclaimerIdx);
        }
      }
    }
  }

  // BOOK INTEL — inject spread book details
  if (spreadSentence) {
    const before = result;
    result = injectAfterHeader(result, /BOOK INTEL/i, spreadSentence);
    if (result === before) {
      // Fallback: try old format
      result = injectAfterHeader(result, /\*{0,2}2\.\s*Book Behavior\*{0,2}/i, spreadSentence);
    }
  }

  // PRIMARY SIGNAL — inject spread book details
  if (spreadSentence) {
    const before = result;
    result = injectAfterHeader(result, /PRIMARY SIGNAL/i, spreadSentence);
    if (result === before) {
      result = injectAfterHeader(result, /\*{0,2}1\.\s*Line Movement\*{0,2}/i, spreadSentence);
    }
  }

  return result;
}

/** Build a book attribution sentence from coordination data or raw summary fallback. */
function buildBookSentence(
  coord: MarketCoordination | null,
  summary: OddsSummary,
  market: 'total' | 'spread',
): string | null {
  // If coordination computed successfully with movers, use renderPrewrittenSentence
  if (coord && coord.movedBooks.length > 0) {
    return renderPrewrittenSentence(coord);
  }
  // If coordination exists but all books held, generate a held sentence
  if (coord && coord.heldBooks.length > 0) {
    const heldDetails = coord.heldBooks.map(b => `${b.book} at ${b.currentLine}`).join(', ');
    return `All tracked books held their ${market === 'total' ? 'totals' : 'spreads'}: ${heldDetails}.`;
  }

  // Fallback: build from raw summary data
  const books = summary.current.books;
  if (books.length === 0) return null;

  if (market === 'total') {
    console.log(`[HSA buildBookSentence] total market — ${books.length} books, totals: ${books.map(b => `${b.book}=${b.total}`).join(', ')}`);
    console.log(`[HSA buildBookSentence] consensusTotal: current=${summary.current.consensusTotal}, opening=${summary.opening.consensusTotal}, bookNames=${summary.books.join(',')}`);
    const movers: string[] = [];
    const holders: string[] = [];
    const currentPositions: string[] = [];
    for (const b of books) {
      if (b.total <= 0) continue;
      currentPositions.push(`${b.book} at ${b.total}`);
      const ob = summary.opening.books.find(o => o.book === b.book);
      if (!ob || ob.total <= 0) continue;
      if (ob.total !== b.total) {
        movers.push(`${b.book}: ${ob.total} → ${b.total}`);
      } else {
        holders.push(`${b.book} held at ${b.total}`);
      }
    }
    // If we have movement data, use it
    if (movers.length > 0 || holders.length > 0) {
      if (movers.length === 0) {
        return `All books held their totals: ${holders.join(', ')}.`;
      }
      return [...movers, ...holders].join(', ') + '.';
    }
    // Fallback: just list current positions
    if (currentPositions.length > 0) {
      return `Current totals: ${currentPositions.join(', ')}.`;
    }
    // Ultimate fallback: use consensus total with book names
    if (summary.current.consensusTotal > 0 && summary.books.length > 0) {
      return `Current consensus total ${summary.current.consensusTotal} across ${formatNameList(summary.books)}${summary.opening.consensusTotal > 0 ? ` (opened at ${summary.opening.consensusTotal})` : ''}.`;
    }
    return null;
  }

  // spread
  const movers: string[] = [];
  const holders: string[] = [];
  const currentPositions: string[] = [];
  for (const b of books) {
    if (b.spread === 0) continue;
    currentPositions.push(`${b.book} at ${b.spread}`);
    const ob = summary.opening.books.find(o => o.book === b.book);
    if (!ob || ob.spread === 0) continue;
    if (ob.spread !== b.spread) {
      movers.push(`${b.book}: ${ob.spread} → ${b.spread}`);
    } else {
      holders.push(`${b.book} held at ${b.spread}`);
    }
  }
  if (movers.length > 0 || holders.length > 0) {
    if (movers.length === 0) {
      return `All books held their spreads: ${holders.join(', ')}.`;
    }
    return [...movers, ...holders].join(', ') + '.';
  }
  if (currentPositions.length > 0) {
    return `Current spreads: ${currentPositions.join(', ')}.`;
  }
  return null;
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
  const isMLB = league === 'MLB';

  const timelineStr = summary.timeline
    .map((t) => `${t.label}: spread ${t.consensusSpread} | total ${t.consensusTotal} [${t.books.map((b) => `${b.book}: spr=${b.spread}/tot=${b.total}/ML=${b.mlHome}/${b.mlAway}`).join(', ')}]`)
    .join('\n');

  const currentBooksStr = summary.current.books
    .map((b) => `${b.book}: ML ${b.mlHome}/${b.mlAway} | spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice})`)
    .join('\n');

  const openingBooksStr = summary.opening.books
    .map((b) => `${b.book}: ML ${b.mlHome}/${b.mlAway} | spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice})`)
    .join('\n');

  // For MLB, determine favorite by moneyline (not spread, which is always ±1.5)
  const homeFavored = isMLB
    ? (summary.current.consensusMlHome < 0 && summary.current.consensusMlHome < summary.current.consensusMlAway)
    : summary.current.consensusSpread < 0;
  const favoriteTeam = homeFavored ? homeTeam : awayTeam;
  const underdogTeam = homeFavored ? awayTeam : homeTeam;
  const currentAbsSpread = Math.abs(summary.current.consensusSpread);

  // MLB moneyline per-book movement detail
  let mlbMoneylineSection = '';
  if (isMLB) {
    const mlPerBook: string[] = [];
    for (const cb of summary.current.books) {
      const ob = summary.opening.books.find(o => o.book === cb.book);
      if (!ob) continue;
      const homeMove = cb.mlHome - ob.mlHome;
      const awayMove = cb.mlAway - ob.mlAway;
      const moved = Math.abs(homeMove) >= 3 || Math.abs(awayMove) >= 3;
      mlPerBook.push(`  ${cb.book}: ${homeTeam} ML ${ob.mlHome} → ${cb.mlHome} (${homeMove >= 0 ? '+' : ''}${homeMove}) | ${awayTeam} ML ${ob.mlAway} → ${cb.mlAway} (${awayMove >= 0 ? '+' : ''}${awayMove}) ${moved ? '[MOVED]' : '[HELD]'}`);
    }
    mlbMoneylineSection = `
=== MLB MONEYLINE DETAIL (PRIMARY SIGNAL MARKET) ===
IMPORTANT: In MLB, the moneyline is the primary signal market, NOT the run line.
The run line (±1.5) rarely moves in MLB — moneyline movement IS the signal.
If moneyline moved but run line did not, the market DID move. Do NOT say "static board."

Opening ML consensus: ${homeTeam} ${summary.opening.consensusMlHome} / ${awayTeam} ${summary.opening.consensusMlAway}
Current ML consensus: ${homeTeam} ${summary.current.consensusMlHome} / ${awayTeam} ${summary.current.consensusMlAway}
ML movement: ${homeTeam} ${summary.mlHomeMovement >= 0 ? '+' : ''}${summary.mlHomeMovement} | ${awayTeam} ${summary.mlAwayMovement >= 0 ? '+' : ''}${summary.mlAwayMovement} (${summary.mlDirection})

PER-BOOK MONEYLINE MOVEMENT:
${mlPerBook.join('\n')}
`;
  }

  // MLB-specific market priority instruction
  const marketPriorityNote = isMLB
    ? `\nMLB MARKET PRIORITY: Evaluate markets in this order: 1) Moneyline 2) Total 3) Run line.
The run line in MLB is almost always ±1.5 and rarely moves. Do NOT anchor your analysis on the run line.
If moneyline shows meaningful movement (≥5 cents) and run line is flat, the market HAS moved.
A 15-cent ML move (e.g. +115 → +100) is significant. A flat run line does not negate ML movement.
SPREAD CONVENTION: In MLB, "spread" = run line (±1.5). All values from ${homeTeam} (HOME) perspective.\n`
    : `\nSPREAD CONVENTION: All spreads are from ${homeTeam} (HOME) perspective. Negative = ${homeTeam} favored.\n`;

  return `Analyze this game's market behavior and return the HSA structured analysis.

GAME: ${awayTeam} @ ${homeTeam}
LEAGUE: ${league}
GAME TIME: ${gameTime}
${marketPriorityNote}
CURRENT MARKET: ${favoriteTeam} favored${isMLB ? ` (ML ${homeFavored ? summary.current.consensusMlHome : summary.current.consensusMlAway})` : ` by ${currentAbsSpread}`}. ${underdogTeam} is the underdog${isMLB ? ` (ML ${homeFavored ? summary.current.consensusMlAway : summary.current.consensusMlHome})` : ` at +${currentAbsSpread}`}.
${mlbMoneylineSection}
=== MARKET DATA ===
Tracking: ${summary.snapshotCount} snapshots over ${summary.trackingHours} hours
Books: ${summary.books.join(', ')}

OPENING LINES:
${openingBooksStr}
Consensus: spread ${summary.opening.consensusSpread} | total ${summary.opening.consensusTotal} | ML ${summary.opening.consensusMlHome}/${summary.opening.consensusMlAway}

CURRENT LINES:
${currentBooksStr}
Consensus: spread ${summary.current.consensusSpread} | total ${summary.current.consensusTotal} | ML ${summary.current.consensusMlHome}/${summary.current.consensusMlAway}

MOVEMENT:
${isMLB ? `Moneyline: ${homeTeam} ${summary.mlHomeMovement >= 0 ? '+' : ''}${summary.mlHomeMovement} / ${awayTeam} ${summary.mlAwayMovement >= 0 ? '+' : ''}${summary.mlAwayMovement} (${summary.mlDirection})
` : ''}Spread: ${summary.spreadMovement > 0 ? '+' : ''}${summary.spreadMovement} (${summary.spreadDirection})
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

  const { league, home_team, away_team, game_time, force, mode: refreshMode } = req.body || {};
  // mode: 'rerender' = same snapshot, same confidence. 'refresh' = latest odds, new analysis.
  // force=true without mode defaults to 'refresh' for backward compat.
  const analysisMode: 'cache' | 'rerender' | 'refresh' = refreshMode === 'rerender' ? 'rerender'
    : (force || refreshMode === 'refresh') ? 'refresh' : 'cache';

  if (!league || !home_team || !away_team || !game_time) {
    return res.status(400).json({
      error: 'Missing required fields: league, home_team, away_team, game_time',
    });
  }

  try {
    // ── Snapshot-pinned analysis: three modes ──────────────────────
    // cache:    return existing if <30 min old and lines haven't moved
    // rerender: return existing analysis for SAME snapshot (deterministic)
    // refresh:  generate new analysis from latest odds (may change confidence)

    const gameId = `${league}|${home_team}|${away_team}`;

    // Fetch the latest analysis for this game
    const { data: existing } = await supabase
      .from('claude_analyses')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(1);

    // MODE: rerender — return the exact same analysis (same snapshot, same confidence)
    // This is what "Refresh Analysis" should do — NO new generation, NO new odds fetch
    if (analysisMode === 'rerender' && existing?.length && existing[0].analysis) {
      return res.status(200).json({
        narrative: existing[0].analysis,
        cached: true,
        rerender: true,
        snapshot_id: existing[0].snapshot_id ?? null,
        confidence: existing[0].confidence_label ?? 'Low',
        status_tag: existing[0].status_tag ?? 'WATCH',
        market_lean: existing[0].market_lean ?? 'PASS',
        created_at: existing[0].created_at,
      });
    }

    // MODE: cache — return existing if fresh enough
    if (analysisMode === 'cache' && existing?.length && existing[0].analysis) {
      const age = Date.now() - new Date(existing[0].created_at).getTime();
      const thirtyMin = 30 * 60 * 1000;
      if (age < thirtyMin) {
        return res.status(200).json({
          narrative: existing[0].analysis,
          cached: true,
          snapshot_id: existing[0].snapshot_id ?? null,
          confidence: existing[0].confidence_label ?? 'Low',
          status_tag: existing[0].status_tag ?? 'WATCH',
          market_lean: existing[0].market_lean ?? 'PASS',
          created_at: existing[0].created_at,
        });
      }
    }

    // MODE: refresh (or cache miss) — generate new analysis from current odds
    // Fall through to the full generation pipeline below

    // Note: removed force-refresh odds fetch. The cron runs every 10 min
    // so data is always fresh. Fetching here was causing the dashboard to
    // change (new rows inserted for all games) every time HSA was generated.

    // Fetch odds snapshots scoped to this specific game
    // Filter by league + game_time window to prevent cross-game contamination
    //
    // Use a wide window (7 days before game_time) to capture true openers.
    // The old 24h window missed openers for games whose lines posted days ahead,
    // causing HSA to see "no movement" while the dashboard showed real movement.
    //
    // IMPORTANT: Supabase default limit is 1000 rows. With 5+ books polling
    // every 10 min, that can be exceeded. We order descending (newest first)
    // and limit to 1000 to guarantee current lines are included.
    const gameTimeDate = new Date(game_time);
    const windowStart = new Date(gameTimeDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(gameTimeDate.getTime() + 4 * 60 * 60 * 1000).toISOString();

    // Retry Supabase query up to 3 times (handles transient timeouts/connection issues)
    let oddsDesc: any[] | null = null;
    let oddsError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await supabase
        .from('odds_snapshots')
        .select('bookmaker,spread,spread_home_price,moneyline_home,moneyline_away,total,total_over_price,fetched_at,league,game_time,home_team,away_team,book_type')
        .eq('league', league)
        .eq('home_team', home_team)
        .eq('away_team', away_team)
        .gte('game_time', windowStart)
        .lte('game_time', windowEnd)
        .order('fetched_at', { ascending: false })
        .limit(1000);

      if (!result.error) {
        oddsDesc = result.data;
        oddsError = null;
        break;
      }

      oddsError = result.error;
      console.error(`[HSA] Supabase odds query attempt ${attempt + 1} failed:`, {
        message: oddsError.message,
        code: oddsError.code,
        hint: oddsError.hint,
        details: oddsError.details,
        league, home_team, away_team, game_time,
      });

      if (attempt < 2) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
      }
    }

    // Reverse to ascending for summarizer (it expects chronological order)
    const odds = oddsDesc ? [...oddsDesc].reverse() : null;

    if (oddsError) {
      console.error('[HSA] Supabase odds query error:', JSON.stringify(oddsError));
      return res.status(500).json({
        error: `Failed to fetch odds: ${oddsError.message || oddsError.code || 'unknown error'}`,
        detail: oddsError.message,
        code: oddsError.code,
        hint: oddsError.hint,
        query_params: { league, home_team, away_team, game_time, windowStart, windowEnd },
      });
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
        // Use the normalized spread from classification (handles MLB ±1.5 normalization)
        spread: (spreadClassified && spreadClassified.usable) ? (spreadClassified.line ?? raw.spread) : 0,
        spread_home_price: (spreadClassified && spreadClassified.usable) ? raw.spread_home_price : 0,
      };
    });

    if (!cleanSnapshots.length) {
      return res.status(404).json({ error: 'No usable odds data after market classification' });
    }

    // Preprocess clean odds into structured summary
    const summary = summarizeOdds(cleanSnapshots, game_time, league);

    // Compute deterministic snapshot ID from current book lines
    // Same set of per-book lines → same ID → deterministic analysis
    const snapshotId = computeSnapshotId(cleanSnapshots, league, home_team, away_team);
    const snapshotTime = new Date().toISOString();

    // Check if we already have an analysis for this exact snapshot
    if (analysisMode !== 'refresh') {
      const { data: existingForSnapshot } = await supabase
        .from('claude_analyses')
        .select('*')
        .eq('game_id', gameId)
        .eq('snapshot_id', snapshotId)
        .limit(1);

      if (existingForSnapshot?.length && existingForSnapshot[0].analysis) {
        console.log(`[HSA] Returning existing analysis for snapshot ${snapshotId}`);
        return res.status(200).json({
          narrative: existingForSnapshot[0].analysis,
          cached: true,
          snapshot_id: snapshotId,
          confidence: existingForSnapshot[0].confidence_label ?? 'Low',
          status_tag: existingForSnapshot[0].status_tag ?? 'WATCH',
          market_lean: existingForSnapshot[0].market_lean ?? 'PASS',
          created_at: existingForSnapshot[0].created_at,
        });
      }
    }

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
    rawBookLines.push('PER-BOOK OPENING → CURRENT LINES:');
    for (const b of summary.current.books) {
      const openBook = summary.opening.books.find(ob => ob.book === b.book);
      const totalOpen = openBook?.total ?? 0;
      const totalCurr = b.total;
      const totalMoved = totalOpen > 0 && totalCurr > 0 && totalOpen !== totalCurr;
      const spreadOpen = openBook?.spread ?? 0;
      const spreadCurr = b.spread;
      const spreadMoved = spreadOpen !== 0 && spreadCurr !== 0 && spreadOpen !== spreadCurr;
      rawBookLines.push(`  ${b.book}: spread ${spreadOpen} → ${spreadCurr}${spreadMoved ? ' [MOVED]' : ' [HELD]'} | total ${totalOpen} → ${totalCurr}${totalMoved ? ' [MOVED]' : ' [HELD]'} | ML ${openBook?.mlHome ?? '?'} → ${b.mlHome}`);
    }

    // Generate fallback mandatory sentences from raw summary data if coordination returned null
    if (!totalCoord && summary.current.books.length > 0) {
      const totalMovers = summary.current.books.filter(b => {
        const ob = summary.opening.books.find(o => o.book === b.book);
        return ob && ob.total > 0 && b.total > 0 && ob.total !== b.total;
      });
      const totalHolders = summary.current.books.filter(b => {
        const ob = summary.opening.books.find(o => o.book === b.book);
        return ob && ob.total > 0 && b.total > 0 && ob.total === b.total;
      });
      rawBookLines.push('');
      rawBookLines.push(`  >>> FALLBACK MANDATORY SENTENCE FOR TOTALS (copy verbatim into section 7): <<<`);
      if (totalMovers.length > 0) {
        const moverNames = formatNameList(totalMovers.map(b => b.book));
        const holderPart = totalHolders.length > 0
          ? `, while ${formatNameList(totalHolders.map(b => b.book))} held at ${totalHolders[0]?.total}`
          : '';
        const sampleOpen = summary.opening.books.find(o => o.book === totalMovers[0].book)?.total ?? '?';
        rawBookLines.push(`  "${moverNames} moved the total from ${sampleOpen} to ${totalMovers[0].total} (${totalMovers.length}/${summary.current.books.length}-book move)${holderPart}."`);
      } else if (totalHolders.length > 0) {
        // All books held — still need to name them
        const holderDetails = totalHolders.map(b => `${b.book} at ${b.total}`).join(', ');
        rawBookLines.push(`  "All tracked books held their totals: ${holderDetails}."`);
      } else {
        // Books exist but totals are 0 — use book names with consensus
        const bookNames = formatNameList(summary.books);
        rawBookLines.push(`  "Current totals consensus at ${summary.current.consensusTotal} across ${bookNames} (opened at ${summary.opening.consensusTotal})."`);
      }
    }
    if (!spreadCoord && summary.current.books.length > 0) {
      const spreadMovers = summary.current.books.filter(b => {
        const ob = summary.opening.books.find(o => o.book === b.book);
        return ob && ob.spread !== 0 && b.spread !== 0 && ob.spread !== b.spread;
      });
      const spreadHolders = summary.current.books.filter(b => {
        const ob = summary.opening.books.find(o => o.book === b.book);
        return ob && ob.spread !== 0 && b.spread !== 0 && ob.spread === b.spread;
      });
      if (spreadMovers.length > 0) {
        const moverNames = formatNameList(spreadMovers.map(b => b.book));
        const holderPart = spreadHolders.length > 0
          ? `, while ${formatNameList(spreadHolders.map(b => b.book))} held at ${spreadHolders[0]?.spread}`
          : '';
        const sampleOpen = summary.opening.books.find(o => o.book === spreadMovers[0].book)?.spread ?? '?';
        rawBookLines.push('');
        rawBookLines.push(`  >>> FALLBACK MANDATORY SENTENCE FOR SPREAD (copy verbatim into section 1): <<<`);
        rawBookLines.push(`  "${moverNames} moved the spread from ${sampleOpen} to ${spreadMovers[0].spread} (${spreadMovers.length}/${summary.current.books.length}-book move)${holderPart}."`);
      }
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

    // ── NHL Signal Classification ─────────────────────────────────────
    // For NHL games, run the NHL-specific classifier to prevent
    // puck-line state flips from being described as "3-point steam moves"
    // and to enforce proper coordination thresholds.
    let nhlClassificationBlock = '';
    if (league === 'NHL') {
      try {
        const {
          getNhlSignalType,
          getNhlTotalsSignalType,
          buildNhlClassificationBlock,
          isPucklineStateFlip,
        } = await import('./lib/nhl-signal-classifier');

        // Determine ML direction
        const mlOpenHome = summary.opening.books.length > 0
          ? mode(summary.opening.books.map(b => b.mlHome).filter(v => v !== 0))
          : 0;
        const mlCurrHome = summary.current.books.length > 0
          ? mode(summary.current.books.map(b => b.mlHome).filter(v => v !== 0))
          : 0;
        const mlDelta = (mlCurrHome ?? 0) - (mlOpenHome ?? 0);
        const mlDir = mlDelta > 5 ? 'toward_away' as const :
                      mlDelta < -5 ? 'toward_home' as const : 'none' as const;

        // Determine persistence from lifecycle data
        const spreadLifecycle = lifecycle.spread;
        const movePersistedSnapshots = spreadLifecycle
          ? (spreadLifecycle.has_held_post_move ? 3 : (spreadLifecycle.current_state.holding_near_level ? 2 : 1))
          : 1;
        const hasSnappedBack = spreadLifecycle
          ? (spreadLifecycle.has_retraced && spreadLifecycle.percent_of_primary_move_retraced > 50)
          : false;

        // Compute fake steam inline (can't import from src/ in Vercel API routes)
        const currentSpreadLines = summary.current.books
          .map(b => b.spread)
          .filter(s => s !== 0);
        let fakeSteamTriggered = false;
        let fakeSteamScore = 0;
        if (currentSpreadLines.length >= 3) {
          const sortedLines = [...currentSpreadLines].sort((a, b) => a - b);
          const midIdx = Math.floor(sortedLines.length / 2);
          const medianVal = sortedLines.length % 2 === 0
            ? (sortedLines[midIdx - 1] + sortedLines[midIdx]) / 2
            : sortedLines[midIdx];
          const marketRange = sortedLines[sortedLines.length - 1] - sortedLines[0];
          const outlierCount = currentSpreadLines.filter(l => Math.abs(l - medianVal) >= 0.5).length;
          if (marketRange >= 1.0) fakeSteamScore++;
          if (marketRange >= 1.5) fakeSteamScore++;
          if (outlierCount <= 1) fakeSteamScore++;
          if (outlierCount === 1 && marketRange >= 1.0) fakeSteamScore++;
          if (outlierCount === 0 && marketRange >= 1.0) fakeSteamScore++;
          fakeSteamTriggered = fakeSteamScore >= 3;
        }

        const sideClassification = getNhlSignalType({
          league,
          homeTeam: home_team,
          awayTeam: away_team,
          openingSpread: summary.opening.consensusSpread,
          currentSpread: summary.current.consensusSpread,
          spreadBooksMovedCount: spreadCoord?.movedBooks.length ?? 0,
          spreadBooksHeldCount: spreadCoord?.heldBooks.length ?? 0,
          spreadBooksMoved: spreadCoord?.movedBooks.map(b => b.book) ?? [],
          spreadBooksHeld: spreadCoord?.heldBooks.map(b => b.book) ?? [],
          spreadMoveTimeWindowMinutes: spreadCoord?.timeWindowMinutes ?? 0,
          openingMlHome: mlOpenHome ?? 0,
          currentMlHome: mlCurrHome ?? 0,
          mlBooksMovedCount: mlCoord?.movedBooks.length ?? 0,
          mlDirection: mlDir,
          publicTicketPctHome: splitsData?.homeBetsPct ?? 50,
          publicMoneyPctHome: splitsData?.homeMoneyPct ?? 50,
          openingTotal: summary.opening.consensusTotal,
          currentTotal: summary.current.consensusTotal,
          totalBooksMovedCount: totalCoord?.movedBooks.length ?? 0,
          totalBooksHeldCount: totalCoord?.heldBooks.length ?? 0,
          totalBooksMoved: totalCoord?.movedBooks.map(b => b.book) ?? [],
          totalBooksHeld: totalCoord?.heldBooks.map(b => b.book) ?? [],
          movePersistedSnapshots,
          hasSnappedBack,
          fakeSteamTriggered,
          fakeSteamScore,
        });

        // Totals classification
        const totalsClassification = getNhlTotalsSignalType({
          openingTotal: summary.opening.consensusTotal,
          currentTotal: summary.current.consensusTotal,
          booksMovedCount: totalCoord?.movedBooks.length ?? 0,
          booksHeldCount: totalCoord?.heldBooks.length ?? 0,
          booksMoved: totalCoord?.movedBooks.map(b => b.book) ?? [],
          booksHeld: totalCoord?.heldBooks.map(b => b.book) ?? [],
        });

        nhlClassificationBlock = buildNhlClassificationBlock(sideClassification, totalsClassification);
        console.log(`[HSA NHL] Classification: ${sideClassification.signal_type} / ${sideClassification.confidence} / ${sideClassification.coordination_tier}`);
        console.log(`[HSA NHL] Puck-line state flip: ${sideClassification.puckline_state_flip}`);
        console.log(`[HSA NHL] Totals: ${totalsClassification.signal_type} / ${totalsClassification.confidence}`);

        // Override the steam description in summary if it's a puck-line state flip
        if (isPucklineStateFlip(summary.opening.consensusSpread, summary.current.consensusSpread)) {
          if (summary.sharpIndicators.steamMove && summary.sharpIndicators.steamDetail) {
            summary.sharpIndicators.steamDetail =
              `PUCKLINE STATE FLIP (not a numeric steam move) — ${summary.sharpIndicators.steamDetail?.replace(/\d+-point move/, 'state flip')}`;
          }
        }
      } catch (nhlErr: any) {
        console.error('[HSA] NHL classification failed (non-fatal):', nhlErr.message);
      }
    }

    // ── Pre-computed Market Lean Directive ─────────────────────────────
    // Build an explicit lean directive from the lifecycle engine so Claude
    // doesn't pair the wrong team with the wrong spread number.
    // Spreads are from HOME perspective — the lean label must correctly
    // pair the team name with THEIR spread (not the opponent's).
    let leanDirective = '';
    if (lifecycle.spread?.final_read.market_lean && lifecycle.spread.final_read.market_lean !== 'PASS') {
      const spreadLean = lifecycle.spread.final_read.market_lean;
      const totalLean = lifecycle.total?.final_read.market_lean ?? 'PASS';
      const spreadConf = lifecycle.spread.final_read.confidence;

      leanDirective = [
        '\n=== MARKET LEAN DIRECTIVE (USE VERBATIM) ===',
        'IMPORTANT: The market lean below was pre-computed from the lifecycle analysis.',
        'You MUST use this EXACT team name + number in your Market Lean field.',
        'Do NOT swap the team name or flip the spread sign.',
        '',
        `SPREAD LEAN: ${spreadLean}`,
        `SPREAD CONFIDENCE: ${spreadConf}`,
        totalLean !== 'PASS' ? `TOTAL LEAN: ${totalLean}` : '',
        '',
        'TEAM/SPREAD PAIRING RULE:',
        `  Home team (${home_team}) spread: ${summary.current.consensusSpread > 0 ? '+' : ''}${summary.current.consensusSpread}`,
        `  Away team (${away_team}) spread: ${-summary.current.consensusSpread > 0 ? '+' : ''}${-summary.current.consensusSpread}`,
        `  If you lean toward ${home_team}, write: "${home_team} ${summary.current.consensusSpread > 0 ? '+' : ''}${summary.current.consensusSpread}"`,
        `  If you lean toward ${away_team}, write: "${away_team} ${-summary.current.consensusSpread > 0 ? '+' : ''}${-summary.current.consensusSpread}"`,
        '  NEVER pair the away team name with the home spread number or vice versa.',
      ].filter(l => l !== '').join('\n');

      console.log(`[HSA LEAN DIRECTIVE] ${spreadLean} (${spreadConf})`);
    }

    // ── Pre-computed confidence directive ─────────────────────────
    // Uses the same logic as the dashboard's deriveSideConfidence / deriveTotalConfidence
    // so HSA output matches what the user sees on the dashboard.
    let confidenceDirective = '';
    {
      let sideConf: string | null = null;

      // MLB: use moneyline movement
      if (league === 'MLB') {
        const mlDelta = Math.abs(summary.mlHomeMovement);
        if (mlDelta >= 20) sideConf = 'High';
        else if (mlDelta >= 10) sideConf = 'Elevated';
        else if (mlDelta >= 5) sideConf = 'Moderate';
      }

      // Fallback: spread movement
      if (!sideConf && summary.spreadMovement != null) {
        const abs = Math.abs(summary.spreadMovement);
        if (abs >= 2) sideConf = 'High';
        else if (abs >= 1) sideConf = 'Elevated';
        else if (abs >= 0.5) sideConf = 'Moderate';
        else if (abs > 0) sideConf = 'Low';
      }

      // Moneyline movement for non-MLB
      if (!sideConf && league !== 'MLB' && summary.mlHomeMovement != null) {
        const mlDelta = Math.abs(summary.mlHomeMovement);
        if (mlDelta >= 20) sideConf = 'High';
        else if (mlDelta >= 10) sideConf = 'Elevated';
        else if (mlDelta >= 5) sideConf = 'Moderate';
      }

      // Total confidence
      let totalConf: string | null = null;
      if (summary.opening.consensusTotal > 0 && summary.current.consensusTotal > 0) {
        const totalMove = Math.abs(summary.totalMovement);
        if (totalMove >= 2) totalConf = 'High';
        else if (totalMove >= 1) totalConf = 'Moderate';
        else if (totalMove >= 0.5) totalConf = 'Low';
      }

      if (sideConf || totalConf) {
        confidenceDirective = [
          '\n=== CONFIDENCE DIRECTIVE (USE VERBATIM) ===',
          'IMPORTANT: The confidence levels below were pre-computed from the same data the dashboard uses.',
          'You MUST use this EXACT confidence level in your output header and Bottom Line.',
          '',
          sideConf ? `SIDE CONFIDENCE: ${sideConf}` : 'SIDE CONFIDENCE: Low',
          totalConf ? `TOTAL CONFIDENCE: ${totalConf}` : '',
          '',
          `Use "${sideConf || 'Low'}" as the Confidence value in the header line.`,
        ].filter(l => l !== '').join('\n');

        console.log(`[HSA CONFIDENCE DIRECTIVE] Side: ${sideConf || 'Low'}, Total: ${totalConf || 'N/A'}`);
      }
    }

    // ── MLB Truth Layer ────────────────────────────────────────────
    // For MLB games, build the canonical truth object and inject it
    // as the authoritative data source for the HSA writer.
    let mlbTruthBlock = '';
    let mlbTruth: import('./lib/mlb-truth-layer/types').MlbTruthObject | null = null;
    if (league === 'MLB') {
      try {
        const { buildMLBTruthObject, buildMLBHSAInput, buildBlockedOutput } = await import('./lib/mlb-truth-layer');
        mlbTruth = buildMLBTruthObject(
          cleanSnapshots as any,
          home_team, away_team, game_time,
          undefined, // pitchers — TODO: fetch from ESPN
          splitsData ? {
            home_ticket_pct: splitsData.homeBetsPct,
            away_ticket_pct: splitsData.awayBetsPct,
            home_money_pct: splitsData.homeMoneyPct,
            away_money_pct: splitsData.awayMoneyPct,
          } : undefined,
        );

        if (!mlbTruth.validation.is_valid) {
          console.error(`[HSA MLB] Truth validation failed:`, mlbTruth.validation.errors);
          return res.status(200).json({
            narrative: buildBlockedOutput(mlbTruth),
            cached: false,
            snapshot_count: summary.snapshotCount,
            tracking_hours: summary.trackingHours,
            status_tag: 'PASS',
            market_lean: 'PASS',
            confidence: 'Low',
            mlb_truth: mlbTruth,
          });
        }

        mlbTruthBlock = buildMLBHSAInput(mlbTruth);
        console.log(`[HSA MLB] Truth: regime=${mlbTruth.derived_truth.market_regime}, side=${mlbTruth.signal_summary.side.type}(${mlbTruth.signal_summary.side.confidence}), total=${mlbTruth.signal_summary.total.type}(${mlbTruth.signal_summary.total.confidence})`);
      } catch (err: any) {
        console.error('[HSA MLB] Truth layer failed (non-fatal):', err.message);
      }
    }

    // Build prompt and call Claude with system prompt
    const userMessage = buildHsaUserMessage(league, away_team, home_team, game_time, summary, splitsData, totalsSplitsData);

    // Append lifecycle context, coordination intel, lean directive, confidence directive, MLB truth, and NHL classification
    const fullMessage = userMessage + '\n\n' + lifecycleBlock + '\n\n' + coordBlock
      + (leanDirective ? '\n\n' + leanDirective : '')
      + (confidenceDirective ? '\n\n' + confidenceDirective : '')
      + (mlbTruthBlock ? '\n\n' + mlbTruthBlock : '')
      + (nhlClassificationBlock ? '\n\n' + nhlClassificationBlock : '');

    // Retry Anthropic API up to 2 times with exponential backoff
    let response: Anthropic.Messages.Message | null = null;
    let lastApiError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system: HSA_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: fullMessage }],
        });
        break; // success
      } catch (apiErr: any) {
        lastApiError = apiErr;
        console.error(`[HSA] Anthropic API attempt ${attempt + 1} failed: ${apiErr.message}`);
        // Don't retry on 4xx (auth, bad request, etc.)
        if (apiErr.status && apiErr.status >= 400 && apiErr.status < 500) break;
        if (attempt < 2) {
          const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (!response) {
      return res.status(502).json({
        error: 'Anthropic API failed after retries',
        detail: lastApiError?.message || 'Unknown error',
      });
    }

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!rawText) {
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

    // Post-process: inject book detail sentences after section headers
    let narrative: string;
    try {
      narrative = postProcessBookNames(rawText, totalCoord, spreadCoord, summary);
      if (narrative !== rawText) {
        console.log('[HSA POST-PROCESS] Injected book detail sentences');
        // Log a diff snippet to see what was added
        const diffChars = narrative.length - rawText.length;
        console.log(`[HSA POST-PROCESS] Added ${diffChars} chars. Contains "Book detail": ${narrative.includes('Book detail')}`);
      } else {
        console.log('[HSA POST-PROCESS] WARNING: No book details injected — section headers may not match expected patterns');
        console.log('[HSA POST-PROCESS] Raw text section headers:', rawText.match(/\d+\.\s*\w[\w\s]*/g)?.slice(0, 10));
      }
    } catch (e: any) {
      console.error('[HSA POST-PROCESS] ERROR in postProcessBookNames:', e.message);
      narrative = rawText; // fallback to raw text on error
    }

    // Extract status tag from output — try new header format first, then legacy
    const headerLineMatch = narrative.match(/\|\s*(PASS|WATCH|ACTIVE)\s*\|/);
    const legacyStatusMatch = narrative.match(/\b(PASS|WATCH|ACTIVE)\b/);
    const statusTag = headerLineMatch?.[1] || legacyStatusMatch?.[1] || 'WATCH';

    // Extract market lean — try new header format first: "| Market Lean | Confidence"
    const headerLeanMatch = narrative.match(/\|\s*(PASS|WATCH|ACTIVE)\s*\|\s*(.+?)\s*\|\s*(Low|Moderate|High)/i);
    const legacyLeanMatch = narrative.match(/Market Lean:\s*(.+)/i);
    let marketLean = headerLeanMatch?.[2]?.trim() || legacyLeanMatch?.[1]?.trim() || 'PASS';

    // ── Post-process: fix wrong team/spread pairing ───────────────────
    // Claude sometimes pairs the away team name with the home spread (+)
    // or vice versa. If the lifecycle engine computed a lean, use it as
    // the authoritative source to correct any team/spread mismatch.
    if (marketLean !== 'PASS' && lifecycle.spread?.final_read.market_lean &&
        lifecycle.spread.final_read.market_lean !== 'PASS') {
      const lifecycleLean = lifecycle.spread.final_read.market_lean;
      const homeSpread = summary.current.consensusSpread;

      // Check if Claude wrote the wrong team+number pairing
      // e.g. "Warriors +2.5" when Warriors are actually -2.5
      const awayWithHomeSpread = `${away_team} ${homeSpread > 0 ? '+' : ''}${homeSpread}`;
      const homeWithAwaySpread = `${home_team} ${-homeSpread > 0 ? '+' : ''}${-homeSpread}`;

      if (marketLean === awayWithHomeSpread || marketLean === homeWithAwaySpread) {
        console.log(`[HSA LEAN FIX] Claude wrote "${marketLean}" — wrong team/spread pairing. Using lifecycle lean: "${lifecycleLean}"`);
        marketLean = lifecycleLean;
        // Also fix in the narrative text
        if (leanMatch) {
          narrative = narrative.replace(
            /Market Lean:\s*.+/i,
            `Market Lean: ${lifecycleLean}`
          );
        }
      }
    }

    // Extract confidence — try new header format first, then legacy
    const headerConfMatch = headerLeanMatch?.[3];
    const legacyConfMatch = narrative.match(/Confidence:\s*(Low|Moderate|High)/i);
    const confidence = headerConfMatch || legacyConfMatch?.[1] || 'Low';

    // Compute totals data
    const totalsOpen = summary.opening.consensusTotal;
    const totalsCurrent = summary.current.consensusTotal;
    const totalsMove = totalsCurrent - totalsOpen;

    // ── MLB Post-write verification ──────────────────────────────
    // Compare written HSA against canonical truth object. Log violations.
    let mlbVerification: any = undefined;
    if (mlbTruth && league === 'MLB') {
      try {
        const { verifyGeneratedMLBHSA } = await import('./lib/mlb-truth-layer');
        const verification = verifyGeneratedMLBHSA(narrative, mlbTruth);
        mlbVerification = verification;
        if (!verification.passed) {
          console.error(`[HSA MLB VERIFY] VIOLATIONS:`, verification.violations);
        }
        if (verification.warnings.length > 0) {
          console.warn(`[HSA MLB VERIFY] Warnings:`, verification.warnings);
        }
      } catch (err: any) {
        console.error('[HSA MLB VERIFY] Verification failed:', err.message);
      }
    }

    // Store in claude_analyses with snapshot metadata
    // The trigger set_latest_analysis() marks previous rows as is_latest=false
    const { error: insertError } = await supabase.from('claude_analyses').insert({
      league,
      home_team,
      away_team,
      game_id: gameId,
      analysis: narrative,
      snapshot_id: snapshotId,
      snapshot_time: snapshotTime,
      confidence_label: confidence,
      status_tag: statusTag,
      market_lean: marketLean,
      signal_summary: mlbTruth
        ? { side: mlbTruth.signal_summary.side_signal, total: mlbTruth.signal_summary.total_signal }
        : lifecycle.spread?.final_read
          ? { spread: lifecycle.spread.final_read, total: lifecycle.total?.final_read ?? null }
          : null,
      is_latest: true,
    });

    if (insertError) {
      console.error('Insert error:', insertError.message);
    }

    // MLB debug: primary market selection and per-market deltas
    let mlbDebug: Record<string, unknown> | undefined;
    if (league === 'MLB') {
      const mlDelta = Math.abs(summary.mlHomeMovement);
      const totalDelta = Math.abs(summary.totalMovement);
      const rlDelta = Math.abs(summary.spreadMovement);

      let primaryMarket: string;
      let primaryReason: string;
      if (mlDelta >= 5) {
        primaryMarket = 'moneyline';
        primaryReason = `ML moved ${mlDelta} cents (≥5 threshold)`;
      } else if (totalDelta >= 0.5) {
        primaryMarket = 'total';
        primaryReason = `Total moved ${totalDelta} pts, ML only ${mlDelta} cents`;
      } else if (rlDelta >= 0.5) {
        primaryMarket = 'runline';
        primaryReason = `Run line moved ${rlDelta}, ML ${mlDelta}c, total ${totalDelta}`;
      } else {
        primaryMarket = 'none';
        primaryReason = `No meaningful movement: ML ${mlDelta}c, total ${totalDelta}, RL ${rlDelta}`;
      }

      mlbDebug = {
        primary_market_selected: primaryMarket,
        reason_primary_market_selected: primaryReason,
        ml_open_consensus: summary.opening.consensusMlHome,
        ml_current_consensus: summary.current.consensusMlHome,
        ml_delta: summary.mlHomeMovement,
        ml_away_open: summary.opening.consensusMlAway,
        ml_away_current: summary.current.consensusMlAway,
        ml_away_delta: summary.mlAwayMovement,
        total_open_consensus: summary.opening.consensusTotal,
        total_current_consensus: summary.current.consensusTotal,
        total_delta: summary.totalMovement,
        runline_open_consensus: summary.opening.consensusSpread,
        runline_current_consensus: summary.current.consensusSpread,
        runline_delta: summary.spreadMovement,
        per_book_ml: summary.current.books.map(b => {
          const ob = summary.opening.books.find(o => o.book === b.book);
          return {
            book: b.book,
            ml_home_open: ob?.mlHome ?? null,
            ml_home_current: b.mlHome,
            ml_home_delta: ob ? b.mlHome - ob.mlHome : null,
            ml_away_open: ob?.mlAway ?? null,
            ml_away_current: b.mlAway,
            ml_away_delta: ob ? b.mlAway - ob.mlAway : null,
          };
        }),
      };
      console.log(`[HSA MLB DEBUG] Primary market: ${primaryMarket} — ${primaryReason}`);
    }

    return res.status(200).json({
      narrative,
      cached: false,
      snapshot_id: snapshotId,
      snapshot_time: snapshotTime,
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
      // MLB debug fields (only present for MLB games)
      ...(mlbDebug ? { mlb_debug: mlbDebug } : {}),
      ...(mlbTruth ? { mlb_truth: { derived_truth: mlbTruth.derived_truth, signal_summary: mlbTruth.signal_summary, validation: mlbTruth.validation } } : {}),
      ...(mlbVerification ? { mlb_verification: mlbVerification } : {}),
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
