# prismd

Local-first LLM gateway aggregating free/low-quota model APIs (OpenRouter, Groq, ...) for coding agents.

## Support

If prismd saves you time or quota, consider buying the author a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/keanz21)

Current status: **M1** — generated runtime config (`prismd.json`) with model alias routing. `POST /v1/responses` resolves an alias such as `free-auto` to its first candidate and passes the request through (streaming SSE and non-streaming JSON), guarded by a local bearer token.

## Quick start

From source:

```bash
npm install
cp .env.example .env      # set PRISMD_API_KEY (openssl rand -hex 32) and OPENROUTER_API_KEY
npm run generate:config   # merges presets + config.user.json + .env into prismd.json
npm run dev               # listens on http://127.0.0.1:8787
```

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
- `scripts/generate-config.mjs` — merges presets + user overrides + `.env` into a schema-validated, byte-stable `prismd.json`.
- `src/ingress/` — client protocol entry (Responses only for now).
- `src/egress/` — upstream protocol passthrough (Responses only for now).
- `src/providers/` — per-provider request construction (base URL, extra headers).
- `src/core/router.ts` — alias → ordered candidates resolution (M1 picks the first; filtering is M2).
- `src/config.ts` — loads/validates `prismd.json` (ajv + loopback host check).
- `src/auth.ts` — local bearer token check (`auth.localTokenEnv`, default `PRISMD_API_KEY`); 401 never reaches upstream.

Not implemented yet (M2): failover, quota/limits, request timeouts, context-window checks, `/healthz`, `prismd status`, SQLite, pino logging.

## Scripts

- `npm run dev` — tsx watch on `src/server.ts`
- `npm run build` / `npm start` — compile and run from `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — unit/integration tests (tsx + node:test)
- `npm run generate:config` — regenerate `prismd.json` from presets + `config.user.json` + `.env`
