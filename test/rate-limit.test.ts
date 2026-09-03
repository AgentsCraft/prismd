import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/core/rate-limit.js";
import { selectCandidate } from "../src/core/limits.js";
import type { Candidate } from "../src/types/config.js";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    provider: "groq",
    providerModelId: "llama-3.3-70b-versatile",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsReasoning: true,
    limits: {
      dailyRequests: 1000,
      rpm: 2,
      maxConcurrent: 1,
    },
    tags: ["coding"],
    ...overrides,
  };
}

test("RateLimiter enforces maxConcurrent semaphore and releases properly", () => {
  const limiter = new RateLimiter();
  const c = makeCandidate({ limits: { dailyRequests: 100, rpm: 60, maxConcurrent: 2 } });

  assert.equal(limiter.acquire(c), true);
  assert.equal(limiter.acquire(c), true);
  // Reached maxConcurrent=2
  const checkRes = limiter.check(c);
  assert.equal(checkRes.allowed, false);
  assert.equal(checkRes.reason, "concurrency_exceeded");
  assert.equal(limiter.acquire(c), false);

  // Release 1
  limiter.release(c);
  assert.equal(limiter.check(c).allowed, true);
  assert.equal(limiter.acquire(c), true);
  assert.equal(limiter.check(c).allowed, false);

  // Clean up
  limiter.release(c);
  limiter.release(c);
  assert.equal(limiter.check(c).allowed, true);
});

test("RateLimiter enforces rolling 60-second RPM window", () => {
  const limiter = new RateLimiter();
  const c = makeCandidate({ limits: { dailyRequests: 100, rpm: 2, maxConcurrent: 10 } });

  const now = 1000000;
  assert.equal(limiter.acquire(c, now), true);
  assert.equal(limiter.acquire(c, now + 1000), true);

  // Exceeded rpm=2
  const checkRes = limiter.check(c, now + 2000);
  assert.equal(checkRes.allowed, false);
  assert.equal(checkRes.reason, "rpm_exceeded");
  assert.equal(limiter.acquire(c, now + 2000), false);

  // 60 seconds later, window slides past the first request
  assert.equal(limiter.acquire(c, now + 60001), true);
});

test("selectCandidate filters out rate-limited candidates and fails over to next candidate", () => {
  const limiter = new RateLimiter();
  const cand1 = makeCandidate({
    provider: "p1",
    providerModelId: "m1",
    limits: { dailyRequests: 100, rpm: 1, maxConcurrent: 1 },
  });
  const cand2 = makeCandidate({
    provider: "p2",
    providerModelId: "m2",
    limits: { dailyRequests: 100, rpm: 10, maxConcurrent: 10 },
  });

  // Saturate cand1 concurrency
  assert.equal(limiter.acquire(cand1), true);

  const result = selectCandidate([cand1, cand2], {
    inputChars: 100,
    dailyRequests: () => 0,
    isHealthy: () => true,
    quotaSoftLimitRatio: 0.8,
    checkRateLimit: (cand) => limiter.check(cand),
  });

  // Fails over to cand2
  assert.equal(result.selected?.providerModelId, "m2");
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].reason, "concurrency_exceeded");
  assert.equal(result.filtered[0].model, "m1");
});
