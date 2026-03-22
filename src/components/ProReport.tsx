import React, { useState } from 'react';
import { T } from '../lib/theme';
import type { GameView } from '../types';

// ── Types ──────────────────────────────────────────────────────
type MarketTab = 'spread' | 'total' | 'moneyline';
type SignalKey = 'bigMoney' | 'sharpAction' | 'steam' | 'systems' | 'prosVsJoes';

interface SplitData {
  side1Label: string;
  side2Label: string;
  side1BetPct: number | null;
  side2BetPct: number | null;
  side1MoneyPct: number | null;
  side2MoneyPct: number | null;
  side1Odds: string;
  side2Odds: string;
  columnLabel: string; // "TEAM" or "SIDE"
}

interface SignalResult {
  side1Active: boolean;
  side2Active: boolean;
}

// ── Signal Definitions ─────────────────────────────────────────
const SIGNAL_DEFS: { key: SignalKey; label: string; icon: string; color: string }[] = [
  { key: 'bigMoney', label: 'Big Money', icon: '$', color: '#4ade80' },
  { key: 'sharpAction', label: 'Sharp Action', icon: '/', color: '#f472b6' },
  { key: 'steam', label: 'Steam', icon: '\u2697', color: '#818cf8' },
  { key: 'systems', label: 'Systems', icon: '#', color: '#38bdf8' },
  { key: 'prosVsJoes', label: 'Pros vs Joes', icon: '\u2694', color: '#fb923c' },
];

