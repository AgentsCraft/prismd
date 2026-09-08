import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "../src/core/sqlite.js";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { resetRuntimeForTests, shutdownRuntime } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";
import { createRequest as createNvidiaRequest } from "../src/providers/nvidia.js";
import { callUpstream } from "../src/egress/chat.js";

const CHAT_SSE_EVENTS = [
  'data: {"id":"chatcmpl-test","choices":[{"delta":{"role":"assistant","content":"hel"}}]}\n\n',
  'data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"lo"}}]}\n\n',
  'data: {"id":"chatcmpl-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
  "data: [DONE]\n\n",
];

interface Captured {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | undefined;
  url?: string;
  method?: string;
}

function startChatMock(
  respond?: (body: Record<string, unknown> | undefined, res: ServerResponse) => void,
): Promise<{ server: Server; port: number; captured: () => Captured | undefined }> {
  let last: Captured | undefined;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        body = undefined;
      }
      last = { headers: req.headers, body, url: req.url, method: req.method };
      if (respond) {
        respond(body, res);
      } else if (body?.stream === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        CHAT_SSE_EVENTS.forEach((event, i) => {
          setTimeout(() => {
            res.write(event);
            if (i === CHAT_SSE_EVENTS.length - 1) res.end();
          }, i * 5);
        });
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: 1788240000,
            model: body?.model ?? "llama-3.3-70b",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "hello from cerebras chat" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          }),
        );
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port, captured: () => last });
    });
  });
}

async function setupChat(mockPort: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-egress-chat-"));
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        providers: {
          cerebras: {
            type: "chat",
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKeyField: "cerebras",
            extraHeaders: { "X-Custom-Header": "prismd-test" },
          },
          nvidia: {
            type: "chat",
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKeyField: "nvidia",
            extraHeaders: { "X-Nvidia-Client": "prismd-nvidia-test" },
          },
        },
        models: {
          "cerebras-chat": {
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
          "nvidia-chat": {
            candidates: [
              {
                provider: "nvidia",
                providerModelId: "nvidia/llama-3.1-nemotron-70b-instruct",
                contextWindow: 131072,
                maxOutputTokens: 4096,
                supportsTools: true,
                supportsReasoning: false,
                limits: { dailyRequests: 1000, rpm: 20, maxConcurrent: 2 },
                tags: ["free", "nvidia", "nemotron"],
              },
            ],
          },
        },
      }),
    ),
  );
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["CEREBRAS_API_KEY"] = "test-cerebras-key";
  process.env["NVIDIA_API_KEY"] = "test-nvidia-key";
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

