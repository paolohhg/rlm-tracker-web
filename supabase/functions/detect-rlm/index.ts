import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert American odds to implied probability (0-1 range). */
function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

/** Median of a numeric array. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Build a scenario key string for rich logging. */
function buildScenarioKey(
  prefix: string,
  spread: { absMove: number; booksAgreeing: number },
  ml: { absMove: number; booksAgreeing: number },
  total: { absMove: number },
): string {
  const parts = [prefix];
  parts.push(`${Math.max(spread.booksAgreeing, ml.booksAgreeing)}books`);
  if (spread.absMove >= 0.2) parts.push(`spd${spread.absMove.toFixed(1)}`);
  if (ml.absMove >= 0.5) parts.push(`ml${ml.absMove.toFixed(1)}%`);
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

      // ═══════════════════════════════════════════════════════════════════════
      //  LAYER 1: SPREAD MOVEMENT PER BOOK
      // ═══════════════════════════════════════════════════════════════════════

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

      // ═══════════════════════════════════════════════════════════════════════
      //  LAYER 2: MONEYLINE MOVEMENT PER BOOK (implied probability)
      //
      //  We track how each book's HOME implied probability changed.
      //  Delta > 0 means home team became MORE favored.
      //  Delta < 0 means away team became MORE favored.
      //  Using implied probability normalizes across favorites/underdogs
      //  so +130→+114 is treated proportionally to -150→-170.
      // ═══════════════════════════════════════════════════════════════════════

      const mlProbDeltas: number[] = []; // implied probability change per book (in percentage points)
      const mlRawMovements: number[] = []; // raw cents change for output display
      const bookMLs: { openML: number; currML: number; openProb: number; currProb: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const openML = bookSnaps[0].moneyline_home;
        const currML = bookSnaps[bookSnaps.length - 1].moneyline_home;
        if (openML != null && currML != null) {
          const openProb = americanToImpliedProb(openML);
          const currProb = americanToImpliedProb(currML);
          // Delta in percentage points (e.g., 60% → 63% = +3.0)
          const probDelta = parseFloat(((currProb - openProb) * 100).toFixed(2));
          mlProbDeltas.push(probDelta);
          mlRawMovements.push(parseFloat((currML - openML).toFixed(0)));
          bookMLs.push({ openML, currML, openProb, currProb, book });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  LAYER 3: TOTALS MOVEMENT PER BOOK
      // ═══════════════════════════════════════════════════════════════════════

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

      // ═══════════════════════════════════════════════════════════════════════
      //  CONSENSUS CALCULATIONS (median across books)
      // ═══════════════════════════════════════════════════════════════════════

      const isMLPrimary = league === "NHL" || league === "MLB";
      const hasSpreadData = bookMovements.length > 0;
      const hasMLData = mlProbDeltas.length > 0;
      const hasTotalData = totalMovements.length > 0;

      if (!hasSpreadData && !hasMLData) continue;

      const consensusMove = median(bookMovements);
      const consensusMLProbDelta = median(mlProbDeltas); // in implied probability percentage points
      const consensusMLRaw = median(mlRawMovements); // raw cents for display
      const consensusTotalMove = median(totalMovements);

      const absMove = Math.abs(consensusMove);
      const absMLProbDelta = Math.abs(consensusMLProbDelta);
      const absTotalMove = Math.abs(consensusTotalMove);

      // ═══════════════════════════════════════════════════════════════════════
      //  LEAGUE-AWARE THRESHOLDS
      //
      //  ML thresholds are now in implied probability percentage points:
      //    2.0% ≈ +130→+114 (16 cents for underdog)
      //    2.0% ≈ -150→-170 (20 cents for favorite)
      //  This normalizes across favorites and underdogs.
      // ═══════════════════════════════════════════════════════════════════════

      const spreadThreshold = isMLPrimary ? 0.3 : 0.5;
      // ML thresholds in implied probability points
      const mlThreshold = isMLPrimary ? 1.5 : 2.0;       // meaningful move
      const mlMinorThreshold = isMLPrimary ? 0.8 : 1.0;   // minor move (blocks FROZEN)
      const mlSteamThreshold = isMLPrimary ? 3.0 : 4.0;   // steam-level velocity
      const totalThreshold = isMLPrimary ? 0.5 : 1.0;

      // Books agreeing per layer
      const booksAgreeingSpread = hasSpreadData
        ? bookMovements.filter(m => Math.sign(m) === Math.sign(consensusMove) && Math.abs(m) >= spreadThreshold).length
        : 0;
      const booksAgreeingML = hasMLData
        ? mlProbDeltas.filter(d => Math.sign(d) === Math.sign(consensusMLProbDelta) && Math.abs(d) >= mlMinorThreshold).length
        : 0;
      const booksAgreeingTotal = hasTotalData
        ? totalMovements.filter(m => Math.sign(m) === Math.sign(consensusTotalMove) && Math.abs(m) >= totalThreshold * 0.5).length
        : 0;

      const totalBooks = Math.max(bookMovements.length, mlProbDeltas.length);

      // ═══════════════════════════════════════════════════════════════════════
      //  TIMING / VELOCITY
      // ═══════════════════════════════════════════════════════════════════════

      const firstSnap = snaps[0];
      const lastSnap = snaps[snaps.length - 1];
      const hoursElapsed = (new Date(lastSnap.fetched_at).getTime() - new Date(firstSnap.fetched_at).getTime()) / (1000 * 60 * 60);
      const spreadVelocity = hoursElapsed > 0 ? absMove / hoursElapsed : 0;
      const mlVelocity = hoursElapsed > 0 ? absMLProbDelta / hoursElapsed : 0;     // prob points per hour
      const totalVelocity = hoursElapsed > 0 ? absTotalMove / hoursElapsed : 0;

      // ═══════════════════════════════════════════════════════════════════════
      //  SPLITS FETCH — Sharp divergence detection
      // ═══════════════════════════════════════════════════════════════════════

      let sharpDivergence = false;
      let sharpSide: string | null = null;
      let homeBetsPct: number | null = null;
      let homeMoneyPct: number | null = null;
      let divergenceGap = 0; // magnitude of money%-bets% gap

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
          divergenceGap = Math.max(Math.abs(homeDivergence), Math.abs(awayDivergence));

          if (divergenceGap >= 8) {
            sharpDivergence = true;
            sharpSide = homeDivergence > awayDivergence ? homeTeam : awayTeam;
          }
        }
      } catch { /* splits fetch is non-critical */ }

      // ═══════════════════════════════════════════════════════════════════════
      //  THREE INDEPENDENT SIGNAL LAYER OBJECTS
      //
      //  Each layer is evaluated on its own merits. The final classification
      //  picks the strongest signal across all layers. No single layer being
      //  quiet can suppress a real signal from another layer.
      // ═══════════════════════════════════════════════════════════════════════

      const spreadLayer = {
        hasMeaningfulMove: absMove >= spreadThreshold,
        hasMinorMove: absMove >= 0.2,
        move: consensusMove,
        absMove,
        booksAgreeing: booksAgreeingSpread,
        velocity: spreadVelocity,
      };

      const mlLayer = {
        hasMeaningfulMove: absMLProbDelta >= mlThreshold,
        hasMinorMove: absMLProbDelta >= mlMinorThreshold,
        move: consensusMLProbDelta,       // implied prob delta (positive = home improving)
        rawMove: consensusMLRaw,          // raw cents for display
        absMove: absMLProbDelta,          // absolute implied prob delta
        booksAgreeing: booksAgreeingML,
        velocity: mlVelocity,
      };

      const totalLayer = {
        hasMeaningfulMove: absTotalMove >= totalThreshold,
        hasMinorMove: absTotalMove >= totalThreshold * 0.5,
        move: consensusTotalMove,
        absMove: absTotalMove,
        booksAgreeing: booksAgreeingTotal,
        velocity: totalVelocity,
      };

      // ═══════════════════════════════════════════════════════════════════════
      //  PER-LAYER SIGNAL EVALUATION
      //
      //  Each layer independently determines if it carries:
      //    - STEAM: high velocity + 3+ books
      //    - RLM: meaningful move + 3+ books (but not steam velocity)
      //    - SHARP_ACCUM: gradual move + splits alignment
      //    - SHADE: meaningful move but only 1-2 books
      //    - MINOR: some movement but below meaningful threshold
      //    - NONE: no meaningful activity
      // ═══════════════════════════════════════════════════════════════════════

      type LayerSignal = "STEAM" | "RLM" | "SHARP_ACCUM" | "SHADE" | "MINOR" | "NONE";

      // ── Spread layer signal ──
      let spreadSignal: LayerSignal = "NONE";
      if (spreadLayer.hasMeaningfulMove) {
        if (spreadLayer.booksAgreeing >= 3 && spreadLayer.velocity >= 0.5) {
          spreadSignal = "STEAM";
        } else if (spreadLayer.booksAgreeing >= 3) {
          spreadSignal = "RLM";
        } else if (spreadLayer.booksAgreeing >= 1) {
          spreadSignal = "SHADE";
        }
      } else if (spreadLayer.hasMinorMove) {
        spreadSignal = "MINOR";
      }

      // ── ML layer signal ──
      let mlSignal: LayerSignal = "NONE";
      if (mlLayer.hasMeaningfulMove) {
        // ML steam: high velocity + multiple books
        const mlSteamVelocity = isMLPrimary ? 1.5 : 2.0; // prob pts/hr
        if (mlLayer.booksAgreeing >= 3 && mlLayer.velocity >= mlSteamVelocity) {
          mlSignal = "STEAM";
        } else if (mlLayer.booksAgreeing >= 3) {
          mlSignal = "RLM";
        } else if (mlLayer.booksAgreeing >= 1) {
          mlSignal = "SHADE";
        }
      } else if (mlLayer.hasMinorMove) {
        // Check for sharp accumulation: gradual ML drift, especially with splits confirmation
        const mlMovingTowardSharp = sharpSide
          ? (sharpSide === homeTeam && consensusMLProbDelta > 0) ||
            (sharpSide === awayTeam && consensusMLProbDelta < 0)
          : false;

        if (mlMovingTowardSharp && sharpDivergence) {
          mlSignal = "SHARP_ACCUM";
        } else if (absMLProbDelta >= mlMinorThreshold) {
          // Even without splits: ML is moving and that's not nothing
          mlSignal = "MINOR";
        }
      }

      // ── Totals layer signal ──
      let totalSignal: LayerSignal = "NONE";
      if (totalLayer.hasMeaningfulMove) {
        const totalSteamVelocity = isMLPrimary ? 0.5 : 1.0; // pts/hr
        if (totalLayer.booksAgreeing >= 3 && totalLayer.velocity >= totalSteamVelocity) {
          totalSignal = "STEAM";
        } else if (totalLayer.booksAgreeing >= 2) {
          totalSignal = "SHADE"; // coordinated total move
        } else {
          totalSignal = "MINOR";
        }
      } else if (totalLayer.hasMinorMove) {
        totalSignal = "MINOR";
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  COMPOSITE SIGNAL CLASSIFICATION
      //
      //  The strongest signal across any layer wins. A quiet spread layer
      //  CANNOT suppress a real ML signal or vice versa.
      //
      //  Priority: STEAM > RLM > SHARP_ACCUM > SHADE > WATCH > FROZEN
      //
      //  `signal_tier` = display-facing tier (what the dashboard shows)
      //  `alert_type`  = granular type (which layer + type, e.g. RLM_ML)
      // ═══════════════════════════════════════════════════════════════════════

      let signalTier = "";
      let alertType = "";
      let scenarioKey = "";

      // Determine which layer is the primary signal source
      const signalPriority = (s: LayerSignal): number => {
        switch (s) {
          case "STEAM": return 5;
          case "RLM": return 4;
          case "SHARP_ACCUM": return 3;
          case "SHADE": return 2;
          case "MINOR": return 1;
          case "NONE": return 0;
        }
      };

      const bestSpread = signalPriority(spreadSignal);
      const bestML = signalPriority(mlSignal);
      const bestTotal = signalPriority(totalSignal);
      const bestOverall = Math.max(bestSpread, bestML, bestTotal);

      // Determine primary layer for direction
      type SignalSource = "spread" | "ml" | "total";
      let primarySource: SignalSource = "spread";
      if (bestML > bestSpread && bestML >= bestTotal) primarySource = "ml";
      else if (bestTotal > bestSpread && bestTotal > bestML) primarySource = "total";

      // ── Classify based on the strongest layer signal ──

      if (bestOverall >= 5) {
        // STEAM — at least one layer hit steam level
        signalTier = "STEAM MOVE";
        if (spreadSignal === "STEAM") {
          alertType = "STEAM_SPREAD";
          scenarioKey = buildScenarioKey("STEAM_SPD", spreadLayer, mlLayer, totalLayer);
        } else if (mlSignal === "STEAM") {
          alertType = "STEAM_ML";
          scenarioKey = buildScenarioKey("STEAM_ML", spreadLayer, mlLayer, totalLayer);
        } else {
          alertType = "STEAM_TOTAL";
          scenarioKey = buildScenarioKey("STEAM_TOT", spreadLayer, mlLayer, totalLayer);
        }
      }

      else if (bestOverall >= 4) {
        // RLM — meaningful move with 3+ books agreeing
        signalTier = "NO-NARRATIVE RLM";
        if (spreadSignal === "RLM") {
          alertType = "RLM_SPREAD";
          scenarioKey = buildScenarioKey("RLM_SPD", spreadLayer, mlLayer, totalLayer);
        } else {
          alertType = "RLM_ML";
          scenarioKey = buildScenarioKey("RLM_ML", spreadLayer, mlLayer, totalLayer);
        }
      }

      else if (bestOverall >= 3) {
        // SHARP ACCUMULATION — gradual ML drift + splits confirmation
        signalTier = "SHARP ACCUMULATION";
        alertType = "SHARP_ACCUM";
        scenarioKey = `SHARP_ACCUM|ml${absMLProbDelta.toFixed(1)}%|div${divergenceGap.toFixed(0)}%`;
      }

      else if (bestOverall >= 2) {
        // BOOK SHADE — meaningful move but limited book confirmation
        signalTier = "BOOK SHADE";
        if (spreadSignal === "SHADE") {
          alertType = "SHADE_SPREAD";
        } else if (mlSignal === "SHADE") {
          alertType = "SHADE_ML";
        } else {
          alertType = "SHADE_TOTAL";
        }
        scenarioKey = buildScenarioKey("SHADE", spreadLayer, mlLayer, totalLayer);
      }

      // ── FROZEN LINE — ALL three layers must be dead ──
      // This is a LAST RESORT classification. Any meaningful activity in
      // ANY layer (spread, ML, or total) prevents frozen classification.
      else if (
        spreadSignal === "NONE" &&
        mlSignal === "NONE" &&
        totalSignal === "NONE" &&
        !sharpDivergence &&
        totalBooks >= 2 &&
        hoursElapsed >= 3
      ) {
        signalTier = "FROZEN LINE";
        alertType = "FROZEN";
        scenarioKey = `FROZEN|${totalBooks}books|${hoursElapsed.toFixed(0)}h`;
      }

      // ── WATCH — any minor activity that doesn't qualify higher ──
      else if (bestOverall >= 1 || sharpDivergence) {
        signalTier = "WATCH";
        alertType = "WATCH";
        const triggers: string[] = [];
        if (spreadLayer.absMove >= 0.2) triggers.push(`spd${spreadLayer.absMove.toFixed(1)}`);
        if (mlLayer.absMove >= mlMinorThreshold) triggers.push(`ml${mlLayer.absMove.toFixed(1)}%`);
        if (totalLayer.hasMinorMove) triggers.push(`tot${totalLayer.absMove.toFixed(1)}`);
        if (sharpDivergence) triggers.push(`div${divergenceGap.toFixed(0)}%`);
        scenarioKey = `WATCH|${triggers.join("|")}`;
      }

      if (!signalTier) continue;

      // ═══════════════════════════════════════════════════════════════════════
      //  DIRECTION — sharp team / fade team
      //
      //  Uses the primary signal layer to determine direction.
      //  For ML: positive prob delta = home improving; negative = away improving.
      //  Fallback chain: primary layer → splits → default.
      // ═══════════════════════════════════════════════════════════════════════

      let sharpTeam: string;
      let fadeTeam: string;

      if (signalTier === "SHARP ACCUMULATION" && sharpSide) {
        // Direction from splits divergence (most reliable for this tier)
        sharpTeam = sharpSide;
        fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
      } else if (primarySource === "ml" && mlLayer.hasMinorMove) {
        // ML-based direction: positive prob delta = home becoming more favored
        sharpTeam = consensusMLProbDelta > 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLProbDelta > 0 ? awayTeam : homeTeam;
      } else if (primarySource === "total") {
        // Total doesn't have a team-side direction — use ML or splits as backup
        if (mlLayer.hasMinorMove) {
          sharpTeam = consensusMLProbDelta > 0 ? homeTeam : awayTeam;
          fadeTeam = consensusMLProbDelta > 0 ? awayTeam : homeTeam;
        } else if (sharpDivergence && sharpSide) {
          sharpTeam = sharpSide;
          fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
        } else {
          sharpTeam = homeTeam;
          fadeTeam = awayTeam;
        }
      } else if (spreadLayer.hasMeaningfulMove) {
        // Standard spread-based direction
        sharpTeam = consensusMove > 0 ? awayTeam : homeTeam;
        fadeTeam = consensusMove > 0 ? homeTeam : awayTeam;
      } else if (mlLayer.hasMinorMove) {
        // Fallback: any ML movement
        sharpTeam = consensusMLProbDelta > 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLProbDelta > 0 ? awayTeam : homeTeam;
      } else if (sharpDivergence && sharpSide) {
        sharpTeam = sharpSide;
        fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
      } else {
        sharpTeam = homeTeam;
        fadeTeam = awayTeam;
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  HSA NARRATIVE TRIGGER
      // ═══════════════════════════════════════════════════════════════════════

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

      // If HSA found a narrative for RLM, downgrade (line has a public explanation)
      if (signalTier === "NO-NARRATIVE RLM" && hsaNarrative && hsaNarrative !== "NO_NARRATIVE") {
        signalTier = "WATCH";
        alertType = "WATCH_NARRATIVE";
        scenarioKey = `WATCH_NARRATIVE|${absMove.toFixed(1)}pts`;
      }

      // Upgrade to DOUBLE if move is large and fast across spread
      if (signalTier === "NO-NARRATIVE RLM" && absMove >= 1.5 && spreadLayer.booksAgreeing >= 4) {
        signalTier = "DOUBLE NO-NARRATIVE RLM";
        alertType = `DOUBLE_${alertType}`;
        scenarioKey = `DOUBLE_RLM|${spreadLayer.booksAgreeing}books|${absMove.toFixed(1)}pts`;
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  CONFIDENCE SCORING
      //
      //  Multi-layer confidence: each layer contributes independently.
      //  A moderate ML signal can produce moderate confidence even when
      //  spread is flat.
      // ═══════════════════════════════════════════════════════════════════════

      let confidenceScore = 0;

      // Spread contribution (0-30 points)
      if (spreadLayer.hasMeaningfulMove) {
        confidenceScore += 15;
        confidenceScore += Math.min(spreadLayer.booksAgreeing * 3, 9);
        if (spreadLayer.velocity >= 0.5) confidenceScore += 6;
      } else if (spreadLayer.hasMinorMove) {
        confidenceScore += 5;
      }

      // ML contribution (0-30 points)
      if (mlLayer.hasMeaningfulMove) {
        confidenceScore += 15;
        confidenceScore += Math.min(mlLayer.booksAgreeing * 3, 9);
        if (mlLayer.velocity >= (isMLPrimary ? 1.0 : 1.5)) confidenceScore += 6;
      } else if (mlLayer.hasMinorMove) {
        confidenceScore += 8; // ML minor moves still carry weight
      }

      // Totals contribution (0-15 points)
      if (totalLayer.hasMeaningfulMove) {
        confidenceScore += 10;
        if (totalLayer.booksAgreeing >= 2) confidenceScore += 5;
      } else if (totalLayer.hasMinorMove) {
        confidenceScore += 3;
      }

      // Splits alignment bonus (0-15 points)
      if (sharpDivergence) {
        confidenceScore += 10;
        if (divergenceGap >= 15) confidenceScore += 5;
      }

      // Cross-layer confirmation bonus (0-10 points)
      const layersWithSignal = [spreadSignal, mlSignal, totalSignal].filter(s => s !== "NONE").length;
      if (layersWithSignal >= 2) confidenceScore += 5;
      if (layersWithSignal >= 3) confidenceScore += 5;

      // Cap at 100
      confidenceScore = Math.min(confidenceScore, 100);

      // ═══════════════════════════════════════════════════════════════════════
      //  BUILD ALERT OUTPUT
      // ═══════════════════════════════════════════════════════════════════════

      // Opening and current spread (consensus average across books)
      const openSpread = hasSpreadData
        ? parseFloat((bookSpreads.reduce((sum, b) => sum + b.open, 0) / bookSpreads.length).toFixed(1))
        : null;
      const currentSpread = hasSpreadData
        ? parseFloat((bookSpreads.reduce((sum, b) => sum + b.current, 0) / bookSpreads.length).toFixed(1))
        : null;

      const alert: Record<string, unknown> = {
        home_team: homeTeam,
        away_team: awayTeam,
        league,
        sharp_team: sharpTeam,
        fade_team: fadeTeam,
        signal_tier: signalTier,
        alert_type: alertType,
        scenario_key: scenarioKey,
        opening_spread: openSpread,
        current_spread: currentSpread,
        line_move: parseFloat(consensusMove.toFixed(1)),
        books_agreeing: Math.max(spreadLayer.booksAgreeing, mlLayer.booksAgreeing),
        total_books: totalBooks,
        velocity_per_hour: parseFloat(spreadVelocity.toFixed(2)),
        confidence_score: confidenceScore,
        hsa_narrative: hsaNarrative,
        detected_at: now.toISOString(),
      };

      // Moneyline data (all sports)
      if (hasMLData) {
        alert.moneyline_move = parseFloat(consensusMLRaw.toFixed(0));
        alert.ml_prob_delta = parseFloat(consensusMLProbDelta.toFixed(2));
        // Store open/current ML for display
        if (bookMLs.length > 0) {
          alert.home_ml_open = parseFloat((bookMLs.reduce((s, b) => s + b.openML, 0) / bookMLs.length).toFixed(0));
          alert.home_ml_current = parseFloat((bookMLs.reduce((s, b) => s + b.currML, 0) / bookMLs.length).toFixed(0));
        }
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

      // Layer diagnostics — useful for debugging and HSA context
      alert.spread_signal = spreadSignal;
      alert.ml_signal = mlSignal;
      alert.total_signal = totalSignal;
      alert.primary_source = primarySource;

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
