import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { GameView, GameStatus, HsaStatus, SignalTier, Tournament } from '../types';
import { computeResistance } from '../lib/intelligence/resistance';
import { computeFakeSteam } from '../lib/intelligence/fake-steam';

function deriveFallbackStatus(gameTime: string): GameStatus {
  const now = Date.now();
  const tip = new Date(gameTime).getTime();
  const diff = tip - now;
  if (diff > 0) return 'upcoming';
  if (diff > -2 * 60 * 60 * 1000) return 'live';
  return 'final';
}

function deriveStatusFromScore(scoreStatus: string | null | undefined, gameTime: string): GameStatus {
  if (scoreStatus === 'scheduled') return 'upcoming';
  if (scoreStatus === 'in_progress') return 'live';
  if (scoreStatus === 'final') return 'final';
  return deriveFallbackStatus(gameTime);
}

function deriveTimeToTip(gameTime: string): number {
  return Math.round((new Date(gameTime).getTime() - Date.now()) / 60000);
}

function deriveHsaStatus(narrative: string | null): HsaStatus {
  if (!narrative) return 'pending';
  if (narrative === 'NO_NARRATIVE' || narrative === '') return 'no_narrative';
  return 'narrative';
}

/** Map a raw tier string to a valid SignalTier enum value. */
function mapTierString(tier: string | null | undefined): SignalTier {
  if (!tier) return 'TRACKING';

  const map: Record<string, SignalTier> = {
    A: 'DOUBLE NO-NARRATIVE RLM',
    B: 'NO-NARRATIVE RLM',
    C: 'WATCH',
    'DOUBLE NO-NARRATIVE RLM': 'DOUBLE NO-NARRATIVE RLM',
    'NO-NARRATIVE RLM': 'NO-NARRATIVE RLM',
    'STEAM MOVE': 'STEAM MOVE',
    'BOOK SHADE': 'BOOK SHADE',
    'FROZEN LINE': 'FROZEN LINE',
    'SHARP ACCUMULATION': 'SHARP ACCUMULATION',
    'CONTRA MOVE': 'CONTRA MOVE',
    WATCH: 'WATCH',
    TRACKING: 'TRACKING',
    'DOUBLE RLM': 'DOUBLE NO-NARRATIVE RLM',
    'PRIME RLM ENHANCED': 'NO-NARRATIVE RLM',
    'PRIME RLM CONFIRMED': 'NO-NARRATIVE RLM',
    'PRIME RLM UNCONFIRMED': 'WATCH',
    'FROZEN LINE (65%+ money confirmed)': 'FROZEN LINE',
  };

  return map[tier] ?? 'TRACKING';
}

/**
 * Derive the display signal tier from an alert object.
 *
 * Priority:
 *   1. Use overall_badge (new three-layer field) if present
 *   2. Fall back to signal_tier (legacy field)
 *   3. Fall back to tracked_games signal_tier
 *
 * FROZEN GUARD: If any per-market read has a non-PASS confidence,
 * FROZEN LINE is overridden to WATCH. This prevents stale FROZEN
 * rows or legacy data from showing FREEZE when real activity exists.
 */
function deriveSignalTier(alert: Record<string, any> | null, fallbackTier: string | null): SignalTier {
  // Prefer overall_badge (written by the new three-layer engine)
  // then signal_tier from alert, then fallback from tracked_games
  const rawTier = alert?.overall_badge ?? alert?.signal_tier ?? fallbackTier ?? null;
  const tier = mapTierString(rawTier);

  // ── FROZEN GUARD ─────────────────────────────────────────────
  // FROZEN LINE is only valid when ALL per-market reads are PASS.
  // Two cases to handle:
  //   1. Alert has per-market data → check confidences
  //   2. Legacy alert (null three-layer fields) → distrust FROZEN entirely
  if (tier === 'FROZEN LINE') {
    if (!alert) {
      // No alert at all, just a fallback tier string — can't verify, demote
      return 'WATCH';
    }

    const sideConf = alert.side_confidence;
    const totalConf = alert.total_confidence;
    const mlConf = alert.ml_confidence;
    const hasMarketData = sideConf || totalConf || mlConf;

    if (!hasMarketData) {
      // Legacy alert row — three-layer fields are null.
      // Cannot trust FROZEN classification from old engine. Demote to WATCH.
      return 'WATCH';
    }

    // Has per-market data: FROZEN only valid if ALL are PASS
    const anyNonPass =
      (sideConf && sideConf !== 'PASS') ||
      (totalConf && totalConf !== 'PASS') ||
      (mlConf && mlConf !== 'PASS');

    if (anyNonPass) return 'WATCH';
  }

  return tier;
}

