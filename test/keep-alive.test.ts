import { test } from "node:test";
import assert from "node:assert/strict";
import { addSseKeepAlive, keepAliveEvent } from "../src/egress/raw.js";

/** A pull-based source that sends the given chunks, then stalls forever. */
function stalledSource(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      } catch {
        /* cancelled mid-pull */
      }
    },
  });
}

/** A source that emits `total` complete events with `gapMs` between them, then stalls. */
function activeSource(total: number, gapMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (sent >= total) return;
        await new Promise((r) => setTimeout(r, gapMs));
        controller.enqueue(encoder.encode(`data: {"i":${sent++}}\n\n`));
      } catch {
        /* cancelled mid-pull */
      }
    },
  });
}

/** Read a wrapped stream for `ms`, returning the decoded text seen so far. */
async function collectFor(stream: ReadableStream<Uint8Array>, ms: number): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  const run = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text;
      text += decoder.decode(value, { stream: true });
    }
  })();
  await new Promise((r) => setTimeout(r, ms));
  await reader.cancel().catch(() => {});
  await run.catch(() => {});
  return text;
}

test("addSseKeepAlive heartbeats silent streams in each protocol shape", async () => {
  for (const protocol of ["chat", "responses", "anthropic"] as const) {
    const stream = addSseKeepAlive(stalledSource(['data: {"x":1}\n\n']), protocol, 40);
    const text = await collectFor(stream, 180);
    assert.ok(text.includes('data: {"x":1}\n\n'), "the original event must pass through");
    const heartbeats = text.split(keepAliveEvent(protocol)).length - 1;
    assert.ok(heartbeats >= 2, `${protocol}: expected >=2 heartbeats in 180ms, got ${heartbeats}`);
  }
});

test("addSseKeepAlive stays quiet while events keep flowing", async () => {
  // 8 events 10ms apart = ~80ms of activity against a 100ms idle interval;
  // collect for 150ms so the window ends before the first post-activity
  // heartbeat could fire (last chunk ~80ms + 100ms idle > 150ms).
  const stream = addSseKeepAlive(activeSource(8, 10), "chat", 100);
  const text = await collectFor(stream, 150);
  assert.equal(text.split(": keep-alive").length - 1, 0, "no heartbeat while the upstream is active");
  assert.ok(text.includes('data: {"i":7}\n\n'));
});

test("addSseKeepAlive never injects into a pending partial event", async () => {
  // The upstream sends half an event, goes quiet past several heartbeat
  // intervals, then finishes it: the silence must produce zero heartbeats.
  const encoder = new TextEncoder();
  let stage = 0;
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (stage === 0) {
          stage = 1;
          controller.enqueue(encoder.encode('data: {"par'));
        } else if (stage === 1) {
          await new Promise((r) => setTimeout(r, 150));
          stage = 2;
          controller.enqueue(encoder.encode('tial":1}\n\n'));
          controller.close();
        }
      } catch {
        /* cancelled */
      }
    },
  });
  const stream = addSseKeepAlive(source, "chat", 30);
  const text = await collectFor(stream, 400);
  assert.equal(text, 'data: {"partial":1}\n\n', "no keep-alive may split the pending event");
});

test("addSseKeepAlive keeps heartbeating before the first byte arrives", async () => {
  // Pre-first-token wait (thinking model): silence from byte zero.
  const stream = addSseKeepAlive(stalledSource([]), "anthropic", 30);
  const text = await collectFor(stream, 150);
  assert.ok(text.split(keepAliveEvent("anthropic")).length - 1 >= 2, "heartbeats cover the silent wait");
});
