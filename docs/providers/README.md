# 免费 / 低额度模型提供商配置指南

prismd 支持接入任何提供免费额度或低成本 API 的模型服务商。在本地密钥来源中配置密钥，并通过 `config.user.json` 引用内置候选或定义新候选。

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
| **Ollama (本地离线)** | 本地私有化离线运行，零网络依赖，终极防崩兜底 | `chat`（OpenAI 兼容端点，无鉴权） | `qwen2.5-coder:7b`<br>`deepseek-r1:8b` | [查看配置](ollama.md) |
| **LM Studio (本地推理)** | 桌面端本地 GGUF 模型加载，内置 OpenAI 兼容服务 | `chat`（OpenAI 兼容端点，无鉴权） | `qwen2.5-coder-7b`<br>`deepseek-r1-distill-8b` | [查看配置](lmstudio.md) |

---

## 快速配置流程

1. **获取提供商 API Key**：访问对应平台注册并生成 API Key。
2. **存入本地密钥库**：写入 `~/.prismd/keys.yaml`（或设置 `export <PROVIDER>_API_KEY=...`）。
3. **按需编辑 `config.user.json`**：全局安装推荐放在 `~/.prismd/config.user.json`；源码运行放在仓库根目录。内置 Provider 和模型无需重复声明。
4. **重新生成配置**：全局安装运行 `prismd generate`；源码运行执行 `npm run generate:config`。

完整的配置位置、优先级和示例见 [配置指南](../configuration.md)。
