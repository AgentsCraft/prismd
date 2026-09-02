/**
 * API key resolution for ~/.prismd/.
 *
 * Lookup order for a key field (e.g. "openrouter" or "prismd"):
 *   1. OS environment variable: field uppercased + "_API_KEY" (OPENROUTER_API_KEY)
 *   2. ./.env, dotenv format: KEY=VALUE (OPENROUTER_API_KEY=...)
 *   3. ~/.prismd/.env, dotenv format: KEY=VALUE (OPENROUTER_API_KEY=...)
 *   4. ~/.prismd/keys.yaml, flat or list YAML: field: value | field: [v1, v2] | field:\n  - v1\n  - v2
 *
 * Multi-key configurations:
 *   - Env vars / .env: comma-separated list, e.g. GROQ_API_KEY="gsk_1,gsk_2"
 *   - keys.yaml: string, inline array ["k1", "k2"], or YAML list items (- k1)
 *
 * Files are read once at startup (no hot reload); env vars win over files.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "./observability/logger.js";

export interface KeyStore {
  /** Parsed ./.env */
  localEnvFile: Record<string, string>;
  /** Parsed ~/.prismd/.env */
  envFile: Record<string, string>;
  /** Parsed ~/.prismd/keys.yaml */
  yaml: Record<string, string | string[]>;
}

function stripYamlInlineComment(val: string): string {
  let v = val.trim();
  if (v.startsWith("#")) return "";
  if (v.startsWith('"')) {
    const endQuote = v.indexOf('"', 1);
    if (endQuote !== -1) {
      return v.slice(0, endQuote + 1);
    }
  } else if (v.startsWith("'")) {
    const endQuote = v.indexOf("'", 1);
    if (endQuote !== -1) {
      return v.slice(0, endQuote + 1);
    }
  }
  const hashIdx = v.indexOf(" #");
  if (hashIdx !== -1) {
    v = v.slice(0, hashIdx).trim();
  }
  return v;
}

function stripYamlQuotesAndComment(val: string): string {
  let v = stripYamlInlineComment(val);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ",") {
        const item = current.trim();
        if (item !== "") items.push(stripYamlQuotesAndComment(item));
        current = "";
      } else {
        current += ch;
      }
    }
  }
  const item = current.trim();
  if (item !== "") items.push(stripYamlQuotesAndComment(item));
  return items;
}

function parseCommaSeparated(str: string): string[] {
  const items = str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return Array.from(new Set(items));
}

/**
 * Minimal keys.yaml parser supporting:
 * - `field: value`
 * - `field: ["v1", "v2"]` or `field: ['v1', 'v2']` or `field: [v1, v2]`
 * - `field:\n  - "v1"\n  - "v2"`
 * Full-line `#` comments and blank lines are ignored.
 * No external yaml dependency.
 */
export function parseKeysYaml(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let currentKey: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Check if this line is a list item: e.g. "- item" or "  - item"
    if (trimmed.startsWith("-") && currentKey !== null) {
      let itemVal = trimmed.slice(1).trim();
      itemVal = stripYamlQuotesAndComment(itemVal);
      if (itemVal !== "") {
        const existing = out[currentKey];
        if (Array.isArray(existing)) {
          existing.push(itemVal);
        } else {
          out[currentKey] = [itemVal];
        }
      }
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      currentKey = null;
      continue;
    }

    const key = trimmed.slice(0, colon).trim();
    if (key === "") {
      currentKey = null;
      continue;
    }

    let value = trimmed.slice(colon + 1).trim();
    value = stripYamlInlineComment(value);

    // Inline array: [ ... ]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        out[key] = [];
      } else {
        out[key] = parseInlineArray(inner);
      }
      currentKey = key;
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === "") {
      out[key] = "";
      currentKey = key;
    } else {
      out[key] = value;
      currentKey = key;
    }
  }

  return out;
}

