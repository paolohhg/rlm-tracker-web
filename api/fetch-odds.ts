// ── fetch-odds: Vercel cron handler ──────────────────────────────────────────
// Runs every 10 min via Vercel cron (see vercel.json).
// Fetches odds directly from The Odds API and inserts into Supabase.
// Previously proxied to a Supabase edge function, but that required manual
// deployment. Running here means code deploys automatically with git push.
// ─────────────────────────────────────────────────────────────────────────────
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Allow up to 60s (Hobby plan max) — fetching 6 leagues needs time
export const maxDuration = 60;

// ── Leagues to track ─────────────────────────────────────────
const LEAGUES = [
  { key: 'basketball_nba',         league: 'NBA'   },
  { key: 'basketball_ncaab',       league: 'NCAAB' },
  { key: 'basketball_ncaab_nit',   league: 'NCAAB' },
  { key: 'baseball_mlb',           league: 'MLB'   },
  { key: 'baseball_mlb_preseason', league: 'MLB'   },
  { key: 'icehockey_nhl',          league: 'NHL'   },
];

const BOOKMAKERS = 'draftkings,fanduel,betmgm,pinnacle,caesars,pointsbetus,espnbet';

const SHARP_BOOKS = new Set(['pinnacle', 'circa', 'bookmaker', 'heritage']);

// ── Markets per league ───────────────────────────────────────
function marketsForLeague(league: string): string {
  if (league === 'NHL') return 'h2h,totals,spreads';
  return 'spreads,h2h,totals';
}

// ── Smart polling ────────────────────────────────────────────
function shouldPoll(commenceTime: string, alreadySeen: boolean): boolean {
  const hoursUntil = (new Date(commenceTime).getTime() - Date.now()) / 3600000;
  if (hoursUntil <= 48) return true;
  if (hoursUntil <= 240) return true;  // 10 days
  if (!alreadySeen) return true;
  return false;
}

// ── Retry helper ─────────────────────────────────────────────
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return r;
      lastError = new Error(`HTTP ${r.status}`);
    } catch (err: any) {
      lastError = err;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}

