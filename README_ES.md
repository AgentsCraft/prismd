# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

**Pasarela LLM local de alta disponibilidad** que unifica APIs gratuitas y de bajo costo (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.) y LLMs locales (Ollama). Proporciona una interfaz unificada, estable e ininterrumpida para agentes de código (Claude Code, Codex CLI, Cursor, OpenCode, Aider, etc.).

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

## Características Principales

1. **Alias Unificado (`free-auto`)**: Olvídate de elegir modelos; prismd selecciona automáticamente el mejor modelo gratuito disponible.
2. **Grupo Multi-Key y Aislamiento de Fallos (Key Pool)**: Supera los límites de tasa (RPM). Configura múltiples claves por proveedor con balanceo round-robin. Si una clave recibe un 429, solo esa clave entra en enfriamiento y el tráfico pasa inmediatamente a la siguiente.
3. **Respaldo Local Opcional (Ollama / LM Studio)**: Los alias por defecto son solo de nube. ¿Tienes un backend local? Añádelo a la cola de un alias mediante `config.user.json`; cuando los modelos de nube se agoten o caiga la red, las solicitudes pasarán a tus modelos locales.
4. **Conversión Multi-Protocolo Bidireccional**: Soporte nativo para Claude Code (Messages), Codex (Responses) y Cursor/OpenCode (Chat Completions).
5. **Panel Web Integrado y Recarga en Caliente (SIGHUP)**: Monitoriza el estado en vivo en `http://127.0.0.1:8787/ui`. Actualiza configuraciones sin reiniciar mediante la señal `SIGHUP`.

---

## Apoyo al Proyecto

Si prismd te ayuda a ahorrar tiempo o cuotas de API, puedes invitar a un café al autor:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Inicio Rápido en 3 Pasos

### Paso 1: Instalación y Ejecución

```bash
# Opción A: Instalación global con npm
npm install -g @prismd/prismd              # Versión estable
# O canal de vista previa RC (alineado con develop):
npm install -g @agentscraft/prismd         # Canal RC

# Opción B: Ejecutar desde el código fuente
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### Paso 2: Configuración de Claves API

Añade tus claves en `~/.prismd/keys.yaml` o en `./.env` (configura uno o más; los no configurados se omiten automáticamente):

```yaml
# ~/.prismd/keys.yaml (permisos recomendados: chmod 600)
prismd: "mi-secreto-local"      # Token de protección local (usado por los clientes)

# Proveedores Cloud (admite clave única o pool multi-key para round-robin):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Multi-key pooling y aislamiento de enfriamiento
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # Token de acceso personal de GitHub Models
amd: "amd_token_xxxx"           # Opcional: Token de AMD Developer Cloud

