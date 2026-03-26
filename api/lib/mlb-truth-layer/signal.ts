// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Signal Derivation
//
//  MLB-specific signal logic. Does NOT reuse generic NBA/NCAAB spread logic.
//  Separate side and total derivation with MLB signal tags.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MlbTruthObject,
  MlbSignalSummary,
  MlbSideSignalTag,
  MlbTotalSignalTag,
  MlbConfidence,
} from './types';

// ── Thresholds ───────────────────────────────────────────────────────────────

const ML = { NOTABLE: 5, MEANINGFUL: 10, SIGNIFICANT: 15, STEAM: 20 };
const TOT = { MEANINGFUL: 0.5, SIGNIFICANT: 1.0, STEAM: 1.5 };
const JUICE = { NOTABLE: 5, MEANINGFUL: 10, SIGNIFICANT: 15 };

// ── Side Signal ──────────────────────────────────────────────────────────────

function deriveSideSignal(truth: MlbTruthObject): {
  signal: MlbSideSignalTag;
  confidence: MlbConfidence;
  reason: string;
} {
  const ml = truth.market_state.moneyline;
  const rl = truth.market_state.run_line;
  const pub = truth.public_data;

  const homeDelta = Math.abs(ml.home_delta);
  const awayDelta = Math.abs(ml.away_delta);
  const mlDelta = Math.max(homeDelta, awayDelta);

  // ── Check for stale/conflicted state first ──────────────────────
  if (ml.consensus_side === 'mixed') {
    return { signal: 'MLB_SPLIT_MARKET', confidence: 'low', reason: 'Moneyline consensus is mixed — no clear favorite' };
  }

  if (ml.books_reporting > 0 && ml.books_reporting < 2) {
    return { signal: 'MLB_STALE_OR_CONFLICTED', confidence: 'low', reason: `Only ${ml.books_reporting} book reporting — insufficient for signal` };
  }

  // ── No meaningful ML movement ───────────────────────────────────
  if (mlDelta < ML.NOTABLE) {
    // Check RL juice as secondary
    if (rl.price_changed && Math.abs(rl.favorite_price_delta) >= JUICE.MEANINGFUL) {
      return {
        signal: 'MLB_RL_FAVORITE_PRICE_SUPPORT',
        confidence: 'low',
        reason: `ML stable, but RL juice moved ${rl.favorite_price_delta}c on ${rl.favored_team} -1.5`,
      };
    }
    return { signal: 'MLB_SIDE_PASS', confidence: 'low', reason: 'No meaningful moneyline or run line movement' };
  }

  // ── ML moved — determine direction and classify ─────────────────
  const favIsHome = ml.consensus_side === 'home';
  const favDelta = favIsHome ? ml.home_delta : ml.away_delta;
  const favStrengthening = favDelta < 0; // more negative = stronger favorite
  const dogBuyback = !favStrengthening; // positive delta on fav = weakening = dog shortening

  // Public alignment for RLM detection
  let publicOnFav = false;
  let publicPct = 0;
  if (pub.home_ticket_pct != null) {
    publicOnFav = favIsHome ? pub.home_ticket_pct > 50 : (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)) > 50;
    publicPct = publicOnFav
      ? (favIsHome ? pub.home_ticket_pct : (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)))
      : (favIsHome ? (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)) : pub.home_ticket_pct);
  }

  // Is this reverse line movement?
  const isRLM = pub.home_ticket_pct != null && (
    (publicOnFav && dogBuyback) || (!publicOnFav && favStrengthening)
  );

  // Classify signal type
  let signal: MlbSideSignalTag;
  let confidence: MlbConfidence;
  let reason: string;

  if (favStrengthening) {
    signal = 'MLB_ML_FAVORITE_STRENGTHENING';
    reason = `${truth.derived_truth.favorite_team} ML strengthened by ${mlDelta}c`;
  } else {
    signal = 'MLB_DOG_BUYBACK';
    reason = `${truth.derived_truth.underdog_team} ML shortened by ${mlDelta}c (dog buyback)`;
  }

  if (isRLM) {
    reason += ` — reverse line movement (${publicPct}% public on opposite side)`;
  }

  // Confidence based on magnitude
  if (mlDelta >= ML.STEAM) {
    confidence = 'high';
    reason += ` [STEAM: ${mlDelta}c across ${ml.books_reporting} books]`;
  } else if (mlDelta >= ML.SIGNIFICANT) {
    confidence = 'high';
  } else if (mlDelta >= ML.MEANINGFUL) {
    confidence = 'moderate';
  } else {
    confidence = 'low';
  }

  // Confidence reductions
  if (!truth.starting_pitchers.confirmed && confidence !== 'low') {
    reason += ' (pitchers unconfirmed — confidence reduced)';
    if (confidence === 'high') confidence = 'moderate';
    else confidence = 'low';
  }
  if (ml.books_reporting < 3 && confidence !== 'low') {
    reason += ` (only ${ml.books_reporting} books — confidence reduced)`;
    if (confidence === 'high') confidence = 'moderate';
    else confidence = 'low';
  }
  if (truth.validation.warnings.length > 2 && confidence === 'high') {
    confidence = 'moderate';
    reason += ' (multiple warnings — confidence capped)';
  }

  return { signal, confidence, reason };
}

