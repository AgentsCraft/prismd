import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { resetRuntimeForTests, shutdownRuntime } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

const CHAT_SSE_EVENTS = [
  'data: {"id":"chatcmpl-test","choices":[{"delta":{"role":"assistant","content":"hel"}}]}\n\n',
  'data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"lo"}}]}\n\n',
  'data: {"id":"chatcmpl-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
  "data: [DONE]\n\n",
];

interface Captured {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | undefined;
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
      last = { headers: req.headers, body };
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
            model: "llama-3.3-70b",
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
        },
      }),
    ),
  );
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["CEREBRAS_API_KEY"] = "test-cerebras-key";
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
