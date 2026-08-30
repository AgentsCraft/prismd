import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app.js";
import { resetConfigForTests } from "../src/config.js";
import { makeValidConfig } from "./helpers.js";

// Upstream points at a port with nothing listening: a request that
// reaches the egress fails fast with connection refused (502), which
// proves auth let it through. A 401 proves auth blocked it first.
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
          apiKeyEnv: "OPENROUTER_API_KEY",
        },
      },
    }),
  ),
);
process.env.PRISMD_CONFIG_PATH = join(dir, "prismd.json");
process.env["PRISMD_API_KEY"] = "test-token";
process.env["OPENROUTER_API_KEY"] = "test-key";
resetConfigForTests();

function post(authorization?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== undefined) headers["authorization"] = authorization;
  return app.request("/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "free-auto", input: "hi" }),
  });
}

test("missing token is rejected with 401 before any upstream call", async () => {
  const res = await post();
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_api_key");
});

test("wrong token is rejected with 401", async () => {
  const res = await post("Bearer wrong-token");
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_api_key");
});

test("correct token passes auth and reaches the egress (502: upstream unreachable)", async () => {
  const res = await post("Bearer test-token");
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "gateway_upstream_error");
});
