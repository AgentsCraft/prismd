# 智能体客户端接入总览 (Client Integration Guide)

prismd 为各类编码智能体（Agent）和 IDE 插件提供本地统一的网关入口（默认监听 `http://127.0.0.1:8787/v1`），在后台自动完成多上游聚合、多 Key 轮询、并发与限流熔断，以及本地 Ollama 离线兜底。

---

## 协议与客户端支持矩阵

prismd 对外提供三套标准协议端点，覆盖绝大多数主流编码智能体：

| 协议分类 | 网关端点 | 鉴权方式 | 支持的客户端 | 核心特性 |
|---|---|---|---|---|
| **Anthropic Messages** | `POST /v1/messages` | `x-api-key` / `Bearer` | **Claude Code** | 原生支持 Tool Calling、Thinking 思考块、双向流式转换 |
| **OpenAI Responses** | `POST /v1/responses` | `Authorization: Bearer` | **Codex CLI**、**DeepSeek Harness (dsh)** | 结构化会话状态管理、多轮工具调用 |
| **OpenAI Chat Completions** | `POST /v1/chat/completions` | `Authorization: Bearer` | **Cursor**、**OpenCode**、**Pi Agent**、**dsh**、**Aider** 等 | 行业通用标准，全 IDE / Agent 生态直接兼容 |

---

## 前置准备：网关启动与连通性验证

1. **启动本地网关**：
   ```bash
   prismd
   ```
2. **验证网关健康状态与连通性**：
   ```bash
   # 测试 Chat Completions 端点连通性
   curl -s http://127.0.0.1:8787/v1/chat/completions \
     -H "Authorization: Bearer test" \
     -H "Content-Type: application/json" \
     -d '{"model":"free-auto","messages":[{"role":"user","content":"ping"}]}'
   ```
   > 提示：本地令牌对应 `~/.prismd/keys.yaml` 中的 `prismd` 字段，或启动网关时的 `PRISMD_API_KEY` 环境变量（默认值为 `my-local-secret`）。

---

## 各客户端接入配置详解

### 一、Anthropic Messages 协议客户端

#### 1. Claude Code
Claude Code 原生支持通过环境变量重定向 Anthropic API 端点。

- **配置环境变量**：
  ```bash
  export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
  export ANTHROPIC_API_KEY="your-prismd-local-token"
  ```
- **运行命令**：
  ```bash
  claude
  ```
- **配置要点**：
  - `ANTHROPIC_BASE_URL` 结尾必须包含 `/v1`，且末尾不要带额外斜杠。
  - 详细指引与持久化配置见 [Claude Code 接入指南](../../examples/claude-code/README.md)。

---

### 二、OpenAI Responses 协议客户端

#### 2. Codex CLI
Codex CLI 可通过 `wire_api = "responses"` 配置接入本地网关。

- **配置文件**：`~/.codex/prismd.config.toml`
  ```toml
  model = "free-auto"
  model_provider = "prismd"

  [model_providers.prismd]
  name = "prismd"
  base_url = "http://127.0.0.1:8787/v1"
  env_key = "PRISMD_API_KEY"
  wire_api = "responses"
  request_max_retries = 2
  stream_max_retries = 1
  stream_idle_timeout_ms = 180000
  ```
- **运行命令**：
  ```bash
  PRISMD_API_KEY="your-prismd-local-token" codex --profile prismd
  ```
- **详细指引**：见 [Codex CLI 接入指南](../../examples/codex/README.md)。

---

### 三、OpenAI Chat Completions 协议客户端

#### 3. Cursor
- **配置步骤**：
  1. 打开 Cursor：`Settings` → `Models`。
  2. 启用 **OpenAI API Key**，输入网关本地令牌（如 `my-local-secret`）。
  3. 勾选 **Override OpenAI Base URL**，填写：`http://127.0.0.1:8787/v1`。
  4. 点击 **Add Model** 添加虚拟模型别名：`free-auto`、`free-fast`、`free-code`。
