# prismd

[English](README.md) | [简体中文](README_CN.md)

Local-first LLM gateway aggregating free and low-cost model APIs (OpenRouter, Groq, Cerebras, etc.) for coding agents (Claude Code, Codex CLI, OpenCode, and others), providing a stable, unified interface with automatic routing and failover.

With a single local endpoint and a unified alias (`free-auto`), prismd automatically handles:
- **Smart Routing & Quota Protection**: Automatically picks available candidates based on context window and daily quota usage; soft-demotes candidates at ≥ 80% quota to the back of the queue.
- **Seamless Failover**: Before streaming starts, automatically fails over to the next candidate on 429/401/5xx errors or network timeouts.
- **Multi-Protocol Conversion**: Native support for OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages protocols, allowing any coding agent to connect seamlessly.

---

## Quick Start

### Option 1: Global Install via npm (Recommended)

```bash
# Install stable release
npm install -g @prismd/prismd

# Or RC preview channel
# npm install -g @agentscraft/prismd

# Configure provider keys and local gateway token
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Local auth token, e.g. openssl rand -hex 32

# Start the gateway (listens on 127.0.0.1:8787)
prismd
```

### Option 2: Run from Source

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # Fill in API keys, chmod 600
npm run generate:config                    # Merge presets and keys to generate prismd.json
npm run dev                                # Start development server
```

### Smoke Test

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## Client Setup

All client agents point to the local gateway endpoint and use the same local protection token (`PRISMD_API_KEY`).

### 1. Claude Code
Claude Code natively supports custom Anthropic endpoints via environment variables. Standard model names (`claude-*-sonnet`, etc.) automatically fall back to configured gateway aliases:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Copy the example profile and generate the model metadata catalog:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # Generates ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. OpenCode / OpenAI-Compatible Clients
In your client configuration (e.g. `~/.config/opencode/config.json`), configure an OpenAI-compatible provider:
- **Base URL**: `http://127.0.0.1:8787/v1`
- **API Key**: `<your-prismd-local-token>`
- **Model**: `free-auto` (or `free-fast`, `free-code`)

---

## Keys & Configuration

### Key Management
Keys can be configured in the project root `.env` or in the global `~/.prismd/` directory. Lookup order (highest to lowest):
1. **Environment Variables**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, etc.
2. **Current Project Directory**: `./.env` (copy from `.env.example`)
3. **Global User Directory**: `~/.prismd/.env` or `~/.prismd/keys.yaml` (recommended permission: `chmod 600`)

### Customizing Candidates & Ordering
Override candidate priorities or add custom models in `config.user.json`, then regenerate the config:
```jsonc
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,
    "connectTimeoutMs": 5000
  }
}
```
Run `npm run generate:config` (or `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) to apply changes.

For detailed setup instructions for major free providers (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.), see the [Provider Configuration Guides](docs/providers/README.md).

---

## Status & Observability

- **Web Dashboard**: Open `http://127.0.0.1:8787/ui` in your browser for candidate health status, daily quota progress bars, token usage, and live SSE event stream.
- **CLI Status**: Run `prismd status` (or `npm run status`) to view colorized metrics tables directly in the terminal.
- **Structured Logs**: JSON logs emitted to stderr with automatic secret redaction and unique `request-id` tracking.

---

## How It Works & Limitations

1. **Routing & Filtering**:
   - Tries candidates in configured order;
   - Hard-excludes candidates that exhausted quota, have insufficient context window, or are in cooldown;
   - Soft-demotes candidates at ≥ 80% daily quota to the back of the queue.
2. **Failover Boundaries**:
   - **Before stream starts**: On 401/403/429/5xx or connect timeout, tries next candidate up to `maxCandidatesPerRequest`.
   - **After stream starts**: Never retries mid-stream (to avoid garbled outputs), cleanly terminating with an SSE error event.
3. **Free Pool Limitations**:
   - Public free models share upstream concurrency pools and can experience frequent 429s during peak hours. prismd routes around them, but if all configured candidates are exhausted, it returns a 429 with candidate status details in `error.metadata`.

---

## Troubleshooting

- **Frequent 429s**: Free model pools are congested. Reorder `free-auto` in `config.user.json` to prioritize less congested models, or add additional provider API keys.
- **Candidates disappeared after upgrade**: Older versions used different config key fields. Run `npm run generate:config` to refresh `prismd.json`.
- **Reset quota counters**: Stop the gateway and delete `data/prismd.sqlite`.
