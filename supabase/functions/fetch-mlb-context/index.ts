import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Ballpark coordinates for weather lookup ──────────────────
const BALLPARK_COORDS: Record<string, { lat: number; lon: number; name: string; isCoors: boolean; parkFactorRuns: number }> = {
  "Arizona Diamondbacks":    { lat: 33.4453, lon: -112.0667, name: "Chase Field",           isCoors: false, parkFactorRuns: 100 },
  "Atlanta Braves":          { lat: 33.8908, lon: -84.4678,  name: "Truist Park",            isCoors: false, parkFactorRuns: 99  },
  "Baltimore Orioles":       { lat: 39.2839, lon: -76.6218,  name: "Camden Yards",           isCoors: false, parkFactorRuns: 100 },
  "Boston Red Sox":          { lat: 42.3467, lon: -71.0972,  name: "Fenway Park",            isCoors: false, parkFactorRuns: 104 },
  "Chicago Cubs":            { lat: 41.9484, lon: -87.6553,  name: "Wrigley Field",          isCoors: false, parkFactorRuns: 103 },
  "Chicago White Sox":       { lat: 41.8300, lon: -87.6339,  name: "Guaranteed Rate Field",  isCoors: false, parkFactorRuns: 97  },
  "Cincinnati Reds":         { lat: 39.0979, lon: -84.5082,  name: "Great American Ball Park",isCoors: false, parkFactorRuns: 105 },
  "Cleveland Guardians":     { lat: 41.4962, lon: -81.6852,  name: "Progressive Field",      isCoors: false, parkFactorRuns: 97  },
  "Colorado Rockies":        { lat: 39.7559, lon: -104.9942, name: "Coors Field",             isCoors: true,  parkFactorRuns: 113 },
  "Detroit Tigers":          { lat: 42.3390, lon: -83.0485,  name: "Comerica Park",          isCoors: false, parkFactorRuns: 97  },
  "Houston Astros":          { lat: 29.7573, lon: -95.3555,  name: "Minute Maid Park",       isCoors: false, parkFactorRuns: 99  },
  "Kansas City Royals":      { lat: 39.0517, lon: -94.4803,  name: "Kauffman Stadium",       isCoors: false, parkFactorRuns: 98  },
  "Los Angeles Angels":      { lat: 33.8003, lon: -117.8827, name: "Angel Stadium",          isCoors: false, parkFactorRuns: 98  },
  "Los Angeles Dodgers":     { lat: 34.0739, lon: -118.2400, name: "Dodger Stadium",         isCoors: false, parkFactorRuns: 97  },
  "Miami Marlins":           { lat: 25.7781, lon: -80.2197,  name: "loanDepot park",         isCoors: false, parkFactorRuns: 94  },
  "Milwaukee Brewers":       { lat: 43.0280, lon: -87.9712,  name: "American Family Field",  isCoors: false, parkFactorRuns: 97  },
  "Minnesota Twins":         { lat: 44.9817, lon: -93.2776,  name: "Target Field",           isCoors: false, parkFactorRuns: 98  },
  "New York Mets":           { lat: 40.7571, lon: -73.8458,  name: "Citi Field",             isCoors: false, parkFactorRuns: 96  },
  "New York Yankees":        { lat: 40.8296, lon: -73.9262,  name: "Yankee Stadium",         isCoors: false, parkFactorRuns: 103 },
  "Oakland Athletics":       { lat: 32.7473, lon: -97.0833,  name: "Globe Life Field",       isCoors: false, parkFactorRuns: 99  },
  "Philadelphia Phillies":   { lat: 39.9061, lon: -75.1665,  name: "Citizens Bank Park",     isCoors: false, parkFactorRuns: 104 },
  "Pittsburgh Pirates":      { lat: 40.4469, lon: -80.0057,  name: "PNC Park",               isCoors: false, parkFactorRuns: 97  },
  "San Diego Padres":        { lat: 32.7076, lon: -117.1570, name: "Petco Park",             isCoors: false, parkFactorRuns: 93  },
  "San Francisco Giants":    { lat: 37.7786, lon: -122.3893, name: "Oracle Park",            isCoors: false, parkFactorRuns: 93  },
  "Seattle Mariners":        { lat: 47.5914, lon: -122.3325, name: "T-Mobile Park",          isCoors: false, parkFactorRuns: 95  },
  "St. Louis Cardinals":     { lat: 38.6226, lon: -90.1928,  name: "Busch Stadium",          isCoors: false, parkFactorRuns: 98  },
  "Tampa Bay Rays":          { lat: 27.7683, lon: -82.6534,  name: "Tropicana Field",        isCoors: false, parkFactorRuns: 97  },
  "Texas Rangers":           { lat: 32.7473, lon: -97.0833,  name: "Globe Life Field",       isCoors: false, parkFactorRuns: 101 },
  "Toronto Blue Jays":       { lat: 43.6414, lon: -79.3894,  name: "Rogers Centre",          isCoors: false, parkFactorRuns: 103 },
  "Washington Nationals":    { lat: 38.8730, lon: -77.0074,  name: "Nationals Park",         isCoors: false, parkFactorRuns: 99  },
};

