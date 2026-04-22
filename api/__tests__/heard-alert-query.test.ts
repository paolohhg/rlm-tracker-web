// ══════════════════════════════════════════════════════════════════════════════
//  heard-alert-query tests
//
//  Stubs the SupabaseClient query-builder chain to assert that
//  getHeardAlertsForGames and getHeardAlertHistory emit the right filters,
//  shape, and ordering.
//
//  Run: npx tsx api/__tests__/heard-alert-query.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import {
  getHeardAlertsForGames,
  getHeardAlertHistory,
} from '../lib/heard-alert-query';

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, name: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(
      `  ✗ FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

type StubOpts = {
  rows?: unknown[];
  error?: Error | null;
};

type Recorded = {
  table: string;
  select?: string;
  filters: Record<string, unknown>;
  inFilter?: { col: string; values: unknown[] };
  isFilter?: { col: string; value: unknown };
  order?: { col: string; ascending: boolean };
};

function makeStub(opts: StubOpts = {}) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const recorded: Recorded = { table, filters: {} };
      calls.push(recorded);

      const builder: Record<string, unknown> = {
        select(cols: string) {
          recorded.select = cols;
          return builder;
        },
        in(col: string, values: unknown[]) {
          recorded.inFilter = { col, values };
          return builder;
        },
        is(col: string, value: unknown) {
          recorded.isFilter = { col, value };
          return builder;
        },
        eq(col: string, value: unknown) {
          recorded.filters[col] = value;
          return builder;
        },
        order(col: string, optsArg: { ascending?: boolean } = {}) {
          recorded.order = { col, ascending: optsArg.ascending ?? true };
          // Resolve with the stub data — getHeardAlertHistory awaits this.
          return Promise.resolve({ data: opts.rows ?? [], error: opts.error ?? null });
        },
        // .in() / .is() chains are directly awaited in getHeardAlertsForGames.
        then(resolve: (r: { data: unknown[]; error: Error | null }) => void) {
          resolve({ data: opts.rows ?? [], error: opts.error ?? null });
        },
      };

      return builder;
    },
  };

  return { client, calls };
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — empty input short-circuits
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: empty input ===');
{
  const { client, calls } = makeStub({ rows: [] });
  const result = await getHeardAlertsForGames(client as never, []);
  assertEqual(result, [], 'empty gameIds → [] without querying');
  assertEqual(calls.length, 0, 'no query issued for empty input');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — no rows returned
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: no matching rows ===');
{
  const { client, calls } = makeStub({ rows: [] });
  const result = await getHeardAlertsForGames(client as never, ['g1', 'g2']);
  assertEqual(result, [], 'empty DB result → []');
  assertEqual(calls.length, 1, 'one query issued');
  assertEqual(calls[0].table, 'heard_alerts', 'query hits heard_alerts');
  assertEqual(calls[0].inFilter, { col: 'game_id', values: ['g1', 'g2'] }, 'IN filter on game_id');
  assertEqual(calls[0].isFilter, { col: 'resolved_at', value: null }, 'unresolved filter applied');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — single alert with one observation
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: single alert + one observation ===');
{
  const { client } = makeStub({
    rows: [
      {
        id: 'a1',
        game_id: 'g1',
        alert_type: 'HEARD_ALERT_MLB',
        first_detected_at: '2026-04-22T12:00:00Z',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
        first_confidence: 88,
        first_leading_book: 'pinnacle',
        game_starts_at: '2026-04-22T23:05:00Z',
        resolved_at: null,
        heard_alert_observations: [
          {
            id: 'o1',
            heard_alert_id: 'a1',
            observed_at: '2026-04-22T12:00:00Z',
            avg_delta_cents: 47,
            confidence: 88,
            participation_rate: 0.85,
            sharp_side: 'Yankees',
            leading_book: 'pinnacle',
            books_moved_count: 4,
            direction_vs_first: 'initial',
            magnitude_delta_vs_first: 0,
          },
        ],
      },
    ],
  });
  const r = await getHeardAlertsForGames(client as never, ['g1']);
  assertEqual(r.length, 1, 'one entry returned');
  assertEqual(r[0].alert.id, 'a1', 'alert.id passthrough');
  assertEqual(r[0].alert.first_sharp_side, 'Yankees', 'alert.first_sharp_side passthrough');
  assertEqual(r[0].latest.direction_vs_first, 'initial', 'latest direction = initial on single observation');
  assertEqual(r[0].observation_count, 1, 'observation_count = 1');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — picks the most recent observation
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: picks latest observation by observed_at ===');
{
  const { client } = makeStub({
    rows: [
      {
        id: 'a1',
        game_id: 'g1',
        alert_type: 'HEARD_ALERT_MLB',
        first_detected_at: '2026-04-22T12:00:00Z',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
        first_confidence: 88,
        first_leading_book: 'pinnacle',
        game_starts_at: '2026-04-22T23:05:00Z',
        resolved_at: null,
        heard_alert_observations: [
          // intentionally out of chrono order
          {
            id: 'o1',
            heard_alert_id: 'a1',
            observed_at: '2026-04-22T12:00:00Z',
            avg_delta_cents: 47,
            confidence: 88,
            participation_rate: 0.85,
            sharp_side: 'Yankees',
            leading_book: 'pinnacle',
            books_moved_count: 4,
            direction_vs_first: 'initial',
            magnitude_delta_vs_first: 0,
          },
          {
            id: 'o3',
            heard_alert_id: 'a1',
            observed_at: '2026-04-22T14:00:00Z',
            avg_delta_cents: 65,
            confidence: 92,
            participation_rate: 0.90,
            sharp_side: 'Yankees',
            leading_book: 'pinnacle',
            books_moved_count: 5,
            direction_vs_first: 'confirmation',
            magnitude_delta_vs_first: 18,
          },
          {
            id: 'o2',
            heard_alert_id: 'a1',
            observed_at: '2026-04-22T13:00:00Z',
            avg_delta_cents: 55,
            confidence: 90,
            participation_rate: 0.88,
            sharp_side: 'Yankees',
            leading_book: 'pinnacle',
            books_moved_count: 4,
            direction_vs_first: 'confirmation',
            magnitude_delta_vs_first: 8,
          },
        ],
      },
    ],
  });
  const r = await getHeardAlertsForGames(client as never, ['g1']);
  assertEqual(r[0].latest.observed_at, '2026-04-22T14:00:00Z', 'latest = highest observed_at');
  assertEqual(r[0].latest.avg_delta_cents, 65, 'latest.avg_delta_cents from newest row');
  assertEqual(r[0].latest.magnitude_delta_vs_first, 18, 'latest.magnitude_delta_vs_first from newest row');
  assertEqual(r[0].observation_count, 3, 'observation_count = 3 total');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — multiple alerts on same game (MLB + TOTAL_MLB)
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: multiple alert types on one game ===');
{
  const { client } = makeStub({
    rows: [
      {
        id: 'a1',
        game_id: 'g1',
        alert_type: 'HEARD_ALERT_MLB',
        first_detected_at: '2026-04-22T12:00:00Z',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
        first_confidence: 88,
        first_leading_book: 'pinnacle',
        game_starts_at: '2026-04-22T23:05:00Z',
        resolved_at: null,
        heard_alert_observations: [
          {
            id: 'o1',
            heard_alert_id: 'a1',
            observed_at: '2026-04-22T12:00:00Z',
            avg_delta_cents: 47,
            confidence: 88,
            participation_rate: 0.85,
            sharp_side: 'Yankees',
            leading_book: 'pinnacle',
            books_moved_count: 4,
            direction_vs_first: 'initial',
            magnitude_delta_vs_first: 0,
          },
        ],
      },
      {
        id: 'a2',
        game_id: 'g1',
        alert_type: 'HEARD_ALERT_TOTAL_MLB',
        first_detected_at: '2026-04-22T13:30:00Z',
        first_sharp_side: 'Under',
        first_avg_delta_cents: 12,
        first_confidence: 80,
        first_leading_book: 'circa',
        game_starts_at: '2026-04-22T23:05:00Z',
        resolved_at: null,
        heard_alert_observations: [
          {
            id: 'o2',
            heard_alert_id: 'a2',
            observed_at: '2026-04-22T13:30:00Z',
            avg_delta_cents: 12,
            confidence: 80,
            participation_rate: 0.75,
            sharp_side: 'Under',
            leading_book: 'circa',
            books_moved_count: 4,
            direction_vs_first: 'initial',
            magnitude_delta_vs_first: 0,
          },
        ],
      },
    ],
  });
  const r = await getHeardAlertsForGames(client as never, ['g1']);
  assertEqual(r.length, 2, 'both alerts on same game returned separately');
  const types = r.map((x) => x.alert.alert_type).sort();
  assertEqual(types, ['HEARD_ALERT_MLB', 'HEARD_ALERT_TOTAL_MLB'], 'one entry per alert_type');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertsForGames — DB error returns []
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertsForGames: DB error returns [] ===');
{
  const originalConsoleError = console.error;
  let logged = false;
  console.error = () => {
    logged = true;
  };
  const { client } = makeStub({ error: new Error('boom') });
  const r = await getHeardAlertsForGames(client as never, ['g1']);
  console.error = originalConsoleError;
  assertEqual(r, [], 'error → []');
  assert(logged, 'error logged');
}

// ──────────────────────────────────────────────────────────────────────────────
// getHeardAlertHistory — full ordered series
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== getHeardAlertHistory: ordered ascending by observed_at ===');
{
  const rows = [
    { id: 'o1', heard_alert_id: 'a1', observed_at: '2026-04-22T12:00:00Z', avg_delta_cents: 47, confidence: 88, participation_rate: 0.85, sharp_side: 'Yankees', leading_book: 'pinnacle', books_moved_count: 4, direction_vs_first: 'initial', magnitude_delta_vs_first: 0 },
    { id: 'o2', heard_alert_id: 'a1', observed_at: '2026-04-22T13:00:00Z', avg_delta_cents: 55, confidence: 90, participation_rate: 0.88, sharp_side: 'Yankees', leading_book: 'pinnacle', books_moved_count: 4, direction_vs_first: 'confirmation', magnitude_delta_vs_first: 8 },
    { id: 'o3', heard_alert_id: 'a1', observed_at: '2026-04-22T14:00:00Z', avg_delta_cents: 65, confidence: 92, participation_rate: 0.90, sharp_side: 'Yankees', leading_book: 'pinnacle', books_moved_count: 5, direction_vs_first: 'confirmation', magnitude_delta_vs_first: 18 },
  ];
  const { client, calls } = makeStub({ rows });
  const r = await getHeardAlertHistory(client as never, 'a1');
  assertEqual(r.length, 3, 'three observations returned');
  assertEqual(calls[0].table, 'heard_alert_observations', 'query hits observations table');
  assertEqual(calls[0].filters, { heard_alert_id: 'a1' }, 'eq filter on heard_alert_id');
  assertEqual(calls[0].order, { col: 'observed_at', ascending: true }, 'ordered observed_at ASC');
  assertEqual(r.map((o) => o.id), ['o1', 'o2', 'o3'], 'caller gets rows in query order');
}

console.log('\n=== getHeardAlertHistory: empty ===');
{
  const { client } = makeStub({ rows: [] });
  const r = await getHeardAlertHistory(client as never, 'nonexistent');
  assertEqual(r, [], 'no observations → []');
}

console.log('\n=== getHeardAlertHistory: error → [] ===');
{
  const originalConsoleError = console.error;
  let logged = false;
  console.error = () => {
    logged = true;
  };
  const { client } = makeStub({ error: new Error('network') });
  const r = await getHeardAlertHistory(client as never, 'a1');
  console.error = originalConsoleError;
  assertEqual(r, [], 'error → []');
  assert(logged, 'error logged');
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`heard-alert-query tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All heard-alert-query tests passed');
}
