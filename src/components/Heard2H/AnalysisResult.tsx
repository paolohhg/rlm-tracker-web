import type { PipelineResult, MipVerdict, EdgeVerdict } from '../../lib/heard2h/types';

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

function verdictColor(v: MipVerdict): string {
  switch (v) {
    case 'strong_play': return '#22c55e';
    case 'play': return '#3b82f6';
    case 'lean': return '#d97706';
    case 'no_play': return '#64748b';
  }
}

function verdictLabel(v: MipVerdict): string {
  switch (v) {
    case 'strong_play': return 'STRONG PLAY';
    case 'play': return 'PLAY';
    case 'lean': return 'LEAN';
    case 'no_play': return 'NO PLAY';
  }
}

function edgeColor(v: EdgeVerdict): string {
  switch (v) {
    case 'strong_over': return '#22c55e';
    case 'over': return '#3b82f6';
    case 'strong_under': return '#ef4444';
    case 'under': return '#f97316';
    case 'no_edge': return '#64748b';
  }
}

function edgeLabel(v: EdgeVerdict): string {
  switch (v) {
    case 'strong_over': return 'STRONG OVER';
    case 'over': return 'OVER';
    case 'strong_under': return 'STRONG UNDER';
    case 'under': return 'UNDER';
    case 'no_edge': return 'NO EDGE';
  }
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      background: color, color: '#fff', fontSize: '11px', fontWeight: 900,
      padding: '4px 10px', borderRadius: '999px', fontFamily: FONT,
    }}>
      {label}
    </span>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.08em',
      color: '#94a3b8', fontWeight: 800, fontFamily: FONT, marginBottom: '6px',
    }}>
      {text}
    </div>
  );
}

interface Props {
  result: PipelineResult;
  onSave: () => void;
}

