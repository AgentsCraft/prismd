# Cerebras 配置指南

Cerebras 基于晶圆级引擎（Wafer-Scale Engine）提供业界领先的生成速率（1,000+ tokens/s），并提供充裕的免费开发者额度。

## 1. 获取 API Key

- 访问官网控制台：[cloud.cerebras.ai](https://cloud.cerebras.ai)
- 登录后进入 API Keys 页面生成密钥（格式为 `csk-...`）。

## 2. 配置密钥

存入 `~/.prismd/keys.yaml`：
```yaml
cerebras: "csk-xxxxxxxx"
```
或配置系统环境变量：
```bash
export CEREBRAS_API_KEY="csk-xxxxxxxx"
```

## 3. 常用模型与免费配额

| 模型 ID | 上下文窗口 | 最大输出 | 免费配额 |
| --- | --- | --- | --- |
| `llama-3.3-70b` | 128k (131,072) | 8k | 30 RPM / 14,400 RPD / 60,000 TPM |
| `llama3.1-8b` | 8k (8,192) | 8k | 30 RPM / 14,400 RPD / 60,000 TPM |

## 4. `config.user.json` 配置示例

Cerebras 已内置在 prismd 预设中，可直接在别名中引用：

```jsonc
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "llama-3.3-70b",
        "llama3.1-8b"
      ]
    },
    "free-fast": {
      "candidates": [
        "llama3.1-8b"
      ]
    }
  }
}
```

## 5. 注意事项与限制

- **输出长度**：目前 Cerebras 端点对于最大单次输出支持 8,192 tokens。
- **协议**：采用 OpenAI Chat Completions 协议（`type: "chat"`），prismd 会自动完成双向协议转换。
