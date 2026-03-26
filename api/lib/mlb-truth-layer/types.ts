// ══════════════════════════════════════════════════════════════════════════════
//  MLB Truth Layer — Canonical Market State Types
//
//  Single source of truth for all MLB HSA narration. The HSA writer may
//  ONLY use facts from this validated object. It may not parse raw snapshots,
//  invent favorite/underdog assignments, or infer market logic directly.
// ══════════════════════════════════════════════════════════════════════════════

// ── Signal Tags ──────────────────────────────────────────────────────────────

export type MlbSideSignalTag =
  | 'PASS'
  | 'WATCH'
  | 'MLB_SIDE_PASS'
  | 'MLB_ML_FAVORITE_STRENGTHENING'
  | 'MLB_DOG_BUYBACK'
  | 'MLB_RL_FAVORITE_PRICE_SUPPORT'
  | 'MLB_SPLIT_MARKET'
  | 'MLB_STALE_OR_CONFLICTED';

export type MlbTotalSignalTag =
  | 'PASS'
  | 'WATCH'
  | 'MLB_TOTAL_OVER_STEAM'
  | 'MLB_TOTAL_UNDER_STEAM'
  | 'MLB_TOTAL_JUICE_PRESSURE_OVER'
  | 'MLB_TOTAL_JUICE_PRESSURE_UNDER'
  | 'MLB_TOTAL_FROZEN'
  | 'MLB_TOTAL_DISAGREEMENT';

export type MlbConfidence = 'low' | 'moderate' | 'high';

// ── Market Components ────────────────────────────────────────────────────────

export interface MlbBookLine {
  book: string;
  value: number;
  price: number | null;
  timestamp: string;
}

export interface PitcherInfo {
  home: string | null;
  away: string | null;
  confirmed: boolean;
}

export interface MoneylineTruth {
  home_open: number | null;
  home_current: number | null;
  away_open: number | null;
  away_current: number | null;
  home_delta: number;
  away_delta: number;
  books_reporting: number;
  consensus_side: 'home' | 'away' | 'mixed' | null;
  per_book_home: MlbBookLine[];
  per_book_away: MlbBookLine[];
}

export interface RunLineTruth {
  favored_team: string | null;
  underdog_team: string | null;
  favorite_rl: -1.5 | null;
  underdog_rl: 1.5 | null;
  open_favorite_price: number | null;
  current_favorite_price: number | null;
  open_dog_price: number | null;
  current_dog_price: number | null;
  favorite_price_delta: number;
  underdog_price_delta: number;
  books_reporting: number;
  /** Did the run line NUMBER change (e.g., 1.5 → 2.5)? Almost never in MLB */
  line_changed: boolean;
  /** Did the run line PRICE (juice) change materially? */
  price_changed: boolean;
}

export interface TotalTruth {
  open: number | null;
  current: number | null;
  number_delta: number;
  over_open_price: number | null;
  over_current_price: number | null;
  under_open_price: number | null;
  under_current_price: number | null;
  over_price_delta: number;
  under_price_delta: number;
  direction: 'up' | 'down' | 'flat' | 'mixed';
  books_reporting: number;
  per_book: MlbBookLine[];
  /** Did the total NUMBER move? (e.g. 7 → 7.5) */
  number_moved: boolean;
  /** Was movement juice-only (price changed but number stayed)? */
  juice_shift_only: boolean;
}

export interface DerivedTruth {
  favorite_team: string | null;
  underdog_team: string | null;
  run_line_consistent_with_moneyline: boolean;
  moneyline_direction: 'home' | 'away' | 'flat' | 'mixed';
  total_direction: 'up' | 'down' | 'flat' | 'mixed';
  strongest_market: 'moneyline' | 'run_line' | 'total' | 'none';
  market_regime: string;
  pitcher_context: 'confirmed' | 'unconfirmed';
}

export interface MlbValidation {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MlbSignalSummary {
  side_signal: MlbSideSignalTag;
  total_signal: MlbTotalSignalTag;
  confidence: MlbConfidence;
  side_reason: string;
  total_reason: string;
  /** Overall status tag for HSA header */
  status: 'PASS' | 'WATCH' | 'ACTIVE';
}

// ── The Canonical Truth Object ───────────────────────────────────────────────

export interface MlbTruthObject {
  sport: 'MLB';
  event_id: string;
  home_team: string;
  away_team: string;
  game_time_utc: string;
  tracking_hours: number;
  snapshot_count: number;
  starting_pitchers: PitcherInfo;
  market_state: {
    moneyline: MoneylineTruth;
    run_line: RunLineTruth;
    total: TotalTruth;
  };
  derived_truth: DerivedTruth;
  signal_summary: MlbSignalSummary;
  validation: MlbValidation;
  public_data: {
    home_ticket_pct: number | null;
    away_ticket_pct: number | null;
    home_money_pct: number | null;
    away_money_pct: number | null;
  };
}

// ── HSA Writer Contract ──────────────────────────────────────────────────────

export interface MlbHsaWriterInput {
  truth: MlbTruthObject;
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
  total_under_price?: number;
  fetched_at: string;
  league?: string;
  game_time?: string;
  home_team?: string;
  away_team?: string;
  book_type?: string;
}
