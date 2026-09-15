# 配置指南

prismd 的运行时配置由内置 presets、用户覆盖和本地密钥生成。用户不直接编辑运行时 JSON。

## 密钥与本地令牌

密钥读取优先级如下，前面的来源覆盖后面的来源：

1. 操作系统环境变量，例如 `OPENROUTER_API_KEY`
2. 当前工作目录的 `.env`
3. `~/.prismd/.env`
4. `~/.prismd/keys.yaml`

本地网关令牌使用字段 `prismd`，环境变量名为 `PRISMD_API_KEY`。首次运行 `prismd init` 时会生成随机令牌，并在结束时打印出来。

```yaml
# ~/.prismd/keys.yaml
prismd: "YOUR_PRISMD_TOKEN"

openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"
```

建议执行：

```bash
chmod 600 ~/.prismd/keys.yaml
```

## 用户配置

`config.user.json` 支持以下顶层字段：

| 字段 | 用途 |
| --- | --- |
| `providers` | 新增或覆盖 provider 定义 |
| `aliases` | 新增或覆盖模型别名及其候选队列 |
| `policies` | 覆盖超时、failover、软限制等策略 |
| `server` | 覆盖监听地址和端口；只允许回环地址 |
| `auth` | 覆盖本地令牌字段名 |
| `version` | 配置版本 |

配置位置取决于运行方式：

| 运行方式 | 推荐位置 | 生成命令 |
| --- | --- | --- |
| npm 全局安装 | `~/.prismd/config.user.json`，或当前目录的 `config.user.json` | `prismd generate` |
| 源码运行 | 仓库根目录的 `config.user.json` | `npm run generate:config` |

全局安装的配置生成结果写入 `~/.prismd/prismd.json`。源码脚本将结果写入仓库根目录的 `prismd.json`。启动时优先读取当前目录的 `prismd.json`，不存在时读取 `~/.prismd/prismd.json`。

## 自定义模型与别名

别名候选可以直接引用内置模型，也可以写完整候选对象。

```jsonc
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "cohere/north-mini-code:free",
        {
          "provider": "openrouter",
          "providerModelId": "my-model:free",
          "contextWindow": 131072,
          "maxOutputTokens": 8192,
          "supportsTools": true,
          "supportsReasoning": false,
          "limits": {
            "dailyRequests": 100,
            "rpm": 20,
            "maxConcurrent": 2
          },
          "tags": ["free", "code"]
        }
      ]
    }
  }
}
```

候选数组是整体替换，不是追加。覆盖 `free-auto` 时，需要保留希望继续使用的默认候选。

## 多 Key 轮询

支持多 Key 的 provider 可以配置字符串数组。请求会在健康 Key 之间轮询；单个 Key 收到 429 后只冷却该 Key。

```yaml
groq:
  - "gsk_key1_xxxx"
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
```

环境变量同样支持逗号分隔：

```bash
GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
```

## 本地模型兜底

默认别名只包含云端候选。需要本地兜底时，将本地模型加入目标别名队列：

```json
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "gemini-2.0-flash",
        "qwen2.5-coder:7b"
      ]
    }
  }
}
```

Ollama 默认地址为 `http://127.0.0.1:11434/v1`。LM Studio 默认地址为 `http://127.0.0.1:1234/v1`。详细配置见 [提供商指南](providers/README.md)。

## 重新生成与热加载

修改用户配置或密钥后，重新生成运行时配置：

```bash
# npm 全局安装
prismd generate

# 源码运行
npm run generate:config
```

已启动的网关可通过 `SIGHUP` 重新加载运行时配置。未完成的流式请求继续使用旧配置。

```bash
kill -HUP "$(pgrep -f prismd)"
```
