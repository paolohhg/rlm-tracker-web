// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Signal Derivation
//
//  Derives side and total signals from the validated truth object.
//  Separate logic for each — side is ML-primary, total is number-primary.
// ══════════════════════════════════════════════════════════════════════════════

import type {
  MlbTruthObject,
  MlbSignalSummary,
  MlbSideSignal,
  MlbTotalSignal,
  MlbSignalType,
  MlbConfidence,
} from './types';

// ── Thresholds ───────────────────────────────────────────────────────────────

const ML_THRESHOLDS = {
  NOTABLE: 5,       // 5 cents
  MEANINGFUL: 10,   // 10 cents
  SIGNIFICANT: 15,  // 15 cents
  STEAM: 20,        // 20 cents
};

const TOTAL_THRESHOLDS = {
  MEANINGFUL: 0.5,
  SIGNIFICANT: 1.0,
  STEAM: 1.5,
};

// ── Side Signal (ML-primary) ─────────────────────────────────────────────────

function deriveSideSignal(truth: MlbTruthObject): MlbSideSignal {
  const factors: string[] = [];
  const mlHomeDelta = Math.abs(truth.moneyline.home.delta);
  const mlAwayDelta = Math.abs(truth.moneyline.away.delta);
  const mlDelta = Math.max(mlHomeDelta, mlAwayDelta);

  // If ML barely moved, check RL juice movement as secondary
  if (mlDelta < ML_THRESHOLDS.NOTABLE) {
    const rlPriceDelta = Math.abs(truth.run_line.favorite_price_delta);
    if (rlPriceDelta >= 10) {
      factors.push(`Run line juice moved ${rlPriceDelta} cents on ${truth.run_line.favorite_team}`);
      return {
        type: 'PASS',
        confidence: 'Low',
        direction: '',
        primary_market: 'runline',
        factors: [...factors, 'ML stable — RL juice movement only, insufficient for signal'],
      };
    }

    return {
      type: 'PASS',
      confidence: 'Low',
      direction: '',
      primary_market: 'moneyline',
      factors: ['No meaningful moneyline or run line movement'],
    };
  }

  // ML moved — determine direction
  const favTeam = truth.derived_truth.favorite_team;
  const dogTeam = truth.derived_truth.underdog_team;
  const mlFavDelta = truth.moneyline.consensus_favorite === 'home'
    ? truth.moneyline.home.delta : truth.moneyline.away.delta;
  const direction = mlFavDelta < 0
    ? `toward ${favTeam} (favorite strengthening)`
    : `toward ${dogTeam} (underdog shortening)`;

  // Check public alignment for RLM detection
  const pub = truth.public_data;
  let isRLM = false;
  if (pub.home_ticket_pct != null) {
    const publicOnFav = (truth.moneyline.consensus_favorite === 'home' && pub.home_ticket_pct > 50)
      || (truth.moneyline.consensus_favorite === 'away' && (pub.away_ticket_pct ?? (100 - pub.home_ticket_pct)) > 50);

    // Line moved AGAINST public = RLM
    const lineTowardDog = mlFavDelta > 0; // positive delta on favorite = weakening = toward dog
    if (publicOnFav && lineTowardDog) {
      isRLM = true;
      factors.push(`Reverse line movement: public on ${favTeam}, ML moved toward ${dogTeam}`);
    } else if (!publicOnFav && !lineTowardDog) {
      isRLM = true;
      factors.push(`Reverse line movement: public on ${dogTeam}, ML moved toward ${favTeam}`);
    }
  }

  // Book participation
  const booksReporting = truth.moneyline.home.books_reporting;
  const booksAligned = truth.moneyline.home.books.filter(b => {
    const openBook = truth.moneyline.home.books.find(ob => ob.book === b.book);
    return openBook && Math.abs(b.value - truth.moneyline.home.open) >= ML_THRESHOLDS.NOTABLE;
  }).length;

  factors.push(`ML moved ${mlDelta}c across ${booksReporting} books`);

  // Classify signal type
  let type: MlbSignalType;
  let confidence: MlbConfidence;

  if (mlDelta >= ML_THRESHOLDS.STEAM && booksAligned >= 4) {
    type = isRLM ? 'REVERSE_LINE_MOVEMENT' : 'FULL_BOOK_CONSENSUS';
    confidence = 'High';
    factors.push(`${booksAligned}/${booksReporting} books moved ≥${ML_THRESHOLDS.STEAM}c — ${type}`);
  } else if (mlDelta >= ML_THRESHOLDS.SIGNIFICANT) {
    type = isRLM ? 'REVERSE_LINE_MOVEMENT' : 'MARKET_AGREEMENT';
    confidence = 'Elevated';
    factors.push(`Significant ML movement (${mlDelta}c)`);
  } else if (mlDelta >= ML_THRESHOLDS.MEANINGFUL) {
    type = isRLM ? 'REVERSE_LINE_MOVEMENT' : 'MARKET_AGREEMENT';
    confidence = 'Moderate';
    factors.push(`Meaningful ML movement (${mlDelta}c)`);
  } else {
    type = 'PASS';
    confidence = 'Low';
    factors.push(`Notable but sub-threshold ML movement (${mlDelta}c)`);
  }

  // Pitcher confidence modifier
  if (!truth.starting_pitchers.confirmed && confidence !== 'Low') {
    factors.push('Pitchers unconfirmed — movement may reverse at confirmation');
  }

  return { type, confidence, direction, primary_market: 'moneyline', factors };
}

