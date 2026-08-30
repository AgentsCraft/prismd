# prismd

Local-first LLM gateway aggregating free/low-quota model APIs (OpenRouter, Groq, ...) for coding agents.

Current status: **M0 minimal prototype** — `POST /v1/responses` passthrough (streaming SSE and non-streaming JSON) to whichever provider preset declares the requested model, guarded by a local bearer token.

## Quick start

From source:

```bash
npm install
cp .env.example .env   # set PRISMD_API_KEY and OPENROUTER_API_KEY
npm run dev            # listens on http://127.0.0.1:8787
```

Or install the npm package (RC channel):

```bash
npm install -g @agentscraft/prismd
export PRISMD_API_KEY=<local-token>
export OPENROUTER_API_KEY=<your-key>
prismd                 # listens on http://127.0.0.1:8787
```

Smoke test:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"poolside/laguna-s-2.1:free","input":"say hi","stream":true}'
```

## Codex

Copy `examples/codex/prismd.config.toml` to `~/.codex/prismd.config.toml`, then:

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

Note: M0 has no alias routing; the profile's `model` must match an id in `presets/providers.json`.

## Layout

- `presets/providers.json` — provider list (`name` / `baseUrl` / `apiKeyEnv` / `models`); the gateway never hardcodes a vendor: the request `model` is looked up here, the matching provider is proxied to.
- `src/ingress/` — client protocol entry (Responses only for now).
- `src/egress/` — upstream protocol passthrough (Responses only for now).
- `src/providers/` — per-provider request construction (differences converge here).
- `src/config.ts` — loads the provider list (`PRISMD_CONFIG_PATH` overrides the default).
- `src/auth.ts` — local bearer token check (`PRISMD_API_KEY`); 401 never reaches upstream.

Not implemented yet (later milestones): alias routing, quota, health checks, failover, request timeouts, `prismd status`, SQLite.

## Scripts

- `npm run dev` — tsx watch on `src/server.ts`
- `npm run build` / `npm start` — compile and run from `dist/`
- `npm run typecheck` — `tsc --noEmit`
