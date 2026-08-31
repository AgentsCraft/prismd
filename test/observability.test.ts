import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, redactString, sanitize } from "../src/observability/logger.js";
import { newRequestId } from "../src/observability/request-id.js";

test("redactSecrets masks authorization/x-api-key/api-key keys case-insensitively", () => {
  const out = redactSecrets({
    headers: {
      Authorization: "Bearer sk-secret-value",
      "x-api-key": "another-fake-secret",
      "Content-Type": "application/json",
    },
    nested: [{ api_key: "secret3", ok: "visible" }],
  });
  assert.deepEqual(out, {
    headers: {
      Authorization: "****",
      "x-api-key": "****",
      "Content-Type": "application/json",
    },
    nested: [{ api_key: "****", ok: "visible" }],
  });
});

test("redactSecrets leaves arrays, scalars and non-sensitive keys alone", () => {
  assert.deepEqual(redactSecrets([1, "a", { b: 2 }]), [1, "a", { b: 2 }]);
  assert.equal(redactSecrets("plain string"), "plain string");
  assert.equal(redactSecrets(null), null);
});

test("redactString replaces literal secret values", () => {
  assert.equal(redactString("failed with key abcdefgh", ["abcdefgh"]), "failed with key ****");
  assert.equal(redactString("no match here", ["abcdefgh"]), "no match here");
  // Short values (<4 chars) are not masked to avoid mangling words.
  assert.equal(redactString("key ab", ["ab"]), "key ab");
});

test("sanitize combines key masking and literal value masking", () => {
  const out = sanitize(
    {
      message: "upstream said abcdefgh is invalid",
      headers: { authorization: "Bearer abcdefgh" },
    },
    ["abcdefgh"],
  );
  assert.deepEqual(out, {
    message: "upstream said **** is invalid",
    headers: { authorization: "****" },
  });
});

test("newRequestId produces unique UUID-shaped ids", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
