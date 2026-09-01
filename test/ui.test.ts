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

test("renderUiHtml contains 10-language selector and complete dictionary", () => {
  const html = renderUiHtml();
  assert.ok(html.includes('<select id="lang-select"'));
  assert.ok(html.includes('value="en">English'));
  assert.ok(html.includes('value="zh-CN">简体中文'));
  assert.ok(html.includes('value="ja">日本語'));
  assert.ok(html.includes('value="ko">한국어'));
  assert.ok(html.includes('value="de">Deutsch'));
  assert.ok(html.includes('value="fr">Français'));
  assert.ok(html.includes('value="es">Español'));
  assert.ok(html.includes('value="it">Italiano'));
  assert.ok(html.includes('value="ar">العربية'));
  assert.ok(html.includes('value="tr">Türkçe'));

  // Dictionary validation
  assert.ok(html.includes("TRANSLATIONS"));
  assert.ok(html.includes("localStorage.getItem('prismd_lang')"));
  assert.ok(html.includes("navigator.language"));
  assert.ok(html.includes("resetUsage"));
  assert.ok(html.includes("resetConfirm"));
  assert.ok(html.includes("resetting"));
  assert.ok(html.includes("inputTokens"));
  assert.ok(html.includes("outputTokens"));
  assert.ok(html.includes("recentEvents"));
  assert.ok(html.includes("noEvents"));
});
