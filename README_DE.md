# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

Lokales LLM-Gateway zur Aggregation von kostenlosen APIs und APIs mit geringem Kontingent (OpenRouter, Groq, Cerebras usw.) für Coding-Agents. Ein lokaler Endpunkt, ein Alias (`free-auto`), und prismd erledigt den Rest: Auswahl funktionierender Kandidatenmodelle, Vermeidung erschöpfter Kontingente, automatisches Failover bei Upstream-429-Fehlern und Echtzeit-Statusüberwachung. Unterstützt nativ drei Hauptprotokolle (OpenAI Responses, OpenAI Chat Completions, Anthropic Messages), sodass Codex CLI, Claude Code, OpenCode und weitere Clients dasselbe Gateway gemeinsam nutzen können.

## Unterstützung

Wenn prismd Ihnen Zeit oder Kontingente spart, können Sie dem Autor gerne einen Kaffee spendieren:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

## Funktionsumfang

| Funktion | Verhalten |
| --- | --- |
| **Multi-Protokoll-Einstiegspunkte** | `POST /v1/responses` (OpenAI Responses, Codex), `POST /v1/chat/completions` (OpenAI Chat, OpenCode/dsh), `POST /v1/messages` (Anthropic Messages, Claude Code) — alle teilen dieselben Aliase, Routing-, Quota- und Failover-Mechanismen |
| **Protokollkonvertierung** | Chat↔Responses (Egress-Konvertierung inkl. Streaming-Tool-Calls) und Anthropic↔Chat (Ingress); identische Protokolle werden transparent durchgereicht |
| **Automatischer Claude-Fallback** | Modellnamen von Claude Code (`claude-*-sonnet/haiku/opus-*`) werden über eine 9-stufige Fallback-Kette (Datumssuffix, `-latest`, semantische Familie, `free-auto`) automatisch auf konfigurierte Aliase aufgelöst |
| **Alias-Routing** | `"model": "free-auto"` löst auf eine geordnete Liste von Kandidatenmodellen aus Ihrer Konfiguration auf |
| **Kandidatenfilterung** | Harter Ausschluss von Kandidaten mit erschöpftem Tageskontingent (`limits.dailyRequests`), zu kleinem Kontextfenster für die Eingabe oder fehlerhaftem Status. Weiche Herabstufung von Kandidaten mit ≥ 80 % Kontingentverbrauch an das Ende der Warteschlange |
| **Failover** | *Vor Beginn des Streams* wird bei 401/403/429/5xx, Verbindungsfehlern oder Timeouts automatisch der nächste Kandidat versucht (bis zu `maxCandidatesPerRequest`). Client-Fehler der 4xx-Klasse (400/404/422) werden unverändert durchgereicht. Nach Beginn des Streams erfolgt kein erneuter Versuch |
| **Kontingent- & Nutzungserfassung** | Zählt Anfragen und Tokens (echte Upstream-Werte oder Schätzung mit Zeichenanzahl ÷ 4) in einer lokalen SQLite-Datenbank. Bleibt nach Neustarts erhalten |
| **Passive Zustandsprüfung** | 3 aufeinanderfolgende Fehler → Cooldown 60s → Halboffen (einzelner Testaufruf). 401/403-Fehler werden separat protokolliert |
| **Timeouts** | Verbindungs-Timeout (Standard: 10s) und Stream-Leerlauf-Timeout (Standard: 300s), pro Richtlinie konfigurierbar |
| **Schlüsselverwaltung** | API-Schlüssel liegen in `~/.prismd/` (`.env` oder `keys.yaml`), niemals im Repository oder in `prismd.json`. Priorität: OS-Umgebungsvariable > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **Modell-Erkennung** | `GET /v1/models` liefert alle konfigurierten logischen Alias-Modelle im OpenAI-kompatiblen Format ohne Authentifizierung |
| **Status-API & SSE** | `GET /healthz` für Gateway-Zustand; `GET /v1/modelstatus` für In-Memory-Snapshots; `GET /v1/modelstatus/stream` für SSE-Echtzeitübertragung bei Status-/Quotenänderungen |
| **Integriertes Web-UI** | `GET /ui` stellt ein eigenständiges Dashboard ohne externe Abhängigkeiten mit Status-Badges, Quoten-Fortschrittsbalken, Token-Metriken und Live-Event-Stream bereit |
| **CLI-Status** | `prismd status` (oder `npm run status`) gibt formatierte Terminal-Tabellen mit Farbcodierung und Offline-SQLite-Fallback aus |
| **Beobachtbarkeit** | Strukturierte JSON-Logs via pino auf stderr mit eindeutiger Request-ID pro Anfrage; automatische Maskierung von Geheimnissen |

