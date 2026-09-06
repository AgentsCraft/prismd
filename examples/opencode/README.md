# OpenCode 接入 prismd 指南

OpenCode 支持配置自定义 OpenAI 兼容 Provider 接入本地 prismd 网关的 `/v1/chat/completions`。

---

## 1. 配置文件

编辑或创建 `~/.config/opencode/config.json`：

```json
{
  "providers": {
    "prismd": {
      "type": "openai",
      "baseUrl": "http://127.0.0.1:8787/v1",
      "apiKey": "my-local-secret",
      "models": [
        "free-auto",
      ]
    }
  }
}
```

---

## 2. 启动与运行

在命令行中直接调用指定的 prismd 别名：

```bash
opencode --model prismd/free-auto
```

亦可将 `prismd/free-auto` 设为 OpenCode 的默认模型，享受全自动的上游多 Key 轮询与熔断保障。
