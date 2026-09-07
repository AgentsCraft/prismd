/**
 * E2E journey: client usage aggregation — a request carrying a real client
 * User-Agent flows through the gateway and appears in GET /v1/clientstatus;
 * unrecognized UAs stay verbatim; the in-memory window resets on restart.
 *
 * 环境准备：同 harness.ts 文件头；mock 上游返回正常 SSE，零真实额度消耗。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GATEWAY_TOKEN, logTail, startGateway, type GatewayHandle } from "./harness.js";
import { makeValidConfig } from "../helpers.js";
import { startMockUpstream } from "../mock-upstream.js";

const SSE_OK = {
  status: 200,
  headers: { "content-type": "text/event-stream" },
  events: [
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: {"type":"response.completed","usage":{"input_tokens":5,"output_tokens":1}}\n\n',
  ],
  eventDelayMs: 5,
} as const;

function singleProviderConfig(mockUrl: string): Record<string, unknown> {
  return makeValidConfig({
    providers: {
      openrouter: { type: "responses", baseUrl: mockUrl, apiKeyField: "openrouter" },
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
        ],
      },
    },
  });
}

async function postWithUserAgent(
  gatewayUrl: string,
  userAgent: string,
): Promise<Response> {
  return fetch(`${gatewayUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${GATEWAY_TOKEN}`,
      "user-agent": userAgent,
    },
    body: JSON.stringify({ model: "free-auto", input: "hi", stream: true }),
  });
}

interface ClientStatusBody {
  timestamp: string;
  windowMs: number;
  clients: Array<{
    client: string;
    endpoint: string;
    requests: number;
    successRate: number;
    p50Ms: number | null;
    failovers: number;
  }>;
}

async function getClientStatus(gatewayUrl: string): Promise<{ res: Response; body: ClientStatusBody }> {
  const res = await fetch(`${gatewayUrl}/v1/clientstatus`);
  const body = (await res.json()) as ClientStatusBody;
  return { res, body };
}

test("旅程 17：客户端 UA 聚合进 /v1/clientstatus，未知 UA 原样展示，重启后窗口清零", async (t) => {
  const mock = await startMockUpstream(SSE_OK);
  t.after(async () => {
    await mock.close();
  });

  const config = singleProviderConfig(mock.url);
  const gateway = await startGateway(config, { keepDir: true });
  t.after(async () => {
    await gateway.stop();
  });

  // Two requests from a recognized client, one from an unrecognized one.
  for (const ua of ["claude-cli/1.0.34 (external, cli)", "claude-cli/1.0.34 (external, cli)", "SomeClient/9.9"]) {
    const res = await postWithUserAgent(gateway.url, ua);
    assert.equal(res.status, 200, logTail(gateway));
    await res.text();
  }

  // Read-only, unauthenticated endpoint returns the aggregated window.
  const { res: statusRes, body } = await getClientStatus(gateway.url);
  assert.equal(statusRes.status, 200);
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  assert.equal(body.windowMs, 24 * 60 * 60 * 1000);

  const byClient = new Map(body.clients.map((c) => [c.client, c]));
  const claude = byClient.get("claude-code");
  assert.ok(claude, "claude-cli UA must be mapped to claude-code");
  assert.equal(claude.endpoint, "/v1/responses");
  assert.equal(claude.requests, 2);
  assert.equal(claude.successRate, 1);
  assert.ok(claude.p50Ms !== null && claude.p50Ms >= 0);

  // The unrecognized UA is shown verbatim in its own row, never merged.
  const unknown = byClient.get("SomeClient/9.9");
  assert.ok(unknown, "unrecognized UA must stay verbatim in its own row");
  assert.equal(unknown.requests, 1);

  // Restart the gateway: the aggregation is in-memory only, so the window
  // resets to an empty (but valid) snapshot without errors.
  await gateway.stop();
  const restarted: GatewayHandle = await startGateway(config, { keepDir: true });
  t.after(async () => {
    await restarted.stop();
  });
  const after = await getClientStatus(restarted.url);
  assert.equal(after.res.status, 200);
  assert.deepEqual(after.body.clients, []);
});
