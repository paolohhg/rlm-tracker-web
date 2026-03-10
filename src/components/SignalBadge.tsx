import type { SignalTier } from '../types';

interface Props {
  tier: SignalTier;
  size?: 'sm' | 'md';
}

const SIGNAL_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  'DOUBLE NO-NARRATIVE RLM': { label: 'DOUBLE RLM', color: '#ff2d2d', bg: 'rgba(255,45,45,0.12)', dot: '#ff2d2d' },
  'NO-NARRATIVE RLM':        { label: 'RLM',         color: '#ff6b35', bg: 'rgba(255,107,53,0.12)', dot: '#ff6b35' },
  'STEAM MOVE':              { label: 'STEAM',        color: '#f0c040', bg: 'rgba(240,192,64,0.12)', dot: '#f0c040' },
  'BOOK SHADE':              { label: 'SHADE',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', dot: '#a78bfa' },
  'FROZEN LINE':             { label: 'FROZEN',       color: '#60c8ff', bg: 'rgba(96,200,255,0.12)', dot: '#60c8ff' },
  'CONTRA MOVE':             { label: 'CONTRA',       color: '#34d399', bg: 'rgba(52,211,153,0.12)', dot: '#34d399' },
  'WATCH':                   { label: 'WATCH',        color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', dot: '#94a3b8' },
  'TRACKING':                { label: 'TRACKING',     color: '#475569', bg: 'rgba(71,85,105,0.08)', dot: '#475569' },
};

export function SignalBadge({ tier, size = 'md' }: Props) {
  const key = tier ?? 'TRACKING';
  const cfg = SIGNAL_CONFIG[key] ?? SIGNAL_CONFIG['TRACKING'];
  const isSmall = size === 'sm';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: isSmall ? '4px' : '6px',
      padding: isSmall ? '2px 7px' : '3px 10px',
      borderRadius: '4px',
      background: cfg.bg,
      border: `1px solid ${cfg.color}22`,
      color: cfg.color,
      fontSize: isSmall ? '10px' : '11px',
      fontWeight: 700,
      letterSpacing: '0.08em',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: isSmall ? '5px' : '6px',
        height: isSmall ? '5px' : '6px',
        borderRadius: '50%',
        background: cfg.dot,
        flexShrink: 0,
      }} />
      {cfg.label}
    </span>
  );
}
