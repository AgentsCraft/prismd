# Claude Code CLI 接入 prismd
 
Claude Code 原生支持通过设置环境变量自定义 Anthropic API 端点。
 
## 配置方法
 
在终端中设置以下环境变量即可让 Claude Code 将请求路由至本地 prismd 网关：
 
```bash
# 指向本地 prismd 网关的 /v1 入口（注意结尾不要加多余的斜杠）
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
 
# 本地网关 Token (与 ~/.prismd/keys.yaml 中的 prismd 字段或 PRISMD_API_KEY 一致)
export ANTHROPIC_API_KEY="your-prismd-local-token"
```
 
## 运行验证
 
```bash
claude
```
 
Claude Code 发送的 `POST /v1/messages` 请求会自动经由 prismd 网关分发到配置的后端候选模型（例如 Cerebras、OpenRouter 等），并自动享受软配额与自动 Failover 保障。
