import type { AnalyticsResult, WinRateRow } from '../../lib/heard2h/types';

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

function WinRateTable({ title, rows }: { title: string; rows: WinRateRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
      <div style={{
        fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.08em',
        color: '#94a3b8', fontWeight: 800, fontFamily: FONT, marginBottom: '10px',
      }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['', 'Total', 'W', 'L', 'P', 'Win %'].map(h => (
              <th key={h} style={{
                color: '#64748b', fontSize: '9px', fontWeight: 800, fontFamily: FONT,
                textTransform: 'uppercase' as const, padding: '4px 8px', textAlign: h === '' ? 'left' : 'right',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 700, fontFamily: FONT, padding: '6px 8px' }}>{r.label}</td>
              <td style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 700, fontFamily: FONT, padding: '6px 8px', textAlign: 'right' }}>{r.total}</td>
              <td style={{ color: '#22c55e', fontSize: '12px', fontWeight: 700, fontFamily: FONT, padding: '6px 8px', textAlign: 'right' }}>{r.wins}</td>
              <td style={{ color: '#ef4444', fontSize: '12px', fontWeight: 700, fontFamily: FONT, padding: '6px 8px', textAlign: 'right' }}>{r.losses}</td>
              <td style={{ color: '#64748b', fontSize: '12px', fontWeight: 700, fontFamily: FONT, padding: '6px 8px', textAlign: 'right' }}>{r.pushes}</td>
              <td style={{
                color: r.win_rate >= 55 ? '#22c55e' : r.win_rate >= 45 ? '#f8fafc' : '#ef4444',
                fontSize: '13px', fontWeight: 900, fontFamily: FONT, padding: '6px 8px', textAlign: 'right',
              }}>
                {r.total > 0 ? `${r.win_rate}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Props {
  analytics: AnalyticsResult;
}

export function Analytics({ analytics }: Props) {
  if (analytics.decided_games < 5) {
    return (
      <div style={{ color: '#94a3b8', fontWeight: 800, textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '13px' }}>Need at least 5 decided games for analytics.</div>
        <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px' }}>
          {analytics.decided_games} of 5 decided so far ({analytics.total_games} total logged).
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '14px', fontFamily: FONT }}>
        {analytics.total_games} games logged &bull; {analytics.decided_games} decided
      </div>
      <WinRateTable title="By Mispricing Tier" rows={analytics.by_mip_tier} />
      <WinRateTable title="By Edge Band" rows={analytics.by_edge_band} />
      <WinRateTable title="By Sport" rows={analytics.by_sport} />
      <WinRateTable title="By Signal" rows={analytics.by_signal} />
    </div>
  );
}
