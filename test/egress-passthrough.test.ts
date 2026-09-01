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

const SSE_EVENTS = [
  'data: {"type":"response.output_item.added","index":0}\n\n',
  'data: {"type":"response.output_text.delta","delta":"hel"}\n\n',
  'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
  'data: {"type":"response.completed"}\n\n',
];

interface Captured {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | undefined;
}

function startMock(
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
        SSE_EVENTS.forEach((event, i) => {
          setTimeout(() => {
            res.write(event);
            if (i === SSE_EVENTS.length - 1) res.end();
          }, i * 5);
        });
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "mock-resp", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }] }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port, captured: () => last });
    });
  });
}

async function setup(mockPort: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-egress-"));
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        providers: {
          openrouter: {
            type: "responses",
            baseUrl: `http://127.0.0.1:${mockPort}`,
            apiKeyField: "openrouter",
            extraHeaders: { "HTTP-Referer": "https://localhost/prismd", "X-Title": "prismd" },
          },
        },
      }),
    ),
  );
  process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["OPENROUTER_API_KEY"] = "test-key";
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

test("non-streaming JSON passes through with the alias rewritten to the provider model id", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = (await res.json()) as { id: string };
  assert.equal(body.id, "mock-resp");

  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.body?.model, "poolside/laguna-s-2.1:free");
});

test("streaming SSE events are relayed in order with none dropped", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  let lastIndex = -1;
  for (const event of SSE_EVENTS) {
    const index = text.indexOf(event);
    assert.ok(index >= 0, `missing SSE event: ${event}`);
    assert.ok(index > lastIndex, `SSE event out of order: ${event}`);
    lastIndex = index;
  }
});

test("extraHeaders are merged into the upstream request", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);

  await post({ model: "free-auto", input: "hi" });
  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.headers["x-title"], "prismd");
  assert.equal(captured.headers["http-referer"], "https://localhost/prismd");
  assert.ok(captured.headers["authorization"], "authorization header must be sent");
});

test("unknown alias returns 404 model_not_found", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);

  const res = await post({ model: "nope", input: "hi" });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "model_not_found");
  assert.ok(body.error.message.includes("nope"));
});

test("request-class 4xx is relayed as-is without failover", async (t) => {
  const mock = await startMock((_body, res) => {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "bad window", type: "invalid_request_error", code: "context_window_exceeded" },
      }),
    );
  });
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "context_window_exceeded");
  assert.equal(body.error.message, "bad window");
});

test("missing upstream API key at runtime returns 500 with the key field name", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));
  await setup(mock.port);
  delete process.env["OPENROUTER_API_KEY"];
  t.after(() => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
  });

  const res = await post({ model: "free-auto", input: "hi" });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "gateway_internal_error");
  assert.ok(body.error.message.includes("openrouter"));
});

test("SSE 'data:' lines without a space are still accounted as output", async (t) => {
  const mock = await startMock((body, res) => {
    if (body?.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data:{"type":"response.output_text.delta","delta":"x"}\n\n');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "mock-resp" }));
  });
  t.after(() => new Promise((r) => mock.server.close(r)));
  const dataPath = await setup(mock.port);

  const res = await post({ model: "free-auto", input: "hi", stream: true });
  assert.equal(res.status, 200);
  await res.text();

  shutdownRuntime();
  const db = new DatabaseSync(dataPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT output_tokens FROM usage_daily").all() as { output_tokens: number }[];
    assert.equal(rows.length, 1);
    assert.ok(rows[0].output_tokens > 0, "no-space 'data:' payload must contribute to the output estimate");
  } finally {
    db.close();
  }
});

test("custom responses provider without built-in builder uses defaultResponsesCreateRequest", async (t) => {
  const mock = await startMock();
  t.after(() => new Promise((r) => mock.server.close(r)));

  const dir = mkdtempSync(join(tmpdir(), "prismd-custom-egress-"));
  writeFileSync(
    join(dir, "prismd.json"),
    JSON.stringify(
      makeValidConfig({
        providers: {
          "custom-llm": {
            type: "responses",
            baseUrl: `http://127.0.0.1:${mock.port}`,
            apiKeyField: "custom_llm",
            extraHeaders: { "X-Custom-Header": "custom-val" },
          },
        },
        models: {
          "free-auto": {
            candidates: [
              {
                provider: "custom-llm",
                providerModelId: "custom-model-v1",
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
  process.env["PRISMD_API_KEY"] = "test-token";
  process.env["CUSTOM_LLM_API_KEY"] = "custom-key";
  useTempDataPath();
  resetConfigForTests();
  resetRuntimeForTests();

  const res = await post({ model: "free-auto", input: "test custom provider" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: string };
  assert.equal(body.id, "mock-resp");

  const captured = mock.captured();
  assert.ok(captured);
  assert.equal(captured.headers["x-custom-header"], "custom-val");
  assert.equal(captured.headers["authorization"], "Bearer custom-key");
  assert.equal(captured.body?.model, "custom-model-v1");
});
