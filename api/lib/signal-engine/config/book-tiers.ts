// ══════════════════════════════════════════════════════════════════════════════
//  Book Intelligence Layer — Tier Classification & Weights
//
//  Every sportsbook is classified by tier. Tiers drive:
//    1. Scoring weight — sharp-led moves score higher
//    2. Leader priority — lower number = moves first in lead/follow detection
//    3. Signal interpretation — a Pinnacle move means more than an ESPNBet move
//
//  This file is the SINGLE SOURCE OF TRUTH for book classification.
//  To add/reclassify a book, edit DEFAULT_BOOK_CONFIG below.
// ══════════════════════════════════════════════════════════════════════════════

import type { BookTier, BookConfig } from '../types';

// ── Tier Weights ─────────────────────────────────────────────────────────────
// How much a move by a book in this tier counts relative to retail (1.0).

export const TIER_WEIGHTS: Record<BookTier, number> = {
  TIER_1_SHARP: 3.0,
  TIER_2_MARKET_MAKER: 2.0,
  TIER_3_RETAIL_MAJOR: 1.0,
  TIER_4_SOFT: 0.6,
  TIER_5_UNKNOWN: 0.4,
};

// ── Leader Priority ──────────────────────────────────────────────────────────
// Lower = higher priority when identifying which book led a move.

export const TIER_LEADER_PRIORITY: Record<BookTier, number> = {
  TIER_1_SHARP: 1,
  TIER_2_MARKET_MAKER: 2,
  TIER_3_RETAIL_MAJOR: 3,
  TIER_4_SOFT: 4,
  TIER_5_UNKNOWN: 5,
};

// ── Default Book Classification ──────────────────────────────────────────────
// Normalized book keys (lowercase, no spaces).

export const DEFAULT_BOOK_CONFIG: Record<string, BookConfig> = {
  // TIER 1 — Sharp / Originator
  pinnacle: {
    tier: 'TIER_1_SHARP',
    weight: TIER_WEIGHTS.TIER_1_SHARP,
    leader_priority: 1,
    display_name: 'Pinnacle',
  },
  circa: {
    tier: 'TIER_1_SHARP',
    weight: TIER_WEIGHTS.TIER_1_SHARP,
    leader_priority: 2,
    display_name: 'Circa',
  },
  bookmaker: {
    tier: 'TIER_1_SHARP',
    weight: TIER_WEIGHTS.TIER_1_SHARP,
    leader_priority: 3,
    display_name: 'Bookmaker',
  },
  heritage: {
    tier: 'TIER_1_SHARP',
    weight: TIER_WEIGHTS.TIER_1_SHARP,
    leader_priority: 4,
    display_name: 'Heritage',
  },

  // TIER 2 — Market Maker / Semi-Sharp
  bet365: {
    tier: 'TIER_2_MARKET_MAKER',
    weight: TIER_WEIGHTS.TIER_2_MARKET_MAKER,
    leader_priority: 5,
    display_name: 'bet365',
  },
  betrivers: {
    tier: 'TIER_2_MARKET_MAKER',
    weight: TIER_WEIGHTS.TIER_2_MARKET_MAKER,
    leader_priority: 6,
    display_name: 'BetRivers',
  },

  // TIER 3 — Retail Major
  draftkings: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 7,
    display_name: 'DraftKings',
  },
  fanduel: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 8,
    display_name: 'FanDuel',
  },
  betmgm: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 9,
    display_name: 'BetMGM',
  },
  caesars: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 10,
    display_name: 'Caesars',
  },
  espnbet: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 11,
    display_name: 'ESPNBet',
  },
  fanatics: {
    tier: 'TIER_3_RETAIL_MAJOR',
    weight: TIER_WEIGHTS.TIER_3_RETAIL_MAJOR,
    leader_priority: 12,
    display_name: 'Fanatics',
  },

  // TIER 4 — Soft / Lagging
  pointsbetus: {
    tier: 'TIER_4_SOFT',
    weight: TIER_WEIGHTS.TIER_4_SOFT,
    leader_priority: 13,
    display_name: 'PointsBet',
  },
  superbook: {
    tier: 'TIER_4_SOFT',
    weight: TIER_WEIGHTS.TIER_4_SOFT,
    leader_priority: 14,
    display_name: 'SuperBook',
  },
  wynnbet: {
    tier: 'TIER_4_SOFT',
    weight: TIER_WEIGHTS.TIER_4_SOFT,
    leader_priority: 15,
    display_name: 'WynnBET',
  },
  hardrock: {
    tier: 'TIER_4_SOFT',
    weight: TIER_WEIGHTS.TIER_4_SOFT,
    leader_priority: 16,
    display_name: 'Hard Rock',
  },
  unibet: {
    tier: 'TIER_4_SOFT',
    weight: TIER_WEIGHTS.TIER_4_SOFT,
    leader_priority: 17,
    display_name: 'Unibet',
  },
};

// ── Unknown Book Fallback ────────────────────────────────────────────────────

const UNKNOWN_BOOK_CONFIG: Omit<BookConfig, 'display_name'> = {
  tier: 'TIER_5_UNKNOWN',
  weight: TIER_WEIGHTS.TIER_5_UNKNOWN,
  leader_priority: 99,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up book config. Returns TIER_5_UNKNOWN for unrecognized books.
 * Book key is normalized to lowercase with non-alphanumeric stripped.
 */
export function getBookConfig(bookKey: string): BookConfig {
  const normalized = bookKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  const config = DEFAULT_BOOK_CONFIG[normalized];
  if (config) return config;

  return {
    ...UNKNOWN_BOOK_CONFIG,
    display_name: bookKey,
  };
}

/**
 * Get display name for a book.
 */
export function getBookDisplayName(bookKey: string): string {
  return getBookConfig(bookKey).display_name;
}

/**
 * Check if a book is sharp (TIER_1 or TIER_2).
 */
export function isSharpBook(bookKey: string): boolean {
  const tier = getBookConfig(bookKey).tier;
  return tier === 'TIER_1_SHARP' || tier === 'TIER_2_MARKET_MAKER';
}

/**
 * Get all known books grouped by tier.
 */
export function getBooksByTier(): Record<BookTier, string[]> {
  const result: Record<BookTier, string[]> = {
    TIER_1_SHARP: [],
    TIER_2_MARKET_MAKER: [],
    TIER_3_RETAIL_MAJOR: [],
    TIER_4_SOFT: [],
    TIER_5_UNKNOWN: [],
  };
  for (const [key, config] of Object.entries(DEFAULT_BOOK_CONFIG)) {
    result[config.tier].push(key);
  }
  return result;
}
