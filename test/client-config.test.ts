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
  backupFileIfExists,
  getClientConfigPath,
  updateCodexToml,
  SUPPORTED_CLIENTS,
} from "../src/cli/client-config.js";

test("SUPPORTED_CLIENTS includes claude, codex, opencode, and pi with simple launch commands", () => {
  const ids = SUPPORTED_CLIENTS.map((c) => c.id);
  assert.deepEqual(ids, ["claude", "codex", "opencode", "pi"]);

  for (const client of SUPPORTED_CLIENTS) {
    const cmd = client.launchCommand("dummy-token");
    assert.equal(cmd, client.id);
  }
});

test("setupClaudeCode configures ~/.claude/settings.json and auxiliary scripts", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-claude-"));
  const token = "secret-token-xyz";

  // Pre-populate settings.json with existing properties
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ model: "opus", env: { CUSTOM_VAR: "123" } }),
    "utf8",
  );

  const res = setupClaudeCode(home, token);
  assert.equal(res.name, "Claude Code");
  assert.equal(res.launchCommand, "claude");
  assert.equal(res.backupsCreated.length, 1);
  assert.ok(res.backupsCreated[0].includes("settings.json.bak."));

  // Check ~/.claude/settings.json
  const settingsPath = join(home, ".claude", "settings.json");
  assert.ok(existsSync(settingsPath));
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.model, "opus", "existing properties must be preserved");
  assert.equal(settings.env.CUSTOM_VAR, "123", "existing env vars must be preserved");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8787/v1");
  assert.equal(settings.env.ANTHROPIC_API_KEY, token);

  // Check auxiliary scripts
  const shPath = join(home, ".prismd", "claude-prismd.sh");
  const cmdPath = join(home, ".prismd", "claude-prismd.cmd");
  const ps1Path = join(home, ".prismd", "claude-prismd.ps1");

  assert.ok(existsSync(shPath));
  assert.ok(existsSync(cmdPath));
  assert.ok(existsSync(ps1Path));
});

test("setupCodex configures ~/.codex/config.toml and auth.json", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-codex-"));
  const token = "token-codex-123";

  // Pre-populate existing config.toml and auth.json
  const codexDir = join(home, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, "config.toml"),
    'model_provider = "old_provider"\nmodel = "old_model"\n\n[features]\ngoals = true\n',
    "utf8",
  );
  writeFileSync(
    join(codexDir, "auth.json"),
    JSON.stringify({ EXISTING_KEY: "old_val" }),
    "utf8",
  );

  const res = setupCodex(home, token);
  assert.equal(res.name, "Codex CLI");
  assert.equal(res.launchCommand, "codex");
  assert.equal(res.backupsCreated.length, 2);

  // Verify auth.json
  const authPath = join(home, ".codex", "auth.json");
  assert.ok(existsSync(authPath));
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(auth.EXISTING_KEY, "old_val");
  assert.equal(auth.OPENAI_API_KEY, token);

  // Verify config.toml
  const tomlPath = join(home, ".codex", "config.toml");
  assert.ok(existsSync(tomlPath));
  const toml = readFileSync(tomlPath, "utf8");
  assert.ok(toml.includes('model_provider = "prismd"'));
  assert.ok(toml.includes('model = "free-auto"'));
  assert.ok(toml.includes("[features]"));
  assert.ok(toml.includes("goals = true"));
  assert.ok(toml.includes("[model_providers.prismd]"));
  assert.ok(toml.includes('base_url = "http://127.0.0.1:8787/v1"'));
});

test("updateCodexToml handles empty, new, and existing TOML configs correctly", () => {
  // Empty
  const out1 = updateCodexToml("");
  assert.ok(out1.includes('model_provider = "prismd"'));
  assert.ok(out1.includes('model = "free-auto"'));
  assert.ok(out1.includes("[model_providers.prismd]"));

  // Existing with other sections
  const input = `model_provider = "custom"
model = "gpt-4"

[windows]
sandbox = "unelevated"

[model_providers.prismd]
name = "old_prismd"
base_url = "http://localhost:9999"
`;
  const out2 = updateCodexToml(input);
  assert.ok(out2.includes('model_provider = "prismd"'));
  assert.ok(out2.includes('model = "free-auto"'));
  assert.ok(out2.includes('[windows]'));
  assert.ok(out2.includes('sandbox = "unelevated"'));
  assert.ok(out2.includes('base_url = "http://127.0.0.1:8787/v1"'));
  assert.ok(!out2.includes("http://localhost:9999"));
});

