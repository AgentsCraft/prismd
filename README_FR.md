# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

Passerelle LLM locale agrégeant les API de modèles gratuits ou à faible quota (OpenRouter, Groq, Cerebras, etc.) pour les agents de codage. Un seul point de terminaison local, un seul alias (`free-auto`), et prismd s'occupe du reste : sélection d'un modèle candidat fonctionnel, prévention de l'épuisement des quotas, basculement automatique en cas d'erreur 429 en amont et suivi de l'état en temps réel. Prend en charge nativement trois protocoles majeurs (OpenAI Responses, OpenAI Chat Completions, Anthropic Messages), permettant à Codex CLI, Claude Code, OpenCode et d'autres clients de partager la même passerelle.

## Soutenir le projet

Si prismd vous fait gagner du temps ou des quotas, vous pouvez offrir un café à l'auteur :

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

## Fonctionnalités principales

| Fonctionnalité | Comportement |
| --- | --- |
| **Points d'entrée multi-protocoles** | `POST /v1/responses` (OpenAI Responses, Codex), `POST /v1/chat/completions` (OpenAI Chat, OpenCode/dsh), `POST /v1/messages` (Anthropic Messages, Claude Code) — partageant tous les mêmes alias, routages, quotas et basculements |
| **Conversion de protocoles** | Chat↔Responses (conversion de sortie, y compris les événements de streaming tool-call) et Anthropic↔Chat (entrée) ; les flux avec protocole identique passent directement |
| **Repli automatique pour Claude** | Les noms de modèles Claude Code (`claude-*-sonnet/haiku/opus-*`) sont automatiquement résolus vers les alias configurés via une chaîne de repli en 9 étapes (suffixe de date, `-latest`, famille sémantique, `free-auto`) |
| **Routage par alias** | `"model": "free-auto"` est résolu vers une liste ordonnée de modèles candidats définis dans votre configuration |
| **Filtrage des candidats** | Exclusion stricte des candidats dont le quota quotidien est épuisé (`limits.dailyRequests`), dont la fenêtre de contexte est insuffisante ou qui sont en temps de recharge. Rétrogradation douce en fin de file pour les candidats à ≥ 80 % de quota |
| **Basculement (Failover)** | *Avant le début du flux*, en cas d'erreur 401/403/429/5xx, de problème de connexion ou de délai dépassé, passage automatique au candidat suivant (jusqu'à `maxCandidatesPerRequest`). Les erreurs 4xx de requête (400/404/422) sont renvoyées directement. Aucun nouvel essai après le début du flux |
| **Comptabilisation des quotas** | Enregistre le nombre de requêtes et de tokens (valeurs réelles ou estimation à nb_caractères ÷ 4) dans une base SQLite locale persistante |
| **Contrôles d'état passifs** | 3 échecs consécutifs → temps de recharge de 60s → demi-ouvert (1 requête de test). Les erreurs 401/403 sont isolées |
| **Gestion des délais d'attente** | Délai de connexion (par défaut 10s) et délai d'inactivité du flux (par défaut 300s), configurables par politique |
| **Gestion des clés API** | Les clés sont lues dans `~/.prismd/` (`.env` ou `keys.yaml`), jamais dans le dépôt ni dans `prismd.json`. Priorité : Variable d'environnement système > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **Découverte de modèles** | `GET /v1/models` liste tous les modèles d'alias configurés au format compatible OpenAI sans authentification |
| **API d'état & SSE** | `GET /healthz` pour la santé globale ; `GET /v1/modelstatus` pour un instantané en mémoire ; `GET /v1/modelstatus/stream` pour les mises à jour SSE en temps réel |
| **Interface Web intégrée** | `GET /ui` propose un tableau de bord autonome sans dépendance externe affichant les badges d'état, barres de quota, compteurs de tokens et journal d'événements |
| **Statut en ligne de commande** | `prismd status` (ou `npm run status`) affiche un tableau formaté en terminal avec bascule hors ligne SQLite |
| **Observabilité** | Logs structurés JSON pino sur stderr avec identifiant unique par requête et masquage automatique des secrets |

## Démarrage rapide

Depuis les sources :

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # Remplir les clés, puis chmod 600
npm run generate:config                    # Fusionne presets + config.user.json + clés → prismd.json
npm run dev                                # Écoute sur http://127.0.0.1:8787
```

Ou installation globale via le paquet npm :

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<votre-clé>
export PRISMD_API_KEY=<token-local>        # Génération : openssl rand -hex 32
prismd                                     # Écoute sur http://127.0.0.1:8787
```

L'exécutable lit un seul fichier : `prismd.json` (modifiable via `PRISMD_CONFIG_PATH`). Avec le paquet installé, générez-le via `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`.

Test de bon fonctionnement :

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## Clés API

prismd lit les clés dans le répertoire `~/.prismd/`. Les clés ne sont jamais écrites dans Git ou `prismd.json`. Priorité :

