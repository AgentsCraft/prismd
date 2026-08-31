import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthManager } from "../src/core/health.js";

test("candidates start healthy with no failures", () => {
  const h = new HealthManager();
  assert.equal(h.get("openrouter", "m1").state, "healthy");
  assert.equal(h.isHealthy("openrouter", "m1"), true);
});

test("failures below the threshold keep the candidate healthy", () => {
  const h = new HealthManager();
  h.recordFailure("openrouter", "m1", { status: 500 });
  h.recordFailure("openrouter", "m1", { status: 500 });
  assert.equal(h.get("openrouter", "m1").state, "healthy");
  assert.equal(h.get("openrouter", "m1").consecutiveFailures, 2);
  assert.equal(h.isHealthy("openrouter", "m1"), true);
});

test("reaching failThreshold moves to cooldown for cooldownMs", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 3, cooldownMs: 60_000 });
  h.recordFailure("openrouter", "m1", { status: 500 });
  h.recordFailure("openrouter", "m1", { status: 500 });
  h.recordFailure("openrouter", "m1", { status: 500 });
  const health = h.get("openrouter", "m1");
  assert.equal(health.state, "cooldown");
  assert.equal(health.cooldownUntil, now + 60_000);
  assert.equal(h.isHealthy("openrouter", "m1"), false);

  // Still cooling just before the deadline; healthy again after it.
  now = 1_060_000 - 1;
  assert.equal(h.isHealthy("openrouter", "m1"), false);
  now = 1_060_000;
  assert.equal(h.isHealthy("openrouter", "m1"), true);
  assert.equal(h.get("openrouter", "m1").state, "half_open");
});

test("half-open probe success returns to healthy and resets failures", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 2, cooldownMs: 60_000 });
  h.recordFailure("openrouter", "m1");
  h.recordFailure("openrouter", "m1");
  assert.equal(h.get("openrouter", "m1").state, "cooldown");
  now += 60_000;
  assert.equal(h.isHealthy("openrouter", "m1"), true); // half-open
  h.recordSuccess("openrouter", "m1");
  const health = h.get("openrouter", "m1");
  assert.equal(health.state, "healthy");
  assert.equal(health.consecutiveFailures, 0);
});

test("half-open probe failure re-cools the candidate", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 2, cooldownMs: 60_000 });
  h.recordFailure("openrouter", "m1");
  h.recordFailure("openrouter", "m1");
  now += 60_000;
  assert.equal(h.isHealthy("openrouter", "m1"), true); // half-open probe allowed
  h.recordFailure("openrouter", "m1");
  const health = h.get("openrouter", "m1");
  assert.equal(health.state, "cooldown");
  assert.equal(health.cooldownUntil, now + 60_000);
  assert.equal(h.isHealthy("openrouter", "m1"), false);
});

test("429 with Retry-After cools for max(cooldownMs, retry-after)", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 1, cooldownMs: 60_000, respectRetryAfter: true });
  h.recordFailure("openrouter", "m1", { status: 429, retryAfterMs: 120_000 });
  assert.equal(h.get("openrouter", "m1").cooldownUntil, now + 120_000);

  now = 2_000_000;
  const h2 = new HealthManager({ now: () => now, failThreshold: 1, cooldownMs: 60_000, respectRetryAfter: true });
  h2.recordFailure("openrouter", "m2", { status: 429, retryAfterMs: 30_000 });
  assert.equal(h2.get("openrouter", "m2").cooldownUntil, now + 60_000);
});

test("respectRetryAfter=false ignores the Retry-After header", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 1, cooldownMs: 60_000, respectRetryAfter: false });
  h.recordFailure("openrouter", "m1", { status: 429, retryAfterMs: 500_000 });
  assert.equal(h.get("openrouter", "m1").cooldownUntil, now + 60_000);
});

test("401/403 failures mark lastError auth_error for /healthz highlighting", () => {
  const h = new HealthManager();
  h.recordFailure("openrouter", "m1", { status: 401 });
  const health = h.get("openrouter", "m1");
  assert.equal(health.lastError, "auth_error");

  h.recordSuccess("openrouter", "m1");
  assert.equal(h.get("openrouter", "m1").lastError, undefined);

  h.recordFailure("openrouter", "m1", { status: 403 });
  assert.equal(h.get("openrouter", "m1").lastError, "auth_error");

  // Non-auth failures do not set lastError.
  const h2 = new HealthManager();
  h2.recordFailure("openrouter", "m2", { status: 500 });
  assert.equal(h2.get("openrouter", "m2").lastError, undefined);
});

test("state is per (provider, model)", () => {
  const h = new HealthManager({ failThreshold: 1 });
  h.recordFailure("openrouter", "m1");
  assert.equal(h.isHealthy("openrouter", "m1"), false);
  assert.equal(h.isHealthy("openrouter", "m2"), true);
  assert.equal(h.isHealthy("groq", "m1"), true);
});

test("state changes are emitted through the EventEmitter", () => {
  const h = new HealthManager({ failThreshold: 1 });
  const events: unknown[] = [];
  h.on("change", (e) => events.push(e));
  h.recordFailure("openrouter", "m1");
  h.recordSuccess("openrouter", "m1");
  assert.equal(events.length, 2);
  const last = events[1] as { provider: string; model: string; health: { state: string } };
  assert.equal(last.provider, "openrouter");
  assert.equal(last.model, "m1");
  assert.equal(last.health.state, "healthy");
});

test("failure recorded while cooling refreshes the cooldown window", () => {
  let now = 1_000_000;
  const h = new HealthManager({ now: () => now, failThreshold: 2, cooldownMs: 60_000 });
  h.recordFailure("openrouter", "m1");
  h.recordFailure("openrouter", "m1");
  now += 10_000;
  h.recordFailure("openrouter", "m1");
  assert.equal(h.get("openrouter", "m1").cooldownUntil, now + 60_000);
});
