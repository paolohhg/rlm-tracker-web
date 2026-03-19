import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type ScoreRow = {
  game_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  period: string | number | null;
};

export default function TickerBar() {
  const [games, setGames] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function fetchLiveGames() {
    const { data, error } = await supabase
      .from('game_scores')
      .select('game_id, sport, home_team, away_team, home_score, away_score, status, period')
      .eq('status', 'in_progress')
      .order('id', { ascending: false });

    if (error) {
      console.error('TickerBar error:', error);
      setGames([]);
      return;
    }

    setGames(data ?? []);
  }

  async function handleFetchScoresNow() {
    try {
      setLoading(true);
      setMessage('Refreshing scores...');

      await fetchLiveGames();
      setMessage('Scores updated');
    } catch (err) {
      console.error('Manual score fetch failed:', err);
      setMessage('Score fetch failed');
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(''), 2500);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function initialLoad() {
      if (!mounted) return;
      await fetchLiveGames();
    }

    initialLoad();
    const interval = setInterval(fetchLiveGames, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      style={{
        width: '100%',
        background: '#0f172a',
        color: '#e2e8f0',
        padding: '10px 16px',
        fontSize: '13px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <strong style={{ color: '#f8fafc' }}>LIVE</strong>

      <button
        onClick={handleFetchScoresNow}
        disabled={loading}
        style={{
          background: loading ? '#334155' : '#1d4ed8',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '12px',
          cursor: loading ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {loading ? 'Fetching...' : 'Fetch Scores Now'}
      </button>

      {message ? (
        <span style={{ color: '#93c5fd' }}>{message}</span>
      ) : null}

      {!games.length ? (
        <span>No live games right now</span>
      ) : (
        games.map((g) => (
          <span key={g.game_id} style={{ marginRight: 20 }}>
            {g.away_team} {g.away_score ?? 0} - {g.home_team} {g.home_score ?? 0}
            {g.period ? ` | P${g.period}` : ''}
          </span>
        ))
      )}
    </div>
  );
}