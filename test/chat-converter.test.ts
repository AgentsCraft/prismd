import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertResponsesToChatRequest,
  convertChatToResponsesResponse,
  ChatToResponsesStreamTransformer,
  convertChatToResponsesRequest,
  convertResponsesToChatResponse,
  ResponsesToChatStreamTransformer,
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

test("convertChatToResponsesRequest converts chat messages, tool calls, and tool outputs", () => {
  const chatBody = {
    model: "dummy",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "run tool" },
      {
        role: "assistant",
        content: "calling tool",
        tool_calls: [
          {
            id: "call_99",
            type: "function",
            function: {
              name: "calculator",
              arguments: '{"expr":"2+2"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_99",
        content: '{"result":4}',
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "calculator",
          description: "calc",
          parameters: { type: "object" },
        },
      },
    ],
    max_tokens: 2048,
    temperature: 0.5,
    stream: true,
  };

  const req = convertChatToResponsesRequest(chatBody, "openrouter/free-model");
  assert.equal(req.model, "openrouter/free-model");
  assert.equal(req.max_output_tokens, 2048);
  assert.equal(req.temperature, 0.5);
  assert.equal(req.stream, true);

  assert.deepEqual(req.tools, [
    {
      type: "function",
      name: "calculator",
      description: "calc",
      parameters: { type: "object" },
    },
  ]);

  const input = req.input as Array<Record<string, unknown>>;
  assert.equal(input.length, 5);
  assert.deepEqual(input[0], {
    type: "message",
    role: "system",
    content: [{ type: "input_text", text: "system prompt" }],
  });
  assert.deepEqual(input[1], {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "run tool" }],
  });
  assert.deepEqual(input[2], {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "calling tool" }],
  });
  assert.deepEqual(input[3], {
    type: "function_call",
    call_id: "call_99",
    name: "calculator",
    arguments: '{"expr":"2+2"}',
  });
  assert.deepEqual(input[4], {
    type: "function_call_output",
    call_id: "call_99",
    output: '{"result":4}',
  });
});

test("convertResponsesToChatResponse converts Responses JSON to Chat Completions format", () => {
  const respBody = {
    id: "resp_12345",
    created_at: 1788200000,
    model: "openrouter/free-model",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Here is your calculation:" }],
      },
      {
        type: "function_call",
        call_id: "call_calc",
        name: "calculator",
        arguments: '{"expr":"1+1"}',
      },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
    },
  };

  const chatResp = convertResponsesToChatResponse(respBody, "free-auto");
  assert.equal(chatResp.id, "chatcmpl-12345");
  assert.equal(chatResp.object, "chat.completion");
  assert.equal(chatResp.model, "free-auto");
  assert.deepEqual(chatResp.usage, {
    prompt_tokens: 12,
    completion_tokens: 8,
    total_tokens: 20,
  });

  const choices = chatResp.choices as Array<Record<string, unknown>>;
  assert.equal(choices.length, 1);
  assert.equal(choices[0].finish_reason, "tool_calls");
  const msg = choices[0].message as Record<string, unknown>;
  assert.equal(msg.role, "assistant");
  assert.equal(msg.content, "Here is your calculation:");
  assert.deepEqual(msg.tool_calls, [
    {
      id: "call_calc",
      type: "function",
      function: {
        name: "calculator",
        arguments: '{"expr":"1+1"}',
      },
    },
  ]);
});

test("ResponsesToChatStreamTransformer translates Responses SSE events into Chat SSE stream", () => {
  const transformer = new ResponsesToChatStreamTransformer("free-auto");
  const events: string[] = [];

  const chunks = [
    JSON.stringify({ type: "response.created", response: { id: "resp_str1", model: "openrouter/model" } }),
    JSON.stringify({ type: "response.output_text.delta", delta: "hello " }),
    JSON.stringify({ type: "response.output_text.delta", delta: "from responses" }),
    JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_str1",
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    }),
    "[DONE]",
  ];

  for (const c of chunks) {
    events.push(...transformer.processDataPayload(c));
  }

  const parsed = events
    .filter((e) => !e.includes("[DONE]"))
    .map((e) => JSON.parse(e.replace(/^data:\s*/, "").trim()) as { choices: Array<{ delta: { content?: string; role?: string }; finish_reason?: string | null }>; usage?: unknown });

  assert.ok(events[events.length - 1].includes("[DONE]"));
  assert.equal(parsed[0].choices[0].delta.role, "assistant");
  assert.equal(parsed[1].choices[0].delta.content, "hello ");
  assert.equal(parsed[2].choices[0].delta.content, "from responses");
  assert.equal(parsed[3].choices[0].finish_reason, "stop");
  assert.deepEqual(parsed[3].usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
});

test("ResponsesToChatStreamTransformer translates Responses SSE tool calls into Chat SSE stream", () => {
  const transformer = new ResponsesToChatStreamTransformer("free-auto");
  const events: string[] = [];

  const chunks = [
    JSON.stringify({
      type: "response.output_item.added",
      item: { id: "call_01", type: "function_call", name: "query_db" },
    }),
    JSON.stringify({
      type: "response.function_call_arguments.delta",
      call_id: "call_01",
      delta: '{"q":',
    }),
    JSON.stringify({
      type: "response.function_call_arguments.delta",
      call_id: "call_01",
      delta: '"select 1"}',
    }),
    JSON.stringify({
      type: "response.completed",
      response: {
        usage: { input_tokens: 5, output_tokens: 10 },
      },
    }),
    "[DONE]",
  ];

  for (const c of chunks) {
    events.push(...transformer.processDataPayload(c));
  }

  const parsed = events
    .filter((e) => !e.includes("[DONE]"))
    .map((e) => JSON.parse(e.replace(/^data:\s*/, "").trim()) as Record<string, unknown>);

  const finishChunk = parsed[parsed.length - 1] as { choices: Array<{ finish_reason: string }> };
  assert.equal(finishChunk.choices[0].finish_reason, "tool_calls");
});

