import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envVarFor, loadKeyStore, parseEnvFile, parseKeysYaml, resolveKey } from "../src/keys.js";

function makeHome(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "prismd-keys-"));
  mkdirSync(join(dir, ".prismd"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, ".prismd", name), content);
  }
  return dir;
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

test("parseEnvFile parses KEY=value with quotes and comments", () => {
  assert.deepEqual(parseEnvFile('A=1\nB="two"\n# c\n'), { A: "1", B: "two" });
});

test("envVarFor uppercases the field and appends _API_KEY", () => {
  assert.equal(envVarFor("openrouter"), "OPENROUTER_API_KEY");
  assert.equal(envVarFor("prismd"), "PRISMD_API_KEY");
});

test("resolveKey prefers env var over .env over keys.yaml", () => {
  const home = makeHome({
    ".env": "OPENROUTER_API_KEY=from-dotenv\n",
    "keys.yaml": "openrouter: from-yaml\n",
  });
  const store = loadKeyStore(home);

  const prev = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.equal(resolveKey(store, "openrouter"), "from-dotenv");
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

test("resolveKey falls back to keys.yaml when .env has no entry", () => {
  const home = makeHome({
    ".env": "OTHER_API_KEY=whatever\n",
    "keys.yaml": "groq: groq-fake-key\n",
  });
  const store = loadKeyStore(home);
  assert.equal(resolveKey(store, "groq"), "groq-fake-key");
});

test("resolveKey returns undefined when nothing is configured", () => {
  const store = loadKeyStore(makeHome({}));
  assert.equal(resolveKey(store, "openrouter"), undefined);
});

test("empty values do not count as configured", () => {
  const home = makeHome({
    ".env": "OPENROUTER_API_KEY=\n",
    "keys.yaml": 'openrouter: ""\n',
  });
  const store = loadKeyStore(home);
  assert.equal(resolveKey(store, "openrouter"), undefined);
});

test("loadKeyStore tolerates missing or unreadable files", () => {
  const store = loadKeyStore(makeHome({}));
  assert.deepEqual(store, { envFile: {}, yaml: {} });
});
