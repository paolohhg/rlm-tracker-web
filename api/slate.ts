// ══════════════════════════════════════════════════════════════════════════════
//  /api/slate — Clean per-game market data for external consumers (hsa-runner)
//
//  Returns structured, preprocessed market objects for all pregame games
//  on today's slate. Each game includes:
//    - identity (teams, league, game_time)
//    - current consensus lines (spread, total, moneyline)
//    - opening lines
//    - movement (spread move, total move, ML implied prob delta)
//    - per-book breakdown (current lines from each sportsbook)
//    - public splits (ticket %, money %, divergence)
//    - signal classification (from detect-rlm)
//    - per-market reads (side, total, ML — each with lean/confidence)
//
//  Query params:
//    ?league=NCAAB          — filter to one league
//    ?date=2026-03-19       — specific slate date (default: today)
//    ?include_live=true     — include games that have started
//    ?refresh_odds=true     — trigger fresh odds fetch before building slate
// ══════════════════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

interface BookLine {
  book: string;
  spread: number | null;
  spread_price: number | null;
  total: number | null;
  total_over_price: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  fetched_at: string;
}

interface PerMarketRead {
  lean: string;
  confidence: string;
  signal_type: string;
  summary: string;
}

interface TotalMarketRead extends PerMarketRead {
  total_books_moved: number;
  total_books_list: string | null;
  total_move_time_window: number | null;
  total_velocity: number | null;
}

interface GameMarketObject {
  // Identity
  game_id: string;
  league: string;
  home_team: string;
  away_team: string;
  game_time: string | null;
  status: 'pregame' | 'live' | 'final' | 'unknown';

  // Consensus lines (average across books)
  consensus: {
    opening_spread: number | null;
    current_spread: number | null;
    spread_move: number | null;
    opening_total: number | null;
    current_total: number | null;
    total_move: number | null;
    opening_ml_home: number | null;
    current_ml_home: number | null;
    ml_implied_prob_delta: number | null;
  };

  // Per-book current lines
  books: BookLine[];
  book_count: number;

  // Tracking
  snapshot_count: number;
  tracking_hours: number;
  latest_snapshot_at: string | null;

  // Public splits
  splits: {
    home_ticket_pct: number | null;
    away_ticket_pct: number | null;
    home_money_pct: number | null;
    away_money_pct: number | null;
    divergence_gap: number | null;
    sharp_side: string | null;
  };

  // Signal classification (from detect-rlm)
  signal: {
    signal_tier: string | null;
    alert_type: string | null;
    overall_badge: string | null;
    primary_market: string | null;
    primary_signal: string | null;
    confidence_score: number | null;
  };

  // Per-market structured reads
  side_read: PerMarketRead;
  total_read: TotalMarketRead;
  ml_read: PerMarketRead;

  // Data completeness
  has_spread: boolean;
  has_total: boolean;
  has_moneyline: boolean;
  has_splits: boolean;
  data_complete: boolean;
}

const PASS_READ: PerMarketRead = {
  lean: 'PASS',
  confidence: 'PASS',
  signal_type: 'NO_EDGE',
  summary: 'No data available.',
};

