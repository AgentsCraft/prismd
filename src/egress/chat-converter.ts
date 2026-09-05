import type { ResponsesRequestBody } from "../types/protocol.js";
import {
  SseEventSplitter,
  dataPayloads,
  sseErrorEvent,
  type StreamAccounting,
  type UpstreamCallOptions,
} from "./raw.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ChatMessage {
  role: string;
  content: string | null | Array<Record<string, unknown>>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Convert OpenAI Responses API request body to Chat Completions request body.
 */
export function convertResponsesToChatRequest(
  body: ResponsesRequestBody,
  model: string,
): Record<string, unknown> {
  const messages: ChatMessage[] = [];

  // Top-level instructions (system prompt in Responses)
  if (typeof body.instructions === "string" && body.instructions.trim().length > 0) {
    messages.push({
      role: "system",
      content: body.instructions,
    });
  }

  // Convert input
  if (typeof body.input === "string") {
    messages.push({
      role: "user",
      content: body.input,
    });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item || typeof item !== "object") continue;

      const raw = item as Record<string, unknown>;

      // 1. Function Call Output / Tool Response
      if (
        raw.type === "function_call_output" ||
        raw.type === "tool_response" ||
        raw.role === "tool"
      ) {
        const toolCallId = String(raw.call_id ?? raw.tool_call_id ?? raw.id ?? "");
        let content: string;
        if (typeof raw.output === "string") {
          content = raw.output;
        } else if (raw.output !== undefined) {
          content = JSON.stringify(raw.output);
        } else if (typeof raw.content === "string") {
          content = raw.content;
        } else if (raw.content !== undefined) {
          content = JSON.stringify(raw.content);
        } else {
          content = "";
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content,
        });
        continue;
      }

      // 2. Function Call (Assistant tool call)
      if (raw.type === "function_call") {
        const callId = String(raw.call_id ?? raw.id ?? `call_${messages.length}`);
        const name = String(raw.name ?? "");
        let args: string;
        if (typeof raw.arguments === "string") {
          args = raw.arguments;
        } else if (raw.arguments !== undefined) {
          args = JSON.stringify(raw.arguments);
        } else {
          args = "{}";
        }

        const toolCall = {
          id: callId,
          type: "function" as const,
          function: {
            name,
            arguments: args,
          },
        };

        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && Array.isArray(lastMsg.tool_calls) && lastMsg.content === null) {
          lastMsg.tool_calls.push(toolCall);
        } else {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          });
        }
        continue;
      }

      // 3. Standard message (role: user / assistant / system / developer)
      if (!raw.role && raw.type !== "message" && raw.content === undefined) {
        continue;
      }

      const role = String(raw.role ?? "user");
      let content: string | Array<Record<string, unknown>> = "";

      if (typeof raw.content === "string") {
        content = raw.content;
      } else if (Array.isArray(raw.content)) {
        const texts: string[] = [];
        let hasNonText = false;
        for (const part of raw.content) {
          if (part && typeof part === "object") {
            const p = part as Record<string, unknown>;
            if (
              (p.type === "input_text" || p.type === "text" || p.type === "output_text") &&
              typeof p.text === "string"
            ) {
              texts.push(p.text);
            } else {
              hasNonText = true;
            }
          }
        }
        if (!hasNonText) {
          content = texts.join("");
        } else {
          content = raw.content.map((p) => {
            if (p && typeof p === "object" && (p.type === "input_text" || p.type === "output_text")) {
              return { type: "text", text: p.text };
            }
            return p;
          });
        }
      } else if (raw.content !== undefined) {
        content = String(raw.content);
      }

      const msg: ChatMessage = {
        role: role === "developer" ? "developer" : role === "system" ? "system" : role === "assistant" ? "assistant" : "user",
        content,
      };
      if (typeof raw.name === "string") {
        msg.name = raw.name;
      }
      messages.push(msg);
    }
  }

  const chatRequest: Record<string, unknown> = {
    model,
    messages,
  };

  // Convert tools
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    chatRequest.tools = body.tools.map((t) => {
      if (!t || typeof t !== "object") return t;
      const tool = t as Record<string, unknown>;
      if (tool.function && typeof tool.function === "object") {
        return tool;
      }
      if (tool.type === "function" || typeof tool.name === "string") {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
          },
        };
      }
      return tool;
    });
  }

  // Convert tool_choice
  if (body.tool_choice !== undefined) {
    if (typeof body.tool_choice === "string") {
      chatRequest.tool_choice = body.tool_choice;
    } else if (typeof body.tool_choice === "object" && body.tool_choice !== null) {
      const tc = body.tool_choice as Record<string, unknown>;
      if (tc.type === "function" && tc.name && !tc.function) {
        chatRequest.tool_choice = {
          type: "function",
          function: { name: tc.name },
        };
      } else {
        chatRequest.tool_choice = body.tool_choice;
      }
    }
  }

  // Convert max_output_tokens -> max_tokens
  if (typeof body.max_output_tokens === "number") {
    chatRequest.max_tokens = body.max_output_tokens;
  } else if (typeof body.max_tokens === "number") {
    chatRequest.max_tokens = body.max_tokens;
  }

  // Stream options
  if (body.stream === true) {
    chatRequest.stream = true;
    chatRequest.stream_options = { include_usage: true };
  }

  // Passthrough standard parameters
  const passthroughKeys = [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop",
    "seed",
    "user",
    "response_format",
    "logit_bias",
    "n",
    "parallel_tool_calls",
  ];
  for (const key of passthroughKeys) {
    if (body[key] !== undefined) {
      chatRequest[key] = body[key];
    }
  }

  return chatRequest;
}

