import { useState } from 'react';
import type { StoredGame } from '../../lib/heard2h/types';

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

function resultColor(r: string): string {
  switch (r) {
    case 'W': return '#16a34a';
    case 'L': return '#dc2626';
    case 'P': return '#64748b';
    default: return '#d97706';
  }
}

function verdictColor(v: string): string {
  switch (v) {
    case 'strong_play': return '#22c55e';
    case 'play': return '#3b82f6';
    case 'lean': return '#d97706';
    default: return '#64748b';
  }
}

interface Props {
  games: StoredGame[];
  loading: boolean;
  onUpdate: (params: { id: string; sh_home_final?: number; sh_away_final?: number; game_result?: string }) => Promise<any>;
}

export function GameLog({ games, loading, onUpdate }: Props) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [resultVal, setResultVal] = useState<'W' | 'L' | 'P'>('W');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');

  const handleSave = async (id: string) => {
    await onUpdate({
      id,
      game_result: resultVal,
      ...(homeScore ? { sh_home_final: Number(homeScore) } : {}),
      ...(awayScore ? { sh_away_final: Number(awayScore) } : {}),
    });
    setUpdating(null);
    setHomeScore('');
    setAwayScore('');
  };

  if (loading) {
    return <div style={{ color: '#94a3b8', fontWeight: 800, padding: '20px' }}>Loading game log...</div>;
  }

  if (games.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontWeight: 800, textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
        <div>No games logged yet.</div>
        <div style={{ fontSize: '13px', marginTop: '8px', color: '#475569' }}>Analyze a game and click "Save to Game Log".</div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: '#020617', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0', borderRadius: '6px', padding: '5px 8px',
    fontWeight: 700, fontFamily: FONT, fontSize: '12px', width: '60px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {games.map(g => {
        const edge = g.result.tempo?.edge;
        const totVerdict = g.result.mip.totals.verdict;
        const sideVerdict = g.result.mip.sides.verdict;

        return (
          <div key={g.id} style={{
            background: '#111827', borderRadius: '12px',
            border: `1px solid ${g.game_result ? resultColor(g.game_result) + '33' : 'rgba(255,255,255,0.08)'}`,
            padding: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div>
                <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '14px', fontFamily: FONT }}>
                  {g.input.away_team} @ {g.input.home_team}
                </div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 700, marginTop: '2px' }}>
                  {g.input.sport.toUpperCase()} &bull; {g.input.date}
                </div>
              </div>
              {g.game_result ? (
                <span style={{
                  background: resultColor(g.game_result), color: '#fff',
                  fontSize: '11px', fontWeight: 900, padding: '4px 10px',
                  borderRadius: '999px', fontFamily: FONT,
                }}>
                  {g.game_result}
                </span>
              ) : (
                <span style={{
                  background: '#d97706', color: '#fff',
                  fontSize: '11px', fontWeight: 900, padding: '4px 10px',
                  borderRadius: '999px', fontFamily: FONT,
                }}>
                  PENDING
                </span>
              )}
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ background: '#020617', borderRadius: '8px', padding: '6px 10px' }}>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 800, fontFamily: FONT }}>TOTALS</div>
                <div style={{ color: verdictColor(totVerdict), fontWeight: 900, fontSize: '13px', fontFamily: FONT }}>
                  {g.result.mip.totals.score}/8
                </div>
              </div>
              <div style={{ background: '#020617', borderRadius: '8px', padding: '6px 10px' }}>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 800, fontFamily: FONT }}>SIDES</div>
                <div style={{ color: verdictColor(sideVerdict), fontWeight: 900, fontSize: '13px', fontFamily: FONT }}>
                  {g.result.mip.sides.score}/8
                </div>
              </div>
              {edge != null && (
                <div style={{ background: '#020617', borderRadius: '8px', padding: '6px 10px' }}>
                  <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 800, fontFamily: FONT }}>EDGE</div>
                  <div style={{ color: edge >= 2 ? '#22c55e' : edge <= -2 ? '#ef4444' : '#94a3b8', fontWeight: 900, fontSize: '13px', fontFamily: FONT }}>
                    {edge >= 0 ? '+' : ''}{edge.toFixed(1)}
                  </div>
                </div>
              )}
              {g.bet_side && (
                <div style={{ background: '#020617', borderRadius: '8px', padding: '6px 10px' }}>
                  <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 800, fontFamily: FONT }}>BET</div>
                  <div style={{ color: '#a78bfa', fontWeight: 900, fontSize: '13px', fontFamily: FONT }}>
                    {g.bet_side.replace('_', ' ').toUpperCase()}
                  </div>
                </div>
              )}
            </div>

            {/* Update result */}
            {!g.game_result && (
              <>
                {updating === g.id ? (
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {(['W', 'L', 'P'] as const).map(r => (
                      <button key={r} onClick={() => setResultVal(r)} style={{
                        background: resultVal === r ? resultColor(r) : 'transparent',
                        border: `1px solid ${resultColor(r)}`,
                        color: resultVal === r ? '#fff' : resultColor(r),
                        borderRadius: '6px', padding: '5px 12px', cursor: 'pointer',
                        fontWeight: 800, fontSize: '11px', fontFamily: FONT,
                      }}>
                        {r}
                      </button>
                    ))}
                    <input style={inputStyle} type="number" placeholder="Home" value={homeScore} onChange={e => setHomeScore(e.target.value)} />
                    <input style={inputStyle} type="number" placeholder="Away" value={awayScore} onChange={e => setAwayScore(e.target.value)} />
                    <button onClick={() => handleSave(g.id)} style={{
                      background: '#2563eb', border: 'none', color: '#fff',
                      borderRadius: '6px', padding: '5px 12px', cursor: 'pointer',
                      fontWeight: 800, fontSize: '11px', fontFamily: FONT,
                    }}>
                      Save
                    </button>
                    <button onClick={() => setUpdating(null)} style={{
                      background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                      borderRadius: '6px', padding: '5px 12px', cursor: 'pointer',
                      fontWeight: 800, fontSize: '11px', fontFamily: FONT,
                    }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setUpdating(g.id)} style={{
                    marginTop: '10px', background: '#1d4ed8', border: 'none', color: '#fff',
                    borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
                    fontWeight: 900, fontSize: '12px', fontFamily: FONT,
                  }}>
                    Update Result
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
