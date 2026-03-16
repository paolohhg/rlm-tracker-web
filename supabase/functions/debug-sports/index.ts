import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
  
  // Try NCAAB with NO bookmaker filter to see all available games
  const res = await fetch(
    `https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&oddsFormat=american`
  );
  const data = await res.json();
  
  const summary = Array.isArray(data)
    ? data.slice(0, 10).map((g: any) => ({
        game: `${g.away_team} @ ${g.home_team}`,
        time: g.commence_time,
        books: g.bookmakers?.length ?? 0,
      }))
    : data;

  return new Response(JSON.stringify({
    count: Array.isArray(data) ? data.length : 0,
    games: summary,
    remaining: res.headers.get('x-requests-remaining'),
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
