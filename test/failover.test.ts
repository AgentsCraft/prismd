/**
 * M2a integration tests: the failover decision tree, both request
 * timeouts, stream break handling and quota persistence — all against a
 * local scriptable mock upstream (no real provider quota is consumed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { getQuota, resetRuntimeForTests, shutdownRuntime } from "../src/core/runtime.js";
import { exporter, type RequestEndEvent } from "../src/observability/exporter.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";
import { startMockUpstream, type MockBehavior } from "./mock-upstream.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Both providers in the fixture config point at the same mock upstream. */
function mockConfig(mockUrl: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeValidConfig({
    providers: {
      openrouter: { type: "responses", baseUrl: mockUrl, apiKeyField: "openrouter" },
      groq: { type: "responses", baseUrl: mockUrl, apiKeyField: "groq" },
    },
    ...overrides,
  });
}

/** Point the app at a temp config whose providers hit the mock upstream. */
async function setup(mockUrl: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-failover-"));
  writeFileSync(join(dir, "prismd.json"), JSON.stringify(mockConfig(mockUrl, overrides)));
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["OPENROUTER_API_KEY"] = "test-key";
  process.env["GROQ_API_KEY"] = "test-key";
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

function post(body: Record<string, unknown>): Promise<Response> {
  return app.request("/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

/** Behavior routed by the upstream model id in the request body. */
function byModel(handlers: Record<string, MockBehavior>): (captured: CapturedRequest) => MockBehavior {
  return (captured) => {
    if (captured.url?.endsWith("/models") || captured.method === "GET") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: Object.keys(handlers).map((id) => ({ id, object: "model" })),
        }),
      };
    }
    const model = captured.body?.model as string | undefined;
    const handler = model ? handlers[model] : undefined;
    if (!handler) {
      throw new Error(`mock upstream: no behavior for model "${model}"`);
    }
    return handler;
  };
}

const SSE_OK: MockBehavior = {
  status: 200,
  headers: { "content-type": "text/event-stream" },
  events: [
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":5}}\n\n',
  ],
  eventDelayMs: 5,
};

function readTable(dbPath: string, table: string): Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** Get an ephemeral free port for spawning the real server process. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

test("429 switches to the next candidate and relays the stream", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: JSON.stringify({ error: { message: "rate limited" } }),
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  assert.ok(text.includes('"response.completed"'), "second candidate stream must complete");
  assert.equal(mock.requests.length, 2, "exactly two upstream attempts (first 429, then failover)");
  assert.equal(mock.requests[0].body?.model, "poolside/laguna-s-2.1:free");
  assert.equal(mock.requests[1].body?.model, "llama-3.3-70b-versatile");
});

test("single provider multi-key 429 switches to next key on the same candidate", async (t) => {
  const mock = await startMockUpstream((captured) => {
    const auth = captured.headers?.authorization;
    if (auth === "Bearer key-1") {
      return {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: JSON.stringify({ error: { message: "rate limited on key 1" } }),
      };
    }
    if (auth === "Bearer key-2") {
      return SSE_OK;
    }
    return { status: 500, body: "unexpected key" };
  });
  t.after(() => mock.close());

  await setup(mock.url);
  process.env["OPENROUTER_API_KEY"] = "key-1,key-2";
  resetConfigForTests();
  resetRuntimeForTests();

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  assert.ok(text.includes('"response.completed"'));
  assert.equal(mock.requests.length, 2);
  // Both attempts targeted the first candidate (poolside/laguna-s-2.1:free) with different keys
  assert.equal(mock.requests[0].body?.model, "poolside/laguna-s-2.1:free");
  assert.equal(mock.requests[0].headers?.authorization, "Bearer key-1");
  assert.equal(mock.requests[1].body?.model, "poolside/laguna-s-2.1:free");
  assert.equal(mock.requests[1].headers?.authorization, "Bearer key-2");
});

test("cloud candidates 429 failover to local ollama without auth", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: JSON.stringify({ error: { message: "cloud 429" } }),
      },
      "qwen2.5-coder:7b": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "local-ok", choices: [{ message: { content: "local response" } }] }),
      },
    }),
  );
  t.after(() => mock.close());

  await setup(mock.url, {
    providers: {
      openrouter: { type: "responses", baseUrl: mock.url, apiKeyField: "openrouter" },
      ollama: { type: "chat", baseUrl: mock.url, apiKeyField: "ollama", auth: { type: "none" } },
    },
    models: {
      "free-auto": {
        candidates: [
          {
            provider: "openrouter",
            providerModelId: "poolside/laguna-s-2.1:free",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
          {
            provider: "ollama",
            providerModelId: "qwen2.5-coder:7b",
            contextWindow: 32768,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsReasoning: false,
            limits: { dailyRequests: null, rpm: 0, maxConcurrent: 4 },
            tags: ["local", "offline"],
          },
        ],
      },
    },
  });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
  assert.equal(mock.requests[0].body?.model, "poolside/laguna-s-2.1:free");
  assert.equal(mock.requests[1].body?.model, "qwen2.5-coder:7b");
  assert.equal(mock.requests[1].headers?.authorization, undefined);
});

