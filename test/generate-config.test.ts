import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildConfig,
  deepMerge,
  generate,
  parseEnvFile,
  stableStringify,
  validateConfig,
} from '../scripts/generate-config.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_PATH = join(REPO_ROOT, 'config.schema.json');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'generate-config.mjs');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const FIXTURE_PRESETS = {
  providers: {
    openrouter: {
      type: 'responses',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      extraHeaders: { 'HTTP-Referer': 'https://localhost/prismd', 'X-Title': 'prismd' },
    },
    groq: {
      type: 'responses',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
    },
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
      source: 'https://openrouter.ai/api/v1/models',
      checkedAt: '2026-08-30',
    },
    'llama-3.3-70b-versatile': {
      provider: 'groq',
      contextWindow: 131072,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsReasoning: false,
      limits: { dailyRequests: null, rpm: 30, maxConcurrent: 4 },
      tags: ['free', 'fast'],
      source: 'https://console.groq.com/docs/models',
      checkedAt: '2026-08-30',
    },
  },
  aliases: {
    'free-auto': {
      description: 'auto',
      candidates: ['poolside/laguna-s-2.1:free', 'llama-3.3-70b-versatile'],
    },
    'free-fast': {
      description: 'fast',
      candidates: ['llama-3.3-70b-versatile'],
    },
  },
};

/** Build a temp root dir with presets + schema (+ optional user config / .env). */
function makeRoot({ presets = FIXTURE_PRESETS, user, env } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prismd-config-'));
  mkdirSync(join(dir, 'presets'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'providers.json'), JSON.stringify(presets, null, 2));
  copyFileSync(SCHEMA_PATH, join(dir, 'config.schema.json'));
  if (user !== undefined) {
    writeFileSync(join(dir, 'config.user.json'), JSON.stringify(user, null, 2));
  }
  if (env !== undefined) {
    writeFileSync(join(dir, '.env'), env);
  }
  return dir;
}

/**
 * Assemble .env content from key/value pairs. Concatenation keeps the
 * literal `KEY=value` secret pattern out of the source (gitleaks).
 */
