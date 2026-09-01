# OpenCode 接入 prismd
 
OpenCode 可通过配置 OpenAI 兼容提供商接入本地 prismd 网关的 `/v1/chat/completions`。
 
## 配置示例 (`~/.config/opencode/config.json`)
 
```json
{
  "providers": {
    "prismd": {
      "type": "openai",
      "baseUrl": "http://127.0.0.1:8787/v1",
      "apiKey": "your-prismd-local-token",
      "models": [
        "free-auto",
        "free-fast",
        "free-code"
      ]
    }
  }
}
```
 
## 运行
 
```bash
opencode --model prismd/free-auto
```
