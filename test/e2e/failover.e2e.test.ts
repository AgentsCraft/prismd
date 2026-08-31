/**
 * E2E journeys: failover decision tree — 429 switch, 4xx passthrough,
 * broken stream (no retry + SSE error), connect timeout, all-fail 502.
 *
 * 环境准备：同 harness.ts 文件头；两个独立 mock 上游（候选 1 / 候选 2，
 * 各占一个端口）验证切换；policies.connectTimeoutMs 在测试配置里调小。
 * 断言定位：mock 请求记录 = 上游侧，响应体/状态 = 网关侧+客户端侧。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { logTail, postResponses, startGateway } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream, type MockUpstream } from "../mock-upstream.js";

const C1 = "poolside/laguna-s-2.1:free"; // openrouter 候选 1
const C2 = "llama-3.3-70b-versatile"; // groq 候选 2

/** Two-candidate `free-auto` config: candidate 1 -> mockA, candidate 2 -> mockB. */
function twoCandidateConfig(mockA: MockUpstream, mockB: MockUpstream, overrides: Record<string, unknown> = {}) {
  return makeValidConfig({
    providers: {
      openrouter: { type: "responses", baseUrl: mockA.url, apiKeyField: "openrouter" },
      groq: { type: "responses", baseUrl: mockB.url, apiKeyField: "groq" },
    },
    ...overrides,
  });
}

const SSE_C2 = {
  status: 200,
  headers: { "content-type": "text/event-stream" },
  events: [
    'data: {"type":"response.output_text.delta","delta":"from-candidate-2"}\n\n',
    'data: {"type":"response.completed","usage":{"input_tokens":5,"output_tokens":1}}\n\n',
  ],
  eventDelayMs: 5,
} as const;

test("旅程 2：候选 1 返回 429 时网关自动切换候选 2，客户端收到候选 2 的正常流", async (t) => {
  // 前置条件：候选 1 mock 固定返回 429（带 retry-after）；候选 2 mock 正常 SSE。
  const mockA = await startMockUpstream({
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "5" },
    body: JSON.stringify({ error: { message: "rate limited" } }),
  });
  const mockB = await startMockUpstream(SSE_C2);
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const gateway = await startGateway(twoCandidateConfig(mockA, mockB));
  t.after(async () => {
    await gateway.stop();
  });

  const res = await postResponses(gateway.url, { model: "free-auto", input: "hi", stream: true });
  const text = await res.text();

  // 断言点：客户端拿到候选 2 的流（标记事件），而不是候选 1 的 429 体。
  assert.equal(res.status, 200, logTail(gateway));
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.ok(text.includes("from-candidate-2"), `expected candidate 2 stream, got:\n${text}`);
  assert.ok(!text.includes("rate limited"), "candidate 1's 429 body must not leak into the relayed stream");
  // 上游侧：候选 1 恰被调用 1 次，候选 2 恰被调用 1 次，且模型 id 各归其位。
  assert.equal(mockA.requests.length, 1);
  assert.equal(mockA.requests[0].body?.model, C1);
  assert.equal(mockB.requests.length, 1);
  assert.equal(mockB.requests[0].body?.model, C2);
});

test("旅程 3：请求类 4xx（400/404）原样透传，不切换候选 2", async (t) => {
  // 前置条件：候选 1 mock 依次返回 400、404（带可辨识错误体）；候选 2 mock 计数。
  let upstreamCall = 0;
  const bodies = [
    { status: 400, body: { error: { message: "bad request upstream", type: "invalid_request_error", code: "bad_request" } } },
    { status: 404, body: { error: { message: "model not found upstream", type: "invalid_request_error", code: "not_found" } } },
  ];
  const mockA = await startMockUpstream(() => {
    const b = bodies[upstreamCall % bodies.length];
    upstreamCall += 1;
    return { status: b.status, headers: { "content-type": "application/json" }, body: JSON.stringify(b.body) };
  });
  const mockB = await startMockUpstream(SSE_C2);
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const gateway = await startGateway(twoCandidateConfig(mockA, mockB));
  t.after(async () => {
    await gateway.stop();
  });

  for (const expected of bodies) {
    const res = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
    const relayed = (await res.json()) as typeof expected.body;
    assert.equal(res.status, expected.status, logTail(gateway));
    assert.deepEqual(relayed, expected.body, "request-class 4xx must be relayed verbatim");
    assert.equal(mockB.requests.length, 0, "no failover for request-class 4xx");
  }
  assert.equal(mockA.requests.length, 2, "both requests went to candidate 1 only");
});

