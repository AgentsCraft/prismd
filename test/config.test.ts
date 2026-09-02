import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig, loadConfig, reloadConfig, resetConfigForTests } from "../src/config.js";
import type { PrismdConfig } from "../src/types/config.js";
import { makeValidConfig } from "./helpers.js";

function writeConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-config-"));
  const path = join(dir, "prismd.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

test("loadConfig loads a valid prismd.json", () => {
  const path = writeConfig(makeValidConfig());
  const config = loadConfig(path);
  assert.equal(config.version, 1);
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.auth.localTokenField, "prismd");
  assert.equal(config.providers["openrouter"].baseUrl, "https://openrouter.ai/api/v1");
  assert.deepEqual(config.providers["openrouter"].extraHeaders, {
    "HTTP-Referer": "https://localhost/prismd",
    "X-Title": "prismd",
  });
  assert.equal(
    config.models["free-auto"].candidates[0].providerModelId,
    "poolside/laguna-s-2.1:free",
  );
  assert.equal(config.models["free-auto"].candidates[1].limits.dailyRequests, null);
  assert.equal(config.policies.quotaSoftLimitRatio, 0.8);
});

test("loadConfig reports schema violations with instance paths", () => {
  const bad = makeValidConfig({ server: { port: 70000 } });
  const path = writeConfig(bad);
  assert.throws(() => loadConfig(path), /\/server\/port/);
});

test("loadConfig rejects non-loopback server.host", () => {
  const path = writeConfig(makeValidConfig({ server: { host: "0.0.0.0" } }));
  assert.throws(() => loadConfig(path), /non-loopback/);
});

test("loadConfig throws on missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-config-"));
  assert.throws(() => loadConfig(join(dir, "prismd.json")), /cannot read prismd config/);
});

test("loadConfig throws on invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-config-"));
  const path = join(dir, "prismd.json");
  writeFileSync(path, "{not json");
  assert.throws(() => loadConfig(path), /invalid JSON/);
});

test("getConfig caches and resetConfigForTests forces a reload", () => {
  const path = writeConfig(makeValidConfig());
  const previous = process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CONFIG_PATH = path;
  try {
    resetConfigForTests();
    const first = getConfig();
    const second = getConfig();
    assert.equal(first, second, "same call should return the cached instance");

    // Change the file on disk; cached value stays until reset.
    writeFileSync(path, JSON.stringify(makeValidConfig({ server: { port: 9999 } })));
    assert.equal(getConfig().server.port, 8787);

    resetConfigForTests();
    const reloaded = getConfig() as PrismdConfig;
    assert.equal(reloaded.server.port, 9999);
  } finally {
    resetConfigForTests();
    if (previous === undefined) {
      delete process.env.PRISMD_CONFIG_PATH;
    } else {
      process.env.PRISMD_CONFIG_PATH = previous;
    }
  }
});

test("reloadConfig dynamically updates config in-place without resetConfigForTests", () => {
  const path = writeConfig(makeValidConfig({ server: { port: 8787 } }));
  const previous = process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CONFIG_PATH = path;
  try {
    resetConfigForTests();
    assert.equal(getConfig().server.port, 8787);

    // Modify file and call reloadConfig
    writeFileSync(path, JSON.stringify(makeValidConfig({ server: { port: 9000 } })));
    const updated = reloadConfig();
    assert.equal(updated.server.port, 9000);
    assert.equal(getConfig().server.port, 9000);
  } finally {
    resetConfigForTests();
    if (previous === undefined) {
      delete process.env.PRISMD_CONFIG_PATH;
    } else {
      process.env.PRISMD_CONFIG_PATH = previous;
    }
  }
});

test("getConfig throws when PRISMD_CONFIG_PATH points to a missing file", () => {
  const previous = process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CONFIG_PATH = join(tmpdir(), "does-not-exist", "prismd.json");
  try {
    resetConfigForTests();
    assert.throws(() => getConfig(), /cannot read prismd config/);
  } finally {
    resetConfigForTests();
    if (previous === undefined) {
      delete process.env.PRISMD_CONFIG_PATH;
    } else {
      process.env.PRISMD_CONFIG_PATH = previous;
    }
  }
});

