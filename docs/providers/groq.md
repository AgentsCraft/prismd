# Groq 配置指南

Groq 基于 LPU（Language Processing Unit）芯片架构提供极速推理，提供免费开发者访问额度。

## 1. 获取 API Key

- 访问官网控制台：[console.groq.com/keys](https://console.groq.com/keys)
- 登录后生成 API Key（格式为 `gsk_...`）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
groq: "gsk_xxxxxxxx"
```
或配置系统环境变量：
```bash
export GROQ_API_KEY="gsk_xxxxxxxx"
```

## 3. 常用模型与免费限制

| 模型 ID | 上下文窗口 | 最大输出 | 免费限制（RPM / RPD / TPM） |
| --- | --- | --- | --- |
| `llama-3.3-70b-versatile` | 128k | 32k | 30 RPM / 1,000 RPD / 6,000 TPM |
| `llama-3.1-8b-instant` | 128k | 8k | 30 RPM / 14,400 RPD / 20,000 TPM |
| `mixtral-8x7b-32768` | 32k | 32k | 30 RPM / 14,400 RPD / 5,000 TPM |
| `qwen-2.5-coder-32b` | 128k | 8k | 30 RPM / 1,000 RPD / 6,000 TPM |

## 4. `config.user.json` 配置示例

```jsonc
{
  "models": {
    "llama-3.3-70b-versatile": {
      "provider": "groq",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 1000, "rpm": 30, "maxConcurrent": 2 },
      "tags": ["fast", "versatile"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "llama-3.3-70b-versatile",
        "llama-3.3-70b"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **TPM（Token Per Minute）限制**：Groq 70B 模型在免费层有 6,000 TPM 限制，当输入单次过长时可能触发 429。prismd 的软降权与 Failover 会在触发限制时自动转移至备选模型。
