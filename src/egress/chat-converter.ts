import type { ResponsesRequestBody } from "../types/protocol.js";

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

  /**
   * Process a single Chat SSE data payload (raw JSON string or '[DONE]').
   * Returns zero or more formatted Responses SSE event strings (each ending with \n\n).
   */
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
