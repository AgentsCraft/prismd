import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClientUsageSink,
  CLIENT_WINDOW_MS,
  mapUserAgent,
  type ClientStatusSnapshot,
} from "../src/observability/client-sink.js";
import type { RequestEndEvent, RequestStartEvent } from "../src/observability/exporter.js";

function makeSink(now: () => number, overrides: Record<string, number> = {}) {
  return new ClientUsageSink({
    now,
    maxRecordsPerBucket: overrides.maxRecordsPerBucket ?? 1000,
    maxTrackedRequests: overrides.maxTrackedRequests ?? 2000,
    ...(overrides.windowMs !== undefined ? { windowMs: overrides.windowMs } : {}),
  });
}

function start(
  sink: ClientUsageSink,
  requestId: string,
  path: string,
  userAgent: string,
  ts: number,
): void {
  sink.onRequestStart({ requestId, ts, method: "POST", path, alias: "free-auto", userAgent });
}

function end(
  sink: ClientUsageSink,
  requestId: string,
  ts: number,
  status: number,
  durationMs: number,
  failovers = 0,
): void {
  sink.onRequestEnd({
    requestId,
    ts,
    method: "POST",
    path: "/v1/messages",
    alias: "free-auto",
    provider: "openrouter",
    model: "test-model",
    status,
    durationMs,
    failovers,
  });
}

test("mapUserAgent maps only confident clients and leaves the rest unmapped", () => {
  assert.equal(mapUserAgent("claude-cli/1.0.34 (external, cli)"), "claude-code");
  assert.equal(mapUserAgent("codex_cli_rs/0.9.0 (Ubuntu 22.04.3 LTS; x86_64) windows"), "codex");
  assert.equal(mapUserAgent("opencode/1.0.0"), "opencode");
  assert.equal(mapUserAgent("Mozilla/5.0 aider/0.42"), "aider");
  assert.equal(mapUserAgent("curl/8.0.1"), null);
  assert.equal(mapUserAgent(""), null);
});

test("sink attributes requests to mapped client names", () => {
  const sink = makeSink(() => 1000);
  start(sink, "r1", "/v1/messages", "claude-cli/1.0.34 (external, cli)", 1000);
  end(sink, "r1", 1100, 200, 100);

  start(sink, "r2", "/v1/messages", "", 1200);
  end(sink, "r2", 1300, 200, 100);

  const snap = sink.snapshot();
  const byClient = new Map(snap.clients.map((c) => [c.client, c]));
  assert.equal(byClient.get("claude-code")?.requests, 1);
  assert.equal(byClient.get("unknown-UA")?.requests, 1);
});

test("unmatched user agents are shown verbatim and never silently merged", () => {
  const sink = makeSink(() => 1000);
  start(sink, "r1", "/v1/chat/completions", "SomeClient/9.9 (custom build)", 1000);
  end(sink, "r1", 1100, 200, 100);
  start(sink, "r2", "/v1/chat/completions", "OtherClient/1.0", 1200);
  end(sink, "r2", 1300, 200, 100);

  const snap = sink.snapshot();
  assert.equal(snap.clients.length, 2);
  const names = snap.clients.map((c) => c.client).sort();
  assert.deepEqual(names, ["OtherClient/1.0", "SomeClient/9.9 (custom build)"]);
});

test("aggregate requests, success rate, p50/p95 and failovers", () => {
  const sink = makeSink(() => 1000);
  const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  for (let i = 0; i < 10; i += 1) {
    start(sink, `r${i}`, "/v1/messages", "claude-cli/1.0", 1000 + i);
    const status = i === 0 ? 429 : 200;
    end(sink, `r${i}`, 1100 + i, status, durations[i], i === 0 ? 2 : i === 5 ? 1 : 0);
  }

  const entry = sink.snapshot().clients[0];
  assert.equal(entry.requests, 10);
  assert.equal(entry.successRate, 0.9);
  assert.equal(entry.p50Ms, 500);
  assert.equal(entry.p95Ms, 1000);
  assert.equal(entry.failovers, 3);
  // No error event preceded the end, so the reason is the bare status code.
  assert.equal(entry.lastError?.reason, "429");
});

