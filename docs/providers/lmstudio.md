# LM Studio 本地推理与离线兜底配置指南

[LM Studio](https://lmstudio.ai/) 是一款广受欢迎的桌面端本地大模型运行工具，支持 macOS（Metal）、Windows（CUDA/DirectML）和 Linux。它提供内置的本地 OpenAI 兼容服务器（默认监听 `http://127.0.0.1:1234/v1`），可直接作为本地推理服务或离线兜底接入 prismd。

---

## 1. 在 LM Studio 中启动本地服务

1. **下载安装 LM Studio**：访问 [lmstudio.ai](https://lmstudio.ai/) 下载并安装。
2. **下载推荐模型**（搜索并下载 GGUF 格式）：
   - `qwen2.5-coder-7b-instruct`（代码生成与补全）
   - `deepseek-r1-distill-qwen-8b`（逻辑推理）
3. **开启 Local Server**：
   - 点击左侧导航栏的 **Developer / Local Server** 图标（`↔`）。
   - 在顶部选择要加载的模型。
   - 点击 **Start Server**。
   - 确认监听地址为 `http://localhost:1234`（或 `http://127.0.0.1:1234`）。

---

## 2. 在 prismd 中配置 LM Studio

在项目根目录（或工作区）编辑 `config.user.json`，声明 `lmstudio` 提供商并挂载至别名队列：

```jsonc
{
  "providers": {
    "lmstudio": {
      "type": "chat",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "auth": {
        "type": "none"
      }
    }
  },
  "models": {
    "lmstudio/qwen2.5-coder-7b": {
      "provider": "lmstudio",
      "providerModelId": "qwen2.5-coder-7b-instruct", // 对应 LM Studio 中加载的模型 ID
      "contextWindow": 32768,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": {
        "dailyRequests": null,
        "rpm": 0,
        "maxConcurrent": 4
      },
      "tags": ["local", "lmstudio", "code", "offline"]
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": [
        "gemini-2.0-flash",
        "llama-3.3-70b",
        "lmstudio/qwen2.5-coder-7b"
      ]
    }
  }
}
```

---

## 3. 生成配置与生效

保存 `config.user.json` 后重新编译生成网关配置：

```bash
npm run generate:config
```

若 prismd 正在运行，可直接发送 `SIGHUP` 信号实现零中断热重载：

```bash
kill -HUP $(pgrep -f "prismd")
```

---

## 4. 优势与使用场景

- **GUI 交互体验好**：一键搜索 Hugging Face 模型并利用本地 GPU 显存加速。
- **与 Ollama 灵活替换**：LM Studio 与 Ollama 均遵循 OpenAI 标准端点，可根据个人使用习惯自由选择本地后端。
- **离线安全**：代码完全在本地设备推理，零 Token 费用，网络中断时无缝兜底。
