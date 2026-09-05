# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

**Gateway LLM locale ad alta disponibilità** che aggrega API di modelli gratuiti e a basso costo (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, ecc.) e LLM locali (Ollama). Fornisce un'interfaccia unificata, stabile e senza interruzioni per agenti di programmazione (Claude Code, Codex CLI, Cursor, OpenCode, Aider, ecc.).

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

## Caratteristiche Principali

1. **Alias Unificato (`free-auto`)**: Dimentica la scelta manuale dei modelli; prismd seleziona automaticamente il miglior modello gratuito disponibile.
2. **Pool Multi-Key e Isolamento dei Guasti (Key Pool)**: Supera i limiti di frequenza (RPM). Configura più chiavi con bilanciamento round-robin. Se una chiave riceve un errore 429, solo quella chiave entra in cooldown e il traffico passa immediatamente alla successiva.
3. **Fallback Locale Ollama Senza Interruzioni**: In caso di esaurimento quote cloud o disconnessione di rete, le richieste passano in modo trasparente a Ollama locale (`qwen2.5-coder:7b`, `deepseek-r1:8b`).
4. **Conversione Multi-Protocollo Bidirezionale**: Supporto nativo per Claude Code (Messages), Codex (Responses) e Cursor/OpenCode (Chat Completions).
5. **Dashboard Web Integrata e Ricaricamento a Caldo (SIGHUP)**: Monitora lo stato in tempo reale su `http://127.0.0.1:8787/ui`. Aggiorna le configurazioni senza riavviare tramite il segnale `SIGHUP`.

---

## Sostieni il Progetto

Se prismd ti fa risparmiare tempo o costi di API, puoi offrire un caffè all'autore:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Avvio Rapido in 3 Passaggi

### Passaggio 1: Installazione e Avvio

```bash
# Opzione A: Installazione globale npm
npm install -g @prismd/prismd              # Versione stabile
# Oppure canale di anteprima RC (allineato a develop):
npm install -g @agentscraft/prismd         # Canale RC

# Opzione B: Esecuzione dal codice sorgente
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### Passaggio 2: Configurazione delle Chiavi API

Aggiungi le tue chiavi in `~/.prismd/keys.yaml` o in `./.env` (configura uno o più provider; quelli non configurati vengono ignorati):

```yaml
# ~/.prismd/keys.yaml (permessi consigliati: chmod 600)
prismd: "mio-segreto-locale"    # Token di protezione locale (usato dai client)

# Provider Cloud (chiave singola o pool multi-key per round-robin):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Multi-key pooling e isolamento cooldown
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # Token di accesso personale GitHub Models
amd: "amd_token_xxxx"           # Opzionale: Token AMD Developer Cloud

