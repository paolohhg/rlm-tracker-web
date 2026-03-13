import { useState, useCallback } from 'react';

interface GenerateParams {
  league: string;
  home_team: string;
  away_team: string;
  game_time: string;
}

interface HsaResult {
  narrative: string;
  cached: boolean;
  snapshot_count?: number;
  tracking_hours?: number;
  signal_action?: string;
  bet_team?: string;
  bet_spread?: string;
  totals_open?: number;
  totals_current?: number;
  totals_move?: number;
}

export function useGenerateHsa(onSuccess?: () => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (params: GenerateParams): Promise<HsaResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/generate-hsa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to generate HSA');
          return null;
        }
        onSuccess?.();
        return data;
      } catch (err: any) {
        setError(err.message || 'Network error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  return { generate, loading, error };
}
