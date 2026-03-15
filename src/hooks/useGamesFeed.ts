import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { GameView, GameStatus, HsaStatus, SignalTier } from '../types';

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

function deriveSignalTier(tier: string | null): SignalTier {
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
  return [
    leagueOrSport.toLowerCase(),
    normalizeTeamName(homeTeam),
    normalizeTeamName(awayTeam),
  ].join('|');
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

  return {
    current: byFetchedDesc[0] ?? null,
    opening: byFetchedAsc[0] ?? null,
  };
}

type EspnScoreEntry = { homeScore: number; awayScore: number; status: string; period: number | null; clock: string | null };

// Persist scores across polls — once ESPN drops a finished game, we keep the last known score
const espnScoreCache: Record<string, EspnScoreEntry> = {};

async function fetchEspnScores(): Promise<Record<string, EspnScoreEntry>> {
  const map: Record<string, EspnScoreEntry> = {};

  const urls = [
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50',
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
          statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME' ? 'live' :
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
      ] = await Promise.all([
        supabase.from('tipoff_snapshots').select('*').gte('game_time', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).order('game_time', { ascending: true }),
        supabase.from('rlm_alerts').select('*').order('detected_at', { ascending: false }),
        supabase.from('odds_snapshots').select('*').gte('game_time', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).order('fetched_at', { ascending: false }),
        supabase.from('claude_analyses').select('*').order('created_at', { ascending: false }),
        supabase.from('game_scores').select('*').order('id', { ascending: false }),
        supabase.from('splits_snapshots').select('*').order('fetched_at', { ascending: false }),
        fetchEspnScores(),
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

      const uniqueTipoffs: any[] = [];
      const seenKeys = new Set<string>();

      for (const t of tipoffs) {
        const dedupKey = t.game_id
          ? String(t.game_id)
          : buildMatchKey(t.league, t.home_team, t.away_team);
        if (!seenKeys.has(dedupKey)) {
          seenKeys.add(dedupKey);
          uniqueTipoffs.push(t);
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

        const lineMoveAmount =
          openingSpread !== null && currentSpread !== null
            ? parseFloat((currentSpread - openingSpread).toFixed(1))
            : null;

        const narrative = alert?.hsa_narrative ?? analysis?.analysis ?? analysis?.narrative ?? null;

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
          const period = espn.period ? ` Q${espn.period}${clock}` : '';
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
          awayTeam: t.away_team,
          homeTeam: t.home_team,
          gameTime: t.game_time,
          status,
          timeToTipMinutes: deriveTimeToTip(t.game_time),
          signalTier: deriveSignalTier(alert?.signal_tier ?? t.signal_tier ?? null),
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