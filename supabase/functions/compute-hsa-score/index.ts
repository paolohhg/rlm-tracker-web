// ─── compute-hsa-score — Universal 6-axis HSA scoring engine ───────────────
// Reads: rlm_alerts, splits_snapshots, odds_snapshots, mlb_game_context, nhl_game_context
// Writes: rlm_alerts (score_* columns + hsa_score)
// Run after detect-rlm on a cron or chained invocation.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { centMove } from "../../../api/lib/hsa/odds/cent-line.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Scoring functions ──────────────────────────────────────────────────────

/** Coordination (0-25): How many books moved in the same direction */
function scoreCoordination(booksAgreeing: number, totalBooks: number): number {
  if (totalBooks <= 0) return 0;
  return Math.min(25, Math.round((booksAgreeing / totalBooks) * 25));
}

/** Velocity (0-20): Speed of market movement */
function scoreVelocity(velocityPerHour: number, league: string): number {
  // NHL/MLB moneylines move in cents, so velocity thresholds differ
  const isMLPrimary = league === "NHL" || league === "MLB";

  if (isMLPrimary) {
    // Velocity in cents per hour for ML-primary sports
    if (velocityPerHour >= 1.0) return 20; // spread moving fast
    if (velocityPerHour >= 0.5) return 15;
    if (velocityPerHour >= 0.2) return 10;
    if (velocityPerHour >= 0.1) return 5;
    return 0;
  }

  // Basketball: spread pts per hour
  if (velocityPerHour >= 1.0) return 20;
  if (velocityPerHour >= 0.5) return 15;
  if (velocityPerHour >= 0.3) return 10;
  if (velocityPerHour >= 0.1) return 5;
  return 0;
}

/** Pressure vs Public (0-20): Line moving against public side */
function scorePressureVsPublic(
  lineMoveDirection: number, // positive = toward away, negative = toward home
  homeBetsPct: number | null,
  homeMoneyPct: number | null,
): number {
  if (homeBetsPct == null) return 0; // No splits data

  // Public side = side with more tickets
  const publicOnHome = homeBetsPct > 50;
  const lineMovedTowardPublic = publicOnHome ? lineMoveDirection < 0 : lineMoveDirection > 0;

  // RLM = line moved AGAINST public
  if (lineMovedTowardPublic) return 0; // No RLM pressure

  const publicPct = publicOnHome ? homeBetsPct : (100 - homeBetsPct);

  // Ticket vs money divergence (sharp vs public)
  let divergenceBonus = 0;
  if (homeMoneyPct != null) {
    const moneyOnPublicSide = publicOnHome ? homeMoneyPct : (100 - homeMoneyPct);
    const divergence = publicPct - moneyOnPublicSide; // positive = more tickets than money on public side
    if (divergence > 15) divergenceBonus = 8;
    else if (divergence > 10) divergenceBonus = 5;
    else if (divergence > 5) divergenceBonus = 3;
  }

  // Base score from public % magnitude
  let base = 0;
  if (publicPct >= 75) base = 12;
  else if (publicPct >= 70) base = 10;
  else if (publicPct >= 65) base = 7;
  else if (publicPct >= 60) base = 4;

  return Math.min(20, base + divergenceBonus);
}

/** Stability (0-15): Did the move hold or reverse? */
function scoreStability(snapshots: any[], league: string): number {
  if (snapshots.length < 3) return 8; // Not enough data, neutral

  // Get last 3 snapshots with spread data
  const recent = snapshots
    .filter((s: any) => s.spread != null)
    .slice(-5);

  if (recent.length < 3) return 8;

  const spreads = recent.map((s: any) => s.spread as number);
  const first = spreads[0];
  const last = spreads[spreads.length - 1];
  const mid = spreads[Math.floor(spreads.length / 2)];

  const initialMove = mid - first;
  const continuation = last - mid;

  // Move extended in same direction = strong hold
  if (Math.sign(initialMove) === Math.sign(continuation) && Math.abs(continuation) > 0.1) {
    return 15;
  }

  // Move held steady
  if (Math.abs(last - mid) < 0.3) {
    return 12;
  }

  // Partial reversal
  if (Math.sign(initialMove) !== Math.sign(continuation) && Math.abs(continuation) < Math.abs(initialMove)) {
    return 5;
  }

  // Full reversal
  return 0;
}

/** Breadth (0-10): Do related markets confirm the move? */
function scoreBreadth(snapshots: any[]): number {
  if (snapshots.length < 2) return 0;

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  let score = 0;

  // Check if total moved in confirming direction
  // Spread toward one team + total move = game script confirmation
  if (first.total != null && last.total != null) {
    const totalMove = last.total - first.total;
    if (Math.abs(totalMove) >= 0.5) score += 5;
  }

  // Check if moneyline moved in same direction as spread
  if (first.moneyline_home != null && last.moneyline_home != null && first.spread != null && last.spread != null) {
    const spreadMove = last.spread - first.spread;
    const mlMove = centMove(first.moneyline_home, last.moneyline_home);
    // Spread more negative = home more favored. ML more negative = home more favored.
    if (Math.sign(spreadMove) === Math.sign(mlMove) && Math.abs(mlMove) >= 5) {
      score += 5;
    }
  }

  return Math.min(10, score);
}

