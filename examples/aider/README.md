# Aider 接入 prismd

Aider 可通过 OpenAI 兼容协议接入本地 prismd 网关的 `/v1/chat/completions`。

## 环境变量方式

```bash
export OPENAI_API_BASE="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="your-prismd-local-token"

aider --model openai/free-auto
```

## 配置文件方式 (`~/.aider.conf.yml` 或项目根目录 `.aider.conf.yml`)

```yaml
openai-api-base: http://127.0.0.1:8787/v1
openai-api-key: your-prismd-local-token
model: openai/free-auto
```

配置后直接运行：

```bash
aider
```
