#!/usr/bin/env node
/**
 * Generates ~/.codex/prismd-models.json (Codex model_catalog_json) from
 * the same metadata that feeds prismd.json: presets/providers.json +
 * config.user.json — one entry per gateway alias, single source of truth.
 *
 * Entry fields are cloned from the local Codex catalog
 * (~/.codex/models.json, codex 0.150.1 format) so the full field structure
 * — including required fields like supported_reasoning_levels — is always
 * present (M0 pitfall: minimal entries fail to parse). When no local
 * catalog exists, a built-in template with the empirically verified
 * required field set is used.
 *
 * Per alias:
 *   - slug / display_name = the alias name
 *   - context_window / max_context_window = MIN over candidates (conservative)
 *   - priority = position in the catalog
 * Note: the codex 0.150.1 catalog format has no max_output_tokens field
 * (verified against the installed binary), so the conservative minimum of
 * maxOutputTokens is not expressible and intentionally dropped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_MODELS_PATH = () => join(homedir(), '.codex', 'models.json');
const DEFAULT_OUT_PATH = () => join(homedir(), '.codex', 'prismd-models.json');

/**
 * Built-in fallback template. Exactly the field set that codex 0.150.1
 * requires (verified empirically against the installed binary, 2026-08-31):
 * slug, display_name, context_window, max_context_window,
 * supported_reasoning_levels, shell_type, visibility, supported_in_api,
 * priority, support_verbosity, truncation_policy,
 * experimental_supported_tools, base_instructions (or
 * model_messages.instructions_template). Plus a few optional fields with
 * safe defaults.
 */
const BUILTIN_TEMPLATE = {
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
  support_verbosity: true,
  truncation_policy: { mode: 'tokens', limit: 10000 },
  experimental_supported_tools: [],
  supported_reasoning_levels: [
    { effort: 'low', description: 'Fast responses with lighter reasoning' },
    { effort: 'high', description: 'Extra high reasoning depth for complex problems' },
    { effort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
  ],
  base_instructions:
    'You are Codex, an agent collaborating with the user in a shared workspace. ' +
    'Use tools where helpful and communicate concisely.',
  apply_patch_tool_type: 'freeform',
  web_search_tool_type: 'text',
  input_modalities: ['text'],
  supports_image_detail_original: false,
  supports_parallel_tool_calls: true,
  supports_search_tool: true,
  use_responses_lite: false,
  multi_agent_version: 'v2',
  default_reasoning_level: 'low',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
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

function readJson(filePath, description) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${description} "${filePath}": ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in ${description} "${filePath}": ${err.message}`);
  }
}

/** Clone the template entry structure from a codex models.json catalog. */
function templateFrom(modelsJson) {
  const entries = modelsJson?.models;
  if (Array.isArray(entries) && entries.length > 0 && isPlainObject(entries[0])) {
    return structuredClone(entries[0]);
  }
  return undefined;
}

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
      candidates.push(meta ? deepMerge(candidateFromMeta(id, meta), entry) : entry);
      continue;
    }
    warn(`warning: skipping invalid candidate entry in alias "${alias}"`);
  }
  return candidates;
}

/** Find a candidate field value to take the minimum of, ignoring missing. */
function minOf(candidates, pick) {
  const values = candidates.map(pick).filter((v) => typeof v === 'number');
  if (values.length === 0) return undefined;
  return Math.min(...values);
}

/**
 * Build the catalog object { models: [...] }. Pure; warnings go to `warn`.
 */
export function buildCatalog({ presets, userConfig = {}, template, warn = () => {} }) {
  const modelCatalog = presets.models ?? {};
  const aliases = deepMerge(presets.aliases ?? {}, userConfig.aliases);

  const models = [];
  let priority = 1;
  for (const [alias, def] of Object.entries(aliases)) {
    const candidates = expandCandidates(def?.candidates ?? [], modelCatalog, alias, warn);
    if (candidates.length === 0) {
      warn(`warning: skipping alias "${alias}": no candidates`);
      continue;
    }
    const entry = structuredClone(template);
    entry.slug = alias;
    entry.display_name = alias;
    entry.description =
      def?.description ?? `prismd alias ${alias} (${candidates.length} candidate${candidates.length > 1 ? 's' : ''})`;
    entry.context_window = minOf(candidates, (c) => c.contextWindow);
    entry.max_context_window = entry.context_window;
    entry.priority = priority;
    priority += 1;
    models.push(entry);
  }
  return { models };
}

/**
 * Full pipeline: load presets + user config + template, build the catalog.
 * Pure of process cwd except for the explicit paths.
 */
export function generateCatalog(rootDir, { modelsPath, warn = () => {} } = {}) {
  const presets = readJson(join(rootDir, 'presets', 'providers.json'), 'presets');
  let userConfig = {};
  const userPath = join(rootDir, 'config.user.json');
  if (existsSync(userPath)) userConfig = readJson(userPath, 'user config');

  const path = modelsPath ?? DEFAULT_MODELS_PATH();
  let template;
  if (existsSync(path)) {
    const cloned = templateFrom(readJson(path, 'codex models catalog'));
    if (cloned) {
      template = cloned;
    } else {
      warn(`warning: no usable entry in "${path}"; using the built-in template`);
      template = structuredClone(BUILTIN_TEMPLATE);
    }
  } else {
    template = structuredClone(BUILTIN_TEMPLATE);
  }

  return buildCatalog({ presets, userConfig, template, warn });
}

const USAGE = `usage: node scripts/generate-codex-catalog.mjs [--root <dir>] [--models-path <path>] [--out <path>]

Reads presets/providers.json + config.user.json from --root (default: repo
root), clones the entry structure from --models-path (default:
~/.codex/models.json), and writes ~/.codex/prismd-models.json (or --out).`;

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let rootDir = REPO_ROOT;
  let modelsPath;
  let outPath;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '--models-path' || arg === '--out') {
      i += 1;
      if (i >= argv.length) {
        stderr.write(`error: ${arg} requires a path argument\n`);
        return 1;
      }
      if (arg === '--root') rootDir = resolve(argv[i]);
      else if (arg === '--models-path') modelsPath = resolve(argv[i]);
      else outPath = resolve(argv[i]);
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
    const catalog = generateCatalog(rootDir, {
      modelsPath,
      warn: (message) => stderr.write(`${message}\n`),
    });
    const target = outPath ?? DEFAULT_OUT_PATH();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
    stdout.write(`wrote ${target}\n`);
    return 0;
  } catch (err) {
    stderr.write(`error: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
