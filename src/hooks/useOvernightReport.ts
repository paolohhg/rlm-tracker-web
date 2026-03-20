// ══════════════════════════════════════════════════════════════════════════════
//  useOvernightReport — Fetches stored overnight report from API
//
//  Reads from /api/overnight-report (never triggers generation).
//  Supports league switching and admin mode for debug view.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';

export interface ReportPayload {
  headline: string;
  quick_stats: {
    games_tracked: number;
    significant_moves: number;
    coordinated_moves: number;
    frozen_lines: number;
    window: string;
  };
  top_signals: {
    game: string;
    signal: string;
    detail: string;
    strength: number;
  }[];
  frozen_line_watch: {
    gameKey: string;
    home_team: string;
    away_team: string;
    book: string;
    market: string;
    value: number | null;
    frozen_snapshots: number;
    note: string;
  }[];
  market_themes: string[];
  what_to_watch: {
    game: string;
    reason: string;
  }[];
  generated_at: string;
}

export interface ReportMeta {
  league: string;
  date: string;
  status: 'pending' | 'complete' | 'failed' | 'insufficient_data';
  generated_at: string;
  snapshot_count: number;
  game_count: number;
  error_message?: string;
}

export interface ReportDebug {
  id: string;
  window_start: string;
  window_end: string;
  computed_stats: any;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface UseOvernightReportResult {
  report: ReportPayload | null;
  meta: ReportMeta | null;
  debug: ReportDebug | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOvernightReport(
  league: string,
  options?: { date?: string; admin?: boolean },
): UseOvernightReportResult {
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [debug, setDebug] = useState<ReportDebug | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ league });
      if (options?.date) params.set('date', options.date);
      if (options?.admin) params.set('admin', 'true');

      const res = await fetch(`/api/overnight-report?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setReport(null);
        setMeta(null);
        setDebug(null);
      } else {
        setReport(data.report || null);
        setMeta(data.meta || null);
        setDebug(data.debug || null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch report');
      setReport(null);
      setMeta(null);
      setDebug(null);
    } finally {
      setLoading(false);
    }
  }, [league, options?.date, options?.admin]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return { report, meta, debug, loading, error, refetch: fetchReport };
}
