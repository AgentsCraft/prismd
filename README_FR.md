# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**Passerelle LLM locale haute disponibilité**, agrégeant les API de modèles gratuits et à faible coût (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.) et les LLM locaux (Ollama). Fournit une interface unifiée, stable et sans interruption pour vos agents de code (Claude Code, Codex CLI, Cursor, OpenCode, Aider, etc.).

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

## Points Clés

1. **Alias Unique (`free-auto`)** : Plus besoin de choisir manuellement ; prismd sélectionne automatiquement le meilleur modèle gratuit disponible.
2. **Pool Multi-Clés & Isolation (Key Pool)** : Dépassez les limites de requêtes (RPM). Configurez plusieurs clés pour une rotation round-robin. Si une clé atteint l'erreur 429, seule cette clé est mise en pause et le trafic passe instantanément à la suivante.
3. **Repli local optionnel (Ollama / LM Studio)** : Les alias par défaut sont réservés au cloud. Un backend tourne en local ? Ajoutez-le à une file via `config.user.json` — quand les modèles cloud s'épuisent ou que le réseau tombe, les requêtes basculent vers vos modèles locaux.
4. **Conversion Multi-Protocoles Bidirectionnelle** : Prise en charge native de Claude Code (Messages), Codex (Responses) et Cursor/OpenCode (Chat Completions).
5. **Tableau de Bord Web & Rechargement à Chaud (SIGHUP)** : Visualisez l'état en direct sur `http://127.0.0.1:8787/ui`. Mettez à jour vos configurations sans redémarrage via le signal `SIGHUP`.

---

## Soutenir le Projet

Si prismd vous fait gagner du temps ou des quotas, vous pouvez offrir un café à l'auteur :

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Démarrage Rapide en 3 Étapes

### Étape 1 : Installation

```bash
# Option A : Installation globale npm
npm install -g @prismd/prismd              # Version stable
# Ou canal de préversion RC (aligné sur develop) :
npm install -g @agentscraft/prismd         # Canal RC

# Option B : Exécution depuis les sources
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### Étape 2 : Initialisation et Lancement

Exécutez l'assistant de configuration interactif :
```bash
prismd init
# Source install: node dist/server.js init
```
L'assistant vous permet de :
1. Définir votre jeton local (`prismd:`).
2. Choisir vos fournisseurs gratuits (OpenRouter, Groq, Google Gemini etc.) et saisir vos clés.
3. **Configurer automatiquement vos clients d'encodage** (Claude Code, Codex CLI, OpenCode, Pi Agent) avec sauvegardes automatiques (`.bak.<horodatage>`) !

*(Vous préférez la configuration manuelle ? Éditez `~/.prismd/keys.yaml` ou utilisez `PRISMD_HOME`).*

```yaml
# Configuration manuelle : ~/.prismd/keys.yaml (permissions recommandées : chmod 600)
prismd: "YOUR_PRISMD_TOKEN"      # Jeton de protection local (utilisé par les clients)

# Fournisseurs Cloud (clé unique ou pool multi-clés pour rotation automatique) :
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Pool multi-clés & isolation de refroidissement
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # Jeton d'accès personnel GitHub Models
amd: "amd_token_xxxx"           # Optionnel : Jeton AMD Developer Cloud

# Repli local hors-ligne :
# ollama: Aucune clé requise (route automatiquement vers http://127.0.0.1:11434/v1)
```

Lancer la passerelle :
```bash
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **Guides des fournisseurs** : Consultez le [Guide des fournisseurs de modèles](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) pour l'obtention des clés et la configuration.

### Étape 3 : Configurer votre Agent

| Client | Démarrage Rapide (`prismd init` auto-config) | Guide |
|---|---|---|
| **Claude Code** | `claude` (configuré dans `~/.claude/settings.json`) | [Guide](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (configuré dans `~/.codex/config.toml` & `auth.json`) | [Guide](examples/codex/README.md) |
| **OpenCode** | `opencode` (configuré dans `~/.config/opencode/opencode.json`) | [Guide](examples/opencode/README.md) |
| **Pi Agent** | `pi` (configuré dans `~/.pi/config.json`) | [Guide](examples/pi/README.md) |
| **Cursor** | Settings → Models → Activer OpenAI API Key (`YOUR_PRISMD_TOKEN`)<br>**Override OpenAI Base URL** : `http://127.0.0.1:8787/v1`<br>Ajouter le modèle : `free-auto` | [Guide](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | Définir `base_url = "http://127.0.0.1:8787/v1"` dans `~/.dsh/config.toml`<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [Guide](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [Guide](examples/aider/README.md) |

> 📖 **Documentation complète** : Voir l'[index de documentation](docs/README.md), le [guide d'intégration des clients](docs/clients/README.md) et la [configuration](docs/configuration.md).

---
