import { useState, useMemo } from 'react';
import { useGamesFeed } from '../hooks/useGamesFeed';
import { GameCard } from './GameCard';
import { FilterBar } from './FilterBar';
import { StatStrip } from './StatStrip';
import type { FilterState, GameView } from '../types';

const TIER_RANK: Record<string, number> = {
  'DOUBLE NO-NARRATIVE RLM': 7,
  'NO-NARRATIVE RLM': 6,
  'STEAM MOVE': 5,
  'FROZEN LINE': 4,
  'BOOK SHADE': 3,
  'CONTRA MOVE': 2,
  'WATCH': 1,
  'TRACKING': 0,
};

function passesFilters(game: GameView, f: FilterState): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!game.homeTeam.toLowerCase().includes(q) && !game.awayTeam.toLowerCase().includes(q)) return false;
  }
  if (f.league !== 'all' && game.league !== f.league) return false;
  if (f.signal !== 'all') {
    const tier = game.signalTier ?? 'TRACKING';
    if (f.signal === 'rlm' && !tier.includes('RLM')) return false;
    if (f.signal === 'steam' && tier !== 'STEAM MOVE') return false;
    if (f.signal === 'frozen' && tier !== 'FROZEN LINE') return false;
    if (f.signal === 'no_narrative' && game.hsaStatus !== 'no_narrative') return false;
    if (f.signal === 'strong' && (TIER_RANK[tier] ?? 0) < 4) return false;
    if (f.signal === 'tracking' && tier !== 'TRACKING') return false;
  }
  const min = game.timeToTipMinutes;
  if (f.timeBucket !== 'all') {
    if (f.timeBucket === 'live' && game.status !== 'live') return false;
    if (f.timeBucket === 'final' && game.status !== 'final') return false;
    if (f.timeBucket === 'lt30' && (game.status !== 'upcoming' || min >= 30)) return false;
    if (f.timeBucket === '30to60' && (game.status !== 'upcoming' || min < 30 || min > 60)) return false;
    if (f.timeBucket === '1to3h' && (game.status !== 'upcoming' || min < 60 || min > 180)) return false;
    if (f.timeBucket === 'gt3h' && (game.status !== 'upcoming' || min <= 180)) return false;
  }
  if (f.actionableOnly && game.status === 'upcoming' && min > 90) return false;
  return true;
}

function sortGames(games: GameView[], sort: FilterState['sort']): GameView[] {
  return [...games].sort((a, b) => {
    if (sort === 'signal') {
      const ra = TIER_RANK[a.signalTier ?? 'TRACKING'] ?? 0;
      const rb = TIER_RANK[b.signalTier ?? 'TRACKING'] ?? 0;
      if (ra !== rb) return rb - ra;
      return a.timeToTipMinutes - b.timeToTipMinutes;
    }
    if (sort === 'soonest') return a.timeToTipMinutes - b.timeToTipMinutes;
    if (sort === 'updated') return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
    return 0;
  });
}

type Tab = 'upcoming' | 'live' | 'final';

function SkeletonCard() {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px', height: '120px', animation: 'pulse 1.5s ease-in-out infinite' }} />
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { icon: string; text: string }> = {
    upcoming: { icon: '📡', text: 'No upcoming games match your filters.' },
    live: { icon: '🔴', text: 'No live games right now.' },
    final: { icon: '✓', text: 'No final games to show.' },
  };
  const { icon, text } = messages[tab];
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#334155' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>{icon}</div>
      <div style={{ fontSize: '13px', letterSpacing: '0.05em', fontFamily: 'monospace' }}>{text}</div>
    </div>
  );
}

export function Dashboard() {
  const { games, loading, lastUpdated, refresh } = useGamesFeed();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [filters, setFilters] = useState<FilterState>({
    search: '', league: 'all', signal: 'all', timeBucket: 'all', actionableOnly: false, sort: 'signal',
  });

  const tabGames = useMemo(() => games.filter(g => g.status === tab), [games, tab]);
  const filtered = useMemo(() => sortGames(tabGames.filter(g => passesFilters(g, filters)), filters.sort), [tabGames, filters]);

  const tabCounts = useMemo(() => ({
    upcoming: games.filter(g => g.status === 'upcoming').length,
    live: games.filter(g => g.status === 'live').length,
    final: games.filter(g => g.status === 'final').length,
  }), [games]);

  const tabBtn = (t: Tab, accent?: string) => ({
    padding: '8px 18px',
    borderRadius: '0',
    border: 'none',
    borderBottom: tab === t ? `2px solid ${accent ?? '#ff6b35'}` : '2px solid transparent',
    background: 'transparent',
    color: tab === t ? (accent ?? '#ff6b35') : '#475569',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.08em',
    fontFamily: '"DM Mono", monospace',
    transition: 'color 0.15s',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', color: '#e2e8f0', fontFamily: '"DM Mono", ui-monospace, monospace' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        input::placeholder { color: #334155; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
      `}</style>

      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>RLM TRACKER</h1>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#ff6b35', background: 'rgba(255,107,53,0.1)', border: '1px solid rgba(255,107,53,0.2)', padding: '1px 6px', borderRadius: '3px', letterSpacing: '0.08em' }}>v2</span>
          </div>
          <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px', letterSpacing: '0.04em' }}>Market movement intelligence · NBA + NCAAB</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {lastUpdated && (
            <span style={{ fontSize: '10px', color: '#334155', fontFamily: 'monospace' }}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={refresh} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 24px' }}>
        <StatStrip games={games} />
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 24px', gap: '4px' }}>
        <button style={tabBtn('upcoming')} onClick={() => setTab('upcoming')}>
          UPCOMING {tabCounts.upcoming > 0 && <span style={{ opacity: 0.6 }}>({tabCounts.upcoming})</span>}
        </button>
        <button style={tabBtn('live', '#22c55e')} onClick={() => setTab('live')}>
          {tabCounts.live > 0 && <span style={{ color: '#22c55e' }}>● </span>}LIVE {tabCounts.live > 0 && <span style={{ opacity: 0.6 }}>({tabCounts.live})</span>}
        </button>
        <button style={tabBtn('final', '#475569')} onClick={() => setTab('final')}>
          FINAL {tabCounts.final > 0 && <span style={{ opacity: 0.6 }}>({tabCounts.final})</span>}
        </button>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      <div style={{ padding: '16px 24px', maxWidth: '1200px' }}>
        {loading ? (
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {filtered.map(game => <GameCard key={game.id} game={game} />)}
          </div>
        )}
      </div>
    </div>
  );
}
