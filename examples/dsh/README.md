# DeepSeek Harness (dsh) 接入 prismd

DeepSeek Harness (`dsh`) 支持通过 `openai-completions` 或 `openai-responses` 协议接入自定义网关。

## 配置示例 (`~/.dsh/config.toml`)

```toml
[providers.prismd]
type = "openai-completions"
base_url = "http://127.0.0.1:8787/v1"
api_key_env = "PRISMD_API_KEY"
models = ["free-auto", "free-fast", "free-code"]
```

## 运行

```bash
PRISMD_API_KEY=<your-prismd-local-token> dsh --model prismd:free-auto
```
