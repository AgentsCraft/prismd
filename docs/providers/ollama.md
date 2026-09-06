# 本地 Ollama 离线兜底配置指南

prismd 原生内置 `ollama` 提供商支持（默认端点 `http://127.0.0.1:11434/v1`，无需 API Key 鉴权）。Ollama 为**可选兜底**：默认别名只含云端候选，本机没装 Ollama 也不会生成连不上的死候选；本机跑有 Ollama 时，把它追加进别名队列（见下文），云端免费 API 全部触发 429 限流或网络中断时，网关会自动无缝故障转移至本地 Ollama 实例，保障编码任务不中断。

---

## 1. 安装与启动 Ollama

### 安装 Ollama
- **macOS / Linux / Windows**：访问 [ollama.com](https://ollama.com) 下载安装。

### 下载推荐编码模型
```bash
# 推荐 7B 编码模型（具备代码理解、生成与 Tool 调用能力）
ollama pull qwen2.5-coder:7b

# 推荐 8B 推理/思考模型（适合复杂逻辑分析）
ollama pull deepseek-r1:8b
```

启动本地 Ollama 服务（默认运行在后台监听 `11434` 端口）：
```bash
ollama serve
```

---

## 2. prismd 内置支持与行为

prismd 内置了以下 Ollama 模型（默认**不挂载**到任何别名，需按第 3 节手动加入候选队列）：

| 模型别名/ID | 上下文窗口 | 最大输出 | 特性 | 默认挂载 |
|---|---|---|---|---|
| `qwen2.5-coder:7b` | 32,768 | 8,192 | 支持 Tools、代码特化 | 无（可选加入别名候选末位） |
| `deepseek-r1:8b` | 32,768 | 8,192 | 具备深度推理能力 | 无（本地离线思考备选） |

- **零密钥配置**：内置 `ollama` 提供商认证模式为 `none`，无需在 `keys.yaml` 或 `.env` 中填写 Key。
- **兜底优先级**：将 `qwen2.5-coder:7b` 放在别名候选列表末位后，仅当排在前面的云端免费服务全部降权或冷却时，请求才会分发至本地 Ollama。

---

## 3. 将 Ollama 加入别名候选 (`config.user.json`)

最简单的启用方式：把内置模型追加到别名候选列表末位。注意候选数组是**整体替换**，需一并保留想保留的云端候选：

```jsonc
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "gemini-2.0-flash",
        "llama-3.3-70b",
        "qwen2.5-coder:7b"
      ]
    }
  }
}
```

## 4. 自定义 Ollama 地址与模型 (`config.user.json`)

如果你的 Ollama 服务部署在局域网其他机器或自定义端口，可通过 `config.user.json` 覆盖：

```jsonc
{
  "providers": {
    "ollama": {
      "type": "chat",
      "baseUrl": "http://192.168.1.100:11434/v1",
      "auth": {
        "type": "none"
      }
    }
  },
  "models": {
    "qwen2.5-coder:14b": {
      "provider": "ollama",
      "contextWindow": 32768,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": {
        "dailyRequests": null,
        "rpm": 0,
        "maxConcurrent": 4
      },
      "tags": ["local", "code", "offline"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "gemini-2.0-flash",
        "llama-3.3-70b",
        "qwen2.5-coder:14b"
      ]
    }
  }
}
```

配置完成后重新生成配置并重启/热重载网关：
```bash
npm run generate:config
```
