import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { resetRuntimeForTests } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-models-"));
  const configPath = join(dir, "prismd.json");
  writeFileSync(configPath, JSON.stringify(makeValidConfig()));
  process.env.PRISMD_CONFIG_PATH = configPath;
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("GET /v1/models returns OpenAI-compatible model list without auth", async () => {
  setup();
  const res = await app.request("/v1/models", { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = (await res.json()) as {
    object: string;
    data: { id: string; object: string; owned_by: string }[];
  };
  assert.equal(body.object, "list");
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.some((m) => m.id === "free-auto"));
  assert.equal(body.data[0].owned_by, "prismd");
});
