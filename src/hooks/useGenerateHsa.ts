import { useState, useCallback } from 'react';

interface GenerateParams {
  league: string;
  home_team: string;
  away_team: string;
  game_time: string;
  force?: boolean;
  /** 'cache' = return cached if fresh. 'rerender' = same snapshot. 'refresh' = new odds. */
  mode?: 'cache' | 'rerender' | 'refresh';
}

interface HsaResult {
  narrative: string;
  cached: boolean;
  snapshot_id?: string;
  snapshot_count?: number;
  tracking_hours?: number;
  confidence?: string;
  status_tag?: string;
  market_lean?: string;
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