// ── Weather fetch (Open-Meteo, free, no key needed) ──────────
async function fetchWeather(lat: number, lon: number): Promise<{
  temperature: number; windSpeed: number; windDirection: string;
  humidity: number; precipProbability: number;
} | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json() as Record<string, unknown>;
    const hourly = data.hourly as Record<string, number[]>;

    // Get the reading closest to current time
    const idx = Math.min(new Date().getHours(), (hourly.temperature_2m?.length ?? 1) - 1);

    const windDir = hourly.wind_direction_10m?.[idx] ?? 0;
    const dirLabel = windDir < 45 ? "N" : windDir < 135 ? "E" : windDir < 225 ? "S" : windDir < 315 ? "W" : "N";

    return {
      temperature: Math.round(hourly.temperature_2m?.[idx] ?? 70),
      windSpeed: Math.round(hourly.wind_speed_10m?.[idx] ?? 0),
      windDirection: dirLabel,
      humidity: Math.round(hourly.relative_humidity_2m?.[idx] ?? 50),
      precipProbability: Math.round(hourly.precipitation_probability?.[idx] ?? 0),
    };
  } catch {
    return null;
  }
}

// ── Evaluate context signals ─────────────────────────────────
function evaluateContextSignals(ctx: {
  weather: { windSpeed: number; windDirection: string; temperature: number; precipProbability: number } | null;
  isCoors: boolean;
  homeStarterRegression: number | null;
  awayStarterRegression: number | null;
  homeBullpenPitches24h: number;
  awayBullpenPitches24h: number;
  homeCloserUsed: boolean;
  awayCloserUsed: boolean;
  missingRegularsHome: boolean;
  missingRegularsAway: boolean;
}): { signals: string[]; score: number } {
  const signals: string[] = [];
  let score = 0;

  // Weather signals
  if (ctx.weather) {
    const { windSpeed, windDirection, temperature, precipProbability } = ctx.weather;
    if (windSpeed >= 20) {
      signals.push(windDirection === "OUT" || windDirection === "E" || windDirection === "NE"
        ? "WEATHER_OVER_EDGE" : "WEATHER_UNDER_EDGE");
      score += 15;
    } else if (windSpeed >= 15) {
      signals.push("WEATHER_TOTAL_SIGNAL");
      score += 10;
    }
    if (temperature < 45) { signals.push("COLD_RUN_SUPPRESSOR"); score += 15; }
    if (precipProbability > 60) { signals.push("RAIN_DELAY_RISK"); score += 5; }
  }

  // Coors baseline
  if (ctx.isCoors) { signals.push("COORS_OVER_BASELINE"); score += 10; }

  // Pitcher regression
  if (ctx.homeStarterRegression !== null && ctx.homeStarterRegression > 1.5) {
    signals.push("HOME_PITCHER_REGRESSION_FADE"); score += 15;
  }
  if (ctx.awayStarterRegression !== null && ctx.awayStarterRegression > 1.5) {
    signals.push("AWAY_PITCHER_REGRESSION_FADE"); score += 15;
  }
  if (ctx.homeStarterRegression !== null && ctx.homeStarterRegression < -1) {
    signals.push("HOME_PITCHER_UNDERVALUED"); score += 15;
  }
  if (ctx.awayStarterRegression !== null && ctx.awayStarterRegression < -1) {
    signals.push("AWAY_PITCHER_UNDERVALUED"); score += 15;
  }

  // Bullpen fatigue
  if (ctx.homeBullpenPitches24h > 80 || ctx.homeCloserUsed) {
    signals.push("HOME_BULLPEN_FATIGUE"); score += 15;
  }
  if (ctx.awayBullpenPitches24h > 80 || ctx.awayCloserUsed) {
    signals.push("AWAY_BULLPEN_FATIGUE"); score += 15;
  }

  // Lineup issues
  if (ctx.missingRegularsHome) { signals.push("HOME_LINEUP_DOWNGRADE"); score += 15; }
  if (ctx.missingRegularsAway) { signals.push("AWAY_LINEUP_DOWNGRADE"); score += 15; }

  return { signals, score };
}

