// ══════════════════════════════════════════════════════════════════════════════
//  Sport-Aware League Thresholds
//
//  SINGLE SOURCE OF TRUTH for all detection thresholds.
//  Every threshold that was previously hardcoded in detect-rlm,
//  market-lifecycle-engine, or compute-hsa-score is now here.
//
//  To tune a league: edit the config below.
//  To add a league: add a new entry with the same shape.
// ══════════════════════════════════════════════════════════════════════════════

import type { League, LeagueConfig, MarketThresholds } from '../types';

// ── NBA ──────────────────────────────────────────────────────────────────────

const NBA_SPREAD: MarketThresholds = {
  meaningful_move: 1.0,
  steam_move: 1.5,
  frozen_threshold: 0.3,
  reversal_threshold: 0.5,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [3, 4, 5, 7, 10],
  disagreement_threshold: 1.5,
};

const NBA_TOTAL: MarketThresholds = {
  meaningful_move: 1.5,
  steam_move: 2.0,
  frozen_threshold: 0.5,
  reversal_threshold: 1.0,
  steam_window_minutes: 45,
  min_books_steam: 2,
  key_numbers: [],
  disagreement_threshold: 2.0,
};

const NBA_MONEYLINE: MarketThresholds = {
  meaningful_move: 15,
  steam_move: 30,
  frozen_threshold: 5,
  reversal_threshold: 10,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [],
  disagreement_threshold: 20,
};

// ── NCAAB ────────────────────────────────────────────────────────────────────

const NCAAB_SPREAD: MarketThresholds = {
  meaningful_move: 1.0,
  steam_move: 1.5,
  frozen_threshold: 0.3,
  reversal_threshold: 0.5,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [3, 7, 10],
  disagreement_threshold: 1.5,
};

const NCAAB_TOTAL: MarketThresholds = {
  meaningful_move: 1.5,
  steam_move: 2.0,
  frozen_threshold: 0.5,
  reversal_threshold: 1.0,
  steam_window_minutes: 45,
  min_books_steam: 2,
  key_numbers: [],
  disagreement_threshold: 2.0,
};

const NCAAB_MONEYLINE: MarketThresholds = {
  meaningful_move: 20,
  steam_move: 30,
  frozen_threshold: 8,
  reversal_threshold: 15,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [],
  disagreement_threshold: 25,
};

// ── NHL ──────────────────────────────────────────────────────────────────────
// NHL is ML-primary. Spread = puck line (±1.5), moves rarely.

const NHL_SPREAD: MarketThresholds = {
  meaningful_move: 0.3,
  steam_move: 0.5,
  frozen_threshold: 0.1,
  reversal_threshold: 0.3,
  steam_window_minutes: 20,
  min_books_steam: 3,
  key_numbers: [1.5],
  disagreement_threshold: 0.5,
};

const NHL_TOTAL: MarketThresholds = {
  meaningful_move: 0.5,
  steam_move: 0.5,
  frozen_threshold: 0.25,
  reversal_threshold: 0.5,
  steam_window_minutes: 30,
  min_books_steam: 2,
  key_numbers: [5, 5.5, 6],
  disagreement_threshold: 0.5,
};

const NHL_MONEYLINE: MarketThresholds = {
  meaningful_move: 10,
  steam_move: 20,
  frozen_threshold: 5,
  reversal_threshold: 10,
  steam_window_minutes: 20,
  min_books_steam: 3,
  key_numbers: [],
  disagreement_threshold: 15,
};

// ── MLB ──────────────────────────────────────────────────────────────────────
// MLB is ML-primary. Run line is structurally ±1.5 and almost never moves.
// High thresholds prevent false signals from sign-perspective differences.
// Real MLB signals come from moneyline, not run line.

const MLB_SPREAD: MarketThresholds = {
  meaningful_move: 1.0,    // Run line rarely moves; needs full-point shift to be meaningful
  steam_move: 1.5,         // Only a true alt-line shift qualifies as steam
  frozen_threshold: 0.1,
  reversal_threshold: 0.5,
  steam_window_minutes: 20,
  min_books_steam: 3,
  key_numbers: [1.5],
  disagreement_threshold: 1.0,  // ±1.5 sign difference is NOT disagreement
};

