import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPool } from "../src/core/key-pool.js";

test("single key round-robin returns the same key", () => {
  const kp = new KeyPool({
    keyResolver: () => ["key-1"],
    providerResolver: () => ({ apiKeyField: "groq" }),
  });
  assert.equal(kp.getNextKey("groq"), "key-1");
  assert.equal(kp.getNextKey("groq"), "key-1");
  assert.equal(kp.isProviderHealthy("groq"), true);
});

test("multiple keys alternate in round-robin order", () => {
  const kp = new KeyPool({
    keyResolver: () => ["key-1", "key-2", "key-3"],
    providerResolver: () => ({ apiKeyField: "groq" }),
  });
  assert.equal(kp.getNextKey("groq"), "key-1");
  assert.equal(kp.getNextKey("groq"), "key-2");
  assert.equal(kp.getNextKey("groq"), "key-3");
  assert.equal(kp.getNextKey("groq"), "key-1");
});

test("single key 429 cools down that key and shifts to next healthy key", () => {
  let now = 1_000_000;
  const kp = new KeyPool({
    now: () => now,
    failThreshold: 1,
    cooldownMs: 60_000,
    respectRetryAfter: true,
    keyResolver: () => ["key-1", "key-2"],
    providerResolver: () => ({ apiKeyField: "groq" }),
  });

  assert.equal(kp.getNextKey("groq"), "key-1");
  // key-1 hits 429 with 30s Retry-After
  kp.recordFailure("groq", "model-1", "key-1", { status: 429, retryAfterMs: 30_000 });

  assert.equal(kp.getKeyHealth("groq", "key-1").state, "cooldown");
  assert.equal(kp.getKeyHealth("groq", "key-1").cooldownUntil, now + 60_000); // max(cooldownMs, retryAfter)
  assert.equal(kp.getKeyHealth("groq", "key-2").state, "healthy");
  assert.equal(kp.isProviderHealthy("groq"), true);

  // Next requests bypass key-1 and go to key-2
  assert.equal(kp.getNextKey("groq"), "key-2");
  assert.equal(kp.getNextKey("groq"), "key-2");

  // Advance time past cooldown -> key-1 enters half_open
  now += 60_000;
  assert.equal(kp.getNextKey("groq"), "key-1"); // probe allowed
  assert.equal(kp.getKeyHealth("groq", "key-1").state, "half_open");

  // Successful probe resets key-1
  kp.recordSuccess("groq", "model-1", "key-1");
  assert.equal(kp.getKeyHealth("groq", "key-1").state, "healthy");
  assert.equal(kp.getKeyHealth("groq", "key-1").consecutiveFailures, 0);
});

test("all keys cooling marks provider unhealthy and aggregates earliest cooldownUntil", () => {
  let now = 1_000_000;
  const kp = new KeyPool({
    now: () => now,
    failThreshold: 1,
    cooldownMs: 60_000,
    keyResolver: () => ["key-1", "key-2"],
    providerResolver: () => ({ apiKeyField: "groq" }),
  });

  kp.recordFailure("groq", "model-1", "key-1", { status: 429, retryAfterMs: 30_000 });
  kp.recordFailure("groq", "model-1", "key-2", { status: 500 });

  assert.equal(kp.isProviderHealthy("groq"), false);
  assert.equal(kp.getNextKey("groq"), undefined);

  const providerHealth = kp.getProviderHealth("groq", "model-1");
  assert.equal(providerHealth.state, "cooldown");
  assert.equal(providerHealth.cooldownUntil, now + 60_000);
});

test("excludeKeys avoids retrying already-attempted keys in same request", () => {
  const kp = new KeyPool({
    keyResolver: () => ["key-1", "key-2"],
    providerResolver: () => ({ apiKeyField: "groq" }),
  });

  const tried = new Set<string>();
  const first = kp.getNextKey("groq", tried);
  assert.equal(first, "key-1");
  tried.add(first!);

  const second = kp.getNextKey("groq", tried);
  assert.equal(second, "key-2");
  tried.add(second!);

  const third = kp.getNextKey("groq", tried);
  assert.equal(third, undefined);
});
