# NVIDIA NIM 配置指南

NVIDIA NIM（build.nvidia.com）提供前沿开源大模型的高性能托管推理服务，开发者注册后可获得免费 API 调用额度（1,000 积分），并提供完全兼容 OpenAI 的端点。

## 1. 获取 API Key

- 访问官网：[build.nvidia.com](https://build.nvidia.com)
- 注册/登录 NVIDIA 账号，选择任意模型（如 Llama 3.3 70B 或 DeepSeek R1），点击 **Get API Key** 生成密钥（格式为 `nvapi-...`）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
nvidia: "nvapi-xxxxxxxx"
```
或配置系统环境变量：
```bash
export NVIDIA_API_KEY="nvapi-xxxxxxxx"
```

## 3. 常用模型列表

| 模型 ID | 上下文窗口 | 最大输出 | 说明 |
| --- | --- | --- | --- |
| `meta/llama-3.3-70b-instruct` | 131,072 | 4,096 | Llama 3.3 70B 高性能指令模型 |
| `deepseek-ai/deepseek-r1` | 131,072 | 4,096 | DeepSeek 深度推理模型 |
| `qwen/qwen2.5-coder-32b-instruct` | 32,768 | 4,096 | 阿里开源代码生成模型 |
| `mistralai/mistral-large-2-instruct` | 131,072 | 4,096 | Mistral 旗舰模型 |

## 4. `config.user.json` 完整配置示例

使用 NVIDIA 官方提供的端点：`https://integrate.api.nvidia.com/v1`：

```jsonc
{
  "providers": {
    "nvidia": {
      "type": "chat",
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "apiKeyField": "nvidia",
      "auth": {
        "type": "api_key"
      }
    }
  },
  "models": {
    "meta/llama-3.3-70b-instruct": {
      "provider": "nvidia",
      "contextWindow": 131072,
      "maxOutputTokens": 4096,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 1000, "rpm": 20, "maxConcurrent": 2 },
      "tags": ["free", "nvidia", "llama"]
    },
    "deepseek-ai/deepseek-r1": {
      "provider": "nvidia",
      "contextWindow": 131072,
      "maxOutputTokens": 4096,
      "supportsTools": false,
      "supportsReasoning": true,
      "limits": { "dailyRequests": 500, "rpm": 10, "maxConcurrent": 1 },
      "tags": ["free", "nvidia", "reasoning"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "meta/llama-3.3-70b-instruct",
        "llama-3.3-70b"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **免费积分机制**：NVIDIA 免费账号初始赠送 1,000 积分，消耗完后可通过添加支付方式续订或轮换其他提供商。
- **单次输出限制**：多数 NIM 端点限制最大输出为 4,096 tokens。
