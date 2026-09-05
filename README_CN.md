# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

**本地优先的 LLM 高可用网关**，聚合全球免费/低额度模型 API（OpenRouter、Groq、Cerebras、Gemini、NVIDIA、GitHub 等）与本地 Local LLM（Ollama），为各类编码智能体（Claude Code、Codex CLI、Cursor、OpenCode、Aider 等）提供永不中断、稳定可切换的统一接口。

```text
┌────────────────────────────────┐       ┌─────────────────────────────────────┐       ┌─────────────────────────────────────┐
│       编码智能体 (Clients)      │       │        prismd 本地高可用网关         │       │          上游模型服务商 (Providers)  │
│                                │       │          127.0.0.1:8787             │       │                                     │
│  Claude Code  (Messages 协议)  ├──────►│  [全协议透明转换 (Converter)]        ├──────►│  云端免费 / 低额度 API              │
│  Codex CLI    (Responses 协议) ├──────►│    • Messages ↔ Responses ↔ Chat    │       │    • OpenRouter / Groq / Cerebras   │
│  Cursor / dsh (Chat 协议)      ├──────►│  [智能路由队列 (free-auto)]         │       │    • Google Gemini / NVIDIA NIM     │
│  OpenCode / Pi / Aider         ├──────►│    • 配额加权 / 上下文检查 / 429 熔断 │       │    • GitHub Models / AMD            │
│                                │       │  [多 Key 轮询池 (Key Pool)]         │       │                                     │
│                                │       │    • 单 Key 冷却隔离 / 负载均衡     │  全限 │  本地离线兜底 (Zero-Downtime)       │
│                                │       │    • 本地零宕机自动回退             ├──────►│    • Ollama (qwen2.5-coder / r1)    │
│                                │       │                                     │  流/断│    • LM Studio (本地 GGUF 模型)      │
└────────────────────────────────┘       └─────────────────────────────────────┘       └─────────────────────────────────────┘
```

---

## 核心特性：一句话看懂

1. **统一模型别名（`free-auto`）**：不再纠结选哪个模型，一个别名自动从上游数十个免费模型中优选最合适候选。
2. **多 Key 轮询与单 Key 熔断（Key Pool）**：单账号限流不够用？填多个 Key，网关自动 Round-Robin 轮询分发；单 Key 429 自动冷却并切到次 Key，吞吐翻倍。
3. **可选本地兜底（Ollama / LM Studio）**：默认别名为纯云端队列。本地跑有推理后端？通过 `config.user.json` 把它追加进别名队列——云端免费 API 全挂或断网时，请求即回落到本地模型，编码 Agent 任务永不崩溃中断。
4. **全协议跨端透明中继**：无论是 Claude Code（Messages）、Codex（Responses）还是 Cursor/OpenCode（Chat），全自动双向流式转换。
5. **内嵌 Web 控制台与热重载**：访问 `http://127.0.0.1:8787/ui` 直观查看健康状态与配额进度条；修改配置后发送 `SIGHUP` 信号无缝热更新。

---

## 支持项目

如果 prismd 帮您节省了时间与 Token 成本，欢迎请作者喝杯咖啡：

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3 步快速上手

### 步骤 1：安装并启动网关

```bash
# 方式 A：npm 全局安装
npm install -g @prismd/prismd              # 正式稳定版
# 或安装 RC 尝鲜预览版（对齐 develop 最新分支）：
npm install -g @agentscraft/prismd         # RC 预览版

# 方式 B：从源码运行
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### 步骤 2：配置 API Key

在 `~/.prismd/keys.yaml` 或工程目录 `.env` 中填入你的免费 API Key（配置任意一个或多个均可，未配置的提供商自动跳过）：

```yaml
# ~/.prismd/keys.yaml (建议权限 chmod 600)
prismd: "my-local-secret"       # 本地网关安全保护令牌（客户端连接使用）

