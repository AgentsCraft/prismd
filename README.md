# prismd

Local-first LLM gateway aggregating free/low-quota model APIs (OpenRouter, Groq, ...) for coding agents. One local endpoint, one alias (`free-auto`), and prismd handles the rest: pick a working candidate, avoid exhausted quotas, fail over when an upstream 429s, and tell you what happened.

## Support

If prismd saves you time or quota, consider buying the author a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/keanz21)

## What it does (current status: M2a)

| Capability | Behavior |
| --- | --- |
| **Alias routing** | `POST /v1/responses` with `"model": "free-auto"` resolves to an ordered candidate list from your config |
| **Candidate filtering** | Hard-excludes candidates that ran out of daily quota, whose context window is too small for the input, or that are unhealthy; then soft-demotes candidates at ≥ 80% daily quota to the back of the queue |
| **Failover** | On 401/403/429/5xx/connection errors/connect timeouts *before the stream starts*, tries the next candidate (up to `maxCandidatesPerRequest`); request-class 4xx (400/404/422) pass through unchanged; after the stream starts it never retries |
| **Quota accounting** | Counts requests and tokens (real usage when the upstream reports it, chars/4 estimate otherwise) into a local SQLite store; survives restarts |
| **Passive health checks** | 3 consecutive failures → cooldown 60s → half-open single probe; 401/403 flagged separately |
| **Timeouts** | Connect timeout (default 10s) and stream idle timeout (default 300s), per-policy configurable |
| **Key management** | Keys live in `~/.prismd/` (`.env` or `keys.yaml`), never in the repo or the generated config; lookup: OS env > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **Observability** | pino JSON logs on stderr with a per-request id and one summary line per request; secrets redacted |

## Quick start

From source:

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # fill in your keys, then chmod 600
npm run generate:config                    # merges presets + config.user.json + keys → prismd.json
npm run dev                                # listens on http://127.0.0.1:8787
```

Or install the RC channel package:

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<your-key>
export PRISMD_API_KEY=<local-token>        # generate: openssl rand -hex 32
prismd                                     # listens on http://127.0.0.1:8787
```

The runtime reads exactly one file: `prismd.json` (override the path with `PRISMD_CONFIG_PATH`). From the installed package, generate it with `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`.

Smoke test:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## Keys

prismd reads API keys from **one** place: the `~/.prismd/` directory. Keys never go in the repo, in `prismd.json`, or in git. Lookup priority (highest wins):

| Field | OS env var | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `prismd` (local token) | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- The env var name for a field is the field name uppercased plus `_API_KEY`.
- Both file formats are optional and can coexist; `.env` is `KEY=value` lines, `keys.yaml` is flat `field: value` lines. Examples ship in `.env.example` / `keys.yaml.example`.
- `chmod 600` both files. prismd warns at startup if they are world-readable.
- Keys are read once at startup; change them and restart.
- The local bearer token (`prismd` field) protects `POST /v1/responses`; every request must send `Authorization: Bearer <token>`. A wrong or missing token gets 401 and never reaches the upstream.

## Configuration

`prismd.json` is generated, not hand-written. The generator merges three layers:

| Layer | File | Purpose |
| --- | --- | --- |
| Presets | `presets/providers.json` | Built-in providers, free-model metadata (context window, limits, tags) with source + checked-at provenance, and default aliases. Never read at runtime. |
| User overrides | `config.user.json` | Your changes on top of presets: alias order, custom candidates, policies, server settings. No keys here. |
| Keys | `~/.prismd/` | Only presence matters to the generator: candidates whose provider has no key are skipped. |

Run `npm run generate:config` after changing any layer. The output is schema-validated and byte-stable (same inputs → same file).

Common overrides in `config.user.json`:

```jsonc
{
  "aliases": {
    "free-auto": {
      // reorder candidates: this one is tried first
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // try up to 3 candidates per request
    "connectTimeoutMs": 5000          // tighter connect timeout
  }
}
```

Candidates can also be defined inline (e.g. a model not in presets):

