# DeepSeek Harness (dsh) 接入 prismd 指南

DeepSeek Harness (`dsh`) 支持通过 `openai-completions` 或 `openai-responses` 协议接入本地 prismd 网关。

---

## 1. 配置文件

在用户主目录下配置 `~/.dsh/config.toml`：

```toml
[providers.prismd]
type = "openai-completions" # 亦可设置为 "openai-responses"
base_url = "http://127.0.0.1:8787/v1"
api_key_env = "PRISMD_API_KEY"
models = [
  "free-auto",
  "free-fast",
  "free-code"
]
```

---

## 2. 运行与验证

在启动命令前传入 `PRISMD_API_KEY`（或在 `~/.zshrc` 中导出）：

```bash
PRISMD_API_KEY="my-local-secret" dsh --model prismd:free-auto
```

`dsh` 发送的请求将通过本地网关透明路由，获得高吞吐和多上游负载均衡。
