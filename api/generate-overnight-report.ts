// ══════════════════════════════════════════════════════════════════════════════
//  /api/generate-overnight-report — Daily scheduled job
//
//  Generates Morning Market Reports for all supported leagues.
//  Runs once daily via Vercel cron (see vercel.json).
//
//  For each league:
//    1. Upserts a "pending" row in overnight_reports
//    2. Runs the analysis engine against overnight odds_snapshots
//    3. Updates the row with computed_stats + report_payload (or error)
//
//  Reports are immutable after generation for that date.
//  To regenerate: POST with ?force=true&league=NBA&date=2026-03-20
//
//  Cron schedule: 0 12 * * *  (noon UTC / 8 AM ET daily)
// ══════════════════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateOvernightReport } from './lib/overnight-report-engine';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

// ── Supported leagues ─────────────────────────────────────────────────────
// TUNE: add/remove leagues here as coverage expands
const SUPPORTED_LEAGUES = ['NBA', 'NCAAB', 'NHL', 'MLB'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const force = req.query.force === 'true';
    const leagueFilter = typeof req.query.league === 'string' ? req.query.league.toUpperCase() : null;
    const dateOverride = typeof req.query.date === 'string' ? req.query.date : null;

    // Default to today's date in UTC
    const reportDate = dateOverride || new Date().toISOString().split('T')[0];

    const leagues = leagueFilter
      ? SUPPORTED_LEAGUES.filter(l => l === leagueFilter)
      : SUPPORTED_LEAGUES;

    if (leagues.length === 0) {
      return res.status(400).json({ error: `Unknown league: ${leagueFilter}` });
    }

    const results: Record<string, any> = {};

    for (const league of leagues) {
      // ── Check if report already exists ────────────────────────────────
      const { data: existing } = await supabase
        .from('overnight_reports')
        .select('id, status')
        .eq('league', league)
        .eq('report_date', reportDate)
        .single();

      if (existing && existing.status === 'complete' && !force) {
        results[league] = { skipped: true, reason: 'Report already complete. Use ?force=true to regenerate.' };
        continue;
      }

      // ── Upsert pending row ────────────────────────────────────────────
      const { data: row, error: upsertErr } = await supabase
        .from('overnight_reports')
        .upsert(
          {
            league,
            report_date: reportDate,
            status: 'pending',
            error_message: null,
            computed_stats: null,
            report_payload: null,
          },
          { onConflict: 'league,report_date' }
        )
        .select('id')
        .single();

      if (upsertErr) {
        results[league] = { error: `Upsert failed: ${upsertErr.message}` };
        continue;
      }

      // ── Run the engine ────────────────────────────────────────────────
      try {
        const result = await generateOvernightReport(supabase, league, reportDate);

        // ── Store results ─────────────────────────────────────────────
        const { error: updateErr } = await supabase
          .from('overnight_reports')
          .update({
            status: result.status,
            error_message: result.error_message || null,
            window_start: result.window_start,
            window_end: result.window_end,
            snapshot_count: result.snapshot_count,
            game_count: result.game_count,
            computed_stats: result.computed_stats,
            report_payload: result.report_payload,
          })
          .eq('id', row.id);

        if (updateErr) {
          results[league] = { error: `Update failed: ${updateErr.message}` };
        } else {
          results[league] = {
            status: result.status,
            snapshot_count: result.snapshot_count,
            game_count: result.game_count,
            signals: result.report_payload?.top_signals?.length || 0,
          };
        }
      } catch (engineErr: any) {
        // Mark as failed
        await supabase
          .from('overnight_reports')
          .update({
            status: 'failed',
            error_message: engineErr.message || 'Unknown engine error',
          })
          .eq('id', row.id);

        results[league] = { status: 'failed', error: engineErr.message };
      }
    }

    return res.status(200).json({
      ok: true,
      report_date: reportDate,
      forced: force,
      results,
    });
  } catch (err: any) {
    console.error('generate-overnight-report error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