/**
 * Convert Chat Completions JSON response to Responses JSON response.
 */
export function convertChatToResponsesResponse(
  chatResponse: Record<string, unknown>,
  requestedModel: string,
): Record<string, unknown> {
  const id = typeof chatResponse.id === "string" ? chatResponse.id : `resp_${Date.now()}`;
  const createdAt =
    typeof chatResponse.created === "number" ? chatResponse.created : Math.floor(Date.now() / 1000);
  const choices = Array.isArray(chatResponse.choices) ? chatResponse.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;

  const output: Array<Record<string, unknown>> = [];

  if (message) {
    // 1. Text message item
    if (typeof message.content === "string" && message.content.length > 0) {
      output.push({
        id: `msg_${id}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: message.content,
          },
        ],
        status: "completed",
      });
    } else if (
      typeof message.content === "string" &&
      (!message.tool_calls || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0)
    ) {
      output.push({
        id: `msg_${id}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "",
          },
        ],
        status: "completed",
      });
    }

    // 2. Tool calls items
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (!tc || typeof tc !== "object") continue;
        const toolCall = tc as Record<string, unknown>;
        const fn = (toolCall.function ?? {}) as Record<string, unknown>;
        const callId = String(toolCall.id ?? `call_${output.length}`);
        const name = String(fn.name ?? "");
        const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
        output.push({
          id: callId,
          type: "function_call",
          call_id: callId,
          name,
          arguments: args,
          status: "completed",
        });
      }
    }
  }

  const rawUsage = (chatResponse.usage ?? {}) as Record<string, unknown>;
  const inputTokens = typeof rawUsage.prompt_tokens === "number" ? rawUsage.prompt_tokens : 0;
  const outputTokens = typeof rawUsage.completion_tokens === "number" ? rawUsage.completion_tokens : 0;
  const totalTokens =
    typeof rawUsage.total_tokens === "number" ? rawUsage.total_tokens : inputTokens + outputTokens;

  const usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };

  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model: requestedModel,
    output,
    usage,
  };
}

/**
 * State machine transforming Chat Completions SSE event payloads to Responses SSE events.
 */
export class ChatToResponsesStreamTransformer {
  private responseId: string;
  private model: string;
  private createdAt: number;
  private createdSent = false;

  private textState = {
    started: false,
    outputIndex: 0,
    accumulatedText: "",
    completed: false,
  };

  private toolCallsState = new Map<
    number,
    {
      index: number;
      callId: string;
      name: string;
      arguments: string;
      outputIndex: number;
      started: boolean;
      completed: boolean;
    }
  >();

  private nextOutputIndex = 0;
  private usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  private allCompleted = false;

  constructor(defaultModel: string) {
    this.responseId = `resp_${Date.now()}`;
    this.model = defaultModel;
    this.createdAt = Math.floor(Date.now() / 1000);
  }

  /** Get the current usage captured from stream chunks. */
  getUsage(): { inputTokens?: number; outputTokens?: number } | undefined {
    if (this.usage.inputTokens !== undefined || this.usage.outputTokens !== undefined) {
      return {
        inputTokens: this.usage.inputTokens,
        outputTokens: this.usage.outputTokens,
      };
    }
    return undefined;
  }

