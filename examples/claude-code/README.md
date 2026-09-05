# Claude Code 接入 prismd 指南

Claude Code 支持通过设置环境变量自定义 Anthropic API 端点，将全部请求透明接入本地 prismd 网关，享受多模型路由、自动限流故障转移与本地离线兜底。

---

## 1. 快速配置

在当前终端中设置环境变量：

```bash
# 指向本地 prismd 网关的 /v1 入口（注意结尾不要加多余的斜杠）
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"

# 本地网关 Token (与 ~/.prismd/keys.yaml 中的 prismd 字段或 PRISMD_API_KEY 一致)
export ANTHROPIC_API_KEY="my-local-secret"
```

### 持久化配置（推荐）
将上述环境变量写入终端配置文件（如 `~/.zshrc` 或 `~/.bashrc`）：
```bash
echo 'export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY="my-local-secret"' >> ~/.zshrc
source ~/.zshrc
```

---

## 2. 启动与验证

```bash
claude
```

启动后，Claude Code 会向本地网关发送 `POST /v1/messages` 请求。

### 工作机制与模型自适应
- Claude Code 默认请求 `claude-3-5-sonnet` 或 `claude-3-haiku` 等模型 ID。
- prismd 内置了自适应映射机制，会自动将其解析并路由至 `free-auto` 或 `free-fast` 候选池（优先分发至 Gemini 2.0 Flash / Llama 3.3 70B 等免费云端大模型，队列内自动故障转移）。
- 原生支持 Claude Code 的 Tool Calling、文件编辑与 Thinking 块双向流式透传。

---

## 3. 常见排错

- **401 Unauthorized**：检查 `ANTHROPIC_API_KEY` 是否与 `~/.prismd/keys.yaml` 中的 `prismd` 令牌匹配。
- **Connection Refused**：检查本地网关是否已启动（`prismd status`），确认端口为 8787。
