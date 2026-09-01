# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

Pasarela LLM orientada a local que agrega APIs de modelos gratuitos o de baja cuota (OpenRouter, Groq, Cerebras, etc.) para agentes de programación. Un único punto de conexión local, un único alias (`free-auto`), y prismd se encarga del resto: selección de modelos candidatos disponibles, prevención de cuotas agotadas, conmutación por error (failover) transparente cuando el proveedor responde con un 429 y supervisión del estado en tiempo real. Soporta de forma nativa tres protocolos principales (OpenAI Responses, OpenAI Chat Completions, Anthropic Messages), permitiendo que Codex CLI, Claude Code, OpenCode y otros clientes compartan la misma pasarela.

## Apoyar el proyecto

Si prismd te ayuda a ahorrar tiempo o cuota, considera invitar a un café al autor:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

## Características principales

| Característica | Comportamiento |
| --- | --- |
| **Puntos de entrada multiprotocolo** | `POST /v1/responses` (OpenAI Responses, Codex), `POST /v1/chat/completions` (OpenAI Chat, OpenCode/dsh), `POST /v1/messages` (Anthropic Messages, Claude Code) — compartiendo los mismos alias, enrutamiento, cuotas y conmutación por error |
| **Conversión bidireccional de protocolos** | Chat↔Responses (conversión de salida, incluidos eventos de streaming con llamadas a herramientas) y Anthropic↔Chat (entrada); las solicitudes con protocolo idéntico pasan directamente |
| **Respaldo automático para modelos Claude** | Los nombres de modelos de Claude Code (`claude-*-sonnet/haiku/opus-*`) se resuelven automáticamente a alias configurados mediante una cadena de 9 pasos (sufijo de fecha, `-latest`, familia semántica, `free-auto`) |
| **Enrutamiento por alias** | `"model": "free-auto"` se resuelve a una lista ordenada de modelos candidatos definida en tu configuración |
| **Filtrado de candidatos** | Exclusión estricta de candidatos con cuota diaria agotada (`limits.dailyRequests`), ventana de contexto insuficiente para la entrada o en estado de enfriamiento. Degradación suave al final de la cola para candidatos al ≥ 80 % de su cuota |
| **Conmutación por error (Failover)** | *Antes de iniciar la transmisión*, ante errores 401/403/429/5xx, fallos de red o tiempos de espera agotados, se prueba automáticamente el siguiente candidato (hasta `maxCandidatesPerRequest`). Errores 4xx de solicitud (400/404/422) se devuelven sin reintento. Una vez comenzado el streaming, no se reintenta |
| **Contabilidad de cuotas y uso** | Registra el recuento de solicitudes y tokens (valores reales del proveedor o estimación de caracteres ÷ 4) en una base de datos SQLite local persistente |
| **Comprobaciones pasivas de salud** | 3 fallos consecutivos → enfriamiento de 60s → semiabierto (1 solicitud de prueba). Los errores de autenticación 401/403 se registran por separado |
| **Control de tiempos de espera** | Tiempo de espera de conexión (10s por defecto) y de inactividad de transmisión (300s por defecto), configurables por política |
| **Gestión de claves API** | Las claves se leen en `~/.prismd/` (`.env` o `keys.yaml`), nunca en el repositorio ni en `prismd.json`. Prioridad: Variable de entorno del sistema > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **Detección de modelos** | `GET /v1/models` lista todos los modelos de alias lógicos configurados en formato compatible con OpenAI sin necesidad de autenticación |
| **API de estado y SSE** | `GET /healthz` para salud de la pasarela; `GET /v1/modelstatus` para instantáneas en memoria; `GET /v1/modelstatus/stream` para transmisión SSE en tiempo real de cambios de cuota y salud |
| **Panel Web UI integrado** | `GET /ui` ofrece un panel independiente sin dependencias externas con insignias de estado, barras de progreso de cuota, métricas de tokens y registro de eventos |
| **Estado en terminal (CLI)** | `prismd status` (o `npm run status`) muestra una tabla formateada en la consola con soporte para modo sin conexión desde SQLite |
| **Observabilidad** | Registro estructurado JSON con pino en stderr con ID único por solicitud y enmascaramiento automático de credenciales |

