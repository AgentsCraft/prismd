import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { loadKeyStore, resolveKey, resolveKeys, type KeyStore } from "./keys.js";
import type { PrismdConfig } from "./types/config.js";

/** Packaged at the repo/package root, next to config.schema.json in dev and dist. */
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "config.schema.json");

const DEFAULT_CONFIG_PATH = join(process.cwd(), "prismd.json");

/**
 * Load and validate a prismd.json file. Throws on missing file, invalid
 * JSON, schema violations (with instance paths) or a non-loopback
 * server.host (security: fail fast, no silent fallback).
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
 * Get the validated runtime config, loading (once) from PRISMD_CONFIG_PATH
 * or ./prismd.json. The ~/.prismd key store snapshot loads once alongside.
 */
export function getConfig(): PrismdConfig {
  if (cached) return cached;
  const path = process.env.PRISMD_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  cached = loadConfig(path);
  cachedKeys = loadKeyStore();
  return cached;
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
