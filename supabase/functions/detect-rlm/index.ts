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
    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

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

      // Calculate spread movement per book
      const bookMovements: number[] = [];
      const bookSpreads: { open: number; current: number; book: string }[] = [];

      // Calculate moneyline movement per book (critical for NHL/MLB)
      const mlMovements: number[] = [];
      const bookMLs: { open: number; current: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;

        // Spread movement
        const openSpd = bookSnaps[0].spread;
        const currSpd = bookSnaps[bookSnaps.length - 1].spread;
        if (openSpd != null && currSpd != null) {
          const move = parseFloat((currSpd - openSpd).toFixed(1));
          bookMovements.push(move);
          bookSpreads.push({ open: openSpd, current: currSpd, book });
        }

        // Moneyline movement (home ML)
        const openML = bookSnaps[0].moneyline_home;
        const currML = bookSnaps[bookSnaps.length - 1].moneyline_home;
        if (openML != null && currML != null) {
          const mlMove = parseFloat((currML - openML).toFixed(0));
          mlMovements.push(mlMove);
          bookMLs.push({ open: openML, current: currML, book });
        }
      }

      // For NHL/MLB: moneyline is primary signal if spread barely moves
      const isMLPrimary = league === "NHL" || league === "MLB";
      const hasSpreadData = bookMovements.length > 0;
      const hasMLData = mlMovements.length > 0;

      if (!hasSpreadData && !hasMLData) continue;

      // Consensus spread movement (median)
      let consensusMove = 0;
      if (hasSpreadData) {
        const sorted = [...bookMovements].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        consensusMove = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      }

      // Consensus ML movement (median, in cents)
      let consensusMLMove = 0;
      if (hasMLData) {
        const mlSorted = [...mlMovements].sort((a, b) => a - b);
        const mlMid = Math.floor(mlSorted.length / 2);
        consensusMLMove = mlSorted.length % 2 === 0
          ? (mlSorted[mlMid - 1] + mlSorted[mlMid]) / 2
          : mlSorted[mlMid];
      }

      const absMove = Math.abs(consensusMove);
      const absMLMove = Math.abs(consensusMLMove);

      // League-aware thresholds
      const spreadThreshold = isMLPrimary ? 0.3 : 0.5;
      const mlThreshold = league === "NHL" ? 15 : league === "MLB" ? 10 : 30;

      // Books agreeing on spread OR moneyline direction
      const booksAgreeingSpread = hasSpreadData
        ? bookMovements.filter(m => Math.sign(m) === Math.sign(consensusMove) && Math.abs(m) >= spreadThreshold).length
        : 0;
      const booksAgreeingML = hasMLData
        ? mlMovements.filter(m => Math.sign(m) === Math.sign(consensusMLMove) && Math.abs(m) >= mlThreshold).length
        : 0;
      const booksAgreeing = Math.max(booksAgreeingSpread, booksAgreeingML);
      const totalBooks = Math.max(bookMovements.length, mlMovements.length);

      // Use ML-based signal when spread is flat but ML moved (common in NHL/MLB)
      const mlSignal = isMLPrimary && absMLMove >= mlThreshold && booksAgreeingML >= 2;
      const spreadSignal = absMove >= spreadThreshold;
      const hasSignal = spreadSignal || mlSignal;

      // Opening and current spread (consensus)
      const openSpread = hasSpreadData
        ? bookSpreads.reduce((sum, b) => sum + b.open, 0) / bookSpreads.length
        : 0;
      const currentSpread = hasSpreadData
        ? bookSpreads.reduce((sum, b) => sum + b.current, 0) / bookSpreads.length
        : 0;

      // Direction: for ML-primary sports, use ML direction if spread is flat
      let sharpTeam: string;
      let fadeTeam: string;
      if (isMLPrimary && !spreadSignal && mlSignal) {
        // Negative ML movement = home becoming more favored = sharp on home
        sharpTeam = consensusMLMove < 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLMove < 0 ? awayTeam : homeTeam;
      } else {
        sharpTeam = consensusMove > 0 ? awayTeam : homeTeam;
        fadeTeam = consensusMove > 0 ? homeTeam : awayTeam;
      }

      // Velocity: how fast did the move happen?
      const firstSnap = snaps[0];
      const lastSnap = snaps[snaps.length - 1];
      const hoursElapsed = (new Date(lastSnap.fetched_at).getTime() - new Date(firstSnap.fetched_at).getTime()) / (1000 * 60 * 60);
      const velocityPerHour = hoursElapsed > 0 ? absMove / hoursElapsed : 0;
      const mlVelocityPerHour = hoursElapsed > 0 ? absMLMove / hoursElapsed : 0;

      // Detect signal tier (league-aware)
      let signalTier = "";
      let scenarioKey = "";

      if (hasSignal && booksAgreeing >= 3) {
        const isHighVelocity = isMLPrimary
          ? (mlVelocityPerHour >= 10 || velocityPerHour >= 0.3)
          : velocityPerHour >= 0.5;

        if (isHighVelocity) {
          signalTier = "STEAM MOVE";
          scenarioKey = `STEAM|${booksAgreeing}books|${isMLPrimary ? absMLMove + 'c' : absMove.toFixed(1) + 'pts'}`;
        } else {
          signalTier = "NO-NARRATIVE RLM";
          scenarioKey = `RLM|${booksAgreeing}books|${isMLPrimary ? absMLMove + 'c' : absMove.toFixed(1) + 'pts'}`;
        }
      } else if (hasSignal && booksAgreeing >= 1) {
        signalTier = "BOOK SHADE";
        scenarioKey = `SHADE|${booksAgreeing}books|${isMLPrimary ? absMLMove + 'c' : absMove.toFixed(1) + 'pts'}`;
      } else if (absMove < 0.2 && absMLMove < 5 && totalBooks >= 2 && hoursElapsed >= 3) {
        // Only tag as FROZEN if the line has been tracked for 3+ hours and truly hasn't moved
        signalTier = "FROZEN LINE";
        scenarioKey = `FROZEN|${totalBooks}books|${hoursElapsed.toFixed(0)}h`;
      } else if (absMove >= 0.3 || (isMLPrimary && absMLMove >= mlThreshold * 0.7)) {
        signalTier = "WATCH";
        scenarioKey = `WATCH|${isMLPrimary ? absMLMove + 'c' : absMove.toFixed(1) + 'pts'}`;
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

      const alert: Record<string, unknown> = {
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

      // Add moneyline movement for ML-primary sports (NHL/MLB)
      if (isMLPrimary && hasMLData) {
        alert.moneyline_move = parseFloat(consensusMLMove.toFixed(0));
      }

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
