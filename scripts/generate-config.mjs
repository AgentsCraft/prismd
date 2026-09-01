#!/usr/bin/env node
/**
 * Generates prismd.json from the four config layers:
 *   presets/providers.json  (defaults)  +  config.user.json  (overrides)
 *   keys: OS env vars > ~/.prismd/.env > ~/.prismd/keys.yaml
 *         (which API keys are configured)
 *
 * Output is validated against config.schema.json before writing and is
 * byte-identical for identical inputs (stable key order).
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_SERVER = { host: '127.0.0.1', port: 8787 };
const DEFAULT_AUTH = { localTokenField: 'prismd' };
const DEFAULT_POLICIES = {
  failoverOn: ['401', '403', '429', '500', '502', '503', '504'],
  retryBeforeStream: true,
  retryAfterStream: false,
  maxCandidatesPerRequest: 2,
  respectRetryAfter: true,
  quotaSoftLimitRatio: 0.8,
  connectTimeoutMs: 10000,
  streamIdleTimeoutMs: 300000,
  failThreshold: 3,
  cooldownMs: 60000,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge: plain objects merge recursively; arrays and scalars are
 * replaced wholesale by the override value.
 */
export function deepMerge(base, override) {
  if (override === undefined) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMerge(base[key], value);
    }
    return merged;
  }
  return override;
}

/**
 * Minimal .env parser: KEY=value lines, full-line # comments, blank lines.
 * Quotes around values are stripped. Deliberately no dotenv dependency.
 */
export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') env[key] = value;
  }
  return env;
}

/**
 * Minimal flat keys.yaml parser: `field: value` lines, full-line #
 * comments, blank lines, quotes stripped. No nested structures or flow
 * syntax — deliberately no yaml dependency (mirrors parseEnvFile).
 */
export function parseKeysYaml(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '' && !value.startsWith('#')) out[key] = value;
  }
  return out;
}

/**
 * Serialize with recursively sorted object keys so identical configs
 * produce byte-identical output.
 */
export function stableStringify(value) {
  const sortKeys = (node) => {
    if (Array.isArray(node)) return node.map(sortKeys);
    if (isPlainObject(node)) {
      const out = {};
      for (const key of Object.keys(node).sort()) out[key] = sortKeys(node[key]);
      return out;
    }
    return node;
  };
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function readJson(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }
}

/** Strip presets-only provenance fields; keep the runtime candidate shape. */
function candidateFromMeta(providerModelId, meta) {
  return {
    provider: meta.provider,
    providerModelId,
    contextWindow: meta.contextWindow,
    maxOutputTokens: meta.maxOutputTokens,
    supportsTools: meta.supportsTools,
    supportsReasoning: meta.supportsReasoning,
    limits: meta.limits,
    tags: meta.tags,
  };
}

