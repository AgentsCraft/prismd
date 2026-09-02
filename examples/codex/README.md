# Codex CLI 接入 prismd 指南

Codex CLI 支持通过 OpenAI Responses 协议接入本地 prismd 网关的 `/v1/responses` 端点。

---

## 1. 配置文件

在用户主目录下创建或编辑 `~/.codex/prismd.config.toml`：

```toml
# 默认选用 prismd 别名：free-auto（自动优选最合适候选模型）
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

---

## 2. 运行与验证

在运行 Codex 时传入本地网关密钥（或导出至环境变量）：

```bash
PRISMD_API_KEY="my-local-secret" codex --profile prismd
```

### 持久化环境变量
```bash
echo 'export PRISMD_API_KEY="my-local-secret"' >> ~/.zshrc
source ~/.zshrc

codex --profile prismd
```

---

## 3. 模型别名选用

在 `prismd.config.toml` 中，可按需指定不同的虚拟别名：
- `model = "free-auto"`：主力通用编码模型队列。
- `model = "free-fast"`：超轻量快速响应队列。
- `model = "free-code"`：代码生成特化模型队列。
