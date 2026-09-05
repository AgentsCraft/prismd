/**
 * Unit tests for the pre-stream error contract: the Anthropic type mapping,
 * per-protocol rendering (headers included), failover outcome classification,
 * message assembly, bounded upstream-body reading, and the upstream error
 * rewrite used by the /v1/messages relay path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicErrorType,
  buildFailoverProblem,
  buildNoCandidatesProblem,
  classifyFailoverOutcome,
  describeConnectFailure,
  precheckRetryAfterMs,
  readBoundedBodyText,
  readUpstreamErrorSnippet,
  renderProblemJson,
  rewriteUpstreamErrorBody,
  truncateSnippet,
  UPSTREAM_ERROR_MESSAGE_MAX_CHARS,
  type FailedAttempt,
} from "../src/core/error-contract.js";

test("anthropicErrorType maps statuses to Anthropic error types", () => {
  assert.equal(anthropicErrorType(400), "invalid_request_error");
  assert.equal(anthropicErrorType(405), "invalid_request_error");
  assert.equal(anthropicErrorType(422), "invalid_request_error");
  assert.equal(anthropicErrorType(401), "authentication_error");
  assert.equal(anthropicErrorType(403), "permission_error");
  assert.equal(anthropicErrorType(404), "not_found_error");
  assert.equal(anthropicErrorType(413), "request_too_large");
  assert.equal(anthropicErrorType(429), "rate_limit_error");
  assert.equal(anthropicErrorType(500), "api_error");
  assert.equal(anthropicErrorType(503), "api_error");
  assert.equal(anthropicErrorType(529), "overloaded_error");
  // Unlisted 4xx fall back to invalid_request_error, not api_error.
  assert.equal(anthropicErrorType(409), "invalid_request_error");
});

test("renderProblemJson keeps the OpenAI gateway error shape with candidates and snippet", () => {
  const { body, headers } = renderProblemJson(
    {
      status: 502,
      code: "gateway_all_candidates_failed",
      message: "all candidates failed: openrouter/m1 → 500: boom",
      candidates: [
        { provider: "openrouter", model: "m1", status: 500, snippet: "boom" },
        { provider: "groq", model: "m2", status: "connection_error" },
      ],
      requestId: "req-123",
    },
    "openai",
  );
  const err = (body as { error: { message: string; type: string; code: string; metadata: { candidates: unknown[] } } }).error;
  assert.equal(err.type, "server_error", "5xx keeps the OpenAI server_error type");
  assert.equal(err.code, "gateway_all_candidates_failed");
  assert.match(err.message, /openrouter\/m1 → 500: boom/);
  assert.deepEqual(err.metadata.candidates, [
    { provider: "openrouter", model: "m1", status: 500, snippet: "boom" },
    { provider: "groq", model: "m2", status: "connection_error" },
  ]);
  assert.equal(headers["retry-after"], undefined, "no retry-after without a known recovery time");
  assert.equal(
    headers["x-prismd-request-id"],
    undefined,
    "request correlation rides the global x-request-id header only",
  );
});

test("renderProblemJson renders the Anthropic shape with retry-after headers", () => {
  const { body, headers } = renderProblemJson(
    {
      status: 429,
      code: "rate_limit_exceeded",
      message: "all 2 candidate attempts for alias \"free-auto\" failed: openrouter/m1 → 429 rate limit exceeded, retry after 20s",
      retryAfterMs: 20_400,
      requestId: "req-abc",
    },
    "anthropic",
  );
  assert.deepEqual(body, {
    type: "error",
    error: {
      type: "rate_limit_error",
      message: 'all 2 candidate attempts for alias "free-auto" failed: openrouter/m1 → 429 rate limit exceeded, retry after 20s',
    },
  });
  assert.equal(headers["retry-after"], "21", "retry-after is whole seconds, never under-reporting");
  assert.equal(headers["x-prismd-request-id"], undefined);
});

test("classifyFailoverOutcome: any 429 wins with the max Retry-After", () => {
  const attempts: FailedAttempt[] = [
    { provider: "openrouter", model: "m1", status: 500 },
    { provider: "groq", model: "m2", status: 429, retryAfterMs: 5_000 },
    { provider: "cerebras", model: "m3", status: 429, retryAfterMs: 20_000 },
  ];
  assert.deepEqual(classifyFailoverOutcome(attempts), {
    status: 429,
    code: "rate_limit_exceeded",
    retryAfterMs: 20_000,
  });
});

test("classifyFailoverOutcome: only connect failures yield 503 upstream_unreachable", () => {
  const attempts: FailedAttempt[] = [
    { provider: "openrouter", model: "m1", status: null },
    { provider: "groq", model: "m2", status: null, snippet: "connection timeout: aborted" },
  ];
  assert.deepEqual(classifyFailoverOutcome(attempts), { status: 503, code: "upstream_unreachable" });
});

test("classifyFailoverOutcome: 5xx mixes stay 502 gateway_all_candidates_failed", () => {
  const attempts: FailedAttempt[] = [
    { provider: "openrouter", model: "m1", status: 502 },
    { provider: "groq", model: "m2", status: 500 },
  ];
  assert.deepEqual(classifyFailoverOutcome(attempts), { status: 502, code: "gateway_all_candidates_failed" });
});

test("classifyFailoverOutcome: an empty attempt list is guarded explicitly", () => {
  assert.deepEqual(classifyFailoverOutcome([]), { status: 502, code: "gateway_all_candidates_failed" });
});

test("buildFailoverProblem writes a self-contained per-candidate message", () => {
  const problem = buildFailoverProblem(
    "free-auto",
    [
      { provider: "openrouter", model: "deepseek-r1", status: 429, retryAfterMs: 20_000 },
      { provider: "groq", model: "llama-4", status: null, snippet: "connection timeout after 1000ms" },
    ],
    "req-1",
  );
  assert.equal(problem.status, 429);
  assert.equal(problem.code, "rate_limit_exceeded");
  assert.equal(problem.retryAfterMs, 20_000);
  assert.equal(
    problem.message,
    'all 2 candidate attempts for alias "free-auto" failed: ' +
      "openrouter/deepseek-r1 → 429 rate limit exceeded, retry after 20s; " +
      "groq/llama-4 → connection timeout after 1000ms",
  );
  assert.deepEqual(problem.candidates, [
    { provider: "openrouter", model: "deepseek-r1", status: 429 },
    { provider: "groq", model: "llama-4", status: "connection_error", snippet: "connection timeout after 1000ms" },
  ]);
  assert.equal(problem.requestId, "req-1");
});

test("precheckRetryAfterMs: cooldown recovery wins and is at least 1s", () => {
  const now = 1_000_000;
  const quotaOnly = [{ provider: "a", model: "m", reason: "quota_exhausted" }];
  assert.equal(precheckRetryAfterMs(quotaOnly, now + 25_000, now), 25_000);
  assert.equal(precheckRetryAfterMs(quotaOnly, now + 200, now), 1000, "past-due cooldowns still back off 1s");
});

test("precheckRetryAfterMs: quota-only with no cooldown defers to the next daily window reset", () => {
  // 2026-01-15 10:30 local -> reset at local midnight = 13.5h later.
  const now = new Date(2026, 0, 15, 10, 30, 0, 0).getTime();
  const expected = new Date(2026, 0, 16, 0, 0, 0, 0).getTime() - now;
  const quotaOnly = [
    { provider: "a", model: "m1", reason: "quota_exhausted" },
    { provider: "b", model: "m2", reason: "quota_exhausted" },
  ];
  assert.equal(precheckRetryAfterMs(quotaOnly, null, now), expected);
  assert.ok(expected > 0 && expected <= 86_400_000);
});

test("precheckRetryAfterMs: mixed reasons without cooldown get no Retry-After", () => {
  const mixed = [
    { provider: "a", model: "m1", reason: "quota_exhausted" },
    { provider: "b", model: "m2", reason: "unhealthy" },
  ];
  assert.equal(precheckRetryAfterMs(mixed, null, 1_000_000), undefined);
  assert.equal(precheckRetryAfterMs([], null, 1_000_000), undefined);
});

test("buildNoCandidatesProblem names the real reasons, filter details, and recovery", () => {
  const now = new Date(2026, 0, 15, 10, 30, 0, 0).getTime();
  const problem = buildNoCandidatesProblem(
    "free-auto",
    {
      filtered: [
        { provider: "openrouter", model: "m1", reason: "unhealthy", contextWindow: 1000 },
        { provider: "groq", model: "m2", reason: "quota_exhausted", contextWindow: 1000 },
      ],
      windowExceeded: [{ provider: "cerebras", model: "m3", contextWindow: 20 }],
    },
    [
      { provider: "openrouter", providerModelId: "m1" },
      { provider: "groq", providerModelId: "m2" },
      { provider: "cerebras", providerModelId: "m3" },
    ],
    (provider) => (provider === "openrouter" ? now + 25_000 : null),
    now,
  );
  assert.equal(problem.status, 429);
  assert.equal(problem.code, "quota_exceeded");
  assert.equal(problem.retryAfterMs, 25_000, "the cooldown recovery wins over the window reset");
  assert.match(problem.message, /openrouter\/m1 → unhealthy/);
  assert.match(problem.message, /groq\/m2 → quota_exhausted/);
  assert.match(problem.message, /cerebras\/m3 → context_window_exceeded/);
  assert.match(problem.message, /earliest recovery in ~25s/);
  const metadata = problem.metadata as { candidates: unknown[] };
  assert.equal(metadata.candidates.length, 3, "filter details (incl. window overflow) survive in metadata");

  const quotaOnly = buildNoCandidatesProblem(
    "free-auto",
    {
      filtered: [{ provider: "groq", model: "m2", reason: "quota_exhausted", contextWindow: 1000 }],
      windowExceeded: [],
    },
    [{ provider: "groq", providerModelId: "m2" }],
    () => null,
    now,
  );
  assert.ok(quotaOnly.retryAfterMs !== undefined, "quota-only waits for the daily window reset");
  assert.match(quotaOnly.message, /earliest recovery in ~\d+h/);

  const withoutRecovery = buildNoCandidatesProblem(
    "free-auto",
    {
      filtered: [{ provider: "groq", model: "m2", reason: "unhealthy", contextWindow: 1000 }],
      windowExceeded: [],
    },
    [{ provider: "groq", providerModelId: "m2" }],
    () => null,
    now,
  );
  assert.equal(withoutRecovery.retryAfterMs, undefined);
  assert.ok(!withoutRecovery.message.includes("earliest recovery"));
});

test("truncateSnippet collapses whitespace and caps the length", () => {
  assert.equal(truncateSnippet("  line1\n\nline2\t  "), "line1 line2");
  const long = "x".repeat(500);
  assert.equal(truncateSnippet(long).length, 200);
  assert.equal(truncateSnippet(long), "x".repeat(200));
  assert.equal(truncateSnippet("", 10), "");
});

test("truncateSnippet masks credential-shaped substrings before relaying", () => {
  assert.equal(
    truncateSnippet("invalid key sk-or-v1-abcdef1234567890 for model x"),
    "invalid key sk-or*** for model x",
  );
  const bearer = truncateSnippet("bad credentials: Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature rejected");
  assert.ok(!bearer.includes("eyJhbGciOiJIUzI1NiJ9"), "bearer tokens must not survive");
  assert.ok(bearer.startsWith("bad credentials: Beare***"));
  assert.equal(truncateSnippet("call failed: https://api.x.com/v1?key=supersecret123"), "call failed: https://api.x.com/v1?key=***");
  // Ordinary error text passes through untouched.
  assert.equal(truncateSnippet("rate limit exceeded: free-models-per-day"), "rate limit exceeded: free-models-per-day");
});

test("describeConnectFailure labels timeouts vs refusals for any thrown value", () => {
  assert.equal(describeConnectFailure(new Error("aborted"), true), "connection timeout: aborted");
  assert.equal(describeConnectFailure(new Error("ECONNREFUSED"), false), "connection error: ECONNREFUSED");
  assert.equal(describeConnectFailure("boom", false), "connection error: boom", "non-Error throwables are stringified");
  assert.equal(describeConnectFailure(42, false), "connection error: 42");
  assert.equal(describeConnectFailure("y".repeat(300), false).length, 200);
});

test("readUpstreamErrorSnippet truncates the body and tolerates unreadable bodies", async () => {
  const readable = new Response('{"error":{"message":"' + "e".repeat(300) + '"}}');
  const snippet = await readUpstreamErrorSnippet(readable, 1000);
  assert.ok(snippet);
  assert.equal(snippet.length, 200);

  assert.equal(await readUpstreamErrorSnippet(new Response(""), 1000), undefined);

  const cancelled = new Response("some text");
  await cancelled.body?.cancel();
  assert.equal(await readUpstreamErrorSnippet(cancelled, 1000), undefined);
});

test("readUpstreamErrorSnippet gives up on stalled bodies instead of hanging", async () => {
  // A body that emits one small chunk and then stalls forever: the read must
  // degrade to undefined under the short deadline, not block the failover.
  const stalled = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        // never closes
      },
    }),
  );
  const startedAt = Date.now();
  const snippet = await readUpstreamErrorSnippet(stalled, 60);
  const elapsed = Date.now() - startedAt;
  assert.equal(snippet, undefined, "a stalled body must not produce a snippet");
  assert.ok(elapsed < 2000, `the deadline race must fire quickly, took ${elapsed}ms`);
});

test("readBoundedBodyText stops at the character cap and releases the body", async () => {
  const big = new Response("z".repeat(5000));
  const text = await readBoundedBodyText(big, 1000, 100);
  assert.equal(text, "z".repeat(100), "at most maxChars characters are buffered");

  const empty = new Response("");
  assert.equal(await readBoundedBodyText(empty, 1000, 100), "");
});

test("rewriteUpstreamErrorBody converts OpenAI shapes and prefixes provider/model", () => {
  const rewritten = rewriteUpstreamErrorBody(
    JSON.stringify({ error: { message: "rate limited upstream", type: "invalid_request_error", code: "x" } }),
    400,
    "openrouter",
    "deepseek-r1",
  );
  assert.deepEqual(rewritten, {
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "openrouter/deepseek-r1: rate limited upstream",
    },
  });
});

test("rewriteUpstreamErrorBody maps non-Anthropic upstream types by status", () => {
  const rewritten = rewriteUpstreamErrorBody(
    JSON.stringify({ error: { message: "boom", type: "server_error" } }),
    503,
    "groq",
    "llama-4",
  );
  const err = (rewritten as { error: { type: string; message: string } }).error;
  assert.equal(err.type, "api_error", "OpenAI's server_error is not an Anthropic type name");
  assert.equal(err.message, "groq/llama-4: boom");
});

test("rewriteUpstreamErrorBody keeps Anthropic type names from the upstream", () => {
  const rewritten = rewriteUpstreamErrorBody(
    JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }),
    529,
    "anthropic",
    "claude-3",
  );
  const err = (rewritten as { error: { type: string; message: string } }).error;
  assert.equal(err.type, "overloaded_error");
  assert.equal(err.message, "anthropic/claude-3: overloaded");
});

test("rewriteUpstreamErrorBody puts non-JSON and empty bodies into the message", () => {
  const nonJson = rewriteUpstreamErrorBody("<html>Bad Gateway</html>", 502, "openrouter", "m1");
  const nonJsonErr = (nonJson as { error: { type: string; message: string } }).error;
  assert.equal(nonJsonErr.type, "api_error");
  assert.equal(nonJsonErr.message, "openrouter/m1: <html>Bad Gateway</html>");

  const empty = rewriteUpstreamErrorBody("", 500, "groq", "m2");
  const emptyErr = (empty as { error: { message: string } }).error;
  assert.equal(emptyErr.message, "groq/m2: upstream returned status 500");
});

test("rewriteUpstreamErrorBody caps the message and survives degenerate JSON bodies", () => {
  const longText = "w".repeat(3000);
  const capped = rewriteUpstreamErrorBody(longText, 502, "openrouter", "m1");
  const cappedErr = (capped as { error: { message: string } }).error;
  assert.equal(
    cappedErr.message,
    `openrouter/m1: ${"w".repeat(UPSTREAM_ERROR_MESSAGE_MAX_CHARS)}`,
    "the raw body is truncated, not relayed in full",
  );

  for (const body of ["null", JSON.stringify({ error: null }), JSON.stringify({ error: { message: "" } }), "{}"]) {
    const rewritten = rewriteUpstreamErrorBody(body, 500, "groq", "m2") as { error: { message: string } };
    assert.match(rewritten.error.message, /^groq\/m2: /, `degenerate body ${body} still yields a prefixed message`);
    assert.ok(!rewritten.error.message.includes("undefined"));
  }
});
