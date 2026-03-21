import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CANONICAL TYPES — the single source of truth for HSA output
// ═══════════════════════════════════════════════════════════════════════════════

type Confidence = "PASS" | "LOW" | "MODERATE" | "HIGH";

type LayerSignal =
  | "STEAM"
  | "RLM"
  | "SHARP_ACCUM"
  | "SHADE"
  | "PUBLIC_DRIVEN"
  | "MINOR"
  | "NONE";

/** Per-market structured read — never null, always fully populated. */
interface MarketRead {
  lean: string;           // e.g. "Nebraska -13.5", "Under 161.5", "TCU ML", "PASS"
  confidence: Confidence;
  signal_type: string;    // e.g. "RLM_SPREAD", "STEAM_TOTAL", "NO_EDGE"
  summary_reason: string;
}

const PASS_READ: MarketRead = Object.freeze({
  lean: "PASS",
  confidence: "PASS" as Confidence,
  signal_type: "NO_EDGE",
  summary_reason: "No meaningful activity detected in this market.",
});

/** Per-layer movement facts extracted from book snapshots. */
interface LayerFacts {
  hasData: boolean;
  consensusMove: number;
  absMove: number;
  booksAgreeing: number;
  totalBooks: number;
  velocity: number;
  hasMeaningfulMove: boolean;
  hasMinorMove: boolean;
}

/**
 * Canonical GameFacts — ALL signal logic, per-market reads, and the final
 * alert derive from this single object.  Nothing else.
 *
 * Built once per game by `buildGameFacts()`, then consumed by:
 *   evaluateLayer()  → LayerSignal per market
 *   buildMarketRead() → MarketRead per market
 *   deriveOverall()  → signal_tier, alert_type, overall_badge
 */
interface GameFacts {
  // Identity
  gameKey: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string | null;
  isMLPrimary: boolean;       // NHL / MLB

  // Layer facts
  spread: LayerFacts;
  ml: LayerFacts;
  total: LayerFacts;

  // Consensus raw values (for display / alert fields)
  consensusSpreadMove: number;
  consensusMLProbDelta: number;
  consensusMLRaw: number;
  consensusTotalMove: number;

  // Display averages
  openSpread: number | null;
  currentSpread: number | null;
  openTotal: number | null;
  currentTotal: number | null;
  avgOpenMLHome: number | null;
  avgCurrMLHome: number | null;

  // Timing
  hoursElapsed: number;
  spreadVelocity: number;
  mlVelocity: number;
  totalVelocity: number;

  // Splits / public
  homeBetsPct: number | null;
  homeMoneyPct: number | null;
  awayBetsPct: number | null;
  awayMoneyPct: number | null;
  sharpDivergence: boolean;
  sharpSide: string | null;
  divergenceGap: number;
  publicOnHome: boolean;
  publicTeamName: string;
  spreadMovedWithPublic: boolean;
  spreadAgainstPublic: boolean;

  // Thresholds (league-aware)
  spreadThreshold: number;
  mlThreshold: number;
  mlMinorThreshold: number;
  totalThreshold: number;