function expandCandidates(entries, modelCatalog, alias, warn) {
  const candidates = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
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
      const meta = typeof id === 'string' ? modelCatalog[id] : undefined;
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

/** Key sources in priority order: env vars > ./.env > ~/.prismd/.env > ~/.prismd/keys.yaml. */
function resolveKeyValue(keys, field) {
  const envVar = `${field.toUpperCase()}_API_KEY`;
  if (keys.env[envVar]) return keys.env[envVar];
  if (keys.localEnvFile && keys.localEnvFile[envVar]) return keys.localEnvFile[envVar];
  if (keys.envFile[envVar]) return keys.envFile[envVar];
  if (keys.yaml[field]) return keys.yaml[field];
  return undefined;
}

function keyConfigured(provider, keys) {
  const authType = provider?.auth?.type ?? 'api_key';
  if (authType !== 'api_key') return true;
  const field = provider?.apiKeyField;
  if (!field) return true;
  return resolveKeyValue(keys, field) !== undefined;
}

/**
 * Warn when a key file is readable by group/others (mode & 0o077).
 * Never fails the load; the message names only the path, never values.
 */
function warnOnLoosePermissions(filePath, warn) {
  try {
    if ((statSync(filePath).mode & 0o077) !== 0) {
      warn(`warning: ${filePath} is readable by group/others; consider chmod 600 ${filePath}`);
    }
  } catch {
    // missing/unreadable files are handled by the callers
  }
}

/**
 * Load the key sources: live OS env vars plus a one-shot snapshot of
 * ./.env, ~/.prismd/.env and ~/.prismd/keys.yaml. `overrides` supplies test values.
 */
function loadKeys({ env, homeDir, rootDir, warn = () => {} } = {}) {
  const keys = { env: { ...process.env, ...(env ?? {}) }, localEnvFile: {}, envFile: {}, yaml: {} };
  const localEnvPath = join(rootDir ?? process.cwd(), '.env');
  if (existsSync(localEnvPath)) {
    warnOnLoosePermissions(localEnvPath, warn);
    keys.localEnvFile = parseEnvFile(readFileSync(localEnvPath, 'utf8'));
  }
  const dir = join(homeDir ?? homedir(), '.prismd');
  const envPath = join(dir, '.env');
  if (existsSync(envPath)) {
    warnOnLoosePermissions(envPath, warn);
    keys.envFile = parseEnvFile(readFileSync(envPath, 'utf8'));
  }
  const yamlPath = join(dir, 'keys.yaml');
  if (existsSync(yamlPath)) {
    warnOnLoosePermissions(yamlPath, warn);
    keys.yaml = parseKeysYaml(readFileSync(yamlPath, 'utf8'));
  }
  return keys;
}

/**
 * Build the runtime config object. Pure function; warnings go to `warn`.
 */
export function buildConfig({ presets, userConfig = {}, keys, warn = () => {} }) {
  const config = {
    version: userConfig.version ?? 1,
    server: deepMerge(DEFAULT_SERVER, userConfig.server),
    auth: deepMerge(DEFAULT_AUTH, userConfig.auth),
    providers: deepMerge(presets.providers ?? {}, userConfig.providers),
    models: {},
    policies: deepMerge(DEFAULT_POLICIES, userConfig.policies),
  };

  const modelCatalog = presets.models ?? {};
  const aliases = deepMerge(presets.aliases ?? {}, userConfig.aliases);

  for (const [alias, def] of Object.entries(aliases)) {
    const expanded = expandCandidates(def?.candidates ?? [], modelCatalog, alias, warn);
    const kept = expanded.filter((candidate) => {
      const provider = candidate?.provider;
      const providerDef = typeof provider === 'string' ? config.providers[provider] : undefined;
      if (!providerDef) {
        warn(`warning: skipping candidate for alias "${alias}": unknown provider "${provider}"`);
        return false;
      }
      if (!keyConfigured(providerDef, keys)) {
        const envVar = `${providerDef.apiKeyField.toUpperCase()}_API_KEY`;
        warn(
          `warning: skipping candidate "${candidate.providerModelId}" for alias "${alias}": ` +
            `key "${providerDef.apiKeyField}" not found (${envVar} / .env / ~/.prismd/.env / ~/.prismd/keys.yaml)`,
        );
        return false;
      }
      return true;
    });

    if (kept.length === 0) {
      warn(`warning: omitting alias "${alias}": no candidates left after key filtering`);
      continue;
    }
    const model = { candidates: kept };
    if (def?.description) model.description = def.description;
    config.models[alias] = model;
  }
  return config;
}

/** Validate a config object against a JSON Schema (ajv). */
export function validateConfig(config, schema) {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  return { valid, errors: validate.errors ?? [] };
}

export function formatErrors(errors) {
  return errors
    .map((err) => `  ${err.instancePath || '(root)'} ${err.message}`)
    .join('\n');
}

/**
 * Full pipeline for a root dir: read layers, merge, validate, serialize.
 * `env`/`homeDir` override the key sources (used by tests).
 */
export function generate(rootDir, { env, homeDir, warn = () => {} } = {}) {
  const presets = readJson(join(rootDir, 'presets', 'providers.json'));
  let userConfig = {};
  const userPath = join(rootDir, 'config.user.json');
  if (existsSync(userPath)) userConfig = readJson(userPath);

  const keys = loadKeys({ env, homeDir, rootDir, warn });

  const config = buildConfig({ presets, userConfig, keys, warn });
  if (Object.keys(config.models).length === 0) {
    warn(
      'warning: no aliases generated — configure at least one API key ' +
        '(env vars, .env, ~/.prismd/.env or ~/.prismd/keys.yaml)',
    );
  }
  const schema = readJson(join(rootDir, 'config.schema.json'));
  const { valid, errors } = validateConfig(config, schema);
  if (!valid) {
    throw new Error(`generated config failed schema validation:\n${formatErrors(errors)}`);
  }
  return stableStringify(config);
}

const USAGE = `usage: node scripts/generate-config.mjs [--root <dir>]

Reads presets/providers.json, config.user.json and the key sources
(env vars > ~/.prismd/.env > ~/.prismd/keys.yaml), then writes a
schema-validated prismd.json next to --root (defaults to the repo root).`;

/** CLI entry; returns the process exit code. */
export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let rootDir = REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      i += 1;
      if (i >= argv.length) {
        stderr.write('error: --root requires a directory argument\n');
        return 1;
      }
      rootDir = resolve(argv[i]);
    } else if (arg === '--help' || arg === '-h') {
      stdout.write(`${USAGE}\n`);
      return 0;
    } else {
      stderr.write(`error: unknown argument "${arg}"\n${USAGE}`);
      return 1;
    }
  }

  try {
    if (!existsSync(join(rootDir, 'presets', 'providers.json'))) {
      stderr.write(`error: presets/providers.json not found under ${rootDir}\n`);
      return 1;
    }
    if (!existsSync(join(rootDir, 'config.schema.json'))) {
      stderr.write(`error: config.schema.json not found under ${rootDir}\n`);
      return 1;
    }
    const content = generate(rootDir, {
      warn: (message) => stderr.write(`${message}\n`),
    });
    const outPath = join(rootDir, 'prismd.json');
    writeFileSync(outPath, content);
    stdout.write(`wrote ${outPath}\n`);
    return 0;
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
