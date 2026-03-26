// One-time backfill: fetches ESPN MLB scoreboard to capture opening lines
// that were missed during the fetch-odds outage.
//
// ESPN scoreboard may include odds data under competitions[].odds[]
// which can provide current lines and sometimes opening lines.
//
// Usage: POST /api/backfill-espn-odds (or visit in browser)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';

// ESPN book name → our bookmaker key mapping
const BOOK_MAP: Record<string, string> = {
  'espn bet': 'espnbet',
  'espnbet': 'espnbet',
  'draft kings': 'draftkings',
  'draftkings': 'draftkings',
  'fanduel': 'fanduel',
  'betmgm': 'betmgm',
  'caesars': 'caesars',
  'pinnacle': 'pinnacle',
};

function todayDate(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const d = String(et.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const date = todayDate();
    const url = `${ESPN_SCOREBOARD}?dates=${date}`;

    const espnRes = await fetch(url);
    if (!espnRes.ok) {
      return res.status(502).json({ error: `ESPN returned ${espnRes.status}` });
    }

    const data = await espnRes.json();
    const events = data.events ?? [];
    const rows: Record<string, unknown>[] = [];
    const debug: Record<string, unknown>[] = [];

    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const competitors = competition.competitors ?? [];
      const homeComp = competitors.find((c: any) => c.homeAway === 'home');
      const awayComp = competitors.find((c: any) => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team?.displayName ?? homeComp.team?.name ?? '';
      const awayTeam = awayComp.team?.displayName ?? awayComp.team?.name ?? '';
      const gameTime = competition.date ?? event.date ?? '';

      const oddsArray = competition.odds ?? [];
      const gameDebug: Record<string, unknown> = {
        matchup: `${awayTeam} @ ${homeTeam}`,
        game_time: gameTime,
        odds_count: oddsArray.length,
        odds_raw: oddsArray.length > 0 ? oddsArray[0] : null,
        odds_keys: oddsArray.length > 0 ? Object.keys(oddsArray[0]) : [],
      };
      debug.push(gameDebug);

      for (const odds of oddsArray) {
        const providerName = (odds.provider?.name ?? '').toLowerCase();
        const bookmaker = BOOK_MAP[providerName] ?? providerName.replace(/\s+/g, '');
        if (!bookmaker) continue;

        // Extract what ESPN provides
        const spread = odds.spread ?? odds.details?.match?.(/(-?\d+\.?\d*)/)?.[1] ?? null;
        const total = odds.overUnder ?? null;
        const mlHome = odds.homeTeamOdds?.moneyLine ?? null;
        const mlAway = odds.awayTeamOdds?.moneyLine ?? null;
        const spreadPrice = odds.homeTeamOdds?.spreadOdds ?? null;
        const totalOverPrice = odds.overOdds ?? odds.homeTeamOdds?.overOdds ?? null;

        // Check for opening line data
        const openMlHome = odds.open?.homeTeamOdds?.moneyLine ?? odds.homeTeamOdds?.open?.moneyLine ?? null;
        const openMlAway = odds.open?.awayTeamOdds?.moneyLine ?? odds.awayTeamOdds?.open?.moneyLine ?? null;
        const openSpread = odds.open?.spread ?? null;
        const openTotal = odds.open?.overUnder ?? null;

        gameDebug.has_opener_data = !!(openMlHome || openSpread || openTotal);
        gameDebug.current_ml = { home: mlHome, away: mlAway };
        gameDebug.open_ml = { home: openMlHome, away: openMlAway };

        // Insert current snapshot
        if (mlHome != null || spread != null || total != null) {
          rows.push({
            league: 'MLB',
            game_time: gameTime,
            home_team: homeTeam,
            away_team: awayTeam,
            bookmaker,
            book_type: bookmaker === 'pinnacle' ? 'sharp' : 'square',
            spread: spread != null ? parseFloat(String(spread)) : null,
            spread_home_price: spreadPrice,
            moneyline_home: mlHome,
            moneyline_away: mlAway,
            total: total != null ? parseFloat(String(total)) : null,
            total_over_price: totalOverPrice,
            total_under_price: null,
            runline_home: null,
            runline_away: null,
            runline_home_price: null,
            runline_away_price: null,
            fetched_at: new Date().toISOString(),
          });
        }

        // Insert opening line as a historical snapshot (backdated)
        if (openMlHome != null || openSpread != null || openTotal != null) {
          // Backdate opener to game_time - 24h to simulate when it was first posted
          const openerTime = new Date(new Date(gameTime).getTime() - 24 * 60 * 60 * 1000).toISOString();
          rows.push({
            league: 'MLB',
            game_time: gameTime,
            home_team: homeTeam,
            away_team: awayTeam,
            bookmaker,
            book_type: bookmaker === 'pinnacle' ? 'sharp' : 'square',
            spread: openSpread != null ? parseFloat(String(openSpread)) : (spread != null ? parseFloat(String(spread)) : null),
            spread_home_price: spreadPrice,
            moneyline_home: openMlHome ?? mlHome,
            moneyline_away: openMlAway ?? mlAway,
            total: openTotal != null ? parseFloat(String(openTotal)) : (total != null ? parseFloat(String(total)) : null),
            total_over_price: totalOverPrice,
            total_under_price: null,
            runline_home: null,
            runline_away: null,
            runline_home_price: null,
            runline_away_price: null,
            fetched_at: openerTime,
          });
        }
      }
    }

    // Insert rows into odds_snapshots
    let inserted = 0;
    if (rows.length > 0) {
      const { error } = await supabase.from('odds_snapshots').insert(rows);
      if (error) {
        return res.status(500).json({ error: error.message, debug });
      }
      inserted = rows.length;
    }

    return res.status(200).json({
      ok: true,
      date,
      games_found: events.length,
      rows_inserted: inserted,
      debug,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
