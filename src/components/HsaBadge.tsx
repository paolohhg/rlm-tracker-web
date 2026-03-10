import type { HsaStatus } from '../types';

interface Props {
  status: HsaStatus;
}

export function HsaBadge({ status }: Props) {
  const config = {
    no_narrative: { label: 'NO NARRATIVE', color: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.2)' },
    narrative:    { label: 'NARRATIVE',    color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.2)' },
    pending:      { label: 'HSA PENDING',  color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.15)' },
  }[status];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 8px',
      borderRadius: '4px',
      background: config.bg,
      border: `1px solid ${config.border}`,
      color: config.color,
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      fontFamily: 'monospace',
    }}>
      {status === 'no_narrative' && '✦ '}
      {config.label}
    </span>
  );
}
