// Invokes the Supabase detect-rlm edge function on a cron schedule.
// Runs every 15 min via Vercel cron (see vercel.json), after fetch-odds.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    // Call the Supabase edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/detect-rlm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Use default slate (next 24h pregame games)
        oddsWindowHours: 18,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('detect-rlm edge function error:', data);
      return res.status(response.status).json({ error: 'Edge function error', detail: data });
    }

    return res.status(200).json({
      ok: true,
      source: 'vercel-cron → supabase/detect-rlm',
      ...data,
    });
  } catch (err: any) {
    console.error('detect-rlm cron error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
