// ══════════════════════════════════════════════════════════════════════════════
//  heard-alert-persistence tests
//
//  Uses an in-memory SupabaseClient stub that records every .from().select()
//  and .insert() call. Covers: first-fire, confirmation, drift, reversal, and
//  the never-throw guarantee on SELECT failure.
//
//  Run: npx tsx api/__tests__/heard-alert-persistence.test.ts
// ══════════════════════════════════════════════════════════════════════════════

import {
  persistHeardAlert,
  classifyDirection,
  type PersistHeardAlertParams,
} from '../lib/heard-alert-persistence';

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

// ──────────────────────────────────────────────────────────────────────────────
// Stub Supabase client
// ──────────────────────────────────────────────────────────────────────────────

type StubRow = Record<string, unknown>;

type StubOptions = {
  // Map of table → list of rows returned for .maybeSingle() calls.
  selectRows?: Record<string, StubRow | null>;
  selectError?: Error | null;
  insertReturns?: Record<string, StubRow>;
  insertError?: Error | null;
};

type RecordedCall = {
  op: 'select' | 'insert';
  table: string;
  payload?: unknown;
  filter?: Record<string, unknown>;
};

function makeStub(options: StubOptions = {}) {
  const calls: RecordedCall[] = [];
  let firstInsertCount = 0;

  const client = {
    from(table: string) {
      const filter: Record<string, unknown> = {};

      const selectChain = {
        eq(col: string, val: unknown) {
          filter[col] = val;
          return selectChain;
        },
        async maybeSingle() {
          calls.push({ op: 'select', table, filter: { ...filter } });
          if (options.selectError) {
            return { data: null, error: options.selectError };
          }
          const rows = options.selectRows ?? {};
          return { data: rows[table] ?? null, error: null };
        },
        async single() {
          calls.push({ op: 'select', table, filter: { ...filter } });
          if (options.selectError) {
            return { data: null, error: options.selectError };
          }
          const rows = options.selectRows ?? {};
          return { data: rows[table] ?? null, error: null };
        },
      };

      const insertChain = (payload: unknown) => ({
        select(_cols?: string) {
          return {
            async single() {
              calls.push({ op: 'insert', table, payload });
              if (options.insertError) {
                return { data: null, error: options.insertError };
              }
              firstInsertCount++;
              return {
                data: options.insertReturns?.[table] ?? { id: `stub-${firstInsertCount}` },
                error: null,
              };
            },
          };
        },
        // Direct await (no .select()) path used for observation inserts.
        then(resolve: (r: { error: Error | null }) => void) {
          calls.push({ op: 'insert', table, payload });
          resolve({ error: options.insertError ?? null });
        },
      });

      return {
        select(_cols?: string) {
          return selectChain;
        },
        insert(payload: unknown) {
          return insertChain(payload);
        },
      };
    },
  };

  return { client, calls };
}

// ──────────────────────────────────────────────────────────────────────────────
// classifyDirection unit cases
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== classifyDirection ===');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 45), 'confirmation', 'same side, grew 15 → confirmation');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 15), 'drift', 'same side, shrank 15 → drift');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 32), 'flat', 'same side, +2c → flat');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 28), 'flat', 'same side, -2c → flat');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 33), 'confirmation', 'same side, +3c → confirmation (outside band)');
assertEqual(classifyDirection('Yankees', 30, 'Yankees', 27), 'drift', 'same side, -3c → drift (outside band)');
assertEqual(classifyDirection('Yankees', 30, 'Red Sox', 25), 'reversal', 'side flipped → reversal regardless of magnitude');
assertEqual(classifyDirection(null, null, 'Yankees', 30), 'flat', 'null firsts → flat fallback');

// ──────────────────────────────────────────────────────────────────────────────
// persistHeardAlert: first fire
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== persistHeardAlert: first fire ===');
{
  const { client, calls } = makeStub({
    selectRows: { heard_alerts: null },
    insertReturns: { heard_alerts: { id: 'alert-uuid-1' } },
  });
  const params: PersistHeardAlertParams = {
    gameId: 'mlb-2026-04-22-nyy-bos',
    alertType: 'HEARD_ALERT_MLB',
    sharpSide: 'Yankees',
    avgDeltaCents: 47,
    confidence: 88,
    participationRate: 0.85,
    leadingBook: 'pinnacle',
    booksMovedCount: 4,
    gameStartsAt: '2026-04-22T23:05:00Z',
  };
  await persistHeardAlert(client as never, params);

  assertEqual(calls.length, 3, 'first fire: 1 select + 2 inserts');
  assertEqual(calls[0], { op: 'select', table: 'heard_alerts', filter: { game_id: params.gameId, alert_type: params.alertType } }, 'first call: SELECT on heard_alerts');
  assert(calls[1].op === 'insert' && calls[1].table === 'heard_alerts', 'second call: INSERT heard_alerts');
  assert(calls[2].op === 'insert' && calls[2].table === 'heard_alert_observations', 'third call: INSERT heard_alert_observations');

  const alertPayload = calls[1].payload as StubRow;
  assertEqual(alertPayload.first_sharp_side, 'Yankees', 'first_sharp_side captured');
  assertEqual(alertPayload.first_avg_delta_cents, 47, 'first_avg_delta_cents captured');
  assertEqual(alertPayload.first_leading_book, 'pinnacle', 'first_leading_book captured');
  assertEqual(alertPayload.game_starts_at, '2026-04-22T23:05:00Z', 'game_starts_at captured');

  const obsPayload = calls[2].payload as StubRow;
  assertEqual(obsPayload.direction_vs_first, 'initial', 'initial observation direction = initial');
  assertEqual(obsPayload.magnitude_delta_vs_first, 0, 'initial observation magnitude delta = 0');
  assertEqual(obsPayload.heard_alert_id, 'alert-uuid-1', 'observation linked to alert id from insert');
}