const MLB_TOTAL: MarketThresholds = {
  meaningful_move: 0.5,
  steam_move: 1.0,
  frozen_threshold: 0.25,
  reversal_threshold: 0.5,
  steam_window_minutes: 30,
  min_books_steam: 2,
  key_numbers: [7, 7.5, 8, 8.5, 9],
  disagreement_threshold: 0.5,
};

const MLB_MONEYLINE: MarketThresholds = {
  meaningful_move: 10,
  steam_move: 20,
  frozen_threshold: 5,
  reversal_threshold: 10,
  steam_window_minutes: 20,
  min_books_steam: 3,
  key_numbers: [],
  disagreement_threshold: 15,
};

// ── NFL ──────────────────────────────────────────────────────────────────────

const NFL_SPREAD: MarketThresholds = {
  meaningful_move: 0.5,
  steam_move: 1.0,
  frozen_threshold: 0.2,
  reversal_threshold: 0.5,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [3, 7, 10, 14],
  disagreement_threshold: 1.0,
};

const NFL_TOTAL: MarketThresholds = {
  meaningful_move: 1.0,
  steam_move: 1.5,
  frozen_threshold: 0.5,
  reversal_threshold: 1.0,
  steam_window_minutes: 45,
  min_books_steam: 2,
  key_numbers: [],
  disagreement_threshold: 1.5,
};

const NFL_MONEYLINE: MarketThresholds = {
  meaningful_move: 15,
  steam_move: 25,
  frozen_threshold: 5,
  reversal_threshold: 10,
  steam_window_minutes: 30,
  min_books_steam: 3,
  key_numbers: [],
  disagreement_threshold: 20,
};

// ── Assembled Configs ────────────────────────────────────────────────────────

export const LEAGUE_CONFIGS: Record<string, LeagueConfig> = {
  NBA: {
    spread: NBA_SPREAD,
    total: NBA_TOTAL,
    moneyline: NBA_MONEYLINE,
    min_hours_frozen: 3,
    primary_market: 'spread',
  },
  NCAAB: {
    spread: NCAAB_SPREAD,
    total: NCAAB_TOTAL,
    moneyline: NCAAB_MONEYLINE,
    min_hours_frozen: 3,
    primary_market: 'spread',
  },
  NHL: {
    spread: NHL_SPREAD,
    total: NHL_TOTAL,
    moneyline: NHL_MONEYLINE,
    min_hours_frozen: 2,
    primary_market: 'moneyline',
  },
  MLB: {
    spread: MLB_SPREAD,
    total: MLB_TOTAL,
    moneyline: MLB_MONEYLINE,
    min_hours_frozen: 2,
    primary_market: 'moneyline',
  },
  NFL: {
    spread: NFL_SPREAD,
    total: NFL_TOTAL,
    moneyline: NFL_MONEYLINE,
    min_hours_frozen: 4,
    primary_market: 'spread',
  },
  // Fallback for unknown leagues — uses NBA thresholds
  NCAAF: {
    spread: NFL_SPREAD,
    total: NFL_TOTAL,
    moneyline: NFL_MONEYLINE,
    min_hours_frozen: 4,
    primary_market: 'spread',
  },
  WNBA: {
    spread: NBA_SPREAD,
    total: NBA_TOTAL,
    moneyline: NBA_MONEYLINE,
    min_hours_frozen: 3,
    primary_market: 'spread',
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get league config, falling back to NBA if league is unknown.
 */
export function getLeagueConfig(league: string): LeagueConfig {
  return LEAGUE_CONFIGS[league] ?? LEAGUE_CONFIGS.NBA;
}

/**
 * Get market-specific thresholds for a given league and market type.
 */
export function getMarketThresholds(league: string, marketType: string): MarketThresholds {
  const config = getLeagueConfig(league);
  if (marketType === 'total') return config.total;
  if (marketType === 'moneyline') return config.moneyline;
  return config.spread;
}

/**
 * Check if a league is moneyline-primary (NHL, MLB).
 */
export function isMLPrimary(league: string): boolean {
  return getLeagueConfig(league).primary_market === 'moneyline';
}
