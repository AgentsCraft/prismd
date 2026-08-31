/**
 * E2E journeys: gateway lifecycle — SSE full-cycle passthrough, local 401,
 * and quota persistence with graceful shutdown.
 *
 * 环境准备（全部旅程通用，详见 harness.ts 文件头）：
 *   - 本地 mock 上游（test/mock-upstream.ts，真实 http 服务，不消耗真实额度）
 *   - 网关用 tsx src/server.ts 起真实进程，临时 HOME / 临时配置 / 临时 SQLite
 *   - 密钥全部假值；不涉及真实上游，无需任何真实 key
 *
 * 失败定位：断言消息附网关 stderr 尾部（logTail）；上游行为由 mock 请求
 * 记录（requests 数组）区分「客户端侧 / 网关侧 / 上游侧」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { GATEWAY_TOKEN, logTail, parseSse, postResponses, startGateway, sleep, type GatewayHandle } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream } from "../mock-upstream.js";

const C1 = "poolside/laguna-s-2.1:free";

/** Config with a single alias `free-auto` whose first candidate hits mockUrl. */
function singleCandidateConfig(mockUrl: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeValidConfig({
    providers: {
      openrouter: { type: "responses", baseUrl: mockUrl, apiKeyField: "openrouter" },
    },
    models: {
      "free-auto": {
        candidates: [
          {
            provider: "openrouter",
            providerModelId: C1,
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
        ],
      },
    },
    ...overrides,
  });
}

function readAll(dbPath: string, table: string): Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as unknown as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** Poll the sqlite file until `predicate` is satisfied (flush is async). */
async function waitForDb(
  dbPath: string,
  predicate: (rows: Record<string, unknown>[]) => boolean,
  table: string,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = readAll(dbPath, table);
    if (predicate(rows)) return rows;
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${table} to satisfy predicate; last rows: ${JSON.stringify(rows)}`);
    }
    await sleep(500);
  }
}

const SSE_EVENTS = [
  'data: {"type":"response.created"}\n\n',
  'data: {"type":"response.output_item.added","output_index":0}\n\n',
  'data: {"type":"response.output_text.delta","delta":"hel"}\n\n',
  'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
  'data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":2}}}\n\n',
];

test("旅程 1：SSE 全生命周期透传，事件顺序完整不丢事件", async (t) => {
  // 前置条件：mock 上游按序发送 5 个 SSE 事件；网关配置单候选指向 mock；
  // 客户端带正确 Bearer 请求 stream:true。
  const mock = await startMockUpstream({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    events: SSE_EVENTS,
    eventDelayMs: 5,
  });
  t.after(() => mock.close());
  const gateway = await startGateway(singleCandidateConfig(mock.url));
  t.after(async () => {
    await gateway.stop();
  });

  const res = await postResponses(gateway.url, { model: "free-auto", input: "hello", stream: true });
  const text = await res.text();

  // 断言点（网关侧 + 上游侧）：状态/头/request-id/字节级完整透传/事件顺序。
  assert.equal(res.status, 200, logTail(gateway));
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.match(
    res.headers.get("x-request-id") ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "every response must carry a request-id",
  );
  // 字节级透传：不丢、不重排、不多加事件。
  assert.equal(text, SSE_EVENTS.join(""), "SSE events must be relayed byte-for-byte in order");
  const types = parseSse(text).map((e) => (JSON.parse(e.data[0]) as { type: string }).type);
  assert.deepEqual(types, [
    "response.created",
    "response.output_item.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.completed",
  ]);
  // 上游侧：恰好一次调用，model 被替换为具体 providerModelId，带 Bearer key。
  assert.equal(mock.requests.length, 1, "exactly one upstream call");
  assert.equal(mock.requests[0].body?.model, C1);
  assert.equal(mock.requests[0].headers.authorization, "Bearer e2e-upstream-key");
});

test("旅程 9：本地 Bearer 错误返回 401，mock 上游收到 0 请求", async (t) => {
  // 前置条件：网关正确配置；上游 mock 计数。客户端带错误 token。
  const mock = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "ok" }),
  });
  t.after(() => mock.close());
  const gateway = await startGateway(singleCandidateConfig(mock.url));
  t.after(async () => {
    await gateway.stop();
  });

  const bad = await postResponses(gateway.url, { model: "free-auto", input: "hi" }, "wrong-token");
  const badBody = (await bad.json()) as { error: { code: string; message: string } };

  // 断言点：401 + OpenAI 风格错误体；上游 0 调用（认证失败不触达上游）。
  assert.equal(bad.status, 401, logTail(gateway));
  assert.equal(badBody.error.code, "invalid_api_key");
  assert.ok(badBody.error.message.length > 0);
  assert.match(bad.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/, "401 also carries a request-id");
  assert.equal(mock.requests.length, 0, "wrong local token must never reach the upstream");

  // 正向对照：正确 token 正常路由（证明 401 不是网关整体不可用）。
  const good = await postResponses(gateway.url, { model: "free-auto", input: "hi" }, GATEWAY_TOKEN);
  assert.equal(good.status, 200, logTail(gateway));
  await good.text();
  assert.equal(mock.requests.length, 1);
});

test("旅程 10：额度落盘（周期 flush + 优雅退出强制 flush），请求日志不丢", { timeout: 60_000 }, async (t) => {
  // 前置条件：上游返回带真实 usage 的 JSON（input 7 / output 3 个 token）；
  // 网关单候选，dailyRequests 100（不触发额度过滤）。flush 周期默认 5s。
  const mock = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "ok", usage: { input_tokens: 7, output_tokens: 3 } }),
  });
  t.after(() => mock.close());
  const gateway: GatewayHandle = await startGateway(
    singleCandidateConfig(mock.url, {
      models: {
        "free-auto": {
          candidates: [
            {
              provider: "openrouter",
              providerModelId: C1,
              contextWindow: 262144,
              maxOutputTokens: 32768,
              supportsTools: true,
              supportsReasoning: true,
              limits: { dailyRequests: 100, rpm: 20, maxConcurrent: 2 },
              tags: ["free"],
            },
          ],
        },
      },
    }),
    { keepDir: true },
  );
  t.after(async () => {
    await gateway.stop();
    rmSync(gateway.dir, { recursive: true, force: true });
  });

  // 请求 1：真实 usage，等周期 flush 落盘。
  const res1 = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  assert.equal(res1.status, 200, logTail(gateway));
  const id1 = res1.headers.get("x-request-id") ?? "";
  await res1.text();

  const usage1 = await waitForDb(
    gateway.dataPath,
    (rows) => rows.length === 1 && rows[0].requests === 1,
    "usage_daily",
  );
  assert.equal(usage1[0].provider, "openrouter");
  assert.equal(usage1[0].model, C1);
  assert.equal(usage1[0].input_tokens, 7, "real upstream usage must win over estimates");
  assert.equal(usage1[0].output_tokens, 3);
  assert.equal(usage1[0].source, "real");

  // 请求 2 之后立刻 SIGTERM：优雅退出强制 flush，request_log 一行不丢。
  const res2 = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  assert.equal(res2.status, 200, logTail(gateway));
  const id2 = res2.headers.get("x-request-id") ?? "";
  await res2.text();

  const exitCode = await gateway.stop();
  assert.equal(exitCode, 0, "graceful shutdown must exit 0");

  const usageFinal = readAll(gateway.dataPath, "usage_daily");
  assert.equal(usageFinal.length, 1);
  assert.equal(usageFinal[0].requests, 2, "daily usage accumulates across flush cycles");
  assert.equal(usageFinal[0].input_tokens, 14);

  const logs = readAll(gateway.dataPath, "request_log");
  assert.equal(logs.length, 2, "every finished request must leave a request_log row after SIGTERM");
  const ids = logs.map((l) => l.request_id);
  assert.deepEqual(new Set(ids), new Set([id1, id2]), "request_log rows keyed by the response request-id");
  for (const row of logs) {
    assert.equal(row.alias, "free-auto");
    assert.equal(row.status, 200);
    assert.equal(row.estimated, 0, "real usage must not be flagged as estimated");
  }
});
