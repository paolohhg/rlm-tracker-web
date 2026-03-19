// ══════════════════════════════════════════════════════════════════════════════
//  /api/hsa-slate — Canonicalized per-game market data for hsa-runner
//
//  Separate from /api/slate. This is hsa-runner's single source of truth.
//  hsa-runner consumes this response directly and performs NO matching logic.
//
//  Flow:
//    1. Calls games_master_populate() to sync games_master from odds_snapshots
//    2. Queries games_master for the requested slate window
//    3. For each canonical game, fetches odds/splits/alerts via normalized matching
//    4. Returns fully canonicalized per-game market objects with data-quality fields
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

// ── Types ────────────────────────────────────────────────────────────────────

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

interface HsaGameObject {
  // Identity
  canonical_game_id: string;
  league: string;
  home_team: string;
  away_team: string;
  home_normalized: string;
  away_normalized: string;
  commence_time_utc: string;
  status: 'pregame' | 'live' | 'final' | 'unknown';

  // Consensus lines
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

  // Signal classification (suppressed when insufficient_data = true)
  signal: {
    signal_tier: string | null;
    alert_type: string | null;
    overall_badge: string | null;
    primary_market: string | null;
    primary_signal: string | null;
    confidence_score: number | null;
  };

  // Per-market reads (suppressed when insufficient_data = true)
  side_read: PerMarketRead;
  total_read: PerMarketRead;
  ml_read: PerMarketRead;

  // Data-quality fields
  snapshot_count: number;
  books_reporting: number;
  has_opener: boolean;
  has_splits: boolean;
  has_alerts: boolean;
  insufficient_data: boolean;
}

const PASS_READ: PerMarketRead = {
  lean: 'PASS',
  confidence: 'PASS',
  signal_type: 'NO_EDGE',
  summary: 'No data available.',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Handler ──────────────────────────────────────────────────────────────────

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

    // ── Refresh games_master from odds_snapshots ───────────────────────
    try {
      await supabase.rpc('games_master_populate');
    } catch (e: any) {
      console.error('games_master_populate failed:', e.message);
      // Non-fatal — continue with whatever games_master has
    }

    // ── Determine slate window ────────────────────────────────────────
    let slateStart: string;
    let slateEnd: string;

    if (dateFilter) {
      slateStart = `${dateFilter}T00:00:00Z`;
      slateEnd = `${dateFilter}T23:59:59Z`;
    } else {
      const todayStr = now.toISOString().split('T')[0];
      slateStart = `${todayStr}T00:00:00Z`;
      slateEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString();
    }

    // ── Query games_master ────────────────────────────────────────────
    let gmQuery = supabase
      .from('games_master')
      .select('*')
      .gte('commence_time_utc', slateStart)
      .lte('commence_time_utc', slateEnd);

    if (leagueFilter) {
      gmQuery = gmQuery.eq('league', leagueFilter);
    }

    if (!includeLive) {
      const pregameGate = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      gmQuery = gmQuery.gt('commence_time_utc', pregameGate);
    }

    const { data: masterGames, error: gmErr } = await gmQuery
      .order('commence_time_utc', { ascending: true });

    if (gmErr) throw gmErr;

    if (!masterGames || masterGames.length === 0) {
      return res.status(200).json({
        slate_date: dateFilter || now.toISOString().split('T')[0],
        generated_at: now.toISOString(),
        game_count: 0,
        games: [],
      });
    }

    // ── Build market objects ──────────────────────────────────────────
    const games: HsaGameObject[] = [];

    for (const gm of masterGames) {
      const { league, home_team: homeTeam, away_team: awayTeam,
              commence_time_utc: gameTime, canonical_game_id,
              home_normalized, away_normalized } = gm;

      // Fetch latest 200 snapshots for this game (by raw names as stored in odds_snapshots)
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

      // ── Data-quality fields ─────────────────────────────────────────
      const snapshotCount = snaps.length;
      const booksReporting = Object.keys(currentByBook).length;
      const hasOpener = openSpreads.length > 0 || openTotals.length > 0;

      // ── Splits ──────────────────────────────────────────────────────
      let splits: HsaGameObject['splits'] = {
        home_ticket_pct: null, away_ticket_pct: null,
        home_money_pct: null, away_money_pct: null,
        divergence_gap: null, sharp_side: null,
      };
      let hasSplits = false;

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
          hasSplits = true;
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

      // ── Signal from rlm_alerts ──────────────────────────────────────
      let signal: HsaGameObject['signal'] = {
        signal_tier: null, alert_type: null, overall_badge: null,
        primary_market: null, primary_signal: null, confidence_score: null,
      };
      let sideRead: PerMarketRead = { ...PASS_READ };
      let totalRead: PerMarketRead = { ...PASS_READ };
      let mlRead: PerMarketRead = { ...PASS_READ };
      let hasAlerts = false;

      // Determine insufficient_data BEFORE fetching alerts
      const insufficientData = snapshotCount < 3 || booksReporting < 2 || !hasOpener;

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
          hasAlerts = true;

          // Only populate signal classification if data is sufficient
          if (!insufficientData) {
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
        }
      } catch { /* non-critical */ }

      games.push({
        canonical_game_id,
        league,
        home_team: homeTeam,
        away_team: awayTeam,
        home_normalized,
        away_normalized,
        commence_time_utc: gameTime,
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
        tracking_hours: trackingHours,
        latest_snapshot_at: sorted[sorted.length - 1]?.fetched_at ?? null,
        splits,
        signal,
        side_read: sideRead,
        total_read: totalRead,
        ml_read: mlRead,
        // Data-quality fields
        snapshot_count: snapshotCount,
        books_reporting: booksReporting,
        has_opener: hasOpener,
        has_splits: hasSplits,
        has_alerts: hasAlerts,
        insufficient_data: insufficientData,
      });
    }

    // Sort by commence time
    games.sort((a, b) => {
      if (!a.commence_time_utc) return 1;
      if (!b.commence_time_utc) return -1;
      return new Date(a.commence_time_utc).getTime() - new Date(b.commence_time_utc).getTime();
    });

    return res.status(200).json({
      slate_date: dateFilter || now.toISOString().split('T')[0],
      generated_at: now.toISOString(),
      game_count: games.length,
      games,
    });

  } catch (err: any) {
    console.error('HSA Slate API error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
