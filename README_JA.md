# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

コーディングエージェント向けに、無料/低枠モデル API（OpenRouter、Groq、Cerebras 等）を集約するローカル優先の LLM ゲートウェイです。単一のローカルエンドポイントと単一のエイリアス（`free-auto`）を指定するだけで、prismd が残りの処理を自動で行います：利用可能な候補モデルの選定、クォータ枯渇の回避、アップストリームが 429 を返した際のフェイルオーバー、ゲートウェイ状態のリアルタイム可視化。3 つの主要プロトコル（OpenAI Responses、OpenAI Chat Completions、Anthropic Messages）をネイティブサポートしており、Codex CLI、Claude Code、OpenCode 等のクライアントがすべて同じゲートウェイを共有できます。

## 支援について

prismd が開発時間やクォータの節約に役立ちましたら、ぜひ開発者にコーヒーをご馳走してください：

[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/keanz21)

## 主な機能

| 機能 | 動作仕様 |
| --- | --- |
| **マルチプロトコル統合エンドポイント** | `POST /v1/responses`（OpenAI Responses、Codex 向け）、`POST /v1/chat/completions`（OpenAI Chat、OpenCode/dsh 向け）、`POST /v1/messages`（Anthropic Messages、Claude Code 向け）— すべて同じエイリアス、ルーティング、クォータ、フェイルオーバーを共有 |
| **全二重プロトコル変換** | Chat↔Responses（エグレス変換、ストリーミング tool-call イベント対応）および Anthropic↔Chat（イングレス変換）；アップストリームとプロトコルが一致する場合は直接透過プロキシ |
| **Claude モデル自動フォールバック** | Claude Code からの `claude-*-sonnet/haiku/opus-*` 等のモデル名を 9 段階のフォールバックチェーン（日付サフィックス、`-latest`、セマンティックファミリー、`free-auto`）で設定済みエイリアスに自動解決。ゼロ設定で Claude Code が動作 |
| **エイリアスルード** | `"model": "free-auto"` は設定ファイル内の順序付き候補モデルリストに解決 |
| **候補モデルフィルタリング** | 日次クォータ枯渇（`limits.dailyRequests`）、入力サイズに対してコンテキストウィンドウ不足、またはヘルス異常/クールダウン中の候補を除外。さらに日次クォータ 80% 以上の候補はキュー末尾へソフト降格 |
| **フェイルオーバー** | *ストリーム開始前*に 401/403/429/5xx/接続エラー/接続タイムアウトが発生した場合、次の候補モデルを自動試行（最大 `maxCandidatesPerRequest` 回）。リクエスト起因の 4xx（400/404/422）はそのまま返却。ストリーム開始後は再試行せず即時終了 |
| **クォータ・使用量集計** | リクエスト数とトークン数（アップストリーム実値、または文字数÷4の推定値）をローカル SQLite に記録。再起動後も保持 |
| **パッシブヘルスチェック** | 3 回連続失敗 → クールダウン 60 秒 → ハーフオープン（プローブ試行 1 回）。401/403 認証エラーは個別に追跡 |
| **タイムアウト制御** | 接続タイムアウト（デフォルト 10 秒）およびストリームアイドルタイムアウト（デフォルト 300 秒）、ポリシー毎に設定可能 |
| **API キー管理** | キーは `~/.prismd/`（`.env` または `keys.yaml`）で一元管理。リポジトリや生成設定には含めない。優先順位: OS 環境変数 > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **モデル検出** | `GET /v1/models` で設定済みの論理エイリアス一覧を OpenAI 互換形式で取得可能（認証不要） |
| **状態 API & SSE** | `GET /healthz`（ゲートウェイヘルス）、`GET /v1/modelstatus`（メモリ内候補状態スナップショット）、`GET /v1/modelstatus/stream`（ヘルス/クォータ変更時のリアルタイム SSE 配信） |
| **組み込み Web UI** | `GET /ui` で候補モデルの状態バッジ、クォータ進捗バー、トークン指標、アクティブ状態、リアルタイムイベントログを表示するゼロ依存ダッシュボードを提供 |
| **CLI ステータス** | `prismd status`（または `npm run status`）でカラー表示ターミナルテーブルを出力。オフライン時は SQLite から本日の使用量を自動表示 |
| **可観測性** | stderr に JSON 形式の pino 構造化ログを出力。リクエスト ID による追跡とリクエスト毎のサマリー記録。機密情報は自動マスキング |

## クイックスタート