/** Parse the data payload out of a (possibly named) SSE event string. */
function dataJson(event: string): Record<string, unknown> {
  const line = event.split("\n").find((l) => l.startsWith("data:"));
  assert.ok(line, `event must carry a data line: ${JSON.stringify(event)}`);
  return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
}

test("ResponsesToChatStreamTransformer converts upstream response.failed into a chat error event and suppresses completion", () => {
  const transformer = new ResponsesToChatStreamTransformer("free-auto");
  const events: string[] = [];
  events.push(
    ...transformer.processDataPayload(JSON.stringify({ type: "response.created", response: { id: "resp_x" } })),
  );
  events.push(
    ...transformer.processDataPayload(JSON.stringify({ type: "response.output_text.delta", delta: "partial" })),
  );
  events.push(
    ...transformer.processDataPayload(
      JSON.stringify({
        type: "response.failed",
        response: { id: "resp_x", error: { code: "server_error", message: "upstream blew up" } },
      }),
    ),
  );

  // The failure is relayed as a bare chat error data event (no event name, no [DONE]).
  const errorEvents = events.filter((e) => e.includes('"error"'));
  assert.equal(errorEvents.length, 1);
  const errorEvent = errorEvents[0];
  assert.ok(!errorEvent.startsWith("event:"), "chat error events carry no SSE event name");
  const parsed = dataJson(errorEvent) as { error: { message: string; type: string; code: string } };
  assert.equal(parsed.error.message, "upstream blew up");
  assert.equal(parsed.error.type, "upstream_error");
  assert.equal(parsed.error.code, "server_error");

  // No normal completion: no finish_reason chunk and no [DONE].
  assert.ok(!events.some((e) => e.includes('"finish_reason":"stop"')));
  assert.ok(!events.some((e) => e.includes('"finish_reason":"tool_calls"')));
  assert.ok(!events.some((e) => e.includes("[DONE]")));

  // After the failure, finish() and any later payload emit nothing.
  assert.deepEqual(transformer.finish(), []);
  assert.deepEqual(transformer.processDataPayload("[DONE]"), []);
  assert.deepEqual(transformer.processDataPayload(JSON.stringify({ type: "response.completed" })), []);
  assert.equal(transformer.completed, true);
});

test("ResponsesToChatStreamTransformer falls back when response.failed carries no error details", () => {
  const transformer = new ResponsesToChatStreamTransformer("free-auto");
  const events = transformer.processDataPayload(JSON.stringify({ type: "response.failed", response: {} }));
  assert.equal(events.length, 1);
  const parsed = dataJson(events[0]) as { error: { message: string; code: string } };
  assert.equal(parsed.error.message, "upstream response failed");
  assert.equal(parsed.error.code, "upstream_error");
});

test("ResponsesToChatStreamTransformer converts upstream error events into a chat error event", () => {
  const transformer = new ResponsesToChatStreamTransformer("free-auto");
  const events = transformer.processDataPayload(
    JSON.stringify({ type: "error", error: { code: "rate_limit", message: "slow down" } }),
  );
  // Error as the very first payload: only the error event, no role chunk.
  assert.equal(events.length, 1);
  const parsed = dataJson(events[0]) as { error: { message: string; code: string } };
  assert.equal(parsed.error.message, "slow down");
  assert.equal(parsed.error.code, "rate_limit");
  assert.deepEqual(transformer.finish(), []);
});

test("ChatToResponsesStreamTransformer converts an upstream chat error into response.failed and suppresses completion", () => {
  const transformer = new ChatToResponsesStreamTransformer("free-auto");
  const events: string[] = [];
  events.push(
    ...transformer.processDataPayload(
      JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { role: "assistant", content: "par" } }] }),
    ),
  );
  events.push(
    ...transformer.processDataPayload(JSON.stringify({ error: { code: "overloaded", message: "upstream overloaded" } })),
  );

  const failedEvents = events.filter((e) => e.includes("response.failed"));
  assert.equal(failedEvents.length, 1);
  const parsed = dataJson(failedEvents[0]) as {
    type: string;
    response: { error: { code: string; message: string } };
  };
  assert.equal(parsed.type, "response.failed");
  assert.equal(parsed.response.error.code, "overloaded");
  assert.equal(parsed.response.error.message, "upstream overloaded");

  // No normal completion after the failure.
  assert.ok(!events.some((e) => e.includes("response.completed")));
  assert.ok(!events.some((e) => e.includes("[DONE]")));
  assert.deepEqual(transformer.finish(), []);
  assert.deepEqual(transformer.processDataPayload("[DONE]"), []);
  assert.deepEqual(
    transformer.processDataPayload(JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "x" } }] })),
    [],
  );
  assert.equal(transformer.completed, true);
});

test("ChatToResponsesStreamTransformer falls back when the chat error has no details", () => {
  const transformer = new ChatToResponsesStreamTransformer("free-auto");
  const events = transformer.processDataPayload(JSON.stringify({ error: {} }));
  assert.equal(events.length, 1);
  const parsed = dataJson(events[0]) as { type: string; response: { error: { code: string; message: string } } };
  assert.equal(parsed.type, "response.failed");
  assert.equal(parsed.response.error.code, "upstream_error");
  assert.equal(parsed.response.error.message, "upstream response failed");
});
