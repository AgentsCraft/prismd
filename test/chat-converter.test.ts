import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertResponsesToChatRequest,
  convertChatToResponsesResponse,
  ChatToResponsesStreamTransformer,
} from "../src/egress/chat-converter.js";

test("convertResponsesToChatRequest handles simple string input", () => {
  const req = convertResponsesToChatRequest(
    { model: "dummy", input: "hello world" },
    "llama-3.3-70b",
  );
  assert.equal(req.model, "llama-3.3-70b");
  assert.deepEqual(req.messages, [{ role: "user", content: "hello world" }]);
});

test("convertResponsesToChatRequest converts top-level instructions into a system message", () => {
  const req = convertResponsesToChatRequest(
    {
      model: "dummy",
      instructions: "You are a coding assistant.",
      input: "Fix this bug",
    },
    "llama-3.3-70b",
  );
  assert.deepEqual(req.messages, [
    { role: "system", content: "You are a coding assistant." },
    { role: "user", content: "Fix this bug" },
  ]);
});

test("convertResponsesToChatRequest converts input items with messages, tools, and function calls", () => {
  const req = convertResponsesToChatRequest(
    {
      model: "dummy",
      input: [
        { role: "system", content: "sys prompt" },
        { role: "user", content: [{ type: "input_text", text: "what is the weather?" }] },
        {
          type: "function_call",
          call_id: "call_1",
          name: "get_weather",
          arguments: '{"city":"Tokyo"}',
        },
        {
          type: "function_call",
          call_id: "call_2",
          name: "get_time",
          arguments: '{"city":"Tokyo"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: '{"temp": 22}',
        },
        {
          role: "tool",
          tool_call_id: "call_2",
          content: '{"time": "12:00"}',
        },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get weather for city",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      tool_choice: "auto",
      max_output_tokens: 4096,
      stream: true,
      temperature: 0.7,
    },
    "llama-3.3-70b",
  );

  assert.equal(req.model, "llama-3.3-70b");
  assert.equal(req.max_tokens, 4096);
  assert.equal(req.stream, true);
  assert.deepEqual(req.stream_options, { include_usage: true });
  assert.equal(req.temperature, 0.7);
  assert.equal(req.tool_choice, "auto");

  assert.deepEqual(req.tools, [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for city",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ]);

  const messages = req.messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 5);
  assert.deepEqual(messages[0], { role: "system", content: "sys prompt" });
  assert.deepEqual(messages[1], { role: "user", content: "what is the weather?" });
  // Two consecutive function_calls merged into one assistant message with tool_calls
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, null);
  const toolCalls = messages[2].tool_calls as Array<Record<string, unknown>>;
  assert.equal(toolCalls.length, 2);
  assert.deepEqual(toolCalls[0], {
    id: "call_1",
    type: "function",
    function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
  });
  assert.deepEqual(toolCalls[1], {
    id: "call_2",
    type: "function",
    function: { name: "get_time", arguments: '{"city":"Tokyo"}' },
  });
  assert.deepEqual(messages[3], {
    role: "tool",
    tool_call_id: "call_1",
    content: '{"temp": 22}',
  });
  assert.deepEqual(messages[4], {
    role: "tool",
    tool_call_id: "call_2",
    content: '{"time": "12:00"}',
  });
});

test("convertResponsesToChatRequest formats tool_choice function name correctly", () => {
  const req = convertResponsesToChatRequest(
    {
      model: "dummy",
      input: "hi",
      tool_choice: { type: "function", name: "my_func" },
    },
    "llama-3.3-70b",
  );
  assert.deepEqual(req.tool_choice, {
    type: "function",
    function: { name: "my_func" },
  });
});

test("convertChatToResponsesResponse translates non-streaming response with text and tool calls", () => {
  const chatResp = {
    id: "chatcmpl-456",
    object: "chat.completion",
    created: 1788240000,
    model: "llama-3.3-70b",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Let me check that for you.",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "lookup",
                arguments: '{"query":"test"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    },
  };

  const resp = convertChatToResponsesResponse(chatResp, "free-auto");
  assert.equal(resp.id, "chatcmpl-456");
  assert.equal(resp.object, "response");
  assert.equal(resp.status, "completed");
  assert.equal(resp.model, "free-auto");
  assert.deepEqual(resp.usage, {
    input_tokens: 15,
    output_tokens: 25,
    total_tokens: 40,
  });

  const output = resp.output as Array<Record<string, unknown>>;
  assert.equal(output.length, 2);
  assert.equal(output[0].type, "message");
  assert.equal(output[0].role, "assistant");
  assert.deepEqual(output[0].content, [{ type: "output_text", text: "Let me check that for you." }]);

  assert.equal(output[1].type, "function_call");
  assert.equal(output[1].call_id, "call_abc");
  assert.equal(output[1].name, "lookup");
  assert.equal(output[1].arguments, '{"query":"test"}');
});

test("ChatToResponsesStreamTransformer translates streaming text delta into standard Responses SSE events", () => {
  const transformer = new ChatToResponsesStreamTransformer("free-auto");
  const events: string[] = [];

  const chunks = [
    JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { role: "assistant", content: "Hel" } }] }),
    JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "lo " } }] }),
    JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "world" } }] }),
    JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }),
    "[DONE]",
  ];

  for (const chunk of chunks) {
    events.push(...transformer.processDataPayload(chunk));
  }

  const parsed = events.map((e) => JSON.parse(e.replace(/^data:\s*/, "").trim()) as { type: string; [key: string]: unknown });

  // Event sequence: response.created -> response.output_item.added (message) -> response.content_part.added -> deltas -> text.done -> output_item.done -> response.completed
  const eventTypes = parsed.map((p) => p.type);
  assert.deepEqual(eventTypes, [
    "response.created",
    "response.output_item.added",
    "response.content_part.added",
    "response.text.delta",
    "response.text.delta",
    "response.text.delta",
    "response.text.done",
    "response.output_item.done",
    "response.completed",
  ]);

  const deltas = parsed.filter((p) => p.type === "response.text.delta").map((p) => p.delta);
  assert.deepEqual(deltas, ["Hel", "lo ", "world"]);

  const completed = parsed.find((p) => p.type === "response.completed")!;
  assert.deepEqual(completed.usage, {
    input_tokens: 5,
    output_tokens: 3,
    total_tokens: 8,
  });

  const usage = transformer.getUsage();
  assert.deepEqual(usage, { inputTokens: 5, outputTokens: 3 });
});