test("旅程 4：流开始后断流不重试，客户端收到 SSE error 事件后流结束", async (t) => {
  // 前置条件：候选 1 mock 先发 1 个事件再销毁 socket；候选 2 mock 正常（计数）。
  const firstEvent = 'data: {"type":"response.output_text.delta","delta":"par"}\n\n';
  const mockA = await startMockUpstream({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    events: [firstEvent, 'data: {"type":"response.output_text.delta","delta":"tial"}\n\n'],
    eventDelayMs: 5,
    breakAfterEvents: 1,
  });
  const mockB = await startMockUpstream(SSE_C2);
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const gateway = await startGateway(twoCandidateConfig(mockA, mockB));
  t.after(async () => {
    await gateway.stop();
  });

  const res = await postResponses(gateway.url, { model: "free-auto", input: "hi", stream: true });
  const text = await res.text();

  // 断言点：已流出的数据保留 + 网关追加 SSE error 事件结束流；不重试候选 2。
  assert.equal(res.status, 200, logTail(gateway));
  assert.ok(text.startsWith(firstEvent), `partial upstream data must be preserved, got:\n${text}`);
  assert.ok(text.includes('"type":"error"'), "broken stream must end with an SSE error event");
  assert.ok(text.includes("stream_error"), "error event carries the stream_error code");
  assert.ok(!text.includes("from-candidate-2"), "no candidate 2 output may appear");
  assert.equal(mockA.requests.length, 1);
  assert.equal(mockB.requests.length, 0, "stream breaks after start are never retried");
});

test("旅程 5a：上游挂起触发连接超时，网关切到候选 2", async (t) => {
  // 前置条件：候选 1 mock 连接后 5s 不响应；connectTimeoutMs 调到 500ms。
  const mockA = await startMockUpstream({ status: 200, body: "never", startDelayMs: 5_000 });
  const mockB = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "candidate-2-ok" }),
  });
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const gateway = await startGateway(
    twoCandidateConfig(mockA, mockB, { policies: { connectTimeoutMs: 500 } }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  const startedAt = Date.now();
  const res = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  const elapsed = Date.now() - startedAt;
  const body = (await res.json()) as { id: string };

  // 断言点：候选 2 正常响应；耗时远小于候选 1 的 5s 挂起（证明没干等）。
  assert.equal(res.status, 200, logTail(gateway));
  assert.equal(body.id, "candidate-2-ok");
  assert.ok(elapsed < 4_000, `connect timeout must cut the hang short, took ${elapsed}ms`);
  assert.equal(mockA.requests.length, 1);
  assert.equal(mockB.requests.length, 1);
});

test("旅程 5b：全部候选挂起返回 502，metadata 附各候选连接错误", async (t) => {
  // 前置条件：单候选，上游挂起 5s 不响应；connectTimeoutMs 调到 500ms。
  const mock = await startMockUpstream({ status: 200, body: "never", startDelayMs: 5_000 });
  t.after(() => mock.close());
  const gateway = await startGateway(
    makeValidConfig({
      providers: {
        openrouter: { type: "responses", baseUrl: mock.url, apiKeyField: "openrouter" },
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
      policies: { connectTimeoutMs: 500 },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  const res = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  const body = (await res.json()) as {
    error: { code: string; metadata: { candidates: { provider: string; model: string; status: string }[] } };
  };

  // 断言点：502 gateway_all_candidates_failed，metadata 定位到具体候选与连接错误。
  assert.equal(res.status, 502, logTail(gateway));
  assert.equal(body.error.code, "gateway_all_candidates_failed");
  assert.deepEqual(body.error.metadata.candidates, [
    { provider: "openrouter", model: C1, status: "connection_error" },
  ]);
  assert.equal(mock.requests.length, 1);
});