test("5xx switches to the next candidate", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 502, body: '{"error":{"message":"upstream down"}}' },
      "llama-3.3-70b-versatile": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ok" }),
      },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
});

test("401 switches to the next candidate (auth errors count as failures)", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 401, body: '{"error":{"message":"bad key"}}' },
      "llama-3.3-70b-versatile": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ok" }),
      },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
});

test("request-class 4xx is relayed verbatim without failover", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: { message: "model not found upstream", type: "invalid_request_error", code: "not_found" } }),
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { message: string } };
  assert.equal(body.error.message, "model not found upstream");
  assert.equal(mock.requests.length, 1, "no failover for request-class 4xx");
});

test("broken stream ends with an SSE error event and is never retried", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        events: [
          'data: {"type":"response.output_text.delta","delta":"par"}\n\n',
          'data: {"type":"response.output_text.delta","delta":"tial"}\n\n',
        ],
        eventDelayMs: 5,
        breakAfterEvents: 1,
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("event: response.failed"), "broken stream must end with a Responses SSE error event");
  assert.ok(text.includes('"type":"response.failed"'));
  assert.ok(text.includes("stream_error"), "error event carries the stream_error code");
  assert.ok(!text.includes('"type":"response.completed"'), "no normal completion after a broken stream");
  assert.equal(mock.requests.length, 1, "stream breaks after start are never retried");
});

test("upstream hang before response triggers the connect timeout and switches candidate", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 200, body: "never", startDelayMs: 2_000 },
      "llama-3.3-70b-versatile": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ok" }),
      },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url, { policies: { connectTimeoutMs: 300 } });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2, "connect timeout must switch to the second candidate");
});

test("silent stream triggers the stream idle timeout and ends with an SSE error event", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        events: ['data: {"type":"response.output_text.delta","delta":"one"}\n\n'],
        hang: true,
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url, { policies: { streamIdleTimeoutMs: 200 } });

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("stream_idle_timeout"), "idle stream must end with an SSE error event");
  assert.equal(mock.requests.length, 1, "idle timeout after stream start is never retried");
});

test("all candidates 429 returns 429 with the max Retry-After and upstream snippets", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: '{"error":{"message":"limited"}}',
      },
      "llama-3.3-70b-versatile": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "20" },
        body: '{"error":{"message":"limited too"}}',
      },
    }),
  );
  t.after(() => mock.close());
  const dataPath = await setup(mock.url);

  // Capture request_end events to assert the classified path closes the lifecycle.
  const ends: RequestEndEvent[] = [];
  const originalEnd = exporter.onRequestEnd;
  exporter.onRequestEnd = (event) => {
    ends.push(event);
    originalEnd(event);
  };
  t.after(() => {
    exporter.onRequestEnd = originalEnd;
  });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 429, "all-429 must not be misreported as a 502 server fault");
  assert.equal(res.headers.get("retry-after"), "20", "Retry-After is the max across attempts");
  const body = (await res.json()) as {
    error: { code: string; message: string; metadata: { candidates: { model: string; status: number; snippet?: string }[] } };
  };
  assert.equal(body.error.code, "rate_limit_exceeded");
  assert.match(body.error.message, /poolside\/laguna-s-2\.1:free → 429 rate limit exceeded: .*limited/);
  assert.match(body.error.message, /llama-3\.3-70b-versatile → 429 rate limit exceeded: .*limited too.*retry after 20s/);
  assert.deepEqual(
    body.error.metadata.candidates.map((c) => [c.model, c.status]),
    [
      ["poolside/laguna-s-2.1:free", 429],
      ["llama-3.3-70b-versatile", 429],
    ],
  );
  assert.match(body.error.metadata.candidates[0].snippet ?? "", /limited/);
  assert.equal(mock.requests.length, 2);

  assert.equal(ends.length, 1, "the all-failed path must emit request_end");
  assert.equal(ends[0].status, 429);
  assert.equal(ends[0].failovers, 2);
  assert.equal(ends[0].provider, "groq");
  assert.equal(ends[0].model, "llama-3.3-70b-versatile");

  // The failed request consumes an attempt against the daily quota of the
  // final candidate.
  shutdownRuntime();
  const usage = readTable(dataPath, "usage_daily");
  assert.equal(usage.length, 1, "the final failed attempt is recorded");
  assert.equal(usage[0].provider, "groq");
  assert.equal(usage[0].model, "llama-3.3-70b-versatile");
  assert.equal(usage[0].requests, 1);
  assert.ok((usage[0].input_tokens as number) > 0, "the failed attempt consumes input quota");
  const logs = readTable(dataPath, "request_log");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 429, "the log carries the classified 429, not a gateway 502");
});

