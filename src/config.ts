import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { generateConfigString } from "./generate-config.js";
import { loadKeyStore, resolveKey, resolveKeys, type KeyStore } from "./keys.js";
import { logger } from "./observability/logger.js";
import type { PrismdConfig } from "./types/config.js";

/** Packaged at the repo/package root, next to config.schema.json in dev and dist. */
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "config.schema.json");

/**
 * Resolve the configuration file path using hierarchical fallback:
 * 1. Explicit PRISMD_CONFIG_PATH environment variable (throws if missing).
 * 2. Local ./prismd.json in current working directory.
 * 3. ~/.prismd/prismd.json in user's home directory.
 * 4. Auto-generates ~/.prismd/prismd.json from presets and keys if no file exists.
 */
export function resolveConfigPath(
  envPath?: string,
  cwd: string = process.env.PRISMD_CWD ?? process.cwd(),
  homeDir: string = process.env.PRISMD_HOME ?? homedir(),
): string {
  const explicitPath = envPath ?? process.env.PRISMD_CONFIG_PATH;
  if (explicitPath !== undefined && explicitPath !== "") {
    return explicitPath;
  }

  const localPath = join(cwd, "prismd.json");
  if (existsSync(localPath)) {
    return localPath;
  }

  const homeDirPrismd = join(homeDir, ".prismd");
  const homeConfigPath = join(homeDirPrismd, "prismd.json");
  if (existsSync(homeConfigPath)) {
    return homeConfigPath;
  }

  // Auto-initialize ~/.prismd/prismd.json on first launch
  mkdirSync(homeDirPrismd, { recursive: true, mode: 0o700 });
  const content = generateConfigString({ homeDir, cwd });
  writeFileSync(homeConfigPath, content, { mode: 0o600 });
  logger.info({ path: homeConfigPath }, "initialized default configuration at ~/.prismd/prismd.json");
  return homeConfigPath;
}

/**
 * Load and validate a prismd.json file. Throws on missing file, invalid
 * JSON, schema violations (with instance paths) or a non-loopback
 * server.host (security: fail fast, no silent fallback). Unknown top-level
 * keys are ignored with a warning, so a file written by a different prismd
 * version stays loadable instead of bricking startup over a stale field.
 */
export function loadConfig(filePath: string): PrismdConfig {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`cannot read prismd config "${filePath}": ${(err as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in prismd config "${filePath}": ${(err as Error).message}`);
  }

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && schema.properties) {
    const knownRootKeys = new Set(Object.keys(schema.properties));
    const obj = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(obj).filter((key) => !knownRootKeys.has(key));
    if (unknownKeys.length > 0) {
      logger.warn(
        { keys: unknownKeys, path: filePath },
        "ignoring unknown top-level config keys (written by a different prismd version?); they have no effect",
      );
      for (const key of unknownKeys) delete obj[key];
    }
  }

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((err) => `  ${err.instancePath || "(root)"} ${err.message}`)
      .join("\n");
    throw new Error(`invalid prismd config "${filePath}":\n${details}`);
  }

  const config = raw as PrismdConfig;
  if (config.server.host !== "127.0.0.1" && config.server.host !== "localhost") {
    throw new Error(
      `refusing to bind to non-loopback host "${config.server.host}"; ` +
        'set server.host to "127.0.0.1" or "localhost"',
    );
  }
  return config;
}

let cached: PrismdConfig | undefined;
let cachedKeys: KeyStore | undefined;

/**
 * Get the validated runtime config, loading (once) from PRISMD_CONFIG_PATH,
 * ./prismd.json, or ~/.prismd/prismd.json. Auto-generates on first launch.
 */
export function getConfig(): PrismdConfig {
  if (cached) return cached;
  const path = resolveConfigPath();
  cached = loadConfig(path);
  cachedKeys = loadKeyStore();
  return cached;
}

/**
 * Atomically reload and validate config and keys in-place without restart.
 * Keeps previous configuration if loading or validation fails.
 */
export function reloadConfig(filePath?: string): PrismdConfig {
  const path = filePath ?? resolveConfigPath();
  const newConfig = loadConfig(path);
  const newKeys = loadKeyStore();
  cached = newConfig;
  cachedKeys = newKeys;
  return newConfig;
}

/**
 * Resolve an upstream API key for a provider's apiKeyField
 * (env var > ~/.prismd/.env > ~/.prismd/keys.yaml).
 */
export function resolveProviderApiKey(field: string): string | undefined {
  return resolveKey(cachedKeys ?? loadKeyStore(), field);
}

/**
 * Resolve all upstream API keys for a provider's apiKeyField.
 */
export function resolveProviderApiKeys(field: string): string[] {
  return resolveKeys(cachedKeys ?? loadKeyStore(), field);
}

/** Resolve the local gateway token for auth.localTokenField. */
export function resolveLocalToken(field: string): string | undefined {
  return resolveKey(cachedKeys ?? loadKeyStore(), field);
}

/** Test-only: drop the cached config and key store so getConfig reloads. */
export function resetConfigForTests(): void {
  cached = undefined;
  cachedKeys = undefined;
}

