// ══════════════════════════════════════════════════════════════════════════════
//  Overnight Report Engine
//
//  Generates Morning Market Reports using the full lifecycle model.
//  Consumes odds_snapshots and produces structured reports per league/date.
//
//  Called by /api/generate-overnight-report (scheduled job).
//  Output stored in overnight_reports table, read by /api/overnight-report.
//
//  Uses market-lifecycle-engine for all analysis — never applies its own
//  recent-window logic. This ensures morning reports reflect the full
//  line history even when overnight window was quiet.
//
//  Designed for later expansion: same computed_stats + report_payload can
//  power social posts, email digests, and push notifications.
// ══════════════════════════════════════════════════════════════════════════════

import { SupabaseClient } from '@supabase/supabase-js';
import {
  analyzeGameMarkets,
  type MarketAnalysis,
  type LifecycleState,
} from './market-lifecycle-engine';

// ── Tunable thresholds ──────────────────────────────────────────────────────
// Adjust these per league or globally to change sensitivity.

export const THRESHOLDS = {
  /** UTC hour range defining "overnight" window. [start, end) */
  // TUNE: shift window per league/timezone as needed
  OVERNIGHT_WINDOW_START_UTC: 2,   // 2 AM UTC  (10 PM ET)
  OVERNIGHT_WINDOW_END_UTC: 12,    // 12 PM UTC (8 AM ET)

  /** Minimum snapshots needed to generate a report */
  // TUNE: raise for leagues with more books reporting
  MIN_SNAPSHOTS: 10,

  /** Minimum games needed */
  // TUNE: lower for MLB off-days, raise for NCAAB slates
  MIN_GAMES: 2,

  /** Maximum top signals to include in report */
  TOP_SIGNALS_LIMIT: 8,

  /** Maximum frozen line entries */
  FROZEN_LINES_LIMIT: 5,

  /** Maximum "what to watch" items */
  WATCH_LIMIT: 6,

  // ── League-specific overrides ───────────────────────────────────────────
  // TUNE: add per-league threshold objects here
  LEAGUE_OVERRIDES: {} as Record<string, Partial<typeof THRESHOLDS>>,
};

/** Resolve a threshold value, checking league overrides first */
function threshold<K extends keyof typeof THRESHOLDS>(
  key: K,
  league: string,
): typeof THRESHOLDS[K] {
  const overrides = THRESHOLDS.LEAGUE_OVERRIDES[league];
  if (overrides && key in overrides) return overrides[key] as typeof THRESHOLDS[K];
  return THRESHOLDS[key];
}

// ── Types ───────────────────────────────────────────────────────────────────

interface OddsSnapshot {
  id: string;
  league: string;
  home_team: string;
  away_team: string;
  game_time: string;
  bookmaker: string;
  spread: number | null;
  spread_price: number | null;
  total: number | null;
  total_over_price: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  book_type: string | null;
  fetched_at: string;
}

interface GameGroup {
  gameKey: string;
  home_team: string;
  away_team: string;
  game_time: string;
  snapshots: OddsSnapshot[];
}

export interface GameAnalysis {
  gameKey: string;
  home_team: string;
  away_team: string;
  game_time: string;
  snapshot_count: number;
  books_reporting: string[];

  // Lifecycle-based per-market analyses
  spread: MarketAnalysis | null;
  total: MarketAnalysis | null;
  moneyline: MarketAnalysis | null;

  // Composite fields derived from lifecycle analyses
  primary_lifecycle_state: LifecycleState;
  has_coordination: boolean;
  has_frozen_lines: boolean;
  signal_strength: number;
  primary_signal_label: string;
}

export interface FrozenLine {
  gameKey: string;
  home_team: string;
  away_team: string;
  market: string;
  note: string;
  time_at_band_minutes: number;
}

export interface AggregateStats {
  total_games: number;
  total_snapshots: number;
  games_with_active_spread: number;
  games_with_active_total: number;
  games_with_active_ml: number;
  games_with_coordination: number;
  games_with_stabilization: number;
  games_with_frozen_lines: number;
  avg_spread_move: number;
  avg_total_move: number;
  max_spread_move: { game: string; move: number };
  max_total_move: { game: string; move: number };
}

export interface TopSignal {
  game: string;
  signal: string;
  detail: string;
  strength: number;
  lifecycle_state: LifecycleState;
  confidence: string;
}

export interface WatchItem {
  game: string;
  reason: string;
}