| Champ | Variable d'environnement | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd` (token local) | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- Le nom de la variable d'environnement correspond au nom du champ en majuscules suivi de `_API_KEY`.
- Les deux formats `.env` (`KEY=value`) et `keys.yaml` (`field: value`) sont supportés. Exemples dans `.env.example` et `keys.yaml.example`.
- Appliquez `chmod 600` sur ces fichiers.
- Le token local (`prismd`) protège les 3 points d'entrée POST via `Authorization: Bearer <token>` ou `x-api-key: <token>`. Une requête non authentifiée reçoit une 401 et ne sollicite pas l'amont.

## Configuration

`prismd.json` est généré automatiquement par un script qui fusionne trois couches :

| Couche | Fichier | Rôle |
| --- | --- | --- |
| Presets | `presets/providers.json` | Fournisseurs intégrés, métadonnées des modèles gratuits (contexte, limites, tags) et alias par défaut. |
| User overrides | `config.user.json` | Surcharges utilisateur (ordre des alias, modèles personnalisés, politiques, serveur). Pas de clés ici. |
| Keys | `~/.prismd/` | Seuls les modèles dont le fournisseur possède une clé configurée sont inclus. |

Exécutez `npm run generate:config` après toute modification.

Exemple de `config.user.json` :

```jsonc
{
  "aliases": {
    "free-auto": {
      // Réorganiser l'ordre de priorité
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // Essayer jusqu'à 3 candidats par requête
    "connectTimeoutMs": 5000          // Délai de connexion réduit
  }
}
```

Définition directe de candidats personnalisés :

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

L'ajout de nouveaux fournisseurs standards (`baseUrl` en `/responses` ou `/chat/completions`) est entièrement pris en charge.

## Mécanisme de routage

1. L'alias est converti en une liste ordonnée de modèles candidats.
2. **Exclusion stricte** : Élimination des candidats avec quota quotidien épuisé (`limits.dailyRequests`), fenêtre de contexte insuffisante ou en temps de recharge.
3. **Rétrogradation douce** : Les candidats à ≥ 80 % de quota (`quotaSoftLimitRatio`) sont déplacés en fin de liste.
4. La requête est envoyée au premier candidat valide ; en cas d'échec, le basculement passe au suivant.

Erreurs retournées directement par la passerelle (format OpenAI `{"error": {...}}`) :

| Scénario | Statut | Code d'erreur | Remarques |
| --- | --- | --- | --- |
| Token manquant / incorrect | 401 | `invalid_api_key` | Amont non contacté |
| Alias inconnu | 404 | `model_not_found` | |
| Tous les candidats épuisés / en panne | 429 | `quota_exceeded` | `error.metadata` détaille les raisons du filtrage |
| Contexte d'entrée trop grand | 422 | `context_window_exceeded` | `error.metadata` liste les fenêtres des candidats |
| Échec de tous les candidats essayés | 502 | `gateway_all_candidates_failed` | `error.metadata` liste les statuts d'échec |
| Erreur interne | 500 | `gateway_internal_error` | |

## Basculement (Failover)