## Schnellstart

Aus dem Quellcode:

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # Schlüssel eintragen, dann chmod 600
npm run generate:config                    # Voreinstellungen + config.user.json + Keys → prismd.json
npm run dev                                # Startet auf http://127.0.0.1:8787
```

Oder via npm-Paket global installieren:

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<your-key>
export PRISMD_API_KEY=<local-token>        # Erzeugen: openssl rand -hex 32
prismd                                     # Startet auf http://127.0.0.1:8787
```

Die Laufzeit liest genau eine Datei: `prismd.json` (Pfad via `PRISMD_CONFIG_PATH` anpassbar). Bei installiertem Paket erzeugen mit `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`.

Funktionstest:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## API-Schlüssel

prismd liest Schlüssel aus dem Verzeichnis `~/.prismd/`. Schlüssel gelangen niemals in Git oder `prismd.json`. Suchpriorität:

| Feld | OS-Umgebungsvariable | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd` (lokaler Token) | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- Der Variablenname entspricht dem Feldnamen in Großbuchstaben plus `_API_KEY`.
- Beide Dateiformate werden unterstützt (`.env` als `KEY=value`, `keys.yaml` als `field: value`). Vorlagen: `.env.example` / `keys.yaml.example`.
- Berechtigungen mit `chmod 600` absichern.
- Der lokale Token (`prismd`) schützt alle drei POST-Einstiegspunkte via `Authorization: Bearer <token>` oder `x-api-key: <token>`. Ungültige Anfragen erhalten 401 und erreichen den Upstream nicht.

## Konfiguration

`prismd.json` wird über ein Skript generiert. Dabei werden drei Ebenen zusammengeführt:

| Ebene | Datei | Zweck |
| --- | --- | --- |
| Presets | `presets/providers.json` | Integrierte Anbieter, Metadaten kostenloser Modelle (Kontext, Limits, Tags), Herkunftsnachweise und Standardaliase. |
| User overrides | `config.user.json` | Benutzerdefinierte Überschreibungen (Reihenfolge, eigene Modelle, Richtlinien, Servereinstellungen). Keine Schlüssel. |
| Keys | `~/.prismd/` | Nur Modelle von Anbietern mit konfiguriertem Schlüssel werden in die Konfiguration übernommen. |

Nach Änderungen `npm run generate:config` ausführen.

Beispiel für `config.user.json`:

```jsonc
{
  "aliases": {
    "free-auto": {
      // Reihenfolge der Kandidaten anpassen
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // Bis zu 3 Kandidaten pro Anfrage versuchen
    "connectTimeoutMs": 5000          // Kürzere Verbindungs-Timeouts
  }
}
```

Eigene Kandidaten direkt definieren:

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

Neue Anbieter mit Standard-`baseUrl` (`/responses` oder `/chat/completions`) können nahtlos integriert werden.

## Routing-Mechanismus

1. Der Alias wird auf die geordnete Kandidatenliste aufgelöst.
2. **Harter Ausschluss**: Ausschluss von Modellen mit erschöpftem Tageskontingent (`limits.dailyRequests`), zu kleinem `contextWindow` oder Cooldown-Status.
3. **Weiche Herabstufung**: Kandidaten mit ≥ 80 % Kontingentverbrauch (`quotaSoftLimitRatio`) werden an das Ende verschoben.
4. Der erste verbleibende Kandidat erhält die Anfrage. Bei Fehlern schlägt das Failover auf den nächsten Kandidaten um.

Vom Gateway zurückgegebene Fehler (im OpenAI-Format `{"error": {...}}`):

| Szenario | Status | Code | Hinweise |
| --- | --- | --- | --- |
| Fehlender/falscher Token | 401 | `invalid_api_key` | Upstream wird nicht kontaktiert |
| Unbekannter Alias | 404 | `model_not_found` | |
| Alle Kandidaten erschöpft/fehlerhaft | 429 | `quota_exceeded` | `error.metadata` führt Ausschlussgründe aller Kandidaten auf |
| Eingabe überschreitet alle Kontextfenster | 422 | `context_window_exceeded` | `error.metadata` führt Fenstergrößen auf |
| Alle versuchten Kandidaten fehlgeschlagen | 502 | `gateway_all_candidates_failed` | `error.metadata` führt Fehler pro Versuch auf |
| Interner Fehler | 500 | `gateway_internal_error` | |

## Failover

- **Auslöser (vor Stream-Beginn)**: Verbindungsfehler, Timeout, Upstream 401, 403, 429, 5xx. Fehlzähler wird erhöht und nächster Kandidat bis `maxCandidatesPerRequest` versucht.
- **Kein Auslöser**: 400/404/422 und andere anfragebezogene 4xx-Fehler (das Problem liegt in der Anfrage selbst, daher direkte Rückgabe).
- **Nach Stream-Beginn**: Niemals erneute Versuche. Bei Unterbrechung wird der Stream mit einem SSE-`error`-Event beendet.
- Trägt ein 429-Fehler einen `Retry-After`-Header und ist `respectRetryAfter` aktiv, wird die Cooldown-Dauer auf `max(cooldownMs, Retry-After)` gesetzt.

## Kontingente & Nutzung

Nutzungsdaten werden im Speicher gesammelt und alle 5 Sekunden oder 20 Datensätze in SQLite (`data/prismd.sqlite`, WAL-Modus) persistiert. Beim Herunterfahren (SIGINT/SIGTERM) erfolgt ein erzwungener Flush.

| Tabelle | Inhalt |
| --- | --- |
| `usage_daily` | Tagesaggregate (Datum, Anbieter, Modell, Anfragen, Tokens). Dient als Datenbasis für das Quotenrouting und übersteht Neustarts. |
| `request_log` | Einzelne Zeile pro Anfrage (ID, Alias, Anbieter, Modell, Status, Tokens, Failover-Flag, Dauer). 14 Tage Aufbewahrung. |

- Tokens: Reale Upstream-Werte oder konservative Schätzung (Eingabe = Zeichen ÷ 4, Ausgabe = Zeichen ÷ 4). Spalte `source` kennzeichnet `real` / `estimated` / `mixed`.
- Verzeichnisberechtigung `0700`, Datenbankdatei `0600`. Löschen von `data/prismd.sqlite` oder Betätigen der Reset-Schaltfläche im UI/CLI setzt alle Zähler zurück.

## Zustandsprüfungen (Health Checks)

Ausschließlich passiv (keine ressourcenverbrauchenden aktiven Probes). Verwaltung im Speicher pro `(provider, model)`:

```
healthy → (3 aufeinanderfolgende Fehler) → cooldown 60s → half-open (1 Testanfrage)
              ↑                                                 Erfolg → healthy
              └──────────────────────────────────────── Fehler → erneuter cooldown
```

## Richtlinien-Referenz (`policies`)

In `config.user.json` anpassbare Optionen (Standardwerte):

| Feld | Standard | Bedeutung |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | Fehlercodes, die Failover auslösen |
| `retryBeforeStream` | `true` | Andere Kandidaten vor Stream-Start versuchen |
| `retryAfterStream` | `false` | Nach Stream-Start keine Wiederholungen |
| `maxCandidatesPerRequest` | `2` | Maximale Kandidatenversuche pro Anfrage |
| `respectRetryAfter` | `true` | `Retry-After`-Header bei Cooldown berücksichtigen |
| `quotaSoftLimitRatio` | `0.8` | Schwellenwert für weiche Herabstufung |
| `connectTimeoutMs` | `10000` | Verbindungs-Timeout in ms |
| `streamIdleTimeoutMs` | `300000` | Maximaler Abstand zwischen Stream-Chunks in ms |
| `failThreshold` | `3` | Fehlversuche bis zum Eintritt in Cooldown |
| `cooldownMs` | `60000` | Dauer der Cooldown-Phase in ms |

## Codex-Integration

1. Beispielprofil kopieren und Katalog generieren:

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. Ausführen:

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

- Das Profil verwendet `free-auto`. Der Katalog setzt für jeden Alias das **minimale** Kontextfenster seiner Kandidaten, um Überläufe zu verhindern.
- Codex-Wiederholungen niedrig einstellen: `request_max_retries = 0` (Failover übernimmt das Gateway), `stream_max_retries = 1`.

## Weitere Clients (Claude Code, OpenCode, dsh, Pi)

Alle Clients teilen dieselben Aliase (`free-auto`, `free-fast`, `free-code`) und Tokens:

- **Claude Code** — Anthropic-Messages-Protokoll: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, `ANTHROPIC_AUTH_TOKEN` (oder `x-api-key`) auf prismd-Token setzen. Claude-Modellnamen werden automatisch zugeordnet. Siehe `examples/claude-code/`.
- **OpenCode / dsh / Pi** — OpenAI-kompatibel: `baseURL` auf `http://127.0.0.1:8787/v1` und API-Schlüssel auf prismd-Token setzen. Unterstützt `responses` und `chat`. Siehe `examples/opencode/`, `examples/dsh/`, `examples/pi/`.

## Status, Web-UI & Modell-Erkennung

- **Web-UI-Dashboard (`GET /ui`)**:
  Öffnen Sie `http://127.0.0.1:8787/ui` im Browser. Zeigt Status-Badges (🟢 healthy, 🟡 rate_limited/cooldown, 🔴 unavailable), Quoten-Fortschrittsbalken, Token-Nutzung, Kontextgrößen, aktive Modelle und Live-Event-Logs. Unterstützt 7 Sprachen (English, 简体中文, 日本語, 한국어, Deutsch, Français, Español).

- **CLI-Statusbefehl (`prismd status` / `npm run status`)**:
  Status direkt im Terminal prüfen:
  ```bash
  prismd status          # Bei globaler Installation
  npm run status         # Im Quellcode-Repository
  ```
  Zeigt formatierte Tabellen mit Farbunterstützung. Passt sich automatisch der Systemsprache (`LANG`) an.

- **JSON-Status-API (`GET /v1/modelstatus`)**:
  Liefert vollständigen Snapshot aller Aliase, Modelle und Quoten (ohne Authentifizierung).

- **SSE-Echtzeitstream (`GET /v1/modelstatus/stream`)**:
  Echtzeit-Updates via Server-Sent Events abonnieren (ohne Authentifizierung).

- **Gesundheitsprüfung (`GET /healthz`)**:
  Liefert `{ "status": "ok", "uptime": ..., "candidates": [...] }` zurück.

- **Modell-Erkennung (`GET /v1/models`)**:
  Liefert die Liste aller Alias-Modelle im OpenAI-Format.

## Struktur

- `prismd.json` — Generierte Laufzeitkonfiguration.
- `presets/providers.json` — Voreingestellte Anbieter und kostenlose Modelle.
- `config.user.json` — Benutzerdefinierte Überschreibungen.
- `config.schema.json` — JSON Schema für `prismd.json`.
- `scripts/generate-config.mjs` — Konfigurationsgenerator.
- `scripts/generate-codex-catalog.mjs` — Codex-Katalog-Generator.
- `examples/` — Client-Konfigurationsbeispiele.
- `src/ingress/` — Client-Protokolleingänge.
- `src/egress/` — Upstream-Protokolladapter und HTTP-Schicht.
- `src/routes/` — Öffentliche Status- und Erkennungsrouten.
- `src/ui/` — Eingebettete Web-UI-Statusseite.
- `src/cli/` — CLI-Befehlsimplementierung.
- `src/core/` — Routing, Statusverwaltung und Quoten-Engine.
- `src/observability/` — Logging und Tracing.
- `src/keys.ts` — Schlüsselauflösung.
- `src/auth.ts` — Lokale Authentifizierung.

## Skripte

- `npm run dev` — Entwicklungsserver mit Watch-Modus
- `npm run build` / `npm start` — TypeScript-Kompilierung und Start
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Unit- und Integrationstests
- `npm run test:e2e` — E2E-Akzeptanztests
- `npm run status` — Formatierte Status- und Quotentabelle
- `npm run generate:config` — `prismd.json` neu generieren
- `npm run generate:codex-catalog` — `~/.codex/prismd-models.json` neu generieren