// ──────────────────────────────────────────────────────────────────────────────
// persistHeardAlert: subsequent fire — confirmation
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== persistHeardAlert: second fire, confirmation ===');
{
  const { client, calls } = makeStub({
    selectRows: {
      heard_alerts: {
        id: 'alert-uuid-1',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
      },
    },
  });
  await persistHeardAlert(client as never, {
    gameId: 'mlb-2026-04-22-nyy-bos',
    alertType: 'HEARD_ALERT_MLB',
    sharpSide: 'Yankees',
    avgDeltaCents: 57, // +10 vs first
    confidence: 90,
    participationRate: 0.87,
    leadingBook: 'pinnacle',
    booksMovedCount: 5,
    gameStartsAt: '2026-04-22T23:05:00Z',
  });

  assertEqual(calls.length, 2, 'subsequent fire: 1 select + 1 observation insert (no heard_alerts insert)');
  assertEqual(calls[1].op, 'insert', 'second call is an insert');
  assertEqual(calls[1].table, 'heard_alert_observations', 'insert targets observations table');
  const obs = calls[1].payload as StubRow;
  assertEqual(obs.direction_vs_first, 'confirmation', 'direction = confirmation');
  assertEqual(obs.magnitude_delta_vs_first, 10, 'magnitude delta = +10 (signed)');
  assertEqual(obs.sharp_side, 'Yankees', 'current sharp_side recorded');
  assertEqual(obs.avg_delta_cents, 57, 'current avg_delta_cents recorded');
}

// ──────────────────────────────────────────────────────────────────────────────
// persistHeardAlert: third fire — drift
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== persistHeardAlert: third fire, drift ===');
{
  const { client, calls } = makeStub({
    selectRows: {
      heard_alerts: {
        id: 'alert-uuid-1',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
      },
    },
  });
  await persistHeardAlert(client as never, {
    gameId: 'mlb-2026-04-22-nyy-bos',
    alertType: 'HEARD_ALERT_MLB',
    sharpSide: 'Yankees',
    avgDeltaCents: 35, // -12 vs first
    confidence: 82,
    participationRate: 0.80,
    leadingBook: 'pinnacle',
    booksMovedCount: 4,
    gameStartsAt: '2026-04-22T23:05:00Z',
  });

  const obs = calls[1].payload as StubRow;
  assertEqual(obs.direction_vs_first, 'drift', 'direction = drift');
  assertEqual(obs.magnitude_delta_vs_first, -12, 'magnitude delta = -12');
}

// ──────────────────────────────────────────────────────────────────────────────
// persistHeardAlert: fourth fire — reversal
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== persistHeardAlert: fourth fire, reversal ===');
{
  const { client, calls } = makeStub({
    selectRows: {
      heard_alerts: {
        id: 'alert-uuid-1',
        first_sharp_side: 'Yankees',
        first_avg_delta_cents: 47,
      },
    },
  });
  await persistHeardAlert(client as never, {
    gameId: 'mlb-2026-04-22-nyy-bos',
    alertType: 'HEARD_ALERT_MLB',
    sharpSide: 'Red Sox', // flipped
    avgDeltaCents: 30,
    confidence: 75,
    participationRate: 0.70,
    leadingBook: 'pinnacle',
    booksMovedCount: 4,
    gameStartsAt: '2026-04-22T23:05:00Z',
  });

  const obs = calls[1].payload as StubRow;
  assertEqual(obs.direction_vs_first, 'reversal', 'direction = reversal when sharp side flips');
  assertEqual(obs.sharp_side, 'Red Sox', 'new sharp_side recorded even on reversal');
}

// ──────────────────────────────────────────────────────────────────────────────
// persistHeardAlert: never throws on SELECT error
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== persistHeardAlert: never throws on SELECT error ===');
{
  const originalConsoleError = console.error;
  let loggedError: unknown = null;
  console.error = (msg: unknown, meta?: unknown) => {
    loggedError = { msg, meta };
  };

  const { client, calls } = makeStub({
    selectError: new Error('connection reset'),
  });

  let threw = false;
  try {
    await persistHeardAlert(client as never, {
      gameId: 'mlb-2026-04-22-nyy-bos',
      alertType: 'HEARD_ALERT_MLB',
      sharpSide: 'Yankees',
      avgDeltaCents: 47,
      confidence: 88,
      participationRate: 0.85,
      leadingBook: 'pinnacle',
      booksMovedCount: 4,
      gameStartsAt: null,
    });
  } catch {
    threw = true;
  }

  console.error = originalConsoleError;

  assert(!threw, 'persistHeardAlert does not throw when SELECT fails');
  assertEqual(calls.length, 1, 'no INSERT attempted after failed SELECT');
  assert(loggedError != null, 'SELECT failure logged via console.error');
}

// ──────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`heard-alert-persistence tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  REGRESSION DETECTED');
  process.exit(1);
} else {
  console.log('\n✅ All heard-alert-persistence tests passed');
}
