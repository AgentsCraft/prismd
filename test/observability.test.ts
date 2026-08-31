import { test } from "node:test";
import assert from "node:assert/strict";
import { newRequestId } from "../src/observability/request-id.js";

test("newRequestId produces unique UUID-shaped ids", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
