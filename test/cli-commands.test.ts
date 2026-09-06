import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER_PATH = join(REPO_ROOT, "src", "server.ts");
/**
 * Run the TSX-loaded CLI via node directly: `npx` is a .cmd shim on Windows
 * and Node refuses to spawn .cmd files without a shell (CVE-2024-27980),
 * so spawning it yields EINVAL and status null.
 */
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

test("prismd --help displays usage information", () => {
  const run = spawnSync(process.execPath, [TSX_CLI, SERVER_PATH, "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.ok(run.stdout.includes("prismd status"));
  assert.ok(run.stdout.includes("prismd generate"));
});

test("prismd generate creates ~/.prismd/prismd.json from keys", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-cli-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "prismd-cli-cwd-"));
  const homePrismd = join(home, ".prismd");
  mkdirSync(homePrismd, { recursive: true });
  writeFileSync(join(homePrismd, "keys.yaml"), "openrouter: sk-test-key-123\n");

  const run = spawnSync(process.execPath, [TSX_CLI, SERVER_PATH, "generate"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PRISMD_HOME: home,
      PRISMD_CWD: cwd,
    },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(join(homePrismd, "prismd.json")));
  const generated = JSON.parse(readFileSync(join(homePrismd, "prismd.json"), "utf8"));
  assert.ok(generated.models["free-auto"]);
  assert.equal(generated.models["free-auto"].candidates[0].provider, "openrouter");
});
