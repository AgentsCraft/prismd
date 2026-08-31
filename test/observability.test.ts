import { test } from "node:test";
import assert from "node:assert/strict";
import { pino } from "pino";
import { newRequestId } from "../src/observability/request-id.js";
import { REDACT_PATHS } from "../src/observability/logger.js";

test("newRequestId produces unique UUID-shaped ids", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("redact paths censor api-key values anywhere in a logged object", () => {
  const lines: string[] = [];
  const probe = pino(
    { redact: { paths: REDACT_PATHS, censor: "****" } },
    { write(line: string): void { lines.push(line); } },
  );
  probe.info({ "api-key": "top-secret", nested: { "api-key": "nested-secret", ok: 1 } }, "probe");
  const logged = JSON.parse(lines[0]) as {
    "api-key": string;
    nested: { "api-key": string; ok: number };
  };
  assert.equal(logged["api-key"], "****");
  assert.equal(logged.nested["api-key"], "****");
  assert.equal(logged.nested.ok, 1);
});
