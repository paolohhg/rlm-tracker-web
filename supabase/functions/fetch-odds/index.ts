import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Sharp vs Square book classification ─────────────────────
const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker", "heritage"]);

// ── Leagues to track ─────────────────────────────────────────
const LEAGUES = [
  { key: "basketball_nba",          league: "NBA"   },
  { key: "basketball_ncaab",        league: "NCAAB" },
  { key: "basketball_ncaab_nit",    league: "NCAAB" }, // NIT Tournament
  { key: "baseball_mlb",            league: "MLB"   },
  { key: "baseball_mlb_preseason",  league: "MLB"   }, // Spring Training
  { key: "icehockey_nhl",           league: "NHL"   },
];

const BOOKMAKERS = "draftkings,fanduel,betmgm,pinnacle,caesars,pointsbetus,espnbet";

// ── Smart polling logic ──────────────────────────────────────
// Controls how often we poll each game.
// ALWAYS capture games regardless of distance — we need opening lines.
// For games far out, we just poll less frequently to save API quota.
function shouldPoll(commenceTime: string, alreadySeen: boolean): boolean {
  const now = Date.now();
  const tip = new Date(commenceTime).getTime();
  const hoursUntil = (tip - now) / 3600000;

  // Game already started or within 1 hour → always poll
  if (hoursUntil <= 1) return true;

  // Within 12 hours → always poll (lines moving fastest)
  if (hoursUntil <= 12) return true;

  // 12–48 hours out → poll every 30 min (handled by cron, just let it through)
  if (hoursUntil <= 48) return true;

  // More than 48 hours out → only capture if not yet seen (opening line capture)
  // Once we have a snapshot, skip until within 48h
  if (!alreadySeen) return true; // Always grab opening line first time

  return false; // Already have opener, skip until closer
}

// ── Markets per league ────────────────────────────────────────
function marketsForLeague(key: string, league: string): string {
  // MLB preseason doesn't support alternate_runlines
  if (league === "MLB" && key.includes("preseason")) return "spreads,h2h,totals";
  if (league === "MLB") return "spreads,h2h,totals,alternate_runlines";
  if (league === "NHL") return "h2h,totals,spreads"; // puck line = spreads
  return "spreads,h2h,totals";
}

// ── Retry helper with exponential backoff ──────────────────────
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res; // Don't retry client errors
      console.error(`[fetch-odds] HTTP ${res.status} on attempt ${attempt + 1} for ${url.split('?')[0]}`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      console.error(`[fetch-odds] Network error on attempt ${attempt + 1}: ${err.message}`);
      lastError = err;
    }
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}

serve(async () => {
  const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  let apiCalls = 0;

  // Load set of game+bookmaker combos already seen (for opening line logic)
  const { data: seenRows } = await supabase
    .from("odds_snapshots")
    .select("home_team, away_team, league")
    .gte("fetched_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  const seenGames = new Set<string>(
    (seenRows ?? []).map((r: any) => `${r.league}|${r.home_team}|${r.away_team}`)
  );

  for (const { key, league } of LEAGUES) {
    const markets = marketsForLeague(key, league);
    const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=${BOOKMAKERS}`;

    let games: Record<string, unknown>[];
    try {
      const res = await fetchWithRetry(url);
      apiCalls++;
      games = await res.json() as Record<string, unknown>[];
      if (!Array.isArray(games)) {
        const errMsg = `[fetch-odds] ${league} (${key}): API returned non-array response`;
        console.error(errMsg);
        errors.push(errMsg);
        continue;
      }
    } catch (err: any) {
      const errMsg = `[fetch-odds] ${league} (${key}): Failed after retries — ${err.message}`;
      console.error(errMsg);
      errors.push(errMsg);
      continue;
    }

    for (const game of games) {
      const commenceTime = game.commence_time as string;
      const gameSeenKey = `${league}|${game.home_team}|${game.away_team}`;
      const alreadySeen = seenGames.has(gameSeenKey);

      // Smart polling — always capture openers, throttle far-out games
      if (!shouldPoll(commenceTime, alreadySeen)) continue;

      const bookmakers = (game.bookmakers as Record<string, unknown>[]) ?? [];

      for (const bookmaker of bookmakers) {
        const bookKey = bookmaker.key as string;
        const bookType = SHARP_BOOKS.has(bookKey) ? "sharp" : "square";
        const markets_list = (bookmaker.markets as Record<string, unknown>[]) ?? [];

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

        for (const market of markets_list) {
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

          // MLB runline (alternate_runlines or spreads for MLB)
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
          // Spread
          spread,
          spread_home_price: spreadHomePrice,
          // Moneyline
          moneyline_home: moneylineHome,
          moneyline_away: moneylineAway,
          // Totals
          total,
          total_over_price: totalOverPrice,
          total_under_price: totalUnderPrice,
          // Runline (MLB)
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
    console.error(`[fetch-odds] ${msg}`);
    return new Response(JSON.stringify({ error: msg, api_calls: apiCalls, errors }), { status: errors.length ? 502 : 200 });
  }

  const { error } = await supabase.from("odds_snapshots").insert(rows);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Count rows per league for debugging
  const leagueCounts: Record<string, number> = {};
  for (const r of rows) {
    leagueCounts[r.league as string] = (leagueCounts[r.league as string] || 0) + 1;
  }

  return new Response(JSON.stringify({
    inserted: rows.length,
    api_calls: apiCalls,
    leagues: LEAGUES.map(l => l.league),
    league_counts: leagueCounts,
    ...(errors.length ? { partial_errors: errors } : {}),
  }), { status: 200 });
});
