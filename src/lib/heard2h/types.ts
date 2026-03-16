// ── Heard 2H Betting System — Type Definitions ──────────────────────────────

export type Sport = 'nba' | 'ncaab';
export type SharpSide = 'fav' | 'dog' | '';
export type SharpTotal = 'over' | 'under' | '';
export type BetSide = 'fav_spread' | 'dog_spread' | 'over' | 'under' | '';
export type GameResult = 'W' | 'L' | 'P' | '';
export type MipVerdict = 'strong_play' | 'play' | 'lean' | 'no_play';
export type EdgeVerdict = 'strong_over' | 'over' | 'no_edge' | 'under' | 'strong_under';
export type GameState = 'close' | 'moderate' | 'blowout';
export type TovType = 'sloppy' | 'structural' | '';
export type Location = 'home' | 'away' | 'neutral';

export type MipFlag =
  | '2H_TOTAL_SUPPRESSION'
  | '2H_TOTAL_INFLATION'
  | '2H_SIDE_UNDERCORRECTION'
  | '2H_SIDE_OVERCORRECTION'
  | 'SHARP_SIDE_ABANDONED'
  | 'SHARP_SIDE_CONTINUATION'
  | 'NCAAB_RLM_CONFIRMED';

// ── Game Input ───────────────────────────────────────────────────────────────

export interface GameInput {
  game_id: string;
  date: string;
  sport: Sport;
  home_team: string;
  away_team: string;
  sharp_side: SharpSide;
  sharp_total: SharpTotal;
  location: Location;

  // Pre-game closing lines
  pregame_spread: number;   // negative = home team favored
  pregame_total: number;

  // 1H closing lines
  first_half_spread: number;
  first_half_total: number;

  // Halftime state
  ht_home_score: number;
  ht_away_score: number;

  // 2H lines
  sh_spread_open: number;
  sh_total_open: number;
  sh_spread_curr: number;
  sh_total_curr: number;

  // Optional box score (for tempo layer)
  fav_fga?: number;
  fav_oreb?: number;
  fav_tov?: number;
  fav_fta?: number;
  fav_fouls?: number;
  fav_3pm?: number;
  fav_3pa?: number;
  opp_fga?: number;
  opp_oreb?: number;
  opp_tov?: number;
  opp_fta?: number;
  opp_fouls?: number;
  opp_3pm?: number;
  opp_3pa?: number;
  team_a_tempo?: number;
  team_b_tempo?: number;

  // Manual confirmation checkboxes
  confirm_sharp_total_aligns?: boolean;
  confirm_no_structural_reason?: boolean;
  confirm_micro_rlm?: boolean;
  confirm_2h_line_soft?: boolean;
  confirm_side_rlm?: boolean;
  confirm_no_foul_injury?: boolean;

  // Tempo layer manual inputs
  game_state?: GameState;
  tov_type?: TovType;

  // Signal layer manual checkboxes
  signal_rlm_confirmed?: boolean;
  signal_star_returning?: boolean;
  signal_ft_differential?: boolean;
  signal_psych_spot?: boolean;
}

// ── Derived Metrics ──────────────────────────────────────────────────────────

export interface DerivedMetrics {
  pregame_implied_2H_total: number;
  first_half_total_delta: number;
  halftime_total_points: number;
  halftime_margin: number;
  second_half_total_mispricing: number;
  first_half_margin_delta: number;
  market_power_adjustment: number;
  line_movement_ht: number;
}

// ── MIP Output ───────────────────────────────────────────────────────────────

export interface MipTotalsResult {
  score: number;
  verdict: MipVerdict;
  breakdown: string[];
  flags: MipFlag[];
}

export interface MipSidesResult {
  score: number;
  verdict: MipVerdict;
  breakdown: string[];
  flags: MipFlag[];
  sharp_supported: boolean;
}

export interface MipResult {
  totals: MipTotalsResult;
  sides: MipSidesResult;
  derived: DerivedMetrics;
}

// ── Tempo Layer Output ───────────────────────────────────────────────────────

export interface TempoAdjustments {
  tempo: number;
  foul: number;
  shooting: number;
  turnover: number;
  close_game: number;
}

export interface TempoResult {
  pregame_implied_2H_total: number;
  adjustments: TempoAdjustments;
  adjustment_reasons: Record<keyof TempoAdjustments, string>;
  fair_2H_total: number;
  posted_2H_open: number;
  posted_2H_current: number;
  edge: number;
  verdict: EdgeVerdict;
  plain_english: string;
  flags: string[];
}

// ── Signal Layer Output ──────────────────────────────────────────────────────

export interface SignalItem {
  name: string;
  points: number;
  active: boolean;
  note: string;
}

export interface SignalResult {
  signals: SignalItem[];
  total_score: number;
  verdict: MipVerdict;
}

// ── Full Pipeline Output ─────────────────────────────────────────────────────

export interface PipelineResult {
  input: GameInput;
  mip: MipResult;
  tempo: TempoResult | null;  // null when box score data unavailable
  signals: SignalResult;
  has_full_data: boolean;
}

// ── Stored Game Record ───────────────────────────────────────────────────────

export interface StoredGame {
  id: string;
  input: GameInput;
  result: PipelineResult;
  bet_side: BetSide;
  sh_home_final: number | null;
  sh_away_final: number | null;
  game_result: GameResult;
  created_at: string;
  updated_at: string;
}

// ── Analytics Types ──────────────────────────────────────────────────────────

export interface WinRateRow {
  label: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  win_rate: number;
}

export interface AnalyticsResult {
  by_mip_tier: WinRateRow[];
  by_edge_band: WinRateRow[];
  by_sport: WinRateRow[];
  by_signal: WinRateRow[];
  total_games: number;
  decided_games: number;
}
