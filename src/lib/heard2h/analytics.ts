// ── Analytics — Win rate breakdowns ──────────────────────────────────────────

import type { StoredGame, WinRateRow, AnalyticsResult, MipVerdict } from './types';

function buildRow(label: string, games: StoredGame[]): WinRateRow {
  const wins = games.filter(g => g.game_result === 'W').length;
  const losses = games.filter(g => g.game_result === 'L').length;
  const pushes = games.filter(g => g.game_result === 'P').length;
  const decided = wins + losses;
  return {
    label,
    total: games.length,
    wins,
    losses,
    pushes,
    win_rate: decided > 0 ? Math.round((wins / decided) * 100) : 0,
  };
}

const VERDICT_ORDER: MipVerdict[] = ['strong_play', 'play', 'lean', 'no_play'];
const VERDICT_LABELS: Record<MipVerdict, string> = {
  strong_play: 'Strong Play (7-8)',
  play: 'Play (5-6)',
  lean: 'Lean (3-4)',
  no_play: 'No Play (0-2)',
};

export function computeAnalytics(games: StoredGame[]): AnalyticsResult {
  const decided = games.filter(g => g.game_result === 'W' || g.game_result === 'L' || g.game_result === 'P');

  // By MIP tier (using totals verdict as primary)
  const by_mip_tier = VERDICT_ORDER.map(v => {
    const subset = decided.filter(g => g.result.mip.totals.verdict === v);
    return buildRow(VERDICT_LABELS[v], subset);
  }).filter(r => r.total > 0);

  // By edge band
  const edgeBands: [string, (e: number) => boolean][] = [
    ['≥ +4 (Strong Over)', e => e >= 4],
    ['+2 to +4 (Over)', e => e >= 2 && e < 4],
    ['-1.5 to +1.5 (No Edge)', e => e > -1.5 && e < 2],  // overlapping adjusted to match spec
    ['-4 to -2 (Under)', e => e <= -2 && e > -4],
    ['≤ -4 (Strong Under)', e => e <= -4],
  ];
  const by_edge_band = edgeBands.map(([label, test]) => {
    const subset = decided.filter(g => g.result.tempo && test(g.result.tempo.edge));
    return buildRow(label, subset);
  }).filter(r => r.total > 0);

  // By sport
  const by_sport = (['nba', 'ncaab'] as const).map(sport => {
    const subset = decided.filter(g => g.input.sport === sport);
    return buildRow(sport.toUpperCase(), subset);
  }).filter(r => r.total > 0);

  // By signal (which signals were active on winning vs losing plays)
  const signalNames = [
    '2H Reverse Line Movement', 'Shooting Variance', 'Sharp Side Continuation',
    '2H Total Dislocation', 'Pace Mismatch', 'Turnover Regression',
    'Star Returning', 'FT Differential Normalizing', 'Psychological Spot',
  ];
  const by_signal = signalNames.map(name => {
    const subset = decided.filter(g =>
      g.result.signals.signals.some(s => s.name === name && s.active)
    );
    return buildRow(name, subset);
  }).filter(r => r.total > 0);

  return {
    by_mip_tier,
    by_edge_band,
    by_sport,
    by_signal,
    total_games: games.length,
    decided_games: decided.length,
  };
}
