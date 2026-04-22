// ══════════════════════════════════════════════════════════════════════════════
//  HEARD Alert Read Helpers
//
//  Consumers (HSA prompt, UI) use these to pull first-fire facts paired with
//  the latest trajectory observation, without knowing the two-table shape.
//
//  Unresolved-only: getHeardAlertsForGames filters to rows where
//  resolved_at IS NULL. Trajectory queries (getHeardAlertHistory) return the
//  full ordered observation series for a given alert, regardless of resolution.
// ══════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type HeardAlertObservation = {
  id: string;
  heard_alert_id: string;
  observed_at: string;
  avg_delta_cents: number | null;
  confidence: number | null;
  participation_rate: number | null;
  sharp_side: string | null;
  leading_book: string | null;
  books_moved_count: number | null;
  direction_vs_first: string | null;
  magnitude_delta_vs_first: number | null;
};

export type HeardAlertRecord = {
  id: string;
  game_id: string;
  alert_type: string;
  first_detected_at: string;
  first_sharp_side: string;
  first_avg_delta_cents: number;
  first_confidence: number;
  first_leading_book: string | null;
  game_starts_at: string | null;
  resolved_at: string | null;
};

export type HeardAlertWithTrajectory = {
  alert: HeardAlertRecord;
  latest: {
    observed_at: string;
    avg_delta_cents: number;
    confidence: number;
    sharp_side: string;
    direction_vs_first: string;
    magnitude_delta_vs_first: number;
  };
  observation_count: number;
};

type RawAlertRow = HeardAlertRecord & {
  heard_alert_observations: HeardAlertObservation[] | null;
};

/**
 * Fetch unresolved HEARD alerts for a set of game IDs, each paired with its
 * latest observation and an observation count. A game may have multiple alerts
 * of different types (e.g. HEARD_ALERT_MLB and HEARD_ALERT_TOTAL_MLB) — each
 * returns as its own entry.
 *
 * Empty gameIds array returns [] without querying.
 */
export async function getHeardAlertsForGames(
  supabase: SupabaseClient,
  gameIds: string[]
): Promise<HeardAlertWithTrajectory[]> {
  if (gameIds.length === 0) return [];

  const { data, error } = await supabase
    .from('heard_alerts')
    .select(
      `
        id,
        game_id,
        alert_type,
        first_detected_at,
        first_sharp_side,
        first_avg_delta_cents,
        first_confidence,
        first_leading_book,
        game_starts_at,
        resolved_at,
        heard_alert_observations (
          id,
          heard_alert_id,
          observed_at,
          avg_delta_cents,
          confidence,
          participation_rate,
          sharp_side,
          leading_book,
          books_moved_count,
          direction_vs_first,
          magnitude_delta_vs_first
        )
      `
    )
    .in('game_id', gameIds)
    .is('resolved_at', null);

  if (error) {
    console.error('[heard-alert-query] getHeardAlertsForGames failed', {
      gameIds,
      error: error.message ?? error,
    });
    return [];
  }

  const rows = (data ?? []) as RawAlertRow[];
  const out: HeardAlertWithTrajectory[] = [];

  for (const row of rows) {
    const observations = row.heard_alert_observations ?? [];
    if (observations.length === 0) {
      // No observations yet — alert exists but trajectory query skips it
      // because UI has nothing useful to render. Persistence ensures the
      // initial observation is always written alongside first fire, so this
      // branch only hits if the observation insert fails post-first-fire.
      continue;
    }

    // Sort observations by observed_at DESC to pick the latest.
    const sorted = [...observations].sort((a, b) => {
      if (a.observed_at < b.observed_at) return 1;
      if (a.observed_at > b.observed_at) return -1;
      return 0;
    });
    const latest = sorted[0];

    out.push({
      alert: {
        id: row.id,
        game_id: row.game_id,
        alert_type: row.alert_type,
        first_detected_at: row.first_detected_at,
        first_sharp_side: row.first_sharp_side,
        first_avg_delta_cents: row.first_avg_delta_cents,
        first_confidence: row.first_confidence,
        first_leading_book: row.first_leading_book,
        game_starts_at: row.game_starts_at,
        resolved_at: row.resolved_at,
      },
      latest: {
        observed_at: latest.observed_at,
        avg_delta_cents: latest.avg_delta_cents ?? 0,
        confidence: latest.confidence ?? 0,
        sharp_side: latest.sharp_side ?? '',
        direction_vs_first: latest.direction_vs_first ?? 'initial',
        magnitude_delta_vs_first: latest.magnitude_delta_vs_first ?? 0,
      },
      observation_count: observations.length,
    });
  }

  return out;
}

/**
 * Fetch the full observation history for a single HEARD alert, ordered
 * oldest → newest. Used by trajectory views that need to render a timeline.
 */
export async function getHeardAlertHistory(
  supabase: SupabaseClient,
  alertId: string
): Promise<HeardAlertObservation[]> {
  const { data, error } = await supabase
    .from('heard_alert_observations')
    .select(
      'id, heard_alert_id, observed_at, avg_delta_cents, confidence, participation_rate, sharp_side, leading_book, books_moved_count, direction_vs_first, magnitude_delta_vs_first'
    )
    .eq('heard_alert_id', alertId)
    .order('observed_at', { ascending: true });

  if (error) {
    console.error('[heard-alert-query] getHeardAlertHistory failed', {
      alertId,
      error: error.message ?? error,
    });
    return [];
  }

  return (data ?? []) as HeardAlertObservation[];
}
