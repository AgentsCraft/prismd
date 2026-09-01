import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { resetRuntimeForTests } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

function startMultiClientMock(): Promise<{ server: Server; port: number }> {
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

      if (body?.stream === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"id":"chatcmpl-multi","choices":[{"delta":{"role":"assistant","content":"hello client"}}]}\n\n',
        );
        setTimeout(() => {
          res.write('data: {"id":"chatcmpl-multi","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
        }, 10);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-multi",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "hello client" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
        );
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

async function setupMultiClient(mockPort: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-multi-client-"));
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        providers: {
          cerebras: {
            type: "chat",
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKeyField: "cerebras",
          },
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
    ),
  );
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "local-token-test";
  process.env["CEREBRAS_API_KEY"] = "cerebras-key-test";
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("POST /v1/chat/completions accepts valid request and returns Chat response", async (t) => {
  const mock = await startMultiClientMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupMultiClient(mock.port);

  const res = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "hi" }],
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.ok(res.headers.get("x-request-id"));

  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  assert.equal(body.choices[0].message.content, "hello client");
});

test("POST /v1/messages accepts Anthropic format with x-api-key and returns Anthropic response", async (t) => {
  const mock = await startMultiClientMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupMultiClient(mock.port);

  const res = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-token-test",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hi claude" }],
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.ok(res.headers.get("x-request-id"));

  const body = (await res.json()) as {
    id: string;
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
  };
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
  assert.equal(body.content[0].type, "text");
  assert.equal(body.content[0].text, "hello client");
});

test("POST /v1/messages streaming returns Anthropic SSE event stream", async (t) => {
  const mock = await startMultiClientMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupMultiClient(mock.port);

  const res = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-token-test",
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "stream me" }],
      stream: true,
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");

  const text = await res.text();
  assert.ok(text.includes("event: message_start"));
  assert.ok(text.includes("event: content_block_start"));
  assert.ok(text.includes("event: content_block_delta"));
  assert.ok(text.includes("event: content_block_stop"));
  assert.ok(text.includes("event: message_delta"));
  assert.ok(text.includes("event: message_stop"));
});