test("top failures keep status code plus error class, ordered by count", () => {
  const sink = makeSink(() => 1000);
  const cases: Array<[number, string | undefined]> = [
    [502, "upstream_error"],
    [502, "upstream_error"],
    [502, "upstream_error"],
    [429, "rate_limit_exceeded"],
    [429, "rate_limit_exceeded"],
    [500, "gateway_internal_error"],
  ];
  cases.forEach(([status, code], i) => {
    start(sink, `r${i}`, "/v1/messages", "aider/0.42", 1000 + i);
    sink.onError({ requestId: `r${i}`, ts: 1005 + i, alias: "free-auto", code: code! });
    end(sink, `r${i}`, 1100 + i, status, 100);
  });

  const entry = sink.snapshot().clients[0];
  assert.deepEqual(entry.topFailures, [
    { reason: "502 upstream_error", count: 3 },
    { reason: "429 rate_limit_exceeded", count: 2 },
    { reason: "500 gateway_internal_error", count: 1 },
  ]);
  assert.equal(entry.successRate, 0);
});

test("recent errors reported after request end still mark the request failed", () => {
  const sink = makeSink(() => 1000);
  start(sink, "r1", "/v1/messages", "claude-cli/1.0", 1000);
  end(sink, "r1", 1100, 200, 100);
  sink.onError({ requestId: "r1", ts: 1150, alias: "free-auto", code: "stream_error" });

  const entry = sink.snapshot().clients[0];
  assert.equal(entry.requests, 1);
  assert.equal(entry.successRate, 0);
  assert.equal(entry.lastError?.reason, "stream_error");
  assert.deepEqual(entry.topFailures, [{ reason: "stream_error", count: 1 }]);
});

test("requests outside the sliding window age out", () => {
  let now = 1_000_000;
  const sink = makeSink(() => now);
  start(sink, "r1", "/v1/messages", "claude-cli/1.0", now);
  end(sink, "r1", now + 10, 200, 100);

  now += CLIENT_WINDOW_MS - 60_000;
  assert.equal(sink.snapshot().clients.length, 1);

  now += 2 * 60_000;
  const snap = sink.snapshot();
  assert.equal(snap.clients.length, 0);
  assert.equal(snap.windowMs, CLIENT_WINDOW_MS);
});

test("per-bucket record cap keeps only the newest entries", () => {
  const sink = makeSink(() => 1000, { maxRecordsPerBucket: 3 });
  for (let i = 0; i < 5; i += 1) {
    start(sink, `r${i}`, "/v1/messages", "claude-cli/1.0", 1000 + i);
    end(sink, `r${i}`, 1100 + i, 200, 100 + i);
  }

  const entry = sink.snapshot().clients[0];
  assert.equal(entry.requests, 3);
  // recent is newest-first
  assert.deepEqual(
    entry.recent.map((r) => r.durationMs),
    [104, 103, 102],
  );
});

test("snapshot shape and recent list ordering", () => {
  const sink = makeSink(() => 1000);
  for (let i = 0; i < 12; i += 1) {
    start(sink, `r${i}`, "/v1/messages", "claude-cli/1.0", 1000 + i);
    end(sink, `r${i}`, 1100 + i, 200, 100 + i);
  }

  const snap: ClientStatusSnapshot = sink.snapshot();
  assert.ok(!Number.isNaN(Date.parse(snap.timestamp)));
  const entry = snap.clients[0];
  assert.equal(entry.recent.length, 10);
  assert.ok(Date.parse(entry.recent[0].at) >= Date.parse(entry.recent[9].at));
});

test("reset clears the whole window", () => {
  const sink = makeSink(() => 1000);
  start(sink, "r1", "/v1/messages", "claude-cli/1.0", 1000);
  end(sink, "r1", 1100, 200, 100);
  sink.reset();
  assert.deepEqual(sink.snapshot().clients, []);
});