  /** True once the stream has been terminated (completed or errored). */
  get completed(): boolean {
    return this.allCompleted;
  }

  /**
   * Process a single Chat SSE data payload (raw JSON string or '[DONE]').
   * Returns zero or more formatted Responses SSE event strings (each ending with \n\n).
   */
  processDataPayload(payload: string): string[] {
    if (this.allCompleted) return [];
    const trimmed = payload.trim();
    if (trimmed === "[DONE]") {
      return this.finish();
    }
    if (trimmed === "" || trimmed.startsWith(":")) {
      return [];
    }

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    // Mid-stream upstream error (data: {"error":{...}}): translate into a
    // Responses response.failed event and suppress all normal completion.
    if (chunk.error && typeof chunk.error === "object") {
      const err = chunk.error as Record<string, unknown>;
      const message = typeof err.message === "string" && err.message.length > 0 ? err.message : "upstream response failed";
      const code = typeof err.code === "string" && err.code.length > 0 ? err.code : "upstream_error";
      this.allCompleted = true;
      return [sseErrorEvent(code, message, "responses")];
    }

    const events: string[] = [];

    // Capture chunk metadata
    if (typeof chunk.id === "string") this.responseId = chunk.id;
    if (typeof chunk.model === "string") this.model = chunk.model;
    if (typeof chunk.created === "number") this.createdAt = chunk.created;

    // Capture usage chunk (stream_options: { include_usage: true })
    if (chunk.usage && typeof chunk.usage === "object") {
      const u = chunk.usage as Record<string, unknown>;
      if (typeof u.prompt_tokens === "number") this.usage.inputTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") this.usage.outputTokens = u.completion_tokens;
      if (typeof u.total_tokens === "number") this.usage.totalTokens = u.total_tokens;
    }

    // 1. response.created on first event
    if (!this.createdSent) {
      this.createdSent = true;
      events.push(
        this.formatSse({
          type: "response.created",
          response: {
            id: this.responseId,
            object: "response",
            created_at: this.createdAt,
            status: "in_progress",
            model: this.model,
            output: [],
          },
        }),
      );
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length === 0) {
      return events;
    }

    const choice = choices[0] as Record<string, unknown> | undefined;
    if (!choice) return events;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return events;

    // 2. Text delta
    const textContent = typeof delta.content === "string" ? delta.content : undefined;
    if (textContent !== undefined && textContent.length > 0) {
      if (!this.textState.started) {
        this.textState.started = true;
        this.textState.outputIndex = this.nextOutputIndex++;
        events.push(
          this.formatSse({
            type: "response.output_item.added",
            output_index: this.textState.outputIndex,
            item: {
              id: `msg_${this.responseId}`,
              type: "message",
              role: "assistant",
              content: [],
              status: "in_progress",
            },
          }),
        );
        events.push(
          this.formatSse({
            type: "response.content_part.added",
            output_index: this.textState.outputIndex,
            content_index: 0,
            part: {
              type: "output_text",
              text: "",
            },
          }),
        );
      }

      this.textState.accumulatedText += textContent;
      events.push(
        this.formatSse({
          type: "response.text.delta",
          output_index: this.textState.outputIndex,
          content_index: 0,
          delta: textContent,
        }),
      );
    }

    // 3. Tool calls delta
    if (Array.isArray(delta.tool_calls)) {
      // If text was running and tool calls start, finalize text item
      if (this.textState.started && !this.textState.completed) {
        this.textState.completed = true;
        events.push(
          this.formatSse({
            type: "response.text.done",
            output_index: this.textState.outputIndex,
            content_index: 0,
            text: this.textState.accumulatedText,
          }),
        );
        events.push(
          this.formatSse({
            type: "response.output_item.done",
            output_index: this.textState.outputIndex,
            item: {
              id: `msg_${this.responseId}`,
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: this.textState.accumulatedText,
                },
              ],
              status: "completed",
            },
          }),
        );
      }

