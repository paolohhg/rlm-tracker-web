// Daily cron: deletes odds_snapshots older than 7 days in batches.
// HSA only looks back 24h; fetch-odds "seen" check looks back 7 days.
// Keeps the table small so queries never timeout.
//
// Also callable manually via browser/curl to do an immediate cleanup.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const RETENTION_DAYS = 7;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;
  let batches = 0;
  let lastError: string | null = null;

  try {
    // Delete in 1-hour windows starting from the oldest data,
    // working forward until we reach the retention cutoff.
    // Each window is small enough to avoid statement timeout.

    // First, find the oldest row's timestamp
    const { data: oldest, error: oldestErr } = await supabase
      .from('odds_snapshots')
      .select('fetched_at')
      .order('fetched_at', { ascending: true })
      .limit(1);

    if (oldestErr) {
      return res.status(500).json({ error: 'Failed to query oldest row', detail: oldestErr.message });
    }

    if (!oldest?.length) {
      return res.status(200).json({ ok: true, deleted: 0, message: 'Table is empty' });
    }

    const oldestTime = new Date(oldest[0].fetched_at).getTime();
    const cutoffTime = new Date(cutoff).getTime();

    if (oldestTime >= cutoffTime) {
      return res.status(200).json({ ok: true, deleted: 0, message: 'No rows older than retention period' });
    }

    // Delete in 1-hour windows (small enough to not timeout)
    const ONE_HOUR = 60 * 60 * 1000;
    const MAX_WINDOWS = 100; // Safety cap per invocation
    let windowStart = oldestTime;

    for (let i = 0; i < MAX_WINDOWS && windowStart < cutoffTime; i++) {
      const windowEnd = Math.min(windowStart + ONE_HOUR, cutoffTime);
      const startISO = new Date(windowStart).toISOString();
      const endISO = new Date(windowEnd).toISOString();

      const { count, error: delError } = await supabase
        .from('odds_snapshots')
        .delete({ count: 'exact' })
        .gte('fetched_at', startISO)
        .lt('fetched_at', endISO);

      if (delError) {
        lastError = delError.message;
        console.error(`[purge] Window ${i + 1} error (${startISO} to ${endISO}): ${lastError}`);
        // Try a smaller window (15 min) on error
        const FIFTEEN_MIN = 15 * 60 * 1000;
        let subStart = windowStart;
        for (let j = 0; j < 4 && subStart < windowEnd; j++) {
          const subEnd = Math.min(subStart + FIFTEEN_MIN, windowEnd);
          const { count: subCount, error: subErr } = await supabase
            .from('odds_snapshots')
            .delete({ count: 'exact' })
            .gte('fetched_at', new Date(subStart).toISOString())
            .lt('fetched_at', new Date(subEnd).toISOString());

          if (subErr) {
            lastError = subErr.message;
            console.error(`[purge] Sub-window error: ${lastError}`);
          } else {
            totalDeleted += subCount ?? 0;
          }
          subStart = subEnd;
        }
        batches++;
        windowStart = windowEnd;
        continue;
      }

      const deleted = count ?? 0;
      totalDeleted += deleted;
      batches++;
      if (deleted > 0) {
        console.log(`[purge] Window ${i + 1}: deleted ${deleted} rows (${startISO} to ${endISO})`);
      }
      windowStart = windowEnd;
    }

    const moreRemaining = windowStart < cutoffTime;
    console.log(`[purge] Done: ${totalDeleted} rows deleted in ${batches} windows`);
    return res.status(200).json({
      ok: true,
      deleted: totalDeleted,
      batches,
      retention_days: RETENTION_DAYS,
      ...(moreRemaining ? { message: 'More rows remain — refresh to continue' } : {}),
      ...(lastError ? { last_error: lastError } : {}),
    });
  } catch (err: any) {
    console.error('[purge] Error:', err.message);
    return res.status(500).json({ error: err.message, deleted: totalDeleted, batches });
  }
}
