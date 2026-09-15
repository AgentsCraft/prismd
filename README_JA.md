# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**ローカル優先の高可用性 LLM ゲートウェイ**。世界中の無料/低額モデル API（OpenRouter、Groq、Cerebras、Google Gemini、NVIDIA NIM、GitHub Models など）とローカル LLM（Ollama）を集約し、コーディングエージェント（Claude Code、Codex CLI、Cursor、OpenCode、Aider など）に無停止で安定した統一インターフェースを提供します。

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

## 主な特徴

1. **統合モデルエイリアス（`free-auto`）**：モデルの選択に迷う必要はありません。単一のエイリアスで最適な無料モデルへ自動ルーティングします。
2. **マルチ Key 輪番と単一 Key 障害隔離（Key Pool）**：単一アカウントのレート制限（RPM）を突破。複数 Key を設定してラウンドロビン分散；1 つの Key が 429 に達してもその Key のみを冷却し、次の Key へ即座に切り替えます。
3. **ローカルフォールバック（オプション、Ollama / LM Studio）**：デフォルトのエイリアスはクラウドのみ。ローカルで推論バックエンドを動かしている場合は `config.user.json` でキューに追加でき、クラウド模型の枯渇や断網時にはローカル模型へフォールバックします。
4. **全プロトコル双方向ストリーミング変換**：Claude Code（Messages）、Codex（Responses）、Cursor/OpenCode（Chat Completions）間の相互透過中継をネイティブサポート。
5. **内蔵 Web ダッシュボードと SIGHUP ホットリロード**：`http://127.0.0.1:8787/ui` で稼働状態と配額バーをリアルタイム監視；設定変更後は `SIGHUP` シグナルで無停止更新可能。

---

## 支援について

prismd が開発時間やクォータの節約に役立ちましたら、ぜひ開発者にコーヒーをご馳走してください：

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3 ステップ クイックスタート

### ステップ 1: インストール

```bash
# 方法 A: npm グローバルインストール
npm install -g @prismd/prismd              # 安定版（Stable）
# または RC プレビュー版（最新 develop に追従）：
npm install -g @agentscraft/prismd         # RC 版

# 方法 B: ソースコードから実行
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### ステップ 2: 初期化と起動
 
対話型セットアップウィザードを実行してキーとクライアントを設定します：
```bash
prismd init
# Source install: node dist/server.js init
```
ウィザードの機能：
1. ローカル保護トークン（`prismd:`）の設定。
2. 無料プロバイダー（OpenRouter、Groq、Google Gemini など）を選択して API キーを入力。
3. **コーディングクライアントの自動設定**（Claude Code、Codex CLI、OpenCode、Pi Agent）と既存設定の安全な自動バックアップ（`.bak.<日時>`）！

*(手動設定をご希望の場合は `~/.prismd/keys.yaml` を直接編集するか、`PRISMD_HOME` を設定してください)*。

```yaml
# 手動設定例: ~/.prismd/keys.yaml (推奨権限 chmod 600)
prismd: "YOUR_PRISMD_TOKEN"       # ローカル保護トークン（クライアント接続用）
 
# クラウドプロバイダー（単一キーまたは複数キーのラウンドロビンプールに対応）：
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # 複数キー自動ラウンドロビン＆冷却隔離
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models 個人アクセストークン
amd: "amd_token_xxxx"           # オプション: AMD Developer Cloud
 
# ローカルオフラインフォールバック:
# ollama: キー設定不要（http://127.0.0.1:11434/v1 へ自動ルーティング）
```
 
ゲートウェイを起動：
```bash
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **各プロバイダー設定ガイド**: [モデルプロバイダー設定一覧](docs/providers/README.md)（[OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)）を参照してください。

### ステップ 3: エージェントの設定

| クライアント | クイック起動（`prismd init` 自動設定） | ガイド |
|---|---|---|
| **Claude Code** | `claude`（`~/.claude/settings.json` に自動設定） | [ガイド](examples/claude-code/README.md) |
| **Codex CLI** | `codex`（`~/.codex/config.toml` および `auth.json` に自動設定） | [ガイド](examples/codex/README.md) |
| **OpenCode** | `opencode`（`~/.config/opencode/opencode.json` に自動設定） | [ガイド](examples/opencode/README.md) |
| **Pi Agent** | `pi`（`~/.pi/config.json` に自動設定） | [ガイド](examples/pi/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key 有効化（`YOUR_PRISMD_TOKEN`）<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>モデル追加: `free-auto` | [ガイド](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml` で `base_url = "http://127.0.0.1:8787/v1"` を設定<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [ガイド](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [ガイド](examples/aider/README.md) |

> 📖 **詳細ドキュメント**: [ドキュメント索引](docs/README.md)、[クライアント接続ガイド](docs/clients/README.md)、[設定ガイド](docs/configuration.md) を参照してください。

---
