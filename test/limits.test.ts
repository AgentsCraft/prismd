import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCandidate, estimateInputTokens } from "../src/core/limits.js";
import type { Candidate } from "../src/types/config.js";
import { makeValidConfig } from "./helpers.js";

function candidate(overrides: Partial<Candidate> & { provider: string; providerModelId: string }): Candidate {
  return {
    contextWindow: 10000,
    maxOutputTokens: 1000,
    supportsTools: true,
    supportsReasoning: true,
    limits: { dailyRequests: 10, rpm: 20, maxConcurrent: 2 },
    tags: [],
    ...overrides,
  };
}

interface Ctx {
  daily: Record<string, number>;
  healthy?: Record<string, boolean>;
  ratio?: number;
  inputChars?: number;
}

function ctx(inputChars: number, opts: Ctx) {
  return {
    inputChars,
    dailyRequests: (p: string, m: string) => opts.daily[`${p}\u0000${m}`] ?? 0,
    isHealthy: (p: string, m: string) => opts.healthy?.[`${p}\u0000${m}`] ?? true,
    quotaSoftLimitRatio: opts.ratio ?? 0.8,
  };
}

test("estimateInputTokens is chars/4 rounded up", () => {
  assert.equal(estimateInputTokens(0), 0);
  assert.equal(estimateInputTokens(8), 2);
  assert.equal(estimateInputTokens(9), 3);
});

test("picks the first candidate when nothing is filtered", () => {
  const candidates = [
    candidate({ provider: "openrouter", providerModelId: "m1" }),
    candidate({ provider: "groq", providerModelId: "m2" }),
  ];
  const result = selectCandidate(candidates, ctx(100, { daily: {}, healthy: {} }));
  assert.equal(result.selected?.providerModelId, "m1");
  assert.deepEqual(result.filtered, []);
  assert.equal(result.allWindowExceeded, false);
  assert.deepEqual(result.ordered.map((c) => c.providerModelId), ["m1", "m2"]);
});

test("hard-excludes candidates whose input exceeds the context window", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "small", contextWindow: 100 }),
    candidate({ provider: "b", providerModelId: "big", contextWindow: 100000 }),
  ];
  const result = selectCandidate(candidates, ctx(2000, { daily: {}, healthy: {} }));
  assert.equal(result.selected?.providerModelId, "big");
  assert.deepEqual(result.windowExceeded, [{ provider: "a", model: "small", contextWindow: 100 }]);
  assert.equal(result.allWindowExceeded, false);
});

test("all candidates over the window -> allWindowExceeded", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "m1", contextWindow: 100 }),
    candidate({ provider: "b", providerModelId: "m2", contextWindow: 200 }),
  ];
  const result = selectCandidate(candidates, ctx(2000, { daily: {}, healthy: {} }));
  assert.equal(result.selected, undefined);
  assert.equal(result.allWindowExceeded, true);
  assert.equal(result.windowExceeded.length, 2);
});

test("hard-excludes unhealthy candidates", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "sick" }),
    candidate({ provider: "b", providerModelId: "well" }),
  ];
  const result = selectCandidate(candidates, ctx(100, { daily: {}, healthy: { "a\u0000sick": false } }));
  assert.equal(result.selected?.providerModelId, "well");
  assert.deepEqual(result.filtered, [
    { provider: "a", model: "sick", reason: "unhealthy", contextWindow: 10000 },
  ]);
});

test("hard-excludes candidates with exhausted daily quota", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "spent", limits: { dailyRequests: 10, rpm: 1, maxConcurrent: 1 } }),
    candidate({ provider: "b", providerModelId: "fresh", limits: { dailyRequests: 10, rpm: 1, maxConcurrent: 1 } }),
  ];
  const result = selectCandidate(candidates, ctx(100, { daily: { "a\u0000spent": 10 } }));
  assert.equal(result.selected?.providerModelId, "fresh");
  assert.deepEqual(result.filtered, [
    { provider: "a", model: "spent", reason: "quota_exhausted", contextWindow: 10000 },
  ]);
});

test("null dailyRequests never hard-excludes", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "unknown-quota", limits: { dailyRequests: null, rpm: 1, maxConcurrent: 1 } }),
  ];
  const result = selectCandidate(candidates, ctx(100, { daily: { "a\u0000unknown-quota": 9999 } }));
  assert.equal(result.selected?.providerModelId, "unknown-quota");
});

