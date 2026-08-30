import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismdConfig, ProviderConfig } from "./types/config.js";

const DEFAULT_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "presets",
  "providers.json",
);

let cached: PrismdConfig | undefined;

export function getConfig(): PrismdConfig {
  if (cached) return cached;
  const path = process.env.PRISMD_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  const config = JSON.parse(readFileSync(path, "utf8")) as PrismdConfig;
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error(`invalid provider config: ${path} (expected a non-empty "providers" array)`);
  }
  cached = config;
  return config;
}

/** Find the provider whose preset declares the requested model. */
export function findProvider(config: PrismdConfig, model: string): ProviderConfig | undefined {
  return config.providers.find((p) => p.models.includes(model));
}