function normalizeTeamName(name: string | null | undefined): string {
  if (!name) return '';

  const raw = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip all accents (é→e, ñ→n, etc.)
    .replace(/[.''()]/g, '')   // remove punctuation (not hyphen)
    .replace(/-/g, ' ')        // hyphen → space (keeps "UT-Arlington" as "ut arlington")
    .replace(/\s*&\s*/g, ' and ')  // & → " and " with spaces
    // Expand common abbreviations used by The Odds API but not ESPN
    .replace(/ st /g, ' state ')   // "Mississippi St Bulldogs" → "Mississippi State Bulldogs"
    .replace(/ st$/, ' state')     // trailing "St" (edge case)
    .replace(/ univ /g, ' university ')  // "Boston Univ." → "Boston University"
    .replace(/ univ$/, ' university')
    .replace(/^csu /g, 'cal state ')    // "CSU Fullerton" → "Cal State Fullerton"
    .replace(/\s+/g, ' ')
    .trim();

  const aliases: Record<string, string> = {
    ny: 'new york knicks',
    'new york': 'new york knicks',
    lal: 'los angeles lakers',
    lac: 'la clippers',
    'los angeles clippers': 'la clippers',
    'la clippers': 'la clippers',
    mil: 'milwaukee bucks',
    orl: 'orlando magic',
    sa: 'san antonio spurs',
    hou: 'houston rockets',
    no: 'new orleans pelicans',
    wsh: 'washington wizards',
    sac: 'sacramento kings',
    chi: 'chicago bulls',
    phx: 'phoenix suns',
    cha: 'charlotte hornets',
    por: 'portland trail blazers',
    ind: 'indiana pacers',
    cle: 'cleveland cavaliers',
    bos: 'boston celtics',
    mia: 'miami heat',
    det: 'detroit pistons',
    tor: 'toronto raptors',
    dal: 'dallas mavericks',
    md: 'maryland',
    ill: 'illinois',
    neb: 'nebraska',
    iowa: 'iowa',
    mich: 'michigan',
    msu: 'michigan state',
    byu: 'brigham young',
    uconn: 'connecticut',
    unc: 'north carolina',
    usc: 'southern california',
    vcu: 'virginia commonwealth',
    smu: 'southern methodist',
    tcu: 'texas christian',
    lsu: 'louisiana state',
    'ole miss': 'mississippi',
    'st marys': 'saint marys',
    'st marys gaels': 'saint marys',
    'saint marys gaels': 'saint marys',
    'saint marys': 'saint marys',
    etsu: 'east tennessee state',
    'furman paladins': 'furman',
    'troy trojans': 'troy',
    'georgia southern eagles': 'georgia southern',
    // Odds API abbreviations not matching ESPN
    'loyola chi ramblers': 'loyola chicago ramblers',
    'csu northridge matadors': 'cal state northridge matadors',
    'ut arlington mavericks': 'ut arlington mavericks',
  };

  return aliases[raw] ?? raw;
}

function buildMatchKey(leagueOrSport: string, homeTeam: string, awayTeam: string): string {
  // Sort teams alphabetically so neutral-site games with swapped home/away still match
  const teams = [normalizeTeamName(homeTeam), normalizeTeamName(awayTeam)].sort();
  return [leagueOrSport.toLowerCase(), teams[0], teams[1]].join('|');
}

function hoursApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3600000;
}

