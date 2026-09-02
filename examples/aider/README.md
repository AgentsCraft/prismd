# Aider 接入 prismd 指南

Aider 可通过 OpenAI 兼容协议接入本地 prismd 网关的 `/v1/chat/completions`。

---

## 1. 启动方式

### 方式 A：临时环境变量启动
```bash
export OPENAI_API_BASE="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="my-local-secret"

aider --model openai/free-auto
```

### 方式 B：持久化配置文件 (`~/.aider.conf.yml` 或项目根目录)
在 `~/.aider.conf.yml` 中写入：
```yaml
openai-api-base: http://127.0.0.1:8787/v1
openai-api-key: my-local-secret
model: openai/free-auto
```
配置后可直接在任何项目根目录执行：
```bash
aider
```

---

## 2. 常用模型别名选用

- `aider --model openai/free-auto`：主力编码模型（Gemini 2.0 Flash / Llama 3.3 70B 等）。
- `aider --model openai/free-fast`：轻量极速模型（Gemini Flash Lite / Llama 3.1 8B）。
- `aider --model openai/free-code`：代码特化队列。
