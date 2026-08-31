import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QuotaManager, estimateTokens } from "../src/core/quota.js";
import { StateStore } from "../src/core/state.js";

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
