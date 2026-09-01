# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

Pasarela LLM local que agrega APIs de modelos gratuitos y de bajo coste (OpenRouter, Groq, Cerebras, etc.) para agentes de programación (Claude Code, Codex CLI, OpenCode y otros), ofreciendo una interfaz estable y unificada con enrutamiento y conmutación por error (failover) automáticos.

Con un único punto de conexión local y un alias unificado (`free-auto`), prismd gestiona automáticamente:
- **Enrutamiento inteligente y protección de cuotas**: Selecciona automáticamente los candidatos disponibles según la ventana de contexto y el consumo de cuota diaria; degrada al final de la cola a los modelos con ≥ 80 % de cuota consumida.
- **Conmutación por error (Failover) sin cortes**: Antes de iniciar la transmisión, cambia automáticamente al siguiente candidato ante errores 429/401/5xx o tiempos de espera agotados.
- **Conversión multiprotocolo**: Soporte nativo para los protocolos OpenAI Responses, OpenAI Chat Completions y Anthropic Messages, permitiendo conectar cualquier agente de programación sin fricciones.

## Apoyar el proyecto

Si prismd te ayuda a ahorrar tiempo o cuota, considera invitar a un café al autor:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Inicio rápido

### Opción 1: Instalación global mediante npm (Recomendado)

```bash
# Instalar versión estable
npm install -g @prismd/prismd

# O canal de vista previa RC
# npm install -g @agentscraft/prismd

# Configurar claves de proveedores y token local de la pasarela
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Token de autenticación local, ej. openssl rand -hex 32

# Iniciar la pasarela (escucha en 127.0.0.1:8787)
prismd
```

### Opción 2: Ejecución desde el código fuente

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # Introducir claves API, chmod 600
npm run generate:config                    # Fusionar presets y claves para generar prismd.json
npm run dev                                # Iniciar servidor de desarrollo
```

### Prueba rápida de funcionamiento

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## Configuración de clientes

Todos los agentes cliente apuntan al endpoint local de la pasarela y utilizan el mismo token de protección local (`PRISMD_API_KEY`).

### 1. Claude Code
Claude Code admite de forma nativa endpoints personalizados de Anthropic mediante variables de entorno. Los nombres de modelo estándar (`claude-*-sonnet`, etc.) se resuelven automáticamente a los alias configurados:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Copia el perfil de ejemplo y genera el catálogo de metadatos de modelos:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # Genera ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Configura un endpoint personalizado de OpenAI en Cursor:
- **Settings** → **Models** → activa **OpenAI API Key**, introduce `<your-prismd-local-token>`.
- Marca **Override OpenAI Base URL**, introduce `http://127.0.0.1:8787/v1`.
- Añade y activa los modelos `free-auto`, `free-fast`, `free-code`. Consulta la [guía de Cursor](examples/cursor/README.md).

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: Configura `baseUrl: "http://127.0.0.1:8787/v1"` en `~/.config/opencode/config.json`. Consulta la [guía de OpenCode](examples/opencode/README.md).
- **DeepSeek Harness (dsh)**: Configura `base_url = "http://127.0.0.1:8787/v1"` en `~/.dsh/config.toml`. Consulta la [guía de dsh](examples/dsh/README.md).
- **Pi Agent**: Configura `endpoint: "http://127.0.0.1:8787/v1"` en `~/.pi/config.json`. Consulta la [guía de Pi](examples/pi/README.md).

---

## Gestión de claves y configuración

### Gestión de claves API
Las claves se pueden configurar en el archivo `.env` en la raíz del proyecto o en el directorio global `~/.prismd/`. Prioridad de búsqueda (mayor a menor):
1. **Variables de entorno**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, etc.
2. **Directorio raíz del proyecto**: `./.env` (copiado desde `.env.example`)
3. **Directorio global de usuario**: `~/.prismd/.env` o `~/.prismd/keys.yaml` (permiso recomendado: `chmod 600`)

### Personalización de candidatos y orden
Sobrescribe prioridades o añade modelos personalizados en `config.user.json` y regenera la configuración:
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
Ejecuta `npm run generate:config` (o `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) para aplicar los cambios.

Para instrucciones detalladas sobre los principales proveedores gratuitos (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.), consulta las [Guías de configuración de proveedores](docs/providers/README.md).

---

## Estado y Observabilidad

- **Panel Web UI**: Abre `http://127.0.0.1:8787/ui` en tu navegador para ver el estado de salud de los modelos, barras de progreso de cuota, consumo de tokens y flujo de eventos SSE en tiempo real.
- **Estado en CLI**: Ejecuta `prismd status` (o `npm run status`) para ver tablas con métricas en la terminal.
- **Registros estructurados**: Logs JSON emitidos a stderr con enmascaramiento automático de credenciales y seguimiento mediante `request-id` único.

---

## Funcionamiento y Limitaciones

1. **Enrutamiento y filtrado**:
   - Prueba candidatos en el orden configurado;
   - Excluye estrictamente modelos agotados, con ventana insuficiente o en enfriamiento;
   - Degrada al final de la cola a modelos con ≥ 80 % de cuota diaria consumida.
2. **Límites de conmutación por error (Failover)**:
   - **Antes de la transmisión**: Ante 401/403/429/5xx o timeout de conexión, prueba el siguiente candidato hasta `maxCandidatesPerRequest`.
   - **Después de iniciar el flujo**: No se reintenta en mitad del streaming para evitar respuestas corruptas, finalizando limpiamente con un evento SSE `error`.
3. **Limitaciones de las cuotas gratuitas**:
   - Los modelos gratuitos comparten capacidad pública y pueden experimentar 429 frecuentes en horas punta. prismd los esquiva automáticamente; si todos se agotan, devuelve un 429 con detalles en `error.metadata`.

---

## Solución de problemas

- **Errores 429 frecuentes**: Los grupos de modelos gratuitos están congestionados. Reordena `free-auto` en `config.user.json` para priorizar modelos con menor demanda o añade claves de otros proveedores.
- **Modelos desaparecidos tras actualizar**: Versiones anteriores utilizaban un formato de clave diferente. Ejecuta `npm run generate:config` para actualizar `prismd.json`.
- **Reiniciar contadores de cuota**: Pulsa el botón «Reset usage» en el Panel Web (`http://127.0.0.1:8787/ui`), o detén la pasarela y borra `data/prismd.sqlite`.
