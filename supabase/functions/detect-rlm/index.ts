import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Get all upcoming games from odds_snapshots directly
    const { data: recentOdds, error } = await supabase
      .from("odds_snapshots")
      .select("*")
      .gte("fetched_at", windowStart)
      .order("fetched_at", { ascending: true });

    if (error) throw error;
    if (!recentOdds || recentOdds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No odds data" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Group by game key (home_team + away_team + league)
    const gameMap: Record<string, any[]> = {};
    for (const snap of recentOdds) {
      const key = `${snap.league}|${snap.home_team}|${snap.away_team}`;
      if (!gameMap[key]) gameMap[key] = [];
      gameMap[key].push(snap);
    }

    const results: any[] = [];

    for (const [gameKey, snaps] of Object.entries(gameMap)) {
      if (snaps.length < 2) continue;

      const [league, homeTeam, awayTeam] = gameKey.split("|");

      // Sort by time
      snaps.sort((a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime());

      // Group by bookmaker to get per-book movement
      const bookMap: Record<string, any[]> = {};
      for (const snap of snaps) {
        const bk = snap.bookmaker || "unknown";
        if (!bookMap[bk]) bookMap[bk] = [];
        bookMap[bk].push(snap);
      }

      // Calculate movement per book
      const bookMovements: number[] = [];
      const bookSpreads: { open: number; current: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const open = bookSnaps[0].spread;
        const current = bookSnaps[bookSnaps.length - 1].spread;
        if (open == null || current == null) continue;
        const move = parseFloat((current - open).toFixed(1));
        bookMovements.push(move);
        bookSpreads.push({ open, current, book });
      }

      if (bookMovements.length === 0) continue;

      // Consensus movement: median across books
      const sorted = [...bookMovements].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const consensusMove = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

      const absMove = Math.abs(consensusMove);
      const booksAgreeing = bookMovements.filter(m => Math.sign(m) === Math.sign(consensusMove) && Math.abs(m) >= 0.5).length;
      const totalBooks = bookMovements.length;

      // Opening and current spread (consensus)
      const openSpread = bookSpreads.reduce((sum, b) => sum + b.open, 0) / bookSpreads.length;
      const currentSpread = bookSpreads.reduce((sum, b) => sum + b.current, 0) / bookSpreads.length;

      // Direction: positive = line moved toward away team (home getting worse)
      const sharpTeam = consensusMove > 0 ? awayTeam : homeTeam;
      const fadeTeam = consensusMove > 0 ? homeTeam : awayTeam;

      // Velocity: how fast did the move happen?
      const firstSnap = snaps[0];
      const lastSnap = snaps[snaps.length - 1];
      const hoursElapsed = (new Date(lastSnap.fetched_at).getTime() - new Date(firstSnap.fetched_at).getTime()) / (1000 * 60 * 60);
      const velocityPerHour = hoursElapsed > 0 ? absMove / hoursElapsed : 0;

      // Detect signal tier
      let signalTier = "";
      let scenarioKey = "";

      if (absMove >= 0.5 && booksAgreeing >= 3) {
        if (velocityPerHour >= 0.5) {
          signalTier = "STEAM MOVE";
          scenarioKey = `STEAM|${booksAgreeing}books|${absMove.toFixed(1)}pts`;
        } else {
          signalTier = "NO-NARRATIVE RLM";
          scenarioKey = `RLM|${booksAgreeing}books|${absMove.toFixed(1)}pts`;
        }
      } else if (absMove >= 0.5 && booksAgreeing >= 1) {
        signalTier = "BOOK SHADE";
        scenarioKey = `SHADE|${booksAgreeing}books|${absMove.toFixed(1)}pts`;
      } else if (absMove < 0.2 && totalBooks >= 2) {
        // Juice moved but spread frozen
        signalTier = "FROZEN LINE";
        scenarioKey = `FROZEN|${totalBooks}books`;
      } else if (absMove >= 0.3) {
        signalTier = "WATCH";
        scenarioKey = `WATCH|${absMove.toFixed(1)}pts`;
      }

      if (!signalTier) continue;

      // Trigger HSA
      let hsaNarrative = "";
      try {
        const hsaRes = await supabase.functions.invoke("generate-brief", {
          body: {
            home_team: homeTeam,
            away_team: awayTeam,
            league,
            signal_tier: signalTier,
            sharp_team: sharpTeam,
            line_move: consensusMove,
          }
        });
        hsaNarrative = hsaRes.data?.narrative ?? "";
      } catch { hsaNarrative = ""; }

      // If HSA found a narrative for RLM, downgrade
      if (signalTier === "NO-NARRATIVE RLM" && hsaNarrative && hsaNarrative !== "NO_NARRATIVE") {
        signalTier = "WATCH";
        scenarioKey = `WATCH_NARRATIVE|${absMove.toFixed(1)}pts`;
      }

      // Upgrade to DOUBLE if move is large and fast
      if (signalTier === "NO-NARRATIVE RLM" && absMove >= 1.5 && booksAgreeing >= 4) {
        signalTier = "DOUBLE NO-NARRATIVE RLM";
        scenarioKey = `DOUBLE_RLM|${booksAgreeing}books|${absMove.toFixed(1)}pts`;
      }

      const alert = {
        home_team: homeTeam,
        away_team: awayTeam,
        league,
        sharp_team: sharpTeam,
        fade_team: fadeTeam,
        signal_tier: signalTier,
        scenario_key: scenarioKey,
        opening_spread: parseFloat(openSpread.toFixed(1)),
        current_spread: parseFloat(currentSpread.toFixed(1)),
        line_move: parseFloat(consensusMove.toFixed(1)),
        books_agreeing: booksAgreeing,
        total_books: totalBooks,
        velocity_per_hour: parseFloat(velocityPerHour.toFixed(2)),
        hsa_narrative: hsaNarrative,
        detected_at: now.toISOString(),
      };

      // Upsert into rlm_alerts
      await supabase.from("rlm_alerts").upsert(alert, { onConflict: "home_team,away_team,league" });
      results.push(alert);
    }

    return new Response(
      JSON.stringify({ success: true, alerts: results.length, results }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