## Inicio rápido

Desde el código fuente:

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # Introduce tus claves y ejecuta chmod 600
npm run generate:config                    # Fusiona presets + config.user.json + claves → prismd.json
npm run dev                                # Escucha en http://127.0.0.1:8787
```

O instala el paquete globalmente mediante npm:

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<tu-clave>
export PRISMD_API_KEY=<token-local>        # Generar: openssl rand -hex 32
prismd                                     # Escucha en http://127.0.0.1:8787
```

El servidor lee un único archivo: `prismd.json` (se puede cambiar la ruta con `PRISMD_CONFIG_PATH`). Con el paquete instalado, genéralo con `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`.

Prueba rápida:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## Claves API

prismd lee las claves de API desde el directorio `~/.prismd/`. Las claves nunca se guardan en Git ni en `prismd.json`. Prioridad de búsqueda:

| Campo | Variable de entorno | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd` (token local) | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- El nombre de la variable de entorno es el nombre del campo en mayúsculas seguido de `_API_KEY`.
- Se admiten ambos formatos (`.env` con `KEY=value` y `keys.yaml` con `field: value`). Ejemplos disponibles en `.env.example` y `keys.yaml.example`.
- Configura los permisos con `chmod 600`.
- El token local (`prismd`) protege los 3 puntos de conexión POST con `Authorization: Bearer <token>` o `x-api-key: <token>`. Las solicitudes no autenticadas reciben un 401 y no llegan a los proveedores externos.

## Configuración

`prismd.json` se genera automáticamente combinando tres capas:

| Capa | Archivo | Propósito |
| --- | --- | --- |
| Presets | `presets/providers.json` | Proveedores predeterminados, metadatos de modelos gratuitos (contexto, límites, etiquetas) y alias por defecto. |
| User overrides | `config.user.json` | Ajustes personalizados del usuario (orden de alias, modelos propios, políticas, servidor). Sin claves. |
| Keys | `~/.prismd/` | Solo los modelos con clave configurada se incluyen en la configuración generada. |

Ejecuta `npm run generate:config` tras cualquier modificación.

Ejemplo de `config.user.json`:

```jsonc
{
  "aliases": {
    "free-auto": {
      // Reordenar la prioridad de candidatos
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // Probar hasta 3 candidatos por solicitud
    "connectTimeoutMs": 5000          // Tiempo de espera de conexión reducido
  }
}
```

Definición directa de candidatos personalizados:

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

Se pueden añadir fácilmente nuevos proveedores con endpoints estándar `baseUrl` (`/responses` o `/chat/completions`).

## Mecanismo de enrutamiento

1. El alias se resuelve en la lista ordenada de candidatos configurada en `prismd.json`.
2. **Exclusión estricta**: Se eliminan candidatos con cuota diaria agotada (`limits.dailyRequests`), ventana de contexto menor que la entrada o en enfriamiento.
3. **Degradación suave**: Candidatos con consumo de cuota ≥ 80 % (`quotaSoftLimitRatio`) se mueven al final de la lista.
4. La solicitud se envía al primer candidato válido; si falla, la conmutación por error pasa al siguiente.

Errores devueltos directamente por la pasarela (formato OpenAI `{"error": {...}}`):

| Escenario | Estado HTTP | Código | Notas |
| --- | --- | --- | --- |
| Token ausente o incorrecto | 401 | `invalid_api_key` | No contacta con el proveedor externo |
| Alias desconocido | 404 | `model_not_found` | |
| Todos los candidatos agotados o no disponibles | 429 | `quota_exceeded` | `error.metadata` detalla los motivos de exclusión |
| Entrada supera todas las ventanas de contexto | 422 | `context_window_exceeded` | `error.metadata` enumera las ventanas de cada candidato |
| Todos los candidatos probados fallaron | 502 | `gateway_all_candidates_failed` | `error.metadata` lista los fallos por intento |
| Error interno | 500 | `gateway_internal_error` | |

## Conmutación por error (Failover)

- **Disparadores (antes de la transmisión)**: Fallo de conexión, tiempo de espera y respuestas de error 401, 403, 429, 5xx del proveedor. Se anota el fallo y se prueba el siguiente candidato hasta `maxCandidatesPerRequest`.
- **No disparadores**: Errores 4xx de cliente como 400/404/422 (al ser error en la solicitud, se devuelven directamente).
- **Durante la transmisión**: Nunca se reintenta. Si se corta el flujo, finaliza con un evento SSE `error`.
- Si una respuesta 429 incluye la cabecera `Retry-After` y `respectRetryAfter` está activo, el tiempo de enfriamiento se ajusta a `max(cooldownMs, Retry-After)`.

## Cuotas y gestión de uso

El uso se contabiliza en memoria y se guarda en SQLite (`data/prismd.sqlite`, modo WAL) cada 5 segundos o 20 registros, así como al detener el proceso.

| Tabla | Contenido |
| --- | --- |
| `usage_daily` | Agregados diarios (fecha, proveedor, modelo, solicitudes, tokens) que sobreviven a reinicios. |
| `request_log` | Registro detallado por solicitud (ID, alias, proveedor, modelo, estado, tokens, failover, duración). Se conserva 14 días. |

- Tokens: Valores reales devueltos por el proveedor o estimación conservadora (entrada = caracteres ÷ 4, salida = caracteres ÷ 4). Columna `source` (`real` / `estimated` / `mixed`).
- Permisos de directorio `0700` y base de datos `0600`. Para reiniciar contadores, borra `data/prismd.sqlite` o utiliza el botón de reinicio en el panel Web UI o CLI.

## Comprobaciones de salud (Health Checks)

Totalmente pasivas (sin sondeos activos innecesarios). Gestión en memoria por `(provider, model)`:

```
healthy → (3 fallos consecutivos) → cooldown 60s → half-open (1 solicitud de prueba)
              ↑                                                  éxito → healthy
              └──────────────────────────────────────── fallo → nuevo cooldown
```

## Referencia de políticas (`policies`)

Opciones configurables en `config.user.json` (valores por defecto):

| Opción | Por defecto | Significado |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | Códigos de estado que activan failover |
| `retryBeforeStream` | `true` | Reintentar otros candidatos antes del streaming |
| `retryAfterStream` | `false` | No reintentar una vez iniciado el streaming |
| `maxCandidatesPerRequest` | `2` | Máximo de candidatos probados por solicitud |
| `respectRetryAfter` | `true` | Respetar cabecera `Retry-After` en enfriamiento |
| `quotaSoftLimitRatio` | `0.8` | Ratio de cuota diaria para degradación suave |
| `connectTimeoutMs` | `10000` | Tiempo de espera de conexión (ms) |
| `streamIdleTimeoutMs` | `300000` | Tiempo máximo de inactividad entre fragmentos (ms) |
| `failThreshold` | `3` | Fallos consecutivos para entrar en enfriamiento |
| `cooldownMs` | `60000` | Duración del tiempo de enfriamiento (ms) |

## Integración con Codex

1. Copia el perfil de ejemplo y genera el catálogo:

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. Ejecutar:

```bash
PRISMD_API_KEY=<token-local> codex --profile prismd
```

- El perfil utiliza el alias `free-auto`. El catálogo asigna a cada alias la ventana de contexto **mínima** entre sus candidatos para evitar desbordamientos.
- Mantén bajos los reintentos de Codex: `request_max_retries = 0` (la pasarela gestiona el failover) y `stream_max_retries = 1`.

## Otros clientes (Claude Code, OpenCode, dsh, Pi)

Todos los clientes comparten los mismos alias (`free-auto`, `free-fast`, `free-code`) y token local:

- **Claude Code** — Protocolo Anthropic Messages: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` y `ANTHROPIC_AUTH_TOKEN` (o `x-api-key`) con tu token de prismd. Los nombres de modelo de Claude se asignan automáticamente. Ver `examples/claude-code/`.
- **OpenCode / dsh / Pi** — Compatible con OpenAI: establecer `baseURL` en `http://127.0.0.1:8787/v1` y la clave API en el token de prismd. Soporta tanto `responses` como `chat`. Ver `examples/opencode/`, `examples/dsh/`, `examples/pi/`.

## Estado, Panel Web UI y Detección

- **Panel Web UI (`GET /ui`)**:
  Abre `http://127.0.0.1:8787/ui` en el navegador. Muestra insignias de estado en tiempo real (🟢 healthy, 🟡 rate_limited/cooldown, 🔴 unavailable), barras de progreso de cuota, métricas de tokens, modelos activos y registro de eventos. Admite 7 idiomas (English, 简体中文, 日本語, 한국어, Deutsch, Français, Español).

- **Comando de estado CLI (`prismd status` / `npm run status`)**:
  Consulta el estado directamente desde la terminal:
  ```bash
  prismd status          # Instalación global
  npm run status         # Desde el repositorio
  ```
  Muestra una tabla coloreada con detección automática del idioma del sistema (`LANG`).

- **API de estado JSON (`GET /v1/modelstatus`)**:
  Devuelve una instantánea completa en memoria sin accesos a disco (sin autenticación).

- **Flujo SSE en tiempo real (`GET /v1/modelstatus/stream`)**:
  Suscríbete a cambios de estado mediante Server-Sent Events (sin autenticación).

- **Comprobación de salud (`GET /healthz`)**:
  Devuelve `{ "status": "ok", "uptime": ..., "candidates": [...] }`.

- **Detección de modelos (`GET /v1/models`)**:
  Lista de modelos de alias en formato estándar compatible con OpenAI.

## Estructura del proyecto

- `prismd.json` — Configuración de ejecución generada (fuera de Git).
- `presets/providers.json` — Definiciones de proveedores predeterminados y modelos gratuitos.
- `config.user.json` — Sobrescrituras del usuario.
- `config.schema.json` — Validación JSON Schema para `prismd.json`.
- `scripts/generate-config.mjs` — Generador de configuración.
- `scripts/generate-codex-catalog.mjs` — Generador de catálogo para Codex.
- `examples/` — Ejemplos de configuración para clientes.
- `src/ingress/` — Puntos de entrada para protocolos de cliente.
- `src/egress/` — Adaptadores de protocolo saliente y capa HTTP.
- `src/routes/` — Rutas públicas de estado y descubrimiento.
- `src/ui/` — Página Web UI integrada en un único archivo.
- `src/cli/` — Comandos CLI.
- `src/core/` — Enrutamiento, máquina de estados y contabilidad de cuotas.
- `src/observability/` — Registro estructurado con pino y trazabilidad.
- `src/keys.ts` — Resolución de claves API.
- `src/auth.ts` — Validación del token local.

## Scripts disponibles

- `npm run dev` — Servidor de desarrollo con recarga automática
- `npm run build` / `npm start` — Compilación TypeScript y ejecución de producción
- `npm run typecheck` — Comprobación de tipos `tsc --noEmit`
- `npm test` — Pruebas unitarias y de integración
- `npm run test:e2e` — Pruebas de aceptación E2E
- `npm run status` — Tabla formateada de estado y cuotas
- `npm run generate:config` — Regeneración de `prismd.json`
- `npm run generate:codex-catalog` — Regeneración de `~/.codex/prismd-models.json`