test("soft-demotes candidates at or above quotaSoftLimitRatio to the tail", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "almost-spent", limits: { dailyRequests: 10, rpm: 1, maxConcurrent: 1 } }),
    candidate({ provider: "b", providerModelId: "fresh", limits: { dailyRequests: 10, rpm: 1, maxConcurrent: 1 } }),
    candidate({ provider: "c", providerModelId: "fresh2", limits: { dailyRequests: 10, rpm: 1, maxConcurrent: 1 } }),
  ];
  // 8/10 used >= 0.8 -> demoted behind both fresh candidates.
  const result = selectCandidate(candidates, ctx(100, { daily: { "a\u0000almost-spent": 8 }, ratio: 0.8 }));
  assert.equal(result.selected?.providerModelId, "fresh");
  assert.deepEqual(result.ordered.map((c) => c.providerModelId), ["fresh", "fresh2", "almost-spent"]);
});

test("all filtered by quota/health leaves no selection with per-candidate reasons", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "spent", limits: { dailyRequests: 1, rpm: 1, maxConcurrent: 1 } }),
    candidate({ provider: "b", providerModelId: "sick" }),
  ];
  const result = selectCandidate(candidates, ctx(100, { daily: { "a\u0000spent": 1 }, healthy: { "b\u0000sick": false } }));
  assert.equal(result.selected, undefined);
  assert.equal(result.allWindowExceeded, false);
  assert.deepEqual(result.filtered, [
    { provider: "a", model: "spent", reason: "quota_exhausted", contextWindow: 10000 },
    { provider: "b", model: "sick", reason: "unhealthy", contextWindow: 10000 },
  ]);
});

test("window overflow wins over quota/health for the 422 decision", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "small", contextWindow: 10 }),
    candidate({ provider: "b", providerModelId: "spent-small", contextWindow: 10 }),
  ];
  const result = selectCandidate(candidates, ctx(2000, { daily: { "b\u0000spent-small": 999 } }));
  assert.equal(result.selected, undefined);
  assert.equal(result.allWindowExceeded, true);
});

test("works with the makeValidConfig fixture candidates", () => {
  const config = makeValidConfig();
  const candidates = (config.models as Record<string, { candidates: Candidate[] }>)["free-auto"].candidates;
  const result = selectCandidate(candidates, ctx(40, { daily: {}, healthy: {} }));
  assert.equal(result.selected?.providerModelId, "poolside/laguna-s-2.1:free");
});

test("hard-excludes candidates that do not support tools when requireTools is true", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "no-tools", supportsTools: false }),
    candidate({ provider: "b", providerModelId: "has-tools", supportsTools: true }),
  ];
  const context = {
    ...ctx(100, { daily: {}, healthy: {} }),
    requireTools: true,
  };
  const result = selectCandidate(candidates, context);
  assert.equal(result.selected?.providerModelId, "has-tools");
  assert.deepEqual(result.filtered, [
    { provider: "a", model: "no-tools", reason: "tools_unsupported", contextWindow: 10000 },
  ]);
});

test("hard-excludes candidates that do not support reasoning when requireReasoning is true", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "no-reasoning", supportsReasoning: false }),
    candidate({ provider: "b", providerModelId: "has-reasoning", supportsReasoning: true }),
  ];
  const context = {
    ...ctx(100, { daily: {}, healthy: {} }),
    requireReasoning: true,
  };
  const result = selectCandidate(candidates, context);
  assert.equal(result.selected?.providerModelId, "has-reasoning");
  assert.deepEqual(result.filtered, [
    { provider: "a", model: "no-reasoning", reason: "reasoning_unsupported", contextWindow: 10000 },
  ]);
});

test("prioritizes candidates matching requested tags", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "generic", tags: ["general"] }),
    candidate({ provider: "b", providerModelId: "fast-coder", tags: ["coding", "fast"] }),
    candidate({ provider: "c", providerModelId: "slow-coder", tags: ["coding"] }),
  ];
  const context = {
    ...ctx(100, { daily: {}, healthy: {} }),
    tags: ["coding", "fast"],
  };
  const result = selectCandidate(candidates, context);
  assert.equal(result.selected?.providerModelId, "fast-coder");
  assert.deepEqual(
    result.ordered.map((c) => c.providerModelId),
    ["fast-coder", "slow-coder", "generic"],
  );
});

test("preserves stable order for candidates with identical tag match scores", () => {
  const candidates = [
    candidate({ provider: "a", providerModelId: "m1", tags: ["coding"] }),
    candidate({ provider: "b", providerModelId: "m2", tags: ["coding"] }),
    candidate({ provider: "c", providerModelId: "m3", tags: ["other"] }),
  ];
  const context = {
    ...ctx(100, { daily: {}, healthy: {} }),
    tags: ["coding"],
  };
  const result = selectCandidate(candidates, context);
  assert.deepEqual(
    result.ordered.map((c) => c.providerModelId),
    ["m1", "m2", "m3"],
  );
});

