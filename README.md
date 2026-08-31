# prismd

Local-first LLM gateway aggregating free/low-quota model APIs (OpenRouter, Groq, ...) for coding agents.

## Support

If prismd saves you time or quota, consider buying the author a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/keanz21)

Current status: **M2a** — `POST /v1/responses` routes a model alias through health checks, daily-quota limits and context-window checks, then fails over across candidates on 401/403/429/5xx/connection errors (before the stream starts). Usage is accounted to a local SQLite store, keys resolve from env vars > `~/.prismd/.env` > `~/.prismd/keys.yaml`, and structured logs carry a per-request id.

## Quick start

From source:

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # add OPENROUTER_API_KEY-style fields (chmod 600)
# local gateway token: openssl rand -hex 32, set under the prismd field
npm run generate:config   # merges presets + config.user.json + keys into prismd.json
npm run dev               # listens on http://127.0.0.1:8787
```

API keys live in `~/.prismd/` (`.env` or `keys.yaml`), never in the repo. Lookup order: OS environment variable (`OPENROUTER_API_KEY`) > `~/.prismd/.env` > `~/.prismd/keys.yaml`. See `.env.example` / `keys.yaml.example`.

Or install the npm package (RC channel):

```bash
npm install -g @agentscraft/prismd
export PRISMD_API_KEY=<local-token>
export OPENROUTER_API_KEY=<your-key>
prismd                     # listens on http://127.0.0.1:8787
```

Note: the runtime only reads `prismd.json` (override with `PRISMD_CONFIG_PATH`, default `./prismd.json`). Generate it from the installed package with `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>` or from the source checkout as above.

Smoke test:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## Codex

Copy `examples/codex/prismd.config.toml` to `~/.codex/prismd.config.toml`, then:

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

The profile's `model` is the gateway alias `free-auto` (see `presets/providers.json`); the gateway maps it to an upstream provider/model from `prismd.json` in the current working directory.

## Layout

- `prismd.json` — the single runtime config (generated, not committed); read once at startup.
- `presets/providers.json` — built-in provider and free-model defaults plus default aliases, with source/checkedAt provenance; never read at runtime.
- `config.user.json` — optional user overrides (aliases, policies, server); merged by the generator.
- `config.schema.json` — JSON Schema (draft-07) validating `prismd.json`.
- `scripts/generate-config.mjs` — merges presets + user overrides + `~/.prismd/` keys into a schema-validated, byte-stable `prismd.json`.
- `scripts/generate-codex-catalog.mjs` — generates `~/.codex/prismd-models.json` (Codex `model_catalog_json`) from the same metadata, one entry per alias.
- `src/ingress/` — client protocol entry (Responses only for now).
- `src/egress/` — upstream protocol passthrough (Responses only for now).
- `src/providers/` — per-provider request construction (base URL, extra headers).
- `src/core/` — alias routing (quota/window/health filtering, soft demotion), passive health state machine, quota accounting, SQLite state store.
- `src/observability/` — pino structured logging (stderr JSON), request-id, exporter interface.
- `src/config.ts` — loads/validates `prismd.json` (ajv + loopback host check) and resolves keys from `~/.prismd/`.
- `src/auth.ts` — local bearer token check (`auth.localTokenField`); 401 never reaches upstream.

## Scripts

- `npm run dev` — tsx watch on `src/server.ts`
- `npm run build` / `npm start` — compile and run from `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — unit/integration tests (tsx + node:test)
- `npm run generate:config` — regenerate `prismd.json` from presets + `config.user.json` + `~/.prismd/` keys
- `npm run generate:codex-catalog` — regenerate `~/.codex/prismd-models.json`
