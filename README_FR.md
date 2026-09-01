# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md)

Passerelle LLM locale agrégeant les API de modèles gratuits et à faible coût (OpenRouter, Groq, Cerebras, etc.) pour les agents de codage (Claude Code, Codex CLI, OpenCode, etc.), offrant une interface unifiée et stable avec routage et basculement (failover) automatiques.

Avec un point de terminaison local unique et un alias unifié (`free-auto`), prismd gère automatiquement :
- **Routage intelligent & Protection des quotas** : Sélectionne automatiquement les candidats disponibles selon la fenêtre de contexte et l'utilisation du quota quotidien ; rétrograde à 80 % de quota en fin de file.
- **Basculement transparent (Failover)** : Avant le début du flux, bascule automatiquement vers le candidat suivant en cas d'erreur 429/401/5xx ou de délai dépassé.
- **Conversion multi-protocoles** : Prise en charge native des protocoles OpenAI Responses, OpenAI Chat Completions et Anthropic Messages, permettant à tout agent de codage de se connecter facilement.

## Soutenir le projet

Si prismd vous fait gagner du temps ou des quotas, vous pouvez offrir un café à l'auteur :

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Démarrage rapide

### Option 1 : Installation globale via npm (Recommandé)

```bash
# Installer la version stable
npm install -g @prismd/prismd

# Ou le canal de préversion RC
# npm install -g @agentscraft/prismd

# Configurer les clés de fournisseurs et le token local de passerelle
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Token d'authentification locale, ex. openssl rand -hex 32

# Démarrer la passerelle (écoute sur 127.0.0.1:8787)
prismd
```

### Option 2 : Exécution depuis les sources

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # Remplir les clés API, chmod 600
npm run generate:config                    # Fusionner presets et clés pour générer prismd.json
npm run dev                                # Démarrer le serveur de développement
```

### Test de bon fonctionnement

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## Configuration des clients

Tous les agents clients ciblent le point de terminaison de la passerelle locale et utilisent le même token de protection locale (`PRISMD_API_KEY`).

### 1. Claude Code
Claude Code prend en charge nativement les points de terminaison Anthropic personnalisés via des variables d'environnement. Les noms de modèles standards (`claude-*-sonnet`, etc.) basculent automatiquement vers les alias configurés :
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Copiez le profil d'exemple et générez le catalogue de métadonnées des modèles :
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # Génère ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Configurez un point de terminaison OpenAI personnalisé dans Cursor :
- **Settings** → **Models** → activez **OpenAI API Key**, entrez `<your-prismd-local-token>`.
- Cochez **Override OpenAI Base URL**, entrez `http://127.0.0.1:8787/v1`.
- Ajoutez et activez les modèles `free-auto`, `free-fast`, `free-code`. Voir le [guide Cursor](examples/cursor/README.md).

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode** : Configurez `baseUrl: "http://127.0.0.1:8787/v1"` dans `~/.config/opencode/config.json`. Voir le [guide OpenCode](examples/opencode/README.md).
- **DeepSeek Harness (dsh)** : Configurez `base_url = "http://127.0.0.1:8787/v1"` dans `~/.dsh/config.toml`. Voir le [guide dsh](examples/dsh/README.md).
- **Pi Agent** : Configurez `endpoint: "http://127.0.0.1:8787/v1"` dans `~/.pi/config.json`. Voir le [guide Pi](examples/pi/README.md).

---

## Gestion des clés & Configuration

### Gestion des clés API
Les clés peuvent être définies dans le fichier `.env` à la racine du projet ou dans le répertoire global `~/.prismd/`. Priorité (de la plus haute à la plus basse) :
1. **Variables d'environnement** : `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, etc.
2. **Répertoire du projet** : `./.env` (copié depuis `.env.example`)
3. **Répertoire utilisateur global** : `~/.prismd/.env` ou `~/.prismd/keys.yaml` (permission recommandée : `chmod 600`)

### Personnalisation des candidats & Ordre de priorité
Surchargez les priorités ou ajoutez des modèles personnalisés dans `config.user.json`, puis régénérez la configuration :
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
Exécutez `npm run generate:config` (ou `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) pour appliquer les modifications.

Pour des instructions détaillées sur les principaux fournisseurs gratuits (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models, etc.), consultez les [Guides de configuration des fournisseurs](docs/providers/README.md).

---

## État & Observabilité

- **Tableau de bord Web** : Ouvrez `http://127.0.0.1:8787/ui` dans votre navigateur pour suivre l'état de santé des candidats, les barres de progression de quota, la consommation de tokens et le flux d'événements SSE.
- **Statut CLI** : Exécutez `prismd status` (ou `npm run status`) pour afficher un tableau formaté directement dans le terminal.
- **Logs structurés** : Logs JSON émis sur stderr avec masquage automatique des secrets et identifiant unique `request-id`.

---

## Fonctionnement & Limites

1. **Routage & Filtrage** :
   - Teste les candidats selon l'ordre configuré ;
   - Exclut strictement les modèles épuisés, trop petits ou en temps de recharge ;
   - Rétrograde en fin de file les modèles ayant atteint ≥ 80 % de quota.
2. **Limites de basculement (Failover)** :
   - **Avant le streaming** : En cas d'erreur 401/403/429/5xx ou de délai dépassé, tente le candidat suivant jusqu'à `maxCandidatesPerRequest`.
   - **Après le début du flux** : Aucun nouvel essai en cours de flux pour éviter des sorties tronquées ; termine proprement avec un événement SSE `error`.
3. **Limites des pools gratuits** :
   - Les modèles gratuits partagent des pools de capacité publics et peuvent générer des 429 fréquents aux heures de pointe. prismd bascule automatiquement ; si tous les candidats sont épuisés, un 429 est renvoyé avec les détails dans `error.metadata`.

---

## Dépannage

- **Erreurs 429 fréquentes** : Les pools gratuits sont saturés. Modifiez l'ordre dans `config.user.json` pour prioriser des modèles moins sollicités ou ajoutez des clés d'autres fournisseurs.
- **Candidats disparus après mise à jour** : Les versions antérieures utilisaient un format différent. Exécutez `npm run generate:config` pour actualiser `prismd.json`.
- **Réinitialiser les compteurs de quota** : Cliquez sur le bouton « Reset usage » dans le tableau de bord Web (`http://127.0.0.1:8787/ui`), ou arrêtez la passerelle et supprimez `data/prismd.sqlite`.