- **Déclencheurs (avant le streaming)** : Échec de connexion, délai dépassé et erreurs amont 401, 403, 429, 5xx. Enregistre l'échec et tente le candidat suivant (jusqu'à `maxCandidatesPerRequest`).
- **Non déclencheurs** : Erreurs de requête 400/404/422 (l'erreur venant de la requête elle-même, elle est transmise telle quelle).
- **Pendant le streaming** : Aucune nouvelle tentative. En cas de coupure, le flux se termine par un événement SSE `error`.
- Si une réponse 429 comporte un en-tête `Retry-After` et que `respectRetryAfter` est activé, la durée de recharge est ajustée à `max(cooldownMs, Retry-After)`.

## Quotas et utilisation

Les données d'utilisation sont regroupées en mémoire et écrites dans SQLite (`data/prismd.sqlite`, mode WAL) toutes les 5s ou 20 opérations, ainsi qu'à l'arrêt du processus.

| Table | Contenu |
| --- | --- |
| `usage_daily` | Agrégats quotidiens (date, fournisseur, modèle, requêtes, tokens) conservés après redémarrage. |
| `request_log` | Journal détaillé par requête (ID, alias, fournisseur, modèle, statut, tokens, basculement, durée). Conservé 14 jours. |

- Tokens : Valeurs réelles fournies par l'amont ou estimation (entrée = caractères ÷ 4, sortie = caractères ÷ 4). Colonne `source` (`real` / `estimated` / `mixed`).
- Répertoire en permissions `0700` et base en `0600`. Réinitialisez les compteurs en supprimant `data/prismd.sqlite` ou via le bouton de réinitialisation dans l'interface/CLI.

## Contrôles de santé

Uniquement passifs (pas de requêtes de sondage superflues). Gestion en mémoire par `(provider, model)` :

```
healthy → (3 échecs consécutifs) → cooldown 60s → half-open (1 requête d'essai)
              ↑                                             succès → healthy
              └──────────────────────────────────── échec → nouveau cooldown
```

## Référence des politiques (`policies`)

Options modifiables dans `config.user.json` (valeurs par défaut) :

| Option | Défaut | Description |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | Codes de statut déclenchant le basculement |
| `retryBeforeStream` | `true` | Réessayer d'autres candidats avant le flux |
| `retryAfterStream` | `false` | Ne jamais réessayer une fois le flux démarré |
| `maxCandidatesPerRequest` | `2` | Nombre maximal de candidats essayés par requête |
| `respectRetryAfter` | `true` | Prendre en compte l'en-tête `Retry-After` |
| `quotaSoftLimitRatio` | `0.8` | Ratio de quota déclenchant la rétrogradation douce |
| `connectTimeoutMs` | `10000` | Délai d'attente de connexion (ms) |
| `streamIdleTimeoutMs` | `300000` | Délai maximal d'inactivité entre fragments de flux (ms) |
| `failThreshold` | `3` | Échecs consécutifs avant mise en temps de recharge |
| `cooldownMs` | `60000` | Durée du temps de recharge (ms) |

## Utilisation avec Codex

1. Copier la configuration d'exemple et générer le catalogue :

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. Exécution :

```bash
PRISMD_API_KEY=<token-local> codex --profile prismd
```

- Le profil cible l'alias `free-auto`. Le catalogue affecte à chaque alias la fenêtre de contexte **minimale** de ses candidats afin d'éviter tout débordement.
- Gardez les tentatives de Codex faibles : `request_max_retries = 0` (la passerelle gère le basculement) et `stream_max_retries = 1`.

## Autres clients (Claude Code, OpenCode, dsh, Pi)

Tous les clients partagent les mêmes alias (`free-auto`, `free-fast`, `free-code`) et le même token local :

- **Claude Code** — Protocole Anthropic Messages : `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` et `ANTHROPIC_AUTH_TOKEN` (ou `x-api-key`) défini sur votre token prismd. Voir `examples/claude-code/`.
- **OpenCode / dsh / Pi** — Compatible OpenAI : définir `baseURL` sur `http://127.0.0.1:8787/v1` et la clé API sur le token prismd. Prend en charge les modes `responses` et `chat`. Voir `examples/opencode/`, `examples/dsh/`, `examples/pi/`.

## État, Interface Web & Découverte

- **Tableau de bord Web (`GET /ui`)** :
  Ouvrez `http://127.0.0.1:8787/ui` dans votre navigateur. Affiche les badges d'état (🟢 healthy, 🟡 rate_limited/cooldown, 🔴 unavailable), les barres de progression de quota, les métriques de tokens, les modèles actifs et le flux d'événements. Supporte 7 langues (English, 简体中文, 日本語, 한국어, Deutsch, Français, Español).

- **Commande CLI (`prismd status` / `npm run status`)** :
  Vérifiez l'état directement depuis le terminal :
  ```bash
  prismd status          # Installation globale
  npm run status         # Depuis le dépôt
  ```
  Affiche un tableau coloré avec détection automatique de la langue du terminal (`LANG`).

- **API d'état JSON (`GET /v1/modelstatus`)** :
  Renvoie un instantané complet en mémoire sans lecture disque (sans authentification).

- **Flux SSE en temps réel (`GET /v1/modelstatus/stream`)** :
  Flux d'événements Server-Sent Events pour suivre les changements d'état (sans authentification).

- **Vérification de santé (`GET /healthz`)** :
  Renvoie `{ "status": "ok", "uptime": ..., "candidates": [...] }`.

- **Découverte de modèles (`GET /v1/models`)** :
  Liste les modèles d'alias au format standard OpenAI.

## Structure du projet

- `prismd.json` — Configuration d'exécution générée (hors Git).
- `presets/providers.json` — Définitions par défaut des fournisseurs et modèles gratuits.
- `config.user.json` — Surcharges utilisateur.
- `config.schema.json` — Schéma de validation JSON Schema pour `prismd.json`.
- `scripts/generate-config.mjs` — Générateur de configuration.
- `scripts/generate-codex-catalog.mjs` — Générateur de catalogue pour Codex.
- `examples/` — Exemples de configuration client.
- `src/ingress/` — Réception des protocoles clients.
- `src/egress/` — Adaptateurs de protocoles amont et couche HTTP.
- `src/routes/` — Routes publiques d'état et de découverte.
- `src/ui/` — Page d'état Web UI intégrée en un seul fichier.
- `src/cli/` — Commandes CLI.
- `src/core/` — Routage, machine à états et gestion des quotas.
- `src/observability/` — Journalisation pino et traçabilité.
- `src/keys.ts` — Résolution des clés API.
- `src/auth.ts` — Validation du token local.

## Scripts disponibles

- `npm run dev` — Serveur de développement avec rechargement automatique
- `npm run build` / `npm start` — Compilation TypeScript et démarrage
- `npm run typecheck` — Vérification des types `tsc --noEmit`
- `npm test` — Tests unitaires et d'intégration
- `npm run test:e2e` — Tests d'acceptation E2E
- `npm run status` — Tableau récapitulatif des modèles et quotas
- `npm run generate:config` — Régénération de `prismd.json`
- `npm run generate:codex-catalog` — Régénération de `~/.codex/prismd-models.json`
