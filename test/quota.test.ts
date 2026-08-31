import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QuotaManager, estimateTokens } from "../src/core/quota.js";
import { StateStore, type RequestLogEntry } from "../src/core/state.js";

function makeStore(t: { name: string }): { store: StateStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), `prismd-quota-${t.name}-`));
  const dbPath = join(dir, "prismd.sqlite");
  return { store: new StateStore(dbPath), dbPath };
}

function readTable(dbPath: string, table: string): Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

test("estimateTokens is chars/4 rounded up", () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(4), 1);
  assert.equal(estimateTokens(5), 2);
  assert.equal(estimateTokens(100), 25);
});

test("record accumulates usage and estimates when real values are missing", () => {
  const { store } = makeStore({ name: "accumulate" });
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q.record({
    requestId: "r1",
    ts: "2026-08-31T12:00:00Z",
    alias: "free-auto",
    provider: "openrouter",
    model: "m1",
    status: 200,
    failover: 0,
    durationMs: 100,
    usage: { inputChars: 400, outputChars: 800 },
  });
  q.record({
    requestId: "r2",
    ts: "2026-08-31T12:01:00Z",
    alias: "free-auto",
    provider: "openrouter",
    model: "m1",
    status: 200,
    failover: 1,
    durationMs: 200,
    usage: { inputTokens: 50, outputTokens: 25, inputChars: 400, outputChars: 800 },
  });
  assert.equal(q.getDailyRequests("openrouter", "m1"), 2);

  q.flushSync();
  const rows = readTable(store.dbPath, "usage_daily");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0], requests: rows[0].requests, input_tokens: rows[0].input_tokens, output_tokens: rows[0].output_tokens, source: rows[0].source },
    {
      date: "2026-08-31",
      provider: "openrouter",
      model: "m1",
      requests: 2,
      input_tokens: 150, // 100 estimated + 50 real
      output_tokens: 225, // 200 estimated + 25 real
      source: "mixed",
    },
  );
  q.shutdown();
});

test("request_log rows are written with the per-request fields", () => {
  const { store } = makeStore({ name: "log" });
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q.record({
    requestId: "req-abc",
    ts: "2026-08-31T12:00:00Z",
    alias: "free-auto",
    provider: "openrouter",
    model: "m1",
    status: 429,
    failover: 2,
    durationMs: 300,
    usage: { inputChars: 100, outputChars: 0 },
  });
  q.flushSync();
  const rows = readTable(store.dbPath, "request_log");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].request_id, "req-abc");
  assert.equal(rows[0].alias, "free-auto");
  assert.equal(rows[0].provider, "openrouter");
  assert.equal(rows[0].status, 429);
  assert.equal(rows[0].estimated, 1);
  assert.equal(rows[0].failover, 2);
  assert.equal(rows[0].duration_ms, 300);
  q.shutdown();
});

test("all-real usage records source=real", () => {
  const { store } = makeStore({ name: "real" });
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q.record({
    requestId: "r1",
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputTokens: 10, outputTokens: 20, inputChars: 0, outputChars: 0 },
  });
  q.flushSync();
  const rows = readTable(store.dbPath, "usage_daily");
  assert.equal(rows[0].source, "real");
  q.shutdown();
});

test("shutdown forces a final flush and closes the store", () => {
  const { store, dbPath } = makeStore({ name: "shutdown" });
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q.record({
    requestId: "r1",
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 16 },
  });
  q.shutdown();
  const rows = readTable(dbPath, "usage_daily");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 1);
  assert.equal(rows[0].input_tokens, 2);
  assert.equal(rows[0].output_tokens, 4);
});

test("flush across separate managers merges into usage_daily", () => {
  const { store, dbPath } = makeStore({ name: "merge" });
  const q1 = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q1.record({
    requestId: "r1",
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputTokens: 10, outputTokens: 10, inputChars: 0, outputChars: 0 },
  });
  q1.shutdown(); // flushes one "real" row

  const store2 = new StateStore(dbPath);
  const q2 = new QuotaManager({ store: store2, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  q2.record({
    requestId: "r2",
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 8 },
  });
  q2.shutdown(); // flushes an "estimated" row into the same day

  const rows = readTable(dbPath, "usage_daily");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 2);
  assert.equal(rows[0].input_tokens, 12);
  assert.equal(rows[0].output_tokens, 12);
  assert.equal(rows[0].source, "mixed");
});

test("daily counters survive flushSync and flushed deltas never double-count", () => {
  const { store } = makeStore({ name: "daily-persist" });
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => new Date("2026-08-31T12:00:00") });
  const input = (requestId: string): Parameters<QuotaManager["record"]>[0] => ({
    requestId,
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 0 },
  });
  for (let i = 0; i < 5; i += 1) q.record(input(`r${i}`));
  q.flushSync();
  // The in-memory accumulator keeps the full day even after a flush.
  assert.equal(q.getDailyRequests("p", "m"), 5);

  for (let i = 5; i < 8; i += 1) q.record(input(`r${i}`));
  q.flushSync();
  const rows = readTable(store.dbPath, "usage_daily");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 8, "sqlite holds the cumulative total, not a double-counted delta");
  assert.equal(rows[0].input_tokens, 16); // 8 requests * ceil(8/4) = 2 tokens each
  assert.equal(q.getDailyRequests("p", "m"), 8);
  q.shutdown();
});

