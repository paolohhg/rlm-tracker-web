// Invokes the Supabase fetch-odds edge function on a cron schedule.
// Runs every 15 min via Vercel cron (see vercel.json)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }

  // Retry edge function call up to 3 times with exponential backoff
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/fetch-odds`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        return res.status(200).json({
          ok: true,
          source: 'vercel-cron → supabase/fetch-odds',
          attempt: attempt + 1,
          ...data,
        });
      }

      // 4xx = don't retry (client error)
      if (response.status >= 400 && response.status < 500) {
        console.error(`fetch-odds edge function error (${response.status}):`, data);
        return res.status(response.status).json({ error: 'Edge function error', detail: data });
      }

      // 5xx = retry
      lastError = `HTTP ${response.status}: ${JSON.stringify(data)}`;
      console.error(`[fetch-odds] Attempt ${attempt + 1} failed: ${lastError}`);
    } catch (err: any) {
      lastError = err.message || 'Network error';
      console.error(`[fetch-odds] Attempt ${attempt + 1} network error: ${lastError}`);
    }

    if (attempt < 2) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return res.status(502).json({
    error: 'Edge function failed after 3 attempts',
    detail: lastError,
  });
}
