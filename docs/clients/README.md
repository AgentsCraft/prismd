# 智能体客户端接入指南 (Clients Integration Guide)

prismd 对外暴露三套标准协议端点，支持将请求透明转发至上游模型池并执行自动限流熔断与故障转移（Failover）。

---

## 协议支持概览

| 协议分类 | 网关端点 | 支持/兼容客户端 | 协议特点 |
|---|---|---|---|
| **Anthropic Messages** | `POST /v1/messages` | Claude Code | 原生支持 Tools、Thinking 块、流式事件 |
| **OpenAI Responses** | `POST /v1/responses` | Codex CLI、DeepSeek Harness (dsh) | 支持上下文会话管理、多轮工具调用 |
| **OpenAI Chat Completions** | `POST /v1/chat/completions` | Cursor、OpenCode、Pi Agent、dsh、Aider 等 | 行业通用标准接口，兼容全部主流 IDE 与 Agent |

---

## 客户端接入详情

### 1. Anthropic Messages 协议客户端

#### Claude Code
- **端点**：`http://127.0.0.1:8787/v1`
- **配置方式**：
  ```bash
  export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
  export ANTHROPIC_API_KEY="your-prismd-local-token"
  claude
  ```
- **详细文档**：[Claude Code 接入指南](../../examples/claude-code/README.md)

---

### 2. OpenAI Responses 协议客户端

#### Codex CLI
- **端点**：`http://127.0.0.1:8787/v1`
- **配置文件**：`~/.codex/prismd.config.toml`
  ```toml
  model = "free-auto"
  model_provider = "prismd"

  [model_providers.prismd]
  name = "prismd"
  base_url = "http://127.0.0.1:8787/v1"
  env_key = "PRISMD_API_KEY"
  wire_api = "responses"
  ```
- **运行命令**：
  ```bash
  PRISMD_API_KEY="your-prismd-local-token" codex --profile prismd
  ```
- **详细文档**：[Codex CLI 接入指南](../../examples/codex/README.md)

---

### 3. OpenAI Chat Completions 协议客户端

#### Cursor
- **配置位置**：`Settings` → `Models`
- **配置步骤**：
  1. 开启 **OpenAI API Key**，填入本地网关令牌（`PRISMD_API_KEY`）。
  2. 勾选 **Override OpenAI Base URL**，填写 `http://127.0.0.1:8787/v1`。
  3. 在模型列表添加别名：`free-auto`、`free-fast`、`free-code`。
- **详细文档**：[Cursor 接入指南](../../examples/cursor/README.md)

#### OpenCode
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
- **详细文档**：[OpenCode 接入指南](../../examples/opencode/README.md)

#### DeepSeek Harness (dsh)
- **配置文件**：`~/.dsh/config.toml`
  ```toml
  [providers.prismd]
  type = "openai-completions" # 或 "openai-responses"
  base_url = "http://127.0.0.1:8787/v1"
  api_key_env = "PRISMD_API_KEY"
  models = ["free-auto", "free-fast", "free-code"]
  ```
- **运行命令**：
  ```bash
  PRISMD_API_KEY="your-prismd-local-token" dsh --model prismd:free-auto
  ```
- **详细文档**：[dsh 接入指南](../../examples/dsh/README.md)

#### Pi Agent
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
- **详细文档**：[Pi Agent 接入指南](../../examples/pi/README.md)

#### Aider
- **环境变量方式**：
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
- **详细文档**：[Aider 接入指南](../../examples/aider/README.md)

---

## 统一模型别名说明

所有客户端接入时均可直接使用 prismd 内置的虚拟模型别名：

- **`free-auto`**：通用编码模型队列（优先云端大模型，云端耗尽/断网时无缝回退至本地 Ollama）。
- **`free-fast`**：高响应速度轻量模型队列。
- **`free-code`**：代码生成与补全特化模型队列。