// ── Edge grade calculator ────────────────────────────────────
function calcEdgeGrade(baseScore: number, contextScore: number): { score: number; grade: string } {
  const total = Math.min(100, baseScore + contextScore);
  let grade = "D";
  if (total >= 90) grade = "A+";
  else if (total >= 75) grade = "A";
  else if (total >= 60) grade = "B+";
  else if (total >= 45) grade = "B";
  else if (total >= 25) grade = "C";
  return { score: total, grade };
}

// ── Main handler ─────────────────────────────────────────────
serve(async () => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Get today's MLB tipoff snapshots
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: games } = await supabase
    .from("tipoff_snapshots")
    .select("*")
    .eq("league", "MLB")
    .gte("game_time", today.toISOString())
    .order("game_time", { ascending: true });

  if (!games?.length) {
    return new Response(JSON.stringify({ ok: true, message: "No MLB games today" }), { status: 200 });
  }

  // Get existing pitcher stats
  const { data: pitcherStats } = await supabase
    .from("mlb_pitcher_stats")
    .select("*")
    .eq("season", 2026);

  const pitcherMap: Record<string, Record<string, unknown>> = {};
  for (const p of pitcherStats ?? []) {
    pitcherMap[(p.player_name as string).toLowerCase()] = p;
  }

  const results = [];

  for (const game of games) {
    const ballpark = BALLPARK_COORDS[game.home_team as string];
    const weather = ballpark ? await fetchWeather(ballpark.lat, ballpark.lon) : null;

    // Look up pitcher stats
    const homeSP = game.home_starter ? pitcherMap[String(game.home_starter).toLowerCase()] : null;
    const awaySP = game.away_starter ? pitcherMap[String(game.away_starter).toLowerCase()] : null;

    const homeRegression = homeSP ? (homeSP.regression_score as number) : null;
    const awayRegression = awaySP ? (awaySP.regression_score as number) : null;

    // Evaluate context
    const { signals, score: contextScore } = evaluateContextSignals({
      weather,
      isCoors: ballpark?.isCoors ?? false,
      homeStarterRegression: homeRegression,
      awayStarterRegression: awayRegression,
      homeBullpenPitches24h: (game.home_bullpen_pitches_24h as number) ?? 0,
      awayBullpenPitches24h: (game.away_bullpen_pitches_24h as number) ?? 0,
      homeCloserUsed: (game.home_closer_used as boolean) ?? false,
      awayCloserUsed: (game.away_closer_used as boolean) ?? false,
      missingRegularsHome: !!game.missing_regulars_home,
      missingRegularsAway: !!game.missing_regulars_away,
    });

    const { score: edgeScore, grade: edgeGrade } = calcEdgeGrade(0, contextScore);

    const row = {
      game_id: game.game_id ?? `MLB|${game.home_team}|${game.away_team}`,
      game_time: game.game_time,
      league: "MLB",
      home_team: game.home_team,
      away_team: game.away_team,
      home_starter: game.home_starter ?? null,
      away_starter: game.away_starter ?? null,
      starter_confirmed: game.starter_confirmed ?? false,
      home_sp_era: homeSP?.era ?? null,
      home_sp_xera: homeSP?.xera ?? null,
      home_sp_fip: homeSP?.fip ?? null,
      home_sp_regression_score: homeRegression,
      away_sp_era: awaySP?.era ?? null,
      away_sp_xera: awaySP?.xera ?? null,
      away_sp_fip: awaySP?.fip ?? null,
      away_sp_regression_score: awayRegression,
      temperature: weather?.temperature ?? null,
      wind_speed: weather?.windSpeed ?? null,
      wind_direction: weather?.windDirection ?? null,
      humidity: weather?.humidity ?? null,
      precip_probability: weather?.precipProbability ?? null,
      ballpark: ballpark?.name ?? null,
      park_factor_runs: ballpark?.parkFactorRuns ?? null,
      is_coors: ballpark?.isCoors ?? false,
      context_signals: signals,
      edge_score: edgeScore,
      edge_grade: edgeGrade,
      updated_at: new Date().toISOString(),
    };

    // Upsert by game_id
    const { error } = await supabase
      .from("mlb_game_context")
      .upsert(row, { onConflict: "game_id" });

    if (!error) results.push(row.game_id);
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: results.length,
    games: results,
  }), { status: 200 });
});
