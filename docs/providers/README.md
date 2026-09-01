# 免费 / 低额度模型提供商配置指南

prismd 支持接入任何提供免费额度或低成本 API 的模型服务商。通过在 `~/.prismd/keys.yaml`（或系统环境变量）中配置密钥，并在 `config.user.json` 中定义或引用候选模型，即可将其纳入统一的路由与故障转移（Failover）池。

## 主流提供商概览

| 提供商 | 免费额度 / 特点 | 协议类型 | 推荐模型 | 详细配置 |
| --- | --- | --- | --- | --- |
| **OpenRouter** | 聚合大量免费模型（`:free`），无需绑定信用卡 | `responses` / `chat` | `cohere/north-mini-code:free`<br>`poolside/laguna-s-2.1:free` | [查看配置](openrouter.md) |
| **Groq** | 极速推理，提供免费开发者 Tier（每日请求与速率限制） | `responses` / `chat` | `llama-3.3-70b-versatile`<br>`llama-3.1-8b-instant` | [查看配置](groq.md) |
| **Cerebras** | 超高 TPS（1000+ tokens/s），提供高并发免费额度（每日 14,400 次） | `chat` | `llama-3.3-70b`<br>`llama3.1-8b` | [查看配置](cerebras.md) |
| **Google Gemini** | Google AI Studio 免费层（15 RPM / 1000 RPD），大上下文窗口 | `chat`（OpenAI 兼容端点） | `gemini-2.0-flash`<br>`gemini-1.5-flash` | [查看配置](gemini.md) |
| **NVIDIA NIM** | 开发者免费体验点数，提供大量开源前沿模型直接推理 | `chat`（OpenAI 兼容端点） | `meta/llama-3.3-70b-instruct`<br>`deepseek-ai/deepseek-r1` | [查看配置](nvidia.md) |
| **GitHub Models** | GitHub 账号自带免费调用限额（按分钟/日速率限制） | `chat`（Azure/OpenAI 兼容） | `gpt-4o`<br>`meta-llama-3.3-70b-instruct` | [查看配置](github-models.md) |
| **AMD (ROCm / Cloud)** | Developer Cloud 算力点数 / 本地 ROCm 硬件推理（Ollama / vLLM） | `chat`（OpenAI 兼容端点） | `llama3.3`<br>`deepseek-r1` | [查看配置](amd.md) |

---

## 快速配置流程

1. **获取提供商 API Key**：访问对应平台注册并生成 API Key。
2. **存入本地密钥库**：写入 `~/.prismd/keys.yaml`（或设置 `export <PROVIDER>_API_KEY=...`）。
3. **在 `config.user.json` 中声明 Provider 与模型**（内置 Provider 如 openrouter/groq/cerebras 无需额外声明）。
4. **重新生成配置**：运行 `npm run generate:config`（全局安装请运行 `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`）。
