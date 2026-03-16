import { useState, useEffect, useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { T } from '../lib/theme';
import {
  generateAlertPost,
  generateSignalPost,
  generateExplainMove,
  deriveConfidenceLabel,
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

// ── Export Card Component (rendered offscreen for PNG capture) ──

function ExportCard({ game, tab, alertOptions, signalOptions }: {
  game: GameView;
  tab: ShareTab;
  alertOptions: AlertOptions;
  signalOptions: SignalOptions;
}) {
  const isSignal = tab === 'signal';
  const moveAmt = game.lineMoveAmount != null
    ? Math.abs(game.lineMoveAmount)
    : (game.openingSpread != null && game.currentSpread != null)
      ? Math.abs(game.currentSpread - game.openingSpread)
      : 0;
  const movedToward = (game.openingSpread != null && game.currentSpread != null && game.currentSpread < game.openingSpread)
    ? game.homeTeam : game.awayTeam;

  return (
    <div style={{
      width: '1200px',
      height: '675px',
      background: 'linear-gradient(135deg, #0b0f19 0%, #141a2a 50%, #0d1420 100%)',
      padding: '60px',
      fontFamily: T.font,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #00e5ff, #0088aa)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: '18px',
          color: '#000',
          fontFamily: T.font,
        }}>
          HSI
        </div>
        <span style={{ color: T.muted, fontSize: '18px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Heard Sports Intelligence
        </span>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' }}>
        {/* Badge */}
        <div style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          background: isSignal ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 159, 28, 0.15)',
          border: `1px solid ${isSignal ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255, 159, 28, 0.4)'}`,
          color: isSignal ? T.accent : '#ff9f1c',
          padding: '8px 20px',
          borderRadius: '6px',
          fontSize: '22px',
          fontWeight: 800,
          letterSpacing: '0.08em',
        }}>
          {isSignal ? 'HSI SIGNAL' : 'MARKET MOVE'}
        </div>

        {/* Matchup */}
        <div style={{ color: T.text, fontSize: '42px', fontWeight: 800, lineHeight: 1.2 }}>
          {game.awayTeam} @ {game.homeTeam}
        </div>

        {/* Spread info */}
        {game.openingSpread != null && game.currentSpread != null && (
          <div style={{ color: T.textSecondary, fontSize: '28px', fontWeight: 600 }}>
            {formatSpread(game.openingSpread)} {'\u2192'} {formatSpread(game.currentSpread)}
            <span style={{ color: T.muted, fontSize: '22px', marginLeft: '12px' }}>
              ({moveAmt.toFixed(1)} pt move toward {movedToward})
            </span>
          </div>
        )}

        {/* Data row */}
        <div style={{ display: 'flex', gap: '32px', marginTop: '8px' }}>
          {!isSignal && alertOptions.showTicketPct && game.awayBetsPct != null && game.publicBetsPct != null && (
            <div style={{ color: T.muted, fontSize: '22px' }}>
              Tickets: {game.awayBetsPct}% / {game.publicBetsPct}%
            </div>
          )}
          {!isSignal && alertOptions.showMoneyPct && game.awayMoneyPct != null && game.publicMoneyPct != null && (
            <div style={{ color: T.muted, fontSize: '22px' }}>
              Money: {game.awayMoneyPct}% / {game.publicMoneyPct}%
            </div>
          )}
          {!isSignal && alertOptions.showBookCount && game.booksAgreeing != null && game.totalBooks != null && (
            <div style={{ color: T.muted, fontSize: '22px' }}>
              Books: {game.booksAgreeing}/{game.totalBooks}
            </div>
          )}
          {isSignal && signalOptions.showConfidence && game.signalTier && (
            <div style={{ color: T.accent, fontSize: '22px', fontWeight: 700 }}>
              Confidence: {deriveConfidenceLabel(game.signalTier)}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${T.border}`, paddingTop: '20px' }}>
        <span style={{ color: T.muted, fontSize: '18px', fontWeight: 600 }}>HSI Market Tracker</span>
        <span style={{ color: T.muted, fontSize: '16px' }}>
          {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </div>
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
  const exportRef = useRef<HTMLDivElement>(null);

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
      // Fallback for older browsers
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

  // Export PNG — uses a temporarily visible offscreen clone for reliable capture
  const handleExportPng = useCallback(async () => {
    if (!exportRef.current || exporting) return;
    setExporting(true);
    try {
      // Clone the export card into a temporary container that's visible but offscreen.
      // html-to-image needs the element in the visible DOM with real dimensions.
      // Move the offscreen container into a visible (but user-hidden) position
      // so html-to-image can capture it with full opacity.
      // We position it behind the Share Studio drawer at z-index 0.
      const el = exportRef.current;
      const prevLeft = el.style.left;
      el.style.left = '-2000px';
      el.style.top = '0';
      el.style.zIndex = '0';

      // Small delay to let browser lay out
      await new Promise((r) => setTimeout(r, 50));

      const dataUrl = await toPng(el, {
        width: 1200,
        height: 675,
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true,
      });

      // Move it back offscreen
      el.style.left = prevLeft;

      const link = document.createElement('a');
      link.download = `hsi-${activeTab}-${game.awayTeam}-${game.homeTeam}.png`
        .replace(/\s+/g, '-')
        .toLowerCase();
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [activeTab, game, exporting]);

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

      {/* Hidden export container (offscreen, must have real dimensions for cloning) */}
      <div
        ref={exportRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '0',
          width: '1200px',
          height: '675px',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <ExportCard
          game={game}
          tab={activeTab}
          alertOptions={alertOptions}
          signalOptions={signalOptions}
        />
      </div>
    </>
  );
}
