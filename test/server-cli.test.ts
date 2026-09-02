import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initRuntime, getKeyPool, getHealth, getQuota } from "../src/core/runtime.js";
import { printHelpCli } from "../src/cli/help.js";

describe("server & runtime unit tests", () => {
  it("initRuntime initializes all singletons atomically", () => {
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
