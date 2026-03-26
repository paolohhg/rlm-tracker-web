// Purge old odds_snapshots rows by age threshold.
// Runs daily at 6 AM UTC via Vercel cron.
//
// IMPORTANT: Does NOT query oldest row first (that times out on large tables).
// Deletes directly by fetched_at < cutoff in batches.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const RETENTION_DAYS = 7;
const BATCH_HOURS = 1; // Delete one hour of data at a time
const MAX_BATCHES = 168; // 7 days * 24 hours = 168 batches max

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  let batches = 0;
  let lastError: string | null = null;

  try {
    // Delete in 1-hour windows working backward from cutoff.
    // Each window is small enough to not timeout.
    // We start from (cutoff - MAX_BATCHES*hours) and work forward to cutoff.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const windowEnd = new Date(cutoff.getTime() - i * BATCH_HOURS * 60 * 60 * 1000);
      const windowStart = new Date(windowEnd.getTime() - BATCH_HOURS * 60 * 60 * 1000);

      const { count, error: delError } = await supabase
        .from('odds_snapshots')
        .delete({ count: 'exact' })
        .gte('fetched_at', windowStart.toISOString())
        .lt('fetched_at', windowEnd.toISOString());

      if (delError) {
        lastError = delError.message;
        console.error(`[purge] Batch ${i + 1} error: ${lastError}`);
        continue; // Try next window
      }

      const deleted = count ?? 0;
      totalDeleted += deleted;
      batches++;

      if (deleted > 0) {
        console.log(`[purge] Batch ${i + 1}: deleted ${deleted} rows (${windowStart.toISOString()} to ${windowEnd.toISOString()})`);
      }
    }

    // Also clean up old latest_odds for games that have finished (>24h past game_time)
    let latestCleaned = 0;
    try {
      const oldGameCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('latest_odds')
        .delete({ count: 'exact' })
        .lt('game_time', oldGameCutoff);
      latestCleaned = count ?? 0;
    } catch { /* non-critical */ }

    return res.status(200).json({
      ok: true,
      deleted: totalDeleted,
      batches,
      retention_days: RETENTION_DAYS,
      latest_odds_cleaned: latestCleaned,
      ...(lastError ? { last_error: lastError } : {}),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message, deleted: totalDeleted, batches });
  }
}