/** Context (-10 to +10): Sport-specific context adjustment */
function scoreContext(
  league: string,
  mlbContext: any | null,
  nhlContext: any | null,
): number {
  if (league === "MLB" && mlbContext?.edge_score != null) {
    // edge_score is typically 0-100, normalize to -10 to +10
    const normalized = ((mlbContext.edge_score - 50) / 50) * 10;
    return Math.max(-10, Math.min(10, Math.round(normalized)));
  }

  if (league === "NHL" && nhlContext?.edge_score != null) {
    const normalized = ((nhlContext.edge_score - 50) / 50) * 10;
    return Math.max(-10, Math.min(10, Math.round(normalized)));
  }

  // NBA/NCAAB: no context module yet, neutral
  return 0;
}

// ─── Tier from HSA score ────────────────────────────────────────────────────

function hsaTier(score: number): string {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 70) return "B+";
  if (score >= 60) return "B";
  if (score >= 55) return "C+";
  return "C";
}

// ─── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all alerts that need scoring (detected in last 24h)
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: alerts, error: alertErr } = await supabase
      .from("rlm_alerts")
      .select("*")
      .gte("detected_at", windowStart);

    if (alertErr) throw alertErr;
    if (!alerts || alerts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No alerts to score", scored: 0 }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let scored = 0;

    for (const alert of alerts) {
      const { home_team, away_team, league } = alert;

      // 1. Get recent odds snapshots for this game (for stability + breadth)
      const { data: gameSnaps } = await supabase
        .from("odds_snapshots")
        .select("spread, total, moneyline_home, moneyline_away, fetched_at")
        .eq("home_team", home_team)
        .eq("away_team", away_team)
        .eq("league", league)
        .order("fetched_at", { ascending: true })
        .limit(50);

      // 2. Get betting splits for pressure vs public score
      const { data: splits } = await supabase
        .from("splits_snapshots")
        .select("home_ticket_pct, away_ticket_pct, home_money_pct, away_money_pct")
        .eq("home_team", home_team)
        .eq("away_team", away_team)
        .order("fetched_at", { ascending: false })
        .limit(1);

      const splitRow = splits?.[0] ?? null;

      // 3. Get sport context (MLB/NHL)
      let mlbCtx = null;
      let nhlCtx = null;

      if (league === "MLB") {
        const { data } = await supabase
          .from("mlb_game_context")
          .select("edge_score, edge_grade")
          .eq("home_team", home_team)
          .eq("away_team", away_team)
          .order("created_at", { ascending: false })
          .limit(1);
        mlbCtx = data?.[0] ?? null;
      }

      if (league === "NHL") {
        const { data } = await supabase
          .from("nhl_game_context")
          .select("edge_score, edge_grade")
          .eq("home_team", home_team)
          .eq("away_team", away_team)
          .order("created_at", { ascending: false })
          .limit(1);
        nhlCtx = data?.[0] ?? null;
      }

      // 4. Compute all 6 axes
      const coordination = scoreCoordination(
        alert.books_agreeing ?? 0,
        alert.total_books ?? 1
      );

      const velocity = scoreVelocity(
        alert.velocity_per_hour ?? 0,
        league
      );

      const pressureVsPublic = scorePressureVsPublic(
        alert.line_move ?? 0,
        splitRow?.home_ticket_pct ?? null,
        splitRow?.home_money_pct ?? null,
      );

      const stability = scoreStability(gameSnaps ?? [], league);

      const breadth = scoreBreadth(gameSnaps ?? []);

      const context = scoreContext(league, mlbCtx, nhlCtx);

      // 5. Composite score (clamped 0-100)
      const rawScore = coordination + velocity + pressureVsPublic + stability + breadth + context;
      const hsaScore = Math.max(0, Math.min(100, rawScore));
      const grade = hsaTier(hsaScore);

      // 6. Write back to rlm_alerts
      const { error: updateErr } = await supabase
        .from("rlm_alerts")
        .update({
          score_coordination: coordination,
          score_velocity: velocity,
          score_pressure_vs_public: pressureVsPublic,
          score_stability: stability,
          score_breadth: breadth,
          score_context: context,
          hsa_score: hsaScore,
          edge_score: hsaScore,
          edge_grade: grade,
        })
        .eq("home_team", home_team)
        .eq("away_team", away_team)
        .eq("league", league);

      if (!updateErr) scored++;
    }

    return new Response(
      JSON.stringify({ success: true, scored, total: alerts.length }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
