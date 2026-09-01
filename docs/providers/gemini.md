# Google Gemini / Google AI Studio 配置指南

Google AI Studio 为 Gemini 系列模型提供免费额度，支持超长上下文（1M+ tokens）与高推理能力，并提供原生兼容 OpenAI 的接口端点。

## 1. 获取 API Key

- 访问控制台：[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- 创建并复制 API Key（格式为 `AIzaSy...`）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
gemini: "AIzaSyxxxxxxxx"
```
或配置系统环境变量：
```bash
export GEMINI_API_KEY="AIzaSyxxxxxxxx"
```

## 3. 常用模型与免费配额

| 模型 ID | 上下文窗口 | 最大输出 | 免费层配额（Free Tier） |
| --- | --- | --- | --- |
| `gemini-2.0-flash` | 1,048,576 (1M) | 8,192 | 15 RPM / 1,500 RPD / 1,000,000 TPM |
| `gemini-2.0-flash-lite` | 1,048,576 (1M) | 8,192 | 30 RPM / 1,500 RPD / 1,000,000 TPM |
| `gemini-1.5-flash` | 1,048,576 (1M) | 8,192 | 15 RPM / 1,500 RPD / 1,000,000 TPM |
| `gemini-1.5-pro` | 2,097,152 (2M) | 8,192 | 2 RPM / 50 RPD / 32,000 TPM |

## 4. `config.user.json` 完整配置示例

使用 Google 官方提供的 OpenAI 兼容端点：`https://generativelanguage.googleapis.com/v1beta/openai`：

```jsonc
{
  "providers": {
    "gemini": {
      "type": "chat",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "apiKeyField": "gemini",
      "auth": {
        "type": "api_key"
      }
    }
  },
  "models": {
    "gemini-2.0-flash": {
      "provider": "gemini",
      "contextWindow": 1048576,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 1500, "rpm": 15, "maxConcurrent": 2 },
      "tags": ["free", "long-context", "gemini"]
    },
    "gemini-2.0-flash-lite": {
      "provider": "gemini",
      "contextWindow": 1048576,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 1500, "rpm": 30, "maxConcurrent": 2 },
      "tags": ["free", "fast", "gemini"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **网络连接**：部分地区访问 Google AI Studio API 需要可用网络环境。
- **速率限制**：免费层存在 15 RPM（每分钟 15 次请求）限制，并发过高时会返回 429。建议在别名列表中混合配置 Cerebras 或 Groq 模型作为候选保障。