test("startup seeds today's counters from usage_daily", () => {
  const { store, dbPath } = makeStore({ name: "seed" });
  const now = () => new Date("2026-08-31T12:00:00");
  const input = (requestId: string): Parameters<QuotaManager["record"]>[0] => ({
    requestId,
    ts: "2026-08-31T12:00:00Z",
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 0 },
  });
  const q1 = new QuotaManager({ store, flushIntervalMs: 60_000, now });
  q1.record(input("r1"));
  q1.shutdown();

  // Reopen: today's persisted usage must seed the accumulator, so the
  // daily limit keeps counting across restarts without re-adding.
  const store2 = new StateStore(dbPath);
  const q2 = new QuotaManager({ store: store2, flushIntervalMs: 60_000, now });
  assert.equal(q2.getDailyRequests("p", "m"), 1);
  q2.record(input("r2"));
  q2.shutdown();

  const rows = readTable(dbPath, "usage_daily");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 2);
  assert.equal(rows[0].input_tokens, 4);
});

test("usage and request logs flush atomically: a failed log insert rolls the usage delta back", () => {
  const { store, dbPath } = makeStore({ name: "atomic" });
  const badLog = {
    requestId: "bad",
    ts: "2026-08-31T12:00:00Z",
    alias: null, // violates NOT NULL -> the log insert fails mid-transaction
    provider: "p",
    model: "m",
    status: 200,
    inputTokens: 1,
    outputTokens: 1,
    estimated: 0,
    failover: 0,
    durationMs: 1,
  };
  assert.throws(() =>
    store.flushUsageAndLogs(
      [{ date: "2026-08-31", provider: "p", model: "m", requests: 1, inputTokens: 10, outputTokens: 20, source: "estimated" }],
      [badLog as unknown as RequestLogEntry],
    ),
  );
  // The usage delta must be rolled back with the failed log insert,
  // otherwise the next flush would double-count it.
  assert.equal(readTable(dbPath, "usage_daily").length, 0);
  assert.equal(readTable(dbPath, "request_log").length, 0);
  store.close();
});

test("non-today accumulators flush then leave memory across midnight", () => {
  const { store, dbPath } = makeStore({ name: "midnight" });
  let now = new Date("2026-08-31T23:59:00");
  const q = new QuotaManager({ store, flushIntervalMs: 60_000, now: () => now });
  const input = (requestId: string, ts: string): Parameters<QuotaManager["record"]>[0] => ({
    requestId,
    ts,
    alias: "a",
    provider: "p",
    model: "m",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 0 },
  });
  q.record(input("r1", "2026-08-31T23:59:00Z"));
  now = new Date("2026-09-01T00:01:00"); // day rolls over before any flush
  q.record(input("r2", "2026-09-01T00:01:00Z"));
  q.flushSync();

  // Yesterday's delta must be persisted before its key leaves memory.
  const rows = readTable(dbPath, "usage_daily");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.date === "2026-08-31")?.requests, 1);
  assert.equal(rows.find((r) => r.date === "2026-09-01")?.requests, 1);

  // Both in-memory maps keep only today's keys, so a long-running
  // process crossing midnight does not grow them without bound.
  const internals = q as unknown as {
    pendingUsage: Map<string, unknown>;
    flushedUsage: Map<string, unknown>;
  };
  assert.deepEqual([...internals.pendingUsage.keys()], ["2026-09-01\u0000p\u0000m"]);
  assert.deepEqual([...internals.flushedUsage.keys()], ["2026-09-01\u0000p\u0000m"]);
  q.shutdown();
});

test("data dir and db files are locked down, including pre-existing dirs", () => {
  const { store, dbPath } = makeStore({ name: "perm" });
  const dir = dirname(dbPath);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    // Both sidecars exist while the WAL connection is open; each must be
    // tightened to 0600, never exposed at sqlite's default 0644.
    assert.ok(existsSync(sidecar), `${sidecar} should exist with an open WAL connection`);
    assert.equal(statSync(sidecar).mode & 0o777, 0o600);
  }
  store.close();

  // A directory created before this guard (wider mode) is tightened too.
  const wideDir = mkdtempSync(join(tmpdir(), "prismd-quota-wide-"));
  chmodSync(wideDir, 0o755);
  const store2 = new StateStore(join(wideDir, "prismd.sqlite"));
  assert.equal(statSync(wideDir).mode & 0o777, 0o700);
  store2.close();
});

test("startup prunes request_log rows older than 14 days", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-quota-prune-"));
  const dbPath = join(dir, "prismd.sqlite");
  const first = new StateStore(dbPath);
  first.insertRequestLogs([
    {
      requestId: "old",
      ts: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      alias: "a",
      provider: "p",
      model: "m",
      status: 200,
      inputTokens: 1,
      outputTokens: 1,
      estimated: 0,
      failover: 0,
      durationMs: 1,
    },
    {
      requestId: "fresh",
      ts: new Date().toISOString(),
      alias: "a",
      provider: "p",
      model: "m",
      status: 200,
      inputTokens: 1,
      outputTokens: 1,
      estimated: 0,
      failover: 0,
      durationMs: 1,
    },
  ]);
  first.close();

  // Reopen: startup cleanup should drop only the old row.
  const second = new StateStore(dbPath);
  second.close();
  const rows = readTable(dbPath, "request_log");
  assert.deepEqual(rows.map((r) => r.request_id), ["fresh"]);
});
