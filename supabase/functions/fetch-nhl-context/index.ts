// ─── fetch-nhl-context — NHL goalie & context fetcher ────────────────────────
// Source: ESPN NHL scoreboard API for goalie probables
// Writes: nhl_game_context table
// Cron: every 30 min on game days
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── ESPN NHL scoreboard API ──────────────────────────────────────────────────

interface ESPNGoalie {
  displayName: string;
  shortName?: string;
  headshot?: { href: string };
  statistics?: { name: string; displayValue: string }[];
}

interface ESPNCompetitor {
  homeAway: "home" | "away";
  team: { displayName: string; shortDisplayName?: string };
  probables?: ESPNGoalie[];
  records?: { summary: string; type: string }[];
}

interface ESPNEvent {
  id: string;
  date: string;
  competitions: {
    id: string;
    competitors: ESPNCompetitor[];
    status?: { type?: { name?: string } };
    venue?: { fullName?: string };
    broadcasts?: { names?: string[] }[];
  }[];
}

async function fetchESPNScoreboard(): Promise<ESPNEvent[]> {
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard"
    );
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}

// ── Goalie stat lookup from ESPN athlete stats (optional enrichment) ─────────

async function fetchGoalieStats(goalieName: string): Promise<{
  gaa: number | null;
  svPct: number | null;
  record: string | null;
} | null> {
  // ESPN probables sometimes include stats inline; if not, return nulls
  // The scoreboard API often has stats in the probables array
  return null; // Stats come from the probables object directly when available
}

// ── Context signal evaluation ────────────────────────────────────────────────

