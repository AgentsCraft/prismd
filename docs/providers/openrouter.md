# OpenRouter 配置指南

OpenRouter 聚合了大量由不同厂商赞助的免费模型（模型 ID 以 `:free` 结尾），无需绑定信用卡即可使用。

## 1. 获取 API Key

- 访问官网：[openrouter.ai/keys](https://openrouter.ai/keys)
- 登录并创建新的 API Key（格式为 `sk-or-v1-...`）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
openrouter: "sk-or-v1-xxxxxxxx"
```
或配置系统环境变量：
```bash
export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxx"
```

## 3. 常用免费模型列表

| 模型 ID | 上下文窗口 | 最大输出 | 描述 |
| --- | --- | --- | --- |
| `cohere/north-mini-code:free` | 256k | 64k | 适合代码补全与长上下文生成 |
| `poolside/laguna-s-2.1:free` | 262k | 32k | 适合复杂代码推理与上下文理解 |
| `poolside/laguna-xs-2.1:free` | 262k | 32k | 轻量快速代码生成模型 |
| `google/gemini-2.0-flash-thinking-exp:free` | 1M | 64k | 深度思考与长文本推理模型 |
| `meta-llama/llama-3.3-70b-instruct:free` | 128k | 8k | 通用大参数量开源模型 |

## 4. `config.user.json` 自定义配置示例

若需添加未收录在内置预设中的免费模型，可直接在 `config.user.json` 中定义：

```jsonc
{
  "models": {
    "google/gemini-2.0-flash-thinking-exp:free": {
      "provider": "openrouter",
      "contextWindow": 1048576,
      "maxOutputTokens": 65536,
      "supportsTools": true,
      "supportsReasoning": true,
      "limits": { "dailyRequests": 50, "rpm": 20, "maxConcurrent": 2 },
      "tags": ["free", "thinking"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "google/gemini-2.0-flash-thinking-exp:free",
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **公共并发池排队（429）**：OpenRouter 的 `:free` 模型共享并发额度，高峰期容易触发 429。prismd 会自动进行故障转移，若遇到频繁 429，可将其他独立服务商（如 Cerebras、Groq、Gemini）的模型排在前面。
- **自定义请求头**：prismd 默认会发送 `HTTP-Referer: https://localhost/prismd` 与 `X-Title: prismd`，确保符合 OpenRouter 规范。
