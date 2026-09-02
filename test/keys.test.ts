import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envVarFor, loadKeyStore, parseEnvFile, parseKeysYaml, resolveKey, resolveKeys } from "../src/keys.js";

function makeHome(files: Record<string, string>): { home: string; localDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "prismd-keys-"));
  mkdirSync(join(dir, ".prismd"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, ".prismd", name), content);
  }
  const localDir = mkdtempSync(join(tmpdir(), "prismd-local-"));
  return { home: dir, localDir };
}

test("parseKeysYaml handles comments, blank lines, quotes and bare values", () => {
  const yaml = parseKeysYaml(
    [
      "# full-line comment",
      "",
      'prismd: "local-token"',
      "openrouter: 'quoted'",
      "groq: bare-value",
      "  # indented comment",
      "no-colon-here",
      "empty:",
      "spaced : value with spaces",
    ].join("\n"),
  );
  assert.deepEqual(yaml, {
    prismd: "local-token",
    openrouter: "quoted",
    groq: "bare-value",
    empty: "",
    spaced: "value with spaces",
  });
});

test("parseKeysYaml handles inline arrays and YAML list items", () => {
  const yaml = parseKeysYaml(
    [
      'groq: ["gsk_1", "gsk_2", "gsk_3"]',
      "cerebras:",
      '  - "csk_1"',
      "  - 'csk_2'",
      "  - csk_3",
      "empty_list: []",
    ].join("\n"),
  );
  assert.deepEqual(yaml, {
    groq: ["gsk_1", "gsk_2", "gsk_3"],
    cerebras: ["csk_1", "csk_2", "csk_3"],
    empty_list: [],
  });
});

test("parseEnvFile parses KEY=value with quotes and comments", () => {
  assert.deepEqual(parseEnvFile('A=1\nB="two"\n# c\n'), { A: "1", B: "two" });
});

test("envVarFor uppercases the field and appends _API_KEY", () => {
  assert.equal(envVarFor("openrouter"), "OPENROUTER_API_KEY");
  assert.equal(envVarFor("prismd"), "PRISMD_API_KEY");
});

test("resolveKey prefers env var over local .env over home .env over keys.yaml", () => {
  const localDir = mkdtempSync(join(tmpdir(), "prismd-local-"));
  writeFileSync(join(localDir, ".env"), "OPENROUTER_API_KEY=from-local-env\nGROQ_API_KEY=from-local-groq\n");

  const { home } = makeHome({
    ".env": "OPENROUTER_API_KEY=from-home-dotenv\nCEREBRAS_API_KEY=from-home-cerebras\n",
    "keys.yaml": "openrouter: from-yaml\n",
  });
  const store = loadKeyStore(home, localDir);

  const prev = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(resolveKey(store, "openrouter"), "from-local-env");
    assert.equal(resolveKey(store, "groq"), "from-local-groq");
    assert.equal(resolveKey(store, "cerebras"), "from-home-cerebras");
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }

  process.env.OPENROUTER_API_KEY = "from-env";
  try {
    assert.equal(resolveKey(store, "openrouter"), "from-env");
  } finally {
    delete process.env.OPENROUTER_API_KEY;
  }
});

test("resolveKeys parses comma-separated keys and array formats", () => {
  const localDir = mkdtempSync(join(tmpdir(), "prismd-local-"));
  writeFileSync(join(localDir, ".env"), "GROQ_API_KEY=gsk_1, gsk_2 ,gsk_3\n");

  const { home } = makeHome({
    "keys.yaml": "cerebras:\n  - csk_1\n  - csk_2\nopenrouter: ['sk-1', 'sk-2']\n",
  });
  const store = loadKeyStore(home, localDir);

  assert.deepEqual(resolveKeys(store, "groq"), ["gsk_1", "gsk_2", "gsk_3"]);
  assert.deepEqual(resolveKeys(store, "cerebras"), ["csk_1", "csk_2"]);
  assert.deepEqual(resolveKeys(store, "openrouter"), ["sk-1", "sk-2"]);
});

test("resolveKey falls back to keys.yaml when .env has no entry", () => {
  const { home, localDir } = makeHome({
    ".env": "OTHER_API_KEY=whatever\n",
    "keys.yaml": "groq: groq-fake-key\n",
  });
  const store = loadKeyStore(home, localDir);
  assert.equal(resolveKey(store, "groq"), "groq-fake-key");
});

test("resolveKey returns undefined when nothing is configured", () => {
  const { home, localDir } = makeHome({});
  const store = loadKeyStore(home, localDir);
  assert.equal(resolveKey(store, "openrouter"), undefined);
});

test("empty values do not count as configured", () => {
  const { home, localDir } = makeHome({
    ".env": "OPENROUTER_API_KEY=\n",
    "keys.yaml": 'openrouter: ""\n',
  });
  const store = loadKeyStore(home, localDir);
  assert.equal(resolveKey(store, "openrouter"), undefined);
  assert.deepEqual(resolveKeys(store, "openrouter"), []);
});

test("loadKeyStore tolerates missing or unreadable files", () => {
  const { home, localDir } = makeHome({});
  const store = loadKeyStore(home, localDir);
  assert.deepEqual(store, { localEnvFile: {}, envFile: {}, yaml: {} });
});
