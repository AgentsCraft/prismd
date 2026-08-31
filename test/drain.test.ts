import { test } from "node:test";
import assert from "node:assert/strict";
import { beginStream, endStream, resetDrainForTests, waitForStreams } from "../src/core/drain.js";

test("waitForStreams resolves true when no streams are active", async () => {
  resetDrainForTests();
  assert.equal(await waitForStreams(10), true);
});

test("waitForStreams resolves false when streams do not drain in time", async () => {
  resetDrainForTests();
  beginStream();
  assert.equal(await waitForStreams(20), false);
  endStream();
});

test("a second waitForStreams while draining is guarded and does not strand the first", async () => {
  resetDrainForTests();
  beginStream();
  const first = waitForStreams(30_000);
  // A second shutdown signal must not start a competing wait that would
  // steal the drain callback from the first promise.
  assert.equal(await waitForStreams(30_000), true, "re-entry resolves immediately");
  endStream();
  assert.equal(await first, true, "the first promise still resolves when the stream drains");
});