```jsonc
{
  "aliases": {
    "free-code": {
      "candidates": [
        {
          "provider": "openrouter",
          "providerModelId": "some/model:free",
          "contextWindow": 131072,
          "maxOutputTokens": 8192,
          "supportsTools": true,
          "supportsReasoning": false,
          "limits": { "dailyRequests": 50, "rpm": 20, "maxConcurrent": 2 },
          "tags": ["free", "code"]
        }
      ]
    }
  }
}
```

Adding a new provider requires code support (a request builder in `src/providers/` + registration in `src/egress/responses.ts`); a provider that exists in `prismd.json` without one will error.

## Routing: how a request picks a candidate

1. The alias is resolved to its ordered candidate list (exactly the order in `prismd.json`).
2. **Hard excludes**: candidates with daily quota exhausted (`limits.dailyRequests`), with `contextWindow` smaller than the estimated input (request body chars ÷ 4), or currently unhealthy/cooldown are removed.
3. **Soft demotion**: remaining candidates at ≥ 80% daily quota (`quotaSoftLimitRatio`) move to the back of the list.
4. The first remaining candidate gets the request; on failure the failover tree moves to the next.

Errors the gateway itself returns (OpenAI-style `{"error": {...}}` body):

| Scenario | Status | Code | Notes |
| --- | --- | --- | --- |
| Missing/wrong bearer token | 401 | `invalid_api_key` | Upstream never contacted |
| Unknown alias | 404 | `model_not_found` | |
| All candidates exhausted/unhealthy | 429 | `quota_exceeded` | `error.metadata` lists each candidate and why it was filtered |
| Input larger than every candidate's window | 422 | `context_window_exceeded` | `error.metadata` lists each candidate's window |
| All tried candidates failed | 502 | `gateway_all_candidates_failed` | `error.metadata` lists each attempt's upstream status |
| Internal error | 500 | `gateway_internal_error` | |

## Failover

- **Triggers** (before the stream starts): connection failure, connect timeout, and upstream 401, 403, 429, 5xx. The failing candidate is recorded (health counter +1) and the next candidate is tried, up to `maxCandidatesPerRequest`.
- **Not a trigger**: 400/404/422 and other request-class 4xx — the request itself is the problem, so it passes through unchanged (re-trying it against every candidate would just multiply quota burn).
- **After the stream starts**: never retried. A mid-stream break or stream-idle timeout ends the stream with an SSE `error` event.
- When a 429 carries `Retry-After` and `respectRetryAfter` is on, the candidate's cooldown becomes `max(cooldownMs, Retry-After)`.

## Quota & usage

Usage is counted in memory and flushed to SQLite (`data/prismd.sqlite`, WAL mode) every 5s or 20 records, whichever comes first, and force-flushed on shutdown (SIGINT/SIGTERM; in-flight streams get up to 30s).

| Table | Content |
| --- | --- |
| `usage_daily` | Per-day aggregates (date, provider, model, requests, tokens) — the data source for quota routing. Seed at startup, so limits survive restarts. |
| `request_log` | One row per request (id, alias, provider, model, status, tokens, failover flag, duration). Kept for 14 days, pruned at startup. |

- Tokens: real values when the upstream reports usage, otherwise a conservative estimate (input = request chars ÷ 4, output = streamed chars ÷ 4). The `source` column marks `real` / `estimated` / `mixed`.
- Quota is a **routing weight, never a hard block on you**: if a preset's quota number is wrong or stale, the worst case is suboptimal ordering or an upstream 429, which failover handles.
- `data/` is created `0700`, the database `0600`, and is gitignored. Delete `data/prismd.sqlite` to reset counters.

## Health checks

Passive only — prismd never probes upstreams on its own (free quota is too precious). Per `(provider, model)` candidate, in memory (reset on restart):

```
healthy → (3 consecutive failures) → cooldown 60s → half-open (1 probe request)
              ↑                                  success → healthy
              └────────────────────────── failure → cooldown again
```

