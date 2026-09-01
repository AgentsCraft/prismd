# Cursor 接入 prismd

Cursor 支持配置自定义 OpenAI 兼容端点（Override OpenAI Base URL），可直接接入本地 prismd 网关。

## 配置步骤

1. 打开 Cursor 设置：`Settings` → `Models`。
2. 开启 **OpenAI API Key** 选项，填入您的本地网关令牌（`PRISMD_API_KEY`）。
3. 勾选 **Override OpenAI Base URL**，填入本地网关地址：
   ```
   http://127.0.0.1:8787/v1
   ```
4. 在模型列表中点击 **Add Model**，输入 prismd 别名：
   - `free-auto`
   - `free-fast`
   - `free-code`
5. 开启新增的模型并设为默认即可。

## 说明

Cursor 发送的 `POST /v1/chat/completions` 请求将自动被 prismd 捕获，并根据配额与健康状态自动路由至可用的免费模型，享受自动故障转移与软降权保护。
