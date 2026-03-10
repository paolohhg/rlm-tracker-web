import type { FilterState } from '../types';

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}

const btn = (active: boolean, accent?: string) => ({
  padding: '4px 10px',
  borderRadius: '4px',
  border: active ? `1px solid ${accent ?? 'rgba(255,255,255,0.3)'}` : '1px solid rgba(255,255,255,0.06)',
  background: active ? (accent ? `${accent}18` : 'rgba(255,255,255,0.08)') : 'transparent',
  color: active ? (accent ?? '#e2e8f0') : '#475569',
  fontSize: '11px',
  fontWeight: active ? 700 : 500,
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'all 0.15s',
  fontFamily: '"DM Mono", monospace',
  whiteSpace: 'nowrap' as const,
});

export function FilterBar({ filters, onChange }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(12px)' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          value={filters.search}
          onChange={e => set({ search: e.target.value })}
          placeholder="Search teams…"
          style={{ flex: 1, maxWidth: '220px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '5px 10px', color: '#e2e8f0', fontSize: '12px', fontFamily: '"DM Mono", monospace', outline: 'none' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={filters.actionableOnly} onChange={e => set({ actionableOnly: e.target.checked })} style={{ accentColor: '#ff6b35' }} />
          <span style={{ fontSize: '11px', color: filters.actionableOnly ? '#ff6b35' : '#475569', fontFamily: 'monospace' }}>Actionable ≤90m</span>
        </label>
        <select
          value={filters.sort}
          onChange={e => set({ sort: e.target.value as FilterState['sort'] })}
          style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#94a3b8', fontSize: '11px', padding: '4px 8px', fontFamily: 'monospace', cursor: 'pointer' }}
        >
          <option value="signal">Strongest Signal</option>
          <option value="soonest">Soonest to Tip</option>
          <option value="updated">Latest Updated</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['all', 'NBA', 'NCAAB'] as const).map(l => (
            <button key={l} style={btn(filters.league === l)} onClick={() => set({ league: l })}>{l === 'all' ? 'ALL' : l}</button>
          ))}
        </div>
        <span style={{ color: '#1e293b', fontSize: '14px' }}>|</span>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {[
            { k: 'all', label: 'ALL SIGNALS' },
            { k: 'rlm', label: 'RLM', accent: '#ff6b35' },
            { k: 'steam', label: 'STEAM', accent: '#f0c040' },
            { k: 'frozen', label: 'FROZEN', accent: '#60c8ff' },
            { k: 'no_narrative', label: 'NO NARR', accent: '#22c55e' },
            { k: 'strong', label: 'STRONG', accent: '#ff2d2d' },
            { k: 'tracking', label: 'TRACKING' },
          ].map(({ k, label, accent }) => (
            <button key={k} style={btn(filters.signal === k, accent)} onClick={() => set({ signal: k as FilterState['signal'] })}>{label}</button>
          ))}
        </div>
        <span style={{ color: '#1e293b', fontSize: '14px' }}>|</span>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {[
            { k: 'all', label: 'ALL TIMES' },
            { k: 'lt30', label: '<30m', accent: '#ff4444' },
            { k: '30to60', label: '30-60m', accent: '#f59e0b' },
            { k: '1to3h', label: '1-3h' },
            { k: 'gt3h', label: '3h+' },
            { k: 'live', label: 'LIVE', accent: '#22c55e' },
            { k: 'final', label: 'FINAL' },
          ].map(({ k, label, accent }) => (
            <button key={k} style={btn(filters.timeBucket === k, accent)} onClick={() => set({ timeBucket: k as FilterState['timeBucket'] })}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
