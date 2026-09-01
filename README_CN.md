# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

本地优先的 LLM 网关，聚合多个免费/低额度模型 API（OpenRouter、Groq、Cerebras 等），为编码智能体（Coding Agents）提供稳定、可切换的统一接口。单个本地端点，单个别名（`free-auto`），其余一切由 prismd 自动处理：挑选可用候选模型、规避耗尽配额、在上游返回 429 时无缝故障转移（Failover），并实时呈现网关状态。原生支持三种主流协议（OpenAI Responses、OpenAI Chat Completions、Anthropic Messages），Codex CLI、Claude Code、OpenCode 等客户端均可无缝接入同一个网关。

## 支持项目

如果 prismd 帮您节省了时间或配额，欢迎请作者喝杯咖啡：

[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/keanz21)

## 核心功能

| 功能特性 | 行为说明 |
| --- | --- |
| **多协议统一接入** | `POST /v1/responses`（OpenAI Responses，适配 Codex）、`POST /v1/chat/completions`（OpenAI Chat，适配 OpenCode/dsh）、`POST /v1/messages`（Anthropic Messages，适配 Claude Code）——全部共享相同的别名配置、路由机制、配额统计和故障转移。 |
| **全双工协议转换** | Chat↔Responses（出站转换，含流式 tool-call 事件）与 Anthropic↔Chat（入站转换）；与上游协议一致的请求直接直通透传。 |
| **Claude 模型自动回退** | Claude Code 发出的 `claude-*-sonnet/haiku/opus-*` 等格式的模型名称，通过 9 步回退链自动映射至已配置的别名（日期后缀匹配、`-latest`、语义家族、最终回退到 `free-auto`），实现 Claude Code 零配置开箱即用。 |
| **别名智能路由** | 请求指定 `"model": "free-auto"` 时，网关自动按配置顺序解析候选模型列表。 |
| **候选模型动态过滤** | **硬过滤**：自动剔除当日配额已耗尽、上下文窗口小于请求输入长度、或处于不健康/冷却期的候选；**软降权**：将当日配额已使用 ≥ 80% 的候选降权并移至队列末尾。 |
| **无缝故障转移** | 在流式响应建立前，若遇到 401/403/429/5xx、连接错误或连接超时，自动尝试下一个候选模型（最多尝试 `maxCandidatesPerRequest` 次）；请求类错误（400/404/422）直接透传返回；流式响应开始后不再重试。 |
| **配额精准统计** | 记录请求数与 Token 用量（上游返回实际消耗时记录真实值，否则按 字符数/4 估算）并持久化至本地 SQLite 数据库，服务重启数据不丢失。 |
| **被动健康检查** | 连续 3 次失败 → 进入 60 秒冷却期 → 半开（Half-open）单次探测；401/403 认证错误单独标记区分。 |
| **多级超时控制** | 连接超时（默认 10s）与流式空闲超时（默认 300s），支持按策略自定义配置。 |
| **安全密钥管理** | 密钥统一存放在 `~/.prismd/`（`.env` 或 `keys.yaml`），绝不硬编码在仓库或生成的配置中；优先级：系统环境变量 > `~/.prismd/.env` > `~/.prismd/keys.yaml`。 |
| **模型服务发现** | `GET /v1/models` 无需鉴权即可列出所有已配置的逻辑别名模型（兼容 OpenAI 规范格式）。 |
| **状态 API 与 SSE** | `GET /healthz` 获取网关健康状态；`GET /v1/modelstatus` 获取候选模型内存快照；`GET /v1/modelstatus/stream` 通过 SSE 实时推送健康与配额变动。 |
| **内置 Web UI** | `GET /ui` 提供轻量独立状态看板，展示候选模型状态徽章、配额进度条、Token 统计、活跃标记以及实时事件流。 |
| **CLI 状态命令** | `prismd status`（或 `npm run status`）在终端输出彩色状态表格、配额比例，支持离线 SQLite 数据回退展示。 |
| **结构化可观测性** | 标准错误（stderr）输出 pino JSON 日志，包含全局唯一 request-id 以及单请求汇总日志，敏感凭据自动脱敏。 |

