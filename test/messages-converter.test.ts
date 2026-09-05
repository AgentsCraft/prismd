import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertAnthropicToChatRequest,
  convertChatToAnthropicResponse,
  ChatToAnthropicStreamTransformer,
} from "../src/ingress/messages-converter.js";

test("convertAnthropicToChatRequest converts system, messages, and tools", () => {
  const req = convertAnthropicToChatRequest(
    {
      model: "claude-3-5-sonnet",
      system: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Hello",
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I can help with that." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "read_file",
              input: { path: "package.json" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: '{"name":"prismd"}',
            },
          ],
        },
      ],
      tools: [
        {
          name: "read_file",
          description: "Read file contents",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
      max_tokens: 1024,
      temperature: 0.5,
      stream: true,
    },
    "free-auto",
  );

  assert.equal(req.model, "free-auto");
  assert.equal(req.max_tokens, 1024);
  assert.equal(req.temperature, 0.5);
  assert.equal(req.stream, true);
  assert.deepEqual(req.stream_options, { include_usage: true });

  const messages = req.messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], { role: "system", content: "You are a helpful assistant." });
  assert.deepEqual(messages[1], { role: "user", content: "Hello" });

  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, "I can help with that.");
  const toolCalls = messages[2].tool_calls as Array<Record<string, unknown>>;
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].id, "toolu_123");
  assert.deepEqual(toolCalls[0].function, {
    name: "read_file",
    arguments: '{"path":"package.json"}',
  });

  assert.deepEqual(messages[3], {
    role: "tool",
    tool_call_id: "toolu_123",
    content: '{"name":"prismd"}',
  });

  const tools = req.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].type, "function");
  const fn = tools[0].function as Record<string, unknown>;
  assert.equal(fn.name, "read_file");
  assert.deepEqual(fn.parameters, {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  });
});

test("convertChatToAnthropicResponse converts chat json response to Anthropic format", () => {
  const chatResp = {
    id: "chatcmpl-anthropic-1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Here is your result.",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "calculate",
                arguments: '{"expr":"2+2"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 20,
    },
  };

  const anthropicResp = convertChatToAnthropicResponse(chatResp, "free-auto");
  assert.equal(anthropicResp.id, "msg_chatcmpl-anthropic-1");
  assert.equal(anthropicResp.type, "message");
  assert.equal(anthropicResp.role, "assistant");
  assert.equal(anthropicResp.model, "free-auto");
  assert.equal(anthropicResp.stop_reason, "tool_use");
  assert.deepEqual(anthropicResp.usage, {
    input_tokens: 15,
    output_tokens: 20,
  });

  const content = anthropicResp.content as Array<Record<string, unknown>>;
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: "text", text: "Here is your result." });
  assert.deepEqual(content[1], {
    type: "tool_use",
    id: "call_abc",
    name: "calculate",
    input: { expr: "2+2" },
  });
});

test("ChatToAnthropicStreamTransformer translates Chat SSE to Anthropic SSE event sequence", () => {
  const transformer = new ChatToAnthropicStreamTransformer("free-auto");
  const events: string[] = [];

  const chunks = [
    JSON.stringify({ id: "chatcmpl-stream-1", choices: [{ delta: { role: "assistant", content: "Hi" } }] }),
    JSON.stringify({ id: "chatcmpl-stream-1", choices: [{ delta: { content: " there!" } }] }),
    JSON.stringify({
      id: "chatcmpl-stream-1",
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_tool_1", type: "function", function: { name: "get_time", arguments: '{"tz":"' } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      id: "chatcmpl-stream-1",
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: 'UTC"}' } }],
          },
        },
      ],
    }),
    JSON.stringify({
      id: "chatcmpl-stream-1",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
    }),
    "[DONE]",
  ];

  for (const chunk of chunks) {
    events.push(...transformer.processDataPayload(chunk));
  }

  const rawText = events.join("");
  assert.ok(rawText.includes("event: message_start"));
  assert.ok(rawText.includes("event: content_block_start"));
  assert.ok(rawText.includes("event: content_block_delta"));
  assert.ok(rawText.includes("event: content_block_stop"));
  assert.ok(rawText.includes("event: message_delta"));
  assert.ok(rawText.includes("event: message_stop"));

  assert.ok(rawText.includes('"type":"text_delta"'));
  assert.ok(rawText.includes('"type":"input_json_delta"'));
  assert.ok(rawText.includes('"type":"tool_use"'));
  assert.ok(rawText.includes('"name":"get_time"'));
  assert.ok(rawText.includes('"stop_reason":"tool_use"'));
  assert.ok(rawText.includes('"output_tokens":12'));
});

test("ChatToAnthropicStreamTransformer relays mid-stream errors and skips the normal completion", () => {
  const transformer = new ChatToAnthropicStreamTransformer("free-auto");
  const events: string[] = [];
  events.push(
    ...transformer.processDataPayload(
      JSON.stringify({ id: "chatcmpl-9", choices: [{ delta: { role: "assistant", content: "so far" } }] }),
    ),
  );
  events.push(
    ...transformer.processDataPayload(JSON.stringify({ error: { code: "server_error", message: "mid-stream failure" } })),
  );
  // After the error, [DONE] and any further chunk must produce nothing.
  events.push(...transformer.processDataPayload("[DONE]"));
  events.push(
    ...transformer.processDataPayload(JSON.stringify({ id: "chatcmpl-9", choices: [{ delta: { content: "more" } }] })),
  );

  const rawText = events.join("");
  assert.ok(rawText.includes("event: error"), "the upstream error must be relayed as an Anthropic error event");
  assert.ok(rawText.includes("mid-stream failure"));
  assert.ok(rawText.includes('"code":"server_error"'));
  assert.ok(!rawText.includes("event: message_delta"), "no message_delta after a mid-stream error");
  assert.ok(!rawText.includes("event: message_stop"), "no message_stop after a mid-stream error");
  assert.ok(!rawText.includes('"stop_reason":"end_turn"'), "no finish stop_reason after a mid-stream error");
});
