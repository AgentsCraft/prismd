import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCatalog, generateCatalog } from '../scripts/generate-codex-catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'generate-codex-catalog.mjs');

const FIXTURE_PRESETS = {
  providers: {
    openrouter: { type: 'responses', baseUrl: 'https://openrouter.ai/api/v1', apiKeyField: 'openrouter' },
    groq: { type: 'responses', baseUrl: 'https://api.groq.com/openai/v1', apiKeyField: 'groq' },
  },
  models: {
    'poolside/laguna-s-2.1:free': {
      provider: 'openrouter',
      contextWindow: 262144,
      maxOutputTokens: 32768,
      supportsTools: true,
      supportsReasoning: true,
      limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
      tags: ['free'],
    },
    'cohere/north-mini-code:free': {
      provider: 'openrouter',
      contextWindow: 256000,
      maxOutputTokens: 64000,
      supportsTools: true,
      supportsReasoning: true,
      limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
      tags: ['free', 'code'],
    },
  },
  aliases: {
    'free-auto': {
      description: 'auto',
      candidates: ['poolside/laguna-s-2.1:free', 'cohere/north-mini-code:free'],
    },
    'free-fast': { candidates: ['cohere/north-mini-code:free'] },
  },
};

/** A realistic codex models.json template entry (field set verified against codex 0.150.1). */
const TEMPLATE = {
  slug: 'existing-model',
  display_name: 'Existing Model',
  description: 'a real model',
  context_window: 262144,
  max_context_window: 262144,
  supported_reasoning_levels: [{ effort: 'low', description: 'low reasoning' }],
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
  priority: 42,
  support_verbosity: true,
  truncation_policy: { mode: 'tokens', limit: 10000 },
  experimental_supported_tools: [],
  base_instructions: 'existing instructions',
};

function makeRoot({ presets = FIXTURE_PRESETS, user } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prismd-catalog-'));
  mkdirSync(join(dir, 'presets'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'providers.json'), JSON.stringify(presets, null, 2));
  if (user !== undefined) writeFileSync(join(dir, 'config.user.json'), JSON.stringify(user, null, 2));
  return dir;
}

test('buildCatalog emits one entry per alias with slug/display_name set to the alias', () => {
  const { models } = buildCatalog({ presets: FIXTURE_PRESETS, template: TEMPLATE });
  assert.deepEqual(
    models.map((m) => m.slug),
    ['free-auto', 'free-fast'],
  );
  assert.deepEqual(
    models.map((m) => m.display_name),
    ['free-auto', 'free-fast'],
  );
});

test('context_window and max_context_window are the minimum over candidates', () => {
  const { models } = buildCatalog({ presets: FIXTURE_PRESETS, template: TEMPLATE });
  assert.equal(models[0].context_window, 256000); // min(262144, 256000)
  assert.equal(models[0].max_context_window, 256000);
  assert.equal(models[1].context_window, 256000);
});

test('priority increments with catalog order', () => {
  const { models } = buildCatalog({ presets: FIXTURE_PRESETS, template: TEMPLATE });
  assert.deepEqual(
    models.map((m) => m.priority),
    [1, 2],
  );
});

test('entries clone the full template field structure (supported_reasoning_levels present)', () => {
  const { models } = buildCatalog({ presets: FIXTURE_PRESETS, template: TEMPLATE });
  for (const entry of models) {
    assert.ok(Array.isArray(entry.supported_reasoning_levels), 'M0 pitfall: field is required by codex');
    assert.equal(entry.shell_type, 'shell_command');
    assert.equal(entry.truncation_policy.mode, 'tokens');
    assert.equal(typeof entry.slug, 'string');
  }
});

test('user alias overrides merge over presets and drive the window minimum', () => {
  const presets = structuredClone(FIXTURE_PRESETS);
  const user = {
    aliases: {
      'free-auto': { candidates: ['cohere/north-mini-code:free'] },
      'user-alias': {
        candidates: [
          'poolside/laguna-s-2.1:free',
          { provider: 'openrouter', providerModelId: 'tiny:free', contextWindow: 4096, maxOutputTokens: 100, supportsTools: false, supportsReasoning: false, limits: { dailyRequests: 5, rpm: 1, maxConcurrent: 1 }, tags: [] },
        ],
      },
    },
  };
  const { models } = buildCatalog({ presets, userConfig: user, template: TEMPLATE });
  assert.deepEqual(
    models.map((m) => m.slug),
    ['free-auto', 'free-fast', 'user-alias'], // user aliases merge over presets
  );
  assert.equal(models[0].context_window, 256000); // override: single candidate
  assert.equal(models[2].context_window, 4096); // min(262144, 4096)
});

test('aliases with no resolvable candidates are skipped with a warning', () => {
  const presets = structuredClone(FIXTURE_PRESETS);
  presets.aliases.broken = { candidates: ['no-such-model'] };
  const warnings = [];
  const { models } = buildCatalog({ presets, template: TEMPLATE, warn: (w) => warnings.push(w) });
  assert.ok(!models.some((m) => m.slug === 'broken'));
  assert.ok(warnings.some((w) => w.includes('no-such-model')));
});

test('generateCatalog clones the local codex catalog when present', () => {
  const root = makeRoot();
  const modelsPath = join(root, 'models.json');
  writeFileSync(modelsPath, JSON.stringify({ models: [TEMPLATE] }));
  const catalog = generateCatalog(root, { modelsPath });
  const entry = catalog.models[0];
  assert.equal(entry.slug, 'free-auto');
  assert.equal(entry.base_instructions, 'existing instructions'); // cloned, not builtin
});

test('generateCatalog falls back to the built-in template when no local catalog exists', () => {
  const root = makeRoot();
  const catalog = generateCatalog(root, { modelsPath: join(root, 'missing.json') });
  const entry = catalog.models[0];
  assert.ok(Array.isArray(entry.supported_reasoning_levels));
  assert.equal(typeof entry.shell_type, 'string');
});

test('CLI writes the catalog to --out and exits 0', () => {
  const root = makeRoot();
  const outPath = join(root, 'prismd-models.json');
  const run = spawnSync(process.execPath, [SCRIPT_PATH, '--root', root, '--out', outPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(outPath));
  const catalog = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.deepEqual(
    catalog.models.map((m) => m.slug),
    ['free-auto', 'free-fast'],
  );
  rmSync(root, { recursive: true, force: true });
});
