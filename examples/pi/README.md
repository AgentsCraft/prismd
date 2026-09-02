# Pi Agent 接入 prismd 指南

Pi Agent 支持通过标准 OpenAI Completions 接口配置自定义提供商接入本地 prismd 网关。

---

## 1. 配置文件

编辑或创建 `~/.pi/config.json`：

```json
{
  "provider": {
    "name": "prismd",
    "protocol": "openai-completions",
    "endpoint": "http://127.0.0.1:8787/v1",
    "apiKey": "my-local-secret",
    "defaultModel": "free-auto"
  }
}
```

---

## 2. 运行与验证

```bash
pi run
```

Pi Agent 发起的全部交互将自动经由本地 prismd 网关调度，优先使用云端大模型并支持自动故障转移。
