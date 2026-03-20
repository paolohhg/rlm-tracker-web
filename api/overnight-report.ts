// ══════════════════════════════════════════════════════════════════════════════
//  /api/overnight-report — Read-only API for stored Morning Market Reports
//
//  Returns the latest completed report for the requested league.
//  NEVER generates a report — only reads from overnight_reports table.
//
//  Query params:
//    ?league=NCAAB       — required, league to fetch
//    ?date=2026-03-20    — optional, specific date (default: latest available)
//    ?admin=true         — optional, include debug fields (computed_stats, window, etc.)
//
//  Response:
//    { report: ReportPayload, meta: { league, date, status, generated_at } }
//    or { error, status } if no report available
// ══════════════════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const league = typeof req.query.league === 'string' ? req.query.league.toUpperCase() : null;
  const dateFilter = typeof req.query.date === 'string' ? req.query.date : null;
  const admin = req.query.admin === 'true';

  if (!league) {
    return res.status(400).json({ error: 'Missing required ?league= parameter' });
  }

  try {
    let query = supabase
      .from('overnight_reports')
      .select('*')
      .eq('league', league);

    if (dateFilter) {
      query = query.eq('report_date', dateFilter);
    } else {
      // Latest completed report
      query = query.eq('status', 'complete');
    }

    query = query.order('report_date', { ascending: false }).limit(1);

    const { data, error } = await query.single();

    if (error || !data) {
      return res.status(404).json({
        error: 'No report found',
        league,
        date: dateFilter || 'latest',
      });
    }

    // ── Build response ──────────────────────────────────────────────────
    const response: Record<string, any> = {
      report: data.report_payload,
      meta: {
        league: data.league,
        date: data.report_date,
        status: data.status,
        generated_at: data.report_payload?.generated_at || data.created_at,
        snapshot_count: data.snapshot_count,
        game_count: data.game_count,
      },
    };

    // Admin/debug fields — includes raw computed stats and window info
    if (admin) {
      response.debug = {
        id: data.id,
        window_start: data.window_start,
        window_end: data.window_end,
        computed_stats: data.computed_stats,
        error_message: data.error_message,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }

    // If the report isn't complete, include status info
    if (data.status !== 'complete') {
      response.report = null;
      response.meta.error_message = data.error_message;
    }

    return res.status(200).json(response);
  } catch (err: any) {
    console.error('overnight-report error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
