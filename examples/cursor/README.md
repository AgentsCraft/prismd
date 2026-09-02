# Cursor 接入 prismd 指南

Cursor 支持配置自定义 OpenAI 兼容端点（Override OpenAI Base URL），可直接接入本地 prismd 网关的 `/v1/chat/completions`。

---

## 1. 配置步骤

1. 打开 Cursor：点击右上角齿轮或按快捷键进入 `Settings` → `Models`。
2. 开启 **OpenAI API Key** 开关，输入网关本地保护令牌（如 `my-local-secret`）。
3. 勾选 **Override OpenAI Base URL**，填入本地网关地址：
   ```
   http://127.0.0.1:8787/v1
   ```
4. 在模型列表下方点击 **Add Model**，依次添加所需的 prismd 别名：
   - `free-auto`（推荐设为主力模型）
   - `free-fast`
   - `free-code`
5. 在下拉列表中选中 `free-auto` 即可开始编码对话与代码补全。

---

## 2. 工作机制

Cursor 发出的 `POST /v1/chat/completions` 请求将由 prismd 捕获，网关会根据各个上游模型（Groq、Cerebras、Gemini、NVIDIA 等）的实时健康状况与每日配额智能分发，并自动处理流式返回与限流故障转移。
