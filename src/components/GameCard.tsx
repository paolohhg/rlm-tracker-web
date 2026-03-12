import type { GameView } from '../types';
import { SignalBadge } from './SignalBadge';
import { HsaBadge } from './HsaBadge';
import { TeamLogo } from './TeamLogo';

interface Props {
  game: GameView;
}

function formatTimeToTip(minutes: number, status: string): string {
  if (status === 'live') return 'LIVE';
  if (status === 'final') return 'FINAL';
  if (minutes <= 0) return 'LIVE';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatSpread(spread: number | null): string {
  if (spread === null) return '—';
  if (spread === 0) return 'PK';
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function formatMoveDir(move: number | null, homeTeam: string, awayTeam: string): string {
  if (move === null || move === 0) return '';
  const pts = Math.abs(move).toFixed(1);
  const toward = move > 0 ? awayTeam : homeTeam;
  return `${pts} pts → ${toward.split(' ').pop()}`;
}

function getUrgencyColor(minutes: number, status: string): string {
  if (status === 'live') return '#22c55e';
  if (status === 'final') return '#475569';
  if (minutes < 30) return '#ff4444';
  if (minutes < 90) return '#f59e0b';
  return '#64748b';
}

function getSignalStrength(tier: string | null): number {
  const ranks: Record<string, number> = {
    'DOUBLE NO-NARRATIVE RLM': 5,
    'NO-NARRATIVE RLM': 4,
    'STEAM MOVE': 3,
    'FROZEN LINE': 3,
    'BOOK SHADE': 2,
    'CONTRA MOVE': 2,
    'WATCH': 1,
    'TRACKING': 0,
  };
  return ranks[tier ?? 'TRACKING'] ?? 0;
}

export function GameCard({ game }: Props) {
  const ttLabel = formatTimeToTip(game.timeToTipMinutes, game.status);
  const urgColor = getUrgencyColor(game.timeToTipMinutes, game.status);
  const strength = getSignalStrength(game.signalTier);
  const isHighPriority = strength >= 3;

  return (
    <div style={{
      background: isHighPriority ? 'rgba(255,107,53,0.04)' : 'rgba(255,255,255,0.02)',
      border: isHighPriority ? '1px solid rgba(255,107,53,0.2)' : '1px solid rgba(255,255,255,0.06)',
      borderRadius: '8px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      transition: 'border-color 0.2s, background 0.2s',
      cursor: 'default',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.borderColor = isHighPriority ? 'rgba(255,107,53,0.4)' : 'rgba(255,255,255,0.12)';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.borderColor = isHighPriority ? 'rgba(255,107,53,0.2)' : 'rgba(255,255,255,0.06)';
    }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <TeamLogo teamName={game.awayTeam} league={game.league} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em', fontFamily: '"DM Mono", monospace' }}>
              {game.awayTeam} <span style={{ color: '#475569', fontWeight: 400 }}>@</span> {game.homeTeam}
            </span>
            <TeamLogo teamName={game.homeTeam} league={game.league} />
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.15)', padding: '1px 6px', borderRadius: '3px', letterSpacing: '0.05em' }}>
              {game.league}
            </span>
          </div>
          <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <SignalBadge tier={game.signalTier} />
            <HsaBadge status={game.hsaStatus} />
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: urgColor, fontFamily: '"DM Mono", monospace', letterSpacing: '-0.02em', lineHeight: 1 }}>
            {ttLabel}
          </div>
          <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px', letterSpacing: '0.04em' }}>
            {game.status === 'upcoming' && game.timeToTipMinutes > 0 ? 'TO TIP' : game.status === 'live' ? 'IN PROGRESS' : 'COMPLETED'}
          </div>
        </div>
      </div>

      {(game.openingSpread !== null || game.currentSpread !== null) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: '#475569', letterSpacing: '0.06em' }}>OPEN</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>{formatSpread(game.openingSpread)}</span>
          </div>
          {game.openingSpread !== null && game.currentSpread !== null && (
            <span style={{ color: '#334155', fontSize: '12px' }}>→</span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: '#475569', letterSpacing: '0.06em' }}>NOW</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{formatSpread(game.currentSpread)}</span>
          </div>
          {game.lineMoveAmount !== null && game.lineMoveAmount !== 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 600, color: '#f0c040', fontFamily: 'monospace' }}>
              {formatMoveDir(game.lineMoveAmount, game.homeTeam, game.awayTeam)}
            </span>
          )}
          {game.booksAgreeing !== null && game.booksAgreeing > 0 && (
            <span style={{ fontSize: '10px', color: '#475569' }}>{game.booksAgreeing}/{game.totalBooks} books</span>
          )}
        </div>
      )}

      {game.sharpTeam && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#475569', letterSpacing: '0.06em' }}>SHARP LEAN</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f1f5f9', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
            {game.sharpTeam}
          </span>
          {game.fadeTeam && (
            <span style={{ fontSize: '10px', color: '#334155' }}>fade: {game.fadeTeam.split(' ').pop()}</span>
          )}
        </div>
      )}

      {game.hsaSnippet && (
        <div style={{ padding: '8px 10px', background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.1)', borderRadius: '6px', fontSize: '11px', color: '#86efac', lineHeight: 1.5, fontStyle: 'italic' }}>
          {game.hsaSnippet}{game.hsaSnippet.length >= 120 && '…'}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {game.isLocked && <span style={{ fontSize: '10px', color: '#475569' }}>🔒 LOCKED</span>}
          {game.scenarioKey && <span style={{ fontSize: '9px', color: '#334155', fontFamily: 'monospace' }}>{game.scenarioKey.slice(0, 30)}</span>}
        </div>
        <span style={{ fontSize: '10px', color: '#334155' }}>
          {new Date(game.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