// ── Total Signal ─────────────────────────────────────────────────────────────

function deriveTotalSignal(truth: MlbTruthObject): MlbTotalSignal {
  const factors: string[] = [];
  const numDelta = Math.abs(truth.total.number_delta);
  const juiceDelta = Math.abs(truth.total.over_price_delta);

  if (numDelta < TOTAL_THRESHOLDS.MEANINGFUL && juiceDelta < 10) {
    return {
      type: 'PASS',
      confidence: 'Low',
      direction: truth.total.direction,
      factors: ['No meaningful total movement (number or juice)'],
    };
  }

  const direction = truth.total.direction;
  factors.push(`Total ${direction === 'over' ? 'rose' : direction === 'under' ? 'dropped' : 'stable'}: ${truth.total.open} → ${truth.total.current}`);

  if (juiceDelta >= 10) {
    factors.push(`Over juice moved ${juiceDelta} cents`);
  }

  let type: MlbSignalType;
  let confidence: MlbConfidence;

  if (numDelta >= TOTAL_THRESHOLDS.STEAM) {
    type = 'STEAM_MOVE';
    confidence = 'High';
    factors.push(`Total moved ${numDelta} pts — steam-level`);
  } else if (numDelta >= TOTAL_THRESHOLDS.SIGNIFICANT) {
    type = 'MARKET_AGREEMENT';
    confidence = 'Elevated';
  } else if (numDelta >= TOTAL_THRESHOLDS.MEANINGFUL) {
    type = 'MARKET_AGREEMENT';
    confidence = 'Moderate';
  } else if (juiceDelta >= 15) {
    type = 'MARKET_AGREEMENT';
    confidence = 'Low';
    factors.push('Juice movement only — no number change');
  } else {
    type = 'PASS';
    confidence = 'Low';
  }

  return { type, confidence, direction, factors };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export function deriveMlbSignals(truth: MlbTruthObject): MlbSignalSummary {
  const side = deriveSideSignal(truth);
  const total = deriveTotalSignal(truth);

  // Overall status: highest of side and total
  const statusOrder: Record<string, number> = { PASS: 0, WATCH: 1, ACTIVE: 2 };
  const sideStatus = side.type === 'PASS' ? 'PASS'
    : side.confidence === 'Low' ? 'WATCH' : (side.confidence === 'Moderate' ? 'WATCH' : 'ACTIVE');
  const totalStatus = total.type === 'PASS' ? 'PASS'
    : total.confidence === 'Low' ? 'WATCH' : (total.confidence === 'Moderate' ? 'WATCH' : 'ACTIVE');

  const status = (statusOrder[sideStatus] ?? 0) >= (statusOrder[totalStatus] ?? 0)
    ? sideStatus as 'PASS' | 'WATCH' | 'ACTIVE'
    : totalStatus as 'PASS' | 'WATCH' | 'ACTIVE';

  return { side, total, status };
}
