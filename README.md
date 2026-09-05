# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

**Local-first High-Availability LLM Gateway** aggregating free and low-cost model APIs (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.) and local LLMs (Ollama), providing a stable, unified interface with automatic failover and routing for coding agents (Claude Code, Codex CLI, Cursor, OpenCode, Aider, etc.).

```text
┌────────────────────────────────┐       ┌─────────────────────────────────────┐       ┌─────────────────────────────────────┐
│    Coding Agents (Clients)     │       │        prismd Gateway (Local)       │       │         Model Providers (Upstream)  │
│                                │       │          127.0.0.1:8787             │       │                                     │
│  Claude Code  (Messages API)   ├──────►│  [Protocol Converter]               ├──────►│  Cloud Free APIs                    │
│  Codex CLI    (Responses API)  ├──────►│    • Messages ↔ Responses ↔ Chat    │       │    • OpenRouter / Groq / Cerebras   │
│  Cursor / dsh (Chat API)       ├──────►│  [Smart Router (free-auto)]         │       │    • Google Gemini / NVIDIA NIM     │
│  OpenCode / Pi / Aider         ├──────►│    • Quota-Weighted & Context Check │       │    • GitHub Models / AMD            │
│                                │       │  [Key Pool & Circuit Breaker]       │       │                                     │
│                                │       │    • Multi-Key Round-Robin / 429    │  all  │  Local Offline Fallback             │
│                                │       │    • Zero-Downtime Auto Fallback    ├──────►│    • Ollama (qwen2.5-coder / r1)    │
│                                │       │                                     │  429  │    • LM Studio (local GGUF models)  │
└────────────────────────────────┘       └─────────────────────────────────────┘       └─────────────────────────────────────┘
```

---

## Key Highlights

1. **Unified Model Alias (`free-auto`)**: Connect using a single alias; prismd automatically selects the best available free model.
2. **Multi-Key Pooling & Single-Key Circuit Breaking**: Hit rate limits? Configure multiple keys per provider for automatic round-robin scheduling. When a single key hits 429, only that key is cooled down while traffic seamlessly shifts to the next key.
3. **Local Ollama Zero-Downtime Fallback**: When cloud free models hit 429 or internet drops, requests automatically fall back to local Ollama (`qwen2.5-coder:7b` / `deepseek-r1:8b`), ensuring coding agent tasks never crash.
4. **Transparent Multi-Protocol Conversion**: Full bi-directional streaming conversion across Claude Code (Messages), Codex (Responses), and Cursor/OpenCode (Chat Completions).
5. **Embedded Web Dashboard & Hot Reloading**: Open `http://127.0.0.1:8787/ui` to monitor live candidate health and quota progress bars. Update configurations dynamically via `SIGHUP` without restarting.

---

## Support

If prismd saves you time or API costs, consider buying the author a coffee:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3-Step Quick Start

### Step 1: Install and Start Gateway

```bash
# Option A: Global npm install
npm install -g @prismd/prismd              # Stable release
# Or install RC preview channel (aligned with latest develop):
npm install -g @agentscraft/prismd         # RC channel

# Option B: Run from source
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### Step 2: Configure API Keys

Add your free API keys in `~/.prismd/keys.yaml` or `./.env` (configure one or more; unconfigured providers are automatically skipped):

```yaml
# ~/.prismd/keys.yaml (recommended chmod 600)
prismd: "my-local-secret"       # Local protection token (used by clients)

# Cloud Providers (supports single key or multi-key pool for round-robin):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Multi-key pooling & cooldown isolation
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models personal token
amd: "amd_token_xxxx"           # Optional: AMD Developer Cloud

