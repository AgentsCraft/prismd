# AMD (Developer Cloud / 本地 ROCm) 配置指南

AMD 目前的 AI 服务模式以 **开发云算力（AMD Developer Cloud）** 和 **本地硬件加速（ROCm + vLLM / Ollama）** 为主，不提供集中式的公共免运维 Serverless API 目录。

通过在本地或云端部署 OpenAI 兼容推理服务（如 vLLM 或 Ollama），可以无缝将其作为自定义提供商接入 prismd。

---

## 1. 额度与资源获取

- **AMD AI Developer Program**：注册 [AMD Developer 计划](https://developer.amd.com/) 可申请 AMD Developer Cloud 算力点数（体验 AMD Instinct™ MI300X / MI210 等云端实例）。
- **本地硬件加速**：支持搭载 AMD Radeon™ GPU 或 Ryzen™ AI NPU 的机器，使用 ROCm 驱动启动本地推理。

---

## 2. 部署 OpenAI 兼容推理端点

### 方式 A：使用 Ollama（推荐本地轻量运行）
```bash
# 启动本地 Ollama（默认监听 11434 端口）
ollama run llama3.3
```

### 方式 B：使用 vLLM on ROCm（高并发与生产环境）
```bash
vllm serve meta-llama/Llama-3.3-70B-Instruct \
  --port 8000 \
  --host 0.0.0.0
```

---

## 3. 在 prismd 中配置 AMD 提供商

在 `config.user.json` 中添加本地/云端 AMD 实例作为提供商，并挂载到别名候选队列中：

```jsonc
{
  "providers": {
    "amd-local": {
      "type": "chat",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKeyField": "amd"
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        {
          "provider": "amd-local",
          "providerModelId": "llama3.3",
          "contextWindow": 131072,
          "maxOutputTokens": 8192,
          "supportsTools": true,
          "supportsReasoning": false,
          "limits": {
            "dailyRequests": null,
            "rpm": 60,
            "maxConcurrent": 4
          },
          "tags": ["local", "amd"]
        }
      ]
    }
  }
}
```

---

## 4. 配置密钥并刷新网关配置

如本地服务无需认证，可在 `.env` 中填入任意占位符：
```bash
echo "AMD_API_KEY=local-token" >> .env
npm run generate:config
```