# 云端模型服务商（支持填单 Key 或多 Key 列表实现自动轮询）：
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # 多 Key 轮询与单 Key 限流隔离
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models 个人访问令牌
amd: "amd_token_xxxx"           # 可选：AMD Developer Cloud 令牌

# 本地离线兜底：
# ollama: 免 Key 运行（默认自动探测并直连 http://127.0.0.1:11434/v1）
```

生成配置并启动：
```bash
prismd
# 或源码运行：npm run generate:config && npm run dev
```

> 📖 **各提供商详细配置指南**：参阅 [免费 / 低额度模型提供商配置总览](docs/providers/README.md)，包含 [OpenRouter](docs/providers/openrouter.md)、[Groq](docs/providers/groq.md)、[Cerebras](docs/providers/cerebras.md)、[Google Gemini](docs/providers/gemini.md)、[NVIDIA NIM](docs/providers/nvidia.md)、[GitHub Models](docs/providers/github-models.md)、[AMD](docs/providers/amd.md)、[本地 Ollama](docs/providers/ollama.md) 及 [LM Studio](docs/providers/lmstudio.md) 的获取步骤与模型列表。

### 步骤 3：配置智能体客户端（即开即用）

| 客户端 | 极简配置命令 / 设置项 | 配置示例 |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="my-local-secret"`<br>`claude` | [详细指南](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=my-local-secret codex --profile prismd` | [详细指南](examples/codex/README.md) |
| **Cursor** | Settings → Models → 开启 OpenAI API Key（填 `my-local-secret`）<br>勾选 **Override OpenAI Base URL** 填 `http://127.0.0.1:8787/v1`<br>模型填 `free-auto` | [详细指南](examples/cursor/README.md) |
| **OpenCode** | `~/.config/opencode/config.json` 设置 `baseUrl: "http://127.0.0.1:8787/v1"` | [详细指南](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml` 设置 `base_url = "http://127.0.0.1:8787/v1"`<br>`PRISMD_API_KEY=my-local-secret dsh --model prismd:free-auto` | [详细指南](examples/dsh/README.md) |
| **Pi Agent** | `~/.pi/config.json` 设置 `endpoint: "http://127.0.0.1:8787/v1"`<br>`pi run` | [详细指南](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="my-local-secret"` `aider --model openai/free-auto` | [详细指南](examples/aider/README.md) |

> 📖 **完整文档**：参阅 [智能体客户端接入总览与协议详解](docs/clients/README.md)。

---

## 核心功能详解

### 1. 智能路由调度与故障转移算法

prismd 通过多维评估管道，对每次请求动态决策最优候选模型：

- **上下文窗口检查 (Context Window Check)**：分发前预估输入 Token 量，自动硬排除上下文窗口不足的候选模型，避免触发 400 Context Overflow 报错。
- **软配额平滑降权 (Quota-Weighted Soft Limit)**：当云端候选模型当日调用量达到 80% 软限（`quotaSoftLimitRatio`）时，自动将其优先级软降至队列尾部，为高优先级任务留存配额。
- **零中断 429 故障转移 (Zero-Crash Failover)**：若上游服务商返回 429 限流或 5xx 故障，网关自动透明重试别名队列中的下一候选模型，客户端会话完全无感知。
- **默认模型别名**：
  - `free-auto`：全能自动编码模型。优先优选 Gemini 2.0 Flash / Llama 3.3 70B 等大模型，默认纯云端队列。

### 2. 多 Key 轮询与单 Key 熔断隔离 (Key Pool)

所有云端模型提供商（Groq、Cerebras、Google Gemini、OpenRouter、NVIDIA NIM、GitHub Models 等）均通用支持配置多 Key 自动 Round-Robin 轮询分发与单 Key 限流隔离：

- **`~/.prismd/keys.yaml` 格式**（支持列表与数组语法）：
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **`.env` 或环境变量格式**（英文逗号分隔）：
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **工作机制**：网关按 Round-Robin 算法在可用 Key 之间轮询。若某个 Key（如 `gsk_key1`）收到 429 限流响应，网关仅将该 Key 标记进入冷却期（严格尊重上游返回的 `Retry-After`），后续请求立即透明分发至同提供商的健康 Key（`gsk_key2`）或切换上游候选，使单提供商吞吐量成倍提升且不中断业务。

### 3. 本地 LLM 兜底 (Ollama & LM Studio，可选)

prismd 内置 Ollama 与 LM Studio 提供商，但默认别名只含云端候选——没装本地后端的机器不会生成永远连不上的死候选。本地跑有推理服务？通过 `config.user.json` 把它追加进别名队列（候选数组为整体替换，需一并保留想保留的云端候选）：

```json
{
  "aliases": {
    "free-auto": {
      "candidates": ["gemini-2.0-flash", "cohere/north-mini-code:free", "qwen2.5-coder:7b"]
    }
  }
}
```

- **Ollama**：内置零配置支持（默认 `http://127.0.0.1:11434/v1`）：
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**：支持通过本地 OpenAI 兼容服务器（`http://127.0.0.1:1234/v1`）加载 GGUF 模型。详见 [LM Studio 配置指南](docs/providers/lmstudio.md)。
- 本地候选位于队列末位，云端模型全部耗尽时请求自动回落，编码智能体任务永不中断。

### 4. 全协议跨端透明中继

网关在底层提供三大主流协议的双向流式转换引擎：
- **Anthropic Messages** (`POST /v1/messages`)：完整支持 Claude Code（Tools 工具调用、Thinking 思考块、SSE 流式事件）。
- **OpenAI Responses** (`POST /v1/responses`)：支持 Codex CLI 与 DeepSeek Harness (`dsh`)。
- **OpenAI Chat Completions** (`POST /v1/chat/completions`)：兼容 Cursor、OpenCode、Pi Agent、Aider 等主流工具。

### 5. 自定义配置与扩展 (`config.user.json`)

在项目根目录（或自定义目录）编写 `config.user.json` 添加自定义提供商、私有模型或别名队列：

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
运行 `prismd generate`（源码模式运行 `npm run generate:config`）即可完成配置编译合并。

### 6. 运行时配置热重载 (`SIGHUP`)

修改路由表、密钥或别名后，无需重启网关，直接发送 SIGHUP 信号：
```bash
kill -HUP $(pgrep -f "prismd")
```
网关完成新配置合法性校验后原子更新内存路由表，进行中的流式长连接完全不受影响。

---

## 状态监控与 Web 控制台

- **Web 仪表盘**：浏览器直接打开 `http://127.0.0.1:8787/ui`，实时查看：
  - 各候选模型实时健康状态（`healthy` / `rate_limited` / `cooldown`）
  - 每日配额进度条与 Token 消耗统计
  - 支持 10 种语言界面切换与「一键重置用量（Reset usage）」
- **CLI 终端状态与管理**：
  ```bash
  prismd status      # 终端输出各候选模型的彩色状态矩阵
  prismd generate    # 重新编译生成 ~/.prismd/prismd.json
  ```

---

## 常见问题排查

- **Q: 为什么提示 `missing API key for provider`？**
  - 请检查 `~/.prismd/keys.yaml` 或 `.env` 中是否配置了对应提供方的 Key，配置后运行 `prismd generate`（或源码模式下运行 `npm run generate:config`）更新配置。
- **Q: 云端模型频繁 429 怎么办？**
  - 为该提供方配置多个账号 Key 开启轮询，或将本地 Ollama 候选追加进别名队列（见[本地 LLM 兜底](#3-本地-llm-兜底-ollama--lm-studio可选)）。
- **Q: 如何重置当天的调用配额记录？**
  - 在 Web 控制台右上角点击「Reset usage」按钮，或删除本地数据库文件 `data/prismd.sqlite`。