// ── Helpers ────────────────────────────────────────────────────
function formatSpread(spread: number | null): string {
  if (spread == null) return '—';
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function formatMoneyline(ml: number | null): string {
  if (ml == null) return '—';
  return ml > 0 ? `+${ml}` : `${ml}`;
}

function formatTotal(total: number | null, side: 'over' | 'under'): string {
  if (total == null) return '—';
  return `${side === 'over' ? 'o' : 'u'}${total}`;
}

/** Derive split data for each market tab. */
function getSplitData(game: GameView, tab: MarketTab): SplitData {
  switch (tab) {
    case 'spread':
      return {
        side1Label: game.awayTeam,
        side2Label: game.homeTeam,
        side1BetPct: game.awayBetsPct ?? (game.publicBetsPct != null ? 100 - game.publicBetsPct : null),
        side2BetPct: game.publicBetsPct,
        side1MoneyPct: game.awayMoneyPct ?? (game.publicMoneyPct != null ? 100 - game.publicMoneyPct : null),
        side2MoneyPct: game.publicMoneyPct,
        side1Odds: game.currentSpread != null ? formatSpread(-(game.currentSpread)) : '—',
        side2Odds: game.currentSpread != null ? formatSpread(game.currentSpread) : '—',
        columnLabel: 'TEAM',
      };
    case 'total':
      return {
        side1Label: 'Over',
        side2Label: 'Under',
        side1BetPct: game.overTicketPct,
        side2BetPct: game.underTicketPct,
        side1MoneyPct: game.overMoneyPct,
        side2MoneyPct: game.underMoneyPct,
        side1Odds: formatTotal(game.currentTotal, 'over'),
        side2Odds: formatTotal(game.currentTotal, 'under'),
        columnLabel: 'SIDE',
      };
    case 'moneyline':
      return {
        side1Label: game.awayTeam,
        side2Label: game.homeTeam,
        side1BetPct: game.mlAwayTicketPct,
        side2BetPct: game.mlHomeTicketPct,
        side1MoneyPct: game.mlAwayMoneyPct,
        side2MoneyPct: game.mlHomeMoneyPct,
        side1Odds: formatMoneyline(game.moneylineAway),
        side2Odds: formatMoneyline(game.moneylineHome),
        columnLabel: 'TEAM',
      };
  }
}

/** Count how many PRO signals are active for a given market tab. */
function countSignals(game: GameView, tab: MarketTab): number {
  const signals = computeSignals(game, tab);
  let count = 0;
  for (const s of Object.values(signals)) {
    if (s.side1Active || s.side2Active) count++;
  }
  return count;
}

/** Compute all 5 PRO signals for a market tab. */
function computeSignals(game: GameView, tab: MarketTab): Record<SignalKey, SignalResult> {
  const data = getSplitData(game, tab);

  // Big Money: money% significantly higher than bet% (4%+ diff)
  const BIG_MONEY_THRESHOLD = 4;
  const side1MoneyDiff = (data.side1MoneyPct ?? 0) - (data.side1BetPct ?? 0);
  const side2MoneyDiff = (data.side2MoneyPct ?? 0) - (data.side2BetPct ?? 0);
  const hasSplitData = data.side1BetPct != null && data.side1MoneyPct != null;

  const bigMoney: SignalResult = {
    side1Active: hasSplitData && side1MoneyDiff >= BIG_MONEY_THRESHOLD,
    side2Active: hasSplitData && side2MoneyDiff >= BIG_MONEY_THRESHOLD,
  };

  // Sharp Action: derived from signal tier and sharp team
  const isSharpSpread = tab === 'spread' && (game.signalTier === 'SHARP ACCUMULATION' || isRlmLike(game.signalTier));
  const isSharpTotal = tab === 'total' && game.totalSignalType != null;
  const sharpAction: SignalResult = {
    side1Active: isSharpSpread && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.awayTeam),
    side2Active: isSharpSpread && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.homeTeam),
  };
  if (isSharpTotal && tab === 'total') {
    // If total signal exists, sharp is on the over side (line moved down = under sharp, moved up = over sharp)
    const totalMoveDown = (game.totalMove ?? 0) < 0;
    sharpAction.side1Active = !totalMoveDown; // over
    sharpAction.side2Active = totalMoveDown;   // under
  }

  // Steam: from STEAM MOVE signal on spread, or significant total move
  const isSteamSignal = game.signalTier === 'STEAM MOVE';
  const steam: SignalResult = {
    side1Active: tab === 'spread' && isSteamSignal && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.awayTeam),
    side2Active: tab === 'spread' && isSteamSignal && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.homeTeam),
  };
  if (tab === 'total' && Math.abs(game.totalMove ?? 0) >= 2) {
    steam.side1Active = (game.totalMove ?? 0) > 0;
    steam.side2Active = (game.totalMove ?? 0) < 0;
  }

  // Systems: from line resistance or frozen line signals
  const systems: SignalResult = {
    side1Active: tab === 'spread' && game.isResistance && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.awayTeam),
    side2Active: tab === 'spread' && game.isResistance && game.sharpTeam != null && normalizeTeam(game.sharpTeam) === normalizeTeam(game.homeTeam),
  };
  if (tab === 'spread' && game.signalTier === 'FROZEN LINE') {
    systems.side1Active = true; // Frozen = system signal present
  }

  // Pros vs Joes: when professional money disagrees with public bets
  const PROS_THRESHOLD = 10;
  const prosVsJoes: SignalResult = {
    side1Active: hasSplitData && (data.side1BetPct ?? 0) < 40 && side1MoneyDiff >= PROS_THRESHOLD,
    side2Active: hasSplitData && (data.side2BetPct ?? 0) < 40 && side2MoneyDiff >= PROS_THRESHOLD,
  };

  return { bigMoney, sharpAction, steam, systems, prosVsJoes };
}

function isRlmLike(tier: string | null | undefined): boolean {
  return tier === 'DOUBLE NO-NARRATIVE RLM' || tier === 'NO-NARRATIVE RLM';
}

function normalizeTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Sub-Components ─────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: '100%', height: 4, background: '#1f2636', borderRadius: 2, marginTop: 3 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  );
}

function SignalIcon({ icon, active, onClick, selected }: { icon: string; active: boolean; onClick: () => void; selected: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 42,
        height: 42,
        borderRadius: 6,
        border: selected ? '2px solid #00a8ff' : '1px solid #1f2636',
        background: active ? '#0066ff' : '#141a2a',
        color: active ? '#fff' : '#64748b',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        fontWeight: 700,
        fontFamily: T.font,
        transition: 'all 0.15s',
      }}
    >
      {icon}
    </button>
  );
}

function TabBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      borderRadius: 4,
      background: '#0066ff',
      color: '#fff',
      fontSize: 10,
      fontWeight: 800,
      marginLeft: 6,
      fontFamily: T.font,
    }}>
      {count}
    </span>
  );
}

// ── Detail Panel ───────────────────────────────────────────────

function SignalDetailPanel({ signalKey, game, tab }: { signalKey: SignalKey; game: GameView; tab: MarketTab }) {
  const def = SIGNAL_DEFS.find(d => d.key === signalKey)!;
  const data = getSplitData(game, tab);
  const diff1 = data.side1MoneyPct != null && data.side1BetPct != null
    ? data.side1MoneyPct - data.side1BetPct : null;
  const diff2 = data.side2MoneyPct != null && data.side2BetPct != null
    ? data.side2MoneyPct - data.side2BetPct : null;

  return (
    <div style={{
      background: '#0066ff',
      borderRadius: 12,
      padding: '16px 14px 14px',
      marginTop: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: '#fff',
        }}>
          {def.icon}
        </div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 16, fontFamily: T.font }}>{def.label}</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '80px 70px 70px 60px 80px',
        gap: 4,
        marginBottom: 8,
      }}>
        <span style={colHeader}>{data.columnLabel}</span>
        <span style={colHeader}>BET %</span>
        <span style={colHeader}>$$</span>
        <span style={colHeader}>DIFF</span>
        <span style={colHeader}>ODDS</span>
      </div>

      {/* Side 1 */}
      <SplitRow
        label={data.side1Label}
        betPct={data.side1BetPct}
        moneyPct={data.side1MoneyPct}
        diff={diff1}
        odds={data.side1Odds}
        isTeam={data.columnLabel === 'TEAM'}
        tab={tab}
      />

      {/* Side 2 */}
      <SplitRow
        label={data.side2Label}
        betPct={data.side2BetPct}
        moneyPct={data.side2MoneyPct}
        diff={diff2}
        odds={data.side2Odds}
        isTeam={data.columnLabel === 'TEAM'}
        tab={tab}
      />
    </div>
  );
}

const colHeader: React.CSSProperties = {
  color: 'rgba(255,255,255,0.6)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontFamily: T.font,
};

function SplitRow({ label, betPct, moneyPct, diff, odds, isTeam, tab }: {
  label: string; betPct: number | null; moneyPct: number | null; diff: number | null;
  odds: string; isTeam: boolean; tab: MarketTab;
}) {
  const shortLabel = isTeam ? label.split(' ').pop() ?? label : label;
  const showDiff = diff != null && Math.abs(diff) >= 1;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '80px 70px 70px 60px 80px',
      gap: 4,
      alignItems: 'center',
      padding: '8px 0',
    }}>
      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!isTeam && (
          <span style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: T.font,
          }}>
            {label === 'Over' ? 'O' : 'U'}
          </span>
        )}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: T.font }}>
          {isTeam ? shortLabel : label}
        </span>
      </div>

      {/* Bet % */}
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: T.font }}>
          {betPct != null ? `${Math.round(betPct)}%` : '—'}
        </div>
        {betPct != null && <ProgressBar pct={betPct} color="rgba(255,255,255,0.5)" />}
      </div>

      {/* Money % */}
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: T.font }}>
          {moneyPct != null ? `${Math.round(moneyPct)}%` : '—'}
        </div>
        {moneyPct != null && <ProgressBar pct={moneyPct} color="rgba(255,255,255,0.4)" />}
      </div>

      {/* Diff */}
      <div>
        {showDiff ? (
          <>
            <div style={{ color: '#00e5ff', fontWeight: 700, fontSize: 13, fontFamily: T.font }}>
              +{Math.round(Math.abs(diff!))}%
            </div>
            <ProgressBar pct={Math.abs(diff!)} color="#00e5ff" />
          </>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: T.font }}>—</div>
        )}
      </div>

      {/* Odds */}
      <div style={{
        background: 'rgba(0,0,0,0.25)',
        borderRadius: 6,
        padding: '4px 8px',
        textAlign: 'center',
      }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: T.font }}>
          {odds}
        </div>
        {tab !== 'moneyline' && (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: T.font }}>-110</div>
        )}
        {tab === 'moneyline' && (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: T.font }}>ML</div>
        )}
      </div>
    </div>
  );
}

