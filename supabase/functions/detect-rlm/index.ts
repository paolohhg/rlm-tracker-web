import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Helper: scenario key builder ─────────────────────────────────────────────

function buildScenarioKey(
  prefix: string,
  spread: { absMove: number; booksAgreeing: number },
  ml: { absMove: number; booksAgreeing: number },
  total: { absMove: number },
): string {
  const parts = [prefix];
  parts.push(`${Math.max(spread.booksAgreeing, ml.booksAgreeing)}books`);
  if (spread.absMove >= 0.2) parts.push(`spd${spread.absMove.toFixed(1)}`);
  if (ml.absMove >= 5) parts.push(`ml${ml.absMove}c`);
  if (total.absMove >= 0.5) parts.push(`tot${total.absMove.toFixed(1)}`);
  return parts.join("|");
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get all recent odds snapshots
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

    // Group by game key (league|home_team|away_team)
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

      // Group by bookmaker
      const bookMap: Record<string, any[]> = {};
      for (const snap of snaps) {
        const bk = snap.bookmaker || "unknown";
        if (!bookMap[bk]) bookMap[bk] = [];
        bookMap[bk].push(snap);
      }

      // ═══════════════════════════════════════════════════════════════════
      //  LAYER 1: SPREAD MOVEMENT PER BOOK
      // ═══════════════════════════════════════════════════════════════════

      const bookMovements: number[] = [];
      const bookSpreads: { open: number; current: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const openSpd = bookSnaps[0].spread;
        const currSpd = bookSnaps[bookSnaps.length - 1].spread;
        if (openSpd != null && currSpd != null) {
          const move = parseFloat((currSpd - openSpd).toFixed(1));
          bookMovements.push(move);
          bookSpreads.push({ open: openSpd, current: currSpd, book });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      //  LAYER 2: MONEYLINE MOVEMENT PER BOOK
      // ═══════════════════════════════════════════════════════════════════

      const mlMovements: number[] = [];
      const bookMLs: { open: number; current: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const openML = bookSnaps[0].moneyline_home;
        const currML = bookSnaps[bookSnaps.length - 1].moneyline_home;
        if (openML != null && currML != null) {
          const mlMove = parseFloat((currML - openML).toFixed(0));
          mlMovements.push(mlMove);
          bookMLs.push({ open: openML, current: currML, book });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      //  LAYER 3: TOTALS MOVEMENT PER BOOK
      // ═══════════════════════════════════════════════════════════════════

      const totalMovements: number[] = [];
      const bookTotals: { open: number; current: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const openTotal = bookSnaps[0].total;
        const currTotal = bookSnaps[bookSnaps.length - 1].total;
        if (openTotal != null && currTotal != null) {
          const move = parseFloat((currTotal - openTotal).toFixed(1));
          totalMovements.push(move);
          bookTotals.push({ open: openTotal, current: currTotal, book });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      //  CONSENSUS CALCULATIONS (median across books)
      // ═══════════════════════════════════════════════════════════════════

      const isMLPrimary = league === "NHL" || league === "MLB";
      const hasSpreadData = bookMovements.length > 0;
      const hasMLData = mlMovements.length > 0;
      const hasTotalData = totalMovements.length > 0;

      if (!hasSpreadData && !hasMLData) continue;

      // Spread consensus
      let consensusMove = 0;
      if (hasSpreadData) {
        const sorted = [...bookMovements].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        consensusMove = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      }

      // ML consensus
      let consensusMLMove = 0;
      if (hasMLData) {
        const mlSorted = [...mlMovements].sort((a, b) => a - b);
        const mlMid = Math.floor(mlSorted.length / 2);
        consensusMLMove = mlSorted.length % 2 === 0
          ? (mlSorted[mlMid - 1] + mlSorted[mlMid]) / 2
          : mlSorted[mlMid];
      }

      // Totals consensus
      let consensusTotalMove = 0;
      if (hasTotalData) {
        const sorted = [...totalMovements].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        consensusTotalMove = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      }

      const absMove = Math.abs(consensusMove);
      const absMLMove = Math.abs(consensusMLMove);
      const absTotalMove = Math.abs(consensusTotalMove);

      // ═══════════════════════════════════════════════════════════════════
      //  LEAGUE-AWARE THRESHOLDS
      // ═══════════════════════════════════════════════════════════════════

      const spreadThreshold = isMLPrimary ? 0.3 : 0.5;
      const mlThreshold = league === "NHL" ? 15 : league === "MLB" ? 10 : 30;
      const totalThreshold = isMLPrimary ? 0.5 : 1.0;

      // Books agreeing per layer
      const booksAgreeingSpread = hasSpreadData
        ? bookMovements.filter(m => Math.sign(m) === Math.sign(consensusMove) && Math.abs(m) >= spreadThreshold).length
        : 0;
      const booksAgreeingML = hasMLData
        ? mlMovements.filter(m => Math.sign(m) === Math.sign(consensusMLMove) && Math.abs(m) >= mlThreshold).length
        : 0;
      const booksAgreeingTotal = hasTotalData
        ? totalMovements.filter(m => Math.sign(m) === Math.sign(consensusTotalMove) && Math.abs(m) >= totalThreshold * 0.5).length
        : 0;

      const totalBooks = Math.max(bookMovements.length, mlMovements.length);

      // ═══════════════════════════════════════════════════════════════════
      //  SPLITS FETCH — Sharp divergence detection
      // ═══════════════════════════════════════════════════════════════════

      let sharpDivergence = false;
      let sharpSide: string | null = null;
      let homeBetsPct: number | null = null;
      let homeMoneyPct: number | null = null;

      try {
        const { data: splitsRows } = await supabase
          .from("splits_snapshots")
          .select("*")
          .eq("league", league)
          .eq("home_team", homeTeam)
          .eq("away_team", awayTeam)
          .order("fetched_at", { ascending: false })
          .limit(1);

        if (splitsRows?.length) {
          const s = splitsRows[0];
          homeBetsPct = s.home_ticket_pct;
          homeMoneyPct = s.home_money_pct;
          const awayBetsPct = s.away_ticket_pct ?? (100 - (homeBetsPct ?? 50));
          const awayMoneyPct = s.away_money_pct ?? (100 - (homeMoneyPct ?? 50));

          // Sharp divergence: money% leads bets% by >= 8 points on either side
          const homeDivergence = (homeMoneyPct ?? 0) - (homeBetsPct ?? 0);
          const awayDivergence = awayMoneyPct - awayBetsPct;

          if (Math.abs(homeDivergence) >= 8 || Math.abs(awayDivergence) >= 8) {
            sharpDivergence = true;
            sharpSide = homeDivergence > awayDivergence ? homeTeam : awayTeam;
          }
        }
      } catch { /* splits fetch is non-critical */ }

      // ═══════════════════════════════════════════════════════════════════
      //  THREE SIGNAL LAYER OBJECTS
      // ═══════════════════════════════════════════════════════════════════

      // Velocity
      const firstSnap = snaps[0];
      const lastSnap = snaps[snaps.length - 1];
      const hoursElapsed = (new Date(lastSnap.fetched_at).getTime() - new Date(firstSnap.fetched_at).getTime()) / (1000 * 60 * 60);
      const velocityPerHour = hoursElapsed > 0 ? absMove / hoursElapsed : 0;
      const mlVelocityPerHour = hoursElapsed > 0 ? absMLMove / hoursElapsed : 0;

      const spreadLayer = {
        hasMeaningfulMove: absMove >= spreadThreshold,
        hasMinorMove: absMove >= 0.2,
        move: consensusMove,
        absMove,
        booksAgreeing: booksAgreeingSpread,
        velocity: velocityPerHour,
      };

      const mlLayer = {
        hasMeaningfulMove: absMLMove >= mlThreshold,
        hasMinorMove: absMLMove >= mlThreshold * 0.5,
        move: consensusMLMove,
        absMove: absMLMove,
        booksAgreeing: booksAgreeingML,
        velocity: mlVelocityPerHour,
      };

      const totalLayer = {
        hasMeaningfulMove: absTotalMove >= totalThreshold,
        hasMinorMove: absTotalMove >= totalThreshold * 0.5,
        move: consensusTotalMove,
        absMove: absTotalMove,
        booksAgreeing: booksAgreeingTotal,
      };

      // Composite signal flags
      const hasAnySignal = spreadLayer.hasMeaningfulMove || mlLayer.hasMeaningfulMove;
      const bestBooksAgreeing = Math.max(spreadLayer.booksAgreeing, mlLayer.booksAgreeing);

      // Opening and current spread (consensus)
      const openSpread = hasSpreadData
        ? bookSpreads.reduce((sum, b) => sum + b.open, 0) / bookSpreads.length
        : 0;
      const currentSpread = hasSpreadData
        ? bookSpreads.reduce((sum, b) => sum + b.current, 0) / bookSpreads.length
        : 0;

      // ═══════════════════════════════════════════════════════════════════
      //  COMPOSITE SIGNAL CLASSIFICATION
      // ═══════════════════════════════════════════════════════════════════

      let signalTier = "";
      let scenarioKey = "";

      // ── Tier 1: STEAM MOVE ──
      // Spread or ML signal with 3+ books agreeing + high velocity
      if (hasAnySignal && bestBooksAgreeing >= 3) {
        const isHighVelocity = isMLPrimary
          ? (mlLayer.velocity >= 10 || spreadLayer.velocity >= 0.3)
          : spreadLayer.velocity >= 0.5;

        if (isHighVelocity) {
          signalTier = "STEAM MOVE";
          scenarioKey = buildScenarioKey("STEAM", spreadLayer, mlLayer, totalLayer);
        } else {
          signalTier = "NO-NARRATIVE RLM";
          scenarioKey = buildScenarioKey("RLM", spreadLayer, mlLayer, totalLayer);
        }
      }

      // ── Tier 2: SHARP ACCUMULATION (NEW) ──
      // ML drifting toward money-side + sharp splits divergence
      // Not enough books/velocity for RLM, but money is clearly accumulating
      else if (!hasAnySignal && sharpDivergence && mlLayer.hasMinorMove) {
        const mlDirectionMatchesSharp =
          (sharpSide === homeTeam && consensusMLMove < 0) ||
          (sharpSide === awayTeam && consensusMLMove > 0);

        if (mlDirectionMatchesSharp) {
          signalTier = "SHARP ACCUMULATION";
          scenarioKey = `SHARP_ACCUM|ML${absMLMove}c|div${Math.abs((homeMoneyPct ?? 0) - (homeBetsPct ?? 0)).toFixed(0)}%`;
        }
      }

      // ── Tier 3: BOOK SHADE ──
      // Spread or ML signal but only 1-2 books
      else if (hasAnySignal && bestBooksAgreeing >= 1) {
        signalTier = "BOOK SHADE";
        scenarioKey = buildScenarioKey("SHADE", spreadLayer, mlLayer, totalLayer);
      }

      // ── Tier 4: FROZEN LINE (now MUCH stricter) ──
      // ALL three layers must be dead + no sharp divergence + enough tracking time
      else if (
        !spreadLayer.hasMinorMove &&          // spread < 0.2
        !mlLayer.hasMinorMove &&              // ML < 50% of threshold
        !totalLayer.hasMinorMove &&           // total < 50% of threshold
        !sharpDivergence &&                   // no money/ticket divergence
        totalBooks >= 2 &&
        hoursElapsed >= 3                     // need at least 3 hours of tracking
      ) {
        signalTier = "FROZEN LINE";
        scenarioKey = `FROZEN|${totalBooks}books|${hoursElapsed.toFixed(0)}h`;
      }

      // ── Tier 5: WATCH ──
      // Any minor activity that doesn't qualify for higher tiers
      else if (
        spreadLayer.absMove >= 0.3 ||
        (isMLPrimary && mlLayer.absMove >= mlThreshold * 0.7) ||
        totalLayer.hasMeaningfulMove ||
        sharpDivergence
      ) {
        signalTier = "WATCH";
        const triggers: string[] = [];
        if (spreadLayer.absMove >= 0.3) triggers.push(`spd${spreadLayer.absMove.toFixed(1)}`);
        if (mlLayer.absMove >= mlThreshold * 0.7) triggers.push(`ml${mlLayer.absMove}c`);
        if (totalLayer.hasMeaningfulMove) triggers.push(`tot${totalLayer.absMove.toFixed(1)}`);
        if (sharpDivergence) triggers.push("div");
        scenarioKey = `WATCH|${triggers.join("|")}`;
      }

      if (!signalTier) continue;

      // ═══════════════════════════════════════════════════════════════════
      //  DIRECTION — sharp team / fade team
      // ═══════════════════════════════════════════════════════════════════

      let sharpTeam: string;
      let fadeTeam: string;

      if (signalTier === "SHARP ACCUMULATION" && sharpSide) {
        // Direction from splits divergence
        sharpTeam = sharpSide;
        fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
      } else if (isMLPrimary && !spreadLayer.hasMeaningfulMove && mlLayer.hasMeaningfulMove) {
        // ML-primary: negative ML move = home becoming more favored
        sharpTeam = consensusMLMove < 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLMove < 0 ? awayTeam : homeTeam;
      } else if (spreadLayer.hasMeaningfulMove) {
        // Standard spread-based direction
        sharpTeam = consensusMove > 0 ? awayTeam : homeTeam;
        fadeTeam = consensusMove > 0 ? homeTeam : awayTeam;
      } else if (mlLayer.hasMinorMove) {
        // Fallback to ML direction for any sport
        sharpTeam = consensusMLMove < 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLMove < 0 ? awayTeam : homeTeam;
      } else if (sharpDivergence && sharpSide) {
        // Last resort: use splits direction
        sharpTeam = sharpSide;
        fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
      } else {
        sharpTeam = homeTeam;
        fadeTeam = awayTeam;
      }

      // ═══════════════════════════════════════════════════════════════════
      //  HSA NARRATIVE TRIGGER
      // ═══════════════════════════════════════════════════════════════════

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
      if (signalTier === "NO-NARRATIVE RLM" && absMove >= 1.5 && bestBooksAgreeing >= 4) {
        signalTier = "DOUBLE NO-NARRATIVE RLM";
        scenarioKey = `DOUBLE_RLM|${bestBooksAgreeing}books|${absMove.toFixed(1)}pts`;
      }

      // ═══════════════════════════════════════════════════════════════════
      //  BUILD ALERT OUTPUT
      // ═══════════════════════════════════════════════════════════════════

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
        books_agreeing: bestBooksAgreeing,
        total_books: totalBooks,
        velocity_per_hour: parseFloat(velocityPerHour.toFixed(2)),
        hsa_narrative: hsaNarrative,
        detected_at: now.toISOString(),
      };

      // Moneyline movement (all sports now, not just ML-primary)
      if (hasMLData) {
        alert.moneyline_move = parseFloat(consensusMLMove.toFixed(0));
      }

      // Totals movement
      if (hasTotalData) {
        alert.total_move = parseFloat(consensusTotalMove.toFixed(1));
        if (bookTotals.length > 0) {
          alert.opening_total = parseFloat(
            (bookTotals.reduce((s, b) => s + b.open, 0) / bookTotals.length).toFixed(1)
          );
          alert.current_total = parseFloat(
            (bookTotals.reduce((s, b) => s + b.current, 0) / bookTotals.length).toFixed(1)
          );
        }
      }

      // Splits snapshot for downstream consumers
      if (homeBetsPct != null) {
        alert.home_bets_pct = homeBetsPct;
        alert.home_money_pct = homeMoneyPct;
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
