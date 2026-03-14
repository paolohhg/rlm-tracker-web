import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

function calcNetUnits(row: {
  h1_units: number;
  h1_result: string;
  h2_triggered: boolean;
  h2_units: number | null;
  h2_result: string | null;
  cycle_result: string;
}): number | null {
  if (row.cycle_result === 'pending') return null;
  if (row.cycle_result === 'push') return 0;
  if (row.h1_result === 'win') return row.h1_units; // won 1H straight
  if (row.h1_result === 'push') return 0;
  if (row.h2_triggered && row.h2_units) {
    if (row.h2_result === 'win') return row.h2_units - row.h1_units; // recovered
    if (row.h2_result === 'loss') return -(row.h1_units + row.h2_units); // full loss
    if (row.h2_result === 'push') return -row.h1_units; // lost 1H, pushed 2H
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── GET — list cycles ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('hm_cycles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cycles: data });
  }

  // ── POST — create cycle ────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      game_id, league, away_team, home_team, game_date, game_time,
      signal_tier, sharp_side, sharp_spread, h1_units = 1, notes,
    } = req.body || {};

    if (!game_id || !league || !away_team || !home_team || !game_date || !sharp_side || !sharp_spread) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('hm_cycles')
      .insert({
        game_id, league, away_team, home_team, game_date, game_time,
        signal_tier, sharp_side, sharp_spread,
        h1_units, h1_result: 'pending',
        h2_triggered: false, h2_result: 'n/a',
        cycle_result: 'pending', notes,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ cycle: data });
  }

  // ── PATCH — update cycle ───────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, h1_result, h1_score, h2_result, h2_score, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Fetch current row
    const { data: existing, error: fetchErr } = await supabase
      .from('hm_cycles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) return res.status(404).json({ error: 'Cycle not found' });

    const updates: Record<string, unknown> = {};

    // Apply 1H result
    if (h1_result) {
      updates.h1_result = h1_result;
      if (h1_score) updates.h1_score = h1_score;

      if (h1_result === 'win' || h1_result === 'push') {
        updates.cycle_result = h1_result === 'win' ? 'win' : 'push';
        updates.h2_triggered = false;
        updates.h2_result = 'n/a';
      } else if (h1_result === 'loss') {
        // Trigger 2H martingale
        updates.h2_triggered = true;
        updates.h2_units = existing.h1_units * 2;
        updates.h2_result = 'pending';
        updates.cycle_result = 'pending';
      }
    }

    // Apply 2H result (only if 2H was triggered)
    if (h2_result && existing.h2_triggered) {
      updates.h2_result = h2_result;
      if (h2_score) updates.h2_score = h2_score;
      if (h2_result === 'win') updates.cycle_result = 'win';
      else if (h2_result === 'loss') updates.cycle_result = 'loss';
      else if (h2_result === 'push') updates.cycle_result = 'push';
    }

    if (notes !== undefined) updates.notes = notes;

    // Compute net_units
    const merged = { ...existing, ...updates };
    updates.net_units = calcNetUnits({
      h1_units: merged.h1_units,
      h1_result: merged.h1_result,
      h2_triggered: merged.h2_triggered,
      h2_units: merged.h2_units,
      h2_result: merged.h2_result,
      cycle_result: merged.cycle_result,
    });

    const { data, error } = await supabase
      .from('hm_cycles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cycle: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
