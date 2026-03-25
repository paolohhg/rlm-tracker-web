// Daily cron: deletes odds_snapshots older than 7 days in batches.
// HSA only looks back 24h; fetch-odds "seen" check looks back 7 days.
// Keeps the table small so queries never timeout.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 50000;
const MAX_BATCHES = 20; // Safety cap: 1M rows max per cron run
const RETENTION_DAYS = 7;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let totalDeleted = 0;
  let batches = 0;

  try {
    // Delete in batches to avoid statement timeout
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await supabase.rpc('purge_old_snapshots', {
        retention_days: RETENTION_DAYS,
        batch_size: BATCH_SIZE,
      });

      if (error) {
        // If the RPC doesn't exist, fall back to direct delete
        if (error.message.includes('purge_old_snapshots')) {
          const { count, error: delError } = await supabase
            .from('odds_snapshots')
            .delete({ count: 'exact' })
            .lt('fetched_at', new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString())
            .order('fetched_at', { ascending: true })
            .limit(BATCH_SIZE);

          if (delError) {
            console.error(`[purge] Batch ${i + 1} error:`, delError.message);
            break;
          }

          const deleted = count ?? 0;
          totalDeleted += deleted;
          batches++;
          console.log(`[purge] Batch ${i + 1}: deleted ${deleted} rows`);
          if (deleted < BATCH_SIZE) break; // No more rows to delete
          continue;
        }

        console.error(`[purge] RPC error:`, error.message);
        break;
      }

      const deleted = typeof data === 'number' ? data : 0;
      totalDeleted += deleted;
      batches++;
      console.log(`[purge] Batch ${i + 1}: deleted ${deleted} rows`);
      if (deleted < BATCH_SIZE) break; // No more rows to delete
    }

    console.log(`[purge] Done: ${totalDeleted} rows deleted in ${batches} batches`);
    return res.status(200).json({
      ok: true,
      deleted: totalDeleted,
      batches,
      retention_days: RETENTION_DAYS,
    });
  } catch (err: any) {
    console.error('[purge] Error:', err.message);
    return res.status(500).json({ error: err.message, deleted: totalDeleted });
  }
}
