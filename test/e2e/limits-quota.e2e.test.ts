/**
 * E2E journeys: quota & routing limits — context-window 422, daily quota
 * exhaustion (429 + restart seed readback), 80% soft demotion.
 *
 * 环境准备：同 harness.ts 文件头。窗口/额度阈值在测试配置里刻意调小
 * （contextWindow=100 / dailyRequests=2 / dailyRequests=5）以在数秒内
 * 走完状态变化；两个 mock 上游各自一个端口，用响应体区分候选。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { logTail, postResponses, startGateway } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream, type MockUpstream } from "../mock-upstream.js";

const C1 = "poolside/laguna-s-2.1:free"; // openrouter 候选 1
const C2 = "llama-3.3-70b-versatile"; // groq 候选 2

function twoCandidateConfig(mockA: MockUpstream, mockB: MockUpstream, overrides: Record<string, unknown> = {}) {
  return makeValidConfig({
    providers: {
      openrouter: { type: "responses", baseUrl: mockA.url, apiKeyField: "openrouter" },
      groq: { type: "responses", baseUrl: mockB.url, apiKeyField: "groq" },
    },
    ...overrides,
  });
}

/** Candidate definitions with tunable contextWindow / dailyRequests. */
function candidates(window: number, daily: number | null): Record<string, unknown>[] {
  return [
    {
      provider: "openrouter",
      providerModelId: C1,
      contextWindow: window,
      maxOutputTokens: 100,
      supportsTools: true,
      supportsReasoning: true,
      limits: { dailyRequests: daily, rpm: 20, maxConcurrent: 2 },
      tags: ["free"],
    },
    {
      provider: "groq",
      providerModelId: C2,
      contextWindow: window,
      maxOutputTokens: 100,
      supportsTools: true,
      supportsReasoning: false,
      limits: { dailyRequests: daily, rpm: 30, maxConcurrent: 4 },
      tags: ["free"],
    },
  ];
}

const OK_A = { id: "candidate-1" };
const OK_B = { id: "candidate-2" };

test("旅程 6：输入超过全部候选 contextWindow 时返回 422，不触达上游", async (t) => {
  // 前置条件：两个候选 contextWindow 都设为 100；输入 400 字符（估算
  // chars/4 ≈ 110 > 100）。mock 上游计数，应保持 0 调用。
  const mock = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OK_A),
  });
  t.after(() => mock.close());
  const gateway = await startGateway(
    makeValidConfig({
      providers: {
        openrouter: { type: "responses", baseUrl: mock.url, apiKeyField: "openrouter" },
        groq: { type: "responses", baseUrl: mock.url, apiKeyField: "groq" },
      },
      models: { "free-auto": { candidates: candidates(100, 50) } },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  // 正向对照：小输入正常路由（证明配置本身可路由）。
  const small = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  assert.equal(small.status, 200, logTail(gateway));
  await small.text();

  const big = await postResponses(gateway.url, { model: "free-auto", input: "x".repeat(400) });
  const body = (await big.json()) as {
    error: { code: string; metadata: { candidates: { provider: string; model: string; contextWindow: number }[] } };
  };

  // 断言点：422 + context_window_exceeded；metadata 附各候选窗口大小；
  // 上游除正向对照外零调用（超窗在进上游前拒绝）。
  assert.equal(big.status, 422, logTail(gateway));
  assert.equal(body.error.code, "context_window_exceeded");
  assert.deepEqual(body.error.metadata.candidates, [
    { provider: "openrouter", model: C1, contextWindow: 100 },
    { provider: "groq", model: C2, contextWindow: 100 },
  ]);
  assert.equal(mock.requests.length, 1, "window overflow must be rejected before any upstream call");
});

test("旅程 7：日额度耗尽返回 429，重启进程后（种子回读）额度仍耗尽", { timeout: 60_000 }, async (t) => {
  // 前置条件：两候选 dailyRequests=2；4 个正常请求正好打满两候选
  // （请求 1-2 -> 候选 1，请求 3-4 -> 候选 2），第 5 个应 429。
  const mockA = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OK_A),
  });
  const mockB = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OK_B),
  });
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const config = twoCandidateConfig(mockA, mockB, {
    models: { "free-auto": { candidates: candidates(262144, 2) } },
  });
  const gateway = await startGateway(config, { keepDir: true });
  t.after(async () => {
    await gateway.stop();
    rmSync(gateway.dir, { recursive: true, force: true });
  });

  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
    assert.equal(res.status, 200, logTail(gateway));
    seen.push(((await res.json()) as { id: string }).id);
  }
  assert.deepEqual(seen, ["candidate-1", "candidate-1", "candidate-2", "candidate-2"], "quota exhaustion must drive failover to candidate 2");
  assert.equal(mockA.requests.length, 2);
  assert.equal(mockB.requests.length, 2);

  // 第 5 个请求：两候选都耗尽 -> 429 quota_exceeded，metadata 附过滤原因。
  const blocked = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  const blockedBody = (await blocked.json()) as {
    error: { code: string; metadata: { candidates: { model: string; reason: string }[] } };
  };
  assert.equal(blocked.status, 429, logTail(gateway));
  assert.equal(blockedBody.error.code, "quota_exceeded");
  assert.deepEqual(
    blockedBody.error.metadata.candidates.map((c) => [c.model, c.reason]),
    [
      [C1, "quota_exhausted"],
      [C2, "quota_exhausted"],
    ],
  );
  assert.equal(mockA.requests.length, 2, "quota rejection must not touch the upstream");
  assert.equal(mockB.requests.length, 2);

  // SIGTERM 优雅退出（强制 flush）后，用同一 SQLite 重启：种子回读应让额度仍然耗尽。
  const exitCode = await gateway.stop();
  assert.equal(exitCode, 0, "graceful shutdown must exit 0");

  const restarted = await startGateway(config, { dataPath: gateway.dataPath });
  t.after(async () => {
    await restarted.stop();
  });
  const afterRestart = await postResponses(restarted.url, { model: "free-auto", input: "hi" });
  const afterBody = (await afterRestart.json()) as {
    error: { code: string; metadata: { candidates: { model: string; reason: string }[] } };
  };
  assert.equal(afterRestart.status, 429, "seeded daily usage must survive a restart");
  assert.equal(afterBody.error.code, "quota_exceeded");
  assert.deepEqual(
    afterBody.error.metadata.candidates.map((c) => c.reason),
    ["quota_exhausted", "quota_exhausted"],
  );
  assert.equal(mockA.requests.length, 2, "restarted gateway must not call the upstream");
  assert.equal(mockB.requests.length, 2);
});

