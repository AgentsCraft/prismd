# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md)

Gateway LLM locale che aggrega API di modelli gratuiti e a basso costo (OpenRouter, Groq, Cerebras, ecc.) per agenti di programmazione (Claude Code, Codex CLI, OpenCode e altri), fornendo un'interfaccia unificata e stabile con routing e failover automatici.

Con un unico endpoint locale e un alias unificato (`free-auto`), prismd gestisce automaticamente:
- **Routing intelligente e protezione delle quote**: Seleziona automaticamente i candidati disponibili in base alla finestra di contesto e all'utilizzo della quota giornaliera; retrocede in fondo alla coda i modelli con consumo ≥ 80%.
- **Failover trasparente**: Prima dell'avvio dello streaming, passa automaticamente al candidato successivo in caso di errori 429/401/5xx o timeout di rete.
- **Conversione multi-protocollo**: Supporto nativo per i protocolli OpenAI Responses, OpenAI Chat Completions e Anthropic Messages, consentendo a qualsiasi agente di programmazione di connettersi senza problemi.

## Supporto

Se prismd ti fa risparmiare tempo o quota, considera di offrire un caffè all'autore:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Guida rapida

### Opzione 1: Installazione globale tramite npm (Consigliato)

```bash
# Installa la versione stabile
npm install -g @prismd/prismd

# Oppure il canale di anteprima RC
# npm install -g @agentscraft/prismd

# Configura le chiavi dei provider e il token locale del gateway
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Token di autenticazione locale, es. openssl rand -hex 32

# Avvia il gateway (in ascolto su 127.0.0.1:8787)
prismd
```

### Opzione 2: Esecuzione dal codice sorgente

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # Compila le chiavi API, chmod 600
npm run generate:config                    # Unisce preset e chiavi per generare prismd.json
npm run dev                                # Avvia il server di sviluppo
```

### Test rapido di funzionamento

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## Configurazione dei client

Tutti gli agenti client puntano all'endpoint del gateway locale e utilizzano lo stesso token di protezione locale (`PRISMD_API_KEY`).

### 1. Claude Code
Claude Code supporta nativamente endpoint Anthropic personalizzati tramite variabili d'ambiente. I nomi di modello standard (`claude-*-sonnet`, ecc.) vengono risolti automaticamente negli alias configurati:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Copia il profilo di esempio e genera il catalogo dei metadati dei modelli:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # Genera ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Configura un endpoint OpenAI personalizzato in Cursor:
- **Settings** → **Models** → abilita **OpenAI API Key**, inserisci `<your-prismd-local-token>`.
- Seleziona **Override OpenAI Base URL**, inserisci `http://127.0.0.1:8787/v1`.
- Aggiungi e abilita i modelli `free-auto`, `free-fast`, `free-code`. Consulta la [guida per Cursor](examples/cursor/README.md).

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: Configura `baseUrl: "http://127.0.0.1:8787/v1"` in `~/.config/opencode/config.json`. Consulta la [guida per OpenCode](examples/opencode/README.md).
- **DeepSeek Harness (dsh)**: Configura `base_url = "http://127.0.0.1:8787/v1"` in `~/.dsh/config.toml`. Consulta la [guida per dsh](examples/dsh/README.md).
- **Pi Agent**: Configura `endpoint: "http://127.0.0.1:8787/v1"` in `~/.pi/config.json`. Consulta la [guida per Pi](examples/pi/README.md).

---

## Gestione delle chiavi e configurazione

### Gestione delle chiavi API
Le chiavi possono essere definite nel file `.env` nella root del progetto o nella directory globale `~/.prismd/`. Priorità di ricerca (dalla più alta alla più bassa):
1. **Variabili d'ambiente**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, ecc.
2. **Directory principale del progetto**: `./.env` (copiato da `.env.example`)
3. **Directory utente globale**: `~/.prismd/.env` o `~/.prismd/keys.yaml` (permesso consigliato: `chmod 600`)

### Personalizzazione dei candidati e ordine
Modifica le priorità o aggiungi modelli personalizzati in `config.user.json`, quindi rigenera la configurazione:
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
Esegui `npm run generate:config` (o `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) per applicare le modifiche.

Per istruzioni dettagliate sui principali provider gratuiti (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, ecc.), consulta le [Guide di configurazione dei provider](docs/providers/README.md).

---

## Stato e osservabilità

- **Dashboard Web**: Apri `http://127.0.0.1:8787/ui` nel browser per visualizzare lo stato di salute dei modelli, le barre di avanzamento della quota, il consumo di token e il flusso di eventi SSE in tempo reale.
- **Stato da CLI**: Esegui `prismd status` (o `npm run status`) per visualizzare tabelle formattate direttamente nel terminale.
- **Log strutturati**: Log JSON emessi su stderr con mascheramento automatico dei segreti e tracciamento tramite `request-id` univoco.

---

## Funzionamento e limitazioni

1. **Routing e filtraggio**:
   - Prova i candidati nell'ordine configurato;
   - Esclude rigorosamente i modelli esauriti, con finestra di contesto insufficiente o in cooldown;
   - Retrocede in fondo alla coda i modelli con quota consumata ≥ 80%.
2. **Limiti di failover**:
   - **Prima dello streaming**: In caso di errore 401/403/429/5xx o timeout di connessione, prova il candidato successivo fino a `maxCandidatesPerRequest`.
   - **Dopo l'avvio del flusso**: Non effettua nuovi tentativi a metà flusso per evitare output corrotti; termina correttamente con un evento SSE `error`.
3. **Limitazioni dei pool gratuiti**:
   - I modelli gratuiti condividono pool di capacità pubblici e possono restituire frequenti errori 429 nelle ore di punta. prismd li aggira automaticamente; se tutti i candidati sono esauriti, restituisce un 429 con dettagli in `error.metadata`.

---

## Risoluzione dei problemi

- **Errori 429 frequenti**: I pool di modelli gratuiti sono congestionati. Modifica l'ordine in `config.user.json` per dare priorità a modelli meno richiesti o aggiungi chiavi di altri provider.
- **Candidati scomparsi dopo l'aggiornamento**: Le versioni precedenti utilizzavano un formato di chiave diverso. Esegui `npm run generate:config` per aggiornare `prismd.json`.
- **Ripristinare i contatori di quota**: Fai clic sul pulsante «Reset usage» nella Dashboard Web (`http://127.0.0.1:8787/ui`), oppure arresta il gateway ed elimina `data/prismd.sqlite`.
