import { useState, useEffect, useCallback } from 'react';
import { T } from '../lib/theme';
import {
  generateAlertPost,
  generateSignalPost,
  generateExplainMove,
  deriveConfidenceLabel,
  deriveTotalConfidenceLabel,
  DEFAULT_ALERT_OPTIONS,
  DEFAULT_SIGNAL_OPTIONS,
} from '../lib/share/post-generators';
import type { AlertOptions, SignalOptions } from '../lib/share/post-generators';
import type { GameView } from '../types';

// ── Types ────────────────────────────────────────────────────

type ShareTab = 'alert' | 'signal' | 'education' | 'snapshot';

interface ShareStudioProps {
  game: GameView;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────

function formatSpread(spread: number | null): string {
  if (spread == null) return 'N/A';
  return spread > 0 ? `+${spread}` : `${spread}`;
}

// ── Canvas PNG Renderer ─────────────────────────────────────
// Pure Canvas 2D — no DOM dependencies, no html-to-image

function renderCardToCanvas(
  game: GameView,
  tab: ShareTab,
  alertOptions: AlertOptions,
  signalOptions: SignalOptions,
): HTMLCanvasElement {
  const W = 1200;
  const H = 675;
  const DPR = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0b0f19');
  grad.addColorStop(0.5, '#141a2a');
  grad.addColorStop(1, '#0d1420');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const PAD = 60;
  const FONT = '"Inter", "Segoe UI", Arial, sans-serif';
  const isSignal = tab === 'signal';

  // ── Header: HSI badge + brand name ──
  // Badge box
  const badgeSize = 40;
  const badgeGrad = ctx.createLinearGradient(PAD, PAD, PAD + badgeSize, PAD + badgeSize);
  badgeGrad.addColorStop(0, '#00e5ff');
  badgeGrad.addColorStop(1, '#0088aa');
  ctx.fillStyle = badgeGrad;
  roundRect(ctx, PAD, PAD, badgeSize, badgeSize, 8);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.font = `900 18px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('HSI', PAD + 7, PAD + badgeSize / 2);

  // Brand text
  ctx.fillStyle = '#64748b';
  ctx.font = `700 18px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('HEARD SPORTS INTELLIGENCE', PAD + badgeSize + 14, PAD + badgeSize / 2);

  // ── Badge (MARKET MOVE or HSI SIGNAL) ──
  const badgeY = 160;
  const badgeText = isSignal ? 'HSI SIGNAL' : 'MARKET MOVE';
  const badgeBg = isSignal ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 159, 28, 0.15)';
  const badgeBorder = isSignal ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255, 159, 28, 0.4)';
  const badgeColor = isSignal ? '#00e5ff' : '#ff9f1c';

  ctx.font = `800 22px ${FONT}`;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgePadH = 20;
  const badgePadV = 10;
  const badgeW = badgeTextW + badgePadH * 2;
  const badgeH = 22 + badgePadV * 2;

  ctx.fillStyle = badgeBg;
  roundRect(ctx, PAD, badgeY, badgeW, badgeH, 6);
  ctx.fill();

  ctx.strokeStyle = badgeBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, PAD, badgeY, badgeW, badgeH, 6);
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, PAD + badgePadH, badgeY + badgeH / 2);

  // ── Matchup ──
  const matchupY = badgeY + badgeH + 30;
  ctx.fillStyle = '#e6edf7';
  ctx.font = `800 42px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${game.awayTeam} @ ${game.homeTeam}`, PAD, matchupY);

  // ── Spread movement ──
  let dataY = matchupY + 58;
  if (game.openingSpread != null && game.currentSpread != null) {
    const moveAmt = Math.abs(game.currentSpread - game.openingSpread);
    const movedToward = game.currentSpread < game.openingSpread ? game.homeTeam : game.awayTeam;

    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 28px ${FONT}`;
    ctx.textBaseline = 'top';
    const spreadStr = `${formatSpread(game.openingSpread)} → ${formatSpread(game.currentSpread)}`;
    ctx.fillText(spreadStr, PAD, dataY);

    const spreadW = ctx.measureText(spreadStr).width;
    ctx.fillStyle = '#64748b';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(`  (${moveAmt.toFixed(1)} pt move toward ${movedToward})`, PAD + spreadW, dataY + 4);

    dataY += 48;
  }

  // ── Data row ──
  const dataItems: string[] = [];
  if (!isSignal) {
    if (alertOptions.showTicketPct && game.awayBetsPct != null && game.publicBetsPct != null) {
      dataItems.push(`Tickets: ${game.awayBetsPct}% / ${game.publicBetsPct}%`);
    }
    if (alertOptions.showMoneyPct && game.awayMoneyPct != null && game.publicMoneyPct != null) {
      dataItems.push(`Money: ${game.awayMoneyPct}% / ${game.publicMoneyPct}%`);
    }
    if (alertOptions.showBookCount && game.booksAgreeing != null && game.totalBooks != null) {
      dataItems.push(`Books: ${game.booksAgreeing}/${game.totalBooks}`);
    }
  } else {
    if (signalOptions.showSupportingData && game.signalTier) {
      dataItems.push(`Signal: ${game.signalTier}`);
    }
    if (signalOptions.showConfidence && game.signalTier) {
      dataItems.push(`Confidence: ${deriveConfidenceLabel(game.signalTier)}`);
    }
  }

  if (dataItems.length > 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = `500 22px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(dataItems.join('   •   '), PAD, dataY);
    dataY += 36;
  }

  // ── Total movement ──
  if (game.openingTotal != null && game.currentTotal != null && Math.abs(game.currentTotal - game.openingTotal) >= 0.5) {
    const totalDir = game.currentTotal > game.openingTotal ? 'Over' : 'Under';
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 28px ${FONT}`;
    ctx.textBaseline = 'top';
    const totalStr = `Total: ${game.openingTotal} \u2192 ${game.currentTotal}`;
    ctx.fillText(totalStr, PAD, dataY);

    const totalW = ctx.measureText(totalStr).width;
    ctx.fillStyle = '#64748b';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(`  (moving ${totalDir})`, PAD + totalW, dataY + 4);
    dataY += 40;

    // Total confidence + splits
    const totalDataItems: string[] = [];
    if (game.overTicketPct != null && game.underTicketPct != null) {
      totalDataItems.push(`O/U Tickets: ${game.overTicketPct}% / ${game.underTicketPct}%`);
    }
    const totalConf = deriveTotalConfidenceLabel(game);
    if (totalConf) {
      totalDataItems.push(`Total Confidence: ${totalConf}`);
    }
    if (totalDataItems.length > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = `500 22px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.fillText(totalDataItems.join('   •   '), PAD, dataY);
    }
  }

  // ── Footer ──
  const footerY = H - PAD - 20;

  // Divider line
  ctx.strokeStyle = '#1f2636';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footerY - 20);
  ctx.lineTo(W - PAD, footerY - 20);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = `600 18px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText('HSI Market Tracker', PAD, footerY);

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.font = `400 16px ${FONT}`;
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - PAD - dateW, footerY + 2);

  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Toggle Switch ────────────────────────────────────────────

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: T.textSecondary, fontFamily: T.font }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: '36px',
          height: '20px',
          borderRadius: '10px',
          background: checked ? T.accent : T.hover,
          position: 'relative',
          transition: 'background 200ms',
          flexShrink: 0,
          border: `1px solid ${checked ? T.accent : T.border}`,
        }}
      >
        <div style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: checked ? '#000' : T.muted,
          position: 'absolute',
          top: '1px',
          left: checked ? '17px' : '1px',
          transition: 'left 200ms',
        }} />
      </div>
      {label}
    </label>
  );
}

// ── Main ShareStudio Component ───────────────────────────────

export function ShareStudio({ game, onClose }: ShareStudioProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ShareTab>('alert');
  const [alertOptions, setAlertOptions] = useState<AlertOptions>({ ...DEFAULT_ALERT_OPTIONS });
  const [signalOptions, setSignalOptions] = useState<SignalOptions>({ ...DEFAULT_SIGNAL_OPTIONS });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Slide-in animation
  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true));
  }, []);

  // Mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  // Generate post text based on active tab
  const postText = activeTab === 'alert'
    ? generateAlertPost(game, alertOptions)
    : activeTab === 'signal'
      ? generateSignalPost(game, signalOptions)
      : '';

  const explainText = generateExplainMove(game);

  // Copy to clipboard
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }, []);

  // Export PNG via Canvas 2D — no DOM capture needed
  const handleExportPng = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = renderCardToCanvas(game, activeTab, alertOptions, signalOptions);
      const dataUrl = canvas.toDataURL('image/png');

      const link = document.createElement('a');
      link.download = `hsi-${activeTab}-${game.awayTeam}-${game.homeTeam}.png`
        .replace(/\s+/g, '-')
        .toLowerCase();
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('PNG export failed. Check console for details.');
    } finally {
      setExporting(false);
    }
  }, [activeTab, game, alertOptions, signalOptions, exporting]);

  const hasSignal = game.signalTier && game.signalTier !== 'WATCH' && game.signalTier !== 'TRACKING';

  const drawerWidth = isMobile ? '100vw' : '420px';
  const translateX = isMobile ? '100vw' : '420px';

  const tabs: { key: ShareTab; label: string }[] = [
    { key: 'alert', label: 'Alert' },
    { key: 'signal', label: 'Signal' },
    { key: 'education', label: 'Education' },
    { key: 'snapshot', label: 'Snapshot' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: `rgba(0,0,0,${isOpen ? 0.5 : 0})`,
          zIndex: 1100,
          transition: 'background 300ms',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: drawerWidth,
        zIndex: 1101,
        background: T.bg,
        borderLeft: `1px solid ${T.border}`,
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        transform: `translateX(${isOpen ? '0' : translateX})`,
        transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <img src="/hsi-logo.jpg" alt="" style={{ height: '18px', width: '18px', borderRadius: '4px' }} />
                <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: T.font }}>
                  Share Studio
                </span>
              </div>
              <div style={{ color: T.text, fontWeight: 700, fontSize: '15px', fontFamily: T.font }}>
                {game.awayTeam} @ {game.homeTeam}
              </div>
              <div style={{ color: T.muted, fontSize: '11px', fontFamily: T.font, marginTop: '2px' }}>
                {game.league} {'\u2022'} {formatSpread(game.currentSpread)}
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: T.hover,
                border: 'none',
                color: T.textSecondary,
                borderRadius: '999px',
                width: '28px',
                height: '28px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {'\u2715'}
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, padding: '0 20px' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${activeTab === tab.key ? T.accent : 'transparent'}`,
                color: activeTab === tab.key ? T.text : T.muted,
                padding: '10px 0',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '12px',
                fontFamily: T.font,
                letterSpacing: '0.04em',
                transition: 'color 200ms, border-color 200ms',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* ── Alert Tab ── */}
          {activeTab === 'alert' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Preview Card */}
              <div style={{
                background: T.panel,
                border: `1px solid ${T.border}`,
                borderRadius: '10px',
                padding: '16px',
              }}>
                <div style={{ color: T.text, fontSize: '13px', lineHeight: 1.7, fontFamily: T.font, whiteSpace: 'pre-wrap' }}>
                  {postText}
                </div>
              </div>

              {/* Explain Move */}
              <div style={{
                background: T.hover,
                border: `1px solid ${T.border}`,
                borderRadius: '8px',
                padding: '12px',
              }}>
                <div style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontFamily: T.font }}>
                  Explain Move
                </div>
                <div style={{ color: T.textSecondary, fontSize: '12px', lineHeight: 1.6, fontFamily: T.font }}>
                  {explainText}
                </div>
                <button
                  onClick={() => handleCopy(explainText)}
                  style={{
                    marginTop: '8px',
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    color: T.textSecondary,
                    borderRadius: '4px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: 600,
                    fontFamily: T.font,
                  }}
                >
                  Copy Explanation
                </button>
              </div>

              {/* Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Toggle label="Ticket %" checked={alertOptions.showTicketPct} onChange={(v) => setAlertOptions(o => ({ ...o, showTicketPct: v }))} />
                <Toggle label="Money %" checked={alertOptions.showMoneyPct} onChange={(v) => setAlertOptions(o => ({ ...o, showMoneyPct: v }))} />
                <Toggle label="Book count" checked={alertOptions.showBookCount} onChange={(v) => setAlertOptions(o => ({ ...o, showBookCount: v }))} />
                <Toggle label="Timestamp" checked={alertOptions.showTimestamp} onChange={(v) => setAlertOptions(o => ({ ...o, showTimestamp: v }))} />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleCopy(postText)}
                  style={{
                    flex: 1,
                    background: copyFeedback ? '#22c55e' : T.accent,
                    border: 'none',
                    color: '#000',
                    borderRadius: '8px',
                    padding: '10px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '13px',
                    fontFamily: T.font,
                    transition: 'background 200ms',
                  }}
                >
                  {copyFeedback ? 'Copied!' : 'Copy Post'}
                </button>
                <button
                  onClick={handleExportPng}
                  disabled={exporting}
                  style={{
                    flex: 1,
                    background: T.panel,
                    border: `1px solid ${T.border}`,
                    color: T.text,
                    borderRadius: '8px',
                    padding: '10px',
                    cursor: exporting ? 'wait' : 'pointer',
                    fontWeight: 700,
                    fontSize: '13px',
                    fontFamily: T.font,
                    opacity: exporting ? 0.6 : 1,
                  }}
                >
                  {exporting ? 'Exporting...' : 'Download Graphic'}
                </button>
              </div>
            </div>
          )}

          {/* ── Signal Tab ── */}
          {activeTab === 'signal' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {hasSignal ? (
                <>
                  {/* Preview Card */}
                  <div style={{
                    background: T.panel,
                    border: `1px solid ${T.border}`,
                    borderRadius: '10px',
                    padding: '16px',
                  }}>
                    <div style={{ color: T.text, fontSize: '13px', lineHeight: 1.7, fontFamily: T.font, whiteSpace: 'pre-wrap' }}>
                      {postText}
                    </div>
                  </div>

                  {/* Toggles */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Toggle label="Supporting data" checked={signalOptions.showSupportingData} onChange={(v) => setSignalOptions(o => ({ ...o, showSupportingData: v }))} />
                    <Toggle label="Confidence" checked={signalOptions.showConfidence} onChange={(v) => setSignalOptions(o => ({ ...o, showConfidence: v }))} />
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => handleCopy(postText)}
                      style={{
                        flex: 1,
                        background: copyFeedback ? '#22c55e' : T.accent,
                        border: 'none',
                        color: '#000',
                        borderRadius: '8px',
                        padding: '10px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '13px',
                        fontFamily: T.font,
                        transition: 'background 200ms',
                      }}
                    >
                      {copyFeedback ? 'Copied!' : 'Copy Post'}
                    </button>
                    <button
                      onClick={handleExportPng}
                      disabled={exporting}
                      style={{
                        flex: 1,
                        background: T.panel,
                        border: `1px solid ${T.border}`,
                        color: T.text,
                        borderRadius: '8px',
                        padding: '10px',
                        cursor: exporting ? 'wait' : 'pointer',
                        fontWeight: 700,
                        fontSize: '13px',
                        fontFamily: T.font,
                        opacity: exporting ? 0.6 : 1,
                      }}
                    >
                      {exporting ? 'Exporting...' : 'Export Signal Card'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{
                  background: T.panel,
                  border: `1px solid ${T.border}`,
                  borderRadius: '10px',
                  padding: '32px 20px',
                  textAlign: 'center',
                }}>
                  <div style={{ color: T.muted, fontSize: '14px', fontFamily: T.font, marginBottom: '4px' }}>
                    No active signal for this game
                  </div>
                  <div style={{ color: T.muted, fontSize: '11px', fontFamily: T.font }}>
                    Signal posts are available when RLM, Steam, or other sharp indicators are detected.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Education Tab (V2 Stub) ── */}
          {activeTab === 'education' && (
            <div style={{
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: '10px',
              padding: '40px 20px',
              textAlign: 'center',
            }}>
              <div style={{ color: T.accent, fontSize: '24px', marginBottom: '12px' }}>
                {'\u{1F4DA}'}
              </div>
              <div style={{ color: T.text, fontSize: '14px', fontWeight: 700, fontFamily: T.font, marginBottom: '6px' }}>
                Market Education
              </div>
              <div style={{ color: T.muted, fontSize: '12px', fontFamily: T.font, lineHeight: 1.6 }}>
                Coming soon — Generate educational breakdowns explaining RLM, steam moves, coordinated book movement, and more.
              </div>
            </div>
          )}

          {/* ── Snapshot Tab (V2 Stub) ── */}
          {activeTab === 'snapshot' && (
            <div style={{
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: '10px',
              padding: '40px 20px',
              textAlign: 'center',
            }}>
              <div style={{ color: T.accent, fontSize: '24px', marginBottom: '12px' }}>
                {'\u{1F4F8}'}
              </div>
              <div style={{ color: T.text, fontSize: '14px', fontWeight: 700, fontFamily: T.font, marginBottom: '6px' }}>
                Tracker Snapshot
              </div>
              <div style={{ color: T.muted, fontSize: '12px', fontFamily: T.font, lineHeight: 1.6 }}>
                Coming soon — Capture and share visual snapshots of the tracker with highlighted signals and market movements.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
