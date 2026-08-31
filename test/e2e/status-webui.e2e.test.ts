import { test } from "node:test";
import assert from "node:assert/strict";
import { serve, type ServerType } from "@hono/node-server";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../../src/app.js";
import { resetConfigForTests } from "../../src/config.js";
import { resetRuntimeForTests } from "../../src/core/runtime.js";
import { fetchLiveStatus } from "../../src/cli/status.js";
import { makeValidConfig, useTempDataPath } from "../helpers.js";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-e2e-status-"));
  const configPath = join(dir, "prismd.json");
  writeFileSync(configPath, JSON.stringify(makeValidConfig()));
  process.env.PRISMD_CONFIG_PATH = configPath;
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("旅程 14：M2b 状态暴露端点端到端可用（/healthz, /v1/models, /v1/modelstatus, /ui）", async (t) => {
  setup();
  let serverInstance: ServerType;
  const port = await new Promise<number>((resolve) => {
    serverInstance = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve(info.port);
    });
  });
  t.after(() => new Promise((r) => serverInstance.close(r)));

  const base = `http://127.0.0.1:${port}`;

  // 1. /healthz
  const healthRes = await fetch(`${base}/healthz`);
  assert.equal(healthRes.status, 200);
  const healthData = (await healthRes.json()) as { status: string; candidates: unknown[] };
  assert.equal(healthData.status, "ok");
  assert.ok(healthData.candidates.length >= 2);

  // 2. /v1/models
  const modelsRes = await fetch(`${base}/v1/models`);
  assert.equal(modelsRes.status, 200);
  const modelsData = (await modelsRes.json()) as { object: string; data: { id: string }[] };
  assert.equal(modelsData.object, "list");
  assert.ok(modelsData.data.some((m) => m.id === "free-auto"));

  // 3. /v1/modelstatus
  const statusRes = await fetch(`${base}/v1/modelstatus`);
  assert.equal(statusRes.status, 200);
  const statusData = (await statusRes.json()) as { aliases: Record<string, unknown> };
  assert.ok(statusData.aliases["free-auto"]);

  // 4. /ui
  const uiRes = await fetch(`${base}/ui`);
  assert.equal(uiRes.status, 200);
  const uiHtml = await uiRes.text();
  assert.ok(uiHtml.includes("prismd status"));
  assert.ok(uiHtml.includes("/v1/modelstatus/stream"));

  // 5. CLI helper
  const cliLive = await fetchLiveStatus("127.0.0.1", port);
  assert.ok(cliLive);
  assert.ok(cliLive.aliases["free-auto"]);
});
