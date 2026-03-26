// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Validation
//
//  Validates the canonical truth object before it reaches the HSA writer.
//  If validation fails, HSA generation is BLOCKED.
// ══════════════════════════════════════════════════════════════════════════════

import type { MlbTruthObject, MlbValidation } from './types';

export function validateMlbTruth(truth: MlbTruthObject): MlbValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Required data checks ───────────────────────────────────────
  if (truth.snapshot_count === 0) {
    errors.push('No snapshot data available');
  }

  if (truth.moneyline.home.books_reporting === 0 && truth.moneyline.away.books_reporting === 0) {
    errors.push('No moneyline data from any book');
  }

  // ── ML/RL consistency ──────────────────────────────────────────
  // The ML favorite must be the RL favorite
  if (truth.moneyline.consensus_favorite_ml !== 0 && truth.run_line.books_reporting > 0) {
    const mlFavIsHome = truth.moneyline.consensus_favorite === 'home';
    const rlFavTeam = truth.run_line.favorite_team;
    const expectedRlFav = mlFavIsHome ? truth.home_team : truth.away_team;

    if (rlFavTeam !== expectedRlFav) {
      // This is a normalization issue — we enforce it in normalize, so this
      // should not happen. If it does, it's a bug.
      errors.push(
        `ML favorite (${expectedRlFav}) does not match RL favorite (${rlFavTeam}). ` +
        `This indicates a normalization bug.`
      );
    }
  }

  // ── Run line structural check ──────────────────────────────────
  if (truth.run_line.favorite_rl !== -1.5) {
    errors.push(`Favorite RL must be -1.5, got ${truth.run_line.favorite_rl}`);
  }
  if (truth.run_line.underdog_rl !== 1.5) {
    errors.push(`Underdog RL must be +1.5, got ${truth.run_line.underdog_rl}`);
  }

  // ── Data freshness ─────────────────────────────────────────────
  if (truth.tracking_hours < 0.1 && truth.snapshot_count > 0) {
    warnings.push(
      `Only ${(truth.tracking_hours * 60).toFixed(0)} minutes of tracking data — ` +
      `opener may not be true market open`
    );
  }

  // ── Moneyline sanity ───────────────────────────────────────────
  const homeMl = truth.moneyline.home.current;
  const awayMl = truth.moneyline.away.current;
  if (homeMl !== 0 && awayMl !== 0) {
    // Both sides should not be negative (that would mean two favorites)
    if (homeMl < 0 && awayMl < 0) {
      warnings.push(`Both home (${homeMl}) and away (${awayMl}) ML are negative — unusual`);
    }
    // Both sides should not be positive (that would mean two underdogs)
    if (homeMl > 0 && awayMl > 0) {
      warnings.push(`Both home (${homeMl}) and away (${awayMl}) ML are positive — unusual`);
    }
  }

  // ── Total sanity ───────────────────────────────────────────────
  if (truth.total.current > 0) {
    if (truth.total.current < 4 || truth.total.current > 16) {
      errors.push(`Total ${truth.total.current} outside MLB bounds [4-16]`);
    }
  }

  // ── Pitcher info ───────────────────────────────────────────────
  if (!truth.starting_pitchers.confirmed) {
    warnings.push('Starting pitchers not confirmed — lines may shift at confirmation');
  }

  return {
    is_valid: errors.length === 0,
    errors,
    warnings,
  };
}