/** Minimal dotenv parser shared by the runtime (no dotenv dependency). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") out[key] = value;
  }
  return out;
}

/** The env var name for a key field: field uppercased + "_API_KEY". */
export function envVarFor(field: string): string {
  return `${field.toUpperCase()}_API_KEY`;
}

/**
 * Warn when a key file is readable by group/others (mode & 0o077).
 * Never fails the load; the message names only the path, never values.
 */
function warnOnLoosePermissions(filePath: string): void {
  try {
    if ((statSync(filePath).mode & 0o077) !== 0) {
      logger.warn(`${filePath} is readable by group/others; consider chmod 600 ${filePath}`);
    }
  } catch {
    // unreadable files are tolerated by the callers
  }
}

/**
 * Load ./.env, ~/.prismd/.env and ~/.prismd/keys.yaml once. Missing files are fine.
 * Defaults to PRISMD_HOME (if set) or homedir().
 */
export function loadKeyStore(
  homeDir: string = process.env.PRISMD_HOME ?? homedir(),
  cwd: string = process.env.PRISMD_CWD ?? process.cwd(),
): KeyStore {
  let localEnvFile: Record<string, string> = {};
  const localEnvPath = join(cwd, ".env");
  if (existsSync(localEnvPath)) {
    warnOnLoosePermissions(localEnvPath);
    try {
      localEnvFile = parseEnvFile(readFileSync(localEnvPath, "utf8"));
    } catch {
      localEnvFile = {};
    }
  }

  const dir = join(homeDir, ".prismd");
  let envFile: Record<string, string> = {};
  let yaml: Record<string, string | string[]> = {};
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) {
    warnOnLoosePermissions(envPath);
    try {
      envFile = parseEnvFile(readFileSync(envPath, "utf8"));
    } catch {
      envFile = {};
    }
  }
  const yamlPath = join(dir, "keys.yaml");
  if (existsSync(yamlPath)) {
    warnOnLoosePermissions(yamlPath);
    try {
      yaml = parseKeysYaml(readFileSync(yamlPath, "utf8"));
    } catch {
      yaml = {};
    }
  }
  return { localEnvFile, envFile, yaml };
}

/**
 * Resolve all keys for a field. Returns array of deduplicated keys in order of precedence:
 * Env var (FIELD_API_KEY) > ./.env > ~/.prismd/.env > ~/.prismd/keys.yaml.
 */
export function resolveKeys(store: KeyStore, field: string): string[] {
  const envVar = envVarFor(field);

  const fromEnv = process.env[envVar];
  if (fromEnv !== undefined && fromEnv !== "") {
    const keys = parseCommaSeparated(fromEnv);
    if (keys.length > 0) return keys;
  }

  const fromLocalEnv = store.localEnvFile?.[envVar];
  if (fromLocalEnv !== undefined && fromLocalEnv !== "") {
    const keys = parseCommaSeparated(fromLocalEnv);
    if (keys.length > 0) return keys;
  }

  const fromEnvFile = store.envFile?.[envVar];
  if (fromEnvFile !== undefined && fromEnvFile !== "") {
    const keys = parseCommaSeparated(fromEnvFile);
    if (keys.length > 0) return keys;
  }

  const fromYaml = store.yaml?.[field];
  if (fromYaml !== undefined) {
    if (Array.isArray(fromYaml)) {
      const keys = fromYaml
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k !== "");
      if (keys.length > 0) return Array.from(new Set(keys));
    } else if (typeof fromYaml === "string" && fromYaml !== "") {
      const keys = parseCommaSeparated(fromYaml);
      if (keys.length > 0) return keys;
    }
  }

  return [];
}

/**
 * Resolve a key by field name. Returns undefined when nothing is set.
 * Priority: env var (FIELD_API_KEY) > ./.env > ~/.prismd/.env > ~/.prismd/keys.yaml.
 * Returns the first configured key.
 */
export function resolveKey(store: KeyStore, field: string): string | undefined {
  const keys = resolveKeys(store, field);
  return keys.length > 0 ? keys[0] : undefined;
}
