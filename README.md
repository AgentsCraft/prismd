# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**Local-first high-availability LLM gateway** for coding agents. prismd combines free and low-cost model APIs with optional local models, then exposes one local endpoint with routing, quota-aware selection, multi-key rotation, and automatic failover.

```text
Coding agents
  Claude Code | Codex CLI | Cursor | OpenCode | dsh | Pi | Aider
                              |
                              v
                    http://127.0.0.1:8787
                              |
                              v
Cloud providers and local models
  OpenRouter | Groq | Cerebras | Gemini | NVIDIA NIM | GitHub Models | AMD
  Ollama | LM Studio
```

## Quick Start

### 1. Install

Global npm install:

```bash
npm install -g @prismd/prismd
```

Preview channel:

```bash
npm install -g @agentscraft/prismd
```

Run from source:

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

Node.js `22.13.0` or newer is required.

### 2. Initialize

Global install:

```bash
prismd init
```

Source install:

```bash
node dist/server.js init
```

The wizard:

1. Creates or updates `~/.prismd/keys.yaml`.
2. Prompts for the model providers you want to enable.
3. Writes `~/.prismd/prismd.json`.
4. Optionally configures Claude Code, Codex CLI, OpenCode, and Pi Agent.
5. Prints the generated local token. Use that token when connecting other clients.

The local token is random by default. Existing client configuration files are backed up before modification.

For manual setup, create `~/.prismd/keys.yaml`:

```yaml
prismd: "YOUR_PRISMD_TOKEN"

openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"
```

Use `PRISMD_HOME` to override the default `~/.prismd` directory.

### 3. Start

Global install:

```bash
prismd
```

Source install:

```bash
node dist/server.js
```

The gateway listens on `http://127.0.0.1:8787`.

### 4. Connect a Client

| Client | Command or setting | Guide |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1`<br>`ANTHROPIC_API_KEY=YOUR_PRISMD_TOKEN` | [Guide](examples/claude-code/README.md) |
| Codex CLI | `PRISMD_API_KEY=YOUR_PRISMD_TOKEN codex --profile prismd` | [Guide](examples/codex/README.md) |
| OpenCode | OpenAI-compatible provider pointing to `http://127.0.0.1:8787/v1`<br>Model: `free-auto` | [Guide](examples/opencode/README.md) |
| Pi Agent | `~/.pi/config.json` with endpoint `http://127.0.0.1:8787/v1`<br>Model: `free-auto` | [Guide](examples/pi/README.md) |
| Cursor | Enable OpenAI API Key and override the base URL with `http://127.0.0.1:8787/v1`<br>Model: `free-auto` | [Guide](examples/cursor/README.md) |
| DeepSeek Harness (dsh) | `PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [Guide](examples/dsh/README.md) |
| Aider | `OPENAI_API_BASE=http://127.0.0.1:8787/v1`<br>`OPENAI_API_KEY=YOUR_PRISMD_TOKEN`<br>`aider --model openai/free-auto` | [Guide](examples/aider/README.md) |

## Documentation

- [Documentation index](docs/README.md)
- [Configuration](docs/configuration.md)
- [Client integration](docs/clients/README.md)
- [Model providers](docs/providers/README.md)
- [Status and troubleshooting](docs/operations.md)
- [Contributing](CONTRIBUTING.md)

## Core Behavior

- `free-auto` is the default model alias. prismd selects from its configured candidate queue for each request.
- Provider keys may be supplied as a single value or a list for multi-key rotation.
- Candidates that reach the daily soft limit are demoted; exhausted candidates are skipped.
- Requests can fail over before a stream starts. A stream that has already started is not replayed automatically.
- Local Ollama and LM Studio models are optional and are only used when explicitly added to an alias.
- The web dashboard at `http://127.0.0.1:8787/ui` shows health, quota, and recent client usage.

## Support

If prismd saves you time or API costs, consider buying the author a coffee:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)
