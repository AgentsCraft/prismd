import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatMessages } from "../src/ingress/chat.js";

test("sanitizeChatMessages strips non-standard proprietary fields like reasoning_details and thought", () => {
  const dirtyMessages = [
    { role: "system", content: "You are a helpful assistant.", unknown_prop: 123 },
    { role: "user", content: "Hello!", extra_user_meta: "foo" },
    {
      role: "assistant",
      content: "Hi there!",
      reasoning: "User said hello, I say hi.",
      reasoning_details: [{ type: "reasoning.text", text: "..." }],
      refusal: null,
      thought: "internal thought",
      x_groq: { usage: 100 },
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "test_fn", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: '{"result": "ok"}',
      status: "success",
    },
  ];

  const cleaned = sanitizeChatMessages(dirtyMessages);
  assert.equal(cleaned.length, 4);

  // System
  assert.deepEqual(cleaned[0], { role: "system", content: "You are a helpful assistant." });

  // User
  assert.deepEqual(cleaned[1], { role: "user", content: "Hello!" });

  // Assistant - should keep role, content, tool_calls, but strip reasoning_details/reasoning/etc.
  assert.deepEqual(cleaned[2], {
    role: "assistant",
    content: "Hi there!",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "test_fn", arguments: "{}" },
      },
    ],
  });

  // Tool
  assert.deepEqual(cleaned[3], {
    role: "tool",
    tool_call_id: "call_1",
    content: '{"result": "ok"}',
  });
});