test("all candidates failing with 5xx returns 502 with per-candidate statuses and snippets", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 502, body: '{"error":{"message":"upstream down"}}' },
      "llama-3.3-70b-versatile": { status: 500, body: '{"error":{"message":"boom"}}' },
    }),
  );
  t.after(() => mock.close());
  const dataPath = await setup(mock.url);

  const ends: RequestEndEvent[] = [];
  const originalEnd = exporter.onRequestEnd;
  exporter.onRequestEnd = (event) => {
    ends.push(event);
    originalEnd(event);
  };
  t.after(() => {
    exporter.onRequestEnd = originalEnd;
  });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string; metadata: { candidates: { model: string; status: number; snippet?: string }[] } } };
  assert.equal(body.error.code, "gateway_all_candidates_failed");
  assert.deepEqual(
    body.error.metadata.candidates.map((c) => [c.model, c.status]),
    [
      ["poolside/laguna-s-2.1:free", 502],
      ["llama-3.3-70b-versatile", 500],
    ],
  );
  assert.match(body.error.metadata.candidates[0].snippet ?? "", /upstream down/);
  assert.match(body.error.metadata.candidates[1].snippet ?? "", /boom/);
  assert.equal(mock.requests.length, 2);

  assert.equal(ends.length, 1, "the 502 path must emit request_end");
  assert.equal(ends[0].status, 502);
  assert.equal(ends[0].failovers, 2);
  assert.equal(ends[0].provider, "groq");
  assert.equal(ends[0].model, "llama-3.3-70b-versatile");

  shutdownRuntime();
  const logs = readTable(dataPath, "request_log");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 502, "the final attempt carries the gateway 502");
});

test("all candidates unreachable returns 503 upstream_unreachable", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 200, destroy: true },
      "llama-3.3-70b-versatile": { status: 200, destroy: true },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 503, "connection-level failures are provider unavailability, not a bad gateway");
  const body = (await res.json()) as {
    error: { code: string; message: string; metadata: { candidates: { model: string; status: string; snippet?: string }[] } };
  };
  assert.equal(body.error.code, "upstream_unreachable");
  assert.match(body.error.message, /connection error/);
  assert.deepEqual(
    body.error.metadata.candidates.map((c) => [c.model, c.status]),
    [
      ["poolside/laguna-s-2.1:free", "connection_error"],
      ["llama-3.3-70b-versatile", "connection_error"],
    ],
  );
  assert.match(body.error.metadata.candidates[0].snippet ?? "", /connection error/);
});

test("all candidates over the context window returns 422 with window sizes", async (t) => {
  const mock = await startMockUpstream(SSE_OK);
  t.after(() => mock.close());
  await setup(mock.url, {
    models: {
      "free-auto": {
        candidates: [
          {
            provider: "openrouter",
            providerModelId: "poolside/laguna-s-2.1:free",
            contextWindow: 10,
            maxOutputTokens: 100,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
          {
            provider: "groq",
            providerModelId: "llama-3.3-70b-versatile",
            contextWindow: 20,
            maxOutputTokens: 100,
            supportsTools: true,
            supportsReasoning: false,
            limits: { dailyRequests: null, rpm: 30, maxConcurrent: 4 },
            tags: ["free"],
          },
        ],
      },
    },
  });

  const res = await post({ model: "free-auto", input: "x".repeat(400) });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { code: string; metadata: { candidates: { model: string; contextWindow: number }[] } } };
  assert.equal(body.error.code, "context_window_exceeded");
  assert.deepEqual(
    body.error.metadata.candidates.map((c) => [c.model, c.contextWindow]),
    [
      ["poolside/laguna-s-2.1:free", 10],
      ["llama-3.3-70b-versatile", 20],
    ],
  );
  assert.equal(mock.requests.length, 0, "window overflow is rejected before any upstream call");
});

