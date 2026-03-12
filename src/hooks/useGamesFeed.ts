import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { GameView, GameStatus, HsaStatus, SignalTier } from '../types';

function deriveFallbackStatus(gameTime: string): GameStatus {
  const now = Date.now();
  const tip = new Date(gameTime).getTime();
  const diff = tip - now;
  if (diff > 0) return 'upcoming';
  if (diff > -3 * 60 * 60 * 1000) return 'live';
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
    .replace(/[.'’()-]/g, '')
    .replace(/&/g, 'and')
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

export function useGamesFeed() {
  const [games, setGames] = useState<GameView[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const [
        tipoffRes,
        alertsRes,
        oddsRes,
        analysesRes,
        scoresRes,
      ] = await Promise.all([
        supabase.from('tipoff_snapshots').select('*').order('game_time', { ascending: true }),
        supabase.from('rlm_alerts').select('*').order('detected_at', { ascending: false }),
        supabase.from('odds_snapshots').select('*').order('fetched_at', { ascending: false }),
        supabase.from('claude_analyses').select('*').order('created_at', { ascending: false }),
        supabase.from('game_scores').select('*').order('id', { ascending: false }),
      ]);

      const tipoffs = tipoffRes.data ?? [];
      const alerts = alertsRes.data ?? [];
      const odds = oddsRes.data ?? [];
      const analyses = analysesRes.data ?? [];
      const scores = scoresRes.data ?? [];

      const scoreByGameId: Record<string, any> = {};
      for (const s of scores) {
        if (s.game_id && !scoreByGameId[s.game_id]) {
          scoreByGameId[s.game_id] = s;
        }
      }

      console.debug('[scores] rows fetched:', scores.length, scores[0]);
      console.debug('[tipoffs] sample game_id:', tipoffs[0]?.game_id);

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
      const seenGameIds = new Set<string>();

      for (const t of tipoffs) {
        if (t.game_id && !seenGameIds.has(t.game_id)) {
          seenGameIds.add(t.game_id);
          uniqueTipoffs.push(t);
        }
      }

      const gameViews: GameView[] = uniqueTipoffs.map((t) => {
        const fallbackKey = buildMatchKey(t.league, t.home_team, t.away_team);

        const score = scoreByGameId[t.game_id] ?? null;
        const alert = alertMap[fallbackKey] ?? null;
        const analysis = analysisMap[fallbackKey] ?? null;
        const bestOdds = findBestOddsMatch(t, odds);

        const openingSpread = bestOdds.opening?.spread ?? null;
        const currentSpread = bestOdds.current?.spread ?? null;

        const lineMoveAmount =
          openingSpread !== null && currentSpread !== null
            ? parseFloat((currentSpread - openingSpread).toFixed(1))
            : null;

        const narrative = alert?.hsa_narrative ?? analysis?.narrative ?? null;
        const status = deriveStatusFromScore(score?.status, t.game_time);

        const hasScore =
          score?.home_score !== null &&
          score?.home_score !== undefined &&
          score?.away_score !== null &&
          score?.away_score !== undefined;

        let hsaSnippet: string | null = null;

        if (hasScore) {
          const scoreLine = `${t.away_team} ${score.away_score} - ${t.home_team} ${score.home_score}`;
          const periodLine =
            score?.period !== null && score?.period !== undefined && status === 'live'
              ? ` • P${score.period}`
              : status === 'final'
                ? ' • Final'
                : '';

          hsaSnippet = `${scoreLine}${periodLine}`;
        } else if (narrative && narrative !== 'NO_NARRATIVE') {
          hsaSnippet = narrative.slice(0, 120);
        }

        return {
          id: String(t.game_id),
          league: t.league,
          awayTeam: t.away_team,
          homeTeam: t.home_team,
          gameTime: t.game_time,
          status,
          timeToTipMinutes: deriveTimeToTip(t.game_time),
          signalTier: deriveSignalTier(alert?.signal_tier ?? t.signal_tier ?? null),
          sharpTeam: alert?.sharp_team ?? t.sharp_team ?? null,
          fadeTeam: alert?.fade_team ?? null,
          openingSpread,
          currentSpread,
          closingSpread: null,
          lineMoveAmount: alert?.line_move ?? lineMoveAmount,
          booksAgreeing: alert?.books_agreeing ?? null,
          totalBooks: alert?.total_books ?? null,
          velocityPerHour: alert?.velocity_per_hour ?? null,
          scenarioKey: alert?.scenario_key ?? t.scenario_key ?? null,
          hsaStatus: deriveHsaStatus(narrative),
          hsaSnippet,
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