// ── Main handler ─────────────────────────────────────────────
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!ODDS_API_KEY || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing env vars (ODDS_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY)' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const rows: Record<string, unknown>[] = [];
  const openerRows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  let apiCalls = 0;

  // Load already-seen games
  const { data: seenRows } = await supabase
    .from('odds_snapshots')
    .select('home_team, away_team, league')
    .gte('fetched_at', new Date(Date.now() - 10 * 24 * 3600000).toISOString());
  const seenGames = new Set<string>(
    (seenRows ?? []).map((r: any) => `${r.league}|${r.home_team}|${r.away_team}`)
  );

  // Load existing openers
  const { data: existingOpeners } = await supabase
    .from('book_openers')
    .select('league, home_team, away_team, sportsbook, market_type');
  const openerKeys = new Set<string>(
    (existingOpeners ?? []).map((r: any) =>
      `${r.league}|${r.home_team}|${r.away_team}|${r.sportsbook}|${r.market_type}`)
  );

  const mlbGames: { home: string; away: string; time: string; books: number }[] = [];
  const commenceTimeTo = new Date(Date.now() + 10 * 24 * 3600000).toISOString();

  // Fetch all leagues in parallel to stay within Vercel timeout
  const leagueResults = await Promise.allSettled(
    LEAGUES.map(async ({ key, league }) => {
      const markets = marketsForLeague(league);
      const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=${BOOKMAKERS}&commenceTimeTo=${commenceTimeTo}`;
      const response = await fetchWithRetry(url);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} — ${JSON.stringify(body).slice(0, 200)}`);
      }
      if (!Array.isArray(body)) {
        throw new Error(`non-array response: ${JSON.stringify(body).slice(0, 200)}`);
      }
      return { key, league, games: body as Record<string, unknown>[] };
    })
  );

  for (const result of leagueResults) {
    apiCalls++;
    if (result.status === 'rejected') {
      const errMsg = `League fetch failed: ${result.reason?.message ?? result.reason}`;
      console.error(`[fetch-odds] ${errMsg}`);
      errors.push(errMsg);
      continue;
    }
    const { key, league, games } = result.value;
    console.log(`[fetch-odds] ${league} (${key}): ${games.length} games`);

    for (const game of games) {
      const commenceTime = game.commence_time as string;
      const homeTeam = game.home_team as string;
      const awayTeam = game.away_team as string;
      const alreadySeen = seenGames.has(`${league}|${homeTeam}|${awayTeam}`);

      if (!shouldPoll(commenceTime, alreadySeen)) continue;

      const bookmakers = (game.bookmakers as Record<string, unknown>[]) ?? [];

      if (league === 'MLB' && !key.includes('preseason')) {
        mlbGames.push({ home: homeTeam, away: awayTeam, time: commenceTime, books: bookmakers.length });
      }

      for (const bookmaker of bookmakers) {
        const bookKey = bookmaker.key as string;
        const bookType = SHARP_BOOKS.has(bookKey) ? 'sharp' : 'square';
        const marketsList = (bookmaker.markets as Record<string, unknown>[]) ?? [];

        let spread: number | null = null;
        let spreadHomePrice: number | null = null;
        let moneylineHome: number | null = null;
        let moneylineAway: number | null = null;
        let total: number | null = null;
        let totalOverPrice: number | null = null;
        let totalUnderPrice: number | null = null;
        let runlineHome: number | null = null;
        let runlineAway: number | null = null;
        let runlineHomePrice: number | null = null;
        let runlineAwayPrice: number | null = null;

        for (const market of marketsList) {
          const mKey = market.key as string;
          const outcomes = (market.outcomes as Record<string, unknown>[]) ?? [];

          if (mKey === 'spreads') {
            for (const o of outcomes) {
              if (o.name === homeTeam) {
                spread = o.point as number;
                spreadHomePrice = o.price as number;
              }
            }
          }

          if (mKey === 'h2h') {
            for (const o of outcomes) {
              if (o.name === homeTeam) moneylineHome = o.price as number;
              if (o.name === awayTeam) moneylineAway = o.price as number;
            }
          }

          if (mKey === 'totals') {
            for (const o of outcomes) {
              if (o.name === 'Over') { total = o.point as number; totalOverPrice = o.price as number; }
              if (o.name === 'Under') totalUnderPrice = o.price as number;
            }
          }

          // MLB run line comes from spreads market (±1.5)
          if (league === 'MLB' && mKey === 'spreads') {
            for (const o of outcomes) {
              if (o.name === homeTeam) { runlineHome = o.point as number; runlineHomePrice = o.price as number; }
              if (o.name === awayTeam) { runlineAway = o.point as number; runlineAwayPrice = o.price as number; }
            }
          }
        }

        rows.push({
          league, game_time: commenceTime, home_team: homeTeam, away_team: awayTeam,
          bookmaker: bookKey, book_type: bookType,
          spread, spread_home_price: spreadHomePrice,
          moneyline_home: moneylineHome, moneyline_away: moneylineAway,
          total, total_over_price: totalOverPrice, total_under_price: totalUnderPrice,
          runline_home: runlineHome, runline_away: runlineAway,
          runline_home_price: runlineHomePrice, runline_away_price: runlineAwayPrice,
          fetched_at: now,
        });

        // Per-book opener tracking
        const openerBase = { league, home_team: homeTeam, away_team: awayTeam, game_time: commenceTime, sportsbook: bookKey };
        if (moneylineHome != null) {
          const opKey = `${league}|${homeTeam}|${awayTeam}|${bookKey}|moneyline`;
          if (!openerKeys.has(opKey)) {
            openerRows.push({ ...openerBase, market_type: 'moneyline', opener_value: moneylineHome, opener_price: moneylineAway, first_seen_at: now });
            openerKeys.add(opKey);
          }
        }
        if (spread != null) {
          const opKey = `${league}|${homeTeam}|${awayTeam}|${bookKey}|spread`;
          if (!openerKeys.has(opKey)) {
            openerRows.push({ ...openerBase, market_type: 'spread', opener_value: spread, opener_price: spreadHomePrice, first_seen_at: now });
            openerKeys.add(opKey);
          }
        }
        if (total != null) {
          const opKey = `${league}|${homeTeam}|${awayTeam}|${bookKey}|total`;
          if (!openerKeys.has(opKey)) {
            openerRows.push({ ...openerBase, market_type: 'total', opener_value: total, opener_price: totalOverPrice, first_seen_at: now });
            openerKeys.add(opKey);
          }
        }
        if (runlineHome != null) {
          const opKey = `${league}|${homeTeam}|${awayTeam}|${bookKey}|runline`;
          if (!openerKeys.has(opKey)) {
            openerRows.push({ ...openerBase, market_type: 'runline', opener_value: runlineHome, opener_price: runlineHomePrice, first_seen_at: now });
            openerKeys.add(opKey);
          }
        }
      }
    }
  }

  if (!rows.length) {
    const msg = errors.length
      ? `No rows collected. Errors: ${errors.join('; ')}`
      : 'No rows collected (no games found across all leagues)';
    return res.status(errors.length ? 502 : 200).json({ error: msg, api_calls: apiCalls, errors });
  }

  // Insert odds snapshots
  const { error } = await supabase.from('odds_snapshots').insert(rows);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Insert openers (ON CONFLICT DO NOTHING)
  let openersInserted = 0;
  if (openerRows.length > 0) {
    const { error: openerErr } = await supabase
      .from('book_openers')
      .upsert(openerRows, { onConflict: 'league,home_team,away_team,game_time,sportsbook,market_type', ignoreDuplicates: true });
    if (openerErr) {
      console.error('Opener insert error:', openerErr.message);
    } else {
      openersInserted = openerRows.length;
    }
  }

  // Debug counts
  const leagueCounts: Record<string, number> = {};
  for (const r of rows) {
    leagueCounts[r.league as string] = (leagueCounts[r.league as string] || 0) + 1;
  }

  const mlbByDate: Record<string, number> = {};
  for (const g of mlbGames) {
    const d = g.time.split('T')[0];
    mlbByDate[d] = (mlbByDate[d] || 0) + 1;
  }

  return res.status(200).json({
    ok: true,
    source: 'vercel-direct',
    inserted: rows.length,
    openers_saved: openersInserted,
    api_calls: apiCalls,
    league_counts: leagueCounts,
    mlb_games: {
      total: mlbGames.length,
      by_date: mlbByDate,
      sample: mlbGames.slice(0, 5).map(g => `${g.away} @ ${g.home} (${g.time}, ${g.books} books)`),
    },
    ...(errors.length ? { partial_errors: errors } : {}),
  });
}
