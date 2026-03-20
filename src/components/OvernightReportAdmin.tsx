// ══════════════════════════════════════════════════════════════════════════════
//  OvernightReportAdmin — Internal debug/admin view
//
//  Shows:
//    - Last run timestamp
//    - Report status per league
//    - Source time window
//    - Raw computed stats (per-game analyses, aggregate)
//    - Stored JSON payload
//    - Manual regenerate trigger
//
//  Access: internal only — not exposed in subscriber nav.
// ══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { T } from '../lib/theme';
import { useOvernightReport } from '../hooks/useOvernightReport';

const LEAGUES = ['NBA', 'NCAAB', 'NHL', 'MLB'];

export function OvernightReportAdmin() {
  const [league, setLeague] = useState('NCAAB');
  const [dateInput, setDateInput] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<string | null>(null);

  const dateParam = dateInput || undefined;
  const { report, meta, debug, loading, error, refetch } = useOvernightReport(league, {
    date: dateParam,
    admin: true,
  });

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenResult(null);
    try {
      const params = new URLSearchParams({ force: 'true', league });
      if (dateInput) params.set('date', dateInput);
      const res = await fetch(`/api/generate-overnight-report?${params}`, { method: 'POST' });
      const data = await res.json();
      setRegenResult(JSON.stringify(data, null, 2));
      refetch();
    } catch (err: any) {
      setRegenResult(`Error: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ color: T.text, fontFamily: T.font, fontSize: 20, fontWeight: 700, margin: '0 0 16px 0' }}>
        Overnight Report — Admin Debug
      </h2>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* League selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {LEAGUES.map(l => (
            <button
              key={l}
              onClick={() => setLeague(l)}
              style={{
                padding: '5px 12px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                fontFamily: T.font,
                fontSize: 12,
                fontWeight: 600,
                background: l === league ? T.accent : T.hover,
                color: l === league ? '#0b0f19' : T.textSecondary,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Date input */}
        <input
          type="date"
          value={dateInput}
          onChange={e => setDateInput(e.target.value)}
          placeholder="YYYY-MM-DD"
          style={{
            background: T.hover,
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            color: T.text,
            fontFamily: T.font,
            fontSize: 12,
            padding: '5px 10px',
          }}
        />

        {/* Regenerate button */}
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          style={{
            padding: '5px 14px',
            borderRadius: 5,
            border: `1px solid #ff9f1c`,
            cursor: regenerating ? 'not-allowed' : 'pointer',
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            background: 'rgba(255, 159, 28, 0.1)',
            color: '#ff9f1c',
            opacity: regenerating ? 0.5 : 1,
          }}
        >
          {regenerating ? 'Regenerating...' : 'Force Regenerate'}
        </button>

        {/* Refresh */}
        <button
          onClick={refetch}
          style={{
            padding: '5px 14px',
            borderRadius: 5,
            border: `1px solid ${T.border}`,
            cursor: 'pointer',
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            background: T.hover,
            color: T.textSecondary,
          }}
        >
          Refresh
        </button>
      </div>

      {/* ── Loading / Error ────────────────────────────────────────────── */}
      {loading && <div style={{ color: T.muted, fontFamily: T.font, padding: 20 }}>Loading...</div>}
      {error && <div style={{ color: '#ff6b6b', fontFamily: T.font, padding: 20 }}>{error}</div>}

      {/* ── Meta / Status ──────────────────────────────────────────────── */}
      {meta && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 12 }}>
          <h4 style={sectionTitle}>Report Status</h4>
          <MetaRow label="League" value={meta.league} />
          <MetaRow label="Date" value={meta.date} />
          <MetaRow label="Status" value={meta.status} color={statusColor(meta.status)} />
          <MetaRow label="Generated" value={meta.generated_at} />
          <MetaRow label="Snapshots" value={String(meta.snapshot_count)} />
          <MetaRow label="Games" value={String(meta.game_count)} />
          {meta.error_message && <MetaRow label="Error" value={meta.error_message} color="#ff6b6b" />}
        </div>
      )}

      {/* ── Debug: Window + Timestamps ─────────────────────────────────── */}
      {debug && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 12 }}>
          <h4 style={sectionTitle}>Source Window</h4>
          <MetaRow label="ID" value={debug.id} />
          <MetaRow label="Window Start" value={debug.window_start} />
          <MetaRow label="Window End" value={debug.window_end} />
          <MetaRow label="Created" value={debug.created_at} />
          <MetaRow label="Updated" value={debug.updated_at} />
        </div>
      )}

      {/* ── Debug: Raw Computed Stats ──────────────────────────────────── */}
      {debug?.computed_stats && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 12 }}>
          <h4 style={sectionTitle}>Raw Computed Stats</h4>
          <JsonBlock data={debug.computed_stats} />
        </div>
      )}

      {/* ── Debug: Stored Report Payload ───────────────────────────────── */}
      {report && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 12 }}>
          <h4 style={sectionTitle}>Stored Report Payload</h4>
          <JsonBlock data={report} />
        </div>
      )}

      {/* ── Regenerate Result ──────────────────────────────────────────── */}
      {regenResult && (
        <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 12 }}>
          <h4 style={sectionTitle}>Regeneration Result</h4>
          <pre style={preStyle}>{regenResult}</pre>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ color: T.muted, fontSize: 12, fontFamily: T.font, width: 100, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: color || T.text, fontSize: 13, fontFamily: T.font, fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}

function JsonBlock({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(data, null, 2);
  const preview = json.length > 500 && !expanded ? json.slice(0, 500) + '\n...' : json;

  return (
    <div>
      <pre style={preStyle}>{preview}</pre>
      {json.length > 500 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none',
            border: 'none',
            color: T.accent,
            fontFamily: T.font,
            fontSize: 11,
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          {expanded ? 'Collapse' : 'Expand full JSON'}
        </button>
      )}
    </div>
  );
}

function statusColor(status: string): string {
  if (status === 'complete') return '#4ade80';
  if (status === 'pending') return '#facc15';
  if (status === 'failed') return '#ff6b6b';
  return T.muted;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: T.panel,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
};

const sectionTitle: React.CSSProperties = {
  color: T.textSecondary,
  fontFamily: T.font,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 10px 0',
};

const preStyle: React.CSSProperties = {
  background: '#0d1117',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: '10px 12px',
  color: T.textSecondary,
  fontFamily: '"Fira Code", "Consolas", monospace',
  fontSize: 11,
  lineHeight: 1.5,
  overflow: 'auto',
  maxHeight: 500,
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