test("ChatToResponsesStreamTransformer translates streaming multiple tool calls into Responses SSE events", () => {
  const transformer = new ChatToResponsesStreamTransformer("free-auto");
  const events: string[] = [];

  const chunks = [
    JSON.stringify({
      id: "chatcmpl-tools",
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_tool1", type: "function", function: { name: "get_weather", arguments: "" } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      id: "chatcmpl-tools",
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"ci' } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      id: "chatcmpl-tools",
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'ty":"Paris"}' } },
              { index: 1, id: "call_tool2", type: "function", function: { name: "get_time", arguments: '{"tz":"UTC"}' } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      id: "chatcmpl-tools",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 20, completion_tokens: 18, total_tokens: 38 },
    }),
    "[DONE]",
  ];

  for (const chunk of chunks) {
    events.push(...transformer.processDataPayload(chunk));
  }

  const parsed = events.map((e) => JSON.parse(e.replace(/^data:\s*/, "").trim()) as { type: string; [key: string]: unknown });
  const eventTypes = parsed.map((p) => p.type);

  assert.ok(eventTypes.includes("response.created"));
  assert.ok(eventTypes.includes("response.function_call_arguments.delta"));
  assert.ok(eventTypes.includes("response.function_call_arguments.done"));
  assert.ok(eventTypes.includes("response.completed"));

  const completed = parsed.find((p) => p.type === "response.completed")!;
  const respObj = completed.response as { output: Array<{ type: string; name: string; arguments: string }> };
  assert.equal(respObj.output.length, 2);
  assert.equal(respObj.output[0].name, "get_weather");
  assert.equal(respObj.output[0].arguments, '{"city":"Paris"}');
  assert.equal(respObj.output[1].name, "get_time");
  assert.equal(respObj.output[1].arguments, '{"tz":"UTC"}');
});