# Respaldo local sin conexión:
# ollama: Sin claves requeridas (enrutamiento automático a http://127.0.0.1:11434/v1)
```

Iniciar la pasarela:
```bash
prismd
# O en modo fuente: npm run generate:config && npm run dev
```

> 📖 **Guías de configuración de proveedores**: Consulte las [Guías de integración de proveedores](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) para obtener claves y detalles.

### Paso 3: Configuración del Agente

| Cliente | Configuración Rápida | Guía |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="mi-secreto-local"`<br>`claude` | [Guía](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=mi-secreto-local codex --profile prismd` | [Guía](examples/codex/README.md) |
| **Cursor** | Settings → Models → Activar OpenAI API Key (`mi-secreto-local`)<br>Marcar **Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Añadir modelo: `free-auto` | [Guía](examples/cursor/README.md) |
| **OpenCode** | Configurar `baseUrl: "http://127.0.0.1:8787/v1"` en `~/.config/opencode/config.json` | [Guía](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | Configurar `base_url = "http://127.0.0.1:8787/v1"` en `~/.dsh/config.toml`<br>`PRISMD_API_KEY=mi-secreto-local dsh --model prismd:free-auto` | [Guía](examples/dsh/README.md) |
| **Pi Agent** | Configurar `endpoint: "http://127.0.0.1:8787/v1"` en `~/.pi/config.json`<br>`pi run` | [Guía](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="mi-secreto-local"` `aider --model openai/free-auto` | [Guía](examples/aider/README.md) |

> 📖 **Documentación completa**: Consulte la [Guía de integración de clientes](docs/clients/README.md) para detalles de protocolos y configuraciones.

---

## Funcionalidades Detalladas

### 1. Enrutamiento Inteligente y Conmutación por Error

prismd selecciona dinámicamente el mejor modelo candidato para cada solicitud mediante una canalización de evaluación:

- **Verificación de ventana de contexto (Context Window Check)**: Estima tokens previamente; descarta modelos con ventana insuficiente evitando errores 400 Context Overflow.
- **Límites suaves de cuota (Quota-Weighted Soft Limit)**: Al alcanzar el 80 % de cuota diaria (`quotaSoftLimitRatio`), el modelo se desplaza al final de la cola para reservar cupo restante.
- **Conmutación sin fallos (Zero-Crash Failover)**: Ante errores 429 de límite o 5xx de caída, prismd conmuta automáticamente al siguiente candidato en cola de forma transparente.
- **Alias por Defecto**:
  - `free-auto`: Cola principal de código (prioridad Gemini 2.0 Flash / Llama 3.3 70B, solo nube de forma predeterminada).
  - `free-fast`: Cola ultrarrápida y ligera (Gemini Flash Lite / Llama 3.1 8B).
  - `free-code`: Cola especializada en generación y prueba de código.

### 2. Multi-Key y Aislamiento de Errores (Key Pool)

Todos los proveedores Cloud (Groq, Cerebras, Google Gemini, OpenRouter, NVIDIA NIM, GitHub Models, etc.) admiten configuración multi-key para distribución round-robin y aislamiento de fallos:

- **Formato `~/.prismd/keys.yaml`** (lista YAML o array en línea):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **Formato `.env` o variables de entorno** (separadas por comas):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **Funcionamiento**: Las solicitudes se distribuyen mediante Round-Robin entre las claves sanas. Cuando una clave (p. ej. `gsk_key1`) recibe un error 429, solo esa clave entra en enfriamiento (`Retry-After`), y las solicitudes posteriores pasan inmediatamente a `gsk_key2` o al siguiente candidato.

### 3. Respaldo Local LLM (Ollama & LM Studio, opcional)

prismd incluye Ollama y LM Studio como proveedores integrados, pero los alias por defecto son solo de nube. ¿Ejecutas un servicio local? Añádelo como candidato vía `config.user.json`:

- **Ollama**: Proveedor integrado cero configuración (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: Servidor local compatible con OpenAI (`http://127.0.0.1:1234/v1`) con modelos GGUF. Consulte la [Guía de LM Studio](docs/providers/lmstudio.md).
- Las tareas de los agentes continúan sin interrumpirse.

### 4. Puente Multiprotocolo Transparente

Conversión bidireccional en streaming entre los tres principales protocolos de agentes:
- **Anthropic Messages** (`POST /v1/messages`): Soporte total de Claude Code (Tools, bloques Thinking, flujos SSE).
- **OpenAI Responses** (`POST /v1/responses`): Compatible con Codex CLI y DeepSeek Harness (`dsh`).
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): Interfaz estándar para Cursor, OpenCode, Pi Agent y Aider.

### 5. Configuración Extensible (`config.user.json`)

Declare proveedores propios, modelos privados y colas de alias en `config.user.json`:

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
Regenere la configuración con `npm run generate:config`.

### 6. Recarga Dinámica en Caliente (`SIGHUP`)

Actualice tablas de enrutamiento y claves sin reiniciar el proceso ni cortar flujos en ejecución:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## Monitorización y Panel Web

- **Panel Web**: Abre `http://127.0.0.1:8787/ui` en tu navegador:
  - Estado de salud en tiempo real (`healthy` / `rate_limited` / `cooldown`)
  - Barras de progreso de cuotas y estadísticas de tokens
  - Selector de 10 idiomas y botón de «Restablecer uso (Reset usage)»
- **Estado CLI**:
  ```bash
  prismd status
  ```
  Muestra una matriz a color en la terminal.

---

## Solución de Problemas

- **Q: ¿Error `missing API key for provider`?**
  - Revisa `~/.prismd/keys.yaml` o `.env` y ejecuta `npm run generate:config`.
- **Q: ¿Errores 429 frecuentes?**
  - Añade más claves para ese proveedor, o agrega un candidato local de Ollama a la cola vía `config.user.json`.
- **Q: ¿Cómo restablecer los contadores diarios?**
  - Haz clic en «Reset usage» en el panel Web o elimina `data/prismd.sqlite`.
