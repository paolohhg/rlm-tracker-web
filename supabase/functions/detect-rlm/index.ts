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

/** Format spread for display: +3.5 or -7 */
function fmtSpread(n: number | null): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

type Confidence = "PASS" | "LOW" | "MODERATE" | "HIGH";

function scoreToConfidence(score: number): Confidence {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MODERATE";
  if (score >= 15) return "LOW";
  return "PASS";
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

// ── Per-market read types ────────────────────────────────────────────────────

interface MarketRead {
  lean: string;        // e.g. "Nebraska -13.5", "Under 161.5", "TCU ML", "PASS"
  confidence: Confidence;
  signal_type: string; // e.g. "RLM_SPREAD", "PUBLIC_DRIVEN", "STEAM_TOTAL", "NO_EDGE"
  summary_reason: string;
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse optional request body ──────────────────────────────
    // Accepts { slateDate?: "2026-03-19", oddsWindowHours?: 18 }
    let slateDate: string | null = null;
    let oddsWindowHours = 18; // default: 18h lookback for odds freshness
    try {
      const body = await req.json();
      if (body?.slateDate) slateDate = body.slateDate;       // "YYYY-MM-DD"
      if (body?.oddsWindowHours) oddsWindowHours = body.oddsWindowHours;
    } catch { /* no body or invalid JSON — use defaults */ }

    const now = new Date();
    const nowISO = now.toISOString();

    // ═══════════════════════════════════════════════════════════════
    //  SLATE WINDOW — only fetch games that haven't started yet
    //
    //  • game_time > now + 5 min (exclude games about to tip)
    //  • game_time < end of slate window
    //  • If slateDate provided: only that calendar date
    //  • Default: games starting in the next 24 hours
    //
    //  ODDS FRESHNESS — only snapshots within oddsWindowHours
    //  (default 18h covers overnight sharp → pregame)
    // ═══════════════════════════════════════════════════════════════

    const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const oddsWindowStart = new Date(now.getTime() - oddsWindowHours * 60 * 60 * 1000).toISOString();

    let slateStart: string;
    let slateEnd: string;

    if (slateDate) {
      // Specific date requested — use full calendar day (midnight to midnight UTC)
      slateStart = `${slateDate}T00:00:00Z`;
      slateEnd = `${slateDate}T23:59:59Z`;
    } else {
      // Default: games starting from now+5min through next 24 hours
      slateStart = fiveMinFromNow;
      slateEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    // ── Step 1: Find active slate games (pregame only) ───────────
    //    Get distinct game keys where game_time is in our slate window
    //    and game hasn't started yet (game_time > now)
    const { data: slateGames, error: slateErr } = await supabase
      .from("odds_snapshots")
      .select("league, home_team, away_team, game_time")
      .gt("game_time", fiveMinFromNow)     // pregame only — hasn't started
      .gte("game_time", slateStart)         // within slate window start
      .lte("game_time", slateEnd)           // within slate window end
      .gte("fetched_at", oddsWindowStart)   // odds snapshot is fresh
      .order("game_time", { ascending: true });

    if (slateErr) throw slateErr;
    if (!slateGames || slateGames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pregame slate games found", slate: { slateStart, slateEnd } }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate to unique game keys
    const activeGameKeys = new Set<string>();
    const gameTimeMap: Record<string, string> = {};
    for (const g of slateGames) {
      const key = `${g.league}|${g.home_team}|${g.away_team}`;
      activeGameKeys.add(key);
      if (!gameTimeMap[key]) gameTimeMap[key] = g.game_time;
    }

    // ── Step 2: Fetch odds only for active slate games ───────────
    //    Use the freshness window, not a 7-day lookback
    const { data: recentOdds, error } = await supabase
      .from("odds_snapshots")
      .select("*")
      .gt("game_time", fiveMinFromNow)       // game hasn't started
      .gte("fetched_at", oddsWindowStart)     // fresh odds only
      .order("fetched_at", { ascending: true });

    if (error) throw error;
    if (!recentOdds || recentOdds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No fresh odds for slate", slate: { games: activeGameKeys.size } }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Group by game key — only include games on the active slate
    const gameMap: Record<string, any[]> = {};
    for (const snap of recentOdds) {
      const key = `${snap.league}|${snap.home_team}|${snap.away_team}`;
      if (!activeGameKeys.has(key)) continue; // skip non-slate games
      if (!gameMap[key]) gameMap[key] = [];
      gameMap[key].push(snap);
    }

    const results: any[] = [];
    const skippedGames: string[] = [];

    for (const [gameKey, snaps] of Object.entries(gameMap)) {
      if (snaps.length < 2) continue;

      const [league, homeTeam, awayTeam] = gameKey.split("|");
      snaps.sort((a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime());

      // ── Per-book: use OPENING + LATEST only ──────────────────
      //    For movement analysis, we only need the first and last
      //    snapshot per book. This prevents intermediate noise and
      //    ensures "opening" is the true first line for this book
      //    within the freshness window.
      const bookMap: Record<string, any[]> = {};
      for (const snap of snaps) {
        const bk = snap.bookmaker || "unknown";
        if (!bookMap[bk]) bookMap[bk] = [];
        bookMap[bk].push(snap);
      }

      // Trim each book to [first, last] — skip if only 1 snapshot
      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length <= 1) continue;
        // Keep only opening and latest — drop intermediate noise
        bookMap[book] = [bookSnaps[0], bookSnaps[bookSnaps.length - 1]];
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
      //  Delta > 0 = home became MORE favored.
      //  Delta < 0 = away became MORE favored.
      // ═══════════════════════════════════════════════════════════════════════

      const mlProbDeltas: number[] = [];
      const mlRawMovements: number[] = [];
      const bookMLs: { openML: number; currML: number; openProb: number; currProb: number; book: string }[] = [];

      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        if (bookSnaps.length < 2) continue;
        const openML = bookSnaps[0].moneyline_home;
        const currML = bookSnaps[bookSnaps.length - 1].moneyline_home;
        if (openML != null && currML != null) {
          const openProb = americanToImpliedProb(openML);
          const currProb = americanToImpliedProb(currML);
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
      //  CONSENSUS CALCULATIONS
      // ═══════════════════════════════════════════════════════════════════════

      const isMLPrimary = league === "NHL" || league === "MLB";
      const hasSpreadData = bookMovements.length > 0;
      const hasMLData = mlProbDeltas.length > 0;
      const hasTotalData = totalMovements.length > 0;

      if (!hasSpreadData && !hasMLData) continue;

      const consensusMove = median(bookMovements);
      const consensusMLProbDelta = median(mlProbDeltas);
      const consensusMLRaw = median(mlRawMovements);
      const consensusTotalMove = median(totalMovements);

      const absMove = Math.abs(consensusMove);
      const absMLProbDelta = Math.abs(consensusMLProbDelta);
      const absTotalMove = Math.abs(consensusTotalMove);

      // ═══════════════════════════════════════════════════════════════════════
      //  LEAGUE-AWARE THRESHOLDS
      // ═══════════════════════════════════════════════════════════════════════

      const spreadThreshold = isMLPrimary ? 0.3 : 0.5;
      const mlThreshold = isMLPrimary ? 1.5 : 2.0;
      const mlMinorThreshold = isMLPrimary ? 0.8 : 1.0;
      const totalThreshold = isMLPrimary ? 0.5 : 1.0;

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
      const mlVelocity = hoursElapsed > 0 ? absMLProbDelta / hoursElapsed : 0;
      const totalVelocity = hoursElapsed > 0 ? absTotalMove / hoursElapsed : 0;

      // ═══════════════════════════════════════════════════════════════════════
      //  SPLITS FETCH
      // ═══════════════════════════════════════════════════════════════════════

      let sharpDivergence = false;
      let sharpSide: string | null = null;
      let homeBetsPct: number | null = null;
      let homeMoneyPct: number | null = null;
      let awayBetsPct: number | null = null;
      let awayMoneyPct: number | null = null;
      let divergenceGap = 0;

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
          awayBetsPct = s.away_ticket_pct ?? (100 - (homeBetsPct ?? 50));
          awayMoneyPct = s.away_money_pct ?? (100 - (homeMoneyPct ?? 50));

          const homeDivergence = (homeMoneyPct ?? 0) - (homeBetsPct ?? 0);
          const awayDivergence = (awayMoneyPct ?? 0) - (awayBetsPct ?? 0);
          divergenceGap = Math.max(Math.abs(homeDivergence), Math.abs(awayDivergence));

          if (divergenceGap >= 8) {
            sharpDivergence = true;
            sharpSide = homeDivergence > awayDivergence ? homeTeam : awayTeam;
          }
        }
      } catch { /* non-critical */ }

      // ═══════════════════════════════════════════════════════════════════════
      //  PUBLIC DIRECTION DETECTION
      //
      //  Determine which side the public is on (by ticket %).
      //  Then check if spread movement is WITH or AGAINST public.
      //  Movement WITH public = PUBLIC_DRIVEN (no sharp edge)
      //  Movement AGAINST public = potential RLM
      // ═══════════════════════════════════════════════════════════════════════

      // Public side: the team with >50% of tickets
      const publicOnHome = (homeBetsPct ?? 50) > 50;
      const publicTeamName = publicOnHome ? homeTeam : awayTeam;

      // Did spread move toward public side?
      // consensusMove < 0 → line moved toward home being more favored
      // consensusMove > 0 → line moved toward away being more favored
      const spreadMovedTowardHome = consensusMove < 0;
      const spreadMovedWithPublic = hasSpreadData && absMove >= 0.2 &&
        ((publicOnHome && spreadMovedTowardHome) || (!publicOnHome && !spreadMovedTowardHome));

      // Is spread movement AGAINST public? (RLM indicator)
      const spreadAgainstPublic = hasSpreadData && absMove >= 0.2 && !spreadMovedWithPublic;

      // ═══════════════════════════════════════════════════════════════════════
      //  THREE SIGNAL LAYER OBJECTS
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
        move: consensusMLProbDelta,
        rawMove: consensusMLRaw,
        absMove: absMLProbDelta,
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
      //  Now includes PUBLIC_DRIVEN: when movement is WITH public and
      //  there's no sharp divergence confirming the move.
      //
      //  Priority: STEAM > RLM > SHARP_ACCUM > SHADE > PUBLIC_DRIVEN > MINOR > NONE
      // ═══════════════════════════════════════════════════════════════════════

      type LayerSignal = "STEAM" | "RLM" | "SHARP_ACCUM" | "SHADE" | "PUBLIC_DRIVEN" | "MINOR" | "NONE";

      // ── Spread layer signal ──
      let spreadSignal: LayerSignal = "NONE";
      if (spreadLayer.hasMeaningfulMove) {
        if (spreadMovedWithPublic && !sharpDivergence) {
          // Movement is WITH public, no sharp confirmation → PUBLIC_DRIVEN
          spreadSignal = "PUBLIC_DRIVEN";
        } else if (spreadLayer.booksAgreeing >= 3 && spreadLayer.velocity >= 0.5) {
          spreadSignal = "STEAM";
        } else if (spreadLayer.booksAgreeing >= 3) {
          spreadSignal = "RLM";
        } else if (spreadLayer.booksAgreeing >= 1) {
          spreadSignal = "SHADE";
        } else {
          // Meaningful move but can't confirm direction → still note it
          spreadSignal = "MINOR";
        }
      } else if (spreadLayer.hasMinorMove) {
        if (spreadMovedWithPublic && !sharpDivergence) {
          spreadSignal = "PUBLIC_DRIVEN";
        } else {
          spreadSignal = "MINOR";
        }
      }

      // ── ML layer signal ──
      let mlSignal: LayerSignal = "NONE";
      if (mlLayer.hasMeaningfulMove) {
        const mlSteamVelocity = isMLPrimary ? 1.5 : 2.0;
        if (mlLayer.booksAgreeing >= 3 && mlLayer.velocity >= mlSteamVelocity) {
          mlSignal = "STEAM";
        } else if (mlLayer.booksAgreeing >= 3) {
          mlSignal = "RLM";
        } else if (mlLayer.booksAgreeing >= 1) {
          mlSignal = "SHADE";
        } else {
          mlSignal = "MINOR";
        }
      } else if (mlLayer.hasMinorMove) {
        const mlMovingTowardSharp = sharpSide
          ? (sharpSide === homeTeam && consensusMLProbDelta > 0) ||
            (sharpSide === awayTeam && consensusMLProbDelta < 0)
          : false;

        if (mlMovingTowardSharp && sharpDivergence) {
          mlSignal = "SHARP_ACCUM";
        } else if (absMLProbDelta >= mlMinorThreshold) {
          mlSignal = "MINOR";
        }
      }

      // ── Totals layer signal ──
      let totalSignal: LayerSignal = "NONE";
      if (totalLayer.hasMeaningfulMove) {
        const totalSteamVelocity = isMLPrimary ? 0.5 : 1.0;
        if (totalLayer.booksAgreeing >= 3 && totalLayer.velocity >= totalSteamVelocity) {
          totalSignal = "STEAM";
        } else if (totalLayer.booksAgreeing >= 2) {
          totalSignal = "SHADE";
        } else {
          totalSignal = "MINOR";
        }
      } else if (totalLayer.hasMinorMove) {
        totalSignal = "MINOR";
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  PER-MARKET STRUCTURED READS
      //
      //  Each market produces its own lean/confidence/signal_type/summary.
      //  These are INDEPENDENT — a quiet spread cannot erase a meaningful
      //  total or ML read.
      // ═══════════════════════════════════════════════════════════════════════

      // Consensus averages for display
      const openSpread = hasSpreadData
        ? parseFloat((bookSpreads.reduce((s, b) => s + b.open, 0) / bookSpreads.length).toFixed(1))
        : null;
      const currentSpread = hasSpreadData
        ? parseFloat((bookSpreads.reduce((s, b) => s + b.current, 0) / bookSpreads.length).toFixed(1))
        : null;
      const openTotal = hasTotalData
        ? parseFloat((bookTotals.reduce((s, b) => s + b.open, 0) / bookTotals.length).toFixed(1))
        : null;
      const currentTotal = hasTotalData
        ? parseFloat((bookTotals.reduce((s, b) => s + b.current, 0) / bookTotals.length).toFixed(1))
        : null;
      const avgOpenMLHome = bookMLs.length > 0
        ? parseFloat((bookMLs.reduce((s, b) => s + b.openML, 0) / bookMLs.length).toFixed(0))
        : null;
      const avgCurrMLHome = bookMLs.length > 0
        ? parseFloat((bookMLs.reduce((s, b) => s + b.currML, 0) / bookMLs.length).toFixed(0))
        : null;

      // ── SIDE / SPREAD market read ──
      const sideRead: MarketRead = (() => {
        // Determine which team the spread lean is toward
        // consensusMove < 0 → home becoming more favored → lean home side
        // consensusMove > 0 → away becoming more favored → lean away side
        const leanTeam = consensusMove < 0 ? homeTeam : awayTeam;
        const leanSpread = currentSpread != null
          ? `${leanTeam} ${fmtSpread(consensusMove < 0 ? currentSpread : -(currentSpread ?? 0))}`
          : leanTeam;

        if (spreadSignal === "NONE" && !spreadLayer.hasMinorMove) {
          return { lean: "PASS", confidence: "PASS", signal_type: "NO_EDGE", summary_reason: "No meaningful spread movement detected." };
        }

        let score = 0;
        let sigType = "NO_EDGE";
        const reasons: string[] = [];

        if (spreadSignal === "STEAM") {
          score = 80;
          sigType = "STEAM_SPREAD";
          reasons.push(`Coordinated steam: ${booksAgreeingSpread}/${totalBooks} books moved ${fmtSpread(consensusMove)}.`);
          reasons.push(`Velocity: ${spreadVelocity.toFixed(2)} pts/hr.`);
        } else if (spreadSignal === "RLM") {
          score = 60;
          sigType = "RLM_SPREAD";
          reasons.push(`Reverse line movement: ${booksAgreeingSpread} books against ${(homeBetsPct ?? 50) > 50 ? `${homeBetsPct}% public on ${homeTeam}` : `${awayBetsPct ?? 50}% public on ${awayTeam}`}.`);
          reasons.push(`Line: ${fmtSpread(openSpread)} → ${fmtSpread(currentSpread)}.`);
        } else if (spreadSignal === "SHADE") {
          score = 35;
          sigType = "BOOK_SHADE";
          reasons.push(`${booksAgreeingSpread} book(s) shaded line. Move: ${fmtSpread(openSpread)} → ${fmtSpread(currentSpread)}.`);
        } else if (spreadSignal === "PUBLIC_DRIVEN") {
          score = 18;
          sigType = "PUBLIC_DRIVEN";
          reasons.push(`Line moved WITH ${(homeBetsPct ?? 50) > 50 ? `${homeBetsPct}%` : `${awayBetsPct ?? 50}%`} public on ${publicTeamName}. No sharp confirmation.`);
        } else {
          score = 10;
          sigType = "NO_EDGE";
          reasons.push(`Minor spread movement (${fmtSpread(consensusMove)}). Insufficient for directional lean.`);
        }

        // Splits alignment bonus
        if (sharpDivergence && spreadAgainstPublic) score += 10;

        // Cross-market confirmation bonus
        if (mlLayer.hasMinorMove && Math.sign(consensusMLProbDelta) === Math.sign(-consensusMove)) score += 5;

        const conf = scoreToConfidence(score);
        return {
          lean: conf === "PASS" ? "PASS" : leanSpread,
          confidence: conf,
          signal_type: sigType,
          summary_reason: reasons.join(" "),
        };
      })();

      // ── TOTAL market read ──
      const totalRead: MarketRead = (() => {
        if (totalSignal === "NONE" && !totalLayer.hasMinorMove) {
          return { lean: "PASS", confidence: "PASS", signal_type: "NO_EDGE", summary_reason: "No meaningful total movement." };
        }

        const direction = consensusTotalMove < 0 ? "Under" : "Over";
        const leanDisplay = currentTotal != null ? `${direction} ${currentTotal}` : direction;

        let score = 0;
        let sigType = "NO_EDGE";
        const reasons: string[] = [];

        if (totalSignal === "STEAM") {
          score = 70;
          sigType = "STEAM_TOTAL";
          reasons.push(`Coordinated total steam: ${booksAgreeingTotal} books moved ${direction.toLowerCase()}.`);
          reasons.push(`Total: ${openTotal} → ${currentTotal} (${consensusTotalMove > 0 ? "+" : ""}${consensusTotalMove.toFixed(1)}).`);
        } else if (totalSignal === "SHADE") {
          score = 35;
          sigType = "SHARP_ACCUMULATION_TOTAL";
          reasons.push(`${booksAgreeingTotal} books moved total ${direction.toLowerCase()}: ${openTotal} → ${currentTotal}.`);
        } else if (totalSignal === "MINOR") {
          score = 15;
          sigType = "NO_EDGE";
          reasons.push(`Minor total movement ${direction.toLowerCase()}: ${openTotal ?? "?"} → ${currentTotal ?? "?"} (${consensusTotalMove > 0 ? "+" : ""}${consensusTotalMove.toFixed(1)}).`);
        }

        // Cross-layer confirmation: if spread or ML also moved directionally
        if (spreadLayer.hasMinorMove || mlLayer.hasMinorMove) score += 5;

        const conf = scoreToConfidence(score);
        return {
          lean: conf === "PASS" ? "PASS" : leanDisplay,
          confidence: conf,
          signal_type: sigType,
          summary_reason: reasons.join(" "),
        };
      })();

      // ── MONEYLINE market read ──
      const mlRead: MarketRead = (() => {
        if (mlSignal === "NONE" && !mlLayer.hasMinorMove) {
          return { lean: "PASS", confidence: "PASS", signal_type: "NO_EDGE", summary_reason: "No meaningful moneyline movement." };
        }

        // ML direction: positive prob delta = home becoming more favored
        const mlLeanTeam = consensusMLProbDelta > 0 ? homeTeam : awayTeam;
        const leanDisplay = `${mlLeanTeam} ML`;

        let score = 0;
        let sigType = "NO_EDGE";
        const reasons: string[] = [];

        if (mlSignal === "STEAM") {
          score = 75;
          sigType = "STEAM_ML";
          reasons.push(`ML steam: ${booksAgreeingML} books moved toward ${mlLeanTeam}.`);
          reasons.push(`Implied prob shift: ${absMLProbDelta.toFixed(1)}%. Velocity: ${mlVelocity.toFixed(1)}%/hr.`);
        } else if (mlSignal === "RLM") {
          score = 55;
          sigType = "RLM_ML";
          reasons.push(`ML reverse line movement: ${booksAgreeingML} books improving ${mlLeanTeam}.`);
          if (sharpDivergence && sharpSide === mlLeanTeam) {
            reasons.push(`Money% > bets% on ${mlLeanTeam} confirms sharp side.`);
            score += 10;
          }
        } else if (mlSignal === "SHARP_ACCUM") {
          score = 45;
          sigType = "SHARP_ACCUMULATION_ML";
          reasons.push(`Gradual ML drift toward ${mlLeanTeam} (${absMLProbDelta.toFixed(1)}% implied prob shift).`);
          if (sharpDivergence) {
            reasons.push(`Money%/bets% divergence (${divergenceGap.toFixed(0)}%) confirms sharp accumulation.`);
            score += 8;
          }
        } else if (mlSignal === "SHADE") {
          score = 30;
          sigType = "SHADE_ML";
          reasons.push(`${booksAgreeingML} book(s) shaded ML toward ${mlLeanTeam}. Prob shift: ${absMLProbDelta.toFixed(1)}%.`);
        } else {
          score = 12;
          sigType = "NO_EDGE";
          reasons.push(`Minor ML movement toward ${mlLeanTeam} (${absMLProbDelta.toFixed(1)}% implied prob shift).`);
        }

        // Splits confirmation for ML
        if (sharpDivergence && sharpSide === mlLeanTeam && sigType !== "SHARP_ACCUMULATION_ML") score += 8;

        // Spread confirmation: if spread also moved toward same team
        const spreadLeanTeam = consensusMove < 0 ? homeTeam : awayTeam;
        if (spreadLayer.hasMinorMove && spreadLeanTeam === mlLeanTeam) score += 5;

        const conf = scoreToConfidence(score);
        return {
          lean: conf === "PASS" ? "PASS" : leanDisplay,
          confidence: conf,
          signal_type: sigType,
          summary_reason: reasons.join(" "),
        };
      })();

      // ═══════════════════════════════════════════════════════════════════════
      //  COMPOSITE SIGNAL — overall_badge derives from STRONGEST market read
      //
      //  Priority: STEAM > RLM > SHARP_ACCUM > SHADE > PUBLIC_DRIVEN >
      //            WATCH > FROZEN
      //
      //  A quiet spread CANNOT force FROZEN if ML or total has a real read.
      // ═══════════════════════════════════════════════════════════════════════

      const signalPriority = (s: LayerSignal): number => {
        switch (s) {
          case "STEAM": return 6;
          case "RLM": return 5;
          case "SHARP_ACCUM": return 4;
          case "SHADE": return 3;
          case "PUBLIC_DRIVEN": return 2;
          case "MINOR": return 1;
          case "NONE": return 0;
        }
      };

      const bestSpread = signalPriority(spreadSignal);
      const bestML = signalPriority(mlSignal);
      const bestTotal = signalPriority(totalSignal);
      const bestOverall = Math.max(bestSpread, bestML, bestTotal);

      // primary_market: which market drives the classification
      let primaryMarket: "side" | "total" | "moneyline" | "none" = "none";
      if (bestSpread >= bestML && bestSpread >= bestTotal && bestSpread > 0) primaryMarket = "side";
      else if (bestML >= bestTotal && bestML > 0) primaryMarket = "moneyline";
      else if (bestTotal > 0) primaryMarket = "total";

      type SignalSource = "spread" | "ml" | "total";
      let primarySource: SignalSource = "spread";
      if (bestML > bestSpread && bestML >= bestTotal) primarySource = "ml";
      else if (bestTotal > bestSpread && bestTotal > bestML) primarySource = "total";

      // ── Classify overall badge + alert_type ──

      let signalTier = "";
      let alertType = "";
      let scenarioKey = "";

      if (bestOverall >= 6) {
        signalTier = "STEAM MOVE";
        if (spreadSignal === "STEAM") { alertType = "STEAM_SPREAD"; }
        else if (mlSignal === "STEAM") { alertType = "STEAM_ML"; }
        else { alertType = "STEAM_TOTAL"; }
        scenarioKey = buildScenarioKey(alertType, spreadLayer, mlLayer, totalLayer);
      }
      else if (bestOverall >= 5) {
        signalTier = "NO-NARRATIVE RLM";
        alertType = spreadSignal === "RLM" ? "RLM_SPREAD" : "RLM_ML";
        scenarioKey = buildScenarioKey(alertType, spreadLayer, mlLayer, totalLayer);
      }
      else if (bestOverall >= 4) {
        signalTier = "SHARP ACCUMULATION";
        alertType = "SHARP_ACCUM";
        scenarioKey = `SHARP_ACCUM|ml${absMLProbDelta.toFixed(1)}%|div${divergenceGap.toFixed(0)}%`;
      }
      else if (bestOverall >= 3) {
        signalTier = "BOOK SHADE";
        if (spreadSignal === "SHADE") alertType = "SHADE_SPREAD";
        else if (mlSignal === "SHADE") alertType = "SHADE_ML";
        else alertType = "SHADE_TOTAL";
        scenarioKey = buildScenarioKey("SHADE", spreadLayer, mlLayer, totalLayer);
      }
      else if (bestOverall >= 2) {
        // PUBLIC_DRIVEN — movement with public, no sharp edge
        signalTier = "WATCH";
        alertType = "PUBLIC_DRIVEN";
        scenarioKey = `PUBLIC|${publicTeamName}|${absMove.toFixed(1)}pts`;
      }
      // ── WATCH — any minor activity ──
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
      // ── FROZEN LINE — absolute last resort ──
      // ALL three layers must be NONE, no divergence, 3h+ tracking
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

      if (!signalTier) continue;

      // ═══════════════════════════════════════════════════════════════════════
      //  DIRECTION — sharp team / fade team
      // ═══════════════════════════════════════════════════════════════════════

      let sharpTeam: string;
      let fadeTeam: string;

      if (signalTier === "SHARP ACCUMULATION" && sharpSide) {
        sharpTeam = sharpSide;
        fadeTeam = sharpSide === homeTeam ? awayTeam : homeTeam;
      } else if (primarySource === "ml" && mlLayer.hasMinorMove) {
        sharpTeam = consensusMLProbDelta > 0 ? homeTeam : awayTeam;
        fadeTeam = consensusMLProbDelta > 0 ? awayTeam : homeTeam;
      } else if (primarySource === "total") {
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
        sharpTeam = consensusMove > 0 ? awayTeam : homeTeam;
        fadeTeam = consensusMove > 0 ? homeTeam : awayTeam;
      } else if (mlLayer.hasMinorMove) {
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
      //  HSA NARRATIVE
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

      // Narrative-based tier adjustments
      if (signalTier === "NO-NARRATIVE RLM" && hsaNarrative && hsaNarrative !== "NO_NARRATIVE") {
        signalTier = "WATCH";
        alertType = "WATCH_NARRATIVE";
        scenarioKey = `WATCH_NARRATIVE|${absMove.toFixed(1)}pts`;
      }

      if (signalTier === "NO-NARRATIVE RLM" && absMove >= 1.5 && spreadLayer.booksAgreeing >= 4) {
        signalTier = "DOUBLE NO-NARRATIVE RLM";
        alertType = `DOUBLE_${alertType}`;
        scenarioKey = `DOUBLE_RLM|${spreadLayer.booksAgreeing}books|${absMove.toFixed(1)}pts`;
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  OVERALL CONFIDENCE — multi-layer composite
      // ═══════════════════════════════════════════════════════════════════════

      let confidenceScore = 0;

      // Spread contribution (0-30)
      if (spreadLayer.hasMeaningfulMove) {
        confidenceScore += 15;
        confidenceScore += Math.min(spreadLayer.booksAgreeing * 3, 9);
        if (spreadLayer.velocity >= 0.5) confidenceScore += 6;
      } else if (spreadLayer.hasMinorMove) {
        confidenceScore += 5;
      }

      // ML contribution (0-30)
      if (mlLayer.hasMeaningfulMove) {
        confidenceScore += 15;
        confidenceScore += Math.min(mlLayer.booksAgreeing * 3, 9);
        if (mlLayer.velocity >= (isMLPrimary ? 1.0 : 1.5)) confidenceScore += 6;
      } else if (mlLayer.hasMinorMove) {
        confidenceScore += 8;
      }

      // Totals contribution (0-15)
      if (totalLayer.hasMeaningfulMove) {
        confidenceScore += 10;
        if (totalLayer.booksAgreeing >= 2) confidenceScore += 5;
      } else if (totalLayer.hasMinorMove) {
        confidenceScore += 3;
      }

      // Splits alignment (0-15)
      if (sharpDivergence) {
        confidenceScore += 10;
        if (divergenceGap >= 15) confidenceScore += 5;
      }

      // Cross-layer confirmation (0-10)
      const layersWithSignal = [spreadSignal, mlSignal, totalSignal].filter(s => s !== "NONE").length;
      if (layersWithSignal >= 2) confidenceScore += 5;
      if (layersWithSignal >= 3) confidenceScore += 5;

      confidenceScore = Math.min(confidenceScore, 100);

      // Determine the primary signal description for the structured output
      const primarySignal = (() => {
        const best = [
          { read: sideRead, market: "side" },
          { read: totalRead, market: "total" },
          { read: mlRead, market: "moneyline" },
        ].sort((a, b) => {
          const confOrder = { HIGH: 4, MODERATE: 3, LOW: 2, PASS: 1 };
          return (confOrder[b.read.confidence] || 0) - (confOrder[a.read.confidence] || 0);
        })[0];
        return best.read.confidence !== "PASS" ? best.read.signal_type : "NO_EDGE";
      })();

      // ═══════════════════════════════════════════════════════════════════════
      //  FROZEN SAFETY GUARD — absolute last-resort override
      //
      //  If ANY per-market read produced a non-PASS confidence, the game
      //  has meaningful activity and must NOT be FROZEN.  Promote to WATCH.
      // ═══════════════════════════════════════════════════════════════════════

      if (signalTier === "FROZEN LINE") {
        const anyNonPass =
          sideRead.confidence !== "PASS" ||
          totalRead.confidence !== "PASS" ||
          mlRead.confidence !== "PASS";

        if (anyNonPass) {
          signalTier = "WATCH";
          alertType = "WATCH";
          // Build descriptive scenario key from what was actually found
          const reasons: string[] = ["DEFROSTED"];
          if (sideRead.confidence !== "PASS") reasons.push(`side:${sideRead.confidence}`);
          if (totalRead.confidence !== "PASS") reasons.push(`tot:${totalRead.confidence}`);
          if (mlRead.confidence !== "PASS") reasons.push(`ml:${mlRead.confidence}`);
          scenarioKey = reasons.join("|");
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      //  BUILD ALERT OUTPUT
      // ═══════════════════════════════════════════════════════════════════════

      const alert: Record<string, unknown> = {
        home_team: homeTeam,
        away_team: awayTeam,
        league,
        game_time: gameTimeMap[gameKey] ?? snaps[0].game_time ?? null,
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

        // ── Per-market structured reads (JSON) ──
        side_lean: sideRead.lean,
        side_confidence: sideRead.confidence,
        side_signal_type: sideRead.signal_type,
        side_summary: sideRead.summary_reason,

        total_lean: totalRead.lean,
        total_confidence: totalRead.confidence,
        total_signal_type: totalRead.signal_type,
        total_summary: totalRead.summary_reason,

        ml_lean: mlRead.lean,
        ml_confidence: mlRead.confidence,
        ml_signal_type: mlRead.signal_type,
        ml_summary: mlRead.summary_reason,

        primary_market: primaryMarket,
        primary_signal: primarySignal,
        overall_badge: signalTier,
      };

      // Moneyline data
      if (hasMLData) {
        alert.moneyline_move = parseFloat(consensusMLRaw.toFixed(0));
        alert.ml_prob_delta = parseFloat(consensusMLProbDelta.toFixed(2));
        if (bookMLs.length > 0) {
          alert.home_ml_open = avgOpenMLHome;
          alert.home_ml_current = avgCurrMLHome;
        }
      }

      // Totals movement
      if (hasTotalData) {
        alert.total_move = parseFloat(consensusTotalMove.toFixed(1));
        alert.opening_total = openTotal;
        alert.current_total = currentTotal;
      }

      // Splits
      if (homeBetsPct != null) {
        alert.home_bets_pct = homeBetsPct;
        alert.home_money_pct = homeMoneyPct;
      }

      // Layer diagnostics
      alert.spread_signal = spreadSignal;
      alert.ml_signal = mlSignal;
      alert.total_signal = totalSignal;
      alert.primary_source = primarySource;

      // Upsert
      await supabase.from("rlm_alerts").upsert(alert, { onConflict: "home_team,away_team,league" });
      results.push(alert);
    }

    return new Response(
      JSON.stringify({
        success: true,
        alerts: results.length,
        slate: {
          slateStart,
          slateEnd,
          oddsWindowHours,
          oddsWindowStart,
          totalSlateGames: activeGameKeys.size,
          processedGames: Object.keys(gameMap).length,
          skippedGames: skippedGames.length > 0 ? skippedGames : undefined,
        },
        results,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