test("all candidates quota-exhausted returns 429 with filter reasons", async (t) => {
  const mock = await startMockUpstream(SSE_OK);
  t.after(() => mock.close());
  await setup(mock.url, {
    models: {
      "free-auto": {
        candidates: [
          {
            provider: "openrouter",
            providerModelId: "poolside/laguna-s-2.1:free",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 1, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
          {
            provider: "groq",
            providerModelId: "llama-3.3-70b-versatile",
            contextWindow: 131072,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsReasoning: false,
            limits: { dailyRequests: 1, rpm: 30, maxConcurrent: 4 },
            tags: ["free"],
          },
        ],
      },
    },
  });

  // Fill today's in-memory usage for both candidates up to their limit.
  const quota = getQuota();
  quota.record({
    requestId: "warm-1",
    ts: new Date().toISOString(),
    alias: "free-auto",
    provider: "openrouter",
    model: "poolside/laguna-s-2.1:free",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 0 },
  });
  quota.record({
    requestId: "warm-2",
    ts: new Date().toISOString(),
    alias: "free-auto",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    status: 200,
    failover: 0,
    durationMs: 1,
    usage: { inputChars: 8, outputChars: 0 },
  });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 429);
  // Quota windows reset at local midnight (quota.msUntilNextDailyWindow), so
  // a quota-only precheck rejection carries that recovery time on purpose.
  const retryAfter = Number(res.headers.get("retry-after"));
  assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `retry-after should be the window reset, got ${retryAfter}`);
  const body = (await res.json()) as {
    error: { code: string; message: string; metadata: { candidates: { model: string; reason: string }[] } };
  };
  assert.equal(body.error.code, "quota_exceeded");
  assert.match(body.error.message, /earliest recovery in ~/);
  assert.deepEqual(
    body.error.metadata.candidates.map((c) => [c.model, c.reason]),
    [
      ["poolside/laguna-s-2.1:free", "quota_exhausted"],
      ["llama-3.3-70b-versatile", "quota_exhausted"],
    ],
  );
  assert.equal(mock.requests.length, 0, "quota exhaustion is rejected before any upstream call");
});

test("responses carry the request-id header", async (t) => {
  const mock = await startMockUpstream(SSE_OK);
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  const id = res.headers.get("x-request-id");
  await res.text(); // always drain the body so the stream finalizes
  assert.match(id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("completed requests are flushed to sqlite with real usage and request log", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ok", usage: { input_tokens: 7, output_tokens: 3 } }),
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  const dataPath = await setup(mock.url);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  await res.text();

  shutdownRuntime();
  const usage = readTable(dataPath, "usage_daily");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].provider, "openrouter");
  assert.equal(usage[0].model, "poolside/laguna-s-2.1:free");
  assert.equal(usage[0].requests, 1);
  assert.equal(usage[0].input_tokens, 7);
  assert.equal(usage[0].output_tokens, 3);
  assert.equal(usage[0].source, "real");

  const logs = readTable(dataPath, "request_log");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].alias, "free-auto");
  assert.equal(logs[0].status, 200);
  assert.equal(logs[0].estimated, 0);
});

test("SIGTERM drains in-flight work and flushes pending quota to sqlite", { timeout: 30_000 }, async (t) => {
  if (process.platform === "win32") {
    // Windows has no catchable cross-process signal: process.kill("SIGTERM")
    // hard-terminates the child (TerminateProcess), so its shutdown handler
    // never runs and graceful drain cannot be observed. The drain/flush
    // logic itself is covered cross-platform by drain.test.ts and the quota
    // tests; the POSIX e2e signal path runs on Linux/macOS (incl. CI).
    t.skip("Windows cannot deliver a catchable SIGTERM to a child process");
    return;
  }
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ok", usage: { input_tokens: 5, output_tokens: 2 } }),
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());

  const dir = mkdtempSync(join(tmpdir(), "prismd-server-"));
  const dataPath = join(dir, "data", "prismd.sqlite");
  const port = await freePort();
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        server: { host: "127.0.0.1", port },
        providers: {
          openrouter: { type: "responses", baseUrl: mock.url, apiKeyField: "openrouter" },
        },
        models: {
          "free-auto": {
            candidates: [
              {
                provider: "openrouter",
                providerModelId: "poolside/laguna-s-2.1:free",
                contextWindow: 262144,
                maxOutputTokens: 32768,
                supportsTools: true,
                supportsReasoning: true,
                limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
                tags: ["free"],
              },
            ],
          },
        },
      }),
    ),
  );

  const child = spawn(process.execPath, ["--import", "tsx", join(REPO_ROOT, "src", "server.ts")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PRISMD_CONFIG_PATH: join(dir, "prismd.json"),
      PRISMD_DATA_PATH: dataPath,
      PRISMD_API_KEY: "test-token",
      OPENROUTER_API_KEY: "test-key",
      PRISMD_LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  // Wait for the child to accept connections.
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "GET" });
      break; // any response (401/404/...) means the server is listening
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      assert.fail("server process did not start listening in time");
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify({ model: "free-auto", input: "hi" }),
  });
  assert.equal(res.status, 200);
  await res.text();

  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", (c) => resolve(c));
    child.kill("SIGTERM");
  });
  assert.equal(code, 0, "graceful shutdown must exit 0");

  const usage = readTable(dataPath, "usage_daily");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].requests, 1);
  assert.equal(usage[0].input_tokens, 5);
});
