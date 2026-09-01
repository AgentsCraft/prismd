/**
 * Anthropic Messages API <-> OpenAI Chat Completions bidirectional conversion.
 * Enables Claude Code CLI and Anthropic SDK clients to use prismd seamlessly.
 */

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AnthropicMessagePart {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicMessagePart[];
}

export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: string; text: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

/**
 * Convert Anthropic Messages request to OpenAI-compatible Chat Completions request.
 */
export function convertAnthropicToChatRequest(
  body: AnthropicRequestBody,
  model: string,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];

  // 1. System prompt
  if (typeof body.system === "string" && body.system.trim().length > 0) {
    messages.push({ role: "system", content: body.system });
  } else if (Array.isArray(body.system)) {
    const sysText = body.system
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n\n");
    if (sysText.length > 0) {
      messages.push({ role: "system", content: sysText });
    }
  }

  // 2. Messages
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || typeof msg !== "object") continue;

      if (typeof msg.content === "string") {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
        continue;
      }

      if (Array.isArray(msg.content)) {
        let textAccum = "";
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];

        for (const part of msg.content) {
          if (!part || typeof part !== "object") continue;

          // Text content part
          if (part.type === "text" && typeof part.text === "string") {
            textAccum += part.text;
            continue;
          }

          // Assistant tool use
          if (part.type === "tool_use" && typeof part.name === "string") {
            const callId = part.id || `call_${toolCalls.length}`;
            const argsStr =
              typeof part.input === "object" && part.input !== null
                ? JSON.stringify(part.input)
                : typeof part.input === "string"
                  ? part.input
                  : "{}";
            toolCalls.push({
              id: callId,
              type: "function",
              function: {
                name: part.name,
                arguments: argsStr,
              },
            });
            continue;
          }

          // User tool result
          if (part.type === "tool_result") {
            const callId = part.tool_use_id || part.id || "";
            let resultText = "";
            if (typeof part.content === "string") {
              resultText = part.content;
            } else if (Array.isArray(part.content)) {
              resultText = part.content
                .filter((p) => p && p.type === "text" && typeof p.text === "string")
                .map((p) => p.text as string)
                .join("\n");
            } else if (part.content !== undefined) {
              resultText = JSON.stringify(part.content);
            }
            messages.push({
              role: "tool",
              tool_call_id: callId,
              content: resultText,
            });
          }
        }

        if (msg.role === "assistant") {
          const assistantMsg: Record<string, unknown> = {
            role: "assistant",
            content: textAccum.length > 0 ? textAccum : null,
          };
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }
          if (assistantMsg.content !== null || toolCalls.length > 0) {
            messages.push(assistantMsg);
          }
        } else if (msg.role === "user" && textAccum.length > 0) {
          messages.push({
            role: "user",
            content: textAccum,
          });
        }
      }
    }
  }

  const chatRequest: Record<string, unknown> = {
    model,
    messages,
  };

  // Tools mapping: Anthropic input_schema -> OpenAI parameters
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    chatRequest.tools = body.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema ?? { type: "object", properties: {} },
      },
    }));
  }

  // Tool choice mapping
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const tc = body.tool_choice as Record<string, unknown>;
    if (tc.type === "auto") {
      chatRequest.tool_choice = "auto";
    } else if (tc.type === "any") {
      chatRequest.tool_choice = "required";
    } else if (tc.type === "tool" && typeof tc.name === "string") {
      chatRequest.tool_choice = {
        type: "function",
        function: { name: tc.name },
      };
    }
  } else if (typeof body.tool_choice === "string") {
    chatRequest.tool_choice = body.tool_choice;
  }

  if (typeof body.max_tokens === "number") {
    chatRequest.max_tokens = body.max_tokens;
  }
  if (typeof body.temperature === "number") {
    chatRequest.temperature = body.temperature;
  }
  if (typeof body.top_p === "number") {
    chatRequest.top_p = body.top_p;
  }

  if (body.stream === true) {
    chatRequest.stream = true;
    chatRequest.stream_options = { include_usage: true };
  }

  return chatRequest;
}

