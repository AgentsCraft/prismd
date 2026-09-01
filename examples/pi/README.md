# Pi Agent 接入 prismd

Pi Agent 支持通过标准 OpenAI Completions 接口配置自定义提供商。

## 配置示例 (`~/.pi/config.json`)

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

## 运行

```bash
pi run
```
