import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { resetRuntimeForTests } from "../src/core/runtime.js";
import { makeValidConfig, useTempDataPath } from "./helpers.js";

// Upstream points at a port with nothing listening: a request that
// reaches the egress fails fast with connection refused (all-failed
// classification: 503 upstream_unreachable), which proves auth let it
// through. A 401 proves auth blocked it first.
const UNREACHABLE_UPSTREAM = "http://127.0.0.1:9";

const dir = mkdtempSync(join(tmpdir(), "prismd-auth-"));
writeFileSync(
  join(dir, "prismd.json"),
  JSON.stringify(
    makeValidConfig({
      providers: {
        openrouter: {
          type: "responses",
          baseUrl: UNREACHABLE_UPSTREAM,
          apiKeyField: "openrouter",
        },
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
    }),
  ),
);
process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
process.env["PRISMD_API_KEY"] = "test-token";
process.env["OPENROUTER_API_KEY"] = "test-key";
useTempDataPath();
resetConfigForTests();
resetRuntimeForTests();

function post(options?: { authorization?: string; xApiKey?: string }): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.authorization !== undefined) headers["authorization"] = options.authorization;
  if (options?.xApiKey !== undefined) headers["x-api-key"] = options.xApiKey;
  return app.request("/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "free-auto", input: "hi" }),
  });
}

test("missing token is rejected with 401 before any upstream call", async () => {
  resetRuntimeForTests();
  const res = await post();
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_api_key");
});

test("wrong token is rejected with 401", async () => {
  resetRuntimeForTests();
  const res = await post({ authorization: "Bearer wrong-token" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_api_key");
});

test("correct Bearer token passes auth and reaches egress (503: upstream unreachable)", async () => {
  resetRuntimeForTests();
  const res = await post({ authorization: "Bearer test-token" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "upstream_unreachable");
});

test("correct lowercase bearer token passes auth", async () => {
  resetRuntimeForTests();
  const res = await post({ authorization: "bearer test-token" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "upstream_unreachable");
});

test("correct x-api-key header passes auth seamlessly (Anthropic SDK / Claude Code)", async () => {
  resetRuntimeForTests();
  const res = await post({ xApiKey: "test-token" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "upstream_unreachable");
});

test("wrong x-api-key header is rejected with 401", async () => {
  resetRuntimeForTests();
  const res = await post({ xApiKey: "wrong-api-key" });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_api_key");
});

test("valid x-api-key with empty or invalid authorization still passes auth", async () => {
  resetRuntimeForTests();
  const res = await post({ authorization: "Bearer wrong", xApiKey: "test-token" });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "upstream_unreachable");
});
