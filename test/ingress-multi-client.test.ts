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
  assert.equal(res.headers.get("x-prismd-provider"), "cerebras");
  assert.equal(res.headers.get("x-prismd-model"), "llama-3.3-70b");
  assert.equal(res.headers.get("x-prismd-alias"), "free-auto");

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
  assert.equal(res.headers.get("x-prismd-provider"), "cerebras");
  assert.equal(res.headers.get("x-prismd-model"), "llama-3.3-70b");
  assert.equal(res.headers.get("x-prismd-alias"), "claude-3-5-sonnet-20241022");

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

function startResponsesMock(): Promise<{ server: Server; port: number }> {
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
        res.write('data: {"type":"response.created","response":{"id":"resp_mock_1"}}\n\n');
        res.write('data: {"type":"response.output_text.delta","delta":"hello from responses upstream"}\n\n');
        setTimeout(() => {
          res.write(
            'data: {"type":"response.completed","response":{"id":"resp_mock_1","usage":{"input_tokens":8,"output_tokens":4}}}\n\n',
          );
          res.write("data: [DONE]\n\n");
          res.end();
        }, 10);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "resp_mock_json",
            object: "response",
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "hello from responses upstream" }],
              },
            ],
            usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
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

async function setupResponsesGateway(mockPort: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-responses-ingress-"));
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        providers: {
          openrouter: {
            type: "responses",
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKeyField: "openrouter",
          },
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
            ],
          },
        },
      }),
    ),
  );
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "local-token-test";
  process.env["OPENROUTER_API_KEY"] = "openrouter-key-test";
  const dataPath = useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();
  return dataPath;
}

test("POST /v1/chat/completions converts and relays responses from Responses upstream", async (t) => {
  const mock = await startResponsesMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupResponsesGateway(mock.port);

  // Non-streaming
  const res = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "test chat to responses" }],
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = (await res.json()) as { choices: Array<{ message: { content: string } }>; usage: { prompt_tokens: number } };
  assert.equal(body.choices[0].message.content, "hello from responses upstream");
  assert.equal(body.usage.prompt_tokens, 8);

  // Streaming
  const streamRes = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "stream chat to responses" }],
      stream: true,
    }),
  });

  assert.equal(streamRes.status, 200);
  assert.equal(streamRes.headers.get("content-type"), "text/event-stream");
  const streamText = await streamRes.text();
  assert.ok(streamText.includes("hello from responses upstream"));
  assert.ok(streamText.includes("[DONE]"));
});

test("POST /v1/messages converts and relays responses from Responses upstream", async (t) => {
  const mock = await startResponsesMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setupResponsesGateway(mock.port);

  // Non-streaming
  const res = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-token-test",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "test messages to responses" }],
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = (await res.json()) as {
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
  };
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
  assert.equal(body.content[0].text, "hello from responses upstream");

  // Streaming
  const streamRes = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-token-test",
    },
    body: JSON.stringify({
      model: "free-auto",
      messages: [{ role: "user", content: "stream messages to responses" }],
      stream: true,
    }),
  });

  assert.equal(streamRes.status, 200);
  assert.equal(streamRes.headers.get("content-type"), "text/event-stream");
  const streamText = await streamRes.text();
  assert.ok(streamText.includes("event: message_start"));
  assert.ok(streamText.includes("event: content_block_delta"));
  assert.ok(streamText.includes("hello from responses upstream"));
  assert.ok(streamText.includes("event: message_stop"));
});

test("POST /v1/chat/completions returns 400 capability_unsupported when no candidates support tools", async (t) => {
  const mock = await startMultiClientMock();
  t.after(() => new Promise((r) => mock.server.close(r)));

  const cfg = makeValidConfig();
  const dir = mkdtempSync(join(tmpdir(), "prismd-cap-test-"));
  const cfgPath = join(dir, "config.json");
  // Configure candidates with supportsTools: false
  cfg.models["no-tool-model"] = {
    candidates: [
      {
        provider: "openrouter",
        providerModelId: "test-model-no-tool",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: false,
        supportsReasoning: false,
        limits: { dailyRequests: null, rpm: 60, maxConcurrent: 4 },
        tags: ["text-only"],
      },
    ],
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  process.env.PRISMD_CONFIG_PATH = cfgPath;
  useTempDataPath(t);
  resetConfigForTests();
  resetRuntimeForTests();

  const res = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "no-tool-model",
      messages: [{ role: "user", content: "call a tool" }],
      tools: [{ type: "function", function: { name: "test_fn" } }],
    }),
  });

  assert.equal(res.status, 400);
  const json = (await res.json()) as { error: { code: string } };
  assert.equal(json.error.code, "capability_unsupported");
});

