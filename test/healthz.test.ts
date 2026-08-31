import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { getHealth, resetRuntimeForTests } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-healthz-"));
  const configPath = join(dir, "prismd.json");
  writeFileSync(configPath, JSON.stringify(makeValidConfig()));
  process.env.PRISMD_CONFIG_PATH = configPath;
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("GET /healthz returns 200 ok and candidate health overview without auth", async () => {
  setup();
  const res = await app.request("/healthz", { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = (await res.json()) as {
    status: string;
    uptime: number;
    timestamp: string;
    candidates: { provider: string; model: string; state: string }[];
  };
  assert.equal(body.status, "ok");
  assert.ok(typeof body.uptime === "number");
  assert.ok(Array.isArray(body.candidates));
  assert.ok(body.candidates.length >= 2);
  assert.equal(body.candidates[0].state, "healthy");
});

test("GET /healthz highlights auth errors as degraded", async () => {
  setup();
  const health = getHealth();
  health.recordFailure("openrouter", "poolside/laguna-s-2.1:free", { status: 401 });

  const res = await app.request("/healthz", { method: "GET" });
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    status: string;
    authErrors?: { provider: string; model: string; error: string }[];
  };
  assert.equal(body.status, "degraded");
  assert.ok(Array.isArray(body.authErrors));
  assert.equal(body.authErrors?.length, 1);
  assert.equal(body.authErrors?.[0].provider, "openrouter");
});
