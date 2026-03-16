import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Sharp vs Square book classification ─────────────────────
const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker", "heritage"]);

// ── Leagues to track ─────────────────────────────────────────
const LEAGUES = [
  { key: "basketball_nba",    league: "NBA"  },
  { key: "basketball_ncaab",  league: "NCAAB" },
  { key: "baseball_mlb",      league: "MLB"  },
];

const BOOKMAKERS = "draftkings,fanduel,betmgm,pinnacle,williamhill_us,barstool,caesars,pointsbetus";

// ── Smart polling: skip games too far out ────────────────────
// Returns true if we should poll this game right now
function shouldPoll(commenceTime: string): boolean {
  const now = Date.now();
  const tip = new Date(commenceTime).getTime();
  const hoursUntil = (tip - now) / 3600000;

  // Already started or within 12 hours → always poll
  if (hoursUntil <= 12) return true;

  // More than 12 hours out → skip (reduces API usage ~75%)
  return false;
}

// ── Markets per league ────────────────────────────────────────
function marketsForLeague(league: string): string {
  if (league === "MLB") return "spreads,h2h,totals,alternate_runlines";
  return "spreads,h2h,totals";
}

serve(async () => {
  const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  let apiCalls = 0;

  for (const { key, league } of LEAGUES) {
    const markets = marketsForLeague(league);
    const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=${BOOKMAKERS}`;

    let games: Record<string, unknown>[];
    try {
      const res = await fetch(url);
      apiCalls++;
      games = await res.json() as Record<string, unknown>[];
      if (!Array.isArray(games)) continue;
    } catch {
      continue;
    }

    for (const game of games) {
      const commenceTime = game.commence_time as string;

      // Smart polling — skip games too far out
      if (!shouldPoll(commenceTime)) continue;

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
    return new Response(JSON.stringify({ error: "No rows collected", api_calls: apiCalls }), { status: 200 });
  }

  const { error } = await supabase.from("odds_snapshots").insert(rows);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({
    inserted: rows.length,
    api_calls: apiCalls,
    leagues: LEAGUES.map(l => l.league),
  }), { status: 200 });
});
