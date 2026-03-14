import { useState, useCallback, useEffect } from 'react';

export interface HMCycle {
  id: string;
  game_id: string;
  league: string;
  away_team: string;
  home_team: string;
  game_date: string;
  game_time: string | null;
  signal_tier: string | null;
  sharp_side: string;
  sharp_spread: string;
  h1_units: number;
  h1_result: 'win' | 'loss' | 'push' | 'pending';
  h1_score: string | null;
  h2_triggered: boolean;
  h2_units: number | null;
  h2_result: 'win' | 'loss' | 'push' | 'pending' | 'n/a';
  h2_score: string | null;
  cycle_result: 'win' | 'loss' | 'push' | 'pending';
  net_units: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CycleSummary {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  netUnits: number;
  winRate: number;
}

export function useHMCycles() {
  const [cycles, setCycles] = useState<HMCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCycles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hm-cycles');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load cycles');
      setCycles(data.cycles || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCycles();
  }, [fetchCycles]);

  const logCycle = useCallback(async (params: {
    game_id: string;
    league: string;
    away_team: string;
    home_team: string;
    game_date: string;
    game_time?: string;
    signal_tier?: string;
    sharp_side: string;
    sharp_spread: string;
    h1_units?: number;
    notes?: string;
  }) => {
    setError(null);
    const res = await fetch('/api/hm-cycles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log cycle');
    await fetchCycles();
    return data.cycle as HMCycle;
  }, [fetchCycles]);

  const updateCycle = useCallback(async (params: {
    id: string;
    h1_result?: 'win' | 'loss' | 'push';
    h1_score?: string;
    h2_result?: 'win' | 'loss' | 'push';
    h2_score?: string;
    notes?: string;
  }) => {
    setError(null);
    const res = await fetch('/api/hm-cycles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update cycle');
    await fetchCycles();
    return data.cycle as HMCycle;
  }, [fetchCycles]);

  const summary: CycleSummary = cycles.reduce(
    (acc, c) => {
      if (c.cycle_result === 'win') acc.wins++;
      else if (c.cycle_result === 'loss') acc.losses++;
      else if (c.cycle_result === 'push') acc.pushes++;
      else acc.pending++;
      if (c.net_units !== null) acc.netUnits += c.net_units;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0, pending: 0, netUnits: 0, winRate: 0 }
  );
  const decided = summary.wins + summary.losses;
  summary.winRate = decided > 0 ? Math.round((summary.wins / decided) * 100) : 0;

  return { cycles, loading, error, fetchCycles, logCycle, updateCycle, summary };
}