/**
 * Convert OpenAI Chat Completions JSON response to Anthropic Messages response.
 */
export function convertChatToAnthropicResponse(
  chatResponse: Record<string, unknown>,
  requestedModel: string,
): Record<string, unknown> {
  const rawId = typeof chatResponse.id === "string" ? chatResponse.id : `msg_${Date.now()}`;
  const id = rawId.startsWith("msg_") ? rawId : `msg_${rawId}`;
  const choices = Array.isArray(chatResponse.choices) ? chatResponse.choices : [];
  const firstChoice = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (firstChoice.message ?? {}) as Record<string, unknown>;
  const finishReason = firstChoice.finish_reason;

  const content: Array<Record<string, unknown>> = [];

  // Text content
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({
      type: "text",
      text: message.content,
    });
  }

  // Tool calls
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (!tc || typeof tc !== "object") continue;
      const toolCall = tc as Record<string, unknown>;
      const fn = (toolCall.function ?? {}) as Record<string, unknown>;
      const name = String(fn.name ?? "");
      let parsedInput: Record<string, unknown> = {};
      if (typeof fn.arguments === "string" && fn.arguments.trim().length > 0) {
        try {
          parsedInput = JSON.parse(fn.arguments);
        } catch {
          parsedInput = {};
        }
      } else if (typeof fn.arguments === "object" && fn.arguments !== null) {
        parsedInput = fn.arguments as Record<string, unknown>;
      }
      content.push({
        type: "tool_use",
        id: String(toolCall.id ?? `call_${content.length}`),
        name,
        input: parsedInput,
      });
    }
  }

  const rawUsage = (chatResponse.usage ?? {}) as Record<string, unknown>;
  const inputTokens = typeof rawUsage.prompt_tokens === "number" ? rawUsage.prompt_tokens : 0;
  const outputTokens = typeof rawUsage.completion_tokens === "number" ? rawUsage.completion_tokens : 0;

  const stopReason = finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";

  return {
    id,
    type: "message",
    role: "assistant",
    content,
    model: requestedModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

/**
 * State machine transforming Chat Completions SSE events to Anthropic Messages SSE events.
 */
export class ChatToAnthropicStreamTransformer {
  private messageId: string;
  private model: string;
  private startSent = false;
  private nextBlockIndex = 0;

  private textBlock = {
    started: false,
    index: 0,
    closed: false,
  };

  private toolBlocks = new Map<
    number,
    {
      blockIndex: number;
      callId: string;
      name: string;
      started: boolean;
      closed: boolean;
    }
  >();

  private usage = {
    inputTokens: 0,
    outputTokens: 0,
  };
  private finishReason = "end_turn";
  private allCompleted = false;

  constructor(defaultModel: string) {
    this.messageId = `msg_${Date.now()}`;
    this.model = defaultModel;
  }

  getUsage(): { inputTokens: number; outputTokens: number } {
    return { ...this.usage };
  }

  processDataPayload(payload: string): string[] {
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

    if (chunk.error && typeof chunk.error === "object") {
      return [this.formatEvent("error", { type: "error", error: chunk.error })];
    }

    const events: string[] = [];

    if (typeof chunk.id === "string") {
      this.messageId = chunk.id.startsWith("msg_") ? chunk.id : `msg_${chunk.id}`;
    }
    if (!this.model && typeof chunk.model === "string") this.model = chunk.model;

    if (chunk.usage && typeof chunk.usage === "object") {
      const u = chunk.usage as Record<string, unknown>;
      if (typeof u.prompt_tokens === "number") this.usage.inputTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") this.usage.outputTokens = u.completion_tokens;
    }

    // 1. message_start
    if (!this.startSent) {
      this.startSent = true;
      events.push(
        this.formatEvent("message_start", {
          type: "message_start",
          message: {
            id: this.messageId,
            type: "message",
            role: "assistant",
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: this.usage.inputTokens,
              output_tokens: 0,
            },
          },
        }),
      );
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length === 0) return events;

    const choice = (choices[0] ?? {}) as Record<string, unknown>;
    if (choice.finish_reason === "tool_calls") {
      this.finishReason = "tool_use";
    } else if (choice.finish_reason === "length") {
      this.finishReason = "max_tokens";
    }

    const delta = (choice.delta ?? {}) as Record<string, unknown>;

    // 2. Text delta
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!this.textBlock.started) {
        this.textBlock.started = true;
        this.textBlock.index = this.nextBlockIndex++;
        events.push(
          this.formatEvent("content_block_start", {
            type: "content_block_start",
            index: this.textBlock.index,
            content_block: {
              type: "text",
              text: "",
            },
          }),
        );
      }
      events.push(
        this.formatEvent("content_block_delta", {
          type: "content_block_delta",
          index: this.textBlock.index,
          delta: {
            type: "text_delta",
            text: delta.content,
          },
        }),
      );
    }

    // 3. Tool calls delta
    if (Array.isArray(delta.tool_calls)) {
      // Close text block if active
      if (this.textBlock.started && !this.textBlock.closed) {
        this.textBlock.closed = true;
        events.push(
          this.formatEvent("content_block_stop", {
            type: "content_block_stop",
            index: this.textBlock.index,
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

        let block = this.toolBlocks.get(tcIndex);
        if (!block) {
          const callId = idDelta || `call_${this.messageId}_${tcIndex}`;
          const bIdx = this.nextBlockIndex++;
          block = {
            blockIndex: bIdx,
            callId,
            name: nameDelta,
            started: true,
            closed: false,
          };
          this.toolBlocks.set(tcIndex, block);

          events.push(
            this.formatEvent("content_block_start", {
              type: "content_block_start",
              index: block.blockIndex,
              content_block: {
                type: "tool_use",
                id: block.callId,
                name: block.name,
                input: {},
              },
            }),
          );

          if (argsDelta.length > 0) {
            events.push(
              this.formatEvent("content_block_delta", {
                type: "content_block_delta",
                index: block.blockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: argsDelta,
                },
              }),
            );
          }
        } else {
          if (idDelta && !block.callId) block.callId = idDelta;
          if (nameDelta && !block.name) block.name = nameDelta;
          if (argsDelta.length > 0) {
            events.push(
              this.formatEvent("content_block_delta", {
                type: "content_block_delta",
                index: block.blockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: argsDelta,
                },
              }),
            );
          }
        }
      }
    }

    return events;
  }

  finish(): string[] {
    if (this.allCompleted) return [];
    this.allCompleted = true;

    const events: string[] = [];

    if (!this.startSent) {
      this.startSent = true;
      events.push(
        this.formatEvent("message_start", {
          type: "message_start",
          message: {
            id: this.messageId,
            type: "message",
            role: "assistant",
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: this.usage.inputTokens,
              output_tokens: 0,
            },
          },
        }),
      );
    }

    // Close text block
    if (this.textBlock.started && !this.textBlock.closed) {
      this.textBlock.closed = true;
      events.push(
        this.formatEvent("content_block_stop", {
          type: "content_block_stop",
          index: this.textBlock.index,
        }),
      );
    }

    // Close tool blocks
    for (const block of this.toolBlocks.values()) {
      if (!block.closed) {
        block.closed = true;
        events.push(
          this.formatEvent("content_block_stop", {
            type: "content_block_stop",
            index: block.blockIndex,
          }),
        );
      }
    }

    // message_delta
    events.push(
      this.formatEvent("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: this.finishReason,
          stop_sequence: null,
        },
        usage: {
          output_tokens: this.usage.outputTokens,
        },
      }),
    );

    // message_stop
    events.push(
      this.formatEvent("message_stop", {
        type: "message_stop",
      }),
    );

    return events;
  }

  private formatEvent(eventType: string, obj: Record<string, unknown>): string {
    return `event: ${eventType}\ndata: ${JSON.stringify(obj)}\n\n`;
  }
}