- 401/403 are recorded separately (`lastError`) so authentication problems stand out in logs.
- Configure the thresholds via `policies.failThreshold` / `policies.cooldownMs`.

## Policies reference

All `policies` fields (defaults shown), overridable in `config.user.json`:

| Field | Default | Meaning |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | Upstream statuses that trigger failover |
| `retryBeforeStream` | `true` | Retry other candidates before the stream starts |
| `retryAfterStream` | `false` | Never retry once streaming began |
| `maxCandidatesPerRequest` | `2` | Max candidates tried per request |
| `respectRetryAfter` | `true` | Honor upstream `Retry-After` in cooldown |
| `quotaSoftLimitRatio` | `0.8` | Daily-quota ratio that triggers soft demotion |
| `connectTimeoutMs` | `10000` | Connect timeout before the stream starts |
| `streamIdleTimeoutMs` | `300000` | Max gap between stream chunks before ending with an SSE error |
| `failThreshold` | `3` | Consecutive failures before a candidate enters cooldown |
| `cooldownMs` | `60000` | Cooldown duration |

## Codex

1. Copy the example profile and point it at your catalog:

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. Run:

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

- The profile's `model` is the gateway alias `free-auto`; `model_catalog_json` gives Codex real metadata (context window etc.) so it stops warning about unknown models. The catalog has one entry per alias with the **minimum** context window across its candidates — a conservative value so a small-window candidate never overflows.
- Keep Codex retries low: `request_max_retries = 0` (let the gateway do failover — it knows candidate health and quota) and `stream_max_retries = 1` (stream reconnects; the gateway never retries mid-stream, so the two layers don't stack).

## Observability

- **Structured logs**: pino JSON on stderr — one line per event, safe to pipe anywhere.
- **Request id**: every request gets a UUID, carried in logs and error responses (`x-request-id`), so one request's events chain together.
- **Summary line**: one `request_end` log per request with method, path, alias, selected candidate, upstream status, first-token latency, total duration and usage.
- **Redaction**: `authorization` / `api-key` / `api_key` / `token` values are replaced with `****` before logging. Never log raw request objects.
- `request_start` / `first_token` / `request_end` events implement an exporter interface (`src/observability/exporter.ts`); today the only exporter is stderr JSON, later ones (OTLP etc.) plug in without touching the request path.

## Troubleshooting

**Everything 429s.** OpenRouter `:free` models share a congested pool; 429s come and go even with a healthy account. prismd handles them by failing over to the next candidate — check the gateway log for `failovers: 1` on `request_end`. If all candidates are 429ing, reorder `free-auto` in `config.user.json` to put a less congested model first and regenerate.

**Codex says `Model metadata for free-auto not found`.** Run `npm run generate:codex-catalog` and make sure `model_catalog_json` points at `~/.codex/prismd-models.json` in the profile. (It's a warning, not a blocker.)

**After upgrading, candidates disappeared.** The config format changed in M2 (provider keys moved from `apiKeyEnv` to `apiKeyField`). Re-run `npm run generate:config`; keys themselves live in `~/.prismd/` and need no migration.

**Gateway won't start / 500 errors.** `prismd.json` is schema-validated at startup with precise error paths. Custom providers in `config.user.json` need a matching request builder in `src/providers/`; otherwise the gateway errors when it tries to use them.

**Reset usage counters.** Stop the gateway and delete `data/prismd.sqlite`.

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
- `src/keys.ts` — key resolution from env / `~/.prismd/.env` / `~/.prismd/keys.yaml`.
- `src/auth.ts` — local bearer token check (`auth.localTokenField`); 401 never reaches upstream.

## Scripts

- `npm run dev` — tsx watch on `src/server.ts`
- `npm run build` / `npm start` — compile and run from `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — unit/integration tests (tsx + node:test)
- `npm run test:e2e` — black-box acceptance journeys against a mock upstream
- `npm run generate:config` — regenerate `prismd.json` from presets + `config.user.json` + `~/.prismd/` keys
- `npm run generate:codex-catalog` — regenerate `~/.codex/prismd-models.json`