test("setupOpenCode creates and merges ~/.config/opencode/opencode.json", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-opencode-"));
  const token = "token-opencode-456";

  // Initial setup without existing config
  const res1 = setupOpenCode(home, token);
  assert.equal(res1.name, "OpenCode");
  assert.equal(res1.launchCommand, "opencode");

  const jsonPath = join(home, ".config", "opencode", "opencode.json");
  assert.ok(existsSync(jsonPath));

  const initial = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(initial.model, "prismd/free-auto");
  assert.ok(initial.provider?.prismd);
  assert.equal(initial.provider.prismd.apiKey, token);
  assert.equal(initial.provider.prismd.baseURL, "http://127.0.0.1:8787/v1");

  // Preserves existing providers on update
  initial.provider.other = { npm: "@ai-sdk/anthropic" };
  writeFileSync(jsonPath, JSON.stringify(initial), "utf8");

  const newToken = "token-opencode-updated";
  const res2 = setupOpenCode(home, newToken);
  assert.equal(res2.backupsCreated.length, 1);

  const updated = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.ok(updated.provider.other, "existing provider must be preserved");
  assert.equal(updated.provider.prismd.apiKey, newToken);
});

test("setupPi creates ~/.pi/config.json", () => {
  const home = mkdtempSync(join(tmpdir(), "prismd-client-pi-"));
  const token = "token-pi-789";

  const res = setupPi(home, token);
  assert.equal(res.name, "Pi Agent");
  assert.equal(res.launchCommand, "pi");

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

test("getClientConfigPath returns correct target files", () => {
  const home = "/fake/home";
  assert.equal(getClientConfigPath("claude", home), join(home, ".claude", "settings.json"));
  assert.equal(getClientConfigPath("codex", home), join(home, ".codex", "config.toml"));
  assert.equal(getClientConfigPath("opencode", home), join(home, ".config", "opencode", "opencode.json"));
  assert.equal(getClientConfigPath("pi", home), join(home, ".pi", "config.json"));
  assert.equal(getClientConfigPath("unknown", home), null);
});

test("backupFileIfExists returns null when file does not exist", () => {
  const missing = join(tmpdir(), "non-existent-file-xyz.json");
  assert.equal(backupFileIfExists(missing), null);
});

test("backupFileIfExists creates exact copy with .bak suffix", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-backup-test-"));
  const target = join(dir, "myconfig.json");
  writeFileSync(target, "{\"hello\":\"world\"}", "utf8");

  const backup = backupFileIfExists(target);
  assert.ok(backup);
  assert.ok(backup.includes(".bak."));
  assert.ok(existsSync(backup));
  assert.equal(readFileSync(backup, "utf8"), "{\"hello\":\"world\"}");
});

test("ensureCodexModelMetadata registers free-auto and preserves existing catalog", async () => {
  const { ensureCodexModelMetadata } = await import("../src/cli/client-config.js");
  const dir = mkdtempSync(join(tmpdir(), "prismd-codex-meta-"));

  // 1. Initial creation when models.json does not exist
  const res1 = ensureCodexModelMetadata(dir);
  assert.ok(existsSync(res1.path));
  assert.equal(res1.backupPath, null);

  const meta1 = JSON.parse(readFileSync(res1.path, "utf8"));
  assert.ok(Array.isArray(meta1.models));
  assert.equal(meta1.models.length, 1);
  assert.equal(meta1.models[0].slug, "free-auto");
  assert.equal(meta1.models[0].context_window, 131072);

  // 2. Subsequent call does not create backup if free-auto already present
  const res2 = ensureCodexModelMetadata(dir);
  assert.equal(res2.backupPath, null);

  // 3. Existing catalog with another model gets free-auto prepended and backed up
  const dir2 = mkdtempSync(join(tmpdir(), "prismd-codex-meta-existing-"));
  const existingCatalog = {
    models: [{ slug: "o3-mini", display_name: "o3-mini", context_window: 200000 }],
  };
  writeFileSync(join(dir2, "models.json"), JSON.stringify(existingCatalog), "utf8");

  const res3 = ensureCodexModelMetadata(dir2);
  assert.ok(res3.backupPath);
  assert.ok(existsSync(res3.backupPath));

  const meta3 = JSON.parse(readFileSync(res3.path, "utf8"));
  assert.equal(meta3.models.length, 2);
  assert.equal(meta3.models[0].slug, "free-auto");
  assert.equal(meta3.models[1].slug, "o3-mini");
});

test("updateLocalTokenInKeysYaml updates or adds prismd token while preserving content", async () => {
  const { updateLocalTokenInKeysYaml } = await import("../src/cli/init.js");
  const dir = mkdtempSync(join(tmpdir(), "prismd-keys-sync-"));
  const keysFile = join(dir, "keys.yaml");

  // Case 1: file exists with empty or previous token
  writeFileSync(
    keysFile,
    '# config\nprismd: ""\ngroq: "gsk_123"\n',
    "utf8",
  );
  updateLocalTokenInKeysYaml(keysFile, "new-token-456");

  const content1 = readFileSync(keysFile, "utf8");
  assert.ok(content1.includes('prismd: "new-token-456"'));
  assert.ok(content1.includes('groq: "gsk_123"'));

  // Case 2: file exists without prismd key
  writeFileSync(keysFile, 'gemini: "AIza123"\n', "utf8");
  updateLocalTokenInKeysYaml(keysFile, "token-789");
  const content2 = readFileSync(keysFile, "utf8");
  assert.ok(content2.includes('prismd: "token-789"'));
  assert.ok(content2.includes('gemini: "AIza123"'));
});

