// Daily cron: deletes odds_snapshots older than 7 days in batches.
// HSA only looks back 24h; fetch-odds "seen" check looks back 7 days.
// Keeps the table small so queries never timeout.
//
// Also callable manually: POST /api/purge-old-snapshots
// to do an immediate cleanup (e.g. after table has grown too large).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 5000; // Small batches to stay within PostgREST statement timeout
const MAX_BATCHES = 200; // Up to 1M rows per invocation
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
    for (let i = 0; i < MAX_BATCHES; i++) {
      // Step 1: Select IDs of oldest rows to delete
      const { data: rows, error: selectError } = await supabase
        .from('odds_snapshots')
        .select('id')
        .lt('fetched_at', cutoff)
        .order('fetched_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (selectError) {
        lastError = selectError.message;
        console.error(`[purge] Select batch ${i + 1} error: ${lastError}`);
        break;
      }

      if (!rows || rows.length === 0) break; // Done

      // Step 2: Delete those specific IDs
      const ids = rows.map((r: any) => r.id);
      const { error: delError } = await supabase
        .from('odds_snapshots')
        .delete()
        .in('id', ids);

      if (delError) {
        lastError = delError.message;
        console.error(`[purge] Delete batch ${i + 1} error: ${lastError}`);
        break;
      }

      totalDeleted += ids.length;
      batches++;
      console.log(`[purge] Batch ${i + 1}: deleted ${ids.length} rows (total: ${totalDeleted})`);

      if (ids.length < BATCH_SIZE) break; // No more rows
    }

    console.log(`[purge] Done: ${totalDeleted} rows deleted in ${batches} batches`);
    return res.status(200).json({
      ok: true,
      deleted: totalDeleted,
      batches,
      retention_days: RETENTION_DAYS,
      ...(lastError ? { last_error: lastError } : {}),
    });
  } catch (err: any) {
    console.error('[purge] Error:', err.message);
    return res.status(500).json({ error: err.message, deleted: totalDeleted, batches });
  }
}
