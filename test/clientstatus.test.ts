import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { exporter } from "../src/observability/exporter.js";
import { clientUsageSink } from "../src/observability/client-sink.js";

beforeEach(() => {
  clientUsageSink.reset();
});

afterEach(() => {
  clientUsageSink.reset();
});

test("GET /v1/clientstatus returns an empty read-only snapshot without auth", async () => {
  const res = await app.request("/v1/clientstatus", { method: "GET" });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("application/json"));

  const body = await res.json();
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  assert.equal(body.windowMs, 24 * 60 * 60 * 1000);
  assert.deepEqual(body.clients, []);
});

test("requests flow through the exporter into the clientstatus snapshot", async () => {
  const t0 = Date.now();
  exporter.onRequestStart({
    requestId: "r1",
    ts: t0,
    method: "POST",
    path: "/v1/messages",
    alias: "free-auto",
    userAgent: "claude-cli/1.0.34 (external, cli)",
  });
  exporter.onRequestEnd({
    requestId: "r1",
    ts: t0 + 200,
    method: "POST",
    path: "/v1/messages",
    alias: "free-auto",
    provider: "openrouter",
    model: "test-model",
    status: 200,
    durationMs: 200,
    failovers: 0,
  });

  exporter.onRequestStart({
    requestId: "r2",
    ts: t0 + 300,
    method: "POST",
    path: "/v1/messages",
    alias: "free-auto",
    userAgent: "claude-cli/1.0.34 (external, cli)",
  });
  exporter.onError({
    requestId: "r2",
    ts: t0 + 350,
    alias: "free-auto",
    code: "rate_limit_exceeded",
  });
  exporter.onRequestEnd({
    requestId: "r2",
    ts: t0 + 400,
    method: "POST",
    path: "/v1/messages",
    alias: "free-auto",
    provider: "groq",
    model: "test-model-2",
    status: 429,
    durationMs: 100,
    failovers: 1,
  });

  const res = await app.request("/v1/clientstatus", { method: "GET" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.clients.length, 1);

  const entry = body.clients[0];
  assert.equal(entry.client, "claude-code");
  assert.equal(entry.endpoint, "/v1/messages");
  assert.equal(entry.requests, 2);
  assert.equal(entry.successRate, 0.5);
  assert.equal(entry.failovers, 1);
  assert.deepEqual(entry.topFailures, [{ reason: "429 rate_limit_exceeded", count: 1 }]);
  assert.ok(entry.lastError);
  assert.equal(entry.recent.length, 2);
});

test("unrecognized user agents appear verbatim as separate rows", async () => {
  const t0 = Date.now();
  const uas = ["SomeClient/9.9 (custom build)", "OtherClient/1.0"];
  for (const [i, ua] of uas.entries()) {
    exporter.onRequestStart({
      requestId: `r${i}`,
      ts: t0 + i,
      method: "POST",
      path: "/v1/chat/completions",
      alias: "free-auto",
      userAgent: ua,
    });
    exporter.onRequestEnd({
      requestId: `r${i}`,
      ts: t0 + 100 + i,
      method: "POST",
      path: "/v1/chat/completions",
      alias: "free-auto",
      provider: "openrouter",
      model: "test-model",
      status: 200,
      durationMs: 100,
      failovers: 0,
    });
  }

  const res = await app.request("/v1/clientstatus", { method: "GET" });
  const body = await res.json();
  assert.equal(body.clients.length, 2);
  const names = body.clients.map((c: { client: string }) => c.client).sort();
  assert.deepEqual(names, ["OtherClient/1.0", "SomeClient/9.9 (custom build)"]);
});

test("missing user agent falls back to unknown-UA without merging into others", async () => {
  const t0 = Date.now();
  exporter.onRequestStart({
    requestId: "r1",
    ts: t0,
    method: "POST",
    path: "/v1/responses",
    alias: "free-auto",
    userAgent: "",
  });
  exporter.onRequestEnd({
    requestId: "r1",
    ts: t0 + 100,
    method: "POST",
    path: "/v1/responses",
    alias: "free-auto",
    provider: "openrouter",
    model: "test-model",
    status: 200,
    durationMs: 100,
    failovers: 0,
  });

  const res = await app.request("/v1/clientstatus", { method: "GET" });
  const body = await res.json();
  assert.equal(body.clients.length, 1);
  assert.equal(body.clients[0].client, "unknown-UA");
});
