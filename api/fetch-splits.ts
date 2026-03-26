// Polls Action Network public API for betting splits (ticket % and money %)
// Runs every 10 min via Vercel cron (see vercel.json)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

// ── Config ──────────────────────────────────────────────────────────

const ACTION_NETWORK_API = 'https://api.actionnetwork.com/web/v1/scoreboard';
const BOOK_IDS = '15,30,68,69,71,75,79'; // DraftKings, FanDuel, BetMGM, etc.
const LEAGUES = ['ncaab', 'nba', 'nhl', 'mlb'] as const;

// ── Types ──────────────────────────────────────────────────────────

interface ActionTeam {
  id: number;
  full_name: string;
  abbr: string;
}

interface ActionOdds {
  spread_home_public?: number;
  spread_away_public?: number;
  spread_home_money?: number;
  spread_away_money?: number;
  total_over_public?: number;
  total_under_public?: number;
  total_over_money?: number;
  total_under_money?: number;
  num_bets?: number;
  book_id: number;
}

interface ActionGame {
  id: number;
  home_team_id: number;
  away_team_id: number;
  start_time: string;
  teams: ActionTeam[];
  odds?: ActionOdds[];
  num_bets?: number;
}

interface SplitRow {
  league: string;
  home_team: string;
  away_team: string;
  home_ticket_pct: number;
  away_ticket_pct: number;
  home_money_pct: number;
  away_money_pct: number;
  total_over_ticket_pct: number | null;
  total_under_ticket_pct: number | null;
  total_over_money_pct: number | null;
  total_under_money_pct: number | null;
  num_bets: number | null;
  fetched_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function todayDate(): string {
  // Format YYYYMMDD in US Eastern time (Action Network uses ET dates)
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const d = String(et.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function leagueLabel(league: string): string {
  return league.toUpperCase();
}

async function fetchLeagueSplits(league: string, date: string): Promise<SplitRow[]> {
  const url = `${ACTION_NETWORK_API}/${league}?period=game&bookIds=${BOOK_IDS}&date=${date}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RLMTracker/1.0)' },
  });

  if (!res.ok) {
    console.error(`Action Network ${league} returned ${res.status}`);
    return [];
  }

  const data = await res.json();
  const games: ActionGame[] = data.games ?? [];
  const rows: SplitRow[] = [];
  const now = new Date().toISOString();

  for (const g of games) {
    const home = g.teams.find(t => t.id === g.home_team_id);
    const away = g.teams.find(t => t.id === g.away_team_id);
    if (!home || !away) continue;

    // Use first book's odds that has splits (they're the same across books)
    const odds = g.odds?.find(o =>
      o.spread_home_public != null && o.spread_home_public > 0
    );
    if (!odds) continue;

    rows.push({
      league: leagueLabel(league),
      home_team: home.full_name,
      away_team: away.full_name,
      home_ticket_pct: odds.spread_home_public ?? 0,
      away_ticket_pct: odds.spread_away_public ?? 0,
      home_money_pct: odds.spread_home_money ?? 0,
      away_money_pct: odds.spread_away_money ?? 0,
      total_over_ticket_pct: odds.total_over_public ?? null,
      total_under_ticket_pct: odds.total_under_public ?? null,
      total_over_money_pct: odds.total_over_money ?? null,
      total_under_money_pct: odds.total_under_money ?? null,
      num_bets: odds.num_bets ?? g.num_bets ?? null,
      fetched_at: now,
    });
  }

  return rows;
}

// ── Handler ──────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const date = todayDate();
    let totalInserted = 0;

    for (const league of LEAGUES) {
      const rows = await fetchLeagueSplits(league, date);
      if (rows.length === 0) continue;

      // Upsert: delete today's old rows for this league, then insert fresh
      // This avoids duplicate rows from multiple cron runs
      const { error: delError } = await supabase
        .from('splits_snapshots')
        .delete()
        .eq('league', leagueLabel(league))
        .gte('fetched_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

      if (delError) {
        console.error(`Delete error for ${league}:`, delError.message);
      }

      // Try insert with all columns first; if extra columns don't exist, retry with base columns only
      let { error: insertError } = await supabase
        .from('splits_snapshots')
        .insert(rows);

      if (insertError && insertError.message.includes('column')) {
        console.warn(`Retrying ${league} insert with base columns only:`, insertError.message);
        const baseRows = rows.map(({ total_over_ticket_pct, total_under_ticket_pct, total_over_money_pct, total_under_money_pct, num_bets, ...rest }) => rest);
        const retry = await supabase.from('splits_snapshots').insert(baseRows);
        insertError = retry.error;
      }

      if (insertError) {
        console.error(`Insert error for ${league}:`, insertError.message);
      } else {
        totalInserted += rows.length;
      }
    }

    return res.status(200).json({
      ok: true,
      date,
      inserted: totalInserted,
      leagues: LEAGUES,
    });
  } catch (err: any) {
    console.error('fetch-splits error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
