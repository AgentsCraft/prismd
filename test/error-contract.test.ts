/**
 * Unit tests for the pre-stream error contract: the Anthropic type mapping,
 * per-protocol rendering (headers included), failover outcome classification,
 * message assembly, snippet handling, and the upstream error rewrite used by
 * the /v1/messages relay path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicErrorType,
  buildFailoverProblem,
  buildNoCandidatesProblem,
  classifyFailoverOutcome,
  describeConnectFailure,
  readUpstreamErrorSnippet,
  renderProblemJson,
  rewriteUpstreamErrorBody,
  truncateSnippet,
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
  assert.equal(headers["x-prismd-request-id"], "req-123");
  assert.equal(headers["retry-after"], undefined, "no retry-after without a known recovery time");
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
  assert.equal(headers["x-prismd-request-id"], "req-abc");
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

test("buildNoCandidatesProblem names the real reasons and earliest recovery", () => {
  const problem = buildNoCandidatesProblem(
    "free-auto",
    [
      { provider: "openrouter", model: "m1", reason: "unhealthy", contextWindow: 1000 },
      { provider: "groq", model: "m2", reason: "quota_exhausted", contextWindow: 1000 },
    ],
    25_000,
  );
  assert.equal(problem.status, 429);
  assert.equal(problem.code, "quota_exceeded");
  assert.equal(problem.retryAfterMs, 25_000);
  assert.match(problem.message, /openrouter\/m1 → unhealthy/);
  assert.match(problem.message, /groq\/m2 → quota_exhausted/);
  assert.match(problem.message, /earliest recovery in ~25s/);
  const metadata = problem.metadata as { candidates: unknown[] };
  assert.equal(metadata.candidates.length, 2, "filter details survive in metadata");

  const withoutRecovery = buildNoCandidatesProblem("free-auto", [
    { provider: "openrouter", model: "m1", reason: "quota_exhausted" },
  ]);
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

test("describeConnectFailure labels timeouts vs refusals", () => {
  assert.equal(describeConnectFailure("aborted", true), "connection timeout: aborted");
  assert.equal(describeConnectFailure("ECONNREFUSED", false), "connection error: ECONNREFUSED");
  assert.equal(describeConnectFailure("y".repeat(300), false).length, 200);
});

test("readUpstreamErrorSnippet truncates the body and tolerates unreadable bodies", async () => {
  const readable = new Response('{"error":{"message":"' + "e".repeat(300) + '"}}');
  const snippet = await readUpstreamErrorSnippet(readable);
  assert.ok(snippet);
  assert.equal(snippet.length, 200);

  assert.equal(await readUpstreamErrorSnippet(new Response("")), undefined);

  const cancelled = new Response("some text");
  await cancelled.body?.cancel();
  assert.equal(await readUpstreamErrorSnippet(cancelled), undefined);
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