// ── Total Signal ─────────────────────────────────────────────────────────────

function deriveTotalSignal(truth: MlbTruthObject): {
  signal: MlbTotalSignalTag;
  confidence: MlbConfidence;
  reason: string;
} {
  const tot = truth.market_state.total;
  const numDelta = Math.abs(tot.number_delta);
  const overJuiceDelta = Math.abs(tot.over_price_delta);
  const underJuiceDelta = Math.abs(tot.under_price_delta);
  const maxJuice = Math.max(overJuiceDelta, underJuiceDelta);

  // ── Book disagreement check ─────────────────────────────────────
  if (tot.per_book.length >= 3) {
    const values = tot.per_book.map(b => b.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min >= 1.5) {
      return {
        signal: 'MLB_TOTAL_DISAGREEMENT',
        confidence: 'low',
        reason: `Total disagreement: ${min} to ${max} across ${tot.books_reporting} books`,
      };
    }
  }

  // ── Number didn't move ──────────────────────────────────────────
  if (!tot.number_moved) {
    // Check juice-only movement
    if (tot.juice_shift_only && maxJuice >= JUICE.MEANINGFUL) {
      const juiceDir = tot.over_price_delta < 0 ? 'over' : 'under';
      const signal: MlbTotalSignalTag = juiceDir === 'over'
        ? 'MLB_TOTAL_JUICE_PRESSURE_OVER' : 'MLB_TOTAL_JUICE_PRESSURE_UNDER';
      return {
        signal,
        confidence: 'low',
        reason: `Total number flat, but juice shifted ${maxJuice}c toward ${juiceDir}`,
      };
    }

    // True frozen
    if (truth.tracking_hours >= 2 && tot.books_reporting >= 3) {
      return {
        signal: 'MLB_TOTAL_FROZEN',
        confidence: 'low',
        reason: `Total frozen at ${tot.current} across ${tot.books_reporting} books for ${truth.tracking_hours}h`,
      };
    }

    return { signal: 'PASS', confidence: 'low', reason: 'No total movement (number or juice)' };
  }

  // ── Number moved — classify ─────────────────────────────────────
  const dirUp = tot.direction === 'up';
  let signal: MlbTotalSignalTag;
  let confidence: MlbConfidence;
  let reason: string;

  if (numDelta >= TOT.STEAM) {
    signal = dirUp ? 'MLB_TOTAL_OVER_STEAM' : 'MLB_TOTAL_UNDER_STEAM';
    confidence = 'high';
    reason = `Total ${dirUp ? 'rose' : 'dropped'} ${numDelta} pts (${tot.open} → ${tot.current}) — steam level`;
  } else if (numDelta >= TOT.SIGNIFICANT) {
    signal = dirUp ? 'MLB_TOTAL_OVER_STEAM' : 'MLB_TOTAL_UNDER_STEAM';
    confidence = 'moderate';
    reason = `Total ${dirUp ? 'rose' : 'dropped'} ${numDelta} pts`;
  } else {
    signal = 'WATCH';
    confidence = 'low';
    reason = `Total moved ${numDelta} pts (developing)`;
  }

  // Pitcher confidence modifier
  if (!truth.starting_pitchers.confirmed && confidence !== 'low') {
    reason += ' (pitchers unconfirmed)';
    if (confidence === 'high') confidence = 'moderate';
  }

  if (tot.direction === 'mixed') {
    signal = 'MLB_TOTAL_DISAGREEMENT';
    confidence = 'low';
    reason = 'Total direction mixed across books';
  }

  return { signal, confidence, reason };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export function deriveMLBSignals(truth: MlbTruthObject): MlbSignalSummary {
  const side = deriveSideSignal(truth);
  const total = deriveTotalSignal(truth);

  // Overall confidence = highest of side and total
  const confOrder: Record<MlbConfidence, number> = { low: 0, moderate: 1, high: 2 };
  const overallConf = confOrder[side.confidence] >= confOrder[total.confidence]
    ? side.confidence : total.confidence;

  // Status: PASS if both pass, ACTIVE if high confidence, WATCH otherwise
  const isPass = side.signal === 'PASS' || side.signal === 'MLB_SIDE_PASS';
  const totalIsPass = total.signal === 'PASS';

  let status: 'PASS' | 'WATCH' | 'ACTIVE' = 'PASS';
  if (!isPass || !totalIsPass) {
    status = overallConf === 'high' ? 'ACTIVE' : 'WATCH';
  }

  return {
    side_signal: side.signal,
    total_signal: total.signal,
    confidence: overallConf,
    side_reason: side.reason,
    total_reason: total.reason,
    status,
  };
}
