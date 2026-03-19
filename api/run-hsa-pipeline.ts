// HSA Pipeline: fetch fresh odds → run detect-rlm → done.
// Single cron route that runs both steps sequentially.
// Runs every 15 min via Vercel cron (see vercel.json)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const started = Date.now();

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    const headers = {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    };

    // ── Step 1: Fetch fresh odds ──────────────────────────────────
    let oddsResult: any = null;
    try {
      const oddsRes = await fetch(`${supabaseUrl}/functions/v1/fetch-odds`, {
        method: 'POST',
        headers,
      });
      oddsResult = await oddsRes.json();
      if (!oddsRes.ok) {
        console.error('fetch-odds failed:', oddsResult);
        // Continue anyway — detect-rlm can still run on existing data
      }
    } catch (err: any) {
      console.error('fetch-odds error:', err.message);
      oddsResult = { error: err.message };
    }

    // ── Step 2: Run HSA detection on fresh data ───────────────────
    let hsaResult: any = null;
    try {
      const hsaRes = await fetch(`${supabaseUrl}/functions/v1/detect-rlm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ oddsWindowHours: 18 }),
      });
      hsaResult = await hsaRes.json();
      if (!hsaRes.ok) {
        console.error('detect-rlm failed:', hsaResult);
      }
    } catch (err: any) {
      console.error('detect-rlm error:', err.message);
      hsaResult = { error: err.message };
    }

    const elapsed = Date.now() - started;

    return res.status(200).json({
      ok: true,
      pipeline: 'fetch-odds → detect-rlm',
      elapsed_ms: elapsed,
      fetch_odds: oddsResult,
      detect_rlm: hsaResult,
    });
  } catch (err: any) {
    console.error('HSA pipeline error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
