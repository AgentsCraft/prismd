/**
 * E2E journeys: M4 Multi-client extensions
 *
 * 验证非 Codex 客户端通过同一个网关使用 free-auto：
 * - 旅程 16a：Claude Code (Anthropic Messages /v1/messages) 经网关完成流式会话与工具调用
 * - 旅程 16b：OpenCode / dsh (OpenAI Chat /v1/chat/completions) 经网关完成会话
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { logTail, startGateway, GATEWAY_TOKEN } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream } from "../mock-upstream.js";

test("旅程 16a：Claude Code (POST /v1/messages) 经网关完成流式与工具调用", async (t) => {
  const mockChat = await startMockUpstream((captured) => {
    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      events: [
        'data: {"id":"chatcmpl-claude","choices":[{"delta":{"role":"assistant","content":"I will inspect "}}]}\n\n',
        'data: {"id":"chatcmpl-claude","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_cl_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"AGENTS.md\\"}"}}]}}]}\n\n',
        'data: {"id":"chatcmpl-claude","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15}}\n\n',
        "data: [DONE]\n\n",
      ],
      eventDelayMs: 5,
    };
  });
  t.after(async () => {
    await mockChat.close();
  });

  const gateway = await startGateway(
    makeValidConfig({
      providers: {
        cerebras: { type: "chat", baseUrl: mockChat.url, apiKeyField: "cerebras" },
      },
      models: {
        "free-auto": {
          candidates: [
            {
              provider: "cerebras",
              providerModelId: "llama-3.3-70b",
              contextWindow: 131072,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsReasoning: false,
              limits: { dailyRequests: 100, rpm: 30, maxConcurrent: 2 },
              tags: ["chat"],
            },
          ],
        },
      },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  const res = await fetch(`${gateway.url}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": GATEWAY_TOKEN,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "read AGENTS.md" }],
      stream: true,
      tools: [
        {
          name: "read_file",
          description: "Read file",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    }),
  });

  assert.equal(res.status, 200, logTail(gateway));
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes("event: message_start"));
  assert.ok(text.includes("event: content_block_start"));
  assert.ok(text.includes('"type":"text_delta"'));
  assert.ok(text.includes('"type":"tool_use"'));
  assert.ok(text.includes('"name":"read_file"'));
  assert.ok(text.includes('"type":"input_json_delta"'));
  assert.ok(text.includes("event: message_delta"));
  assert.ok(text.includes("event: message_stop"));
});

test("旅程 16b：OpenCode (POST /v1/chat/completions) 经网关完成非流式调用", async (t) => {
  const mockChat = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "chatcmpl-opencode",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "pong from opencode test" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
  t.after(async () => {
    await mockChat.close();
  });

  const gateway = await startGateway(
    makeValidConfig({
      providers: {
        cerebras: { type: "chat", baseUrl: mockChat.url, apiKeyField: "cerebras" },
      },
      models: {
        "free-auto": {
          candidates: [
            {
              provider: "cerebras",
              providerModelId: "llama-3.3-70b",
              contextWindow: 131072,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsReasoning: false,
              limits: { dailyRequests: 100, rpm: 30, maxConcurrent: 2 },
              tags: ["chat"],
            },
          ],
        },
      },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  const res = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "ping" }],
    }),
  });

  assert.equal(res.status, 200, logTail(gateway));
  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(body.choices[0].message.content, "pong from opencode test");
});

test("旅程 16c：OpenCode/Claude 客户端经网关调用 Responses 上游，支持跨协议转换与 429 自动 failover", async (t) => {
  const mockResponses = await startMockUpstream({
    status: 429,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: { message: "rate limit exceeded" } }),
  });
  const mockChat = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "chatcmpl-failover-ok",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello after failover to chat" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });

  t.after(async () => {
    await mockResponses.close();
    await mockChat.close();
  });

  const gateway = await startGateway(
    makeValidConfig({
      providers: {
        openrouter: { type: "responses", baseUrl: mockResponses.url, apiKeyField: "openrouter" },
        cerebras: { type: "chat", baseUrl: mockChat.url, apiKeyField: "cerebras" },
      },
      models: {
        "free-auto": {
          candidates: [
            {
              provider: "openrouter",
              providerModelId: "openrouter/free-model",
              contextWindow: 131072,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsReasoning: false,
              limits: { dailyRequests: 100, rpm: 30, maxConcurrent: 2 },
              tags: ["free"],
            },
            {
              provider: "cerebras",
              providerModelId: "llama-3.3-70b",
              contextWindow: 131072,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsReasoning: false,
              limits: { dailyRequests: 100, rpm: 30, maxConcurrent: 2 },
              tags: ["chat"],
            },
          ],
        },
      },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  // OpenCode (chat) hits Responses candidate (429), fails over to Chat candidate (200)
  const resChat = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  assert.equal(resChat.status, 200, logTail(gateway));
  const chatBody = (await resChat.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(chatBody.choices[0].message.content, "hello after failover to chat");
  assert.equal(mockResponses.requests.length, 1);
  assert.equal(mockChat.requests.length, 1);

  // Claude Code (messages) hits Responses candidate (429), fails over to Chat candidate (200)
  const resMsg = await fetch(`${gateway.url}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": GATEWAY_TOKEN,
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  assert.equal(resMsg.status, 200, logTail(gateway));
  const msgBody = (await resMsg.json()) as { content: Array<{ text: string }> };
  assert.equal(msgBody.content[0].text, "hello after failover to chat");
});