function post(body: Record<string, unknown>): Promise<Response> {
  return app.request("/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

test("non-streaming Responses request to chat provider is converted to /chat/completions and returns Responses JSON", async (t) => {
  const mock = await startChatMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({
    model: "cerebras-chat",
    input: "ping",
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = (await res.json()) as {
    id: string;
    object: string;
    status: string;
    output: Array<{ type: string; role: string; content: Array<{ text: string }> }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  assert.equal(body.object, "response");
  assert.equal(body.status, "completed");
  assert.equal(body.output[0].type, "message");
  assert.equal(body.output[0].role, "assistant");
  assert.equal(body.output[0].content[0].text, "hello from cerebras chat");
  assert.equal(body.usage.input_tokens, 12);
  assert.equal(body.usage.output_tokens, 6);

  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.headers["x-custom-header"], "prismd-test");
  assert.equal(captured.headers["authorization"], "Bearer test-cerebras-key");
  assert.equal(captured.body?.model, "llama-3.3-70b");
  assert.deepEqual(captured.body?.messages, [{ role: "user", content: "ping" }]);
});

test("streaming Responses request to chat provider converts Chat SSE to Responses SSE", async (t) => {
  const mock = await startChatMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({
    model: "cerebras-chat",
    input: "ping",
    stream: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes('"type":"response.created"'));
  assert.ok(text.includes('"type":"response.output_item.added"'));
  assert.ok(text.includes('"type":"response.text.delta"'));
  assert.ok(text.includes('"type":"response.text.done"'));
  assert.ok(text.includes('"type":"response.completed"'));
  assert.ok(text.includes('"input_tokens":10'));
  assert.ok(text.includes('"output_tokens":2'));
});

test("streaming tool calls from Chat provider are converted to Responses function_call SSE events", async (t) => {
  const mock = await startChatMock((body, res) => {
    if (body?.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        'data: {"id":"chatcmpl-tools","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_99","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      );
      setTimeout(() => {
        res.write(
          'data: {"id":"chatcmpl-tools","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}\n\n',
        );
        res.write('data: {"id":"chatcmpl-tools","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      }, 10);
    }
  });
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({
    model: "cerebras-chat",
    input: "read a.txt",
    stream: true,
    tools: [
      {
        type: "function",
        name: "read_file",
        description: "read file content",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
  });
  assert.equal(res.status, 200);
  const text = await res.text();

  assert.ok(text.includes('"type":"response.output_item.added"'));
  assert.ok(text.includes('"type":"function_call"'));
  assert.ok(text.includes('"call_id":"call_99"'));
  assert.ok(text.includes('"name":"read_file"'));
  assert.ok(text.includes('"type":"response.function_call_arguments.delta"'));
  assert.ok(text.includes('"type":"response.function_call_arguments.done"'));
  assert.ok(text.includes('"arguments":"{\\"path\\":\\"a.txt\\"}"'));
  assert.ok(text.includes('"type":"response.completed"'));
});

test("chat provider real usage is saved to SQLite usage_daily", async (t) => {
  const mock = await startChatMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  const dataPath = await setupChat(mock.port);

  const res = await post({ model: "cerebras-chat", input: "hi", stream: true });
  assert.equal(res.status, 200);
  await res.text();

  shutdownRuntime();
  const db = new DatabaseSync(dataPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT input_tokens, output_tokens FROM usage_daily").all() as {
      input_tokens: number;
      output_tokens: number;
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].input_tokens, 10);
    assert.equal(rows[0].output_tokens, 2);
  } finally {
    db.close();
  }
});

test("mid-stream chat upstream error surfaces as a Responses response.failed event without normal completion", async (t) => {
  const mock = await startChatMock((body, res) => {
    if (body?.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"id":"chatcmpl-err","choices":[{"delta":{"role":"assistant","content":"par"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"error":{"code":"server_error","message":"mid-stream chat failure"}}\n\n');
        res.end();
      }, 10);
    }
  });
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({ model: "cerebras-chat", input: "ping", stream: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes("event: response.failed"), "mid-stream failure must reach the client as response.failed");
  assert.ok(text.includes('"type":"response.failed"'));
  assert.ok(text.includes('"code":"server_error"'));
  assert.ok(text.includes("mid-stream chat failure"));
  assert.ok(!text.includes('"type":"response.completed"'), "no normal completion after a mid-stream failure");
  assert.ok(!text.includes("[DONE]"), "no [DONE] after a mid-stream failure");
});

test("nvidia createRequest builds valid chat completions request (URL, authorization header, body serialization)", () => {
  const provider = {
    type: "chat" as const,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyField: "nvidia",
    auth: { type: "api_key" as const },
    extraHeaders: { "X-Nvidia-Client": "prismd-test" },
  };
  const body = {
    model: "nvidia/llama-3.1-nemotron-70b-instruct",
    input: "Hello NVIDIA NIM",
    instructions: "Be helpful and concise",
    stream: false,
  };
  const req = createNvidiaRequest(provider, body, "nvapi-sample-key");

  assert.equal(req.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(req.headers["authorization"], "Bearer nvapi-sample-key");
  assert.equal(req.headers["content-type"], "application/json");
  assert.equal(req.headers["accept"], "application/json");
  assert.equal(req.headers["X-Nvidia-Client"], "prismd-test");

  const parsedBody = JSON.parse(req.body) as Record<string, unknown>;
  assert.equal(parsedBody.model, "nvidia/llama-3.1-nemotron-70b-instruct");
  assert.deepEqual(parsedBody.messages, [
    { role: "system", content: "Be helpful and concise" },
    { role: "user", content: "Hello NVIDIA NIM" },
  ]);
  assert.equal(parsedBody.stream, undefined);

  // Streaming request serialization and accept header
  const streamReq = createNvidiaRequest(provider, { ...body, stream: true }, "nvapi-sample-key");
  const parsedStreamBody = JSON.parse(streamReq.body) as Record<string, unknown>;
  assert.equal(parsedStreamBody.stream, true);
  assert.deepEqual(parsedStreamBody.stream_options, { include_usage: true });
  assert.equal(streamReq.headers["accept"], "text/event-stream");

  // Defensively strips trailing slashes from baseUrl
  const reqTrailing = createNvidiaRequest(
    { ...provider, baseUrl: "https://integrate.api.nvidia.com/v1///" },
    body,
    "nvapi-sample-key",
  );
  assert.equal(reqTrailing.url, "https://integrate.api.nvidia.com/v1/chat/completions");

  // When auth.type is none or apiKey is absent, omit authorization header
  const reqNoAuth = createNvidiaRequest(
    { ...provider, auth: { type: "none" as const } },
    body,
    "nvapi-sample-key",
  );
  assert.equal(reqNoAuth.headers["authorization"], undefined);

  const reqEmptyKey = createNvidiaRequest(provider, body, "");
  assert.equal(reqEmptyKey.headers["authorization"], undefined);
});

test("non-streaming Responses request to nvidia provider is converted to /chat/completions and returns Responses JSON", async (t) => {
  const mock = await startChatMock((reqBody, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-nvidia-nim",
        object: "chat.completion",
        created: 1788240000,
        model: reqBody?.model ?? "nvidia/llama-3.1-nemotron-70b-instruct",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hello from nvidia nim" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 14, completion_tokens: 6, total_tokens: 20 },
      }),
    );
  });
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({
    model: "nvidia-chat",
    input: "ping nvidia",
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const body = (await res.json()) as {
    id: string;
    object: string;
    status: string;
    output: Array<{ type: string; role: string; content: Array<{ text: string }> }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  assert.equal(body.object, "response");
  assert.equal(body.status, "completed");
  assert.equal(body.output[0].type, "message");
  assert.equal(body.output[0].role, "assistant");
  assert.equal(body.output[0].content[0].text, "hello from nvidia nim");
  assert.equal(body.usage.input_tokens, 14);
  assert.equal(body.usage.output_tokens, 6);

  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "/chat/completions");
  assert.equal(captured.headers["x-nvidia-client"], "prismd-nvidia-test");
  assert.equal(captured.headers["authorization"], "Bearer test-nvidia-key");
  assert.equal(captured.body?.model, "nvidia/llama-3.1-nemotron-70b-instruct");
  assert.deepEqual(captured.body?.messages, [{ role: "user", content: "ping nvidia" }]);
});

test("streaming Responses request to nvidia provider converts Chat SSE to Responses SSE", async (t) => {
  const mock = await startChatMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupChat(mock.port);

  const res = await post({
    model: "nvidia-chat",
    input: "ping nvidia stream",
    stream: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes('"type":"response.created"'));
  assert.ok(text.includes('"type":"response.output_item.added"'));
  assert.ok(text.includes('"type":"response.text.delta"'));
  assert.ok(text.includes('"type":"response.text.done"'));
  assert.ok(text.includes('"type":"response.completed"'));
  assert.ok(text.includes('"input_tokens":10'));
  assert.ok(text.includes('"output_tokens":2'));

  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "/chat/completions");
  assert.equal(captured.headers["authorization"], "Bearer test-nvidia-key");
  assert.equal(captured.headers["x-nvidia-client"], "prismd-nvidia-test");
  assert.equal(captured.body?.model, "nvidia/llama-3.1-nemotron-70b-instruct");
  assert.equal(captured.body?.stream, true);
});

test("callUpstream with nvidia provider handles 401 and 429 error responses with retryAfterMs", async (t) => {
  let returnStatus = 401;
  let returnHeaders: Record<string, string> = { "content-type": "application/json" };
  const mock = await startChatMock((_body, res) => {
    res.writeHead(returnStatus, returnHeaders);
    res.end(JSON.stringify({ error: { message: "test error", code: returnStatus } }));
  });
  t.after(() => new Promise((r) => mock.server.close(r)));

  const provider = {
    type: "chat" as const,
    baseUrl: `http://127.0.0.1:${mock.port}`,
    apiKeyField: "nvidia",
  };
  const body = {
    model: "nvidia/llama-3.1-nemotron-70b-instruct",
    input: "hello",
  };
  const callOptions = { connectTimeoutMs: 5000, streamIdleTimeoutMs: 5000 };

  // 1. Upstream 401 Unauthorized
  returnStatus = 401;
  returnHeaders = { "content-type": "application/json" };
  const res401 = await callUpstream("nvidia", provider, "nvidia/llama-3.1-nemotron-70b-instruct", body, "invalid-key", callOptions);
  assert.equal(res401.kind, "error");
  assert.equal(res401.status, 401);

  // 2. Upstream 429 Rate Limited with Retry-After header
  returnStatus = 429;
  returnHeaders = { "content-type": "application/json", "retry-after": "15" };
  const res429 = await callUpstream("nvidia", provider, "nvidia/llama-3.1-nemotron-70b-instruct", body, "valid-key", callOptions);
  assert.equal(res429.kind, "error");
  assert.equal(res429.status, 429);
  assert.equal(res429.retryAfterMs, 15000);
});