function findBestOddsMatch(tipoff: any, oddsRows: any[]) {
  const matchingLeague = oddsRows.filter((o) => String(o.league).toLowerCase() === String(tipoff.league).toLowerCase());

  const exactTeamMatches = matchingLeague.filter((o) => {
    return (
      normalizeTeamName(o.home_team) === normalizeTeamName(tipoff.home_team) &&
      normalizeTeamName(o.away_team) === normalizeTeamName(tipoff.away_team)
    );
  });

  const candidateRows = exactTeamMatches.length ? exactTeamMatches : matchingLeague.filter((o) => {
    return (
      normalizeTeamName(o.home_team).includes(normalizeTeamName(tipoff.home_team)) ||
      normalizeTeamName(tipoff.home_team).includes(normalizeTeamName(o.home_team)) ||
      normalizeTeamName(o.away_team).includes(normalizeTeamName(tipoff.away_team)) ||
      normalizeTeamName(tipoff.away_team).includes(normalizeTeamName(o.away_team))
    );
  });

  if (!candidateRows.length) {
    return { opening: null, current: null };
  }

  // Only filter by game_time proximity if odds rows actually have that field
  const hasGameTime = candidateRows.some((o) => o.game_time != null);
  const pool = hasGameTime
    ? (() => {
        const sorted = candidateRows
          .map((o) => ({ ...o, _timeDiff: hoursApart(o.game_time, tipoff.game_time) }))
          .sort((a, b) => a._timeDiff - b._timeDiff);
        return sorted.filter((o) => o._timeDiff <= Math.max(3, sorted[0]._timeDiff + 0.01));
      })()
    : candidateRows;

  const byFetchedDesc = [...pool].sort(
    (a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
  );

  const byFetchedAsc = [...pool].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
  );

  // Count distinct bookmakers reporting for this game
  const distinctBooks = new Set(pool.map((o: any) => o.bookmaker)).size;

  return {
    current: byFetchedDesc[0] ?? null,
    opening: byFetchedAsc[0] ?? null,
    distinctBooks,
  };
}

type EspnScoreEntry = { homeScore: number; awayScore: number; status: string; period: number | null; clock: string | null };

// Persist scores across polls — once ESPN drops a finished game, we keep the last known score
const espnScoreCache: Record<string, EspnScoreEntry> = {};

type EspnGameEntry = {
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  league: 'NBA' | 'NCAAB' | 'NHL' | 'MLB';
  tournament: Tournament;
  status: string;
  homeScore: number;
  awayScore: number;
  period: number | null;
  clock: string | null;
};

