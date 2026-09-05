/**
 * /v1/messages error contract: every gateway-produced and upstream-relayed
 * error must reach Anthropic clients (Claude Code) in the native Anthropic
 * shape {"type":"error","error":{"type","message"}}, with self-contained
 * messages that carry the upstream's own reason text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { getKeyPool, getQuota, resetRuntimeForTests } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";
import { startMockUpstream, type CapturedRequest, type MockBehavior } from "./mock-upstream.js";

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

async function setup(mockUrl: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-messages-err-"));
  writeFileSync(join(dir, "prismd.json"), JSON.stringify(mockConfig(mockUrl, overrides)));
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["OPENROUTER_API_KEY"] = "test-key";
  process.env["GROQ_API_KEY"] = "test-key";
  useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
}

function postMessages(body: string): Promise<Response> {
  return app.request("/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-token" },
    body,
  });
}

function postClaude(body: Record<string, unknown>): Promise<Response> {
  return postMessages(JSON.stringify(body));
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

type AnthropicErrorBody = { type: string; error: { type: string; message: string } };

async function parseAnthropicError(res: Response): Promise<AnthropicErrorBody> {
  const body = (await res.json()) as AnthropicErrorBody;
  return body;
}

test("OpenAI-shaped 429 from upstream reaches Claude Code as an Anthropic error with the upstream text", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: JSON.stringify({ error: { message: "upstream says slow down" } }),
      },
      "llama-3.3-70b-versatile": {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "5" },
        body: JSON.stringify({ error: { message: "upstream says slow down" } }),
      },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(res.status, 429, "all-429 must surface as 429, not a gateway 502");
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("retry-after"), "5");

  const body = await parseAnthropicError(res);
  assert.equal(body.type, "error", "body must use the Anthropic error envelope");
  assert.equal(body.error.type, "rate_limit_error");
  assert.match(body.error.message, /openrouter\/poolside\/laguna-s-2\.1:free/);
  assert.match(body.error.message, /upstream says slow down/, "message must carry the upstream's own reason");
  assert.match(body.error.message, /429 rate limit exceeded/);
});

test("OpenAI-shaped upstream 404 passthrough is rewritten into the Anthropic shape", async (t) => {
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

  const res = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(res.status, 404, "request-class 4xx status is preserved");
  assert.equal(res.headers.get("x-prismd-provider"), "openrouter");
  assert.equal(res.headers.get("x-prismd-model"), "poolside/laguna-s-2.1:free");

  const body = await parseAnthropicError(res);
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "invalid_request_error", "an Anthropic-compatible upstream type is kept");
  assert.equal(body.error.message, "openrouter/poolside/laguna-s-2.1:free: model not found upstream");
  assert.equal(mock.requests.length, 1, "no failover for request-class 4xx");
});

test("non-JSON upstream error body is relayed verbatim inside the Anthropic message", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": {
        status: 404,
        headers: { "content-type": "text/plain" },
        body: "upstream exploded",
      },
      "llama-3.3-70b-versatile": SSE_OK,
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(res.status, 404);
  const body = await parseAnthropicError(res);
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "not_found_error", "type falls back to the status mapping");
  assert.equal(body.error.message, "openrouter/poolside/laguna-s-2.1:free: upstream exploded");
});

test("all candidates unreachable on /v1/messages returns 503 in the Anthropic shape", async (t) => {
  const mock = await startMockUpstream(
    byModel({
      "poolside/laguna-s-2.1:free": { status: 200, destroy: true },
      "llama-3.3-70b-versatile": { status: 200, destroy: true },
    }),
  );
  t.after(() => mock.close());
  await setup(mock.url);

  const res = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(res.status, 503, "connection-level failures classify as 503 upstream_unreachable");
  const body = await parseAnthropicError(res);
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "api_error", "5xx maps to the Anthropic api_error type");
  assert.match(body.error.message, /connection error/);
  assert.match(body.error.message, /groq\/llama-3\.3-70b-versatile/);
});

test("gateway precheck errors on /v1/messages are Anthropic-shaped", async (t) => {
  // Malformed JSON -> 400 invalid_request_error.
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
            tags: ["free", "fast"],
          },
        ],
      },
    },
  });

  const bad = await postMessages("{not json");
  assert.equal(bad.status, 400);
  const badBody = await parseAnthropicError(bad);
  assert.equal(badBody.type, "error");
  assert.equal(badBody.error.type, "invalid_request_error");

  // All candidates quota-exhausted -> 429 naming the real per-candidate reason.
  const quota = getQuota();
  for (const [provider, model] of [
    ["openrouter", "poolside/laguna-s-2.1:free"],
    ["groq", "llama-3.3-70b-versatile"],
  ] as const) {
    quota.record({
      requestId: "warm",
      ts: new Date().toISOString(),
      alias: "free-auto",
      provider,
      model,
      status: 200,
      failover: 0,
      durationMs: 1,
      usage: { inputChars: 8, outputChars: 0 },
    });
  }
  const limited = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(limited.status, 429);
  const limitedBody = await parseAnthropicError(limited);
  assert.equal(limitedBody.type, "error");
  assert.equal(limitedBody.error.type, "rate_limit_error");
  assert.match(limitedBody.error.message, /openrouter\/poolside\/laguna-s-2\.1:free → quota_exhausted/);
  assert.match(limitedBody.error.message, /groq\/llama-3\.3-70b-versatile → quota_exhausted/);
  assert.equal(mock.requests.length, 0, "precheck rejection happens before any upstream call");
});

test("cooled-down candidates produce a 429 with Retry-After and the earliest recovery on /v1/messages", async (t) => {
  const mock = await startMockUpstream(SSE_OK);
  t.after(() => mock.close());
  // Single-candidate alias: cooling its only key must trigger the precheck branch.
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
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
        ],
      },
    },
  });

  // Simulate upstream 429s: three consecutive key failures trip the cooldown.
  const keyPool = getKeyPool();
  for (let i = 0; i < 3; i += 1) {
    keyPool.recordFailure("openrouter", "poolside/laguna-s-2.1:free", "test-key", {
      status: 429,
      retryAfterMs: 20_000,
    });
  }

  const res = await postClaude({
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(res.status, 429);
  const retryAfter = Number(res.headers.get("retry-after"));
  assert.ok(retryAfter >= 50 && retryAfter <= 60, `retry-after should be ~60s (cooldown), got ${retryAfter}`);

  const body = await parseAnthropicError(res);
  assert.equal(body.type, "error");
  assert.equal(body.error.type, "rate_limit_error");
  assert.match(body.error.message, /openrouter\/poolside\/laguna-s-2\.1:free → unhealthy/);
  assert.match(body.error.message, /earliest recovery in ~\d+s/);
  assert.equal(mock.requests.length, 0);
});