## 快速上手

### 从源码运行

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # 填入您的 API 密钥，然后设置权限 chmod 600
npm run generate:config                    # 合并 presets + config.user.json + keys → prismd.json
npm run dev                                # 启动服务，监听 http://127.0.0.1:8787
```

### 或安装 RC 预览包

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<your-key>
export PRISMD_API_KEY=<local-token>        # 生成指令：openssl rand -hex 32
prismd                                     # 启动服务，监听 http://127.0.0.1:8787
```

网关运行时仅读取一个文件：`prismd.json`（可通过环境变量 `PRISMD_CONFIG_PATH` 自定义路径）。通过已安装的 npm 包生成配置：`node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`。

### 冒烟测试

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## 密钥管理

prismd 仅从**一个**位置读取 API 密钥：`~/.prismd/` 目录。密钥绝对不会写入代码仓库、`prismd.json` 或 git 提交中。加载优先级（高优先级优先）：

| 字段 | 系统环境变量 | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd`（本地保护令牌） | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- 字段对应的环境变量名称为大写字段名加 `_API_KEY`。
- 两种文件格式均为可选并可共存；`.env` 为 `KEY=value` 格式，`keys.yaml` 为单层 `field: value` 格式。参考示例文件 `.env.example` / `keys.yaml.example`。
- 请使用 `chmod 600` 保护这两个文件。如果权限过于开放，prismd 启动时会输出警告。
- 密钥在服务启动时读取一次；修改密钥后请重启服务。
- 本地令牌（`prismd` 字段）用于保护三个 POST 入口；每个请求必须携带 `Authorization: Bearer <token>` 或 `x-api-key: <token>`（Claude Code 默认请求头）。令牌错误或缺失会直接返回 401，请求不会转发至上游。

## 配置系统

`prismd.json` 由生成器自动构建，无需手动编写。配置生成器合并以下三层数据：

| 层级 | 文件 | 作用 |
| --- | --- | --- |
| Presets（内置预设） | `presets/providers.json` | 内置 Provider 定义、免费模型元数据（上下文窗口、配额限制、标签）及来源出处与核对时间戳、默认别名配置。运行时不直接读取。 |
| User overrides（用户覆盖） | `config.user.json` | 在预设之上的自定义修改：别名排序、自定义候选模型、策略配置、服务器设置。此处不包含密钥。 |
| Keys（密钥） | `~/.prismd/` | 生成器仅检测密钥是否存在：未配置密钥的 Provider 其候选模型将被自动跳过。 |

修改任意层后，运行 `npm run generate:config` 即可重新生成。输出内容经过 JSON Schema 校验，且保持字节级稳定（输入相同则输出绝对一致）。

`config.user.json` 常见覆盖示例：

```jsonc
{
  "aliases": {
    "free-auto": {
      // 调整候选模型顺序：排在首位的最先尝试
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // 每个请求最多尝试 3 个候选模型
    "connectTimeoutMs": 5000          // 更严格的连接超时时间
  }
}
```

也可以内联定义全新模型候选（例如未在预设中收录的模型）：

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

网关开箱即用支持标准 `baseUrl` 端点（`/responses` 或 `/chat/completions`）添加新 Provider，也可在 `src/providers/` 中为特定 Provider 扩展自定义请求构建逻辑以添加特殊 Header。所有入口端点（`/v1/responses`、`/v1/chat/completions`、`/v1/messages`）均可在不同协议之间无缝转换。

## 路由机制：请求如何挑选候选模型

1. 解析别名获取有序候选列表（完全遵照 `prismd.json` 中的排列顺序）。
2. **硬过滤（Hard excludes）**：剔除当日配额已耗尽（`limits.dailyRequests`）、上下文窗口（`contextWindow`）小于估算输入大小（请求字符数 ÷ 4）、或当前处于不健康/冷却期的候选。
3. **软降权（Soft demotion）**：当日配额已使用 ≥ 80%（`quotaSoftLimitRatio`）的候选移至列表末尾。
4. 列表中的首个可用候选将接收请求；若失败，故障转移机制将依次尝试后续候选。

网关自身返回的错误响应（遵循 OpenAI 规范 `{"error": {...}}` 格式）：

| 场景 | HTTP 状态码 | 错误码 Code | 说明 |
| --- | --- | --- | --- |
| 缺失或错误的 Bearer Token | 401 | `invalid_api_key` | 请求不会发送至上游 |
| 未知的别名或模型名 | 404 | `model_not_found` | |
| 所有候选均已耗尽配额或处于不健康状态 | 429 | `quota_exceeded` | `error.metadata` 中列出各候选被过滤的具体原因 |
| 输入长度超出所有候选的上下文窗口 | 422 | `context_window_exceeded` | `error.metadata` 中列出各候选的上下文限制 |
| 所有尝试过的候选均请求失败 | 502 | `gateway_all_candidates_failed` | `error.metadata` 中列出每次尝试的上游状态 |
| 网关内部错误 | 500 | `gateway_internal_error` | |

## 故障转移（Failover）

- **触发条件**（流式传输开始前）：网络连接失败、连接超时，以及上游返回 401、403、429、5xx。网关记录失败模型（健康计数器 +1），并尝试下一个候选模型，最多尝试 `maxCandidatesPerRequest` 次。
- **不触发条件**：400/404/422 及其他请求类 4xx 错误——此类错误表明请求本身存在问题，网关直接透传错误（若对每个候选重试只会白白消耗可用额度）。
- **流式开始后**：绝不重试。若流式传输过程中发生连接中断或流空闲超时，网关以 SSE `error` 事件形式结束响应。
- 当上游 429 响应带有 `Retry-After` 头且启用了 `respectRetryAfter` 时，该候选模型的冷却时间将被设置为 `max(cooldownMs, Retry-After)`。

## 配额与用量统计

用量在内存中累加，并在满足以下任一条件时刷入 SQLite（`data/prismd.sqlite`，启用 WAL 模式）：每 5 秒或每积攒 20 条记录；服务关闭（SIGINT/SIGTERM）时强制刷盘（为进行中的流最多保留 30 秒）。

| 数据表 | 内容 |
| --- | --- |
| `usage_daily` | 按日聚合数据（日期、Provider、模型、请求数、Token 数）——路由配额计算的数据源。服务启动时加载，配额限制跨重启生效。 |
| `request_log` | 详细请求日志（请求 ID、别名、Provider、模型、状态、Token 消耗、故障转移标记、耗时）。保留 14 天，启动时自动清理过期记录。 |

- Token 计算：上游返回用量信息时记录真实数值；否则采用保守估算（输入 = 请求字符数 ÷ 4，输出 = 流式输出字符数 ÷ 4）。`source` 字段标记为 `real` / `estimated` / `mixed`。
- 配额本质是**路由权重，绝不会硬性阻断您的请求**：即使预设中的配额数字有偏差或过期，最坏情况仅是顺序非最优或遇到上游 429，此时故障转移机制会自动处理。
- `data/` 目录权限为 `0700`，数据库文件权限为 `0600`，已加入 `.gitignore`。删除 `data/prismd.sqlite` 即可重置计数器。

## 健康检查状态机

纯被动检查——prismd 绝不会主动向上游发送探测请求（免费额度极其珍贵）。每个 `(provider, model)` 候选状态维护在内存中（服务重启时重置）：

```
healthy（健康） → (连续失败 3 次) → cooldown 60s（冷却中） → half-open（半开，放行 1 次请求探测）
                     ↑                                                  成功 → healthy
                     └────────────────────────────────────────── 失败 → 重新进入 cooldown
```

- 401/403 会在 `lastError` 中单独标记，方便在日志中快速定位鉴权问题。
- 阈值可通过 `policies.failThreshold` / `policies.cooldownMs` 进行配置。

## 策略配置参数参考

所有 `policies` 字段说明（展示默认值），可在 `config.user.json` 中覆盖配置：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | 触发故障转移的上游 HTTP 状态码列表 |
| `retryBeforeStream` | `true` | 在流式输出开始前，遇到错误是否尝试其他候选模型 |
| `retryAfterStream` | `false` | 流式输出开始后是否重试（默认严格关闭） |
| `maxCandidatesPerRequest` | `2` | 单个请求最多尝试的候选模型数量 |
| `respectRetryAfter` | `true` | 是否遵循上游 429 响应中的 `Retry-After` 头来设置冷却时长 |
| `quotaSoftLimitRatio` | `0.8` | 触发候选模型软降权的每日配额使用比例阈值 |
| `connectTimeoutMs` | `10000` | 流式输出开始前的连接建立超时时间（毫秒） |
| `streamIdleTimeoutMs` | `300000` | 流式数据块之间的最大间隔时间（毫秒），超时将发送 SSE error 终止 |
| `failThreshold` | `3` | 候选模型进入冷却状态所需的连续失败次数 |
| `cooldownMs` | `60000` | 候选模型的冷却时长（毫秒） |

## 客户端接入指南

### Codex

1. 复制示例配置文件并生成 Codex 模型目录：

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # 生成 ~/.codex/prismd-models.json
```

2. 运行：

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

- 该 profile 中的 `model` 指定为网关别名 `free-auto`；`model_catalog_json` 为 Codex 提供准确的模型元数据（上下文窗口等），消除未知模型警告。catalog 为每个别名配置其所有候选模型中的**最小**上下文窗口——采用保守值以确保小上下文模型不会溢出。
- 建议保持 Codex 自身的重试次数较低：`request_max_retries = 0`（让网关层统一负责故障转移——网关掌握全局候选健康度与配额状态）以及 `stream_max_retries = 1`（用于流重连；网关在流式输出中不会重试，两层机制互不干扰）。

### 其他客户端（Claude Code、OpenCode、dsh、Pi）

所有客户端共享相同的别名（`free-auto`、`free-fast`、`free-code`）与相同的本地保护令牌。将客户端的 API 地址指向网关并选择对应协议：

- **Claude Code** —— Anthropic Messages 协议：配置 `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`，并将 `ANTHROPIC_AUTH_TOKEN`（或 `x-api-key`）设置为您的 prismd 本地令牌。Claude 模型名称（如 `claude-...-sonnet-...` 等）将自动回退匹配至配置的别名。详情参考 `examples/claude-code/`。
- **OpenCode / dsh / Pi** —— OpenAI 兼容协议：将 Provider 的 `baseURL` 设置为 `http://127.0.0.1:8787/v1`，API key 设置为您的 prismd 本地令牌。支持 `responses` 与 `chat` 两种协议接入，并自动与所有候选模型完成跨协议转换。详情参考 `examples/opencode/`、`examples/dsh/`、`examples/pi/`。

> 以上客户端集成已通过 Mock 上游的全链路端到端验收测试，但尚未在所有真实客户端最新版上逐一验证——配置文件样例依据官方文档编写，可能需要个别微调。欢迎反馈实际使用体验。

## 状态看板、Web UI 与服务发现

prismd 提供内置、零外部依赖的端点与工具，用于实时查看路由状态、候选健康度和 Token 用量：

- **Web UI 控制台 (`GET /ui`)**：
  在浏览器中打开 `http://127.0.0.1:8787/ui`。展示实时状态徽章（🟢 healthy 正常、🟡 rate_limited/cooldown 速率受限/冷却中、🔴 unavailable 不可用）、每日请求配额进度条（含软限制预警标识）、Token 统计、上下文窗口大小、当前活跃候选标识以及实时事件流。页面自动通过 SSE 订阅更新，若 SSE 断开会自动平滑降级为轮询。

- **CLI 终端状态命令 (`prismd status` / `npm run status`)**：
  直接在终端中查看网关状态：
  ```bash
  prismd status          # 全局安装或通过二进制运行时使用
  npm run status         # 在源码仓库中使用
  ```
  网关运行时将输出带 ANSI 彩色的实时状态指标表格；若网关未运行，命令会自动读取 SQLite `usage_daily` 数据库以展示今日已记录的 Token 统计。

- **JSON 状态 API (`GET /v1/modelstatus`)**：
  返回所有别名、候选模型、健康状态、冷却计时器、Token 用量以及当前模拟计算的 `activeCandidate` 完整内存快照，无磁盘 I/O 开销。无需鉴权。

- **SSE 实时流 (`GET /v1/modelstatus/stream`)**：
  通过 Server-Sent Events 订阅实时状态变更。建立连接时推送完整 `status` 快照，当发生健康状态变动（429、401、冷却、恢复）或配额跨越阈值（80%、100%）时推送增量 `candidate_changed` 事件，并带有 30 秒心跳机制。无需鉴权。

- **健康检查 (`GET /healthz`)**：
  返回 `{ "status": "ok", "uptime": ..., "candidates": [...] }`。若存在候选遇到无效 API 密钥（`auth_error`），则返回 `"status": "degraded"` 并附带 `authErrors` 信息。无需鉴权。

- **模型服务发现 (`GET /v1/models`)**：
  以标准 OpenAI 格式 `{ "object": "list", "data": [...] }` 返回已配置的逻辑别名模型列表。无需鉴权。

## 可观测性

- **结构化日志**：标准错误（stderr）输出 pino JSON 日志——每行一个事件，方便管道处理与日志收集。
- **请求链路追踪**：每个请求分配全局唯一 UUID，通过日志与错误响应（`x-request-id`）透传，串联单个请求的所有事件。
- **单行请求汇总**：每个请求结束时输出一条 `request_end` 汇总日志，记录 HTTP 方法、请求路径、别名、命中候选模型、上游状态码、首 Token 延迟、总耗时及 Token 消耗。
- **敏感信息脱敏**：请求中的 `authorization` / `api-key` / `api_key` / `token` 等字段值在记录日志前均会被自动替换为 `****`。绝不记录原始敏感请求体。
- 内部 `request_start` / `first_token` / `request_end` 事件实现了统一的导出器接口（`src/observability/exporter.ts`）；当前默认导出至 stderr JSON，后续可无缝接入 OTLP 等外部追踪系统而无需修改核心请求链路。

## 常见问题排查

**所有请求均返回 429。** OpenRouter `:free` 模型共享公用并发池；即使账户额度充裕，429 也可能随时出现。prismd 会自动故障转移至下一个候选模型——可查看网关日志中 `request_end` 是否带有 `failovers: 1`。若全部候选均遇到 429，可修改 `config.user.json` 调整 `free-auto` 别名顺序，将拥堵较少的模型置顶并重新生成配置。

**Codex 提示 `Model metadata for free-auto not found`。** 执行 `npm run generate:codex-catalog`，并确认配置文件中的 `model_catalog_json` 正确指向 `~/.codex/prismd-models.json`。（此提示为警告，不影响实际使用。）

**版本升级后候选模型消失。** M2 阶段升级了配置格式（Provider 密钥字段由 `apiKeyEnv` 改为 `apiKeyField`）。请重新执行 `npm run generate:config`；密钥文件存放在 `~/.prismd/` 中，无需做任何迁移。

**网关无法启动 / 报 500 错误。** 网关启动时会对 `prismd.json` 进行严格的 Schema 校验并给出明确的错误字段路径。请检查 Provider 的 `baseUrl` 与模型定义是否符合规范。标准 Provider 使用默认请求构建器，自定义请求头可在 `extraHeaders` 中声明。

**重置用量计数器。** 停止网关运行，直接删除 `data/prismd.sqlite` 即可。

## 项目架构与目录结构

- `prismd.json` —— 单一运行时配置（由脚本自动生成，不提交 git）；服务启动时读取一次。
- `presets/providers.json` —— 内置 Provider 与免费模型预设、默认别名配置，包含数据来源与核对时间戳；运行时不直接读取。
- `config.user.json` —— 可选的用户覆盖配置（别名、策略、服务器参数）；由生成器进行合并。
- `config.schema.json` —— 用于校验 `prismd.json` 的 JSON Schema（draft-07）。
- `scripts/generate-config.mjs` —— 合并 presets + 用户覆盖 + `~/.prismd/` 密钥，生成校验通过且字节稳定的 `prismd.json`。
- `scripts/generate-codex-catalog.mjs` —— 基于相同元数据生成 `~/.codex/prismd-models.json`（Codex 的 `model_catalog_json`），每个别名生成一条记录。
- `examples/` —— 各客户端配置样例：`codex/`（profile 与 catalog）、`claude-code/`、`opencode/`、`dsh/`、`pi/`（说明文档）。
- `src/ingress/` —— 客户端协议接入层：`responses.ts`（OpenAI Responses）、`chat.ts`（OpenAI Chat Completions）、`messages.ts`（Anthropic Messages）+ `messages-converter.ts`。
- `src/egress/` —— 上游协议适配层：`responses.ts`（Responses 直通）、`chat.ts`（Chat 出站 + 构建器注册表）、`chat-converter.ts`（Chat↔Responses 协议转换，含流式 SSE 状态机）、`raw.ts`（通用 HTTP 层：超时处理、SSE 解包、用量提取）。
- `src/routes/` —— 无需鉴权的状态与服务发现路由（`/healthz`、`/v1/models`、`/v1/modelstatus`、`/ui`）。
- `src/ui/` —— 内置单文件独立 Web UI 状态看板（HTML/CSS/JS 单文件）。
- `src/cli/` —— CLI 命令实现（`prismd status` 终端表格渲染器）。
- `src/providers/` —— 各 Provider 专用请求构建器（基础 URL、特殊请求头；openrouter / groq / cerebras）。
- `src/core/` —— 别名路由（配额/窗口/健康过滤、软降权、Claude 名称回退）、被动健康状态机、状态事件广播器、配额用量统计、SQLite 状态持久化存储。
- `src/observability/` —— pino 结构化日志（stderr JSON）、request-id 链路追踪、导出器接口。
- `src/keys.ts` —— 密钥解析模块，支持系统环境变量 / `~/.prismd/.env` / `~/.prismd/keys.yaml`（支持 `PRISMD_HOME` 路径覆盖）。
- `src/auth.ts` —— 本地 Bearer 保护令牌校验（`auth.localTokenField`）；未通过鉴权的 401 请求绝不转发至上游。

## 常用脚本命令

- `npm run dev` —— 监听模式启动开发服务器（tsx watch `src/server.ts`）
- `npm run build` / `npm start` —— 编译 TypeScript 并运行 `dist/` 生产构建产物
- `npm run typecheck` —— 执行类型检查 `tsc --noEmit`
- `npm test` —— 运行单元测试与集成测试（tsx + node:test）
- `npm run test:e2e` —— 针对 Mock 上游运行端到端黑盒验收测试
- `npm run status` —— 打印格式化的实时候选状态与配额表格
- `npm run generate:config` —— 基于 presets + `config.user.json` + `~/.prismd/` 密钥重新生成 `prismd.json`
- `npm run generate:codex-catalog` —— 重新生成 `~/.codex/prismd-models.json`
