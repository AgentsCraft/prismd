import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRuntime, getKeyPool, getHealth, getQuota, resetRuntimeForTests } from "../src/core/runtime.js";
import { resetConfigForTests } from "../src/config.js";
import { printHelpCli } from "../src/cli/help.js";

describe("server & runtime unit tests", () => {
  it("initRuntime initializes all singletons atomically", (t) => {
    // Isolate from the developer's real ~/.prismd/prismd.json
    const previousHome = process.env.PRISMD_HOME;
    const home = mkdtempSync(join(tmpdir(), "prismd-runtime-home-"));
    mkdirSync(join(home, ".prismd"), { recursive: true });
    process.env.PRISMD_HOME = home;
    resetConfigForTests();
    resetRuntimeForTests();
    t.after(() => {
      if (previousHome) process.env.PRISMD_HOME = previousHome;
      else delete process.env.PRISMD_HOME;
      resetConfigForTests();
      resetRuntimeForTests();
    });

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
