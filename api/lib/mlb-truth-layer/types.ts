// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Canonical Market State
//
//  Single source of truth for all MLB HSA narration. The HSA writer may
//  ONLY use facts from this validated object. It may not parse raw snapshots,
//  invent favorite/underdog assignments, or infer market logic directly.
//
//  Flow: raw snapshots → normalize → validate → derive signals → write HSA
// ══════════════════════════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────────────────────────

export interface MlbBookLine {
  book: string;
  value: number;
  price: number | null;
  timestamp: string;
}

export interface MlbMarketSide {
  open: number;
  current: number;
  delta: number;
  books: MlbBookLine[];
  books_reporting: number;
}

export interface MlbMoneyline {
  home: MlbMarketSide;
  away: MlbMarketSide;
  consensus_favorite: 'home' | 'away';
  consensus_favorite_ml: number;
  consensus_underdog_ml: number;
}

export interface MlbRunLine {
  favorite_team: string;
  underdog_team: string;
  /** Always -1.5 for favorite */
  favorite_rl: number;
  /** Always +1.5 for underdog */
  underdog_rl: number;
  /** Juice movement (price changes, not number changes) */
  favorite_price_open: number | null;
  favorite_price_current: number | null;
  favorite_price_delta: number;
  underdog_price_open: number | null;
  underdog_price_current: number | null;
  underdog_price_delta: number;
  /** Whether any book has a non-1.5 run line (alt line signal) */
  has_alt_line: boolean;
  books_reporting: number;
}

export interface MlbTotal {
  open: number;
  current: number;
  /** Number movement (e.g. 7 → 7.5) */
  number_delta: number;
  direction: 'over' | 'under' | 'stable';
  /** Juice movement on the over side */
  over_price_open: number | null;
  over_price_current: number | null;
  over_price_delta: number;
  books_reporting: number;
  books: MlbBookLine[];
}

export interface MlbDerivedTruth {
  favorite_team: string;
  underdog_team: string;
  /** Does the ML favorite match the RL favorite? */
  run_line_consistent_with_moneyline: boolean;
  /** Primary signal market (always moneyline for MLB unless unusual) */
  primary_market: 'moneyline' | 'total' | 'runline';
  /** Summary of market regime */
  market_regime: 'stable' | 'ml_moving' | 'total_moving' | 'both_moving' | 'divergent';
}

export type MlbSignalType =
  | 'REVERSE_LINE_MOVEMENT'
  | 'FULL_BOOK_CONSENSUS'
  | 'STEAM_MOVE'
  | 'MARKET_AGREEMENT'
  | 'FROZEN_LINE'
  | 'PASS';

export type MlbConfidence = 'High' | 'Elevated' | 'Moderate' | 'Low';

export interface MlbSideSignal {
  type: MlbSignalType;
  confidence: MlbConfidence;
  direction: string;
  primary_market: 'moneyline' | 'runline';
  factors: string[];
}

export interface MlbTotalSignal {
  type: MlbSignalType;
  confidence: MlbConfidence;
  direction: 'over' | 'under' | 'stable';
  factors: string[];
}

export interface MlbSignalSummary {
  side: MlbSideSignal;
  total: MlbTotalSignal;
  /** Overall status tag */
  status: 'PASS' | 'WATCH' | 'ACTIVE';
}

export interface MlbValidation {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MlbStartingPitchers {
  home: string | null;
  away: string | null;
  confirmed: boolean;
}

// ── The Canonical Truth Object ───────────────────────────────────────────────

export interface MlbTruthObject {
  sport: 'MLB';
  event_id: string;
  home_team: string;
  away_team: string;
  game_time: string;
  tracking_hours: number;
  snapshot_count: number;

  starting_pitchers: MlbStartingPitchers;
  moneyline: MlbMoneyline;
  run_line: MlbRunLine;
  total: MlbTotal;
  derived_truth: MlbDerivedTruth;
  signal_summary: MlbSignalSummary;
  validation: MlbValidation;

  /** Public splits if available */
  public_data: {
    home_ticket_pct: number | null;
    away_ticket_pct: number | null;
    home_money_pct: number | null;
    away_money_pct: number | null;
  };
}

// ── Raw snapshot interface (matches odds_snapshots table) ────────────────────

export interface RawOddsSnapshot {
  bookmaker: string;
  spread: number;
  spread_home_price: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price: number;
  fetched_at: string;
  league?: string;
  game_time?: string;
  home_team?: string;
  away_team?: string;
  book_type?: string;
}
