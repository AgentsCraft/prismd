import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  SseEventSplitter,
  dataPayloads,
  tryExtractUsage,
  parseRetryAfter,
  callRawHttpUpstream,
  UpstreamConnectError,
} from "../src/egress/raw.js";

test("SseEventSplitter splits chunked SSE events across delimiters", () => {
  const splitter = new SseEventSplitter();
  const chunk1 = "data: event1\n\ndata: part";
  const events1 = splitter.push(chunk1);
  assert.deepEqual(events1, ["data: event1"]);

  const chunk2 = "ial event2\r\n\r\ndata: event3\n\n";
  const events2 = splitter.push(chunk2);
  assert.deepEqual(events2, ["data: partial event2", "data: event3"]);

  const chunk3 = "data: trailing";
  const events3 = splitter.push(chunk3);
  assert.deepEqual(events3, []);

  const trailing = splitter.end();
  assert.deepEqual(trailing, ["data: trailing"]);
});

test("dataPayloads extracts payload from both 'data: ' and 'data:' lines", () => {
  const event = "data: line with space\ndata:line without space\nevent: message\n:comment";
  const payloads = dataPayloads(event);
  assert.deepEqual(payloads, ["line with space", "line without space"]);
});

test("tryExtractUsage extracts tokens across various provider formats", () => {
  // OpenAI chat completions format
  const chatFormat = JSON.stringify({
    usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
  });
  assert.deepEqual(tryExtractUsage(chatFormat), { inputTokens: 15, outputTokens: 25 });

  // Anthropic / Responses format
  const responsesFormat = JSON.stringify({
    usage: { input_tokens: 30, output_tokens: 10 },
  });
  assert.deepEqual(tryExtractUsage(responsesFormat), { inputTokens: 30, outputTokens: 10 });

  // Nested response.usage
  const nestedFormat = JSON.stringify({
    type: "response.completed",
    response: { usage: { input_tokens: 45, output_tokens: 20 } },
  });
  assert.deepEqual(tryExtractUsage(nestedFormat), { inputTokens: 45, outputTokens: 20 });

  // Nested message.usage
  const msgFormat = JSON.stringify({
    type: "message_start",
    message: { usage: { input_tokens: 50, output_tokens: 0 } },
  });
  assert.deepEqual(tryExtractUsage(msgFormat), { inputTokens: 50, outputTokens: 0 });

  // Invalid JSON or non-usage JSON
  assert.equal(tryExtractUsage("invalid-json"), undefined);
  assert.equal(tryExtractUsage('{"status":"ok"}'), undefined);
});

test("parseRetryAfter parses delta-seconds and date strings", () => {
  assert.equal(parseRetryAfter("30"), 30000);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("-1"), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter(""), undefined);

  const futureDate = new Date(Date.now() + 5000).toUTCString();
  const parsed = parseRetryAfter(futureDate);
  assert.ok(parsed !== undefined && parsed > 0 && parsed <= 6000);
});

test("callRawHttpUpstream handles connect timeout", async () => {
  const hangingServer = createServer((_req, _res) => {
    // Never respond to trigger connect timeout
  });
  await new Promise<void>((resolve) => hangingServer.listen(0, "127.0.0.1", resolve));
  const port = (hangingServer.address() as AddressInfo).port;

  try {
    await callRawHttpUpstream(
      "test-provider",
      `http://127.0.0.1:${port}/chat`,
      { "content-type": "application/json" },
      "{}",
      false,
      { connectTimeoutMs: 50, streamIdleTimeoutMs: 100 },
    );
    assert.fail("should have thrown UpstreamConnectError");
  } catch (err) {
    assert.ok(err instanceof UpstreamConnectError);
    assert.equal(err.timeout, true);
  } finally {
    await new Promise((r) => hangingServer.close(r));
  }
});

test("callRawHttpUpstream handles stream idle timeout and extracts usage", async () => {
  const streamServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n');
    // Hangs after first chunk to trigger idle timeout
  });
  await new Promise<void>((resolve) => streamServer.listen(0, "127.0.0.1", resolve));
  const port = (streamServer.address() as AddressInfo).port;

  try {
    let firstTokenLatency = 0;
    const result = await callRawHttpUpstream(
      "test-provider",
      `http://127.0.0.1:${port}/stream`,
      { "content-type": "application/json" },
      "{}",
      true,
      {
        connectTimeoutMs: 1000,
        streamIdleTimeoutMs: 50,
        onFirstToken: (lat) => {
          firstTokenLatency = lat;
        },
      },
    );

    assert.equal(result.kind, "stream");
    assert.ok(firstTokenLatency >= 0);

    const bodyText = await result.response.text();
    assert.ok(bodyText.includes('"content":"start"'));
    assert.ok(bodyText.includes('"code":"stream_idle_timeout"'));
    assert.equal(result.accounting.aborted, true);
  } finally {
    await new Promise((r) => streamServer.close(r));
  }
});

test("callRawHttpUpstream extracts real usage from completed SSE stream", async () => {
  const streamServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => streamServer.listen(0, "127.0.0.1", resolve));
  const port = (streamServer.address() as AddressInfo).port;

  try {
    const result = await callRawHttpUpstream(
      "test-provider",
      `http://127.0.0.1:${port}/stream`,
      { "content-type": "application/json" },
      "{}",
      true,
      { connectTimeoutMs: 1000, streamIdleTimeoutMs: 1000 },
    );

    assert.equal(result.kind, "stream");
    await result.response.text();
    assert.equal(result.accounting.aborted, false);
    assert.deepEqual(result.accounting.realUsage, { inputTokens: 12, outputTokens: 4 });
  } finally {
    await new Promise((r) => streamServer.close(r));
  }
});