test("旅程 8：日额度达 80% 的候选被软降权，下一请求路由到未触线候选", async (t) => {
  // 前置条件：候选 1 dailyRequests=5（4/5 = 80% 触软降权阈值）；
  // 候选 2 dailyRequests=null（永不降权）。响应体区分候选来源。
  const mockA = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OK_A),
  });
  const mockB = await startMockUpstream({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OK_B),
  });
  t.after(async () => {
    await mockA.close();
    await mockB.close();
  });
  const gateway = await startGateway(
    twoCandidateConfig(mockA, mockB, {
      models: {
        "free-auto": {
          candidates: [
            {
              provider: "openrouter",
              providerModelId: C1,
              contextWindow: 262144,
              maxOutputTokens: 100,
              supportsTools: true,
              supportsReasoning: true,
              limits: { dailyRequests: 5, rpm: 20, maxConcurrent: 2 },
              tags: ["free"],
            },
            {
              provider: "groq",
              providerModelId: C2,
              contextWindow: 262144,
              maxOutputTokens: 100,
              supportsTools: true,
              supportsReasoning: false,
              limits: { dailyRequests: null, rpm: 30, maxConcurrent: 4 },
              tags: ["free"],
            },
          ],
        },
      },
    }),
  );
  t.after(async () => {
    await gateway.stop();
  });

  // 前 4 个请求：候选 1 未触线（<80%）排在前，全部路由到候选 1。
  for (let i = 0; i < 4; i += 1) {
    const res = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
    assert.equal(res.status, 200, logTail(gateway));
    assert.equal(((await res.json()) as { id: string }).id, "candidate-1", `request ${i + 1} must still hit candidate 1`);
  }
  assert.equal(mockA.requests.length, 4);
  assert.equal(mockB.requests.length, 0);

  // 第 5 个请求：候选 1 达 4/5 = 80% -> 软降权到队尾，候选 2 被选中。
  const demoted = await postResponses(gateway.url, { model: "free-auto", input: "hi" });
  assert.equal(demoted.status, 200, logTail(gateway));
  assert.equal(((await demoted.json()) as { id: string }).id, "candidate-2", "soft-limited candidate must move to the back of the queue");
  assert.equal(mockA.requests.length, 4, "candidate 1 must not receive the soft-demoted request");
  assert.equal(mockB.requests.length, 1);
});