test("resolveConfigPath falls back to local ./prismd.json if present", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-local-"));
  const localConfig = join(dir, "prismd.json");
  writeFileSync(localConfig, JSON.stringify(makeValidConfig()));

  const previousCwd = process.env.PRISMD_CWD;
  const previousHome = process.env.PRISMD_HOME;
  const previousConfig = process.env.PRISMD_CONFIG_PATH;
  delete process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CWD = dir;
  process.env.PRISMD_HOME = mkdtempSync(join(tmpdir(), "prismd-home-"));

  try {
    resetConfigForTests();
    const config = getConfig();
    assert.equal(config.version, 1);
    assert.equal(config.server.port, 8787);
  } finally {
    resetConfigForTests();
    if (previousCwd) process.env.PRISMD_CWD = previousCwd;
    else delete process.env.PRISMD_CWD;
    if (previousHome) process.env.PRISMD_HOME = previousHome;
    else delete process.env.PRISMD_HOME;
    if (previousConfig) process.env.PRISMD_CONFIG_PATH = previousConfig;
    else delete process.env.PRISMD_CONFIG_PATH;
  }
});

test("resolveConfigPath falls back to ~/.prismd/prismd.json if local is missing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "prismd-empty-cwd-"));
  const home = mkdtempSync(join(tmpdir(), "prismd-home-"));
  const homePrismd = join(home, ".prismd");
  mkdirSync(homePrismd, { recursive: true });
  const homeConfig = join(homePrismd, "prismd.json");
  writeFileSync(homeConfig, JSON.stringify(makeValidConfig({ server: { port: 9876 } })));

  const previousCwd = process.env.PRISMD_CWD;
  const previousHome = process.env.PRISMD_HOME;
  const previousConfig = process.env.PRISMD_CONFIG_PATH;
  delete process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CWD = cwd;
  process.env.PRISMD_HOME = home;

  try {
    resetConfigForTests();
    const config = getConfig();
    assert.equal(config.server.port, 9876);
  } finally {
    resetConfigForTests();
    if (previousCwd) process.env.PRISMD_CWD = previousCwd;
    else delete process.env.PRISMD_CWD;
    if (previousHome) process.env.PRISMD_HOME = previousHome;
    else delete process.env.PRISMD_HOME;
    if (previousConfig) process.env.PRISMD_CONFIG_PATH = previousConfig;
    else delete process.env.PRISMD_CONFIG_PATH;
  }
});

test("resolveConfigPath auto-initializes ~/.prismd/prismd.json when no config exists", () => {
  const cwd = mkdtempSync(join(tmpdir(), "prismd-auto-cwd-"));
  const home = mkdtempSync(join(tmpdir(), "prismd-auto-home-"));
  const homePrismd = join(home, ".prismd");
  mkdirSync(homePrismd, { recursive: true });
  writeFileSync(join(homePrismd, "keys.yaml"), "openrouter: sk-test-key\n");

  const previousCwd = process.env.PRISMD_CWD;
  const previousHome = process.env.PRISMD_HOME;
  const previousConfig = process.env.PRISMD_CONFIG_PATH;
  delete process.env.PRISMD_CONFIG_PATH;
  process.env.PRISMD_CWD = cwd;
  process.env.PRISMD_HOME = home;

  try {
    resetConfigForTests();
    const config = getConfig();
    assert.equal(config.version, 1);
    assert.equal(config.server.host, "127.0.0.1");
    // Verifies that ~/.prismd/prismd.json was created on disk
    assert.ok(existsSync(join(homePrismd, "prismd.json")));
    // Verifies that candidates were generated using the configured keys
    assert.ok(config.models["free-auto"]);
  } finally {
    resetConfigForTests();
    if (previousCwd) process.env.PRISMD_CWD = previousCwd;
    else delete process.env.PRISMD_CWD;
    if (previousHome) process.env.PRISMD_HOME = previousHome;
    else delete process.env.PRISMD_HOME;
    if (previousConfig) process.env.PRISMD_CONFIG_PATH = previousConfig;
    else delete process.env.PRISMD_CONFIG_PATH;
  }
});

