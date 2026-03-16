// ── HSI Theme Constants ──────────────────────────────────────
// Shared across Dashboard, ShareStudio, and other components.

export const T = {
  bg: '#0b0f19',
  panel: '#141a2a',
  hover: '#1a2133',
  border: '#1f2636',
  accent: '#00e5ff',
  text: '#e6edf7',
  textSecondary: '#94a3b8',
  muted: '#64748b',
  font: 'Inter, "Segoe UI", Arial, sans-serif',
} as const;

export const BADGE_COLORS: Record<string, string> = {
  'DOUBLE NO-NARRATIVE RLM': '#00ff9c',
  'NO-NARRATIVE RLM': '#00ff9c',
  RLM: '#00ff9c',
  'STEAM MOVE': '#ff9f1c',
  STEAM: '#ff9f1c',
  'FROZEN LINE': '#a855f7',
  FREEZE: '#a855f7',
  'BOOK SHADE': '#ff4d4d',
  'CONTRA MOVE': '#ff4d4d',
  ALERT: '#ff4d4d',
  RESISTANCE: '#38bdf8',
  'FAKE STEAM': '#facc15',
};

export const STATUS_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  PASS: { bg: '#1a2e1a', text: '#4ade80' },
  WATCH: { bg: '#2e2a1a', text: '#facc15' },
  ACTIVE: { bg: '#1a1a2e', text: '#00e5ff' },
};

export const CONFIDENCE_COLORS: Record<string, string> = {
  Low: '#64748b',
  Moderate: '#facc15',
  High: '#00e5ff',
};
