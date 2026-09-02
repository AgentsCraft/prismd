import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { fetchProviderModels } from "./core/catalog-sync.js";
import { loadKeyStore, resolveKeys, type KeyStore } from "./keys.js";
import type { PrismdConfig } from "./types/config.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_SERVER = { host: "127.0.0.1", port: 8787 };
const DEFAULT_AUTH = { localTokenField: "prismd" };
const DEFAULT_POLICIES = {
  failoverOn: ["401", "403", "404", "410", "413", "429", "500", "502", "503", "504"],
  retryBeforeStream: true,
  retryAfterStream: false,
  maxCandidatesPerRequest: 5,
  respectRetryAfter: true,
  quotaSoftLimitRatio: 0.8,
  connectTimeoutMs: 10000,
  streamIdleTimeoutMs: 300000,
  failThreshold: 3,
  cooldownMs: 60000,
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep merge: plain objects merge recursively; arrays and scalars are
 * replaced wholesale by the override value.
 */
export function deepMerge<T = any>(base: any, override: any): T {
  if (override === undefined) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, any> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMerge(base[key], value);
    }
    return merged as T;
  }
  return override;
}

/**
 * Serialize with recursively sorted object keys so identical configs
 * produce byte-identical output.
 */
export function stableStringify(value: unknown): string {
  const sortKeys = (node: any): any => {
    if (Array.isArray(node)) return node.map(sortKeys);
    if (isPlainObject(node)) {
      const out: Record<string, any> = {};
      for (const key of Object.keys(node).sort()) out[key] = sortKeys(node[key]);
      return out;
    }
    return node;
  };
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function readJson(filePath: string): any {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${(err as Error).message}`);
  }
}

/** Strip presets-only provenance fields; keep the runtime candidate shape. */
function candidateFromMeta(providerModelId: string, meta: any): any {
  return {
    provider: meta.provider,
    providerModelId: meta.providerModelId ?? providerModelId,
    contextWindow: meta.contextWindow,
    maxOutputTokens: meta.maxOutputTokens,
    supportsTools: meta.supportsTools,
    supportsReasoning: meta.supportsReasoning,
    limits: meta.limits,
    tags: meta.tags,
  };
}

function expandCandidates(
  entries: any[],
  modelCatalog: Record<string, any>,
  alias: string,
  warn: (msg: string) => void,
): any[] {
  const candidates: any[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      const meta = modelCatalog[entry];
      if (!meta) {
        warn(`warning: skipping unknown model "${entry}" referenced by alias "${alias}"`);
        continue;
      }
      candidates.push(candidateFromMeta(entry, meta));
      continue;
    }
    if (isPlainObject(entry)) {
      const id = entry.providerModelId;
      const meta = typeof id === "string" ? modelCatalog[id] : undefined;
      if (meta) {
        candidates.push(deepMerge(candidateFromMeta(id, meta), entry));
      } else {
        // Full inline definition; schema validation reports missing fields.
        candidates.push(entry);
      }
      continue;
    }
    warn(`warning: skipping invalid candidate entry in alias "${alias}"`);
  }
  return candidates;
}

function keyConfigured(provider: any, keyStore: KeyStore): boolean {
  const authType = provider?.auth?.type ?? "api_key";
  if (authType !== "api_key") return true;
  const field = provider?.apiKeyField;
  if (!field) return true;
  return resolveKeys(keyStore, field).length > 0;
}

export interface BuildConfigOptions {
  presets: Record<string, any>;
  userConfig?: Record<string, any>;
  keyStore: KeyStore;
  warn?: (msg: string) => void;
  upstreamCatalogs?: Map<string, Set<string>>;
}

/**
 * Build the runtime config object from presets, user config, and resolved key store.
 */
export function buildConfig({
  presets,
  userConfig = {},
  keyStore,
  warn = () => {},
  upstreamCatalogs,
}: BuildConfigOptions): PrismdConfig {
  const config: any = {
    version: userConfig.version ?? 1,
    server: deepMerge(DEFAULT_SERVER, userConfig.server),
    auth: deepMerge(DEFAULT_AUTH, userConfig.auth),
    providers: deepMerge(presets.providers ?? {}, userConfig.providers),
    models: {},
    policies: deepMerge(DEFAULT_POLICIES, userConfig.policies),
  };

  const modelCatalog = presets.models ?? {};
  const aliases = deepMerge(presets.aliases ?? {}, userConfig.aliases);

  for (const [alias, def] of Object.entries(aliases) as [string, any][]) {
    const expanded = expandCandidates(def?.candidates ?? [], modelCatalog, alias, warn);
    const kept = expanded.filter((candidate) => {
      const provider = candidate?.provider;
      const providerDef = typeof provider === "string" ? config.providers[provider] : undefined;
      if (!providerDef) {
        warn(`warning: skipping candidate for alias "${alias}": unknown provider "${provider}"`);
        return false;
      }
      if (!keyConfigured(providerDef, keyStore)) {
        const envVar = `${providerDef.apiKeyField.toUpperCase()}_API_KEY`;
        warn(
          `warning: skipping candidate "${candidate.providerModelId}" for alias "${alias}": ` +
            `key "${providerDef.apiKeyField}" not found (${envVar} / .env / ~/.prismd/.env / ~/.prismd/keys.yaml)`,
        );
        return false;
      }
      if (upstreamCatalogs && upstreamCatalogs.has(provider)) {
        const available = upstreamCatalogs.get(provider)!;
        if (!available.has(candidate.providerModelId)) {
          warn(
            `warning: skipping candidate "${candidate.providerModelId}" for alias "${alias}": ` +
              `not found in live upstream catalog for "${provider}"`,
          );
          return false;
        }
      }
      return true;
    });

    if (kept.length === 0) {
      warn(`warning: omitting alias "${alias}": no candidates left after key filtering`);
      continue;
    }
    const model: any = { candidates: kept };
    if (def?.description) model.description = def.description;
    config.models[alias] = model;
  }
  return config as PrismdConfig;
}

/** Validate a config object against a JSON Schema (ajv). */
export function validateConfig(
  config: unknown,
  schema: any,
): { valid: boolean; errors: any[] } {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  return { valid: Boolean(valid), errors: validate.errors ?? [] };
}

export function formatErrors(errors: any[]): string {
  return errors
    .map((err) => `  ${err.instancePath || "(root)"} ${err.message}`)
    .join("\n");
}

export interface GenerateOptions {
  rootDir?: string;
  homeDir?: string;
  cwd?: string;
  warn?: (msg: string) => void;
}

/**
 * Generate validated PrismdConfig object.
 */
export function generateConfigObject({
  rootDir = PACKAGE_ROOT,
  homeDir = homedir(),
  cwd = process.cwd(),
  warn = () => {},
}: GenerateOptions = {}): PrismdConfig {
  const presets = readJson(join(rootDir, "presets", "providers.json"));
  let userConfig: Record<string, any> = {};

  const cwdUserPath = join(cwd, "config.user.json");
  const homeUserPath = join(homeDir, ".prismd", "config.user.json");
  if (existsSync(cwdUserPath)) {
    userConfig = readJson(cwdUserPath);
  } else if (existsSync(homeUserPath)) {
    userConfig = readJson(homeUserPath);
  }

  const keyStore = loadKeyStore(homeDir, cwd);
  const config = buildConfig({ presets, userConfig, keyStore, warn });

  if (Object.keys(config.models).length === 0) {
    warn(
      "warning: no aliases generated — configure at least one API key " +
        "(env vars, .env, ~/.prismd/.env or ~/.prismd/keys.yaml)",
    );
  }

  const schema = readJson(join(rootDir, "config.schema.json"));
  const { valid, errors } = validateConfig(config, schema);
  if (!valid) {
    throw new Error(`generated config failed schema validation:\n${formatErrors(errors)}`);
  }

  return config;
}

/**
 * Query upstream providers with configured keys in parallel to discover actual available models.
 */
export async function queryUpstreamCatalogs(
  providers: Record<string, any>,
  keyStore: KeyStore,
  warn: (msg: string) => void = () => {},
): Promise<Map<string, Set<string>>> {
  const catalogs = new Map<string, Set<string>>();
  const promises = Object.entries(providers).map(async ([providerName, def]) => {
    const keys = resolveKeys(keyStore, def.apiKeyField ?? providerName);
    if (def.auth?.type === "none") {
      keys.push("none");
    }
    if (keys.length === 0) return;
    const apiKey = keys[0];
    const { ok, models, error } = await fetchProviderModels(
      providerName,
      def.baseUrl,
      apiKey,
      def.extraHeaders,
      4000,
    );
    if (ok && models.length > 0) {
      catalogs.set(providerName, new Set(models));
    } else if (error) {
      warn(`info: could not fetch live catalog for "${providerName}" (${error}); falling back to local presets`);
    }
  });

  await Promise.allSettled(promises);
  return catalogs;
}

/**
 * Generate validated PrismdConfig object asynchronously, verifying models against live upstream catalogs.
 */
export async function generateConfigObjectAsync({
  rootDir = PACKAGE_ROOT,
  homeDir = homedir(),
  cwd = process.cwd(),
  warn = () => {},
  liveCheck = true,
}: GenerateOptions & { liveCheck?: boolean } = {}): Promise<PrismdConfig> {
  const presets = readJson(join(rootDir, "presets", "providers.json"));
  let userConfig: Record<string, any> = {};

  const cwdUserPath = join(cwd, "config.user.json");
  const homeUserPath = join(homeDir, ".prismd", "config.user.json");
  if (existsSync(cwdUserPath)) {
    userConfig = readJson(cwdUserPath);
  } else if (existsSync(homeUserPath)) {
    userConfig = readJson(homeUserPath);
  }

  const keyStore = loadKeyStore(homeDir, cwd);
  let upstreamCatalogs: Map<string, Set<string>> | undefined;
  if (liveCheck) {
    const allProviders = deepMerge(presets.providers ?? {}, userConfig.providers);
    upstreamCatalogs = await queryUpstreamCatalogs(allProviders, keyStore, warn);
  }

  const config = buildConfig({ presets, userConfig, keyStore, warn, upstreamCatalogs });

  if (Object.keys(config.models).length === 0) {
    warn(
      "warning: no aliases generated — configure at least one API key " +
        "(env vars, .env, ~/.prismd/.env or ~/.prismd/keys.yaml)",
    );
  }

  const schema = readJson(join(rootDir, "config.schema.json"));
  const { valid, errors } = validateConfig(config, schema);
  if (!valid) {
    throw new Error(`generated config failed schema validation:\n${formatErrors(errors)}`);
  }

  return config;
}

/**
 * Generate validated configuration as a formatted JSON string asynchronously with live upstream checks.
 */
export async function generateConfigStringAsync(
  options: GenerateOptions & { liveCheck?: boolean } = {},
): Promise<string> {
  const config = await generateConfigObjectAsync(options);
  return stableStringify(config);
}

/**
 * Generate validated configuration as a formatted JSON string.
 */
export function generateConfigString(options: GenerateOptions = {}): string {
  const config = generateConfigObject(options);
  return stableStringify(config);
}
