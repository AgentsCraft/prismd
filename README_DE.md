# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**Lokales, hochverfügbares LLM-Gateway**, das kostenlose und kostengünstige Modell-APIs (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models usw.) und lokale LLMs (Ollama) bündelt. Es bietet Coding-Agenten (Claude Code, Codex CLI, Cursor, OpenCode, Aider usw.) eine unterbrechungsfreie, stabile Schnittstelle mit automatischem Failover und Routing.

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

## Hauptmerkmale

1. **Einheitlicher Modell-Alias (`free-auto`)**: Keine manuelle Modellauswahl nötig; prismd wählt automatisch das beste verfügbare Modell.
2. **Multi-Key-Pool & Single-Key-Isolierung (Key Pool)**: Ratenbegrenzungen (RPM) umgehen. Konfigurieren Sie mehrere Keys für Round-Robin-Scheduling. Bei einem 429-Fehler wird nur dieser eine Key pausiert und der Datenverkehr sofort auf den nächsten Key verlagert.
3. **Optionaler lokaler Fallback (Ollama / LM Studio)**: Standard-Aliase enthalten nur Cloud-Kandidaten. Läuft lokal ein Backend? Hängen Sie es über `config.user.json` an eine Warteschlange an — wenn Cloud-Modelle erschöpft sind oder das Internet ausfällt, weichen Anfragen auf Ihre lokalen Modelle aus.
4. **Protokollübergreifende Streaming-Konvertierung**: Vollständige bidirektionale Unterstützung zwischen Claude Code (Messages), Codex (Responses) und Cursor/OpenCode (Chat Completions).
5. **Eingebettetes Web-Dashboard & SIGHUP-Hot-Reload**: Überwachen Sie den Status unter `http://127.0.0.1:8787/ui`. Aktualisieren Sie Konfigurationen nahtlos per `SIGHUP` ohne Neustart.

---

## Unterstützung

Wenn prismd Ihnen Zeit oder Token-Kosten spart, freuen wir uns über einen Kaffee:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3-Schritte-Schnellstart

### Schritt 1: Installation

```bash
# Option A: Globale npm-Installation
npm install -g @prismd/prismd              # Stabiles Release
# Oder RC-Vorschaukanal (an neuestem develop ausgerichtet):
npm install -g @agentscraft/prismd         # RC-Kanal

# Option B: Aus dem Quellcode ausführen
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### Schritt 2: Initialisierung und Start

Führen Sie den interaktiven Setup-Assistenten aus:
```bash
prismd init
# Source install: node dist/server.js init
```
Der Assistent führt Sie durch folgende Schritte:
1. Lokales Schutz-Token (`prismd:`) festlegen.
2. Kostenlose Provider auswählen (OpenRouter, Groq, Google Gemini etc.) und Keys eingeben.
3. **Coding-Clients automatisch konfigurieren** (Claude Code, Codex CLI, OpenCode, Pi Agent) inklusive automatischer Backups (`.bak.<Zeitstempel>`)!

*(Manuelle Konfiguration bevorzugt? Bearbeiten Sie `~/.prismd/keys.yaml` oder setzen Sie `PRISMD_HOME`).*

```yaml
# Manuelles Setup: ~/.prismd/keys.yaml (Empfohlene Rechte: chmod 600)
prismd: "YOUR_PRISMD_TOKEN" # Lokaler Schutz-Token (für Clients)

# Cloud-Provider (Einzel-Key oder Multi-Key-Pool für Round-Robin):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Multi-Key-Pooling & Cooldown-Isolation
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models Personal Access Token
amd: "amd_token_xxxx"           # Optional: AMD Developer Cloud Token

# Lokaler Offline-Fallback:
# ollama: Keine Keys nötig (automatisch über http://127.0.0.1:11434/v1)
```

Gateway starten:
```bash
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **Provider-Konfigurationsleitfäden**: Siehe [Modell-Provider-Leitfaden](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) für API-Keys und Details.

### Schritt 3: Agenten-Client einrichten

| Client | Schnellstart (`prismd init` Auto-Konfig) | Anleitung |
|---|---|---|
| **Claude Code** | `claude` (konfiguriert in `~/.claude/settings.json`) | [Anleitung](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (konfiguriert in `~/.codex/config.toml` & `auth.json`) | [Anleitung](examples/codex/README.md) |
| **OpenCode** | `opencode` (konfiguriert in `~/.config/opencode/opencode.json`) | [Anleitung](examples/opencode/README.md) |
| **Pi Agent** | `pi` (konfiguriert in `~/.pi/config.json`) | [Anleitung](examples/pi/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key aktivieren (`YOUR_PRISMD_TOKEN`)<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Modell: `free-auto` | [Anleitung](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml` mit `base_url = "http://127.0.0.1:8787/v1"`<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [Anleitung](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [Anleitung](examples/aider/README.md) |

> 📖 **Vollständige Dokumentation**: Siehe [Dokumentationsindex](docs/README.md), [Client-Integrationsleitfaden](docs/clients/README.md) und [Konfiguration](docs/configuration.md).

---