function parseTournament(event: any, league: 'NBA' | 'NCAAB' | 'NHL' | 'MLB'): Tournament {
  if (league !== 'NCAAB') return null;
  // ESPN exposes tournament info in notes and season type
  const notes: string = (event.competitions?.[0]?.notes?.[0]?.headline ?? event.notes?.[0]?.headline ?? '').toLowerCase();
  if (notes.includes('ncaa tournament') || notes.includes('march madness') || notes.includes('ncaa ')) return 'ncaa_tournament';
  if (notes.includes('nit')) return 'nit';
  // Also check season type — ESPN uses type 3 for postseason
  const seasonType = event.season?.type ?? 0;
  if (seasonType === 3) {
    // Postseason but notes didn't specify — check group info
    const groupName: string = (event.competitions?.[0]?.conference?.name ?? '').toLowerCase();
    if (groupName.includes('nit')) return 'nit';
    return 'ncaa_tournament';
  }
  return null;
}

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// Fetch upcoming + live games from ESPN for today/tomorrow/day-after.
// This catches NIT, CBI, and other tournaments that The Odds API or RLM detection may miss.
async function fetchEspnGames(): Promise<EspnGameEntry[]> {
  const entries: EspnGameEntry[] = [];
  const today = new Date();
  const dates = [0, 1, 2].map(offset => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return formatDateYMD(d);
  });

  const requests: { url: string; league: 'NBA' | 'NCAAB' | 'NHL' | 'MLB' }[] = [];
  for (const date of dates) {
    requests.push({ url: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`, league: 'NBA' });
    // groups=50 includes NCAA Tournament + NIT + CBI + CIT
    requests.push({ url: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&groups=50`, league: 'NCAAB' });
    requests.push({ url: `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${date}`, league: 'NHL' });
    requests.push({ url: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${date}`, league: 'MLB' });
  }

  await Promise.all(requests.map(async ({ url, league }) => {
    try {
      const res = await fetch(url);
      const data = await res.json();
      for (const event of data.events ?? []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const statusType = comp.status?.type?.name ?? '';
        const espnStatus =
          statusType === 'STATUS_FINAL' ? 'final' :
          statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || statusType === 'STATUS_END_PERIOD' ? 'live' :
          'upcoming';

        entries.push({
          homeTeam: home.team.displayName ?? home.team.shortDisplayName ?? '',
          awayTeam: away.team.displayName ?? away.team.shortDisplayName ?? '',
          gameTime: comp.date ?? event.date ?? '',
          league,
          tournament: parseTournament(event, league),
          status: espnStatus,
          homeScore: parseInt(home.score ?? '0', 10),
          awayScore: parseInt(away.score ?? '0', 10),
          period: comp.status?.period ?? null,
          clock: comp.status?.displayClock ?? null,
        });
      }
    } catch { /* skip */ }
  }));

  return entries;
}

async function fetchEspnScores(): Promise<Record<string, EspnScoreEntry>> {
  const map: Record<string, EspnScoreEntry> = {};

  const urls = [
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    // groups=50 includes NCAA Tournament + NIT + CBI
    'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50',
    'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  ];

  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url);
      const data = await res.json();
      for (const event of data.events ?? []) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const statusType = comp.status?.type?.name ?? '';
        const espnStatus =
          statusType === 'STATUS_FINAL' ? 'final' :
          statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' || statusType === 'STATUS_END_PERIOD' ? 'live' :
          'upcoming';

        const entry: EspnScoreEntry = {
          homeScore: parseInt(home.score ?? '0', 10),
          awayScore: parseInt(away.score ?? '0', 10),
          status: espnStatus,
          period: comp.status?.period ?? null,
          clock: comp.status?.displayClock ?? null,
        };

        // Index under all name variations so DB names match regardless of format
        const homeVariants = [
          home.team.displayName,
          home.team.shortDisplayName,
          home.team.location,
          home.team.name,
        ].filter(Boolean).map((n: string) => normalizeTeamName(n));

        const awayVariants = [
          away.team.displayName,
          away.team.shortDisplayName,
          away.team.location,
          away.team.name,
        ].filter(Boolean).map((n: string) => normalizeTeamName(n));

        for (const h of homeVariants) {
          for (const a of awayVariants) {
            map[`${h}|${a}`] = entry;
          }
        }
      }
    } catch { /* silently skip if ESPN is unreachable */ }
  }));

  // Merge fresh data into persistent cache (never evict — keeps final scores after game drops off scoreboard)
  Object.assign(espnScoreCache, map);
  return espnScoreCache;
}

export function useGamesFeed() {
  const [games, setGames] = useState<GameView[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      // Fire-and-forget: refresh splits from Action Network on each load
      fetch('/api/fetch-splits').catch(() => {});

      const [
        tipoffRes,
        alertsRes,
        oddsRes,
        analysesRes,
        scoresRes,
        splitsRes,
        espnScores,
        espnGames,
      ] = await Promise.all([
        supabase.from('tipoff_snapshots').select('*').gte('game_time', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).order('game_time', { ascending: true }),
        supabase.from('rlm_alerts').select('*').gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).order('detected_at', { ascending: false }),
        // Fetch odds for games from 4h ago through 7 days ahead.
        // Use limit(3000) to ensure upcoming MLB/NHL games aren't crowded
        // out by today's high-frequency NBA/NCAAB snapshots.
        supabase.from('odds_snapshots').select('*').gte('game_time', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).lte('game_time', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()).order('fetched_at', { ascending: false }).limit(3000),
        supabase.from('claude_analyses').select('*').order('created_at', { ascending: false }),
        supabase.from('game_scores').select('*').order('id', { ascending: false }),
        supabase.from('splits_snapshots').select('*').order('fetched_at', { ascending: false }),
        fetchEspnScores(),
        fetchEspnGames(),
      ]);

      const tipoffs = tipoffRes.data ?? [];
      const alerts = alertsRes.data ?? [];
      const odds = oddsRes.data ?? [];
      const analyses = analysesRes.data ?? [];
      const scores = scoresRes.data ?? [];
      const splits = splitsRes.data ?? [];

      // Build splits map — most recent entry per game wins
      const splitsMap: Record<string, any> = {};
      for (const s of [...splits].reverse()) {
        const key = buildMatchKey(s.league, s.home_team, s.away_team);
        splitsMap[key] = s;
      }

      const scoreByGameId: Record<string, any> = {};
      for (const s of scores) {
        if (s.game_id && !scoreByGameId[s.game_id]) {
          scoreByGameId[s.game_id] = s;
        }
      }

      const alertMap: Record<string, any> = {};
      for (const a of alerts) {
        const key = buildMatchKey(a.league, a.home_team, a.away_team);
        if (!alertMap[key]) alertMap[key] = a;
      }

      const analysisMap: Record<string, any> = {};
      for (const a of analyses) {
        const key = buildMatchKey(a.league, a.home_team, a.away_team);
        if (!analysisMap[key]) analysisMap[key] = a;
      }

      // Build per-book lines map for Fake Steam — latest spread per bookmaker per game
      const bookLinesMap: Record<string, number[]> = {};
      const bookLatest: Record<string, Record<string, { spread: number; fetched_at: string }>> = {};
      for (const o of odds) {
        if (o.spread == null) continue;
        const key = buildMatchKey(o.league, o.home_team, o.away_team);
        if (!bookLatest[key]) bookLatest[key] = {};
        const bk = o.bookmaker as string;
        const prev = bookLatest[key][bk];
        if (!prev || new Date(o.fetched_at).getTime() > new Date(prev.fetched_at).getTime()) {
          bookLatest[key][bk] = { spread: o.spread as number, fetched_at: o.fetched_at as string };
        }
      }
      for (const [key, books] of Object.entries(bookLatest)) {
        bookLinesMap[key] = Object.values(books).map(b => b.spread);
      }

      const uniqueTipoffs: any[] = [];
      const seenKeys = new Set<string>();

      for (const t of tipoffs) {
        const matchKey = buildMatchKey(t.league, t.home_team, t.away_team);
        const dedupKey = t.game_id ? String(t.game_id) : matchKey;
        if (!seenKeys.has(dedupKey) && !seenKeys.has(matchKey)) {
          seenKeys.add(dedupKey);
          // Also add matchKey so ESPN/odds entries with swapped home/away get deduped
          seenKeys.add(matchKey);
          uniqueTipoffs.push(t);
        }
      }

      // Synthesize tipoff entries from odds_snapshots for games not in tipoff_snapshots
      // (e.g. NIT, CBI, and other postseason games that The Odds API includes but the
      // RLM detection service hasn't processed yet)
      const oddsGames = new Map<string, any>();
      for (const o of odds) {
        const key = buildMatchKey(o.league, o.home_team, o.away_team);
        if (!oddsGames.has(key)) {
          oddsGames.set(key, o);
        }
      }
      for (const [key, o] of oddsGames) {
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueTipoffs.push({
            game_id: null,
            league: o.league,
            home_team: o.home_team,
            away_team: o.away_team,
            game_time: o.game_time,
            signal_tier: null,
            sharp_team: null,
            scenario_key: null,
            is_locked: false,
            created_at: o.fetched_at,
          });
        }
      }

      // Build ESPN tournament map — matchKey → tournament type
      const espnTournamentMap: Record<string, Tournament> = {};
      for (const eg of espnGames) {
        if (eg.tournament) {
          const key = buildMatchKey(eg.league, eg.homeTeam, eg.awayTeam);
          espnTournamentMap[key] = eg.tournament;
        }
      }

      // Synthesize tipoff entries from ESPN schedule for games not in DB
      // (catches NIT, CBI, and other tournaments before odds are published)
      for (const eg of espnGames) {
        const key = buildMatchKey(eg.league, eg.homeTeam, eg.awayTeam);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueTipoffs.push({
            game_id: null,
            league: eg.league,
            home_team: eg.homeTeam,
            away_team: eg.awayTeam,
            game_time: eg.gameTime,
            tournament: eg.tournament,
            signal_tier: null,
            sharp_team: null,
            scenario_key: null,
            is_locked: false,
            created_at: new Date().toISOString(),
          });
        }
      }

      const gameViews: GameView[] = uniqueTipoffs.map((t) => {
        const fallbackKey = buildMatchKey(t.league, t.home_team, t.away_team);

        const score = scoreByGameId[t.game_id] ?? null;
        const alert = alertMap[fallbackKey] ?? null;
        const analysis = analysisMap[fallbackKey] ?? null;
        const split = splitsMap[fallbackKey] ?? null;
        const bestOdds = findBestOddsMatch(t, odds);

        // ESPN live score — try exact key first, then fuzzy partial match
        const normHome = normalizeTeamName(t.home_team);
        const normAway = normalizeTeamName(t.away_team);
        const espnKey = `${normHome}|${normAway}`;
        let espn = espnScores[espnKey] ?? null;

        if (!espn) {
          const fuzzyKey = Object.keys(espnScores).find((k) => {
            const [h, a] = k.split('|');
            const homeMatch = h.includes(normHome) || normHome.includes(h);
            const awayMatch = a.includes(normAway) || normAway.includes(a);
            // Also try reversed — neutral-site tournament games often have different home/away
            const revHomeMatch = h.includes(normAway) || normAway.includes(h);
            const revAwayMatch = a.includes(normHome) || normHome.includes(a);
            return (homeMatch && awayMatch) || (revHomeMatch && revAwayMatch);
          });
          if (fuzzyKey) espn = espnScores[fuzzyKey];
        }

        const minutesFromNow = deriveTimeToTip(t.game_time);

        const openingSpread = bestOdds.opening?.spread ?? null;
        const currentSpread = bestOdds.current?.spread ?? null;
        const openingTotal = bestOdds.opening?.total ?? null;
        const currentTotal = bestOdds.current?.total ?? null;
        const openingMoneylineHome = bestOdds.opening?.moneyline_home ?? null;
        const openingMoneylineAway = bestOdds.opening?.moneyline_away ?? null;
        const moneylineHome = bestOdds.current?.moneyline_home ?? null;
        const moneylineAway = bestOdds.current?.moneyline_away ?? null;
        const mlMoveHome = openingMoneylineHome != null && moneylineHome != null
          ? Math.round(moneylineHome - openingMoneylineHome)
          : null;

        const lineMoveAmount =
          openingSpread !== null && currentSpread !== null
            ? parseFloat((currentSpread - openingSpread).toFixed(1))
            : null;

        const narrative = alert?.hsa_narrative ?? analysis?.analysis ?? analysis?.narrative ?? null;

        // Consensus percentages for resistance computation
        const consensusHomePct = split?.home_ticket_pct ?? (alert?.public_bets_pct ?? null);
        const consensusAwayPct = split?.away_ticket_pct ?? (consensusHomePct != null ? 100 - consensusHomePct : null);

        // Intelligence: Line Resistance
        const resistanceResult = computeResistance({
          openSpread: bestOdds.opening?.spread ?? null,
          currentSpread: bestOdds.current?.spread ?? null,
          consensusHomePct,
          consensusAwayPct,
          openTimestamp: bestOdds.opening?.fetched_at ?? null,
        });

        // Intelligence: Fake Steam V1
        const fakeSteamResult = computeFakeSteam({
          bookLines: bookLinesMap[fallbackKey] ?? [],
        });

        // ESPN is the fastest source — prefer it over DB status
        // ESPN is authoritative. Without ESPN data, force final after 2h (games rarely exceed 2.5h).
        const status: GameStatus = espn
          ? espn.status as GameStatus
          : minutesFromNow < -120
            ? 'final'
            : deriveStatusFromScore(score?.status, t.game_time);

        let hsaSnippet: string | null = null;

        if (espn && (espn.status === 'live' || espn.status === 'final')) {
          const clock = espn.status === 'live' && espn.clock ? ` ${espn.clock}` : '';
          const pPrefix = t.league === 'NHL' ? 'P' : t.league === 'MLB' ? 'Inn' : 'Q';
          const period = espn.period ? ` ${pPrefix}${espn.period}${clock}` : '';
          const suffix = espn.status === 'final' ? ' • Final' : period;
          hsaSnippet = `${t.away_team} ${espn.awayScore} - ${t.home_team} ${espn.homeScore}${suffix}`;
        } else if (score?.home_score != null && score?.away_score != null) {
          const periodLine = score?.period != null && status === 'live' ? ` • P${score.period}` : status === 'final' ? ' • Final' : '';
          hsaSnippet = `${t.away_team} ${score.away_score} - ${t.home_team} ${score.home_score}${periodLine}`;
        } else if (narrative && narrative !== 'NO_NARRATIVE') {
          hsaSnippet = narrative.slice(0, 120);
        }

        return {
          id: t.game_id ? String(t.game_id) : buildMatchKey(t.league, t.home_team, t.away_team),
          league: t.league,
          tournament: t.tournament ?? espnTournamentMap[fallbackKey] ?? null,
          awayTeam: t.away_team,
          homeTeam: t.home_team,
          gameTime: t.game_time,
          status,
          timeToTipMinutes: deriveTimeToTip(t.game_time),
          signalTier: deriveSignalTier(alert, t.signal_tier ?? null),
          sharpTeam: alert?.sharp_team ?? t.sharp_team ?? null,
          fadeTeam: alert?.fade_team ?? null,
          homeScore: espn?.homeScore ?? score?.home_score ?? null,
          awayScore: espn?.awayScore ?? score?.away_score ?? null,
          period: espn?.period ?? score?.period ?? null,
          gameClock: espn?.clock ?? null,
          openingSpread,
          currentSpread,
          closingSpread: null,
          lineMoveAmount: alert?.line_move ?? lineMoveAmount,
          booksAgreeing: alert?.books_agreeing ?? null,
          totalBooks: alert?.total_books ?? null,
          velocityPerHour: alert?.velocity_per_hour ?? null,
          publicBetsPct: alert?.public_bets_pct ?? alert?.bets_pct ?? split?.home_ticket_pct ?? null,
          publicMoneyPct: alert?.public_money_pct ?? alert?.money_pct ?? split?.home_money_pct ?? null,
          awayBetsPct: split?.away_ticket_pct ?? null,
          awayMoneyPct: split?.away_money_pct ?? null,
          sharpMoneyPct: alert?.sharp_money_pct ?? null,
          numBets: split?.num_bets ?? null,
          scenarioKey: alert?.scenario_key ?? t.scenario_key ?? null,
          hsaStatus: deriveHsaStatus(narrative),
          hsaSnippet,
          hsaNarrative: narrative && narrative !== 'NO_NARRATIVE' ? narrative : null,
          hsaBetTeam: null,
          hsaBetSpread: null,
          hsaSignalAction: null,
          openingTotal,
          currentTotal,
          totalMove:
            openingTotal !== null && currentTotal !== null
              ? parseFloat((currentTotal - openingTotal).toFixed(1))
              : null,
          highestTotalSeen: null,
          lowestTotalSeen: null,
          overTicketPct: split?.total_over_ticket_pct ?? null,
          underTicketPct: split?.total_under_ticket_pct ?? null,
          overMoneyPct: split?.total_over_money_pct ?? null,
          underMoneyPct: split?.total_under_money_pct ?? null,
          totalSignalType: null,
          totalVelocityPerHour: null,
          // Intelligence
          isResistance: resistanceResult.isResistance,
          resistanceScore: resistanceResult.resistanceScore,
          resistanceReason: resistanceResult.resistanceReason,
          isFakeSteam: fakeSteamResult.isFakeSteam,
          fakeSteamScore: fakeSteamResult.fakeSteamScore,
          fakeSteamReason: fakeSteamResult.fakeSteamReason,
          followerCount: fakeSteamResult.followerCount,
          confirmationRate: fakeSteamResult.confirmationRate,
          marketRange: fakeSteamResult.marketRange,
          medianLine: fakeSteamResult.medianLine,
          outlierBookCount: fakeSteamResult.outlierBookCount,

          openingMoneylineHome: openingMoneylineHome as number | null,
          openingMoneylineAway: openingMoneylineAway as number | null,
          moneylineHome: moneylineHome as number | null,
          moneylineAway: moneylineAway as number | null,
          mlMoveHome: mlMoveHome as number | null,

          booksReporting: bestOdds.distinctBooks ?? null,

          isLocked: t.is_locked ?? false,
          lastUpdated:
            alert?.detected_at ??
            bestOdds.current?.fetched_at ??
            score?.finalized_at ??
            score?.scheduled_at ??
            t.created_at ??
            new Date().toISOString(),
        };
      });

      setGames(gameViews);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Feed error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger odds + signal detection once on mount (fire-and-forget).
  // Ensures data flows even if Vercel cron isn't active (free plan).
  useEffect(() => {
    fetch('/api/fetch-odds').catch(() => {});
    // detect-rlm needs odds first — delay 30s
    const timer = setTimeout(() => fetch('/api/detect-rlm').catch(() => {}), 30000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 30000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  return {
    games,
    loading,
    lastUpdated,
    refresh: fetchGames,
  };
}