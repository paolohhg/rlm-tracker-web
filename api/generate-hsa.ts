import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { summarizeOdds } from './lib/odds-summarizer';
import { buildHsaPrompt } from './lib/hsa-prompt';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { league, home_team, away_team, game_time } = req.body || {};

  if (!league || !home_team || !away_team || !game_time) {
    return res.status(400).json({
      error: 'Missing required fields: league, home_team, away_team, game_time',
    });
  }

  try {
    // Check cache: return existing analysis if < 2h old
    const { data: existing } = await supabase
      .from('claude_analyses')
      .select('*')
      .eq('league', league)
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing?.length) {
      const age = Date.now() - new Date(existing[0].created_at).getTime();
      const twoHours = 2 * 60 * 60 * 1000;
      if (age < twoHours && existing[0].analysis) {
        return res.status(200).json({
          narrative: existing[0].analysis,
          cached: true,
          created_at: existing[0].created_at,
        });
      }
    }

    // Fetch all odds snapshots for this game
    const { data: odds, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('home_team', home_team)
      .eq('away_team', away_team)
      .order('fetched_at', { ascending: true });

    if (oddsError) {
      return res.status(500).json({ error: 'Failed to fetch odds', detail: oddsError.message });
    }

    if (!odds?.length) {
      return res.status(404).json({ error: 'No odds data found for this game' });
    }

    // Preprocess odds into structured summary
    const summary = summarizeOdds(odds, game_time);

    // Build prompt and call Claude
    const prompt = buildHsaPrompt(league, away_team, home_team, game_time, summary);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const narrative =
      response.content[0].type === 'text' ? response.content[0].text : '';

    if (!narrative) {
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

    // Store in claude_analyses
    const { error: insertError } = await supabase.from('claude_analyses').insert({
      league,
      home_team,
      away_team,
      game_id: `${league}|${home_team}|${away_team}`,
      analysis: narrative,
    });

    if (insertError) {
      // If insert fails (maybe duplicate), try update
      console.error('Insert error:', insertError.message);
    }

    return res.status(200).json({
      narrative,
      cached: false,
      snapshot_count: summary.snapshotCount,
      tracking_hours: summary.trackingHours,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
    });
  } catch (err: any) {
    console.error('HSA generation error:', err);
    return res.status(500).json({
      error: 'Failed to generate HSA',
      detail: err.message,
    });
  }
}
