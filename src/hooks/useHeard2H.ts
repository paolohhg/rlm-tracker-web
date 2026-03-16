import { useState, useCallback, useEffect } from 'react';
import type { StoredGame } from '../lib/heard2h/types';

export function useHeard2H() {
  const [games, setGames] = useState<StoredGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/heard2h-games');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load games');
      setGames((data.games || []).map((g: any) => ({
        id: g.id,
        input: g.input,
        result: g.result,
        bet_side: g.bet_side || '',
        sh_home_final: g.sh_home_final,
        sh_away_final: g.sh_away_final,
        game_result: g.game_result || '',
        created_at: g.created_at,
        updated_at: g.updated_at,
      })));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  const saveGame = useCallback(async (params: { input: any; result: any; bet_side?: string }) => {
    setError(null);
    const res = await fetch('/api/heard2h-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save game');
    await fetchGames();
    return data.game;
  }, [fetchGames]);

  const updateGame = useCallback(async (params: {
    id: string;
    sh_home_final?: number;
    sh_away_final?: number;
    game_result?: string;
  }) => {
    setError(null);
    const res = await fetch('/api/heard2h-games', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update game');
    await fetchGames();
    return data.game;
  }, [fetchGames]);

  return { games, loading, error, fetchGames, saveGame, updateGame };
}