# Local Offline Fallback:
# ollama: zero-config (automatically routes to http://127.0.0.1:11434/v1 without key)
```

Start the gateway:
```bash
prismd
# Or from source: npm run generate:config && npm run dev
```

> 📖 **Provider Setup Guides**: See [Model Provider Integration Guides](docs/providers/README.md) for detailed key generation and model lists for [OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), and [LM Studio](docs/providers/lmstudio.md).

### Step 3: Configure Your Agent

| Client | Quick Setup | Guide |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="my-local-secret"`<br>`claude` | [Guide](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=my-local-secret codex --profile prismd` | [Guide](examples/codex/README.md) |
| **Cursor** | Settings → Models → Enable OpenAI API Key (`my-local-secret`)<br>Override OpenAI Base URL: `http://127.0.0.1:8787/v1`<br>Add model: `free-auto` | [Guide](examples/cursor/README.md) |
| **OpenCode** | Set `baseUrl: "http://127.0.0.1:8787/v1"` in `~/.config/opencode/config.json` | [Guide](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | Set `base_url = "http://127.0.0.1:8787/v1"` in `~/.dsh/config.toml`<br>`PRISMD_API_KEY=my-local-secret dsh --model prismd:free-auto` | [Guide](examples/dsh/README.md) |
| **Pi Agent** | Set `endpoint: "http://127.0.0.1:8787/v1"` in `~/.pi/config.json`<br>`pi run` | [Guide](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="my-local-secret"` `aider --model openai/free-auto` | [Guide](examples/aider/README.md) |

> 📖 **Full documentation**: See [Client Integration Guide](docs/clients/README.md) for detailed protocol breakdowns and advanced setups.

---

## Features In Depth

### 1. Smart Routing & Automated Failover

prismd dynamically selects the optimal model candidate per request using an intelligent evaluation pipeline:

- **Context Window Verification**: Estimates input tokens before dispatch; automatically filters out candidates whose context window is too small, preventing 400 Context Overflow errors.
- **Quota-Weighted Soft Limits**: When a cloud candidate reaches 80% of its daily quota (`quotaSoftLimitRatio`), it is automatically demoted to the tail of the queue, reserving remaining quota for peak requirements.
- **Zero-Crash Failover**: If an upstream provider returns a 429 rate limit or 5xx outage, prismd transparently fails over to the next healthy candidate in the alias queue without failing the client's session.
- **Default Alias**: `free-auto`: the single unified free queue. Prioritizes Gemini 2.0 Flash / Llama 3.3 70B, with automatic fallback to local Ollama `qwen2.5-coder:7b`.

### 2. Multi-Key Pooling & Single-Key Circuit Breaking (Key Pool)

All cloud providers (Groq, Cerebras, Google Gemini, OpenRouter, NVIDIA NIM, GitHub Models, etc.) support multi-key configurations for automatic round-robin request distribution and single-key fault isolation:

- **`~/.prismd/keys.yaml` format** (YAML list or inline array):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **`.env` or Environment Variables** (comma-separated):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **How it works**: Requests are distributed across healthy keys via Round-Robin. When a key (e.g. `gsk_key1`) receives a 429 rate limit error, only that key enters cooldown (respecting `Retry-After`), while subsequent requests immediately shift to the next available key (`gsk_key2`) or candidate model, multiplying throughput without failing requests.

### 3. Local LLM Zero-Downtime Fallback (Ollama & LM Studio)

When cloud APIs are exhausted or internet connectivity drops, prismd automatically routes traffic to local inference backends:

- **Ollama**: Built-in zero-config provider (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: Supports local OpenAI-compatible server (`http://127.0.0.1:1234/v1`) running GGUF models. See [LM Studio Guide](docs/providers/lmstudio.md).
- Requests fall back silently to local models so coding agent tasks never crash midway.

### 4. Transparent Multi-Protocol Bridge

Full bi-directional streaming conversion across three major agent wire protocols:
- **Anthropic Messages** (`POST /v1/messages`): Full support for Claude Code (tools, thinking blocks, SSE streams).
- **OpenAI Responses** (`POST /v1/responses`): Compatible with Codex CLI and DeepSeek Harness (`dsh`).
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): Standard interface for Cursor, OpenCode, Pi Agent, and Aider.

### 5. Extensible Configuration (`config.user.json`)

Customize providers, register private models, or define custom model queues in `config.user.json`:

```jsonc
{
  "models": {
    "my-custom-model": {
      "provider": "openrouter",
      "contextWindow": 131072,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 100, "rpm": 20, "maxConcurrent": 2 }
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": ["my-custom-model", "gemini-2.0-flash", "qwen2.5-coder:7b"]
    }
  }
}
```
Re-compile configuration with `prismd generate` (or `npm run generate:config` in source mode).

### 6. Dynamic Config Hot Reloading (`SIGHUP`)

Update routing tables, keys, or aliases without restarting the process or interrupting active streaming connections:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## Status & Observability

- **Web Dashboard**: Open `http://127.0.0.1:8787/ui` in your browser:
  - Real-time candidate health (`healthy` / `rate_limited` / `cooldown`)
  - Daily quota progress bars and token usage statistics
  - 10-language UI selector and "Reset usage" button
- **CLI Status & Commands**:
  ```bash
  prismd status      # Display metrics table in terminal
  prismd generate    # Recompile ~/.prismd/prismd.json
  ```

---

## Troubleshooting

- **Q: `missing API key for provider` error?**
  - Verify keys in `~/.prismd/keys.yaml` or `.env`, then run `prismd generate` (or `npm run generate:config` in source mode).
- **Q: Frequent 429s on free models?**
  - Add multiple keys for the provider, or launch `ollama run qwen2.5-coder:7b` for local offline fallback.
- **Q: Reset daily quota counters?**
  - Click "Reset usage" in the Web Dashboard (`http://127.0.0.1:8787/ui`) or delete `data/prismd.sqlite`.