// ── Main ProReport Component ───────────────────────────────────

export function ProReport({ game, onClose }: { game: GameView; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<MarketTab>('spread');
  const [selectedSignal, setSelectedSignal] = useState<SignalKey>('bigMoney');

  const spreadCount = countSignals(game, 'spread');
  const totalCount = countSignals(game, 'total');
  const mlCount = countSignals(game, 'moneyline');

  const signals = computeSignals(game, activeTab);

  const isTotalTab = activeTab === 'total';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg,
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '16px 16px 0 0',
          padding: '0 0 20px',
        }}
      >
        {/* Game Header */}
        <div style={{
          padding: '16px 16px 12px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.text, fontSize: 20, cursor: 'pointer', padding: 4 }}>
            &times;
          </button>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ color: T.text, fontWeight: 800, fontSize: 16, fontFamily: T.font }}>
              {game.awayTeam} @ {game.homeTeam}
            </div>
            <div style={{ color: T.muted, fontSize: 11, fontFamily: T.font }}>
              {game.numBets != null ? `${(game.numBets / 1000).toFixed(1)}k bets` : ''}
            </div>
          </div>
          <div style={{ width: 28 }} /> {/* spacer for alignment */}
        </div>

        {/* PRO Report Title */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: '#0066ff', fontWeight: 800, fontSize: 18, fontFamily: T.font }}>PRO </span>
            <span style={{ color: T.text, fontWeight: 800, fontSize: 18, fontFamily: T.font }}>Report</span>
          </div>

          {/* Market Tabs */}
          <div style={{
            display: 'flex',
            background: T.panel,
            borderRadius: 25,
            padding: 3,
            marginBottom: 16,
          }}>
            {([
              { key: 'spread' as MarketTab, label: 'Spread', count: spreadCount },
              { key: 'total' as MarketTab, label: 'Total', count: totalCount },
              { key: 'moneyline' as MarketTab, label: 'Moneyline', count: mlCount },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 22,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: T.font,
                  fontSize: 13,
                  fontWeight: activeTab === key ? 700 : 500,
                  background: activeTab === key ? T.hover : 'transparent',
                  color: activeTab === key ? T.text : T.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {label}
                <TabBadge count={count} />
              </button>
            ))}
          </div>

          {/* Signal Grid */}
          <div style={{ marginBottom: 8 }}>
            {/* Side 1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 80, color: T.text, fontWeight: 700, fontSize: 13, fontFamily: T.font }}>
                {isTotalTab ? 'Over' : game.awayTeam.split(' ').pop()}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {SIGNAL_DEFS.map(({ key, icon }) => (
                  <SignalIcon
                    key={key}
                    icon={icon}
                    active={signals[key].side1Active}
                    selected={selectedSignal === key}
                    onClick={() => setSelectedSignal(key)}
                  />
                ))}
              </div>
            </div>

            {/* Side 2 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 80, color: T.text, fontWeight: 700, fontSize: 13, fontFamily: T.font }}>
                {isTotalTab ? 'Under' : game.homeTeam.split(' ').pop()}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {SIGNAL_DEFS.map(({ key, icon }) => (
                  <SignalIcon
                    key={key}
                    icon={icon}
                    active={signals[key].side2Active}
                    selected={selectedSignal === key}
                    onClick={() => setSelectedSignal(key)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Detail Panel */}
          <SignalDetailPanel signalKey={selectedSignal} game={game} tab={activeTab} />
        </div>
      </div>
    </div>
  );
}