# Fallback locale offline:
# ollama: Nessuna chiave richiesta (instradamento automatico a http://127.0.0.1:11434/v1)
```

Avviare il gateway:
```bash
prismd
# Oppure in modalità sorgente: npm run generate:config && npm run dev
```

> 📖 **Guide per i provider**: Consulta le [Guide all'integrazione dei provider](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) per la generazione delle chiavi e i modelli supportati.

### Passaggio 3: Configurazione dell'Agente

| Client | Configurazione Rapida | Guida |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="mio-segreto-locale"`<br>`claude` | [Guida](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=mio-segreto-locale codex --profile prismd` | [Guida](examples/codex/README.md) |
| **Cursor** | Settings → Models → Abilita OpenAI API Key (`mio-segreto-locale`)<br>Spunta **Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Aggiungi modello: `free-auto` | [Guida](examples/cursor/README.md) |
| **OpenCode** | Imposta `baseUrl: "http://127.0.0.1:8787/v1"` in `~/.config/opencode/config.json` | [Guida](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | Imposta `base_url = "http://127.0.0.1:8787/v1"` in `~/.dsh/config.toml`<br>`PRISMD_API_KEY=mio-segreto-locale dsh --model prismd:free-auto` | [Guida](examples/dsh/README.md) |
| **Pi Agent** | Imposta `endpoint: "http://127.0.0.1:8787/v1"` in `~/.pi/config.json`<br>`pi run` | [Guida](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="mio-segreto-locale"` `aider --model openai/free-auto` | [Guida](examples/aider/README.md) |

> 📖 **Documentazione completa**: Consulta la [Guida all'integrazione dei client](docs/clients/README.md) per dettagli sui protocolli e configurazioni avanzate.

---

## Funzionalità nel Dettaglio

### 1. Routing Intelligente e Failover Automatico

prismd seleziona dinamicamente il candidato ottimale per ciascuna richiesta tramite una pipeline di valutazione:

- **Verifica della finestra di contesto (Context Window Check)**: Stima preventiva dei token di input; esclude i modelli con contesto insufficiente per evitare errori 400 Context Overflow.
- **Limiti morbidi di quota (Quota-Weighted Soft Limit)**: Al raggiungimento dell'80% della quota giornaliera (`quotaSoftLimitRatio`), il modello viene retrocesso in coda per preservare le risorse residue.
- **Failover senza interruzioni (Zero-Crash Failover)**: In caso di errore 429 di rate limit o 5xx, prismd passa istantaneamente al modello candidato successivo nella coda.
- **Alias Predefiniti**:
  - `free-auto`: Coda principale di programmazione (priorità Gemini 2.0 Flash / Llama 3.3 70B, fallback su Ollama `qwen2.5-coder:7b`).

### 2. Multi-Key e Isolamento Errori (Key Pool)

Tutti i provider Cloud (Groq, Cerebras, Google Gemini, OpenRouter, NVIDIA NIM, GitHub Models, ecc.) supportano la configurazione multi-key per la distribuzione round-robin e l'isolamento dei guasti:

- **Formato `~/.prismd/keys.yaml`** (lista YAML o array inline):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **Formato `.env` o variabili d'ambiente** (separate da virgola):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **Funzionamento**: Le richieste vengono distribuite tramite Round-Robin tra le chiavi integre. Quando una chiave (es. `gsk_key1`) riceve un errore 429, solo quella chiave viene isolata in cooldown (`Retry-After`), e le richieste successive passano immediatamente a `gsk_key2` o al candidato successivo.

### 3. Fallback Locale LLM Offline Senza Interruzioni (Ollama & LM Studio)

In caso di esaurimento quote cloud o disconnessione di rete, prismd instrada automaticamente il traffico ai backend locali:

- **Ollama**: Provider integrato zero configurazione (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: Server locale compatibile OpenAI (`http://127.0.0.1:1234/v1`) con modelli GGUF. Consulta la [Guida a LM Studio](docs/providers/lmstudio.md).
- I task degli agenti continuano senza arresti anomali.

### 4. Bridge Multiprotocollo Trasparente

Conversione bidirezionale in streaming tra i tre protocolli agenti principali:
- **Anthropic Messages** (`POST /v1/messages`): Supporto completo a Claude Code (Tools, blocchi Thinking, stream SSE).
- **OpenAI Responses** (`POST /v1/responses`): Compatibile con Codex CLI e DeepSeek Harness (`dsh`).
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): Interfaccia standard per Cursor, OpenCode, Pi Agent e Aider.

### 5. Configurazione Estensibile (`config.user.json`)

Dichiara provider personalizzati, modelli privati e code di alias in `config.user.json`:

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
Rigenera la configurazione con `npm run generate:config`.

### 6. Ricaricamento Dinamico a Caldo (`SIGHUP`)

Aggiorna tabelle di routing e chiavi senza riavviare il processo né interrompere flussi in streaming:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## Monitoraggio e Dashboard Web

- **Dashboard Web**: Apri `http://127.0.0.1:8787/ui` nel browser:
  - Stato di salute in tempo reale (`healthy` / `rate_limited` / `cooldown`)
  - Barre di progresso quote e statistiche token
  - Selettore per 10 lingue e pulsante «Reimposta utilizzo (Reset usage)»
- **Stato CLI**:
  ```bash
  prismd status
  ```
  Visualizza una matrice a colori nel terminale.

---

## Risoluzione dei Problemi

- **Q: Errore `missing API key for provider`?**
  - Verifica le chiavi in `~/.prismd/keys.yaml` o `.env` ed esegui `npm run generate:config`.
- **Q: Errori 429 frequenti sui modelli gratuiti?**
  - Aggiungi più chiavi per il provider o avvia `ollama run qwen2.5-coder:7b`.
- **Q: Come azzerare i conteggi giornalieri?**
  - Clicca su «Reset usage» nella dashboard Web o elimina `data/prismd.sqlite`.
