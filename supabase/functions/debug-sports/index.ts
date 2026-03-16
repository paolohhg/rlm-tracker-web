import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
  
  // Get all active sports (free call, no quota cost)
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`);
  const sports = await res.json();
  
  // Filter basketball
  const basketball = Array.isArray(sports)
    ? sports.filter((s: any) => s.key?.includes('basketball') || s.group?.includes('Basketball'))
    : sports;

  return new Response(JSON.stringify({ basketball, total: Array.isArray(sports) ? sports.length : 0 }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
