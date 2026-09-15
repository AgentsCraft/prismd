# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

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

### Paso 1: Instalación

```bash
# Opción A: Instalación global con npm
npm install -g @prismd/prismd              # Versión estable
# O canal de vista previa RC (alineado con develop):
npm install -g @agentscraft/prismd         # Canal RC

# Opción B: Ejecutar desde el código fuente
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### Paso 2: Inicialización y Ejecución

Ejecuta el asistente de configuración interactivo:
```bash
prismd init
# Source install: node dist/server.js init
```
El asistente te guiará para:
1. Definir tu token local (`prismd:`).
2. Seleccionar proveedores gratuitos (OpenRouter, Groq, Google Gemini, etc.) e ingresar sus claves.
3. **Configurar automáticamente tus agentes** (Claude Code, Codex CLI, OpenCode, Pi Agent) con copias de seguridad automáticas (`.bak.<marca_de_tiempo>`) de tus archivos existentes.

*(¿Prefieres configuración manual? Edita `~/.prismd/keys.yaml` o define `PRISMD_HOME`).*

```yaml
# Configuración manual: ~/.prismd/keys.yaml (permisos recomendados: chmod 600)
prismd: "YOUR_PRISMD_TOKEN"      # Token de protección local (usado por los clientes)

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
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **Guías de configuración de proveedores**: Consulte las [Guías de integración de proveedores](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) para obtener claves y detalles.

### Paso 3: Configuración del Agente

| Cliente | Inicio Rápido (`prismd init` auto-config) | Guía |
|---|---|---|
| **Claude Code** | `claude` (configurado en `~/.claude/settings.json`) | [Guía](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (configurado en `~/.codex/config.toml` & `auth.json`) | [Guía](examples/codex/README.md) |
| **OpenCode** | `opencode` (configurado en `~/.config/opencode/opencode.json`) | [Guía](examples/opencode/README.md) |
| **Pi Agent** | `pi` (configurado en `~/.pi/config.json`) | [Guía](examples/pi/README.md) |
| **Cursor** | Settings → Models → Activar OpenAI API Key (`YOUR_PRISMD_TOKEN`)<br>Marcar **Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Añadir modelo: `free-auto` | [Guía](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | Configurar `base_url = "http://127.0.0.1:8787/v1"` en `~/.dsh/config.toml`<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [Guía](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [Guía](examples/aider/README.md) |

> 📖 **Documentación completa**: Consulte el [índice de documentación](docs/README.md), la [guía de integración de clientes](docs/clients/README.md) y la [configuración](docs/configuration.md).

---
