import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * MLB Debug Endpoint
 *
 * Returns diagnostic info about MLB odds ingestion and display pipeline.
 * GET /api/mlb-debug
 *
 * Checks:
 *  - Total MLB games in odds_snapshots
 *  - Games by date (March 25, March 26, etc.)
 *  - Games with at least 1 sportsbook line
 *  - Sample opener records
 *  - Timezone handling verification
 */

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!,
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const now = new Date();
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 1. Total MLB games in odds_snapshots (upcoming)
    const { data: mlbSnaps, count: totalMlbSnapshots } = await supabase
      .from('odds_snapshots')
      .select('home_team, away_team, game_time, bookmaker, moneyline_home, spread, total, fetched_at', { count: 'exact' })
      .eq('league', 'MLB')
      .gte('game_time', now.toISOString())
      .lte('game_time', sevenDaysAhead.toISOString())
      .order('game_time', { ascending: true })
      .limit(500);

    // 2. Distinct games
    const gameMap = new Map<string, { home: string; away: string; time: string; books: Set<string>; hasML: boolean; hasSpread: boolean; hasTotal: boolean; firstSeen: string }>();
    for (const snap of (mlbSnaps ?? [])) {
      const key = `${snap.home_team}|${snap.away_team}|${snap.game_time}`;
      if (!gameMap.has(key)) {
        gameMap.set(key, {
          home: snap.home_team,
          away: snap.away_team,
          time: snap.game_time,
          books: new Set(),
          hasML: false,
          hasSpread: false,
          hasTotal: false,
          firstSeen: snap.fetched_at,
        });
      }
      const g = gameMap.get(key)!;
      g.books.add(snap.bookmaker);
      if (snap.moneyline_home) g.hasML = true;
      if (snap.spread) g.hasSpread = true;
      if (snap.total) g.hasTotal = true;
      if (snap.fetched_at < g.firstSeen) g.firstSeen = snap.fetched_at;
    }

    // 3. Games by date
    const gamesByDate: Record<string, number> = {};
    const gamesList: { matchup: string; date: string; time: string; books: number; hasML: boolean; hasSpread: boolean; hasTotal: boolean; firstSeen: string }[] = [];

    for (const g of gameMap.values()) {
      const dateStr = g.time.split('T')[0];
      gamesByDate[dateStr] = (gamesByDate[dateStr] || 0) + 1;
      gamesList.push({
        matchup: `${g.away} @ ${g.home}`,
        date: dateStr,
        time: g.time,
        books: g.books.size,
        hasML: g.hasML,
        hasSpread: g.hasSpread,
        hasTotal: g.hasTotal,
        firstSeen: g.firstSeen,
      });
    }

    // 4. Book openers
    const { data: openers } = await supabase
      .from('book_openers')
      .select('*')
      .eq('league', 'MLB')
      .gte('game_time', now.toISOString())
      .order('first_seen_at', { ascending: true })
      .limit(20);

    // 5. Check The Odds API directly for MLB games
    let apiGames: { total: number; games: string[] } = { total: 0, games: [] };
    const oddsApiKey = process.env.ODDS_API_KEY;
    if (oddsApiKey) {
      try {
        const apiRes = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings`);
        const apiData = await apiRes.json() as any[];
        if (Array.isArray(apiData)) {
          apiGames = {
            total: apiData.length,
            games: apiData.slice(0, 10).map((g: any) => `${g.away_team} @ ${g.home_team} (${g.commence_time})`),
          };
        }
      } catch (e: any) {
        apiGames = { total: -1, games: [`API error: ${e.message}`] };
      }
    }

    // 6. Check frontend display window
    const frontendWindow = {
      start: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'Frontend queries odds_snapshots with game_time >= now-4h and <= now+7d, limit 3000',
    };

    // 7. Check games_master for MLB
    const { data: masterGames } = await supabase
      .from('games_master')
      .select('*')
      .eq('league', 'MLB')
      .gte('commence_time_utc', now.toISOString())
      .order('commence_time_utc', { ascending: true })
      .limit(30);

    return res.status(200).json({
      timestamp: now.toISOString(),
      summary: {
        total_mlb_snapshots: totalMlbSnapshots ?? 0,
        distinct_mlb_games: gameMap.size,
        games_with_at_least_1_book: gamesList.filter(g => g.books >= 1).length,
        games_by_date: gamesByDate,
        march_25_games: gamesByDate['2026-03-25'] ?? 0,
        march_26_games: gamesByDate['2026-03-26'] ?? 0,
      },
      games: gamesList,
      sample_openers: (openers ?? []).slice(0, 10),
      odds_api_check: apiGames,
      games_master_mlb: (masterGames ?? []).map((g: any) => ({
        matchup: `${g.away_team} @ ${g.home_team}`,
        time: g.commence_time_utc,
        books_reporting: g.books_reporting,
      })),
      frontend_window: frontendWindow,
      timezone_check: {
        server_utc: now.toISOString(),
        march_25_start: '2026-03-25T00:00:00Z',
        march_25_end: '2026-03-25T23:59:59Z',
        march_26_start: '2026-03-26T00:00:00Z',
        march_26_end: '2026-03-26T23:59:59Z',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