function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const leagueFilter = req.query.league as string | undefined;
    const dateFilter = req.query.date as string | undefined;
    const includeLive = req.query.include_live === 'true';
    const refreshOdds = req.query.refresh_odds === 'true';

    const now = new Date();

    // Optionally trigger fresh odds fetch
    if (refreshOdds) {
      try {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          await fetch(`${supabaseUrl}/functions/v1/fetch-odds`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
          });
        }
      } catch { /* non-critical */ }
    }

    // Determine slate window
    let slateStart: string;
    let slateEnd: string;

    if (dateFilter) {
      slateStart = `${dateFilter}T00:00:00Z`;
      slateEnd = `${dateFilter}T23:59:59Z`;
    } else {
      // Today: from now through end of day + 6h (covers late-night games)
      const todayStr = now.toISOString().split('T')[0];
      slateStart = `${todayStr}T00:00:00Z`;
      slateEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString();
    }

    const pregameGate = includeLive
      ? now.toISOString()  // include started games
      : new Date(now.getTime() + 5 * 60 * 1000).toISOString();  // 5min buffer

    // ── Fetch unique games on the slate ──────────────────────────
    let slateQuery = supabase
      .from('odds_snapshots')
      .select('league, home_team, away_team, game_time')
      .gte('game_time', slateStart)
      .lte('game_time', slateEnd);

    if (!includeLive) {
      slateQuery = slateQuery.gt('game_time', pregameGate);
    }
    if (leagueFilter) {
      slateQuery = slateQuery.eq('league', leagueFilter);
    }

    const { data: slateGames, error: slateErr } = await slateQuery
      .order('game_time', { ascending: true });

    if (slateErr) throw slateErr;

    // Deduplicate
    const gameKeys = new Map<string, { league: string; homeTeam: string; awayTeam: string; gameTime: string }>();
    for (const g of (slateGames || [])) {
      const key = `${g.league}|${g.home_team}|${g.away_team}`;
      if (!gameKeys.has(key)) {
        gameKeys.set(key, { league: g.league, homeTeam: g.home_team, awayTeam: g.away_team, gameTime: g.game_time });
      }
    }

    if (gameKeys.size === 0) {
      return res.status(200).json({
        slate_date: dateFilter || now.toISOString().split('T')[0],
        game_count: 0,
        games: [],
      });
    }

    // ── Build market objects ─────────────────────────────────────
    const games: GameMarketObject[] = [];

    for (const [gameKey, info] of gameKeys) {
      const { league, homeTeam, awayTeam, gameTime } = info;

      // Fetch latest 200 snapshots (newest first, covers ~6h of 5-book polling)
      const { data: snaps } = await supabase
        .from('odds_snapshots')
        .select('*')
        .eq('league', league)
        .eq('home_team', homeTeam)
        .eq('away_team', awayTeam)
        .order('fetched_at', { ascending: false })
        .limit(200);

      if (!snaps || snaps.length === 0) continue;

      // Reverse to chronological
      const sorted = [...snaps].reverse();

      // Per-book: opening and latest
      const bookMap: Record<string, any[]> = {};
      for (const s of sorted) {
        const bk = s.bookmaker || 'unknown';
        if (!bookMap[bk]) bookMap[bk] = [];
        bookMap[bk].push(s);
      }

      const openingByBook: Record<string, any> = {};
      const currentByBook: Record<string, any> = {};
      for (const [book, bookSnaps] of Object.entries(bookMap)) {
        openingByBook[book] = bookSnaps[0];
        currentByBook[book] = bookSnaps[bookSnaps.length - 1];
      }

      const currentBooks: BookLine[] = Object.entries(currentByBook).map(([book, s]) => ({
        book,
        spread: s.spread,
        spread_price: s.spread_home_price,
        total: s.total,
        total_over_price: s.total_over_price,
        moneyline_home: s.moneyline_home,
        moneyline_away: s.moneyline_away,
        fetched_at: s.fetched_at,
      }));

      // Consensus calculations
      const openSpreads = Object.values(openingByBook).map(s => s.spread).filter((v: any) => v != null);
      const currSpreads = Object.values(currentByBook).map(s => s.spread).filter((v: any) => v != null);
      const openTotals = Object.values(openingByBook).map(s => s.total).filter((v: any) => v != null && v > 0);
      const currTotals = Object.values(currentByBook).map(s => s.total).filter((v: any) => v != null && v > 0);
      const openMLs = Object.values(openingByBook).map(s => s.moneyline_home).filter((v: any) => v != null);
      const currMLs = Object.values(currentByBook).map(s => s.moneyline_home).filter((v: any) => v != null);

      const openingSpread = openSpreads.length ? round1(avg(openSpreads)) : null;
      const currentSpread = currSpreads.length ? round1(avg(currSpreads)) : null;
      const openingTotal = openTotals.length ? round1(avg(openTotals)) : null;
      const currentTotal = currTotals.length ? round1(avg(currTotals)) : null;
      const openingMLHome = openMLs.length ? Math.round(avg(openMLs)) : null;
      const currentMLHome = currMLs.length ? Math.round(avg(currMLs)) : null;

      const spreadMove = openingSpread != null && currentSpread != null
        ? round1(currentSpread - openingSpread) : null;
      const totalMove = openingTotal != null && currentTotal != null
        ? round1(currentTotal - openingTotal) : null;

      let mlProbDelta: number | null = null;
      if (openingMLHome != null && currentMLHome != null) {
        const openProb = americanToImpliedProb(openingMLHome);
        const currProb = americanToImpliedProb(currentMLHome);
        mlProbDelta = round1((currProb - openProb) * 100);
      }

      // Tracking time
      const firstTime = new Date(sorted[0].fetched_at).getTime();
      const lastTime = new Date(sorted[sorted.length - 1].fetched_at).getTime();
      const trackingHours = round1((lastTime - firstTime) / 3600000);

      // Game status
      const gameTimeMs = gameTime ? new Date(gameTime).getTime() : 0;
      const nowMs = now.getTime();
      let status: 'pregame' | 'live' | 'final' | 'unknown' = 'unknown';
      if (gameTimeMs > nowMs + 5 * 60000) status = 'pregame';
      else if (gameTimeMs > 0 && gameTimeMs <= nowMs) status = 'live';

      // ── Splits ──────────────────────────────────────────────────
      let splits: GameMarketObject['splits'] = {
        home_ticket_pct: null, away_ticket_pct: null,
        home_money_pct: null, away_money_pct: null,
        divergence_gap: null, sharp_side: null,
      };

      try {
        const { data: splitsRows } = await supabase
          .from('splits_snapshots')
          .select('*')
          .eq('league', league)
          .eq('home_team', homeTeam)
          .eq('away_team', awayTeam)
          .order('fetched_at', { ascending: false })
          .limit(1);

        if (splitsRows?.length) {
          const s = splitsRows[0];
          const homeBets = s.home_ticket_pct;
          const homeMoney = s.home_money_pct;
          const awayBets = s.away_ticket_pct ?? (100 - (homeBets ?? 50));
          const awayMoney = s.away_money_pct ?? (100 - (homeMoney ?? 50));
          const homeDivergence = (homeMoney ?? 0) - (homeBets ?? 0);
          const awayDivergence = (awayMoney ?? 0) - (awayBets ?? 0);
          const gap = Math.max(Math.abs(homeDivergence), Math.abs(awayDivergence));

          splits = {
            home_ticket_pct: homeBets,
            away_ticket_pct: awayBets,
            home_money_pct: homeMoney,
            away_money_pct: awayMoney,
            divergence_gap: round1(gap),
            sharp_side: gap >= 8
              ? (homeDivergence > awayDivergence ? homeTeam : awayTeam)
              : null,
          };
        }
      } catch { /* non-critical */ }

      // ── Signal from rlm_alerts ──────────────────────────────────
      let signal: GameMarketObject['signal'] = {
        signal_tier: null, alert_type: null, overall_badge: null,
        primary_market: null, primary_signal: null, confidence_score: null,
      };
      let sideRead: PerMarketRead = { ...PASS_READ };
      let totalRead: TotalMarketRead = { ...PASS_READ, total_books_moved: 0, total_books_list: null, total_move_time_window: null, total_velocity: null };
      let mlRead: PerMarketRead = { ...PASS_READ };

      try {
        const { data: alertRows } = await supabase
          .from('rlm_alerts')
          .select('*')
          .eq('league', league)
          .eq('home_team', homeTeam)
          .eq('away_team', awayTeam)
          .order('detected_at', { ascending: false })
          .limit(1);

        if (alertRows?.length) {
          const a = alertRows[0];
          signal = {
            signal_tier: a.signal_tier,
            alert_type: a.alert_type,
            overall_badge: a.overall_badge ?? a.signal_tier,
            primary_market: a.primary_market,
            primary_signal: a.primary_signal,
            confidence_score: a.confidence_score,
          };
          if (a.side_confidence) {
            sideRead = {
              lean: a.side_lean ?? 'PASS',
              confidence: a.side_confidence ?? 'PASS',
              signal_type: a.side_signal_type ?? 'NO_EDGE',
              summary: a.side_summary ?? '',
            };
          }
          if (a.total_confidence) {
            totalRead = {
              lean: a.total_lean ?? 'PASS',
              confidence: a.total_confidence ?? 'PASS',
              signal_type: a.total_signal_type ?? 'NO_EDGE',
              summary: a.total_summary ?? '',
              total_books_moved: a.total_books_moved ?? 0,
              total_books_list: a.total_books_list ?? null,
              total_move_time_window: a.total_move_time_window ?? null,
              total_velocity: a.total_velocity ?? null,
            };
          }
          if (a.ml_confidence) {
            mlRead = {
              lean: a.ml_lean ?? 'PASS',
              confidence: a.ml_confidence ?? 'PASS',
              signal_type: a.ml_signal_type ?? 'NO_EDGE',
              summary: a.ml_summary ?? '',
            };
          }
        }
      } catch { /* non-critical */ }

      // ── Completeness flags ──────────────────────────────────────
      const hasSpread = currSpreads.length > 0;
      const hasTotal = currTotals.length > 0;
      const hasMoneyline = currMLs.length > 0;
      const hasSplits = splits.home_ticket_pct != null;

      games.push({
        game_id: gameKey,
        league,
        home_team: homeTeam,
        away_team: awayTeam,
        game_time: gameTime,
        status,
        consensus: {
          opening_spread: openingSpread,
          current_spread: currentSpread,
          spread_move: spreadMove,
          opening_total: openingTotal,
          current_total: currentTotal,
          total_move: totalMove,
          opening_ml_home: openingMLHome,
          current_ml_home: currentMLHome,
          ml_implied_prob_delta: mlProbDelta,
        },
        books: currentBooks,
        book_count: currentBooks.length,
        snapshot_count: snaps.length,
        tracking_hours: trackingHours,
        latest_snapshot_at: sorted[sorted.length - 1]?.fetched_at ?? null,
        splits,
        signal,
        side_read: sideRead,
        total_read: totalRead,
        ml_read: mlRead,
        has_spread: hasSpread,
        has_total: hasTotal,
        has_moneyline: hasMoneyline,
        has_splits: hasSplits,
        data_complete: hasSpread && hasTotal && hasMoneyline,
      });
    }

    // Sort by game_time
    games.sort((a, b) => {
      if (!a.game_time) return 1;
      if (!b.game_time) return -1;
      return new Date(a.game_time).getTime() - new Date(b.game_time).getTime();
    });

    return res.status(200).json({
      slate_date: dateFilter || now.toISOString().split('T')[0],
      generated_at: now.toISOString(),
      game_count: games.length,
      games,
    });

  } catch (err: any) {
    console.error('Slate API error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