ソースコードから実行：

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # API キーを記入し、chmod 600
npm run generate:config                    # プリセット + config.user.json + キー → prismd.json を生成
npm run dev                                # http://127.0.0.1:8787 で起動
```

または npm パッケージからグローバルインストール：

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<your-key>
export PRISMD_API_KEY=<local-token>        # 生成例: openssl rand -hex 32
prismd                                     # http://127.0.0.1:8787 で起動
```

ランタイムは単一の設定ファイル `prismd.json` のみを読み込みます（`PRISMD_CONFIG_PATH` でパス変更可能）。パッケージ導入時は `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>` で生成します。

スモークテスト：

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## API キー管理

prismd は API キーを `~/.prismd/` ディレクトリから読み込みます。キーが Git や `prismd.json` に混入することはありません。読み込み優先順位：

| フィールド | OS 環境変数 | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd`（ローカル保護トークン） | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- 環境変数名はフィールド名の大文字 + `_API_KEY` です。
- `.env`（`KEY=value`）と `keys.yaml`（`field: value`）の併用が可能です。`.env.example` / `keys.yaml.example` を参考にしてください。
- ファイルのパーミッションは `chmod 600` に設定してください。
- ローカル保護トークン（`prismd` フィールド）は 3 つの POST エンドポイントを保護します。リクエストには `Authorization: Bearer <token>` または `x-api-key: <token>`（Claude Code のデフォルト）が必要です。不正なトークンは 401 となりアップストリームには送信されません。

## 設定

`prismd.json` は手動編集せず、ジェネレーターによって生成されます。ジェネレーターは 3 つのレイヤーを統合します：

| レイヤー | ファイル | 役割 |
| --- | --- | --- |
| Presets | `presets/providers.json` | 組み込みプロバイダー、無料モデルのメタデータ（コンテキスト長、制限、タグ）、出所情報、デフォルトエイリアス。 |
| User overrides | `config.user.json` | ユーザー独自の上書き設定（エイリアス優先順位、カスタム候補モデル、ポリシー設定、サーバー設定）。キーは含めません。 |
| Keys | `~/.prismd/` | キーが存在するプロバイダーの候補モデルのみが設定ファイルに出力されます。 |

設定を変更した後は `npm run generate:config` を実行してください。

`config.user.json` の設定例：

```jsonc
{
  "aliases": {
    "free-auto": {
      // 候補モデルの試行順序を変更
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // 1 リクエストあたり最大 3 候補まで試行
    "connectTimeoutMs": 5000          // 接続タイムアウト短縮
  }
}
```

カスタム候補モデルの直接定義：

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

標準的な `baseUrl` エンドポイント（`/responses` または `/chat/completions`）を持つ新規プロバイダーも追加可能です。

## ルーティング機構

1. エイリアスを `prismd.json` 内の順序付き候補モデルリストに解決します。
2. **ハード除外**: 日次クォータ枯渇（`limits.dailyRequests`）、入力サイズ（文字数÷4）が `contextWindow` を超えている、またはクールダウン中の候補を除外。
3. **ソフト降格**: 日次クォータ使用率が 80% 以上（`quotaSoftLimitRatio`）の候補をリスト末尾へ移動。
4. 先頭の候補モデルへリクエストを送信。失敗時はフェイルオーバーツリーに従い次の候補へ遷移。

ゲートウェイが直接返却するエラー（OpenAI 準拠の `{"error": {...}}`）：

| 状況 | HTTP ステータス | エラーコード | 備考 |
| --- | --- | --- | --- |
| トークン欠落/不一致 | 401 | `invalid_api_key` | アップストリーム未到達 |
| 未知のエイリアス | 404 | `model_not_found` | |
| 全候補が枯渇/異常 | 429 | `quota_exceeded` | `error.metadata` に各候補の除外理由を記載 |
| 入力が全候補のコンテキスト長超過 | 422 | `context_window_exceeded` | `error.metadata` に各候補のウィンドウ長を記載 |
| 試行した全候補が失敗 | 502 | `gateway_all_candidates_failed` | `error.metadata` に各試行のステータスを記載 |
| 内部エラー | 500 | `gateway_internal_error` | |

## フェイルオーバー

- **発動条件（ストリーム開始前）**: 接続失敗、接続タイムアウト、およびアップストリームの 401、403、429、5xx。失敗回数を記録し（ヘルス +1）、最大 `maxCandidatesPerRequest` 回まで次の候補を試行。
- **非発動条件**: 400/404/422 等のリクエスト起因 4xx エラー（リクエスト自体に問題があるため、再試行せずそのまま返却）。
- **ストリーム開始後**: 一切再試行しません。途中で切断された場合は SSE `error` イベントを送信して終了します。
- 429 応答に `Retry-After` が含まれ `respectRetryAfter` が有効な場合、クールダウン時間は `max(cooldownMs, Retry-After)` に設定されます。

## クォータと使用量

使用量はメモリ内で集計され、5 秒毎または 20 件毎に SQLite（`data/prismd.sqlite`、WAL モード）へフラッシュされます。シャットダウン時（SIGINT/SIGTERM）にも強制フラッシュされます。

| テーブル | 内容 |
| --- | --- |
| `usage_daily` | 日次集計データ（日付、プロバイダー、モデル、リクエスト数、トークン数）。起動時にシードとして読み込まれ、再起動後もクォータ制限を維持。 |
| `request_log` | リクエスト毎のログ（ID、エイリアス、プロバイダー、モデル、ステータス、トークン数、フェイルオーバー有無、所要時間）。14 日間保持され起動時に整理。 |

- トークン数: アップストリームからの実値を記録。報告がない場合は安全側の推定値（入力 = 文字数÷4、出力 = ストリーム文字数÷4）を記録。`source` 列で `real` / `estimated` / `mixed` を区別。
- `data/` ディレクトリはパーミッション `0700`、DB ファイルは `0600` で作成されます。カウントをリセットするには `data/prismd.sqlite` を削除するか、Web UI / CLI からリセットを実行します。

## ヘルスチェック

パッシブ方式のみを採用（貴重な無料クォータを消費する能動的プローブは行いません）。メモリ上で `(provider, model)` 単位で状態を管理します：

```
healthy → (3 回連続失敗) → cooldown 60秒 → half-open (プローブ試行 1 回)
              ↑                                   成功 → healthy
              └─────────────────────────── 失敗 → 再度 cooldown
```

- 401/403 認証エラーは `lastError` に記録され、ログ上で識別可能。
- しきい値は `policies.failThreshold` / `policies.cooldownMs` で変更可能。

## ポリシー設定一覧

`config.user.json` の `policies` で上書き可能なフィールド一覧（デフォルト値）：

| フィールド | デフォルト値 | 説明 |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | フェイルオーバーをトリガーするステータスコード |
| `retryBeforeStream` | `true` | ストリーム開始前に他候補を再試行 |
| `retryAfterStream` | `false` | ストリーム開始後は再試行しない |
| `maxCandidatesPerRequest` | `2` | 1 リクエストあたりに試行する最大候補数 |
| `respectRetryAfter` | `true` | クールダウン計算でアップストリームの `Retry-After` を尊重 |
| `quotaSoftLimitRatio` | `0.8` | ソフト降格を発動する日次クォータ使用比率 |
| `connectTimeoutMs` | `10000` | ストリーム開始前の接続タイムアウト（ミリ秒） |
| `streamIdleTimeoutMs` | `300000` | ストリームチャンク間の最大許容間隔（ミリ秒） |
| `failThreshold` | `3` | クールダウンに入る連続失敗回数 |
| `cooldownMs` | `60000` | クールダウン待機時間（ミリ秒） |

## Codex での利用

1. 設定プロファイルをコピーし、カタログを生成します：

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. 実行：

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

- プロファイルの `model` は `free-auto` に指定します。`model_catalog_json` は各エイリアス配下の候補モデルにおける**最小**コンテキスト長を設定し、オーバーフローを防ぎます。
- Codex の再試行設定は低めに保ちます: `request_max_retries = 0`（フェイルオーバーはゲートウェイに委ねる）、`stream_max_retries = 1`（ストリーム再接続用）。

## その他のクライアント（Claude Code、OpenCode、dsh、Pi）

すべてのクライアントで同一のエイリアス（`free-auto`, `free-fast`, `free-code`）とローカル保護トークンを共有できます：

- **Claude Code** — Anthropic Messages プロトコル経由: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`、`ANTHROPIC_AUTH_TOKEN`（または `x-api-key`）に prismd トークンを設定。Claude モデル名（`claude-...-sonnet-...` 等）は自動解決されます。詳細は `examples/claude-code/` を参照。
- **OpenCode / dsh / Pi** — OpenAI 互換: プロバイダーの `baseURL` を `http://127.0.0.1:8787/v1` に、API キーを prismd トークンに設定。`responses` および `chat` 双方のプロトコルに対応。詳細は `examples/opencode/`, `examples/dsh/`, `examples/pi/` を参照。

## 状態監視、Web UI およびサービス検出

- **Web UI ダッシュボード (`GET /ui`)**:
  ブラウザで `http://127.0.0.1:8787/ui` を開きます。リアルタイム状態バッジ（🟢 healthy、🟡 rate_limited/cooldown、🔴 unavailable）、日次リクエスト進捗バー、トークン数、コンテキスト長、アクティブモデル、およびリアルタイムイベントログを表示します。7 つの言語切り替え（English, 简体中文, 日本語, 한국어, Deutsch, Français, Español）に対応しています。

- **CLI ステータスコマンド (`prismd status` / `npm run status`)**:
  ターミナルから直接状態を確認：
  ```bash
  prismd status          # グローバルインストール時
  npm run status         # ソースリポジトリから
  ```
  稼働時は ANSI カラー付きテーブルを表示し、停止時は SQLite から本日の記録を自動表示します。システムの言語設定（`LANG`）に応じて自動ローカライズされます。

- **JSON 状態 API (`GET /v1/modelstatus`)**:
  全エイリアス、候補モデル、ヘルス状態、クールダウンタイマー、トークン使用量のメモリ内スナップショットを返します（認証不要）。

- **SSE リアルタイムストリーム (`GET /v1/modelstatus/stream`)**:
  Server-Sent Events 経由でリアルタイム状態更新を受信（認証不要）。

- **ヘルスチェック (`GET /healthz`)**:
  `{ "status": "ok", "uptime": ..., "candidates": [...] }` を返却（認証不要）。

- **モデル一覧 (`GET /v1/models`)**:
  設定済みエイリアス一覧を OpenAI 互換フォーマット `{ "object": "list", "data": [...] }` で返却（認証不要）。

## 可観測性

- **構造化ログ**: stderr に JSON 形式の pino ログを 1 行 1 イベントで出力。
- **リクエスト ID**: 全リクエストに UUID を付与し、ログやエラーレスポンス（`x-request-id`）で追跡可能。
- **サマリー記録**: リクエスト終了時に `request_end` ログを 1 行出力（メソッド、パス、エイリアス、選択された候補、ステータス、初回トークン遅延、総所要時間、使用量）。
- **機密情報のマスキング**: `authorization` / `api-key` / `token` 等の文字列は `****` に自動置換。

## ディレクトリ構成

- `prismd.json` — 実行時設定ファイル（自動生成、Git 管理外）。起動時に 1 回読み込み。
- `presets/providers.json` — 組み込みプロバイダーおよび無料モデルの初期定義とデフォルトエイリアス。
- `config.user.json` — ユーザー独自の上書き設定。
- `config.schema.json` — `prismd.json` を検証する JSON Schema（draft-07）。
- `scripts/generate-config.mjs` — 各レイヤーを統合して `prismd.json` を生成するスクリプト。
- `scripts/generate-codex-catalog.mjs` — `~/.codex/prismd-models.json` を生成するスクリプト。
- `examples/` — 各クライアント向け設定サンプル（`codex/`, `claude-code/`, `opencode/`, `dsh/`, `pi/`）。
- `src/ingress/` — クライアントプロトコル受付（`responses.ts`, `chat.ts`, `messages.ts`）。
- `src/egress/` — アップストリームプロトコル変換・送信（`responses.ts`, `chat.ts`, `chat-converter.ts`, `raw.ts`）。
- `src/routes/` — 認証不要のステータス・検出エンドポイント（`/healthz`, `/v1/models`, `/v1/modelstatus`, `/ui`）。
- `src/ui/` — 組み込み Web UI ステータスページ（単一ファイル HTML/CSS/JS）。
- `src/cli/` — CLI コマンド（`prismd status`）。
- `src/providers/` — プロバイダー別リクエストビルダー。
- `src/core/` — エイリアスルード、状態機械、イベント配信、クォータ集計、SQLite 永続化。
- `src/observability/` — pino ログ出力、リクエスト ID、エクスポーター。
- `src/keys.ts` — API キー解決モジュール。
- `src/auth.ts` — ローカル保護トークン検証。

## 主要スクリプト

- `npm run dev` — tsx watch による開発サーバー起動
- `npm run build` / `npm start` — ビルドおよび本番実行
- `npm run typecheck` — `tsc --noEmit` 型チェック
- `npm test` — ユニット/統合テスト実行
- `npm run test:e2e` — モックアップストリームに対する E2E テスト実行
- `npm run status` — 候補モデル状態・クォータテーブルのフォーマット出力
- `npm run generate:config` — `prismd.json` 設定の再生成
- `npm run generate:codex-catalog` — `~/.codex/prismd-models.json` の再生成
