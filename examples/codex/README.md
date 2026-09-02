# Codex CLI 接入 prismd

Codex CLI 支持通过 `responses` wire API 接入本地 prismd 网关的 `/v1/responses` 端点。

## 配置文件 (`~/.codex/prismd.config.toml`)

创建或保存配置文件到 `~/.codex/prismd.config.toml`：

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

## 运行

```bash
PRISMD_API_KEY="your-prismd-local-token" codex --profile prismd
```

亦可将 `PRISMD_API_KEY` 写入环境变量（如 `~/.zshrc` 或 `~/.bashrc`）：

```bash
export PRISMD_API_KEY="your-prismd-local-token"
codex --profile prismd
```
