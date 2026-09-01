/**
 * E2E journeys: M3 Chat Completions adapter
 *
 * 验证 Responses 客户端通过网关调用 Chat 上游的完整链路：
 * - 旅程 15a：Responses 请求经 Chat 上游转换流式返回，工具调用事件与 usage 完整透传
 * - 旅程 15b：Responses 候选 429 自动 failover 切换到 Chat 候选
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { logTail, postResponses, startGateway } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream } from "../mock-upstream.js";

test("旅程 15a：Responses 客户端流式调用 Chat 上游，工具调用与 usage 完整转换", async (t) => {
  const mockChat = await startMockUpstream((captured) => {
    // 验证发给 Chat 上游的请求格式
    assert.equal(captured.body?.model, "llama-3.3-70b");
    assert.ok(Array.isArray(captured.body?.messages));
    assert.equal(captured.body?.stream, true);

    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      events: [
        'data: {"id":"chatcmpl-e2e","choices":[{"delta":{"role":"assistant","content":"Thinking..."}}]}\n\n',
        'data: {"id":"chatcmpl-e2e","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_e2e_1","type":"function","function":{"name":"run_command","arguments":""}}]}}]}\n\n',
        'data: {"id":"chatcmpl-e2e","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}\n\n',
        'data: {"id":"chatcmpl-e2e","choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":25,"completion_tokens":15,"total_tokens":40}}\n\n',
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

  const res = await postResponses(gateway.url, {
    model: "free-auto",
    input: "list files in current directory",
    stream: true,
    tools: [
      {
        type: "function",
        name: "run_command",
        description: "Run shell command",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
    ],
  });

  assert.equal(res.status, 200, logTail(gateway));
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes('"type":"response.created"'));
  assert.ok(text.includes('"type":"response.output_item.added"'));
  assert.ok(text.includes('"type":"function_call"'));
  assert.ok(text.includes('"call_id":"call_e2e_1"'));
  assert.ok(text.includes('"name":"run_command"'));
  assert.ok(text.includes('"type":"response.function_call_arguments.delta"'));
  assert.ok(text.includes('"type":"response.function_call_arguments.done"'));
  assert.ok(text.includes('"arguments":"{\\"command\\":\\"ls\\"}"'));
  assert.ok(text.includes('"type":"response.completed"'));
  assert.ok(text.includes('"input_tokens":25'));
  assert.ok(text.includes('"output_tokens":15'));
});

test("旅程 15b：Responses 候选 429 自动 failover 切换到 Chat 候选", async (t) => {
  const mockResponses = await startMockUpstream({
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "5" },
    body: JSON.stringify({ error: { message: "openrouter 429" } }),
  });
  const mockChat = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "chatcmpl-fallback",
      object: "chat.completion",
      created: 1788240000,
      model: "llama-3.3-70b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello from cerebras fallback" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
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
              providerModelId: "poolside/laguna-s-2.1:free",
              contextWindow: 262144,
              maxOutputTokens: 32768,
              supportsTools: true,
              supportsReasoning: true,
              limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
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

  const res = await postResponses(gateway.url, { model: "free-auto", input: "ping" });
  assert.equal(res.status, 200, logTail(gateway));
  const body = (await res.json()) as {
    object: string;
    output: Array<{ type: string; role: string; content: Array<{ text: string }> }>;
  };
  assert.equal(body.object, "response");
  assert.equal(body.output[0].content[0].text, "hello from cerebras fallback");

  assert.equal(mockResponses.requests.length, 1);
  assert.equal(mockChat.requests.length, 1);
});
