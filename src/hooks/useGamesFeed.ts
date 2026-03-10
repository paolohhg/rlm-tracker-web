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
    'DOUBLE NO-NARRATIVE RLM': 'DOUBLE NO-NARRATIVE RLM',
    'NO-NARRATIVE RLM': 'NO-NARRATIVE RLM',
    'STEAM MOVE': 'STEAM MOVE',
    'BOOK SHADE': 'BOOK SHADE',
    'FROZEN LINE': 'FROZEN LINE',
    'CONTRA MOVE': 'CONTRA MOVE',
    'WATCH': 'WATCH',
    'TRACKING': 'TRACKING',
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
    .replace(/[.'’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases: Record<string, string> = {
    ny: 'new york knicks',
    'new york': 'new york knicks',
    lal: 'los angeles lakers',
    lakers: 'los angeles lakers',
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
    md: 'maryland terrapins',
    ill: 'illinois fighting illini',
    neb: 'nebraska cornhuskers',
    iowa: 'iowa hawkeyes',
    mich: 'michigan wolverines',
    msu: 'michigan state spartans',
    'saint marys gaels': 'saint marys gaels',
    'st marys gaels': 'saint marys gaels',
  };

  return aliases[raw] ?? raw;
}

function buildMatchKey(sportOrLeague: string, homeTeam: string, awayTeam: string): string {
  return [
    sportOrLeague,
    normalizeTeamName(homeTeam),
    normalizeTeamName(awayTeam),
  ].join('|');
}

export function useGamesFeed() {
  const [games, setGames] = useState<GameView[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const { data: tipoffs } = await supabase
        .from('tipoff_snapshots')
        .select('*')
        .order('game_time', { ascending: true });

      const { data: alerts } = await supabase
        .from('rlm_alerts')
        .select('*')
        .order('detected_at', { ascending: false });

      const { data: odds } = await supabase
        .from('odds_snapshots')
        .select('*')
        .order('fetched_at', { ascending: false });

      const { data: analyses } = await supabase
        .from('claude_analyses')
        .select('*')
        .order('created_at', { ascending: false });

      const { data: scores } = await supabase
        .from('game_scores')
        .select('*');

      if (!tipoffs) return;

      const alertMap: Record<string, any> = {};
      for (const a of alerts ?? []) {
        const key = buildMatchKey(a.league, a.home_team, a.away_team);
        if (!alertMap[key]) alertMap[key] = a;
      }

      const oddsMap: Record<string, { opening: any; current: any }> = {};
      for (const o of odds ?? []) {
        const key = buildMatchKey(o.league, o.home_team, o.away_team);
        if (!oddsMap[key]) oddsMap[key] = { opening: null, current: null };
        if (!oddsMap[key].current) oddsMap[key].current = o;
      }

      const oddsOldest = [...(odds ?? [])].reverse();
      for (const o of oddsOldest) {
        const key = buildMatchKey(o.league, o.home_team, o.away_team);
        if (oddsMap[key]) oddsMap[key].opening = o;
      }

      const analysisMap: Record<string, any> = {};
      for (const a of analyses ?? []) {
        const key = buildMatchKey(a.league, a.home_team, a.away_team);
        if (!analysisMap[key]) analysisMap[key] = a;
      }

      const scoreMap: Record<string, any> = {};
      for (const s of scores ?? []) {
        const key = buildMatchKey(s.sport, s.home_team, s.away_team);
        if (!scoreMap[key]) scoreMap[key] = s;
      }

      const seen = new Set<string>();
      const uniqueTipoffs: any[] = [];
      for (const t of tipoffs) {
        const key = buildMatchKey(t.league, t.home_team, t.away_team);
        if (!seen.has(key)) {
          seen.add(key);
          uniqueTipoffs.push(t);
        }
      }

      const gameViews: GameView[] = uniqueTipoffs.map((t) => {
        const key = buildMatchKey(t.league, t.home_team, t.away_team);
        const alert = alertMap[key];
        const oddsEntry = oddsMap[key];
        const analysis = analysisMap[key];
        const score = scoreMap[key];

        const openSpread = oddsEntry?.opening?.spread ?? null;
        const currSpread = oddsEntry?.current?.spread ?? null;
        const lineMove =
          openSpread !== null && currSpread !== null
            ? parseFloat((currSpread - openSpread).toFixed(1))
            : null;

        const narrative = alert?.hsa_narrative ?? analysis?.narrative ?? null;
        const derivedStatus = deriveStatusFromScore(score?.status, t.game_time);

        const homeScore = score?.home_score;
        const awayScore = score?.away_score;
        const scoreSnippet =
          homeScore !== null && homeScore !== undefined && awayScore !== null && awayScore !== undefined
            ? `${t.away_team} ${awayScore} - ${t.home_team} ${homeScore}`
            : null;

        const displaySnippetParts = [];
        if (scoreSnippet) displaySnippetParts.push(scoreSnippet);
        if (score?.period !== null && score?.period !== undefined && derivedStatus === 'live') {
          displaySnippetParts.push(`Period ${score.period}`);
        }

        return {
          id: `${t.league}-${t.home_team}-${t.away_team}`,
          league: t.league,
          awayTeam: t.away_team,
          homeTeam: t.home_team,
          gameTime: t.game_time,
          status: derivedStatus,
          timeToTipMinutes: deriveTimeToTip(t.game_time),
          signalTier: deriveSignalTier(alert?.signal_tier ?? null),
          sharpTeam: alert?.sharp_team ?? null,
          fadeTeam: alert?.fade_team ?? null,
          openingSpread: openSpread,
          currentSpread: currSpread,
          closingSpread: null,
          lineMoveAmount: alert?.line_move ?? lineMove,
          booksAgreeing: alert?.books_agreeing ?? null,
          totalBooks: alert?.total_books ?? null,
          velocityPerHour: alert?.velocity_per_hour ?? null,
          scenarioKey: alert?.scenario_key ?? null,
          hsaStatus: deriveHsaStatus(narrative),
          hsaSnippet:
            displaySnippetParts.length > 0
              ? displaySnippetParts.join(' • ')
              : (narrative && narrative !== 'NO_NARRATIVE')
                ? narrative.slice(0, 120)
                : null,
          isLocked: t.is_locked ?? false,
          lastUpdated:
            alert?.detected_at ??
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

  return { games, loading, lastUpdated, refresh: fetchGames };
}
