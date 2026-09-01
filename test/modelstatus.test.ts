import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { getHealth, getQuota, resetRuntimeForTests } from "../src/core/runtime.js";
import { computeCandidateStatus, type ModelStatusResponse } from "../src/routes/modelstatus.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-modelstatus-"));
  const configPath = join(dir, "prismd.json");
  writeFileSync(configPath, JSON.stringify(makeValidConfig()));
  process.env.PRISMD_CONFIG_PATH = configPath;
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("computeCandidateStatus maps health and quota correctly", () => {
  assert.equal(computeCandidateStatus("healthy", null, 0.5), "healthy");
  assert.equal(computeCandidateStatus("healthy", null, null), "healthy");
  assert.equal(computeCandidateStatus("healthy", null, 1.0), "rate_limited");
  assert.equal(computeCandidateStatus("unhealthy", "429", 0.5), "rate_limited");
  assert.equal(computeCandidateStatus("half_open", "429", 0.5), "rate_limited");
  assert.equal(computeCandidateStatus("unhealthy", "500", 0.5), "cooldown");
  assert.equal(computeCandidateStatus("healthy", "auth_error", 0.5), "unavailable");
  assert.equal(computeCandidateStatus("unhealthy", "401", 0.5), "unavailable");
});

test("GET /v1/modelstatus returns full status structure matching 14.webui.md", async () => {
  setup();
  const quota = getQuota();
  quota.record({
    requestId: "req-1",
    ts: new Date().toISOString(),
    alias: "free-auto",
    provider: "openrouter",
    model: "poolside/laguna-s-2.1:free",
    status: 200,
    failover: 0,
    durationMs: 50,
    usage: { inputChars: 400, outputChars: 200 },
  });

  const res = await app.request("/v1/modelstatus", { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = (await res.json()) as ModelStatusResponse;
  assert.ok(typeof body.uptime === "number");
  assert.ok(body.timestamp);
  assert.ok(body.aliases["free-auto"]);

  const alias = body.aliases["free-auto"];
  assert.equal(alias.activeCandidate, "openrouter/poolside/laguna-s-2.1:free");
  assert.equal(alias.candidates.length, 2);

  const c1 = alias.candidates.find((c) => c.provider === "openrouter")!;
  assert.equal(c1.status, "healthy");
  assert.equal(c1.quota.dailyRequests.used, 1);
  assert.equal(c1.quota.dailyRequests.limit, 50);
  assert.equal(c1.quota.dailyRequests.ratio, 0.02);
  assert.equal(c1.quota.inputTokens, 100);
  assert.equal(c1.quota.outputTokens, 50);
  assert.equal(c1.contextWindow, 262144);
  assert.equal(c1.supportsTools, true);
});

import { serve, type ServerType } from "@hono/node-server";

test("GET /v1/modelstatus/stream delivers initial status and updates over SSE", async (t) => {
  setup();
  let serverInstance: ServerType;
  const port = await new Promise<number>((resolve) => {
    serverInstance = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve(info.port);
    });
  });
  t.after(() => new Promise((r) => serverInstance.close(r)));

  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/v1/modelstatus/stream`, {
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

  const reader = res.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();

  // Read initial status event
  const { value: chunk1 } = await reader.read();
  const text1 = decoder.decode(chunk1);
  assert.ok(text1.includes("event: status"));
  assert.ok(text1.includes("free-auto"));

  // Trigger a health failure (401 auth_error) to emit candidate_changed
  const health = getHealth();
  health.recordFailure("groq", "llama-3.3-70b-versatile", { status: 401 });

  const { value: chunk2 } = await reader.read();
  const text2 = decoder.decode(chunk2);
  assert.ok(text2.includes("event: candidate_changed"));
  assert.ok(text2.includes("groq"));
  assert.ok(text2.includes("auth_error"));

  // Trigger quota change crossing 80% (used: 40/50 -> 80%)
  const quota = getQuota();
  for (let i = 0; i < 40; i++) {
    quota.record({
      requestId: `req-quota-${i}`,
      ts: new Date().toISOString(),
      alias: "free-auto",
      provider: "openrouter",
      model: "poolside/laguna-s-2.1:free",
      status: 200,
      failover: 0,
      durationMs: 10,
      usage: { inputChars: 100, outputChars: 50 },
    });
  }

  const { value: chunk3 } = await reader.read();
  const text3 = decoder.decode(chunk3);
  assert.ok(text3.includes("event: candidate_changed"));
  assert.ok(text3.includes("quota.dailyRequests"));
  assert.ok(text3.includes("80%"));

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // AbortError expected on canceled stream
  }
});

test("429 cooldown is mapped to rate_limited with lastError '429'", async () => {
  setup();
  const health = getHealth();
  health.recordFailure("openrouter", "poolside/laguna-s-2.1:free", { status: 429 });
  health.recordFailure("openrouter", "poolside/laguna-s-2.1:free", { status: 429 });
  health.recordFailure("openrouter", "poolside/laguna-s-2.1:free", { status: 429 });

  const res = await app.request("/v1/modelstatus", { method: "GET" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as ModelStatusResponse;
  const candidate = body.aliases["free-auto"].candidates.find((c) => c.provider === "openrouter")!;
  assert.equal(candidate.status, "rate_limited");
  assert.equal(candidate.health.lastError, "429");
  assert.equal(candidate.health.state, "unhealthy");
});
