// ══════════════════════════════════════════════════════════════════════════════
//  HEARD ALERT Persistence
//
//  First-fire inserts a durable row into heard_alerts; subsequent detections
//  append to heard_alert_observations with a direction_vs_first diagnostic so
//  UIs can render trajectories ("HEARD fired 2h ago at 47c, now at 65c
//  CONFIRMING").
//
//  Persistence failures NEVER throw — detection must keep running even if the
//  DB is momentarily unreachable.
// ══════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type HeardAlertType =
  | 'HEARD_ALERT_MLB'
  | 'HEARD_ALERT_NHL'
  | 'HEARD_ALERT_TOTAL_MLB'
  | 'HEARD_ALERT_TOTAL_NHL';

export type DirectionVsFirst =
  | 'confirmation'
  | 'drift'
  | 'reversal'
  | 'flat'
  | 'initial';

// Magnitude band within which "no change" holds. Matches product intent:
// observations that move the absolute delta by <=2 cents vs first-fire are
// considered flat noise. Outside that band, growth = confirmation, shrink =
// drift. A sharp-side flip always beats magnitude semantics → reversal.
const FLAT_BAND_CENTS = 2;

export type PersistHeardAlertParams = {
  gameId: string;
  alertType: HeardAlertType;
  sharpSide: string;
  avgDeltaCents: number;
  confidence: number;
  participationRate: number;
  leadingBook: string | null;
  booksMovedCount: number;
  gameStartsAt: string | null;
};

type HeardAlertRow = {
  id: string;
  first_sharp_side: string | null;
  first_avg_delta_cents: number | null;
};

export function classifyDirection(
  firstSharpSide: string | null,
  firstAvgDeltaCents: number | null,
  currentSharpSide: string,
  currentAvgDeltaCents: number
): DirectionVsFirst {
  if (firstSharpSide != null && firstSharpSide !== currentSharpSide) {
    return 'reversal';
  }
  if (firstAvgDeltaCents == null) return 'flat';
  const magDiff = Math.abs(currentAvgDeltaCents) - Math.abs(firstAvgDeltaCents);
  if (magDiff > FLAT_BAND_CENTS) return 'confirmation';
  if (magDiff < -FLAT_BAND_CENTS) return 'drift';
  return 'flat';
}

export async function persistHeardAlert(
  supabase: SupabaseClient,
  params: PersistHeardAlertParams
): Promise<void> {
  try {
    const existing = await supabase
      .from('heard_alerts')
      .select('id, first_sharp_side, first_avg_delta_cents')
      .eq('game_id', params.gameId)
      .eq('alert_type', params.alertType)
      .maybeSingle();

    if (existing.error) {
      console.error('[heard-alert-persistence] SELECT failed', {
        gameId: params.gameId,
        alertType: params.alertType,
        error: existing.error.message ?? existing.error,
      });
      return;
    }

    const row = existing.data as HeardAlertRow | null;

    if (row == null) {
      // First fire — insert heard_alerts row, then the initial observation.
      const inserted = await supabase
        .from('heard_alerts')
        .insert({
          game_id: params.gameId,
          alert_type: params.alertType,
          first_sharp_side: params.sharpSide,
          first_avg_delta_cents: params.avgDeltaCents,
          first_confidence: params.confidence,
          first_participation_rate: params.participationRate,
          first_leading_book: params.leadingBook,
          game_starts_at: params.gameStartsAt,
        })
        .select('id')
        .single();

      if (inserted.error || !inserted.data) {
        console.error('[heard-alert-persistence] INSERT heard_alerts failed', {
          gameId: params.gameId,
          alertType: params.alertType,
          error: inserted.error?.message ?? inserted.error ?? 'no data returned',
        });
        return;
      }

      const obsInsert = await supabase
        .from('heard_alert_observations')
        .insert({
          heard_alert_id: (inserted.data as { id: string }).id,
          avg_delta_cents: params.avgDeltaCents,
          confidence: params.confidence,
          participation_rate: params.participationRate,
          sharp_side: params.sharpSide,
          leading_book: params.leadingBook,
          books_moved_count: params.booksMovedCount,
          direction_vs_first: 'initial',
          magnitude_delta_vs_first: 0,
        });

      if (obsInsert.error) {
        console.error('[heard-alert-persistence] INSERT initial observation failed', {
          gameId: params.gameId,
          alertType: params.alertType,
          error: obsInsert.error.message ?? obsInsert.error,
        });
      }
      return;
    }

    // Existing alert — append an observation row against the existing first_*.
    const direction = classifyDirection(
      row.first_sharp_side,
      row.first_avg_delta_cents,
      params.sharpSide,
      params.avgDeltaCents
    );
    const magnitudeDelta =
      row.first_avg_delta_cents == null
        ? 0
        : params.avgDeltaCents - row.first_avg_delta_cents;

    const obsInsert = await supabase
      .from('heard_alert_observations')
      .insert({
        heard_alert_id: row.id,
        avg_delta_cents: params.avgDeltaCents,
        confidence: params.confidence,
        participation_rate: params.participationRate,
        sharp_side: params.sharpSide,
        leading_book: params.leadingBook,
        books_moved_count: params.booksMovedCount,
        direction_vs_first: direction,
        magnitude_delta_vs_first: magnitudeDelta,
      });

    if (obsInsert.error) {
      console.error('[heard-alert-persistence] INSERT subsequent observation failed', {
        gameId: params.gameId,
        alertType: params.alertType,
        error: obsInsert.error.message ?? obsInsert.error,
      });
    }
  } catch (err) {
    console.error('[heard-alert-persistence] unexpected error', {
      gameId: params.gameId,
      alertType: params.alertType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
