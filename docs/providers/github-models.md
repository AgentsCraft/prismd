# GitHub Models 配置指南

GitHub Models（github.com/marketplace/models）允许开发者使用 GitHub 账号及 Personal Access Token（PAT）免费访问前沿商业与开源大模型，提供基于 Azure AI 基础设施的高性能服务。

## 1. 获取 GitHub Personal Access Token (PAT)

- 访问 GitHub Token 设置页：[github.com/settings/tokens](https://github.com/settings/tokens)
- 生成一个 Classic Token 或 Fine-grained Token（无需特殊仓库权限，仅作为身份标识）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
github: "ghp_xxxxxxxxxxxx"
```
或配置系统环境变量：
```bash
export GITHUB_API_KEY="ghp_xxxxxxxxxxxx"
```

## 3. 常用模型列表与免费配额

| 模型 ID | 上下文窗口 | 最大输出 | 免费速率限制（每分钟 / 每日请求） |
| --- | --- | --- | --- |
| `gpt-4o` | 128,000 | 4,096 | 15 RPM / 150 RPD |
| `gpt-4o-mini` | 128,000 | 4,096 | 15 RPM / 150 RPD |
| `meta-llama-3.3-70b-instruct` | 131,072 | 4,096 | 15 RPM / 150 RPD |
| `mistral-large-2407` | 128,000 | 4,096 | 15 RPM / 150 RPD |

## 4. `config.user.json` 完整配置示例

使用 GitHub Models 官方端点：`https://models.inference.ai.azure.com`：

```jsonc
{
  "providers": {
    "github": {
      "type": "chat",
      "baseUrl": "https://models.inference.ai.azure.com",
      "apiKeyField": "github",
      "auth": {
        "type": "api_key"
      }
    }
  },
  "models": {
    "gpt-4o-mini": {
      "provider": "github",
      "contextWindow": 128000,
      "maxOutputTokens": 4096,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 150, "rpm": 15, "maxConcurrent": 1 },
      "tags": ["free", "github", "openai"]
    },
    "github-llama-3.3-70b": {
      "provider": "github",
      "providerModelId": "meta-llama-3.3-70b-instruct",
      "contextWindow": 131072,
      "maxOutputTokens": 4096,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 150, "rpm": 15, "maxConcurrent": 1 },
      "tags": ["free", "github", "llama"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "gpt-4o-mini",
        "github-llama-3.3-70b",
        "llama-3.3-70b"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **个人免费调用额度**：GitHub Models 免费层旨在用于原型开发与测试，提供约 150 RPD（每日请求）的速率上限。当遇到 429 时，prismd 会自动降权并故障转移到其他候选。
- **协议兼容性**：后端走 Azure OpenAI Chat Completions 协议，prismd 自动兼容并处理流式转换。
