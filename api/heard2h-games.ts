import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── GET — list games ───────────────────────────────────────────
  if (req.method === 'GET') {
    const { sport, result: gameResult } = req.query;

    let query = supabase
      .from('heard2h_games')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (sport && typeof sport === 'string') query = query.eq('sport', sport);
    if (gameResult && typeof gameResult === 'string') query = query.eq('game_result', gameResult);

    const { data, error } = await query;
    if (error) {
      console.error('[heard2h-games GET]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ games: data });
  }

  // ── POST — save game + analysis ────────────────────────────────
  if (req.method === 'POST') {
    const { input, result, bet_side } = req.body || {};
    if (!input || !result) {
      return res.status(400).json({ error: 'Missing input or result' });
    }

    const row = {
      game_id: input.game_id,
      date: input.date,
      sport: input.sport,
      home_team: input.home_team,
      away_team: input.away_team,
      input,
      result,
      bet_side: bet_side || '',
      mip_totals_score: result.mip?.totals?.score ?? null,
      mip_sides_score: result.mip?.sides?.score ?? null,
      mip_totals_verdict: result.mip?.totals?.verdict ?? null,
      mip_sides_verdict: result.mip?.sides?.verdict ?? null,
      edge: result.tempo?.edge ?? null,
      edge_verdict: result.tempo?.verdict ?? null,
      game_result: '',
    };

    const { data, error } = await supabase
      .from('heard2h_games')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('[heard2h-games POST]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ game: data });
  }

  // ── PATCH — update result ──────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, sh_home_final, sh_away_final, game_result } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (sh_home_final != null) updates.sh_home_final = sh_home_final;
    if (sh_away_final != null) updates.sh_away_final = sh_away_final;
    if (game_result) updates.game_result = game_result;

    const { data, error } = await supabase
      .from('heard2h_games')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[heard2h-games PATCH]', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ game: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
