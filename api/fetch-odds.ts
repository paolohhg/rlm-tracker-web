// Fetches odds from The Odds API and inserts into Supabase.
// Runs every 10 min via Vercel cron (see vercel.json).
// Previously delegated to a Supabase edge function — now runs directly
// in Vercel so it deploys with git push (no separate CLI deploy needed).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ── Sharp vs Square book classification ─────────────────────
const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker", "heritage"]);

// ── Leagues to track ─────────────────────────────────────────
const LEAGUES = [
  { key: "basketball_nba",   league: "NBA"   },
  { key: "basketball_ncaab", league: "NCAAB" },
  { key: "baseball_mlb",     league: "MLB"   },
  { key: "icehockey_nhl",    league: "NHL"   },
];

const BOOKMAKERS = "draftkings,fanduel,betmgm,pinnacle,caesars,pointsbetus,espnbet";

// ── Smart polling logic ──────────────────────────────────────
function shouldPoll(commenceTime: string, alreadySeen: boolean): boolean {
  const now = Date.now();
  const tip = new Date(commenceTime).getTime();
  const hoursUntil = (tip - now) / 3600000;

  if (hoursUntil <= 1) return true;
  if (hoursUntil <= 12) return true;
  if (hoursUntil <= 48) return true;
  if (!alreadySeen) return true;
  return false;
}

// ── Markets per league ────────────────────────────────────────
function marketsForLeague(key: string, league: string): string {
  if (league === "MLB") return "spreads,h2h,totals,alternate_runlines";
  if (league === "NHL") return "h2h,totals,spreads";
  return "spreads,h2h,totals";
}

// ── Retry helper ─────────────────────────────────────────────
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      lastError = err;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oddsApiKey = process.env.ODDS_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }
  if (!oddsApiKey) {
    return res.status(500).json({ error: 'Missing ODDS_API_KEY' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  let apiCalls = 0;

  try {
    // Load seen games for opening line logic
    const { data: seenRows } = await supabase
      .from("odds_snapshots")
      .select("home_team, away_team, league")
      .gte("fetched_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const seenGames = new Set<string>(
      (seenRows ?? []).map((r: any) => `${r.league}|${r.home_team}|${r.away_team}`)
    );

    for (const { key, league } of LEAGUES) {
      const markets = marketsForLeague(key, league);
      const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${oddsApiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=${BOOKMAKERS}`;

      let games: Record<string, unknown>[];
      try {
        const apiRes = await fetchWithRetry(url);
        apiCalls++;

        if (!apiRes.ok) {
          const body = await apiRes.text();
          const errMsg = `League fetch failed: HTTP ${apiRes.status} — ${body.slice(0, 200)}`;
          console.error(`[fetch-odds] ${league} (${key}): ${errMsg}`);
          errors.push(errMsg);
          continue;
        }

        games = await apiRes.json() as Record<string, unknown>[];
        if (!Array.isArray(games)) {
          errors.push(`${league}: API returned non-array`);
          continue;
        }
      } catch (err: any) {
        errors.push(`${league}: ${err.message}`);
        continue;
      }

      for (const game of games) {
        const commenceTime = game.commence_time as string;
        const gameSeenKey = `${league}|${game.home_team}|${game.away_team}`;
        const alreadySeen = seenGames.has(gameSeenKey);

        if (!shouldPoll(commenceTime, alreadySeen)) continue;

        const bookmakers = (game.bookmakers as Record<string, unknown>[]) ?? [];

        for (const bookmaker of bookmakers) {
          const bookKey = bookmaker.key as string;
          const bookType = SHARP_BOOKS.has(bookKey) ? "sharp" : "square";
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

            if (mKey === "spreads") {
              for (const o of outcomes) {
                if (o.name === game.home_team) {
                  spread = o.point as number;
                  spreadHomePrice = o.price as number;
                }
              }
            }

            if (mKey === "h2h") {
              for (const o of outcomes) {
                if (o.name === game.home_team) moneylineHome = o.price as number;
                if (o.name === game.away_team) moneylineAway = o.price as number;
              }
            }

            if (mKey === "totals") {
              for (const o of outcomes) {
                if (o.name === "Over") { total = o.point as number; totalOverPrice = o.price as number; }
                if (o.name === "Under") totalUnderPrice = o.price as number;
              }
            }

            if (mKey === "alternate_runlines" || (league === "MLB" && mKey === "spreads")) {
              for (const o of outcomes) {
                if (o.name === game.home_team) {
                  runlineHome = o.point as number;
                  runlineHomePrice = o.price as number;
                }
                if (o.name === game.away_team) {
                  runlineAway = o.point as number;
                  runlineAwayPrice = o.price as number;
                }
              }
            }
          }

          rows.push({
            league,
            game_time: commenceTime,
            home_team: game.home_team,
            away_team: game.away_team,
            bookmaker: bookKey,
            book_type: bookType,
            spread,
            spread_home_price: spreadHomePrice,
            moneyline_home: moneylineHome,
            moneyline_away: moneylineAway,
            total,
            total_over_price: totalOverPrice,
            total_under_price: totalUnderPrice,
            runline_home: runlineHome,
            runline_away: runlineAway,
            runline_home_price: runlineHomePrice,
            runline_away_price: runlineAwayPrice,
            fetched_at: now,
          });
        }
      }
    }

    if (!rows.length) {
      const msg = errors.length
        ? `No rows collected. Errors: ${errors.join('; ')}`
        : 'No rows collected (no games found across all leagues)';
      return res.status(errors.length ? 502 : 200).json({ error: msg, api_calls: apiCalls, errors });
    }

    const { error: insertError } = await supabase.from("odds_snapshots").insert(rows);
    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    const leagueCounts: Record<string, number> = {};
    for (const r of rows) {
      leagueCounts[r.league as string] = (leagueCounts[r.league as string] || 0) + 1;
    }

    return res.status(200).json({
      ok: true,
      inserted: rows.length,
      api_calls: apiCalls,
      leagues: LEAGUES.map(l => l.league),
      league_counts: leagueCounts,
      ...(errors.length ? { partial_errors: errors } : {}),
    });
  } catch (err: any) {
    console.error('[fetch-odds] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
