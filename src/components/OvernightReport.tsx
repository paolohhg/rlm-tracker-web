// ══════════════════════════════════════════════════════════════════════════════
//  OvernightReport — Subscriber dashboard for Morning Market Report
//
//  Renders the stored overnight report with sections:
//    - Headline
//    - Quick stats
//    - Top signals
//    - Frozen line watch
//    - Market themes
//    - What to watch today
//
//  Reads from /api/overnight-report (never generates live).
//  Handles: pending, complete, failed, insufficient_data states.
// ══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { T, BADGE_COLORS } from '../lib/theme';
import { useOvernightReport } from '../hooks/useOvernightReport';

const LEAGUES = ['NBA', 'NCAAB', 'NHL', 'MLB'];

export function OvernightReport() {
  const [league, setLeague] = useState('NCAAB');
  const { report, meta, loading, error } = useOvernightReport(league);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ color: T.text, fontFamily: T.font, fontSize: 22, fontWeight: 700, margin: 0 }}>
          Morning Market Report
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {LEAGUES.map(l => (
            <button
              key={l}
              onClick={() => setLeague(l)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontFamily: T.font,
                fontSize: 13,
                fontWeight: 600,
                background: l === league ? T.accent : T.panel,
                color: l === league ? '#0b0f19' : T.textSecondary,
                transition: 'all 0.15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading state ──────────────────────────────────────────────── */}
      {loading && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: T.textSecondary }}>
          Loading report...
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {!loading && error && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#ff6b6b' }}>
          {error === 'No report found'
            ? `No ${league} report available yet. Reports generate daily at 8 AM ET.`
            : `Error: ${error}`}
        </div>
      )}

      {/* ── Non-complete status ────────────────────────────────────────── */}
      {!loading && !error && meta && meta.status !== 'complete' && (
        <StatusCard status={meta.status} league={league} errorMessage={meta.error_message} />
      )}

      {/* ── Report content ─────────────────────────────────────────────── */}
      {!loading && !error && report && meta?.status === 'complete' && (
        <>
          {/* Headline */}
          <div style={{ ...cardStyle, marginBottom: 16, padding: '18px 20px' }}>
            <h3 style={{ color: T.accent, fontFamily: T.font, fontSize: 18, fontWeight: 700, margin: 0 }}>
              {report.headline}
            </h3>
            <div style={{ color: T.muted, fontSize: 12, marginTop: 6, fontFamily: T.font }}>
              {meta.date} &middot; Generated {new Date(report.generated_at).toLocaleTimeString()}
            </div>
          </div>

          {/* Quick Stats */}
          <QuickStatsBar stats={report.quick_stats} />

          {/* Top Signals */}
          {report.top_signals.length > 0 && (
            <Section title="Top Signals">
              {report.top_signals.map((sig, i) => (
                <SignalCard key={i} signal={sig} />
              ))}
            </Section>
          )}

          {/* Frozen Line Watch */}
          {report.frozen_line_watch.length > 0 && (
            <Section title="Frozen Line Watch">
              {report.frozen_line_watch.map((f, i) => (
                <div key={i} style={{ ...rowStyle, borderLeft: `3px solid ${BADGE_COLORS['FROZEN LINE'] || '#a855f7'}` }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: T.text, fontWeight: 600, fontSize: 14, fontFamily: T.font }}>
                      {f.away_team} @ {f.home_team}
                    </span>
                    <div style={{ color: T.textSecondary, fontSize: 12, marginTop: 2, fontFamily: T.font }}>
                      {f.note}
                    </div>
                  </div>
                  <span style={{
                    ...badgeBase,
                    background: 'rgba(168, 85, 247, 0.15)',
                    color: '#a855f7',
                  }}>
                    {f.frozen_snapshots} snaps
                  </span>
                </div>
              ))}
            </Section>
          )}

          {/* Market Themes */}
          {report.market_themes.length > 0 && (
            <Section title="Market Themes">
              <ul style={{ margin: 0, paddingLeft: 20, color: T.text, fontFamily: T.font, fontSize: 14, lineHeight: 1.7 }}>
                {report.market_themes.map((theme, i) => (
                  <li key={i}>{theme}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* What to Watch Today */}
          {report.what_to_watch.length > 0 && (
            <Section title="What to Watch Today">
              {report.what_to_watch.map((item, i) => (
                <div key={i} style={{ ...rowStyle, borderLeft: `3px solid ${T.accent}` }}>
                  <div>
                    <span style={{ color: T.accent, fontWeight: 600, fontSize: 14, fontFamily: T.font }}>
                      {item.game}
                    </span>
                    <div style={{ color: T.textSecondary, fontSize: 12, marginTop: 2, fontFamily: T.font }}>
                      {item.reason}
                    </div>
                  </div>
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatusCard({ status, league, errorMessage }: { status: string; league: string; errorMessage?: string }) {
  const statusConfig: Record<string, { color: string; label: string; message: string }> = {
    pending: {
      color: '#facc15',
      label: 'GENERATING',
      message: `${league} report is being generated. Check back shortly.`,
    },
    failed: {
      color: '#ff6b6b',
      label: 'FAILED',
      message: errorMessage || 'Report generation failed. It will retry on the next scheduled run.',
    },
    insufficient_data: {
      color: T.muted,
      label: 'INSUFFICIENT DATA',
      message: `Not enough overnight odds data to generate a ${league} report. This can happen on off-days.`,
    },
  };

  const cfg = statusConfig[status] || statusConfig.failed;

  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
      <span style={{ ...badgeBase, background: `${cfg.color}22`, color: cfg.color, fontSize: 13, marginBottom: 12 }}>
        {cfg.label}
      </span>
      <div style={{ color: T.textSecondary, fontSize: 14, fontFamily: T.font, marginTop: 12 }}>
        {cfg.message}
      </div>
    </div>
  );
}

function QuickStatsBar({ stats }: { stats: NonNullable<ReturnType<typeof useOvernightReport>['report']>['quick_stats'] }) {
  const items = [
    { label: 'Games', value: stats.games_tracked },
    { label: 'Signals', value: stats.significant_moves },
    { label: 'Coordinated', value: stats.coordinated_moves },
    { label: 'Frozen', value: stats.frozen_lines },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
      {items.map((item, i) => (
        <div key={i} style={{ ...cardStyle, padding: '14px 16px', textAlign: 'center' }}>
          <div style={{ color: T.accent, fontSize: 24, fontWeight: 800, fontFamily: T.font }}>
            {item.value}
          </div>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font, marginTop: 4 }}>
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 16, padding: '16px 20px' }}>
      <h4 style={{ color: T.text, fontFamily: T.font, fontSize: 15, fontWeight: 700, margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function SignalCard({ signal }: { signal: { game: string; signal: string; detail: string; strength: number } }) {
  // Map signal labels to badge colors
  const signalColor = signal.signal.includes('coordinated') ? BADGE_COLORS['STEAM MOVE'] || '#ff9f1c'
    : signal.signal.includes('Frozen') ? BADGE_COLORS['FROZEN LINE'] || '#a855f7'
    : signal.signal.includes('moneyline') ? '#38bdf8'
    : BADGE_COLORS['RLM'] || '#00ff9c';

  return (
    <div style={{ ...rowStyle, borderLeft: `3px solid ${signalColor}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: T.text, fontWeight: 600, fontSize: 14, fontFamily: T.font }}>
            {signal.game}
          </span>
          <span style={{ ...badgeBase, background: `${signalColor}22`, color: signalColor }}>
            {signal.signal}
          </span>
        </div>
        <div style={{ color: T.textSecondary, fontSize: 12, marginTop: 4, fontFamily: T.font, lineHeight: 1.4 }}>
          {signal.detail}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <StrengthDot strength={signal.strength} />
      </div>
    </div>
  );
}

function StrengthDot({ strength }: { strength: number }) {
  const color = strength >= 60 ? '#00ff9c' : strength >= 30 ? '#facc15' : T.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ color, fontSize: 12, fontWeight: 600, fontFamily: T.font }}>{strength}</span>
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: T.panel,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 6,
  marginBottom: 6,
  background: 'rgba(255,255,255,0.02)',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: T.font,
  letterSpacing: '0.04em',
};
