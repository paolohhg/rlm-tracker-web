// Invokes the Supabase fetch-odds edge function on a cron schedule.
// Runs every 15 min via Vercel cron (see vercel.json)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({ error: 'Missing Supabase credentials' });
    }

    // Call the Supabase edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/fetch-odds`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('fetch-odds edge function error:', data);
      return res.status(response.status).json({ error: 'Edge function error', detail: data });
    }

    return res.status(200).json({
      ok: true,
      source: 'vercel-cron → supabase/fetch-odds',
      ...data,
    });
  } catch (err: any) {
    console.error('fetch-odds cron error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