function evaluateNHLContext(ctx: {
  homeGoalieStatus: string;
  awayGoalieStatus: string;
  homeGoalieGaa: number | null;
  awayGoalieGaa: number | null;
  homeGoalieSvPct: number | null;
  awayGoalieSvPct: number | null;
  isBackToBack: boolean;
  isPlayoffs: boolean;
}): { signals: string[]; score: number } {
  const signals: string[] = [];
  let score = 50; // Neutral baseline

  // Goalie confirmation status
  if (ctx.homeGoalieStatus === "confirmed" && ctx.awayGoalieStatus === "confirmed") {
    signals.push("BOTH_GOALIES_CONFIRMED");
    score += 5;
  } else if (ctx.homeGoalieStatus === "unconfirmed" || ctx.awayGoalieStatus === "unconfirmed") {
    signals.push("GOALIE_UNCONFIRMED");
    score -= 5;
  }

  // Backup goalie detection (GAA > 3.2 or svPct < .900 = likely backup-tier)
  if (ctx.homeGoalieGaa !== null && ctx.homeGoalieGaa > 3.2) {
    signals.push("HOME_BACKUP_GOALIE");
    score -= 10;
  }
  if (ctx.awayGoalieGaa !== null && ctx.awayGoalieGaa > 3.2) {
    signals.push("AWAY_BACKUP_GOALIE");
    score -= 10;
  }

  // Elite goalie detection (GAA < 2.3 and svPct > .920)
  if (ctx.homeGoalieGaa !== null && ctx.homeGoalieSvPct !== null &&
      ctx.homeGoalieGaa < 2.3 && ctx.homeGoalieSvPct > 0.920) {
    signals.push("HOME_ELITE_GOALIE");
    score += 10;
  }
  if (ctx.awayGoalieGaa !== null && ctx.awayGoalieSvPct !== null &&
      ctx.awayGoalieGaa < 2.3 && ctx.awayGoalieSvPct > 0.920) {
    signals.push("AWAY_ELITE_GOALIE");
    score += 10;
  }

  // Save percentage mismatch (>= .015 gap = significant)
  if (ctx.homeGoalieSvPct !== null && ctx.awayGoalieSvPct !== null) {
    const gap = Math.abs(ctx.homeGoalieSvPct - ctx.awayGoalieSvPct);
    if (gap >= 0.015) {
      const better = ctx.homeGoalieSvPct > ctx.awayGoalieSvPct ? "HOME" : "AWAY";
      signals.push(`${better}_GOALIE_EDGE`);
      score += (better === "HOME" ? 8 : -8);
    }
  }

  // GAA mismatch (>= 0.8 gap)
  if (ctx.homeGoalieGaa !== null && ctx.awayGoalieGaa !== null) {
    const gaaGap = Math.abs(ctx.homeGoalieGaa - ctx.awayGoalieGaa);
    if (gaaGap >= 0.8) {
      const better = ctx.homeGoalieGaa < ctx.awayGoalieGaa ? "HOME" : "AWAY";
      signals.push(`${better}_GAA_EDGE`);
      score += (better === "HOME" ? 7 : -7);
    }
  }

  // Back-to-back fatigue
  if (ctx.isBackToBack) {
    signals.push("BACK_TO_BACK");
    score -= 8;
  }

  // Playoffs intensity
  if (ctx.isPlayoffs) {
    signals.push("PLAYOFF_GAME");
    score += 5;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return { signals, score };
}

// ── Edge grade from context score ────────────────────────────────────────────

function calcEdgeGrade(score: number): { score: number; grade: string } {
  let grade = "D";
  if (score >= 90) grade = "A+";
  else if (score >= 75) grade = "A";
  else if (score >= 60) grade = "B+";
  else if (score >= 45) grade = "B";
  else if (score >= 25) grade = "C";
  return { score, grade };
}

// ── Parse goalie stats from ESPN probables ───────────────────────────────────

function parseGoalieFromProbable(probable: ESPNGoalie | undefined): {
  name: string | null;
  gaa: number | null;
  svPct: number | null;
} {
  if (!probable) return { name: null, gaa: null, svPct: null };

  const name = probable.displayName ?? probable.shortName ?? null;
  let gaa: number | null = null;
  let svPct: number | null = null;

  if (probable.statistics) {
    for (const stat of probable.statistics) {
      const n = (stat.name ?? "").toLowerCase();
      const val = parseFloat(stat.displayValue ?? "");
      if (!isNaN(val)) {
        if (n === "goalsagainstaverage" || n === "gaa") gaa = val;
        if (n === "savepercentage" || n === "savepct" || n === "svpct" || n === "saves") {
          svPct = val > 1 ? val / 100 : val; // Normalize: ESPN sometimes gives 91.5 vs 0.915
        }
      }
    }
  }

  return { name, gaa, svPct };
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch today's NHL games from ESPN
    const events = await fetchESPNScoreboard();

    if (events.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "No NHL games today", processed: 0 }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const results: string[] = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      // Skip games that are already final
      const statusName = comp.status?.type?.name ?? "";
      if (statusName === "STATUS_FINAL" || statusName === "STATUS_POSTPONED") continue;

      const homeComp = comp.competitors.find(c => c.homeAway === "home");
      const awayComp = comp.competitors.find(c => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team.displayName;
      const awayTeam = awayComp.team.displayName;
      const gameTime = event.date;
      const gameId = `NHL|${homeTeam}|${awayTeam}`;

      // Parse goalie probables
      const homeGoalie = parseGoalieFromProbable(homeComp.probables?.[0]);
      const awayGoalie = parseGoalieFromProbable(awayComp.probables?.[0]);

      // Determine confirmation status
      // ESPN lists probables once confirmed; if present, treat as confirmed
      const homeGoalieStatus = homeGoalie.name ? "confirmed" : "unconfirmed";
      const awayGoalieStatus = awayGoalie.name ? "confirmed" : "unconfirmed";

      // Check if either team played yesterday (back-to-back detection)
      // Simple heuristic: if game is before 3pm ET, likely a B2B
      const gameHourET = new Date(gameTime).getUTCHours() - 5; // rough ET
      const isBackToBack = false; // Would need yesterday's schedule — keep false for now

      // Playoff detection
      const isPlayoffs = new Date(gameTime).getMonth() >= 3; // April+ = playoffs possible

      // Evaluate context
      const { signals, score: contextScore } = evaluateNHLContext({
        homeGoalieStatus,
        awayGoalieStatus,
        homeGoalieGaa: homeGoalie.gaa,
        awayGoalieGaa: awayGoalie.gaa,
        homeGoalieSvPct: homeGoalie.svPct,
        awayGoalieSvPct: awayGoalie.svPct,
        isBackToBack,
        isPlayoffs,
      });

      const { score: edgeScore, grade: edgeGrade } = calcEdgeGrade(contextScore);

      const row = {
        game_id: gameId,
        game_time: gameTime,
        league: "NHL",
        home_team: homeTeam,
        away_team: awayTeam,
        home_goalie: homeGoalie.name,
        away_goalie: awayGoalie.name,
        home_goalie_status: homeGoalieStatus,
        away_goalie_status: awayGoalieStatus,
        home_goalie_gaa: homeGoalie.gaa,
        away_goalie_gaa: awayGoalie.gaa,
        home_goalie_sv_pct: homeGoalie.svPct,
        away_goalie_sv_pct: awayGoalie.svPct,
        context_signals: signals,
        edge_score: edgeScore,
        edge_grade: edgeGrade,
        updated_at: new Date().toISOString(),
      };

      // Upsert by game_id
      const { error } = await supabase
        .from("nhl_game_context")
        .upsert(row, { onConflict: "game_id" });

      if (!error) results.push(gameId);
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, games: results }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
