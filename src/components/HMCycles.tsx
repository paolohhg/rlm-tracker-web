import { useState } from 'react';
import { useHMCycles, type HMCycle } from '../hooks/useHMCycles';

function resultColor(result: string) {
  switch (result) {
    case 'win': return '#16a34a';
    case 'loss': return '#dc2626';
    case 'push': return '#64748b';
    case 'pending': return '#d97706';
    default: return '#475569';
  }
}

function resultLabel(result: string) {
  switch (result) {
    case 'win': return '✅ WIN';
    case 'loss': return '❌ LOSS';
    case 'push': return '➖ PUSH';
    case 'pending': return '⏳ PENDING';
    default: return result.toUpperCase();
  }
}

function cardLabel(text: string) {
  return (
    <div style={{
      fontSize: '10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      color: '#94a3b8',
      fontWeight: 800,
      fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
      marginBottom: '3px',
    }}>
      {text}
    </div>
  );
}

function UpdateModal({ cycle, onClose, onUpdate }: {
  cycle: HMCycle;
  onClose: () => void;
  onUpdate: (params: { id: string; h1_result?: 'win' | 'loss' | 'push'; h1_score?: string; h2_result?: 'win' | 'loss' | 'push'; h2_score?: string }) => Promise<void>;
}) {
  const [h1Result, setH1Result] = useState<'win' | 'loss' | 'push' | ''>(
    cycle.h1_result === 'pending' ? '' : cycle.h1_result as 'win' | 'loss' | 'push'
  );
  const [h1Score, setH1Score] = useState(cycle.h1_score || '');
  const [h2Result, setH2Result] = useState<'win' | 'loss' | 'push' | ''>(
    (!cycle.h2_result || cycle.h2_result === 'pending' || cycle.h2_result === 'n/a') ? '' : cycle.h2_result as 'win' | 'loss' | 'push'
  );
  const [h2Score, setH2Score] = useState(cycle.h2_score || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!h1Result) return;
    setSaving(true);
    try {
      const params: Parameters<typeof onUpdate>[0] = { id: cycle.id };
      if (h1Result) { params.h1_result = h1Result; params.h1_score = h1Score; }
      if (h2Result && cycle.h2_triggered) { params.h2_result = h2Result; params.h2_score = h2Score; }
      await onUpdate(params);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    background: '#020617',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0',
    borderRadius: '8px',
    padding: '8px 10px',
    fontWeight: 700,
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
    fontSize: '13px',
    width: '100%',
  };

  const btnStyle = (active: boolean, color: string) => ({
    background: active ? color : 'transparent',
    border: `1px solid ${color}`,
    color: active ? '#fff' : color,
    borderRadius: '8px',
    padding: '8px 14px',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: '12px',
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
    flex: 1,
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', padding: '24px', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '17px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginBottom: '4px' }}>
          Update Cycle
        </div>
        <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 700, marginBottom: '20px' }}>
          {cycle.away_team} @ {cycle.home_team} — Sharp: {cycle.sharp_side} {cycle.sharp_spread}
        </div>

        {/* 1H Result */}
        <div style={{ marginBottom: '16px' }}>
          {cardLabel('1H Result')}
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['win', 'loss', 'push'] as const).map((r) => (
              <button key={r} onClick={() => setH1Result(r)} style={btnStyle(h1Result === r, resultColor(r))}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          {cardLabel('Halftime Score (optional)')}
          <input value={h1Score} onChange={(e) => setH1Score(e.target.value)} placeholder="e.g. 54–48" style={inputStyle as React.CSSProperties} />
        </div>

        {/* 2H Result — only if 1H was loss or already triggered */}
        {(h1Result === 'loss' || cycle.h2_triggered) && (
          <>
            <div style={{ background: 'rgba(234,88,12,0.1)', border: '1px solid rgba(234,88,12,0.3)', borderRadius: '8px', padding: '8px 12px', marginBottom: '16px' }}>
              <div style={{ color: '#fb923c', fontSize: '12px', fontWeight: 800, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
                🔄 2H MARTINGALE TRIGGERED — Bet {cycle.h2_units ?? (cycle.h1_units * 2)} units on {cycle.sharp_side} {cycle.sharp_spread}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              {cardLabel('2H Result')}
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['win', 'loss', 'push'] as const).map((r) => (
                  <button key={r} onClick={() => setH2Result(r)} style={btnStyle(h2Result === r, resultColor(r))}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              {cardLabel('Final Score (optional)')}
              <input value={h2Score} onChange={(e) => setH2Score(e.target.value)} placeholder="e.g. 108–102" style={inputStyle as React.CSSProperties} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '13px' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!h1Result || saving}
            style={{ flex: 2, background: h1Result ? '#2563eb' : '#1e293b', border: 'none', color: '#fff', borderRadius: '8px', padding: '10px', cursor: h1Result ? 'pointer' : 'not-allowed', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}
          >
            {saving ? 'Saving...' : 'Save Result'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CycleCard({ cycle, onUpdate }: { cycle: HMCycle; onUpdate: (c: HMCycle) => void }) {
  return (
    <div style={{ background: '#111827', border: `1px solid ${resultColor(cycle.cycle_result)}33`, borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '16px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            {cycle.away_team} @ {cycle.home_team}
          </div>
          <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 700, marginTop: '3px' }}>
            {cycle.league} • {new Date(cycle.game_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {cycle.signal_tier && ` • ${cycle.signal_tier}`}
          </div>
        </div>
        <div style={{ background: resultColor(cycle.cycle_result), color: '#fff', fontSize: '11px', fontWeight: 900, padding: '5px 10px', borderRadius: '999px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', whiteSpace: 'nowrap' }}>
          {resultLabel(cycle.cycle_result)}
        </div>
      </div>

      {/* Sharp side */}
      <div style={{ background: '#020617', borderRadius: '10px', padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {cardLabel('Sharp Side')}
            <div style={{ color: '#a78bfa', fontWeight: 900, fontSize: '14px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              {cycle.sharp_side} {cycle.sharp_spread}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {cardLabel('Units')}
            <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '14px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              1H: {cycle.h1_units}u{cycle.h2_triggered ? ` → 2H: ${cycle.h2_units}u` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Results row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div style={{ background: '#020617', borderRadius: '8px', padding: '8px 10px' }}>
          {cardLabel('1H Result')}
          <div style={{ color: resultColor(cycle.h1_result), fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            {cycle.h1_result.toUpperCase()}
            {cycle.h1_score && <span style={{ color: '#64748b', fontWeight: 700, fontSize: '11px', marginLeft: '6px' }}>{cycle.h1_score}</span>}
          </div>
        </div>

        <div style={{ background: '#020617', borderRadius: '8px', padding: '8px 10px' }}>
          {cardLabel('2H Result')}
          <div style={{ color: cycle.h2_triggered ? resultColor(cycle.h2_result || 'pending') : '#475569', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            {cycle.h2_triggered
              ? (cycle.h2_result || 'pending').toUpperCase()
              : '—'}
            {cycle.h2_score && <span style={{ color: '#64748b', fontWeight: 700, fontSize: '11px', marginLeft: '6px' }}>{cycle.h2_score}</span>}
          </div>
        </div>
      </div>

      {/* Net units */}
      {cycle.net_units !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px' }}>
          {cardLabel('Net Units')}
          <div style={{ color: cycle.net_units >= 0 ? '#22c55e' : '#ef4444', fontWeight: 900, fontSize: '18px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            {cycle.net_units >= 0 ? '+' : ''}{cycle.net_units.toFixed(2)}u
          </div>
        </div>
      )}

      {/* Update button */}
      {cycle.cycle_result === 'pending' && (
        <button
          onClick={() => onUpdate(cycle)}
          style={{ background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: '10px', padding: '10px', cursor: 'pointer', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}
        >
          Update Result
        </button>
      )}

      {cycle.notes && (
        <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
          {cycle.notes}
        </div>
      )}
    </div>
  );
}

export function HMCycles() {
  const { cycles, loading, error, fetchCycles, updateCycle, summary } = useHMCycles();
  const [updating, setUpdating] = useState<HMCycle | null>(null);

  const handleUpdate = async (params: Parameters<typeof updateCycle>[0]) => {
    await updateCycle(params);
  };

  const pending = cycles.filter((c) => c.cycle_result === 'pending');
  const settled = cycles.filter((c) => c.cycle_result !== 'pending');

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '26px', fontWeight: 900, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            Heard Method Cycles
          </h2>
          <div style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>
            Track every 1H bet and 2H recovery
          </div>
        </div>
        <button onClick={fetchCycles} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 16px', fontWeight: 900, cursor: 'pointer', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Record', value: `${summary.wins}-${summary.losses}`, color: '#f8fafc' },
          { label: 'Win Rate', value: `${summary.winRate}%`, color: summary.winRate >= 55 ? '#22c55e' : summary.winRate >= 45 ? '#f8fafc' : '#ef4444' },
          { label: 'Net Units', value: `${summary.netUnits >= 0 ? '+' : ''}${summary.netUnits.toFixed(2)}u`, color: summary.netUnits >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'Pending', value: String(summary.pending), color: '#d97706' },
          { label: 'Pushes', value: String(summary.pushes), color: '#64748b' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#111827', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#94a3b8', fontWeight: 800, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 900, color, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginTop: '4px' }}>{value}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ color: '#94a3b8', fontWeight: 800 }}>Loading cycles...</div>
      ) : cycles.length === 0 ? (
        <div style={{ color: '#94a3b8', fontWeight: 800, textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <div>No cycles logged yet.</div>
          <div style={{ fontSize: '13px', marginTop: '8px', color: '#475569' }}>Log your first bet from the Dashboard → game card.</div>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <div style={{ color: '#d97706', fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginBottom: '12px' }}>
                ⏳ Pending ({pending.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: '14px' }}>
                {pending.map((c) => <CycleCard key={c.id} cycle={c} onUpdate={setUpdating} />)}
              </div>
            </div>
          )}

          {settled.length > 0 && (
            <div>
              <div style={{ color: '#64748b', fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginBottom: '12px' }}>
                Settled ({settled.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: '14px' }}>
                {settled.map((c) => <CycleCard key={c.id} cycle={c} onUpdate={setUpdating} />)}
              </div>
            </div>
          )}
        </>
      )}

      {updating && (
        <UpdateModal
          cycle={updating}
          onClose={() => setUpdating(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
