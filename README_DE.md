# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

Lokales LLM-Gateway zur Aggregation von kostenlosen und kostengünstigen Modell-APIs (OpenRouter, Groq, Cerebras usw.) für Coding-Agents (Claude Code, Codex CLI, OpenCode u. a.), das eine stabile, einheitliche Schnittstelle mit automatischem Routing und Failover bietet.

Mit einem einzigen lokalen Endpunkt und einem einheitlichen Alias (`free-auto`) erledigt prismd Folgendes automatisch:
- **Intelligentes Routing & Kontingentschutz**: Wählt automatisch verfügbare Kandidaten basierend auf Kontextfenster und Tageskontingent aus; stuft Modelle bei ≥ 80 % Verbrauch weich an das Ende der Warteschlange zurück.
- **Nahtloses Failover**: Wechselt vor Beginn des Streams bei 429/401/5xx-Fehlern oder Netzwerk-Timeouts automatisch zum nächsten Kandidaten.
- **Multi-Protokoll-Konvertierung**: Native Unterstützung für OpenAI Responses, OpenAI Chat Completions und Anthropic Messages Protokolle zur nahtlosen Anbindung aller Coding-Agents.

## Unterstützung

Wenn prismd Ihnen Zeit oder Kontingente spart, können Sie dem Autor gerne einen Kaffee spendieren:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Schnellstart

### Option 1: Globale Installation via npm (Empfohlen)

```bash
# Stabile Version installieren
npm install -g @prismd/prismd

# Oder RC-Vorschaukanal
# npm install -g @agentscraft/prismd

# Anbieter-Schlüssel und lokalen Gateway-Token konfigurieren
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Lokaler Authentifizierungs-Token, z.B. openssl rand -hex 32

# Gateway starten (lauscht auf 127.0.0.1:8787)
prismd
```

### Option 2: Aus dem Quellcode ausführen

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # API-Schlüssel eintragen, chmod 600
npm run generate:config                    # Voreinstellungen und Schlüssel zu prismd.json zusammenführen
npm run dev                                # Entwicklungsserver starten
```

### Funktionstest (Smoke Test)

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## Client-Konfiguration

Alle Client-Agents verweisen auf den lokalen Gateway-Endpunkt und nutzen denselben lokalen Schutz-Token (`PRISMD_API_KEY`).

### 1. Claude Code
Claude Code unterstützt benutzerdefinierte Anthropic-Endpunkte nativ über Umgebungsvariablen. Standard-Modellnamen (`claude-*-sonnet` usw.) fallen automatisch auf konfigurierte Gateway-Aliase zurück:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Kopieren Sie das Beispielprofil und generieren Sie den Modell-Metadatenkatalog:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # Erzeugt ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Konfigurieren Sie einen benutzerdefinierten OpenAI-Endpunkt in Cursor:
- **Settings** → **Models** → **OpenAI API Key** aktivieren und `<your-prismd-local-token>` eintragen.
- **Override OpenAI Base URL** aktivieren und `http://127.0.0.1:8787/v1` eintragen.
- Modelle `free-auto`, `free-fast`, `free-code` hinzufügen und aktivieren. Siehe [Cursor-Anleitung](examples/cursor/README.md).

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: Konfigurieren Sie `baseUrl: "http://127.0.0.1:8787/v1"` in `~/.config/opencode/config.json`. Siehe [OpenCode-Anleitung](examples/opencode/README.md).
- **DeepSeek Harness (dsh)**: Konfigurieren Sie `base_url = "http://127.0.0.1:8787/v1"` in `~/.dsh/config.toml`. Siehe [dsh-Anleitung](examples/dsh/README.md).
- **Pi Agent**: Konfigurieren Sie `endpoint: "http://127.0.0.1:8787/v1"` in `~/.pi/config.json`. Siehe [Pi-Anleitung](examples/pi/README.md).

---

## Schlüsselverwaltung & Konfiguration

### Schlüsselverwaltung
Schlüssel können im Projektstammverzeichnis `.env` oder im globalen Benutzerverzeichnis `~/.prismd/` hinterlegt werden. Priorität (höchste zuerst):
1. **Umgebungsvariablen**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` usw.
2. **Projektstammverzeichnis**: `./.env` (Kopie von `.env.example`)
3. **Globales Benutzerverzeichnis**: `~/.prismd/.env` oder `~/.prismd/keys.yaml` (Empfohlene Berechtigung: `chmod 600`)

### Kandidaten & Reihenfolge anpassen
Überschreiben Sie Prioritäten oder fügen Sie eigene Modelle in `config.user.json` hinzu und generieren Sie die Konfiguration neu:
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
Führen Sie `npm run generate:config` (oder `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) aus, um Änderungen zu übernehmen.

Detaillierte Einrichtungsanleitungen für wichtige kostenlose Anbieter (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models usw.) finden Sie in den [Anbieter-Leitfäden](docs/providers/README.md).

---

## Status & Beobachtbarkeit

- **Web-Dashboard**: Öffnen Sie `http://127.0.0.1:8787/ui` im Browser für Modell-Status, Quoten-Fortschrittsbalken, Token-Nutzung und Live-SSE-Event-Stream.
- **CLI-Status**: Führen Sie `prismd status` (oder `npm run status`) aus, um formatierte Metriken direkt im Terminal anzuzeigen.
- **Strukturierte Logs**: JSON-Logs auf stderr mit automatischer Geheimnismaskierung und eindeutiger `request-id`-Nachverfolgung.

---

## Funktionsweise & Grenzen

1. **Routing & Filterung**:
   - Testet Kandidaten in konfigurierter Reihenfolge;
   - Schließt erschöpfte, zu kleine oder fehlerhafte Modelle hart aus;
   - Weiche Herabstufung von Modellen bei ≥ 80 % Tageskontingent.
2. **Failover-Grenzen**:
   - **Vor Stream-Beginn**: Bei 401/403/429/5xx oder Verbindungs-Timeout wird bis zu `maxCandidatesPerRequest` Mal der nächste Kandidat versucht.
   - **Nach Stream-Beginn**: Um fehlerhafte Ausgaben zu vermeiden, erfolgt mitten im Stream kein erneuter Versuch; der Stream endet sauber mit einem SSE-`error`-Event.
3. **Einschränkungen kostenloser Pools**:
   - Öffentliche freie Modelle teilen gemeinsame Kapazitätspools und können zu Stoßzeiten 429-Fehler liefern. prismd weicht diesen automatisch aus; sind alle Modelle erschöpft, wird ein 429 mit Details in `error.metadata` zurückgegeben.

---

## Fehlerbehebung

- **Häufige 429-Fehler**: Kostenlose Modell-Pools sind ausgelastet. Ändern Sie die Reihenfolge in `config.user.json`, um weniger ausgelastete Modelle zu priorisieren, oder hinterlegen Sie weitere Anbieter-Schlüssel.
- **Kandidaten nach Update verschwunden**: Ältere Versionen nutzten ein anderes Konfigurationsformat. Führen Sie `npm run generate:config` aus, um `prismd.json` zu aktualisieren.
- **Kontingentzähler zurücksetzen**: Klicken Sie im Web-Dashboard (`http://127.0.0.1:8787/ui`) auf „Reset usage“ oder stoppen Sie das Gateway und löschen Sie `data/prismd.sqlite`.
