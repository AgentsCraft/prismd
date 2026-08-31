/**
 * API key resolution for ~/.prismd/.
 *
 * Lookup order for a key field (e.g. "openrouter" or "prismd"):
 *   1. OS environment variable: field uppercased + "_API_KEY" (OPENROUTER_API_KEY)
 *   2. ~/.prismd/.env, dotenv format: KEY=VALUE (OPENROUTER_API_KEY=...)
 *   3. ~/.prismd/keys.yaml, flat YAML: field: value (openrouter: ...)
 *
 * Files are read once at startup (no hot reload); env vars win over files.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface KeyStore {
  /** Parsed ~/.prismd/.env */
  envFile: Record<string, string>;
  /** Parsed ~/.prismd/keys.yaml */
  yaml: Record<string, string>;
}

/**
 * Minimal flat keys.yaml parser: `field: value` lines, full-line `#`
 * comments, blank lines. Quotes around values are stripped. No nested
 * structures, no flow syntax — deliberately no yaml dependency (mirrors
 * the hand-rolled parser style of scripts/generate-config.mjs).
 */
export function parseKeysYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "" && !value.startsWith("#")) {
      out[key] = value;
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

/** Load ~/.prismd/.env and ~/.prismd/keys.yaml once. Missing files are fine. */
export function loadKeyStore(homeDir: string = homedir()): KeyStore {
  const dir = join(homeDir, ".prismd");
  let envFile: Record<string, string> = {};
  let yaml: Record<string, string> = {};
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) {
    try {
      envFile = parseEnvFile(readFileSync(envPath, "utf8"));
    } catch {
      envFile = {};
    }
  }
  const yamlPath = join(dir, "keys.yaml");
  if (existsSync(yamlPath)) {
    try {
      yaml = parseKeysYaml(readFileSync(yamlPath, "utf8"));
    } catch {
      yaml = {};
    }
  }
  return { envFile, yaml };
}

/**
 * Resolve a key by field name. Returns undefined when nothing is set.
 * Priority: env var (FIELD_API_KEY) > ~/.prismd/.env > ~/.prismd/keys.yaml.
 * The env tier is read live; the file tiers come from the startup snapshot.
 */
export function resolveKey(store: KeyStore, field: string): string | undefined {
  const envVar = envVarFor(field);
  const fromEnv = process.env[envVar];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const fromEnvFile = store.envFile[envVar];
  if (fromEnvFile !== undefined && fromEnvFile !== "") return fromEnvFile;
  const fromYaml = store.yaml[field];
  if (fromYaml !== undefined && fromYaml !== "") return fromYaml;
  return undefined;
}