      for (const tc of delta.tool_calls) {
        if (!tc || typeof tc !== "object") continue;
        const toolCall = tc as Record<string, unknown>;
        const tcIndex = typeof toolCall.index === "number" ? toolCall.index : 0;
        const fn = (toolCall.function ?? {}) as Record<string, unknown>;
        const argsDelta = typeof fn.arguments === "string" ? fn.arguments : "";
        const nameDelta = typeof fn.name === "string" ? fn.name : "";
        const idDelta = typeof toolCall.id === "string" ? toolCall.id : undefined;

        let tcState = this.toolCallsState.get(tcIndex);
        if (!tcState) {
          const callId = idDelta || `call_${this.responseId}_${tcIndex}`;
          const outIdx = this.nextOutputIndex++;
          tcState = {
            index: tcIndex,
            callId,
            name: nameDelta,
            arguments: argsDelta,
            outputIndex: outIdx,
            started: true,
            completed: false,
          };
          this.toolCallsState.set(tcIndex, tcState);

          events.push(
            this.formatSse({
              type: "response.output_item.added",
              output_index: tcState.outputIndex,
              item: {
                id: tcState.callId,
                type: "function_call",
                call_id: tcState.callId,
                name: tcState.name,
                arguments: "",
                status: "in_progress",
              },
            }),
          );

          if (argsDelta.length > 0) {
            events.push(
              this.formatSse({
                type: "response.function_call_arguments.delta",
                output_index: tcState.outputIndex,
                call_id: tcState.callId,
                delta: argsDelta,
              }),
            );
          }
        } else {
          if (idDelta && !tcState.callId) tcState.callId = idDelta;
          if (nameDelta && !tcState.name) tcState.name = nameDelta;
          if (argsDelta.length > 0) {
            tcState.arguments += argsDelta;
            events.push(
              this.formatSse({
                type: "response.function_call_arguments.delta",
                output_index: tcState.outputIndex,
                call_id: tcState.callId,
                delta: argsDelta,
              }),
            );
          }
        }
      }
    }

    return events;
  }

  /** Finish the stream and emit all completion events. Idempotent. */
  finish(): string[] {
    if (this.allCompleted) return [];
    this.allCompleted = true;

    const events: string[] = [];

    // Ensure response.created was emitted
    if (!this.createdSent) {
      this.createdSent = true;
      events.push(
        this.formatSse({
          type: "response.created",
          response: {
            id: this.responseId,
            object: "response",
            created_at: this.createdAt,
            status: "in_progress",
            model: this.model,
            output: [],
          },
        }),
      );
    }

    const outputItems: Array<Record<string, unknown>> = [];

    // Finalize text if started
    if (this.textState.started) {
      if (!this.textState.completed) {
        this.textState.completed = true;
        events.push(
          this.formatSse({
            type: "response.text.done",
            output_index: this.textState.outputIndex,
            content_index: 0,
            text: this.textState.accumulatedText,
          }),
        );
        events.push(
          this.formatSse({
            type: "response.output_item.done",
            output_index: this.textState.outputIndex,
            item: {
              id: `msg_${this.responseId}`,
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: this.textState.accumulatedText,
                },
              ],
              status: "completed",
            },
          }),
        );
      }
      outputItems.push({
        id: `msg_${this.responseId}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: this.textState.accumulatedText,
          },
        ],
        status: "completed",
      });
    }

    // Finalize tool calls in index order
    const sortedToolCalls = Array.from(this.toolCallsState.values()).sort(
      (a, b) => a.outputIndex - b.outputIndex,
    );
    for (const tcState of sortedToolCalls) {
      if (!tcState.completed) {
        tcState.completed = true;
        events.push(
          this.formatSse({
            type: "response.function_call_arguments.done",
            output_index: tcState.outputIndex,
            call_id: tcState.callId,
            arguments: tcState.arguments,
          }),
        );
        events.push(
          this.formatSse({
            type: "response.output_item.done",
            output_index: tcState.outputIndex,
            item: {
              id: tcState.callId,
              type: "function_call",
              call_id: tcState.callId,
              name: tcState.name,
              arguments: tcState.arguments,
              status: "completed",
            },
          }),
        );
      }
      outputItems.push({
        id: tcState.callId,
        type: "function_call",
        call_id: tcState.callId,
        name: tcState.name,
        arguments: tcState.arguments,
        status: "completed",
      });
    }

    const inputTokens = this.usage.inputTokens ?? 0;
    const outputTokens = this.usage.outputTokens ?? 0;
    const totalTokens = this.usage.totalTokens ?? inputTokens + outputTokens;

    const usageObj = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    };

    // Emit response.completed
    events.push(
      this.formatSse({
        type: "response.completed",
        response: {
          id: this.responseId,
          object: "response",
          created_at: this.createdAt,
          status: "completed",
          model: this.model,
          output: outputItems,
          usage: usageObj,
        },
        usage: usageObj,
      }),
    );

    return events;
  }

  private formatSse(obj: Record<string, unknown>): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }
}

/**
 * Convert Chat Completions request body to OpenAI Responses request body.
 */
export function convertChatToResponsesRequest(
  chatBody: Record<string, unknown>,
  model: string,
): ResponsesRequestBody {
  const input: Array<Record<string, unknown>> = [];
  const rawMessages = Array.isArray(chatBody.messages) ? chatBody.messages : [];

  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const role = String(msg.role ?? "user");

    // 1. Tool response message (role: "tool")
    if (role === "tool") {
      const callId = String(msg.tool_call_id ?? msg.id ?? "");
      let output: unknown = msg.content ?? "";
      if (typeof output !== "string") {
        output = JSON.stringify(output);
      }
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: output as string,
      });
      continue;
    }

    // 2. Assistant message with tool calls
    if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: msg.content }],
        });
      }
      for (const tc of msg.tool_calls) {
        if (!tc || typeof tc !== "object") continue;
        const toolCall = tc as Record<string, unknown>;
        const fn = (toolCall.function ?? {}) as Record<string, unknown>;
        const callId = String(toolCall.id ?? "");
        const name = String(fn.name ?? "");
        const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: args,
        });
      }
      continue;
    }

    // 3. Standard message (system, user, assistant, developer)
    if (typeof msg.content === "string") {
      input.push({
        type: "message",
        role: role === "developer" ? "developer" : role === "system" ? "system" : role === "assistant" ? "assistant" : "user",
        content: [{ type: role === "assistant" ? "output_text" : "input_text", text: msg.content }],
      });
    } else if (Array.isArray(msg.content)) {
      input.push({
        type: "message",
        role: role === "developer" ? "developer" : role === "system" ? "system" : role === "assistant" ? "assistant" : "user",
        content: msg.content,
      });
    } else {
      input.push({
        type: "message",
        role,
        content: [{ type: role === "assistant" ? "output_text" : "input_text", text: "" }],
      });
    }
  }

  const responsesRequest: ResponsesRequestBody = {
    model,
    input,
  };

  // Convert tools
  if (Array.isArray(chatBody.tools) && chatBody.tools.length > 0) {
    responsesRequest.tools = chatBody.tools.map((t) => {
      if (!t || typeof t !== "object") return t;
      const tool = t as Record<string, unknown>;
      if (tool.function && typeof tool.function === "object") {
        const fn = tool.function as Record<string, unknown>;
        return {
          type: "function",
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
          ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
        };
      }
      return tool;
    });
  }

  // Convert tool_choice
  if (chatBody.tool_choice !== undefined) {
    responsesRequest.tool_choice = chatBody.tool_choice;
  }

  // Convert max_tokens -> max_output_tokens
  if (typeof chatBody.max_tokens === "number") {
    responsesRequest.max_output_tokens = chatBody.max_tokens;
  } else if (typeof chatBody.max_output_tokens === "number") {
    responsesRequest.max_output_tokens = chatBody.max_output_tokens;
  }

  if (chatBody.stream === true) {
    responsesRequest.stream = true;
  }

  const passthroughKeys = [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop",
    "seed",
    "user",
  ];
  for (const key of passthroughKeys) {
    if (chatBody[key] !== undefined) {
      responsesRequest[key] = chatBody[key];
    }
  }

  return responsesRequest;
}

/**
 * Convert OpenAI Responses JSON response to Chat Completions JSON response.
 */
export function convertResponsesToChatResponse(
  responsesResponse: Record<string, unknown>,
  requestedModel: string,
): Record<string, unknown> {
  const id = typeof responsesResponse.id === "string" ? responsesResponse.id : `resp_${Date.now()}`;
  const chatId = id.startsWith("resp_")
    ? `chatcmpl-${id.slice(5)}`
    : id.startsWith("chatcmpl-")
      ? id
      : `chatcmpl-${id}`;
  const createdAt =
    typeof responsesResponse.created_at === "number"
      ? responsesResponse.created_at
      : typeof responsesResponse.created === "number"
        ? responsesResponse.created
        : Math.floor(Date.now() / 1000);

  const outputs = Array.isArray(responsesResponse.output) ? responsesResponse.output : [];
  let content = "";
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }> = [];

  for (const item of outputs) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (raw.type === "message" || raw.role === "assistant") {
      if (typeof raw.content === "string") {
        content += raw.content;
      } else if (Array.isArray(raw.content)) {
        for (const part of raw.content) {
          if (part && typeof part === "object") {
            const p = part as Record<string, unknown>;
            if (typeof p.text === "string") {
              content += p.text;
            }
          }
        }
      }
    } else if (raw.type === "function_call") {
      const callId = String(raw.call_id ?? raw.id ?? `call_${toolCalls.length}`);
      const name = String(raw.name ?? "");
      const args =
        typeof raw.arguments === "string" ? raw.arguments : JSON.stringify(raw.arguments ?? {});
      toolCalls.push({
        id: callId,
        type: "function",
        function: {
          name,
          arguments: args,
        },
      });
    }
  }

  const rawUsage = (responsesResponse.usage ?? {}) as Record<string, unknown>;
  const promptTokens =
    typeof rawUsage.input_tokens === "number"
      ? rawUsage.input_tokens
      : typeof rawUsage.prompt_tokens === "number"
        ? rawUsage.prompt_tokens
        : 0;
  const completionTokens =
    typeof rawUsage.output_tokens === "number"
      ? rawUsage.output_tokens
      : typeof rawUsage.completion_tokens === "number"
        ? rawUsage.completion_tokens
        : 0;
  const totalTokens =
    typeof rawUsage.total_tokens === "number"
      ? rawUsage.total_tokens
      : promptTokens + completionTokens;

  const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";

  return {
    id: chatId,
    object: "chat.completion",
    created: createdAt,
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: toolCalls.length > 0 && content.length === 0 ? null : content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}

/**
 * State machine transforming Responses SSE event payloads to Chat Completions SSE events.
 */
export class ResponsesToChatStreamTransformer {
  private chatId: string;
  private model: string;
  private createdAt: number;
  private roleSent = false;
  private toolCallIndexMap = new Map<string, number>();
  private nextToolCallIndex = 0;
  private hasToolCalls = false;
  private allCompleted = false;
  private usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};

  constructor(defaultModel: string) {
    const rawId = `resp_${Date.now()}`;
    this.chatId = `chatcmpl-${rawId.slice(5)}`;
    this.model = defaultModel;
    this.createdAt = Math.floor(Date.now() / 1000);
  }

  getUsage(): { inputTokens?: number; outputTokens?: number } | undefined {
    if (this.usage.inputTokens !== undefined || this.usage.outputTokens !== undefined) {
      return {
        inputTokens: this.usage.inputTokens,
        outputTokens: this.usage.outputTokens,
      };
    }
    return undefined;
  }

  /** True once the stream has been terminated (completed or errored). */
  get completed(): boolean {
    return this.allCompleted;
  }

  processDataPayload(payload: string): string[] {
    if (this.allCompleted) return [];
    const trimmed = payload.trim();
    if (trimmed === "[DONE]") {
      return this.finish();
    }
    if (trimmed === "" || trimmed.startsWith(":")) {
      return [];
    }

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    const type = String(chunk.type ?? "");

    // Mid-stream upstream failure (response.failed, or an error event relayed
    // by the upstream): translate into a chat-shaped error data event and
    // suppress all normal completion.
    if (type === "response.failed" || type === "error") {
      const source = (
        type === "response.failed"
          ? (chunk.response as Record<string, unknown> | undefined)?.error
          : chunk.error
      ) as Record<string, unknown> | undefined;
      const message =
        typeof source?.message === "string" && source.message.length > 0
          ? source.message
          : "upstream response failed";
      const code = typeof source?.code === "string" && source.code.length > 0 ? source.code : "upstream_error";
      this.allCompleted = true;
      return [sseErrorEvent(code, message, "chat")];
    }

    const events: string[] = [];

    // Capture IDs
    if (typeof chunk.id === "string") {
      this.chatId = chunk.id.startsWith("resp_")
        ? `chatcmpl-${chunk.id.slice(5)}`
        : chunk.id.startsWith("chatcmpl-")
          ? chunk.id
          : `chatcmpl-${chunk.id}`;
    }
    if (typeof chunk.model === "string") {
      this.model = chunk.model;
    }
    if (typeof chunk.created_at === "number") {
      this.createdAt = chunk.created_at;
    }

    // Capture response object if nested
    const responseObj =
      chunk.response && typeof chunk.response === "object"
        ? (chunk.response as Record<string, unknown>)
        : undefined;

    if (responseObj) {
      if (typeof responseObj.id === "string") {
        this.chatId = responseObj.id.startsWith("resp_")
          ? `chatcmpl-${responseObj.id.slice(5)}`
          : responseObj.id.startsWith("chatcmpl-")
            ? responseObj.id
            : `chatcmpl-${responseObj.id}`;
      }
      if (typeof responseObj.model === "string") {
        this.model = responseObj.model;
      }
      if (responseObj.usage && typeof responseObj.usage === "object") {
        const u = responseObj.usage as Record<string, unknown>;
        if (typeof u.input_tokens === "number") this.usage.inputTokens = u.input_tokens;
        if (typeof u.output_tokens === "number") this.usage.outputTokens = u.output_tokens;
      }
    }

    if (chunk.usage && typeof chunk.usage === "object") {
      const u = chunk.usage as Record<string, unknown>;
      if (typeof u.input_tokens === "number") this.usage.inputTokens = u.input_tokens;
      if (typeof u.output_tokens === "number") this.usage.outputTokens = u.output_tokens;
      if (typeof u.prompt_tokens === "number") this.usage.inputTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") this.usage.outputTokens = u.completion_tokens;
    }

    // 1. Initial role event
    if (!this.roleSent) {
      this.roleSent = true;
      events.push(
        this.formatSse({
          id: this.chatId,
          object: "chat.completion.chunk",
          created: this.createdAt,
          model: this.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        }),
      );
    }

    // 2. Text delta
    if (type === "response.text.delta" || type === "response.output_text.delta") {
      const delta = typeof chunk.delta === "string" ? chunk.delta : "";
      if (delta.length > 0) {
        events.push(
          this.formatSse({
            id: this.chatId,
            object: "chat.completion.chunk",
            created: this.createdAt,
            model: this.model,
            choices: [
              {
                index: 0,
                delta: { content: delta },
                finish_reason: null,
              },
            ],
          }),
        );
      }
    }

    // 3. Tool call added
    if (type === "response.output_item.added") {
      const item =
        chunk.item && typeof chunk.item === "object"
          ? (chunk.item as Record<string, unknown>)
          : undefined;
      if (item && item.type === "function_call") {
        this.hasToolCalls = true;
        const callId = String(item.call_id ?? item.id ?? `call_${this.nextToolCallIndex}`);
        const name = String(item.name ?? "");
        const tcIndex = this.nextToolCallIndex++;
        this.toolCallIndexMap.set(callId, tcIndex);

        events.push(
          this.formatSse({
            id: this.chatId,
            object: "chat.completion.chunk",
            created: this.createdAt,
            model: this.model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: tcIndex,
                      id: callId,
                      type: "function",
                      function: {
                        name,
                        arguments: "",
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
      }
    }

    // 4. Function call arguments delta
    if (type === "response.function_call_arguments.delta") {
      this.hasToolCalls = true;
      const callId = String(chunk.call_id ?? "");
      let tcIndex = this.toolCallIndexMap.get(callId);
      if (tcIndex === undefined) {
        tcIndex = this.nextToolCallIndex++;
        this.toolCallIndexMap.set(callId, tcIndex);
      }
      const delta = typeof chunk.delta === "string" ? chunk.delta : "";
      if (delta.length > 0) {
        events.push(
          this.formatSse({
            id: this.chatId,
            object: "chat.completion.chunk",
            created: this.createdAt,
            model: this.model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: tcIndex,
                      function: {
                        arguments: delta,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
      }
    }

    // 5. Completed
    if (type === "response.completed") {
      return [...events, ...this.finish()];
    }

    return events;
  }

  finish(): string[] {
    if (this.allCompleted) return [];
    this.allCompleted = true;

    const events: string[] = [];
    if (!this.roleSent) {
      this.roleSent = true;
      events.push(
        this.formatSse({
          id: this.chatId,
          object: "chat.completion.chunk",
          created: this.createdAt,
          model: this.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        }),
      );
    }

    const finishReason = this.hasToolCalls ? "tool_calls" : "stop";
    const chunkObj: Record<string, unknown> = {
      id: this.chatId,
      object: "chat.completion.chunk",
      created: this.createdAt,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    };

    if (this.usage.inputTokens !== undefined || this.usage.outputTokens !== undefined) {
      chunkObj.usage = {
        prompt_tokens: this.usage.inputTokens ?? 0,
        completion_tokens: this.usage.outputTokens ?? 0,
        total_tokens: (this.usage.inputTokens ?? 0) + (this.usage.outputTokens ?? 0),
      };
    }

    events.push(this.formatSse(chunkObj));
    events.push("data: [DONE]\n\n");
    return events;
  }

  private formatSse(obj: Record<string, unknown>): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }
}

export function wrapResponsesStreamToChat(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
  model: string,
): Response {
  const reader = upstream.body!.getReader();
  const splitter = new SseEventSplitter();
  const transformer = new ResponsesToChatStreamTransformer(model);
  let idleTimer: NodeJS.Timeout | undefined;
  let firstTokenSent = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller);
    },
    cancel() {
      clearIdle();
      reader.cancel().catch(() => {});
    },
  });

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function abort(controller: ReadableStreamDefaultController<Uint8Array>, code: string, message: string): void {
    clearIdle();
    accounting.aborted = true;
    // This wrapper's output is a Chat Completions SSE stream, so the injected
    // error must use the chat shape (bare error data event). Skip if the
    // transformer already emitted an error or completion of its own.
    if (!transformer.completed) {
      try {
        controller.enqueue(encoder.encode(sseErrorEvent(code, message, "chat")));
      } catch {
        /* controller already closed */
      }
    }
    try {
      controller.close();
    } catch {
      /* controller already closed */
    }
    reader.cancel().catch(() => {});
  }

  function resetIdle(controller: ReadableStreamDefaultController<Uint8Array>): void {
    clearIdle();
    if (options.streamIdleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        abort(controller, "stream_idle_timeout", `no upstream data for ${options.streamIdleTimeoutMs}ms`);
      }, options.streamIdleTimeoutMs);
    }
  }

  function emitConvertedEvents(controller: ReadableStreamDefaultController<Uint8Array>, events: string[]): void {
    for (const eventStr of events) {
      if (!firstTokenSent) {
        firstTokenSent = true;
        accounting.firstTokenMs = Date.now() - startedAtMs;
        options.onFirstToken?.(accounting.firstTokenMs);
      }
      const bytes = encoder.encode(eventStr);
      options.onChunk?.(bytes.byteLength);

      for (const payload of dataPayloads(eventStr.trim())) {
        accounting.outputChars += payload.length;
      }

      controller.enqueue(bytes);
    }
    const usage = transformer.getUsage();
    if (usage) {
      accounting.realUsage = usage;
    }
  }

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      resetIdle(controller);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        resetIdle(controller);
        const text = decoder.decode(value, { stream: true });
        for (const eventBlock of splitter.push(text)) {
          for (const payload of dataPayloads(eventBlock)) {
            const convertedEvents = transformer.processDataPayload(payload);
            emitConvertedEvents(controller, convertedEvents);
          }
        }
      }

      const rest = splitter.end();
      for (const eventBlock of rest) {
        for (const payload of dataPayloads(eventBlock)) {
          const convertedEvents = transformer.processDataPayload(payload);
          emitConvertedEvents(controller, convertedEvents);
        }
      }

      const finishEvents = transformer.finish();
      emitConvertedEvents(controller, finishEvents);

      clearIdle();
      controller.close();
    } catch (err) {
      abort(controller, "stream_error", `upstream stream interrupted: ${(err as Error).message}`);
    }
  }

  return new Response(stream, {
    status: upstream.status,
    headers: { "content-type": "text/event-stream" },
  });
}

export async function bufferAndConvertResponsesJson(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
  model: string,
): Promise<Response> {
  const text = await upstream.text();
  accounting.firstTokenMs = Date.now() - startedAtMs;
  options.onFirstToken?.(accounting.firstTokenMs);

  let chatBodyStr = text;
  try {
    const responsesJson = JSON.parse(text) as Record<string, unknown>;
    const chatJson = convertResponsesToChatResponse(responsesJson, model);
    chatBodyStr = JSON.stringify(chatJson);

    const usage = chatJson.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      accounting.realUsage = {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
      };
    }
  } catch {
    /* not JSON - pass text through */
  }

  accounting.outputChars = chatBodyStr.length;
  options.onChunk?.(chatBodyStr.length);

  return new Response(chatBodyStr, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
