import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupClaudeCode,
  setupCodex,
  setupOpenCode,
  setupPi,
  setupClient,
  SUPPORTED_CLIENTS,
} from "../src/cli/client-config.js";

test("SUPPORTED_CLIENTS includes claude, codex, opencode, and pi", () => {
  const ids = SUPPORTED_CLIENTS.map((c) => c.id);
  assert.deepEqual(ids, ["claude", "codex", "opencode", "pi"]);
});

test("setupClaudeCode creates helper scripts with auth token", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-claude-"));
  const token = "secret-token-xyz";

  const res = setupClaudeCode(home, token);
  assert.equal(res.name, "Claude Code");
  assert.equal(res.filesWritten.length, 3);

  const shPath = join(home, ".prismd", "claude-prismd.sh");
  const cmdPath = join(home, ".prismd", "claude-prismd.cmd");
  const ps1Path = join(home, ".prismd", "claude-prismd.ps1");

  assert.ok(existsSync(shPath));
  assert.ok(existsSync(cmdPath));
  assert.ok(existsSync(ps1Path));

  const shContent = readFileSync(shPath, "utf8");
  assert.ok(shContent.includes(`export ANTHROPIC_API_KEY="${token}"`));
  assert.ok(shContent.includes('export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"'));

  const cmdContent = readFileSync(cmdPath, "utf8");
  assert.ok(cmdContent.includes(`set ANTHROPIC_API_KEY=${token}`));
  assert.ok(cmdContent.includes("set ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1"));
});

test("setupCodex creates ~/.codex/prismd.config.toml", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-codex-"));
  const token = "token-codex-123";

  const res = setupCodex(home, token);
  assert.equal(res.name, "Codex CLI");

  const tomlPath = join(home, ".codex", "prismd.config.toml");
  assert.ok(existsSync(tomlPath));

  const content = readFileSync(tomlPath, "utf8");
  assert.ok(content.includes('model = "free-auto"'));
  assert.ok(content.includes('model_provider = "prismd"'));
  assert.ok(content.includes('base_url = "http://127.0.0.1:8787/v1"'));
});

test("setupOpenCode creates and merges ~/.config/opencode/config.json", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-opencode-"));
  const token = "token-opencode-456";

  // Initial setup without existing config
  const res1 = setupOpenCode(home, token);
  assert.equal(res1.name, "OpenCode");

  const jsonPath = join(home, ".config", "opencode", "config.json");
  assert.ok(existsSync(jsonPath));

  const initial = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.ok(initial.providers?.prismd);
  assert.equal(initial.providers.prismd.apiKey, token);
  assert.equal(initial.providers.prismd.baseUrl, "http://127.0.0.1:8787/v1");

  // Preserves existing providers on update
  initial.providers.other = { type: "anthropic" };
  writeFileSync(jsonPath, JSON.stringify(initial), "utf8");

  const newToken = "token-opencode-updated";
  setupOpenCode(home, newToken);

  const updated = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.ok(updated.providers.other, "existing provider must be preserved");
  assert.equal(updated.providers.prismd.apiKey, newToken);
});

test("setupPi creates ~/.pi/config.json", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-pi-"));
  const token = "token-pi-789";

  const res = setupPi(home, token);
  assert.equal(res.name, "Pi Agent");

  const jsonPath = join(home, ".pi", "config.json");
  assert.ok(existsSync(jsonPath));

  const content = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(content.provider?.name, "prismd");
  assert.equal(content.provider?.endpoint, "http://127.0.0.1:8787/v1");
  assert.equal(content.provider?.apiKey, token);
  assert.equal(content.provider?.defaultModel, "free-auto");
});

test("setupClient dispatches to appropriate handlers", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-dispatch-"));
  const token = "dispatch-token";

  assert.equal(setupClient("claude", home, token)?.name, "Claude Code");
  assert.equal(setupClient("codex", home, token)?.name, "Codex CLI");
  assert.equal(setupClient("opencode", home, token)?.name, "OpenCode");
  assert.equal(setupClient("pi", home, token)?.name, "Pi Agent");
  assert.equal(setupClient("unknown", home, token), null);
});