- **详细指引**：见 [Cursor 接入指南](../../examples/cursor/README.md)。

#### 4. OpenCode
- **配置文件**：`~/.config/opencode/config.json`
  ```json
  {
    "providers": {
      "prismd": {
        "type": "openai",
        "baseUrl": "http://127.0.0.1:8787/v1",
        "apiKey": "your-prismd-local-token",
        "models": ["free-auto", "free-fast", "free-code"]
      }
    }
  }
  ```
- **运行命令**：
  ```bash
  opencode --model prismd/free-auto
  ```
- **详细指引**：见 [OpenCode 接入指南](../../examples/opencode/README.md)。

#### 5. DeepSeek Harness (dsh)
- **配置文件**：`~/.dsh/config.toml`
  ```toml
  [providers.prismd]
  type = "openai-completions" # 亦支持 "openai-responses"
  base_url = "http://127.0.0.1:8787/v1"
  api_key_env = "PRISMD_API_KEY"
  models = ["free-auto", "free-fast", "free-code"]
  ```
- **运行命令**：
  ```bash
  PRISMD_API_KEY="your-prismd-local-token" dsh --model prismd:free-auto
  ```
- **详细指引**：见 [dsh 接入指南](../../examples/dsh/README.md)。

#### 6. Pi Agent
- **配置文件**：`~/.pi/config.json`
  ```json
  {
    "provider": {
      "name": "prismd",
      "protocol": "openai-completions",
      "endpoint": "http://127.0.0.1:8787/v1",
      "apiKey": "your-prismd-local-token",
      "defaultModel": "free-auto"
    }
  }
  ```
- **运行命令**：
  ```bash
  pi run
  ```
- **详细指引**：见 [Pi Agent 接入指南](../../examples/pi/README.md)。

#### 7. Aider
- **环境变量运行方式**：
  ```bash
  export OPENAI_API_BASE="http://127.0.0.1:8787/v1"
  export OPENAI_API_KEY="your-prismd-local-token"
  aider --model openai/free-auto
  ```
- **配置文件方式** (`~/.aider.conf.yml`)：
  ```yaml
  openai-api-base: http://127.0.0.1:8787/v1
  openai-api-key: your-prismd-local-token
  model: openai/free-auto
  ```
- **详细指引**：见 [Aider 接入指南](../../examples/aider/README.md)。

---

## 统一模型别名选择

在任何客户端中，推荐使用 prismd 预设的模型别名：

| 模型别名 | 调度策略 | 适用场景 | 备选回退队列 |
|---|---|---|---|
| **`free-auto`** | 优先云端大模型，全限流时回退至本地 Ollama | 日常主力编码、代码重构、多文件分析 | Gemini 2.0 Flash → Llama 3.3 70b → Qwen 2.5 Coder 7B (本地) |
| **`free-fast`** | 极速响应轻量模型 | 代码补全、简单行内问答、Git 提交信息生成 | Gemini Flash Lite → Llama 3.1 8b → Qwen 2.5 Coder 7B (本地) |
| **`free-code`** | 代码特化模型队列 | 专注函数生成、单元测试编写 | Gemini 2.0 Flash → Cohere North Mini → Llama 3.3 70b |

---

## 常见问题与排查 (Troubleshooting)

1. **客户端提示 401 Unauthorized**：
   - 检查客户端填写的 API Key 是否与 `~/.prismd/keys.yaml` 中的 `prismd` 字段一致。
2. **客户端提示 Connection Refused / 无法连接**：
   - 确认 prismd 网关已在后台运行（`curl http://127.0.0.1:8787/v1/models` 返回 200）。
   - 确认 Base URL / Endpoint 中包含了 `/v1`。
3. **Claude Code 提示 model not found**：
   - prismd 内置了对 Claude 常见模型名称（如 `claude-3-5-sonnet`, `claude-3-opus`）的自适应映射，会自动将其无缝转发至 `free-auto` 队列，无需手动改动参数。
