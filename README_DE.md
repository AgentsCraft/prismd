# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

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

### Schritt 1: Installation und Start

```bash
# Option A: Globale npm-Installation
npm install -g @prismd/prismd              # Stabiles Release
# Oder RC-Vorschaukanal (an neuestem develop ausgerichtet):
npm install -g @agentscraft/prismd         # RC-Kanal

# Option B: Aus dem Quellcode ausführen
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### Schritt 2: API-Keys konfigurieren

Tragen Sie Ihre Keys in `~/.prismd/keys.yaml` oder `./.env` ein (einer oder mehrere; nicht konfigurierte Provider werden übersprungen):

```yaml
# ~/.prismd/keys.yaml (Empfohlene Rechte: chmod 600)
prismd: "mein-lokales-geheimnis" # Lokaler Schutz-Token (für Clients)

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
prismd
# Oder im Quellmodus: npm run generate:config && npm run dev
```

> 📖 **Provider-Konfigurationsleitfäden**: Siehe [Modell-Provider-Leitfaden](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) für API-Keys und Details.

### Schritt 3: Agenten-Client einrichten

| Client | Schnellkonfiguration | Anleitung |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="mein-lokales-geheimnis"`<br>`claude` | [Anleitung](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=mein-lokales-geheimnis codex --profile prismd` | [Anleitung](examples/codex/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key aktivieren (`mein-lokales-geheimnis`)<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Modell: `free-auto` | [Anleitung](examples/cursor/README.md) |
| **OpenCode** | `~/.config/opencode/config.json` mit `baseUrl: "http://127.0.0.1:8787/v1"` | [Anleitung](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml` mit `base_url = "http://127.0.0.1:8787/v1"`<br>`PRISMD_API_KEY=mein-lokales-geheimnis dsh --model prismd:free-auto` | [Anleitung](examples/dsh/README.md) |
| **Pi Agent** | `~/.pi/config.json` mit `endpoint: "http://127.0.0.1:8787/v1"`<br>`pi run` | [Anleitung](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="mein-lokales-geheimnis"` `aider --model openai/free-auto` | [Anleitung](examples/aider/README.md) |

> 📖 **Vollständige Dokumentation**: Siehe [Client-Integrationsleitfaden](docs/clients/README.md) für Protokoll- und Konfigurationsdetails.

---

## Funktionen im Detail

### 1. Intelligentes Routing & Automatisches Failover

prismd wählt für jede Anfrage dynamisch den optimalen Modellkandidaten über eine Auswertungspipeline:

- **Kontextfensterprüfung (Context Window Check)**: Schätzt die Eingabetoken vor dem Versand; filtert Modelle mit zu kleinem Fenster heraus und verhindert so 400 Context Overflow Fehler.
- **Quotenbasierte Soft-Limits (Quota-Weighted Soft Limit)**: Erreicht ein Kandidat 80 % seiner Tagesquote (`quotaSoftLimitRatio`), wird er ans Ende der Warteschlange verschoben, um Restkontingente zu schonen.
- **Unterbrechungsfreies 429 Failover (Zero-Crash Failover)**: Bei 429-Ratenbegrenzungen oder 5xx-Fehlern wechselt prismd nahtlos zum nächsten gesunden Kandidaten in der Alias-Warteschlange.
- **Standard-Aliase**:
  - `free-auto`: Haupt-Coding-Warteschlange (bevorzugt Gemini 2.0 Flash / Llama 3.3 70B, standardmäßig nur Cloud).

### 2. Multi-Key-Pooling & Circuit Breaking (Key Pool)

Alle Cloud-Provider (Groq, Cerebras, Google Gemini, OpenRouter, NVIDIA NIM, GitHub Models usw.) unterstützen Multi-Key-Konfigurationen für Round-Robin und Ausfallisolation:

- **`~/.prismd/keys.yaml` Format** (Liste oder Inline-Array):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **`.env` oder Umgebungsvariablen** (kommagetrennt):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **Funktionsweise**: Anfragen werden per Round-Robin über funktionierende Keys verteilt. Wenn ein Key (z. B. `gsk_key1`) einen 429-Fehler erhält, wird nur dieser Key isoliert gekühlt (unter Beachtung von `Retry-After`), während nachfolgende Anfragen sofort auf `gsk_key2` oder das nächste Modell übergehen.

### 3. Lokaler LLM-Fallback (Ollama & LM Studio, optional)

prismd bringt Ollama und LM Studio als integrierte Provider mit, hält die Standard-Aliase aber reine Cloud-Kandidaten. Läuft lokal eines davon? Hängen Sie es über `config.user.json` als Kandidaten an:

- **Ollama**: Integrierter Zero-Config-Provider (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: Lokaler OpenAI-kompatibler Server (`http://127.0.0.1:1234/v1`) mit GGUF-Modellen. Siehe [LM Studio Leitfaden](docs/providers/lmstudio.md).
- Aufgaben von Coding-Agenten laufen ohne Absturz nahtlos weiter.

### 4. Transparente Protokoll-Bridge

Vollständige bidirektionale Streaming-Konvertierung zwischen allen drei führenden Agenten-Protokollen:
- **Anthropic Messages** (`POST /v1/messages`): Volle Unterstützung für Claude Code (Tools, Thinking-Blöcke, SSE-Streams).
- **OpenAI Responses** (`POST /v1/responses`): Kompatibel mit Codex CLI und DeepSeek Harness (`dsh`).
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): Standardschnittstelle für Cursor, OpenCode, Pi Agent und Aider.

### 5. Erweiterbare Konfiguration (`config.user.json`)

Eigene Provider, private Modelle und benutzerdefinierte Alias-Warteschlangen in `config.user.json` definieren:

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
Mit `npm run generate:config` die Konfiguration neu generieren.

### 6. Dynamisches Hot-Reloading (`SIGHUP`)

Routingtabellen und Keys ohne Prozessneustart oder Verbindungsabbruch aktualisieren:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## Status & Web-Dashboard

- **Web-Dashboard**: Öffnen Sie `http://127.0.0.1:8787/ui` im Browser:
  - Echtzeit-Gesundheitsstatus (`healthy` / `rate_limited` / `cooldown`)
  - Quoten-Fortschrittsbalken und Token-Verbrauchsstatistiken
  - 10 Sprachen und Schaltfläche „Nutzung zurücksetzen (Reset usage)“
- **CLI-Status**:
  ```bash
  prismd status
  ```
  Farbige Statusmatrix im Terminal.

---

## Fehlerbehebung

- **Q: Fehler `missing API key for provider`?**
  - Überprüfen Sie `~/.prismd/keys.yaml` oder `.env` und führen Sie `npm run generate:config` aus.
- **Q: Häufige 429-Fehler bei kostenlosen Modellen?**
  - Fügen Sie mehrere Keys hinzu oder hängen Sie über `config.user.json` einen lokalen Ollama-Kandidaten an die Warteschlange an.
- **Q: Tägliche Nutzungszähler zurücksetzen?**
  - Klicken Sie im Web-Dashboard auf „Reset usage“ oder löschen Sie `data/prismd.sqlite`.
