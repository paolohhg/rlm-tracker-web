// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Validation
//
//  Hard rules = blocking errors. Soft rules = warnings that reduce confidence.
// ══════════════════════════════════════════════════════════════════════════════

import type { MlbTruthObject, MlbValidation } from './types';

export function validateMLBTruth(truth: MlbTruthObject): MlbValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ml = truth.market_state.moneyline;
  const rl = truth.market_state.run_line;
  const tot = truth.market_state.total;

  // ═══ HARD RULES (blocking) ═══════════════════════════════════════

  // 1. Must have snapshot data
  if (truth.snapshot_count === 0) {
    errors.push('No snapshot data available');
  }

  // 2. Must have at least some moneyline data
  if (ml.books_reporting === 0) {
    errors.push('No moneyline data from any book');
  }

  // 3. ML favorite must match RL favorite
  if (ml.consensus_side != null && ml.consensus_side !== 'mixed' && rl.favored_team != null) {
    const mlFav = ml.consensus_side === 'home' ? truth.home_team : truth.away_team;
    if (rl.favored_team !== mlFav) {
      errors.push(
        `ML/RL favorite mismatch: ML says ${mlFav}, RL says ${rl.favored_team}`
      );
    }
  }

  // 4. Run line must be canonical
  if (rl.favorite_rl != null && rl.favorite_rl !== -1.5) {
    errors.push(`Invalid MLB run line canonicalization: favorite_rl=${rl.favorite_rl}, expected -1.5`);
  }
  if (rl.underdog_rl != null && rl.underdog_rl !== 1.5) {
    errors.push(`Invalid MLB run line canonicalization: underdog_rl=${rl.underdog_rl}, expected 1.5`);
  }

  // 5. Team mapping coherence
  if (!truth.home_team || !truth.away_team) {
    errors.push('Missing home or away team');
  }
  if (truth.home_team === truth.away_team) {
    errors.push('Home and away team are the same');
  }
  if (truth.derived_truth.favorite_team &&
      truth.derived_truth.favorite_team !== truth.home_team &&
      truth.derived_truth.favorite_team !== truth.away_team) {
    errors.push(`Favorite team "${truth.derived_truth.favorite_team}" is neither home nor away`);
  }

  // 6. Market values must be valid numbers
  if (ml.home_current != null && (isNaN(ml.home_current) || Math.abs(ml.home_current) > 10000)) {
    errors.push(`Invalid home ML value: ${ml.home_current}`);
  }
  if (ml.away_current != null && (isNaN(ml.away_current) || Math.abs(ml.away_current) > 10000)) {
    errors.push(`Invalid away ML value: ${ml.away_current}`);
  }

  // 7. Total sanity bounds
  if (tot.current != null && tot.current > 0 && (tot.current < 4 || tot.current > 16)) {
    errors.push(`Total ${tot.current} outside MLB bounds [4-16]`);
  }

  // ═══ SOFT RULES (warnings — reduce confidence) ═══════════════════

  // 8. Starting pitchers unconfirmed
  if (!truth.starting_pitchers.confirmed) {
    warnings.push('Starting pitchers not confirmed — lines may shift at confirmation');
  }

  // 9. Insufficient book coverage
  if (ml.books_reporting > 0 && ml.books_reporting < 3) {
    warnings.push(`Only ${ml.books_reporting} book(s) reporting ML — limited market view`);
  }

  // 10. Stale data
  if (truth.tracking_hours < 0.1 && truth.snapshot_count > 0) {
    warnings.push(
      `Only ${(truth.tracking_hours * 60).toFixed(0)} minutes of tracking — opener may not be true market open`
    );
  }

  // 11. Both ML sides negative or both positive (unusual)
  if (ml.home_current != null && ml.away_current != null) {
    if (ml.home_current < 0 && ml.away_current < 0) {
      warnings.push(`Both home (${ml.home_current}) and away (${ml.away_current}) ML are negative — unusual pick-em`);
    }
    if (ml.home_current > 0 && ml.away_current > 0) {
      warnings.push(`Both home (${ml.home_current}) and away (${ml.away_current}) ML are positive — unusual`);
    }
  }

  // 12. Mixed consensus
  if (ml.consensus_side === 'mixed') {
    warnings.push('Moneyline consensus is mixed — no clear favorite');
  }

  // 13. Rogue book detection
  if (ml.per_book_home.length >= 3) {
    const values = ml.per_book_home.map(b => b.value);
    const median = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const outliers = ml.per_book_home.filter(b => Math.abs(b.value - median) > 30);
    if (outliers.length === 1 && ml.per_book_home.length >= 4) {
      warnings.push(`Rogue book detected: ${outliers[0].book} at ${outliers[0].value} (median ${median})`);
    }
  }

  // 14. Total market incomplete
  if (tot.books_reporting > 0 && tot.books_reporting < 3) {
    warnings.push(`Only ${tot.books_reporting} book(s) reporting total — limited view`);
  }

  // 15. Inconsistent open-state availability
  const booksWithOpener = Object.keys(truth.market_state.moneyline.per_book_home).length;
  if (booksWithOpener > 0 && booksWithOpener < ml.books_reporting) {
    warnings.push('Some books missing opener data — opener consensus may be skewed');
  }

  return { is_valid: errors.length === 0, errors, warnings };
}
