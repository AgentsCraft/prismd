# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**本地优先的高可用 LLM 网关**。prismd 聚合免费、低额度和本地模型，为编码 Agent 提供统一入口，支持模型队列、额度感知、多 Key 轮询和自动故障转移。

```text
编码 Agent
  Claude Code | Codex CLI | Cursor | OpenCode | dsh | Pi | Aider
                              |
                              v
                    http://127.0.0.1:8787
                              |
                              v
云端 Provider 与本地模型
  OpenRouter | Groq | Cerebras | Gemini | NVIDIA NIM | GitHub Models | AMD
  Ollama | LM Studio
```

## 快速开始

### 1. 安装

npm 全局安装：

```bash
npm install -g @prismd/prismd
```

预览通道：

```bash
npm install -g @agentscraft/prismd
```

源码运行：

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

需要 Node.js `22.13.0` 或更高版本。

### 2. 初始化

npm 全局安装：

```bash
prismd init
```

源码运行：

```bash
node dist/server.js init
```

向导会：

1. 创建或更新 `~/.prismd/keys.yaml`。
2. 询问需要启用的模型 Provider。
3. 写入 `~/.prismd/prismd.json`。
4. 可选配置 Claude Code、Codex CLI、OpenCode 和 Pi Agent。
5. 输出随机生成的本地 token。连接其他客户端时使用该 token。

向导修改已有客户端配置前会自动备份。也可以手动创建 `~/.prismd/keys.yaml`：

```yaml
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

通过 `PRISMD_HOME` 可以覆盖默认的 `~/.prismd` 目录。

### 3. 启动

npm 全局安装：

```bash
prismd
```

源码运行：

```bash
node dist/server.js
```

网关默认监听 `http://127.0.0.1:8787`。

### 4. 接入客户端

| 客户端 | 命令或设置 | 指南 |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1`<br>`ANTHROPIC_API_KEY=YOUR_PRISMD_TOKEN` | [指南](examples/claude-code/README.md) |
| Codex CLI | `PRISMD_API_KEY=YOUR_PRISMD_TOKEN codex --profile prismd` | [指南](examples/codex/README.md) |
| OpenCode | OpenAI 兼容 Provider，地址为 `http://127.0.0.1:8787/v1`<br>模型：`free-auto` | [指南](examples/opencode/README.md) |
| Pi Agent | `~/.pi/config.json` 的 endpoint 设置为 `http://127.0.0.1:8787/v1`<br>模型：`free-auto` | [指南](examples/pi/README.md) |
| Cursor | 开启 OpenAI API Key，并将 Base URL 覆盖为 `http://127.0.0.1:8787/v1`<br>模型：`free-auto` | [指南](examples/cursor/README.md) |
| DeepSeek Harness (dsh) | `PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [指南](examples/dsh/README.md) |
| Aider | `OPENAI_API_BASE=http://127.0.0.1:8787/v1`<br>`OPENAI_API_KEY=YOUR_PRISMD_TOKEN`<br>`aider --model openai/free-auto` | [指南](examples/aider/README.md) |

## 文档

- [文档索引](docs/README.md)
- [配置指南](docs/configuration.md)
- [客户端接入](docs/clients/README.md)
- [模型 Provider](docs/providers/README.md)
- [运行状态与排错](docs/operations.md)
- [贡献指南](CONTRIBUTING.md)

## 核心行为

- `free-auto` 是默认模型别名，prismd 会按请求从候选队列中选择模型。
- Provider Key 可以使用单值，也可以使用列表进行多 Key 轮询。
- 达到每日软限额的候选会降权，已耗尽的候选会跳过。
- 请求在流开始前可以故障转移；流开始后不会自动从头重放。
- 本地 Ollama 和 LM Studio 模型默认不参与路由，只有显式加入别名后才会使用。
- Web 控制台位于 `http://127.0.0.1:8787/ui`，可查看健康状态、额度和近期客户端用量。

## 支持项目

如果 prismd 为你节省了时间或 API 成本，欢迎请作者喝杯咖啡：

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)
