import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRuntime, getKeyPool, getHealth, getQuota } from "../src/core/runtime.js";
import { resetConfigForTests } from "../src/config.js";
import { useTempDataPath } from "./helpers.js";
import { printHelpCli } from "../src/cli/help.js";

/**
 * Point the config/key discovery at throwaway dirs so runtime init never
 * reads the developer's real ~/.prismd/prismd.json (a stale or hand-edited
 * user config must not be able to fail the unit suite). PRISMD_HOME is the
 * documented override and works on every platform — unlike HOME, which
 * os.homedir() ignores on Windows.
 */
function isolateConfigEnv(): void {
  const dataDir = useTempDataPath();
  const home = mkdtempSync(join(tmpdir(), "prismd-runtime-home-"));
  const homePrismd = join(home, ".prismd");
  mkdirSync(homePrismd, { recursive: true });
  writeFileSync(join(homePrismd, "keys.yaml"), "openrouter: sk-test-key-123\n");
  process.env.PRISMD_HOME = home;
  resetConfigForTests();
}

describe("server & runtime unit tests", () => {
  it("initRuntime initializes all singletons atomically", () => {
    isolateConfigEnv();
    const runtime = initRuntime();
    assert.ok(runtime.keyPool);
    assert.ok(runtime.health);
    assert.ok(runtime.quota);
    assert.equal(runtime.keyPool, getKeyPool());
    assert.equal(runtime.health, getHealth());
    assert.equal(runtime.quota, getQuota());
  });

  it("printHelpCli executes without throwing", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    try {
      printHelpCli();
      assert.ok(logs.some((line) => line.includes("prismd status")));
    } finally {
      console.log = origLog;
    }
  });
});
