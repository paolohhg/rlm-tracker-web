import type { GameView } from '../types';

interface Props {
  games: GameView[];
}

export function StatStrip({ games }: Props) {
  const tracked = games.length;
  const active = games.filter(g => g.signalTier && !['TRACKING', 'WATCH'].includes(g.signalTier ?? '')).length;
  const locked = games.filter(g => g.isLocked).length;

  const tierRank: Record<string, number> = {
    'DOUBLE NO-NARRATIVE RLM': 6,
    'NO-NARRATIVE RLM': 5,
    'STEAM MOVE': 4,
    'FROZEN LINE': 3,
    'BOOK SHADE': 2,
    'CONTRA MOVE': 1,
  };
  const strongest = games.reduce((best, g) => {
    const rank = tierRank[g.signalTier ?? ''] ?? 0;
    const bestRank = tierRank[best ?? ''] ?? 0;
    return rank > bestRank ? g.signalTier : best;
  }, null as string | null);

  const stats = [
    { label: 'GAMES', value: tracked, color: '#94a3b8' },
    { label: 'SIGNALS', value: active, color: active > 0 ? '#ff6b35' : '#475569' },
    { label: 'TOP SIGNAL', value: strongest ? strongest.split(' ').slice(-1)[0] : '—', color: strongest ? '#f0c040' : '#475569' },
    { label: 'LOCKED', value: locked, color: locked > 0 ? '#60c8ff' : '#475569' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: '1px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {stats.map((s, i) => (
        <div key={i} style={{
          flex: 1,
          padding: '10px 16px',
          background: 'rgba(0,0,0,0.2)',
          textAlign: 'center',
          borderRight: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
        }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: s.color, fontFamily: '"DM Mono", monospace', letterSpacing: '-0.02em' }}>
            {s.value}
          </div>
          <div style={{ fontSize: '9px', color: '#334155', letterSpacing: '0.1em', marginTop: '2px' }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