function envWith(...pairs) {
  return `${pairs.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

const ENV_OR = envWith(['OPENROUTER_API_KEY', 'test-key']);

test('deepMerge merges objects recursively and replaces arrays/scalars', () => {
  const base = {
    a: { x: 1, y: 2 },
    b: [1, 2],
    c: 'base',
    d: { deep: { v: 1 } },
  };
  const override = {
    a: { y: 20, z: 30 },
    b: [3],
    c: 'user',
    d: { deep: { w: 2 } },
  };
  const merged = deepMerge(base, override);
  assert.deepEqual(merged, {
    a: { x: 1, y: 20, z: 30 },
    b: [3],
    c: 'user',
    d: { deep: { v: 1, w: 2 } },
  });
  assert.equal(deepMerge(base, undefined), base);
});

test('parseEnvFile parses KEY=value lines, comments and quotes', () => {
  const env = parseEnvFile(
    ['# comment', '', 'FIRST=alpha', 'SECOND="bravo"', 'EMPTY=', 'NO_EQUALS'].join('\n'),
  );
  assert.deepEqual(env, {
    FIRST: 'alpha',
    SECOND: 'bravo',
    EMPTY: '',
  });
});

test('buildConfig expands aliases, applies defaults, drops presets-only fields', () => {
  const warns = [];
  const config = buildConfig({
    presets: FIXTURE_PRESETS,
    userConfig: {},
    env: { OPENROUTER_API_KEY: 'test-key', GROQ_API_KEY: 'test-key' },
    warn: (m) => warns.push(m),
  });
  assert.equal(config.version, 1);
  assert.deepEqual(config.server, { host: '127.0.0.1', port: 8787 });
  assert.deepEqual(config.auth, { localTokenEnv: 'PRISMD_API_KEY' });
  assert.equal(config.policies.maxCandidatesPerRequest, 2);
  assert.deepEqual(config.policies.failoverOn, [
    '401',
    '403',
    '429',
    '500',
    '502',
    '503',
    '504',
  ]);
  assert.deepEqual(Object.keys(config.models), ['free-auto', 'free-fast']);

  const auto = config.models['free-auto'];
  assert.equal(auto.description, 'auto');
  assert.equal(auto.candidates.length, 2);
  const [laguna, groqModel] = auto.candidates;
  assert.equal(laguna.providerModelId, 'poolside/laguna-s-2.1:free');
  assert.equal(laguna.contextWindow, 262144);
  assert.equal('source' in laguna, false);
  assert.equal('checkedAt' in laguna, false);
  assert.equal(groqModel.provider, 'groq');
  assert.equal(groqModel.limits.dailyRequests, null);
  assert.deepEqual(warns, []);
});

test('partial availability skips keyless providers and omits empty aliases', () => {
  const warns = [];
  const config = buildConfig({
    presets: FIXTURE_PRESETS,
    userConfig: {},
    env: { OPENROUTER_API_KEY: 'test-key' },
    warn: (m) => warns.push(m),
  });
  assert.deepEqual(Object.keys(config.models), ['free-auto']);
  const auto = config.models['free-auto'];
  assert.equal(auto.candidates.length, 1);
  assert.equal(auto.candidates[0].providerModelId, 'poolside/laguna-s-2.1:free');
  assert.ok(warns.some((w) => w.includes('GROQ_API_KEY is not set in .env')));
  assert.ok(warns.some((w) => w.includes('omitting alias "free-fast"')));
});

test('user inline candidates deep merge over preset metadata', () => {
  const userConfig = {
    aliases: {
      'free-auto': {
        candidates: [
          'poolside/laguna-s-2.1:free',
          { provider: 'groq', providerModelId: 'llama-3.3-70b-versatile', limits: { rpm: 99 } },
          {
            provider: 'openrouter',
            providerModelId: 'brand-new:free',
            contextWindow: 1024,
            maxOutputTokens: 256,
            supportsTools: false,
            supportsReasoning: false,
            limits: { dailyRequests: null, rpm: 1, maxConcurrent: 1 },
            tags: ['free'],
          },
        ],
      },
    },
  };
  const config = buildConfig({
    presets: FIXTURE_PRESETS,
    userConfig,
    env: { OPENROUTER_API_KEY: 'test-key', GROQ_API_KEY: 'test-key' },
    warn: () => {},
  });
  const candidates = config.models['free-auto'].candidates;
  assert.equal(candidates.length, 3);
  // known model: preset metadata merged, user scalar overrides
  assert.equal(candidates[1].providerModelId, 'llama-3.3-70b-versatile');
  assert.equal(candidates[1].contextWindow, 131072);
  assert.equal(candidates[1].limits.rpm, 99);
  assert.equal(candidates[1].limits.dailyRequests, null);
  // unknown model: inline definition passes through untouched
  assert.deepEqual(candidates[2], userConfig.aliases['free-auto'].candidates[2]);
});

test('generate output is deterministic and byte-identical', () => {
  const dir = makeRoot({ env: ENV_OR });
  const first = generate(dir);
  const second = generate(dir);
  assert.equal(first, second);
  assert.ok(first.endsWith('\n'));
  assert.deepEqual(JSON.parse(first), JSON.parse(second));
});

test('stableStringify sorts object keys recursively', () => {
  const out = stableStringify({ z: 1, a: { y: 2, x: [1, 2] } });
  assert.equal(out, '{\n  "a": {\n    "x": [\n      1,\n      2\n    ],\n    "y": 2\n  },\n  "z": 1\n}\n');
});

test('schema validation failure reports instance paths', () => {
  const userConfig = {
    aliases: {
      bad: { candidates: [{ provider: 'openrouter', providerModelId: 'x:free' }] },
    },
  };
  const config = buildConfig({
    presets: FIXTURE_PRESETS,
    userConfig,
    env: { OPENROUTER_API_KEY: 'test-key' },
    warn: () => {},
  });
  const { valid, errors } = validateConfig(config, schema);
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.instancePath.includes('/models/bad/candidates/0')),
    JSON.stringify(errors),
  );
});

test('generate throws with schema paths on invalid output', () => {
  const dir = makeRoot({
    user: { aliases: { bad: { candidates: [{ provider: 'openrouter', providerModelId: 'x:free' }] } } },
    env: ENV_OR,
  });
  assert.throws(() => generate(dir), /schema validation/);
});

test('CLI writes prismd.json, exits 0, and is idempotent across runs', () => {
  const dir = makeRoot({ env: ENV_OR });
  const first = spawnSync(process.execPath, [SCRIPT_PATH, '--root', dir], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(dir, 'prismd.json')));
  const bytes = readFileSync(join(dir, 'prismd.json'), 'utf8');
  const second = spawnSync(process.execPath, [SCRIPT_PATH, '--root', dir], { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(dir, 'prismd.json'), 'utf8'), bytes);
});

test('CLI exits non-zero with instance path on invalid generated config', () => {
  const dir = makeRoot({
    user: { aliases: { bad: { candidates: [{ provider: 'openrouter', providerModelId: 'x:free' }] } } },
    env: ENV_OR,
  });
  const run = spawnSync(process.execPath, [SCRIPT_PATH, '--root', dir], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes('/models/bad/candidates/0'), run.stderr);
  assert.ok(!existsSync(join(dir, 'prismd.json')));
});

test('CLI without .env warns and generates config with no models', () => {
  const dir = makeRoot();
  const run = spawnSync(process.execPath, [SCRIPT_PATH, '--root', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stderr.includes('.env not found'), run.stderr);
  const config = JSON.parse(readFileSync(join(dir, 'prismd.json'), 'utf8'));
  assert.deepEqual(config.models, {});
  assert.deepEqual(Object.keys(config.providers).sort(), ['groq', 'openrouter']);
});

test('CLI rejects unknown arguments', () => {
  const run = spawnSync(process.execPath, [SCRIPT_PATH, '--nope'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes('unknown argument'));
});