export function AnalysisResult({ result, onSave }: Props) {
  const { mip, tempo, signals, input } = result;
  const d = mip.derived;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '18px', fontFamily: FONT }}>
            {input.away_team || 'Away'} @ {input.home_team || 'Home'}
          </div>
          <div style={{ color: '#7c3aed', fontWeight: 900, fontSize: '12px', fontFamily: FONT }}>
            {input.sport.toUpperCase()}
          </div>
        </div>

        {/* Derived metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {[
            { label: 'Implied 2H Total', value: d.pregame_implied_2H_total.toFixed(1) },
            { label: '1H Delta', value: `${d.first_half_total_delta >= 0 ? '+' : ''}${d.first_half_total_delta.toFixed(1)}` },
            { label: '2H Mispricing', value: `${d.second_half_total_mispricing >= 0 ? '+' : ''}${d.second_half_total_mispricing.toFixed(1)}` },
            { label: 'HT Margin', value: `${d.halftime_margin >= 0 ? '+' : ''}${d.halftime_margin}` },
            { label: 'Margin Delta', value: `${d.first_half_margin_delta >= 0 ? '+' : ''}${d.first_half_margin_delta.toFixed(1)}` },
            { label: 'Power Adj', value: `${d.market_power_adjustment >= 0 ? '+' : ''}${d.market_power_adjustment.toFixed(1)}` },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#020617', borderRadius: '8px', padding: '8px 10px' }}>
              <div style={{ fontSize: '9px', textTransform: 'uppercase' as const, color: '#64748b', fontWeight: 800, fontFamily: FONT }}>{label}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 900, fontSize: '15px', fontFamily: FONT }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MIP Scores */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Totals MIP */}
        <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <SectionLabel text="Totals MIP" />
            <Badge color={verdictColor(mip.totals.verdict)} label={`${mip.totals.score}/8 ${verdictLabel(mip.totals.verdict)}`} />
          </div>
          {mip.totals.breakdown.map((line, i) => (
            <div key={i} style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 600, padding: '2px 0', fontFamily: FONT }}>{line}</div>
          ))}
          {mip.totals.flags.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {mip.totals.flags.map(f => (
                <span key={f} style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', fontFamily: FONT }}>{f}</span>
              ))}
            </div>
          )}
        </div>

        {/* Sides MIP */}
        <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <SectionLabel text="Sides MIP" />
            <Badge color={verdictColor(mip.sides.verdict)} label={`${mip.sides.score}/8 ${verdictLabel(mip.sides.verdict)}`} />
          </div>
          {mip.sides.breakdown.map((line, i) => (
            <div key={i} style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 600, padding: '2px 0', fontFamily: FONT }}>{line}</div>
          ))}
          {mip.sides.flags.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {mip.sides.flags.map(f => (
                <span key={f} style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', fontFamily: FONT }}>{f}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tempo Layer */}
      {tempo && (
        <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <SectionLabel text="Tempo Layer — Fair 2H Total" />
            <Badge color={edgeColor(tempo.verdict)} label={edgeLabel(tempo.verdict)} />
          </div>

          {/* Key numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
            {[
              { label: 'Fair 2H Total', value: tempo.fair_2H_total.toFixed(1), color: '#f8fafc' },
              { label: '2H Opener', value: tempo.posted_2H_open.toFixed(1), color: '#94a3b8' },
              { label: 'Edge', value: `${tempo.edge >= 0 ? '+' : ''}${tempo.edge.toFixed(1)}`, color: edgeColor(tempo.verdict) },
              { label: '2H Current', value: tempo.posted_2H_current.toFixed(1), color: '#94a3b8' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#020617', borderRadius: '8px', padding: '8px 10px' }}>
                <div style={{ fontSize: '9px', textTransform: 'uppercase' as const, color: '#64748b', fontWeight: 800, fontFamily: FONT }}>{label}</div>
                <div style={{ color, fontWeight: 900, fontSize: '18px', fontFamily: FONT }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Adjustments breakdown */}
          <div style={{ background: '#020617', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '9px', textTransform: 'uppercase' as const, color: '#64748b', fontWeight: 800, fontFamily: FONT, marginBottom: '8px' }}>Adjustments</div>
            {(Object.keys(tempo.adjustments) as (keyof typeof tempo.adjustments)[]).map(key => {
              const val = tempo.adjustments[key];
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div>
                    <span style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 800, fontFamily: FONT, textTransform: 'capitalize' }}>{key.replace('_', ' ')}</span>
                    <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, marginTop: '2px' }}>{tempo.adjustment_reasons[key]}</div>
                  </div>
                  <span style={{ color: val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#64748b', fontWeight: 900, fontSize: '14px', fontFamily: FONT, whiteSpace: 'nowrap', marginLeft: '12px' }}>
                    {val >= 0 ? '+' : ''}{val.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Plain english */}
          <div style={{ marginTop: '12px', background: '#020617', borderRadius: '10px', padding: '12px' }}>
            <div style={{ fontSize: '9px', textTransform: 'uppercase' as const, color: '#64748b', fontWeight: 800, fontFamily: FONT, marginBottom: '6px' }}>Analysis</div>
            <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600, lineHeight: 1.6 }}>{tempo.plain_english}</div>
          </div>

          {tempo.flags.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {tempo.flags.map(f => (
                <span key={f} style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', fontFamily: FONT }}>{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Signal Layer */}
      <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <SectionLabel text="Context Signals" />
          <Badge color={verdictColor(signals.verdict)} label={`${signals.total_score} pts — ${verdictLabel(signals.verdict)}`} />
        </div>
        {signals.signals.map((s, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 0', borderBottom: i < signals.signals.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
            opacity: s.active ? 1 : 0.4,
          }}>
            <div>
              <span style={{ color: s.active ? '#f8fafc' : '#475569', fontSize: '12px', fontWeight: 800, fontFamily: FONT }}>{s.name}</span>
              <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>{s.note}</div>
            </div>
            <span style={{ color: s.active ? '#22c55e' : '#475569', fontWeight: 900, fontSize: '13px', fontFamily: FONT }}>
              {s.active ? `+${s.points}` : '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Save button */}
      <button
        onClick={onSave}
        style={{
          width: '100%', background: '#16a34a', border: 'none', color: '#fff',
          borderRadius: '10px', padding: '12px', cursor: 'pointer',
          fontWeight: 900, fontSize: '14px', fontFamily: FONT,
        }}
      >
        Save to Game Log
      </button>
    </div>
  );
}
