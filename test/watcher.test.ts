import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConfigWatcher } from "../src/core/watcher.js";
import { makeValidConfig } from "./helpers.js";
import { resetConfigForTests } from "../src/config.js";

test("startConfigWatcher reloads config upon file change with debounce", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-watcher-test-"));
  const configPath = join(dir, "config.json");
  const keysPath = join(dir, "keys.yaml");

  const initialCfg = makeValidConfig();
  writeFileSync(configPath, JSON.stringify(initialCfg, null, 2));
  writeFileSync(keysPath, "prismd: token-1\n");

  let reloadedCount = 0;
  let latestAliasCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    keysYamlPath: keysPath,
    debounceMs: 50,
    onReload: (cfg) => {
      reloadedCount += 1;
      latestAliasCount = Object.keys(cfg.models).length;
    },
  });

  t.after(() => {
    watcher.close();
    resetConfigForTests();
  });

  // Mutate config with a valid new alias
  const updatedCfg = makeValidConfig();
  updatedCfg.models["new-test-alias"] = {
    candidates: [
      {
        provider: "openrouter",
        providerModelId: "test-m",
        contextWindow: 10000,
        maxOutputTokens: 1000,
        supportsTools: true,
        supportsReasoning: true,
        limits: { dailyRequests: null, rpm: 10, maxConcurrent: 2 },
        tags: [],
      },
    ],
  };
  writeFileSync(configPath, JSON.stringify(updatedCfg, null, 2));

  // Wait for debounce and execution
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(reloadedCount, 1);
  assert.ok(latestAliasCount >= 2);
});

test("startConfigWatcher handles malformed JSON gracefully without crashing", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-watcher-error-"));
  const configPath = join(dir, "config.json");
  const keysPath = join(dir, "keys.yaml");

  const initialCfg = makeValidConfig();
  writeFileSync(configPath, JSON.stringify(initialCfg, null, 2));
  writeFileSync(keysPath, "prismd: token-1\n");

  let errorCaptured: Error | null = null;

  const watcher = startConfigWatcher({
    configPath,
    keysYamlPath: keysPath,
    debounceMs: 50,
    onError: (err) => {
      errorCaptured = err;
    },
  });

  t.after(() => {
    watcher.close();
    resetConfigForTests();
  });

  // Write malformed JSON
  writeFileSync(configPath, "{ malformed json");

  await new Promise((r) => setTimeout(r, 150));

  assert.ok(errorCaptured !== null);
  assert.ok((errorCaptured as Error).message.includes("prismd config"));
});

test("startConfigWatcher close() stops watching and clears pending debounces", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-watcher-close-"));
  const configPath = join(dir, "config.json");
  const keysPath = join(dir, "keys.yaml");

  const initialCfg = makeValidConfig();
  writeFileSync(configPath, JSON.stringify(initialCfg, null, 2));
  writeFileSync(keysPath, "prismd: token-1\n");

  let reloadedCount = 0;
  const watcher = startConfigWatcher({
    configPath,
    keysYamlPath: keysPath,
    debounceMs: 50,
    onReload: () => {
      reloadedCount += 1;
    },
  });

  watcher.close();

  // Write new file after close
  writeFileSync(configPath, JSON.stringify(initialCfg, null, 2));
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(reloadedCount, 0);
});
