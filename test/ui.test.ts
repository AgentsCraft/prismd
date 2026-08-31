import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { renderUiHtml } from "../src/ui/page.js";

test("GET /ui returns HTML status dashboard without auth", async () => {
  const res = await app.request("/ui", { method: "GET" });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/html"));

  const html = await res.text();
  assert.ok(html.includes("<title>prismd status</title>"));
  assert.ok(html.includes("prismd status"));
  assert.ok(html.includes("/v1/modelstatus/stream"));
});

test("renderUiHtml generates standalone HTML with zero external script tags", () => {
  const html = renderUiHtml();
  assert.ok(!html.includes('src="http'));
  assert.ok(!html.includes('href="http'));
  assert.ok(html.includes("EventSource"));
});