export interface QuickStats {
  games_tracked: number;
  significant_moves: number;
  coordinated_moves: number;
  frozen_lines: number;
  window: string;
}

export interface ReportPayload {
  headline: string;
  quick_stats: QuickStats;
  top_signals: TopSignal[];
  frozen_line_watch: FrozenLine[];
  market_themes: string[];
  what_to_watch: WatchItem[];
  generated_at: string;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Core pipeline
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch ALL odds snapshots for games in the overnight window.
 * We fetch the FULL history (not just overnight window) so the lifecycle
 * engine can analyze opening → current. The overnight window is used to
 * scope WHICH GAMES to include (games starting near/after the window).
 */
export async function fetchOvernightSnapshots(
  supabase: SupabaseClient,
  league: string,
  reportDate: string,
): Promise<{ snapshots: OddsSnapshot[]; windowStart: string; windowEnd: string }> {
  const startHour = threshold('OVERNIGHT_WINDOW_START_UTC', league) as number;
  const endHour = threshold('OVERNIGHT_WINDOW_END_UTC', league) as number;

  const windowStart = `${reportDate}T${String(startHour).padStart(2, '0')}:00:00Z`;
  const windowEnd = `${reportDate}T${String(endHour).padStart(2, '0')}:00:00Z`;

  // First: find games that have snapshots in the overnight window
  const { data: gameKeys, error: gkErr } = await supabase
    .from('odds_snapshots')
    .select('home_team, away_team, game_time')
    .eq('league', league)
    .gte('fetched_at', windowStart)
    .lt('fetched_at', windowEnd)
    .limit(500);

  if (gkErr) throw new Error(`Failed to fetch game keys: ${gkErr.message}`);
  if (!gameKeys?.length) return { snapshots: [], windowStart, windowEnd };

  // Deduplicate games
  const uniqueGames = new Map<string, { home_team: string; away_team: string; game_time: string }>();
  for (const gk of gameKeys) {
    const key = `${gk.home_team}|${gk.away_team}|${gk.game_time}`;
    if (!uniqueGames.has(key)) uniqueGames.set(key, gk);
  }

  // Then: fetch FULL history for each game (opening → latest)
  const allSnapshots: OddsSnapshot[] = [];
  for (const game of uniqueGames.values()) {
    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('league', league)
      .eq('home_team', game.home_team)
      .eq('away_team', game.away_team)
      .eq('game_time', game.game_time)
      .order('fetched_at', { ascending: true })
      .limit(1000);

    if (!error && data) allSnapshots.push(...data);
  }

  return { snapshots: allSnapshots, windowStart, windowEnd };
}

/**
 * Group snapshots by canonical game.
 */
export function groupByGame(snapshots: OddsSnapshot[]): GameGroup[] {
  const map = new Map<string, GameGroup>();

  for (const s of snapshots) {
    const key = `${s.home_team}|${s.away_team}|${s.game_time}`;
    if (!map.has(key)) {
      map.set(key, {
        gameKey: key,
        home_team: s.home_team,
        away_team: s.away_team,
        game_time: s.game_time,
        snapshots: [],
      });
    }
    map.get(key)!.snapshots.push(s);
  }

  return Array.from(map.values());
}

/**
 * Analyze a single game using the lifecycle engine.
 */
export function analyzeGame(group: GameGroup, league: string): GameAnalysis {
  const { snapshots } = group;
  const books = [...new Set(snapshots.map(s => s.bookmaker))];

  // Run full lifecycle analysis on all three markets
  const lifecycle = analyzeGameMarkets(snapshots, league, group.home_team, group.away_team);

  // Derive composite fields
  const markets = [lifecycle.spread, lifecycle.total, lifecycle.moneyline].filter(Boolean) as MarketAnalysis[];

  // Primary lifecycle state: pick the most significant market's state
  const bestMarket = markets.sort((a, b) => {
    const stateRank = (s: LifecycleState) => {
      const ranks: Record<LifecycleState, number> = {
        STEAM: 7, FOLLOW_THROUGH: 6, REVERSAL: 5, SHADE_RESISTANCE: 4,
        INITIATION: 3, STABILIZATION: 2, CHAOTIC: 1, QUIET: 0,
      };
      return ranks[s] ?? 0;
    };
    return stateRank(b.primary_signal.state) - stateRank(a.primary_signal.state);
  })[0];

  const primaryLifecycleState: LifecycleState = bestMarket?.primary_signal.state ?? 'QUIET';

  // Coordination: any market has HIGH confidence with 3+ books
  const hasCoordination = markets.some(m =>
    m.primary_signal.books_involved >= 3 && m.primary_signal.confidence !== 'PASS',
  );

  // Frozen/stabilization detection
  const hasFrozen = markets.some(m =>
    m.current_state.state === 'STABILIZATION' && m.time_at_current_band_minutes >= 120,
  );

  // Signal strength: max across markets
  const strengthMap: Record<string, number> = { PASS: 0, LOW: 20, MODERATE: 50, HIGH: 80 };
  const signalStrength = Math.max(0, ...markets.map(m => strengthMap[m.final_read.confidence] ?? 0));

  // Primary signal label
  const primaryLabel = bestMarket?.final_read.summary_mode || 'No significant movement';

  return {
    gameKey: group.gameKey,
    home_team: group.home_team,
    away_team: group.away_team,
    game_time: group.game_time,
    snapshot_count: snapshots.length,
    books_reporting: books,
    spread: lifecycle.spread,
    total: lifecycle.total,
    moneyline: lifecycle.moneyline,
    primary_lifecycle_state: primaryLifecycleState,
    has_coordination: hasCoordination,
    has_frozen_lines: hasFrozen,
    signal_strength: signalStrength,
    primary_signal_label: primaryLabel,
  };
}

/**
 * Compute aggregate stats across all analyzed games.
 */
export function computeAggregateStats(games: GameAnalysis[]): AggregateStats {
  const activeSpread = games.filter(g => g.spread?.final_read.signal_status === 'ACTIVE');
  const activeTotal = games.filter(g => g.total?.final_read.signal_status === 'ACTIVE');
  const activeML = games.filter(g => g.moneyline?.final_read.signal_status === 'ACTIVE');

  const spreadMoves = games
    .filter(g => g.spread)
    .map(g => ({
      game: `${g.away_team} @ ${g.home_team}`,
      move: Math.abs(g.spread!.structural_context.total_move_from_open),
    }));
  const totalMoves = games
    .filter(g => g.total)
    .map(g => ({
      game: `${g.away_team} @ ${g.home_team}`,
      move: Math.abs(g.total!.structural_context.total_move_from_open),
    }));

  const maxSpread = spreadMoves.length
    ? spreadMoves.reduce((max, cur) => cur.move > max.move ? cur : max)
    : { game: 'N/A', move: 0 };
  const maxTotal = totalMoves.length
    ? totalMoves.reduce((max, cur) => cur.move > max.move ? cur : max)
    : { game: 'N/A', move: 0 };

  const avgSpread = spreadMoves.length
    ? spreadMoves.reduce((s, m) => s + m.move, 0) / spreadMoves.length : 0;
  const avgTotal = totalMoves.length
    ? totalMoves.reduce((s, m) => s + m.move, 0) / totalMoves.length : 0;

  return {
    total_games: games.length,
    total_snapshots: games.reduce((sum, g) => sum + g.snapshot_count, 0),
    games_with_active_spread: activeSpread.length,
    games_with_active_total: activeTotal.length,
    games_with_active_ml: activeML.length,
    games_with_coordination: games.filter(g => g.has_coordination).length,
    games_with_stabilization: games.filter(g =>
      g.primary_lifecycle_state === 'STABILIZATION' ||
      [g.spread, g.total, g.moneyline].some(m => m?.current_state.state === 'STABILIZATION'),
    ).length,
    games_with_frozen_lines: games.filter(g => g.has_frozen_lines).length,
    avg_spread_move: Math.round(avgSpread * 10) / 10,
    avg_total_move: Math.round(avgTotal * 10) / 10,
    max_spread_move: maxSpread,
    max_total_move: maxTotal,
  };
}

/**
 * Generate the subscriber-facing narrative report payload.
 */
export function generateReportPayload(
  league: string,
  reportDate: string,
  games: GameAnalysis[],
  aggregate: AggregateStats,
  windowStart: string,
  windowEnd: string,
): ReportPayload {
  // ── Top signals: games sorted by signal_strength, top N ─────────────────
  const topSignals: TopSignal[] = games
    .filter(g => g.signal_strength > 0)
    .sort((a, b) => b.signal_strength - a.signal_strength)
    .slice(0, THRESHOLDS.TOP_SIGNALS_LIMIT)
    .map(g => {
      const parts: string[] = [];
      const markets = [
        { label: 'Spread', m: g.spread },
        { label: 'Total', m: g.total },
        { label: 'ML', m: g.moneyline },
      ];

      for (const { label, m } of markets) {
        if (m && m.final_read.confidence !== 'PASS') {
          const ctx = m.structural_context;
          const ps = m.primary_signal;
          parts.push(
            `${label}: ${m.opening_line} → ${m.current_line} ` +
            `(${ctx.total_move_from_open > 0 ? '+' : ''}${ctx.total_move_from_open.toFixed(1)}) ` +
            `[${ps.state}${m.current_state.state !== ps.state ? ' → ' + m.current_state.state : ''}]`,
          );
        }
      }

      if (g.has_coordination) {
        const coordBooks = markets
          .map(({ m }) => m?.primary_signal)
          .filter(ps => ps && ps.books_involved >= 3)
          .map(ps => `${ps!.books_involved} books`);
        if (coordBooks.length) parts.push(`Coordinated (${coordBooks.join(', ')})`);
      }

      // Find best confidence across markets
      const bestConf = ['HIGH', 'MODERATE', 'LOW', 'PASS'].find(c =>
        markets.some(({ m }) => m?.final_read.confidence === c),
      ) || 'PASS';

      return {
        game: `${g.away_team} @ ${g.home_team}`,
        signal: g.primary_signal_label,
        detail: parts.join(' | ') || 'Minor movement detected',
        strength: g.signal_strength,
        lifecycle_state: g.primary_lifecycle_state,
        confidence: bestConf,
      };
    });

  // ── Frozen line watch ───────────────────────────────────────────────────
  const frozenWatch: FrozenLine[] = [];
  for (const g of games) {
    for (const m of [g.spread, g.total, g.moneyline]) {
      if (m && m.current_state.state === 'STABILIZATION' && m.time_at_current_band_minutes >= 60) {
        frozenWatch.push({
          gameKey: g.gameKey,
          home_team: g.home_team,
          away_team: g.away_team,
          market: m.market_type,
          note: `${m.market_type} stabilized at ${m.current_line} for ${m.time_at_current_band_minutes}min after ${m.primary_signal.state.toLowerCase()} signal`,
          time_at_band_minutes: m.time_at_current_band_minutes,
        });
      }
    }
  }
  frozenWatch.sort((a, b) => b.time_at_band_minutes - a.time_at_band_minutes);
  const topFrozen = frozenWatch.slice(0, THRESHOLDS.FROZEN_LINES_LIMIT);

  // ── Market themes ──────────────────────────────────────────────────────
  const themes: string[] = [];
  if (aggregate.games_with_coordination > 0)
    themes.push(`${aggregate.games_with_coordination} game${aggregate.games_with_coordination > 1 ? 's' : ''} show coordinated multi-book movement`);
  if (aggregate.games_with_active_spread > 0)
    themes.push(`Active spread signals in ${aggregate.games_with_active_spread} of ${aggregate.total_games} games`);
  if (aggregate.games_with_active_total > 0)
    themes.push(`Active total signals in ${aggregate.games_with_active_total} of ${aggregate.total_games} games`);
  if (aggregate.games_with_stabilization > 0)
    themes.push(`${aggregate.games_with_stabilization} game${aggregate.games_with_stabilization > 1 ? 's' : ''} show prior moves now stabilized — watch for continuation or late break`);
  if (aggregate.games_with_frozen_lines > 0)
    themes.push(`${aggregate.games_with_frozen_lines} game${aggregate.games_with_frozen_lines > 1 ? 's' : ''} with prolonged stabilization worth monitoring`);
  if (aggregate.max_spread_move.move > 0)
    themes.push(`Biggest spread move: ${aggregate.max_spread_move.game} (${aggregate.max_spread_move.move.toFixed(1)} pts)`);
  if (aggregate.max_total_move.move > 0)
    themes.push(`Biggest total move: ${aggregate.max_total_move.game} (${aggregate.max_total_move.move.toFixed(1)} pts)`);

  // ── What to watch ──────────────────────────────────────────────────────
  const watchItems: WatchItem[] = [];

  for (const g of games.filter(g => g.has_coordination)) {
    watchItems.push({
      game: `${g.away_team} @ ${g.home_team}`,
      reason: `Multi-market coordinated move (strength ${g.signal_strength}) — watch for continued sharp action`,
    });
  }
  // STABILIZATION games are key: prior move held, could continue
  for (const g of games.filter(g =>
    g.primary_lifecycle_state === 'STABILIZATION' && g.signal_strength >= 30 && !g.has_coordination,
  )) {
    watchItems.push({
      game: `${g.away_team} @ ${g.home_team}`,
      reason: `Prior signal now stabilized — line holding at new level, watch for late follow-through`,
    });
  }
  for (const f of topFrozen.slice(0, 2)) {
    watchItems.push({
      game: `${f.away_team} @ ${f.home_team}`,
      reason: `${f.market} stabilized for ${f.time_at_band_minutes}min — watch for late break`,
    });
  }

  const finalWatch = watchItems.slice(0, THRESHOLDS.WATCH_LIMIT);

  // ── Headline ───────────────────────────────────────────────────────────
  const headline = buildHeadline(league, aggregate, topSignals);

  // ── Quick stats ────────────────────────────────────────────────────────
  const significantMoves = aggregate.games_with_active_spread +
    aggregate.games_with_active_total + aggregate.games_with_active_ml;

  const quickStats: QuickStats = {
    games_tracked: aggregate.total_games,
    significant_moves: significantMoves,
    coordinated_moves: aggregate.games_with_coordination,
    frozen_lines: frozenWatch.length,
    window: `${formatTime(windowStart)} – ${formatTime(windowEnd)} UTC`,
  };

  return {
    headline,
    quick_stats: quickStats,
    top_signals: topSignals,
    frozen_line_watch: topFrozen,
    market_themes: themes,
    what_to_watch: finalWatch,
    generated_at: new Date().toISOString(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildHeadline(league: string, agg: AggregateStats, topSignals: TopSignal[]): string {
  if (agg.total_games === 0) return `${league} Morning Report — No overnight games tracked`;

  const sigCount = topSignals.length;
  if (sigCount === 0)
    return `${league} Morning Report — Quiet overnight, ${agg.total_games} games tracked`;
  if (agg.games_with_coordination > 0)
    return `${league} Morning Report — ${agg.games_with_coordination} coordinated move${agg.games_with_coordination > 1 ? 's' : ''} detected overnight`;
  if (agg.games_with_stabilization > 0 && sigCount <= 3)
    return `${league} Morning Report — ${agg.games_with_stabilization} game${agg.games_with_stabilization > 1 ? 's' : ''} with prior signals now stabilized`;
  if (sigCount <= 2)
    return `${league} Morning Report — ${sigCount} signal${sigCount > 1 ? 's' : ''} worth watching`;
  return `${league} Morning Report — Active overnight with ${sigCount} notable moves across ${agg.total_games} games`;
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').replace(':00Z', '').replace('Z', '');
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main orchestrator — called by the scheduled job
// ══════════════════════════════════════════════════════════════════════════════

export async function generateOvernightReport(
  supabase: SupabaseClient,
  league: string,
  reportDate: string,
): Promise<{
  status: 'complete' | 'insufficient_data' | 'failed';
  computed_stats: { games: GameAnalysis[]; aggregate: AggregateStats } | null;
  report_payload: ReportPayload | null;
  window_start: string;
  window_end: string;
  snapshot_count: number;
  game_count: number;
  error_message?: string;
}> {
  const { snapshots, windowStart, windowEnd } = await fetchOvernightSnapshots(
    supabase, league, reportDate,
  );

  const minSnaps = threshold('MIN_SNAPSHOTS', league) as number;
  const minGames = threshold('MIN_GAMES', league) as number;

  const groups = groupByGame(snapshots);

  if (snapshots.length < minSnaps || groups.length < minGames) {
    return {
      status: 'insufficient_data',
      computed_stats: null,
      report_payload: null,
      window_start: windowStart,
      window_end: windowEnd,
      snapshot_count: snapshots.length,
      game_count: groups.length,
      error_message: `Insufficient data: ${snapshots.length} snapshots, ${groups.length} games (need ${minSnaps}/${minGames})`,
    };
  }

  const gameAnalyses = groups.map(g => analyzeGame(g, league));
  const aggregate = computeAggregateStats(gameAnalyses);
  const payload = generateReportPayload(league, reportDate, gameAnalyses, aggregate, windowStart, windowEnd);

  return {
    status: 'complete',
    computed_stats: { games: gameAnalyses, aggregate },
    report_payload: payload,
    window_start: windowStart,
    window_end: windowEnd,
    snapshot_count: snapshots.length,
    game_count: groups.length,
  };
}
