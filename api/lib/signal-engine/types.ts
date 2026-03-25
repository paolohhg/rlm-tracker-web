// ══════════════════════════════════════════════════════════════════════════════
//  Signal Engine V2 — Shared Type Definitions
// ══════════════════════════════════════════════════════════════════════════════

// ── Book Intelligence ────────────────────────────────────────────────────────

export type BookTier =
  | 'TIER_1_SHARP'
  | 'TIER_2_MARKET_MAKER'
  | 'TIER_3_RETAIL_MAJOR'
  | 'TIER_4_SOFT'
  | 'TIER_5_UNKNOWN';

export interface BookConfig {
  tier: BookTier;
  /** Scoring weight multiplier (e.g. 3.0 for sharp, 1.0 for retail). */
  weight: number;
  /** Lower = moves first in lead/follow detection. */
  leader_priority: number;
  /** Display name for output. */
  display_name: string;
}

export interface BookMove {
  book: string;
  tier: BookTier;
  weight: number;
  open: number;
  current: number;
  move: number;
  /** ISO timestamp of latest snapshot for this book. */
  timestamp: string;
}

export interface LeaderFollowerResult {
  /** Book that moved first among those that moved in the consensus direction. */
  leader: string | null;
  leader_tier: BookTier | null;
  /** Books that moved after the leader in the same direction. */
  followers: string[];
  /** Books that have not moved or moved opposite. */
  holders: string[];
  /** Time gap (minutes) between leader and last follower. */
  follow_window_minutes: number;
}

export interface BookDisagreement {
  /** Max spread across current book lines. */
  max_spread: number;
  /** Is disagreement above the league threshold? */
  is_significant: boolean;
  /** Books grouped by their current line. */
  line_groups: Record<number, string[]>;
  /** The outlier book(s) if any. */
  outliers: string[];
}

// ── Market State ─────────────────────────────────────────────────────────────

export type League = 'NBA' | 'NCAAB' | 'NHL' | 'MLB' | 'NFL' | 'NCAAF' | 'WNBA';

export type MarketType = 'spread' | 'total' | 'moneyline';

export interface MarketSnapshot {
  book: string;
  spread: number;
  spread_home_price: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price: number;
  fetched_at: string;
}

export interface NormalizedBook {
  book: string;
  tier: BookTier;
  weight: number;
  display_name: string;
  open_line: number;
  current_line: number;
  move: number;
  /** ISO timestamp of first snapshot. */
  first_seen: string;
  /** ISO timestamp of most recent snapshot. */
  last_seen: string;
}

export interface PublicData {
  home_ticket_pct: number | null;
  away_ticket_pct: number | null;
  home_money_pct: number | null;
  away_money_pct: number | null;
}

export interface MarketState {
  game_key: string;
  league: League;
  home_team: string;
  away_team: string;
  game_time: string;
  market_type: MarketType;

  /** MODE-based consensus opening line. */
  opener: number;
  /** MODE-based consensus current line. */
  current: number;
  /** current - opener (from home perspective for spreads). */
  move: number;

  books: NormalizedBook[];
  public_data: PublicData;

  /** Points per hour of movement. */
  velocity: number;
  /** Hours since first snapshot. */
  hours_tracked: number;

  /** Books that moved in consensus direction. */
  books_moved_consensus: NormalizedBook[];
  /** Books that held or moved opposite. */
  books_held: NormalizedBook[];

  /** Total books tracked. */
  total_books: number;
}

// ── Signal Classification ────────────────────────────────────────────────────

export type SignalType =
  | 'REVERSE_LINE_MOVEMENT'
  | 'STEAM_MOVE'
  | 'MARKET_AGREEMENT'
  | 'BOOK_DISAGREEMENT'
  | 'FROZEN_LINE'
  | 'FAKE_STEAM'
  | 'NOISE';

