# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

コーディングエージェント（Claude Code、Codex CLI、OpenCode 等）向けに、無料および低枠モデル API（OpenRouter、Groq、Cerebras 等）を集約するローカル優先の LLM ゲートウェイです。自動ルーティングとフェイルオーバーを備えた安定した統一インターフェースを提供します。

単一のローカルエンドポイントと統合エイリアス（`free-auto`）を指定するだけで、prismd は以下を自動処理します：
- **スマートルーティングとクォータ保護**: コンテキストウィンドウと日次クォータ使用量に基づき利用可能な候補モデルを自動選定。クォータ消費が 80% に達した候補はキュー末尾へソフト降格。
- **シームレスなフェイルオーバー**: ストリーム開始前に 429/401/5xx エラーやネットワークタイムアウトが発生した場合、次の候補モデルへ自動切り替え。
- **マルチプロトコル変換**: OpenAI Responses、OpenAI Chat Completions、Anthropic Messages プロトコルをネイティブサポートし、あらゆるコーディングエージェントをシームレスに接続。

## 支援について

prismd が開発時間やクォータの節約に役立ちましたら、ぜひ開発者にコーヒーをご馳走してください：

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## クイックスタート

### 方法 1: npm によるグローバルインストール（推奨）

```bash
# 安定版のインストール
npm install -g @prismd/prismd

# または RC プレビュー版
# npm install -g @agentscraft/prismd

# プロバイダーキーとローカルゲートウェイトークンの設定
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # ローカル認証トークン（例: openssl rand -hex 32）

# ゲートウェイの起動（127.0.0.1:8787 で待機）
prismd
```

### 方法 2: ソースコードから実行

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # API キーを入力し、chmod 600
npm run generate:config                    # プリセットとキーを統合して prismd.json を生成
npm run dev                                # 開発サーバーの起動
```

### 動作確認（スモークテスト）

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## クライアント設定

すべてのクライアントエージェントはローカルゲートウェイエンドポイントを指定し、同一のローカル保護トークン（`PRISMD_API_KEY`）を使用します。

### 1. Claude Code
Claude Code は環境変数経由でカスタム Anthropic エンドポイントをネイティブサポートしています。標準モデル名（`claude-*-sonnet` 等）は設定済みゲートウェイエイリアスへ自動解決されます：
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
サンプルプロファイルをコピーし、モデルメタデータカタログを生成します：
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # ~/.codex/prismd-models.json を生成
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Cursor でカスタム OpenAI エンドポイントを設定します：
- **Settings** → **Models** → **OpenAI API Key** を有効にし、`<your-prismd-local-token>` を入力。
- **Override OpenAI Base URL** にチェックを入れ、`http://127.0.0.1:8787/v1` を入力。
- モデル `free-auto`、`free-fast`、`free-code` を追加して有効化。[Cursor 設定ガイド](examples/cursor/README.md) を参照。

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: `~/.config/opencode/config.json` で `baseUrl: "http://127.0.0.1:8787/v1"` を設定。[OpenCode 設定ガイド](examples/opencode/README.md) を参照。
- **DeepSeek Harness (dsh)**: `~/.dsh/config.toml` で `base_url = "http://127.0.0.1:8787/v1"` を設定。[dsh 設定ガイド](examples/dsh/README.md) を参照。
- **Pi Agent**: `~/.pi/config.json` で `endpoint: "http://127.0.0.1:8787/v1"` を設定。[Pi 設定ガイド](examples/pi/README.md) を参照。

---

## キー管理と設定

### API キー管理
キーはプロジェクトルートの `.env` またはグローバルな `~/.prismd/` ディレクトリで設定可能です。検索優先順位（高 → 低）：
1. **環境変数**: `OPENROUTER_API_KEY`、`GROQ_API_KEY`、`GEMINI_API_KEY` 等
2. **プロジェクトルートディレクトリ**: `./.env`（`.env.example` からコピー）
3. **グローバルユーザーディレクトリ**: `~/.prismd/.env` または `~/.prismd/keys.yaml`（推奨権限: `chmod 600`）

### 候補モデルと優先順位のカスタマイズ
`config.user.json` で候補モデルの優先順位変更や独自モデルの追加を行い、設定を再生成します：
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
変更を適用するには `npm run generate:config`（または `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`）を実行します。

主要な無料プロバイダー（OpenRouter、Groq、Cerebras、Google Gemini、NVIDIA NIM、GitHub Models 等）の詳細な設定方法は [プロバイダー設定ガイド](docs/providers/README.md) を参照してください。

---

## 状態監視と可観測性

- **Web ダッシュボード**: ブラウザで `http://127.0.0.1:8787/ui` を開くと、候補モデルのヘルス状態、日次クォータ進捗バー、トークン使用量、リアルタイム SSE イベントログを確認できます。
- **CLI ステータス**: `prismd status`（または `npm run status`）を実行して、ターミナル上でカラー表示の指標テーブルを確認できます。
- **構造化ログ**: stderr に JSON 形式のログを出力。機密情報は自動マスキングされ、一意の `request-id` で追跡可能です。

---

## 動作原理と制限事項

1. **ルーティングとフィルタリング**:
   - 設定された順序で候補モデルを試行；
   - クォータ枯渇、コンテキストウィンドウ不足、またはクールダウン中の候補をハード除外；
   - 日次クォータ 80% 以上の候補はキュー末尾へソフト降格。
2. **フェイルオーバーの境界**:
   - **ストリーム開始前**: 401/403/429/5xx または接続タイムアウト時、最大 `maxCandidatesPerRequest` 回まで次の候補を試行。
   - **ストリーム開始後**: 出力乱れを防ぐためストリーム途中での再試行は行わず、SSE `error` イベントを送信して正常終了。
3. **無料枠の制限**:
   - パブリック無料モデルは共通の同時実行プールを共有しているため、ピーク時に 429 が発生しやすくなります。prismd は自動回避しますが、全候補が枯渇した場合は `error.metadata` に詳細を付与して 429 を返します。

---

## よくある問題と解決法

- **429 が頻発する**: 無料モデルプールが混雑しています。`config.user.json` で `free-auto` の順序を変更して混雑の少ないモデルを優先するか、他のプロバイダーキーを追加してください。
- **アップデート後に候補モデルが消えた**: 旧バージョンと設定キー形式が異なります。`npm run generate:config` を実行して `prismd.json` を更新してください。
- **クォータカウンターのリセット**: Web ダッシュボード（`http://127.0.0.1:8787/ui`）の「Reset usage」ボタンをクリックするか、ゲートウェイを停止して `data/prismd.sqlite` を削除してください。
