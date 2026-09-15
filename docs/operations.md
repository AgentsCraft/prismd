# 运行状态与排错

## 状态查看

Web 控制台：

```text
http://127.0.0.1:8787/ui
```

控制台展示候选健康状态、每日配额、最近 24 小时客户端请求统计和错误信息。

命令行状态：

```bash
prismd status
```

源码运行时可使用：

```bash
npm run status
```

## 常见问题

### 启动后客户端返回 401

客户端使用的 token 必须与 `~/.prismd/keys.yaml` 中的 `prismd` 字段一致，或在启动网关时通过 `PRISMD_API_KEY` 提供。

首次运行 `prismd init` 会生成随机 token。请在向导结束输出中查看该值。

### 提示缺少 provider API key

检查密钥来源：

```bash
prismd generate
```

确认密钥位于环境变量、`.env` 或 `~/.prismd/keys.yaml`，并检查字段名是否与 provider 配置一致。

### 免费模型频繁返回 429

- 为 provider 配置多个 Key。
- 将要保留的候选放在别名队列前面。
- 在队列末尾加入本地 Ollama 或 LM Studio 模型作为兜底。

### 需要重置每日额度计数

在 Web 控制台点击 `Reset usage`，或停止网关后删除本地 `data/prismd.sqlite`。

### 启动时提示未知运行时配置键

`prismd.json` 中未知的顶层字段会被忽略并记录警告。该文件是生成产物，通常不需要手工修改。重新运行 `prismd generate` 或调整 `config.user.json`。

## 查看日志

网关使用结构化 JSON 日志。每条请求包含 request-id，可用于串联认证、路由、上游响应和额度记录。

日志不会输出 API key、Authorization 或 `x-api-key`。