/**
 * Direction of movement relative to the team being analyzed.
 * 'toward' = improving for that team.
 * 'away' = worsening for that team.
 */
export type MoveDirection = 'toward' | 'away' | 'none';

export interface DirectionalMove {
  /** Team the movement benefits. */
  toward_team: string;
  /** Team the movement hurts. */
  away_from_team: string;
  /** Absolute size of the move. */
  magnitude: number;
  /**
   * Spread direction description anchored to opener → current.
   * e.g. "Spread moved from Suns +4.5 to +6.5, which is movement against Phoenix and toward Denver."
   */
  description: string;
}

export interface SignalClassification {
  type: SignalType;
  direction: DirectionalMove;
  /** Factors that contributed to this classification. */
  factors: string[];
  /** Book leadership analysis. */
  leadership: LeaderFollowerResult;
  /** Book disagreement analysis. */
  disagreement: BookDisagreement;
  /** Whether a key number was crossed. */
  key_number_crossed: boolean;
  /** The key number if crossed. */
  crossed_number: number | null;
}

// ── Confidence Scoring ───────────────────────────────────────────────────────

export type ConfidenceBucket = 'HIGH' | 'MODERATE' | 'LOW' | 'PASS';

export interface ScoreBreakdown {
  move_magnitude: number;
  book_coordination: number;
  book_tier_weight: number;
  velocity: number;
  key_number_crossing: number;
  public_divergence: number;
  reversal_penalty: number;
  stale_market_penalty: number;
  incomplete_board_penalty: number;
  raw_total: number;
  clamped_total: number;
}

export interface ScoredSignal {
  score: number;
  confidence: ConfidenceBucket;
  breakdown: ScoreBreakdown;
  /** Human-readable reasons for the score. */
  explanation: string[];
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface SignalOutput {
  // Header
  matchup: string;
  league: League;
  market: MarketType;

  // Lines
  opener: string;
  current: string;

  // Movement
  line_movement_summary: string;
  movement_tracker: string;

  // Public
  public_betting_summary: string;

  // Books
  book_comparison_summary: string;

  // Signal
  signal_type: SignalType;
  market_lean: string;
  confidence: ConfidenceBucket;
  confidence_score: number;

  // Explanation
  explanation: string;

  // Detailed breakdown
  detail: {
    line_movement: string;
    book_leadership: string;
    public_data: string;
    market_state: string;
    confirmation_factors: string[];
    invalidation_factors: string[];
  };

  // Scoring
  score_breakdown: ScoreBreakdown;
}

// ── League Config ────────────────────────────────────────────────────────────

export interface MarketThresholds {
  /** Minimum absolute move to count as meaningful. */
  meaningful_move: number;
  /** Move size that qualifies for steam consideration. */
  steam_move: number;
  /** Below this, the line is considered frozen. */
  frozen_threshold: number;
  /** Move size that indicates a reversal. */
  reversal_threshold: number;
  /** Max minutes for steam window. */
  steam_window_minutes: number;
  /** Min books required for steam classification. */
  min_books_steam: number;
  /** Key numbers for this market (e.g. 3, 7, 10 for NBA spreads). */
  key_numbers: number[];
  /** Book disagreement threshold (max spread across books). */
  disagreement_threshold: number;
}

export interface LeagueConfig {
  spread: MarketThresholds;
  total: MarketThresholds;
  moneyline: MarketThresholds;
  /** Minimum tracking hours before FROZEN can be assigned. */
  min_hours_frozen: number;
  /** Primary market for this league ('moneyline' for NHL/MLB). */
  primary_market: MarketType;
}

// ── Signal Weight Config ─────────────────────────────────────────────────────

export interface SignalWeights {
  move_magnitude: number;
  book_coordination: number;
  book_tier_weight: number;
  velocity: number;
  key_number_crossing: number;
  public_divergence: number;
  reversal_penalty: number;
  stale_market_penalty: number;
  incomplete_board_penalty: number;
}
