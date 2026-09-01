# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

本地优先的 LLM 网关，聚合多个免费及低额度模型 API（OpenRouter、Groq、Cerebras 等），为各类编码智能体（Claude Code、Codex CLI、OpenCode 等）提供稳定、高可用的统一接口。

用户只需请求单个本地端点和统一别名（如 `free-auto`），prismd 自动完成：
- **智能路由与配额保护**：根据输入上下文窗口与每日配额使用情况自动优选候选模型，日配额消耗达到 80% 时软降权至队尾。
- **无缝故障转移**：在开始流式输出前，遇 429/401/5xx 错误或网络超时自动切换至下一候选模型。
- **全协议跨端转换**：原生支持 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages 协议，任意编码智能体均可无缝接入。

## 支持项目

如果 prismd 帮您节省了时间或配额，欢迎请作者喝杯咖啡：

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 快速安装与使用

### 方式 1：通过 npm 全局安装（推荐）

```bash
# 安装正式版本
npm install -g @prismd/prismd

# 或 RC 预览通道
# npm install -g @agentscraft/prismd

# 配置上游 API Key 与本地访问令牌
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # 本地保护令牌，例如 openssl rand -hex 32

# 启动网关服务（默认监听 127.0.0.1:8787）
prismd
```

### 方式 2：从源码运行

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # 填入 API Key 并 chmod 600
npm run generate:config                    # 合并预设与密钥生成运行时配置 prismd.json
npm run dev                                # 启动本地服务
```

### 验证运行

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## 客户端接入配置

所有接入客户端均将端点指向本地网关，并携带相同的本地保护令牌（`PRISMD_API_KEY`）。

### 1. Claude Code
Claude Code 原生支持通过环境变量指定 Anthropic 兼容网关，模型名称（`claude-*-sonnet` 等）会自动回退匹配至网关配置别名：
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
复制示例配置并生成模型元数据目录（消除未知模型警告）：
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # 生成 ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
在 Cursor 设置中开启自定义 OpenAI 端点：
- **Settings** → **Models** → 开启 **OpenAI API Key**，填入 `<your-prismd-local-token>`。
- 勾选 **Override OpenAI Base URL**，填入 `http://127.0.0.1:8787/v1`。
- 新增模型并启用：`free-auto`、`free-fast`、`free-code`。详见 [Cursor 接入说明](examples/cursor/README.md)。

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**：在 `~/.config/opencode/config.json` 中配置 provider `baseUrl: "http://127.0.0.1:8787/v1"`，详见 [OpenCode 说明](examples/opencode/README.md)。
- **DeepSeek Harness (dsh)**：在 `~/.dsh/config.toml` 中配置 `base_url = "http://127.0.0.1:8787/v1"`，详见 [dsh 说明](examples/dsh/README.md)。
- **Pi Agent**：在 `~/.pi/config.json` 中配置 `endpoint: "http://127.0.0.1:8787/v1"`，详见 [Pi 说明](examples/pi/README.md)。

---

## 密钥与配置管理

### 密钥管理
密钥可直接存放在工程根目录 `.env` 或全局目录 `~/.prismd/` 中，读取优先级如下（高到低）：
1. **系统环境变量**：`OPENROUTER_API_KEY`、`GROQ_API_KEY`、`GEMINI_API_KEY` 等
2. **当前工程目录**：`./.env`（复制自 `.env.example`）
3. **全局用户目录**：`~/.prismd/.env` 或 `~/.prismd/keys.yaml`（权限建议设置为 `chmod 600`）

### 自定义候选模型与排序
可在 `config.user.json` 中自定义别名优先级或新增模型，随后执行 `npm run generate:config`：
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
运行 `npm run generate:config`（若通过 npm 全局安装，运行 `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`）以应用更新。

各主流提供商（OpenRouter、Groq、Cerebras、Google Gemini、NVIDIA NIM、GitHub Models 等）的详细配置说明，详见 [免费模型提供商配置指南](docs/providers/README.md)。

---

## 状态监控与可观测性

- **Web 控制台**：浏览器访问 `http://127.0.0.1:8787/ui`，查看候选模型健康状态、每日配额进度条、Token 统计与实时事件流。
- **CLI 状态查看**：在终端运行 `prismd status`（或 `npm run status`）输出彩色终端监控表。
- **结构化日志**：stderr 输出 JSON 日志，敏感 Key 自动脱敏，每个请求包含唯一的 request-id 与耗时汇总。

---

## 工作机制与使用限制

1. **路由与过滤机制**：
   - 优先使用列表靠前的候选；
   - 自动跳过配额耗尽、上下文不足或处于冷却期的模型；
   - 当日配额使用超过 80% 时软降权移至队列尾部。
2. **故障转移边界**：
   - **流式响应输出前**：遇到 401/403/429/5xx 或连接超时，自动尝试下一个候选（最多尝试 `maxCandidatesPerRequest` 次）。
   - **流式响应开始后**：不再进行重试（避免客户端收到碎片或错乱内容），直接以 SSE 错误事件安全结束。
3. **免费模型池限制**：
   - 公共免费模型存在上游并发限制与高峰期排队拥堵（429）。网关可大幅缓解但无法凭空增加上游配额。若全部候选均不可用，网关将返回 429 错误并附带各候选的不可用原因。

---

## 常见问题排查

- **所有请求均返回 429**：公共免费模型池拥堵，可修改 `config.user.json` 将其他可用候选置顶，或添加更多提供商的 API Key。
- **升级后候选模型消失**：此前版本升级调整了配置字段。重新执行 `npm run generate:config` 即可刷新配置。
- **重置用量计数器**：可在 Web 控制台（`http://127.0.0.1:8787/ui`）点击右上角「Reset usage」按钮一键重置，或停止网关后删除本地数据库文件 `data/prismd.sqlite`。