  // Book-level detail for display
  bookSpreads: { open: number; current: number; book: string }[];
  bookMLs: { openML: number; currML: number; openProb: number; currProb: number; book: string }[];
  bookTotals: { open: number; current: number; book: string; firstAt: string; lastAt: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmtSpread(n: number | null): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function scoreToConfidence(score: number): Confidence {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MODERATE";
  if (score >= 15) return "LOW";
  return "PASS";
}

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

function signalPriority(s: LayerSignal): number {
  switch (s) {
    case "STEAM": return 6;
    case "RLM": return 5;
    case "SHARP_ACCUM": return 4;
    case "SHADE": return 3;
    case "PUBLIC_DRIVEN": return 2;
    case "MINOR": return 1;
    case "NONE": return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAGE 1: buildGameFacts()
//
//  Extracts ALL normalized market data for a single game.
//  Returns null if the game has no usable data at all.
// ═══════════════════════════════════════════════════════════════════════════════

async function buildGameFacts(
  gameKey: string,
  snaps: any[],
  gameTime: string | null,
  supabase: any,
): Promise<GameFacts | null> {
  const [league, homeTeam, awayTeam] = gameKey.split("|");
  const isMLPrimary = league === "NHL" || league === "MLB";

  // Sort chronologically
  snaps.sort((a: any, b: any) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime());

  // Per-book: opening + latest only
  const bookMap: Record<string, any[]> = {};
  for (const snap of snaps) {
    const bk = snap.bookmaker || "unknown";
    if (!bookMap[bk]) bookMap[bk] = [];
    bookMap[bk].push(snap);
  }
  for (const [book, bookSnaps] of Object.entries(bookMap)) {
    if (bookSnaps.length <= 1) continue;
    bookMap[book] = [bookSnaps[0], bookSnaps[bookSnaps.length - 1]];
  }

  // ── Layer 1: Spread ─────────────────────────────────────────────
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

  // ── Layer 2: Moneyline (implied probability) ────────────────────
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

  // ── Layer 3: Totals ─────────────────────────────────────────────
  const totalMovements: number[] = [];
  const bookTotals: { open: number; current: number; book: string; firstAt: string; lastAt: string }[] = [];

  for (const [book, bookSnaps] of Object.entries(bookMap)) {
    if (bookSnaps.length < 2) continue;
    const openTotal = bookSnaps[0].total;
    const currTotal = bookSnaps[bookSnaps.length - 1].total;
    if (openTotal != null && currTotal != null) {
      const move = parseFloat((currTotal - openTotal).toFixed(1));
      totalMovements.push(move);
      bookTotals.push({
        open: openTotal, current: currTotal, book,
        firstAt: bookSnaps[0].fetched_at,
        lastAt: bookSnaps[bookSnaps.length - 1].fetched_at,
      });
    }
  }

  const hasSpreadData = bookMovements.length > 0;
  const hasMLData = mlProbDeltas.length > 0;
  const hasTotalData = totalMovements.length > 0;

  if (!hasSpreadData && !hasMLData && !hasTotalData) return null;

  // ── Consensus ───────────────────────────────────────────────────
  const consensusSpreadMove = median(bookMovements);
  const consensusMLProbDelta = median(mlProbDeltas);
  const consensusMLRaw = median(mlRawMovements);
  const consensusTotalMove = median(totalMovements);

  const absSpread = Math.abs(consensusSpreadMove);
  const absML = Math.abs(consensusMLProbDelta);
  const absTotal = Math.abs(consensusTotalMove);

  // ── Thresholds ──────────────────────────────────────────────────
  const spreadThreshold = isMLPrimary ? 0.3 : 0.5;
  const mlThreshold = isMLPrimary ? 1.5 : 2.0;
  const mlMinorThreshold = isMLPrimary ? 0.8 : 1.0;
  const totalThreshold = isMLPrimary ? 0.5 : 1.0;

  // ── Books agreeing ──────────────────────────────────────────────
  const booksAgreeingSpread = hasSpreadData
    ? bookMovements.filter(m => Math.sign(m) === Math.sign(consensusSpreadMove) && Math.abs(m) >= spreadThreshold).length
    : 0;
  const booksAgreeingML = hasMLData
    ? mlProbDeltas.filter(d => Math.sign(d) === Math.sign(consensusMLProbDelta) && Math.abs(d) >= mlMinorThreshold).length
    : 0;
  const booksAgreeingTotal = hasTotalData
    ? totalMovements.filter(m => Math.sign(m) === Math.sign(consensusTotalMove) && Math.abs(m) >= totalThreshold * 0.5).length
    : 0;

  const totalBooks = Math.max(bookMovements.length, mlProbDeltas.length);

  // ── Timing / Velocity ──────────────────────────────────────────
  const firstSnap = snaps[0];
  const lastSnap = snaps[snaps.length - 1];
  const hoursElapsed = (new Date(lastSnap.fetched_at).getTime() - new Date(firstSnap.fetched_at).getTime()) / (1000 * 60 * 60);
  const spreadVelocity = hoursElapsed > 0 ? absSpread / hoursElapsed : 0;
  const mlVelocity = hoursElapsed > 0 ? absML / hoursElapsed : 0;
  const totalVelocity = hoursElapsed > 0 ? absTotal / hoursElapsed : 0;

  // ── Splits ──────────────────────────────────────────────────────
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

  // ── Public direction ────────────────────────────────────────────
  const publicOnHome = (homeBetsPct ?? 50) > 50;
  const publicTeamName = publicOnHome ? homeTeam : awayTeam;
  const spreadMovedTowardHome = consensusSpreadMove < 0;
  const spreadMovedWithPublic = hasSpreadData && absSpread >= 0.2 &&
    ((publicOnHome && spreadMovedTowardHome) || (!publicOnHome && !spreadMovedTowardHome));
  const spreadAgainstPublic = hasSpreadData && absSpread >= 0.2 && !spreadMovedWithPublic;

  // ── Display averages ────────────────────────────────────────────
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

  // ── Build layer fact objects ────────────────────────────────────
  const spreadFacts: LayerFacts = {
    hasData: hasSpreadData,
    consensusMove: consensusSpreadMove,
    absMove: absSpread,
    booksAgreeing: booksAgreeingSpread,
    totalBooks,
    velocity: spreadVelocity,
    hasMeaningfulMove: absSpread >= spreadThreshold,
    hasMinorMove: absSpread >= 0.2,
  };

  const mlFacts: LayerFacts = {
    hasData: hasMLData,
    consensusMove: consensusMLProbDelta,
    absMove: absML,
    booksAgreeing: booksAgreeingML,
    totalBooks,
    velocity: mlVelocity,
    hasMeaningfulMove: absML >= mlThreshold,
    hasMinorMove: absML >= mlMinorThreshold,
  };

  const totalFacts: LayerFacts = {
    hasData: hasTotalData,
    consensusMove: consensusTotalMove,
    absMove: absTotal,
    booksAgreeing: booksAgreeingTotal,
    totalBooks,
    velocity: totalVelocity,
    hasMeaningfulMove: absTotal >= totalThreshold,
    hasMinorMove: absTotal >= totalThreshold * 0.5,
  };

  return {
    gameKey,
    league,
    homeTeam,
    awayTeam,
    gameTime,
    isMLPrimary,

    spread: spreadFacts,
    ml: mlFacts,
    total: totalFacts,

    consensusSpreadMove,
    consensusMLProbDelta,
    consensusMLRaw,
    consensusTotalMove,

    openSpread, currentSpread,
    openTotal, currentTotal,
    avgOpenMLHome, avgCurrMLHome,

    hoursElapsed,
    spreadVelocity, mlVelocity, totalVelocity,

    homeBetsPct, homeMoneyPct,
    awayBetsPct, awayMoneyPct,
    sharpDivergence, sharpSide, divergenceGap,
    publicOnHome, publicTeamName,
    spreadMovedWithPublic, spreadAgainstPublic,

    spreadThreshold, mlThreshold, mlMinorThreshold, totalThreshold,

    bookSpreads, bookMLs, bookTotals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAGE 2: evaluateLayerSignal()
//
//  Given a GameFacts, independently classify each layer's signal.
// ═══════════════════════════════════════════════════════════════════════════════

function evaluateSpreadSignal(gf: GameFacts): LayerSignal {
  if (gf.spread.hasMeaningfulMove) {
    if (gf.spreadMovedWithPublic && !gf.sharpDivergence) return "PUBLIC_DRIVEN";
    if (gf.spread.booksAgreeing >= 3 && gf.spread.velocity >= 0.5) return "STEAM";
    if (gf.spread.booksAgreeing >= 3) return "RLM";
    if (gf.spread.booksAgreeing >= 1) return "SHADE";
    return "MINOR";
  }
  if (gf.spread.hasMinorMove) {
    if (gf.spreadMovedWithPublic && !gf.sharpDivergence) return "PUBLIC_DRIVEN";
    return "MINOR";
  }
  return "NONE";
}

function evaluateMLSignal(gf: GameFacts): LayerSignal {
  if (gf.ml.hasMeaningfulMove) {
    const steamVel = gf.isMLPrimary ? 1.5 : 2.0;
    if (gf.ml.booksAgreeing >= 3 && gf.ml.velocity >= steamVel) return "STEAM";
    if (gf.ml.booksAgreeing >= 3) return "RLM";
    if (gf.ml.booksAgreeing >= 1) return "SHADE";
    return "MINOR";
  }
  if (gf.ml.hasMinorMove) {
    const mlMovingTowardSharp = gf.sharpSide
      ? (gf.sharpSide === gf.homeTeam && gf.consensusMLProbDelta > 0) ||
        (gf.sharpSide === gf.awayTeam && gf.consensusMLProbDelta < 0)
      : false;
    if (mlMovingTowardSharp && gf.sharpDivergence) return "SHARP_ACCUM";
    if (gf.ml.absMove >= gf.mlMinorThreshold) return "MINOR";
  }
  return "NONE";
}

function evaluateTotalSignal(gf: GameFacts): LayerSignal {
  if (gf.total.hasMeaningfulMove) {
    const steamVel = gf.isMLPrimary ? 0.5 : 1.0;
    // STEAM requires 2+ books moving within a tight time window (< 60 min)
    const movedBooks = getMovedBooks(gf);
    const timeWindowMin = movedBooks.timeWindowMinutes;
    if (movedBooks.count >= 2 && timeWindowMin < 60 && gf.total.velocity >= steamVel) return "STEAM";
    if (gf.total.booksAgreeing >= 2) return "SHADE";
    return "MINOR";
  }
  if (gf.total.hasMinorMove) return "MINOR";
  return "NONE";
}

/** Compute which books moved totals in the consensus direction. */
function getMovedBooks(gf: GameFacts): {
  count: number;
  names: string[];
  timeWindowMinutes: number;
} {
  const direction = Math.sign(gf.consensusTotalMove);
  const threshold = gf.totalThreshold * 0.5;
  const moved = gf.bookTotals.filter(b => {
    const move = b.current - b.open;
    return Math.sign(move) === direction && Math.abs(move) >= threshold;
  });
  if (moved.length === 0) return { count: 0, names: [], timeWindowMinutes: Infinity };

  // Time window = span between earliest and latest move timestamps among moved books
  const timestamps = moved.map(b => new Date(b.lastAt).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const windowMs = latest - earliest;
  const windowMin = windowMs / (1000 * 60);

  return {
    count: moved.length,
    names: moved.map(b => b.book),
    timeWindowMinutes: windowMin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAGE 3: buildMarketRead() — per-market structured reads
//
//  Each always returns a complete MarketRead (never null).
//  Default is PASS_READ.
// ═══════════════════════════════════════════════════════════════════════════════

function buildSideRead(gf: GameFacts, signal: LayerSignal): MarketRead {
  if (signal === "NONE" && !gf.spread.hasMinorMove) return { ...PASS_READ };

  const leanTeam = gf.consensusSpreadMove < 0 ? gf.homeTeam : gf.awayTeam;
  const leanSpread = gf.currentSpread != null
    ? `${leanTeam} ${fmtSpread(gf.consensusSpreadMove < 0 ? gf.currentSpread : -(gf.currentSpread ?? 0))}`
    : leanTeam;

  let score = 0;
  let sigType = "NO_EDGE";
  const reasons: string[] = [];

  if (signal === "STEAM") {
    score = 80;
    sigType = "STEAM_SPREAD";
    reasons.push(`Coordinated steam: ${gf.spread.booksAgreeing}/${gf.spread.totalBooks} books moved ${fmtSpread(gf.consensusSpreadMove)}.`);
    reasons.push(`Velocity: ${gf.spreadVelocity.toFixed(2)} pts/hr.`);
  } else if (signal === "RLM") {
    score = 60;
    sigType = "RLM_SPREAD";
    reasons.push(`Reverse line movement: ${gf.spread.booksAgreeing} books against ${(gf.homeBetsPct ?? 50) > 50 ? `${gf.homeBetsPct}% public on ${gf.homeTeam}` : `${gf.awayBetsPct ?? 50}% public on ${gf.awayTeam}`}.`);
    reasons.push(`Line: ${fmtSpread(gf.openSpread)} → ${fmtSpread(gf.currentSpread)}.`);
  } else if (signal === "SHADE") {
    score = 35;
    sigType = "BOOK_SHADE";
    reasons.push(`${gf.spread.booksAgreeing} book(s) shaded line. Move: ${fmtSpread(gf.openSpread)} → ${fmtSpread(gf.currentSpread)}.`);
  } else if (signal === "PUBLIC_DRIVEN") {
    score = 18;
    sigType = "PUBLIC_DRIVEN";
    reasons.push(`Line moved WITH ${(gf.homeBetsPct ?? 50) > 50 ? `${gf.homeBetsPct}%` : `${gf.awayBetsPct ?? 50}%`} public on ${gf.publicTeamName}. No sharp confirmation.`);
  } else {
    score = 10;
    sigType = "NO_EDGE";
    reasons.push(`Minor spread movement (${fmtSpread(gf.consensusSpreadMove)}). Insufficient for directional lean.`);
  }

  if (gf.sharpDivergence && gf.spreadAgainstPublic) score += 10;
  if (gf.ml.hasMinorMove && Math.sign(gf.consensusMLProbDelta) === Math.sign(-gf.consensusSpreadMove)) score += 5;

  const conf = scoreToConfidence(score);
  return {
    lean: conf === "PASS" ? "PASS" : leanSpread,
    confidence: conf,
    signal_type: sigType,
    summary_reason: reasons.join(" "),
  };
}

function buildTotalRead(gf: GameFacts, signal: LayerSignal): MarketRead & {
  total_books_moved: number;
  total_books_list: string[];
  total_move_time_window: number;
  total_velocity: number;
} {
  const defaultCoord = { total_books_moved: 0, total_books_list: [] as string[], total_move_time_window: 0, total_velocity: 0 };
  if (signal === "NONE" && !gf.total.hasMinorMove) return { ...PASS_READ, ...defaultCoord };

  const direction = gf.consensusTotalMove < 0 ? "Under" : "Over";
  const leanDisplay = gf.currentTotal != null ? `${direction} ${gf.currentTotal}` : direction;
  const moved = getMovedBooks(gf);
  const moveDelta = gf.consensusTotalMove > 0 ? `+${gf.consensusTotalMove.toFixed(1)}` : gf.consensusTotalMove.toFixed(1);

  let score = 0;
  let sigType = "NO_EDGE";
  const reasons: string[] = [];

  if (signal === "STEAM") {
    score = 70;
    sigType = "STEAM_TOTAL";
    const bookList = moved.names.join(", ");
    const ratio = `${moved.count}/${gf.bookTotals.length}`;
    const windowStr = moved.timeWindowMinutes < 1 ? "<1 min" : `${Math.round(moved.timeWindowMinutes)} min`;
    reasons.push(`Coordinated steam: ${ratio} books (${bookList}) moved ${direction}. Total: ${gf.openTotal} → ${gf.currentTotal} (${moveDelta}). Velocity: ${moveDelta} in ${windowStr}.`);
  } else if (signal === "SHADE") {
    score = 35;
    sigType = "SHARP_ACCUMULATION_TOTAL";
    const bookList = moved.names.join(", ");
    const ratio = `${moved.count}/${gf.bookTotals.length}`;
    const windowStr = moved.timeWindowMinutes < 1 ? "<1 min" : `${Math.round(moved.timeWindowMinutes)} min`;
    reasons.push(`Sharp accumulation: ${ratio} books (${bookList}) moved total ${direction.toLowerCase()}. ${gf.openTotal} → ${gf.currentTotal} (${moveDelta}) over ${windowStr}.`);
  } else if (signal === "MINOR") {
    score = 15;
    sigType = "NO_EDGE";
    reasons.push(`Minor total movement ${direction.toLowerCase()}: ${gf.openTotal ?? "?"} → ${gf.currentTotal ?? "?"} (${moveDelta}).`);
  }

  if (gf.spread.hasMinorMove || gf.ml.hasMinorMove) score += 5;

  const conf = scoreToConfidence(score);
  return {
    lean: conf === "PASS" ? "PASS" : leanDisplay,
    confidence: conf,
    signal_type: sigType,
    summary_reason: reasons.join(" "),
    total_books_moved: moved.count,
    total_books_list: moved.names,
    total_move_time_window: Math.round(moved.timeWindowMinutes),
    total_velocity: parseFloat(gf.totalVelocity.toFixed(2)),
  };
}

function buildMLRead(gf: GameFacts, signal: LayerSignal): MarketRead {
  if (signal === "NONE" && !gf.ml.hasMinorMove) return { ...PASS_READ };

  const mlLeanTeam = gf.consensusMLProbDelta > 0 ? gf.homeTeam : gf.awayTeam;
  const leanDisplay = `${mlLeanTeam} ML`;

  let score = 0;
  let sigType = "NO_EDGE";
  const reasons: string[] = [];

  if (signal === "STEAM") {
    score = 75;
    sigType = "STEAM_ML";
    reasons.push(`ML steam: ${gf.ml.booksAgreeing} books moved toward ${mlLeanTeam}.`);
    reasons.push(`Implied prob shift: ${gf.ml.absMove.toFixed(1)}%. Velocity: ${gf.mlVelocity.toFixed(1)}%/hr.`);
  } else if (signal === "RLM") {
    score = 55;
    sigType = "RLM_ML";
    reasons.push(`ML reverse line movement: ${gf.ml.booksAgreeing} books improving ${mlLeanTeam}.`);
    if (gf.sharpDivergence && gf.sharpSide === mlLeanTeam) {
      reasons.push(`Money% > bets% on ${mlLeanTeam} confirms sharp side.`);
      score += 10;
    }
  } else if (signal === "SHARP_ACCUM") {
    score = 45;
    sigType = "SHARP_ACCUMULATION_ML";
    reasons.push(`Gradual ML drift toward ${mlLeanTeam} (${gf.ml.absMove.toFixed(1)}% implied prob shift).`);
    if (gf.sharpDivergence) {
      reasons.push(`Money%/bets% divergence (${gf.divergenceGap.toFixed(0)}%) confirms sharp accumulation.`);
      score += 8;
    }
  } else if (signal === "SHADE") {
    score = 30;
    sigType = "SHADE_ML";
    reasons.push(`${gf.ml.booksAgreeing} book(s) shaded ML toward ${mlLeanTeam}. Prob shift: ${gf.ml.absMove.toFixed(1)}%.`);
  } else {
    score = 12;
    sigType = "NO_EDGE";
    reasons.push(`Minor ML movement toward ${mlLeanTeam} (${gf.ml.absMove.toFixed(1)}% implied prob shift).`);
  }

  if (gf.sharpDivergence && gf.sharpSide === mlLeanTeam && sigType !== "SHARP_ACCUMULATION_ML") score += 8;

  const spreadLeanTeam = gf.consensusSpreadMove < 0 ? gf.homeTeam : gf.awayTeam;
  if (gf.spread.hasMinorMove && spreadLeanTeam === mlLeanTeam) score += 5;

  const conf = scoreToConfidence(score);
  return {
    lean: conf === "PASS" ? "PASS" : leanDisplay,
    confidence: conf,
    signal_type: sigType,
    summary_reason: reasons.join(" "),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAGE 4: deriveOverall()
//
//  Computes signal_tier, alert_type, overall_badge, primary_market,
//  primary_signal, confidence_score ONLY from the completed reads
//  and layer signals.
//
//  FROZEN is the ABSOLUTE last resort — only if all reads are PASS,
//  all layers are NONE, no divergence, and 3h+ tracking.
// ═══════════════════════════════════════════════════════════════════════════════

interface OverallResult {
  signalTier: string;
  alertType: string;
  scenarioKey: string;
  overallBadge: string;
  primaryMarket: string;
  primarySignal: string;
  confidenceScore: number;
  sharpTeam: string;
  fadeTeam: string;
  outputComplete: boolean;
}

function deriveOverall(
  gf: GameFacts,
  spreadSignal: LayerSignal,
  mlSignal: LayerSignal,
  totalSignal: LayerSignal,
  sideRead: MarketRead,
  totalRead: MarketRead,
  mlRead: MarketRead,
): OverallResult {
  const bestSpread = signalPriority(spreadSignal);
  const bestML = signalPriority(mlSignal);
  const bestTotal = signalPriority(totalSignal);
  const bestOverall = Math.max(bestSpread, bestML, bestTotal);

  // primary_market: which market drives the classification
  let primaryMarket = "none";
  if (bestSpread >= bestML && bestSpread >= bestTotal && bestSpread > 0) primaryMarket = "side";
  else if (bestML >= bestTotal && bestML > 0) primaryMarket = "moneyline";
  else if (bestTotal > 0) primaryMarket = "total";

  let primarySource: "spread" | "ml" | "total" = "spread";
  if (bestML > bestSpread && bestML >= bestTotal) primarySource = "ml";
  else if (bestTotal > bestSpread && bestTotal > bestML) primarySource = "total";

  // ── Classify ────────────────────────────────────────────────────
  let signalTier = "";
  let alertType = "";
  let scenarioKey = "";

  if (bestOverall >= 6) {
    signalTier = "STEAM MOVE";
    if (spreadSignal === "STEAM") alertType = "STEAM_SPREAD";
    else if (mlSignal === "STEAM") alertType = "STEAM_ML";
    else alertType = "STEAM_TOTAL";
    scenarioKey = buildScenarioKey(alertType, gf.spread, gf.ml, gf.total);
  } else if (bestOverall >= 5) {
    signalTier = "NO-NARRATIVE RLM";
    alertType = spreadSignal === "RLM" ? "RLM_SPREAD" : "RLM_ML";
    scenarioKey = buildScenarioKey(alertType, gf.spread, gf.ml, gf.total);
  } else if (bestOverall >= 4) {
    signalTier = "SHARP ACCUMULATION";
    alertType = "SHARP_ACCUM";
    scenarioKey = `SHARP_ACCUM|ml${gf.ml.absMove.toFixed(1)}%|div${gf.divergenceGap.toFixed(0)}%`;
  } else if (bestOverall >= 3) {
    signalTier = "BOOK SHADE";
    if (spreadSignal === "SHADE") alertType = "SHADE_SPREAD";
    else if (mlSignal === "SHADE") alertType = "SHADE_ML";
    else alertType = "SHADE_TOTAL";
    scenarioKey = buildScenarioKey("SHADE", gf.spread, gf.ml, gf.total);
  } else if (bestOverall >= 2) {
    signalTier = "WATCH";
    alertType = "PUBLIC_DRIVEN";
    scenarioKey = `PUBLIC|${gf.publicTeamName}|${gf.spread.absMove.toFixed(1)}pts`;
  } else if (bestOverall >= 1 || gf.sharpDivergence) {
    signalTier = "WATCH";
    alertType = "WATCH";
    const triggers: string[] = [];
    if (gf.spread.absMove >= 0.2) triggers.push(`spd${gf.spread.absMove.toFixed(1)}`);
    if (gf.ml.absMove >= gf.mlMinorThreshold) triggers.push(`ml${gf.ml.absMove.toFixed(1)}%`);
    if (gf.total.hasMinorMove) triggers.push(`tot${gf.total.absMove.toFixed(1)}`);
    if (gf.sharpDivergence) triggers.push(`div${gf.divergenceGap.toFixed(0)}%`);
    scenarioKey = `WATCH|${triggers.join("|")}`;
  }

  // ── FROZEN: absolute last resort ────────────────────────────────
  // ALL layers NONE + no divergence + 3h+ tracking + confirmed inactivity
  if (!signalTier) {
    const allLayersNone = spreadSignal === "NONE" && mlSignal === "NONE" && totalSignal === "NONE";
    const confirmedInactive = allLayersNone &&
      !gf.sharpDivergence &&
      gf.spread.totalBooks >= 2 &&
      gf.hoursElapsed >= 3;

    if (confirmedInactive) {
      signalTier = "FROZEN LINE";
      alertType = "FROZEN";
      scenarioKey = `FROZEN|${gf.spread.totalBooks}books|${gf.hoursElapsed.toFixed(0)}h`;
    } else {
      // Not enough data for FROZEN → TRACKING (not FROZEN!)
      signalTier = "TRACKING";
      alertType = "TRACKING";
      scenarioKey = `TRACKING|${gf.spread.totalBooks}books|${gf.hoursElapsed.toFixed(1)}h`;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  INTEGRITY GUARD #1 — FROZEN cannot survive if any read is non-PASS
  //
  //  This is the FINAL safety net.  Even if the waterfall above somehow
  //  assigned FROZEN, we override if any market has a real read.
  // ══════════════════════════════════════════════════════════════════

  const allReadsPass =
    sideRead.confidence === "PASS" &&
    totalRead.confidence === "PASS" &&
    mlRead.confidence === "PASS";

  if (signalTier === "FROZEN LINE" && !allReadsPass) {
    signalTier = "WATCH";
    alertType = "WATCH";
    const reasons: string[] = ["DEFROSTED"];
    if (sideRead.confidence !== "PASS") reasons.push(`side:${sideRead.confidence}`);
    if (totalRead.confidence !== "PASS") reasons.push(`tot:${totalRead.confidence}`);
    if (mlRead.confidence !== "PASS") reasons.push(`ml:${mlRead.confidence}`);
    scenarioKey = reasons.join("|");
  }

  const overallBadge = signalTier;

  // ── primarySignal: strongest non-PASS market signal type ────────
  const primarySignal = (() => {
    const best = [
      { read: sideRead, market: "side" },
      { read: totalRead, market: "total" },
      { read: mlRead, market: "moneyline" },
    ].sort((a, b) => {
      const confOrder: Record<string, number> = { HIGH: 4, MODERATE: 3, LOW: 2, PASS: 1 };
      return (confOrder[b.read.confidence] || 0) - (confOrder[a.read.confidence] || 0);
    })[0];
    return best.read.confidence !== "PASS" ? best.read.signal_type : "NO_EDGE";
  })();

  // ── Direction: sharp / fade team ────────────────────────────────
  let sharpTeam: string;
  let fadeTeam: string;

  if (signalTier === "SHARP ACCUMULATION" && gf.sharpSide) {
    sharpTeam = gf.sharpSide;
    fadeTeam = gf.sharpSide === gf.homeTeam ? gf.awayTeam : gf.homeTeam;
  } else if (primarySource === "ml" && gf.ml.hasMinorMove) {
    sharpTeam = gf.consensusMLProbDelta > 0 ? gf.homeTeam : gf.awayTeam;
    fadeTeam = gf.consensusMLProbDelta > 0 ? gf.awayTeam : gf.homeTeam;
  } else if (primarySource === "total") {
    if (gf.ml.hasMinorMove) {
      sharpTeam = gf.consensusMLProbDelta > 0 ? gf.homeTeam : gf.awayTeam;
      fadeTeam = gf.consensusMLProbDelta > 0 ? gf.awayTeam : gf.homeTeam;
    } else if (gf.sharpDivergence && gf.sharpSide) {
      sharpTeam = gf.sharpSide;
      fadeTeam = gf.sharpSide === gf.homeTeam ? gf.awayTeam : gf.homeTeam;
    } else {
      sharpTeam = gf.homeTeam;
      fadeTeam = gf.awayTeam;
    }
  } else if (gf.spread.hasMeaningfulMove) {
    sharpTeam = gf.consensusSpreadMove > 0 ? gf.awayTeam : gf.homeTeam;
    fadeTeam = gf.consensusSpreadMove > 0 ? gf.homeTeam : gf.awayTeam;
  } else if (gf.ml.hasMinorMove) {
    sharpTeam = gf.consensusMLProbDelta > 0 ? gf.homeTeam : gf.awayTeam;
    fadeTeam = gf.consensusMLProbDelta > 0 ? gf.awayTeam : gf.homeTeam;
  } else if (gf.sharpDivergence && gf.sharpSide) {
    sharpTeam = gf.sharpSide;
    fadeTeam = gf.sharpSide === gf.homeTeam ? gf.awayTeam : gf.homeTeam;
  } else {
    sharpTeam = gf.homeTeam;
    fadeTeam = gf.awayTeam;
  }

  // ── Confidence score ────────────────────────────────────────────
  let confidenceScore = 0;

  if (gf.spread.hasMeaningfulMove) {
    confidenceScore += 15;
    confidenceScore += Math.min(gf.spread.booksAgreeing * 3, 9);
    if (gf.spread.velocity >= 0.5) confidenceScore += 6;
  } else if (gf.spread.hasMinorMove) {
    confidenceScore += 5;
  }

  if (gf.ml.hasMeaningfulMove) {
    confidenceScore += 15;
    confidenceScore += Math.min(gf.ml.booksAgreeing * 3, 9);
    if (gf.ml.velocity >= (gf.isMLPrimary ? 1.0 : 1.5)) confidenceScore += 6;
  } else if (gf.ml.hasMinorMove) {
    confidenceScore += 8;
  }

  if (gf.total.hasMeaningfulMove) {
    confidenceScore += 10;
    if (gf.total.booksAgreeing >= 2) confidenceScore += 5;
  } else if (gf.total.hasMinorMove) {
    confidenceScore += 3;
  }

  if (gf.sharpDivergence) {
    confidenceScore += 10;
    if (gf.divergenceGap >= 15) confidenceScore += 5;
  }

  const layersWithSignal = [spreadSignal, mlSignal, totalSignal].filter(s => s !== "NONE").length;
  if (layersWithSignal >= 2) confidenceScore += 5;
  if (layersWithSignal >= 3) confidenceScore += 5;

  confidenceScore = Math.min(confidenceScore, 100);

  return {
    signalTier,
    alertType,
    scenarioKey,
    overallBadge,
    primaryMarket,
    primarySignal,
    confidenceScore,
    sharpTeam,
    fadeTeam,
    outputComplete: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STAGE 5: buildAlert()
//
//  Assembles the final DB row from GameFacts + reads + overall.
//  Runs integrity guards before returning.
// ═══════════════════════════════════════════════════════════════════════════════

function buildAlert(
  gf: GameFacts,
  sideRead: MarketRead,
  totalRead: MarketRead,
  mlRead: MarketRead,
  overall: OverallResult,
  hsaNarrative: string,
  now: Date,
): Record<string, unknown> {
  // ══════════════════════════════════════════════════════════════════
  //  INTEGRITY GUARD #2 — replace any remaining nulls with PASS
  //  This should never fire (reads are always populated), but serves
  //  as a defense-in-depth guarantee.
  // ══════════════════════════════════════════════════════════════════

  const safeSide = sideRead ?? { ...PASS_READ };
  const safeTotal = totalRead ?? { ...PASS_READ };
  const safeML = mlRead ?? { ...PASS_READ };

  // ══════════════════════════════════════════════════════════════════
  //  INTEGRITY GUARD #3 — assert FROZEN validity one final time
  // ══════════════════════════════════════════════════════════════════

  let finalBadge = overall.overallBadge;
  let finalTier = overall.signalTier;
  let finalAlertType = overall.alertType;
  let finalScenario = overall.scenarioKey;

  if (finalTier === "FROZEN LINE") {
    const anyNonPass =
      safeSide.confidence !== "PASS" ||
      safeTotal.confidence !== "PASS" ||
      safeML.confidence !== "PASS";

    if (anyNonPass) {
      finalTier = "WATCH";
      finalBadge = "WATCH";
      finalAlertType = "WATCH";
      finalScenario = "INTEGRITY_GUARD|frozen_with_reads";
    }
  }

  return {
    home_team: gf.homeTeam,
    away_team: gf.awayTeam,
    league: gf.league,
    game_time: gf.gameTime,
    sharp_team: overall.sharpTeam,
    fade_team: overall.fadeTeam,
    signal_tier: finalTier,
    alert_type: finalAlertType,
    scenario_key: finalScenario,
    opening_spread: gf.openSpread,
    current_spread: gf.currentSpread,
    line_move: parseFloat(gf.consensusSpreadMove.toFixed(1)),
    books_agreeing: Math.max(gf.spread.booksAgreeing, gf.ml.booksAgreeing),
    total_books: gf.spread.totalBooks,
    velocity_per_hour: parseFloat(gf.spreadVelocity.toFixed(2)),
    confidence_score: overall.confidenceScore,
    hsa_narrative: hsaNarrative,
    detected_at: now.toISOString(),

    // ── Per-market structured reads — guaranteed non-null ──
    side_lean: safeSide.lean,
    side_confidence: safeSide.confidence,
    side_signal_type: safeSide.signal_type,
    side_summary: safeSide.summary_reason,

    total_lean: safeTotal.lean,
    total_confidence: safeTotal.confidence,
    total_signal_type: safeTotal.signal_type,
    total_summary: safeTotal.summary_reason,

    // ── Total coordination details ──
    total_books_moved: totalRead.total_books_moved ?? 0,
    total_books_list: (totalRead.total_books_list ?? []).join(", ") || null,
    total_move_time_window: totalRead.total_move_time_window ?? null,
    total_velocity: totalRead.total_velocity ?? null,

    ml_lean: safeML.lean,
    ml_confidence: safeML.confidence,
    ml_signal_type: safeML.signal_type,
    ml_summary: safeML.summary_reason,

    primary_market: overall.primaryMarket,
    primary_signal: overall.primarySignal,
    overall_badge: finalBadge,

    // Moneyline data
    ...(gf.ml.hasData ? {
      moneyline_move: parseFloat(gf.consensusMLRaw.toFixed(0)),
      ml_prob_delta: parseFloat(gf.consensusMLProbDelta.toFixed(2)),
      ...(gf.bookMLs.length > 0 ? {
        home_ml_open: gf.avgOpenMLHome,
        home_ml_current: gf.avgCurrMLHome,
      } : {}),
    } : {}),

    // Totals
    ...(gf.total.hasData ? {
      total_move: parseFloat(gf.consensusTotalMove.toFixed(1)),
      opening_total: gf.openTotal,
      current_total: gf.currentTotal,
    } : {}),

    // Splits
    ...(gf.homeBetsPct != null ? {
      home_bets_pct: gf.homeBetsPct,
      home_money_pct: gf.homeMoneyPct,
    } : {}),

    // Layer diagnostics
    spread_signal: undefined as string | undefined,
    ml_signal: undefined as string | undefined,
    total_signal: undefined as string | undefined,
    primary_source: undefined as string | undefined,

    // Data integrity flag
    output_complete: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Parse optional request body ──
    let slateDate: string | null = null;
    let oddsWindowHours = 18;
    try {
      const body = await req.json();
      if (body?.slateDate) slateDate = body.slateDate;
      if (body?.oddsWindowHours) oddsWindowHours = body.oddsWindowHours;
    } catch { /* no body or invalid JSON — use defaults */ }

    const now = new Date();
    const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const oddsWindowStart = new Date(now.getTime() - oddsWindowHours * 60 * 60 * 1000).toISOString();

    let slateStart: string;
    let slateEnd: string;

    if (slateDate) {
      slateStart = `${slateDate}T00:00:00Z`;
      slateEnd = `${slateDate}T23:59:59Z`;
    } else {
      slateStart = fiveMinFromNow;
      slateEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    // ── Find active slate games (pregame only) ────────────────────
    const { data: slateGames, error: slateErr } = await supabase
      .from("odds_snapshots")
      .select("league, home_team, away_team, game_time")
      .gt("game_time", fiveMinFromNow)
      .gte("game_time", slateStart)
      .lte("game_time", slateEnd)
      .gte("fetched_at", oddsWindowStart)
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

    // ── Fetch odds only for active slate games ────────────────────
    const { data: recentOdds, error } = await supabase
      .from("odds_snapshots")
      .select("*")
      .gt("game_time", fiveMinFromNow)
      .gte("fetched_at", oddsWindowStart)
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
      if (!activeGameKeys.has(key)) continue;
      if (!gameMap[key]) gameMap[key] = [];
      gameMap[key].push(snap);
    }

    // ═══════════════════════════════════════════════════════════════
    //  PROCESS EACH GAME — canonical pipeline:
    //
    //    1. buildGameFacts()     → GameFacts
    //    2. evaluateXxxSignal()  → LayerSignal × 3
    //    3. buildXxxRead()       → MarketRead × 3
    //    4. deriveOverall()      → OverallResult
    //    5. narrative (optional)
    //    6. buildAlert()         → DB row (with integrity guards)
    //    7. upsert
    // ═══════════════════════════════════════════════════════════════

    const results: any[] = [];

    for (const [gameKey, snaps] of Object.entries(gameMap)) {
      if (snaps.length < 2) continue;

      const gameTime = gameTimeMap[gameKey] ?? snaps[0].game_time ?? null;

      // ── Step 1: Normalized game facts ──
      const gf = await buildGameFacts(gameKey, snaps, gameTime, supabase);
      if (!gf) continue; // truly no data across all three markets

      // ── Step 2: Independent layer signals ──
      const spreadSignal = evaluateSpreadSignal(gf);
      const mlSignal = evaluateMLSignal(gf);
      const totalSignal = evaluateTotalSignal(gf);

      // ── Step 3: Per-market reads (always non-null) ──
      const sideRead = buildSideRead(gf, spreadSignal);
      const totalRead = buildTotalRead(gf, totalSignal);
      const mlRead = buildMLRead(gf, mlSignal);

      // ── Step 4: Overall classification from reads ──
      let overall = deriveOverall(gf, spreadSignal, mlSignal, totalSignal, sideRead, totalRead, mlRead);

      // ── Step 5: Narrative ──
      let hsaNarrative = "";
      try {
        const hsaRes = await supabase.functions.invoke("generate-brief", {
          body: {
            home_team: gf.homeTeam,
            away_team: gf.awayTeam,
            league: gf.league,
            signal_tier: overall.signalTier,
            sharp_team: overall.sharpTeam,
            line_move: gf.consensusSpreadMove,
          }
        });
        hsaNarrative = hsaRes.data?.narrative ?? "";
      } catch { hsaNarrative = ""; }

      // Narrative-based tier adjustments
      if (overall.signalTier === "NO-NARRATIVE RLM" && hsaNarrative && hsaNarrative !== "NO_NARRATIVE") {
        overall = { ...overall, signalTier: "WATCH", overallBadge: "WATCH", alertType: "WATCH_NARRATIVE", scenarioKey: `WATCH_NARRATIVE|${gf.spread.absMove.toFixed(1)}pts` };
      }
      if (overall.signalTier === "NO-NARRATIVE RLM" && gf.spread.absMove >= 1.5 && gf.spread.booksAgreeing >= 4) {
        overall = { ...overall, signalTier: "DOUBLE NO-NARRATIVE RLM", overallBadge: "DOUBLE NO-NARRATIVE RLM", alertType: `DOUBLE_${overall.alertType}`, scenarioKey: `DOUBLE_RLM|${gf.spread.booksAgreeing}books|${gf.spread.absMove.toFixed(1)}pts` };
      }

      // ── Step 6: Build alert with integrity guards ──
      const alert = buildAlert(gf, sideRead, totalRead, mlRead, overall, hsaNarrative, now);

      // Inject layer diagnostics (these aren't DB columns, just for response)
      alert.spread_signal = spreadSignal;
      alert.ml_signal = mlSignal;
      alert.total_signal = totalSignal;
      alert.primary_source = (() => {
        const bestS = signalPriority(spreadSignal);
        const bestM = signalPriority(mlSignal);
        const bestT = signalPriority(totalSignal);
        if (bestM > bestS && bestM >= bestT) return "ml";
        if (bestT > bestS && bestT > bestM) return "total";
        return "spread";
      })();

      // ── Step 7: Upsert ──
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