test("POST /v1/chat/completions prioritizes candidate matching x-prismd-tags header", async (t) => {
  let requestedModel = "";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c.toString()));
    req.on("end", () => {
      const parsed = JSON.parse(raw) as { model: string };
      requestedModel = parsed.model;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chat-tag",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => new Promise((r) => server.close(r)));
  const port = (server.address() as AddressInfo).port;

  const cfg = makeValidConfig();
  const dir = mkdtempSync(join(tmpdir(), "prismd-tag-test-"));
  const cfgPath = join(dir, "config.json");
  cfg.providers["tag-prov"] = {
    type: "chat",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKeyField: "prismd",
  };
  cfg.models["tagged-alias"] = {
    candidates: [
      {
        provider: "tag-prov",
        providerModelId: "model-generic",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsReasoning: false,
        limits: { dailyRequests: null, rpm: 60, maxConcurrent: 4 },
        tags: ["general"],
      },
      {
        provider: "tag-prov",
        providerModelId: "model-coding-fast",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsReasoning: false,
        limits: { dailyRequests: null, rpm: 60, maxConcurrent: 4 },
        tags: ["coding", "fast"],
      },
    ],
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  process.env.PRISMD_CONFIG_PATH = cfgPath;
  useTempDataPath(t);
  resetConfigForTests();
  resetRuntimeForTests();

  const res = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
      "x-prismd-tags": "coding,fast",
    },
    body: JSON.stringify({
      model: "tagged-alias",
      messages: [{ role: "user", content: "code something" }],
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(requestedModel, "model-coding-fast");
});

test("POST /v1/chat/completions enforces maxConcurrent limit and returns 429 rate_limit_exceeded", async (t) => {
  let releaseUpstream: (() => void) | null = null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c.toString()));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"streaming"}}]}\n\n');
      // Hold the stream open until triggered
      const interval = setInterval(() => {
        if (releaseUpstream) {
          clearInterval(interval);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 20);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => new Promise((r) => server.close(r)));
  const port = (server.address() as AddressInfo).port;

  const cfg = makeValidConfig();
  const dir = mkdtempSync(join(tmpdir(), "prismd-rl-test-"));
  const cfgPath = join(dir, "config.json");
  cfg.providers["rl-prov"] = {
    type: "chat",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKeyField: "prismd",
  };
  cfg.models["rl-alias"] = {
    candidates: [
      {
        provider: "rl-prov",
        providerModelId: "model-single-concurrency",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsReasoning: false,
        limits: { dailyRequests: null, rpm: 60, maxConcurrent: 1 },
        tags: [],
      },
    ],
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  process.env.PRISMD_CONFIG_PATH = cfgPath;
  useTempDataPath(t);
  resetConfigForTests();
  resetRuntimeForTests();

  // First request occupies maxConcurrent=1
  const req1Promise = app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "rl-alias",
      messages: [{ role: "user", content: "req1" }],
      stream: true,
    }),
  });

  // Wait briefly for req1 to acquire concurrency slot
  await new Promise((r) => setTimeout(r, 60));

  // Second concurrent request should be rejected with 429 rate_limit_exceeded
  const res2 = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "rl-alias",
      messages: [{ role: "user", content: "req2" }],
    }),
  });

  assert.equal(res2.status, 429);
  const json2 = (await res2.json()) as { error: { code: string } };
  assert.equal(json2.error.code, "rate_limit_exceeded");

  // Now release req1
  releaseUpstream = () => {};
  const res1 = await req1Promise;
  assert.equal(res1.status, 200);
  await res1.text();

  // Wait briefly for stream finalize to release concurrency slot
  await new Promise((r) => setTimeout(r, 60));

  // Third request should now succeed
  const res3 = await app.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-token-test",
    },
    body: JSON.stringify({
      model: "rl-alias",
      messages: [{ role: "user", content: "req3" }],
      stream: true,
    }),
  });
  assert.equal(res3.status, 200);
  await res3.text();
});


