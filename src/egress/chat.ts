/**
 * Chat Completions egress: adapts Responses requests to Chat Completions upstream API
 * and translates Chat responses (JSON or SSE stream) back to Responses format.
 */
import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";
import { createRequest as cerebrasCreateRequest } from "../providers/cerebras.js";
import {
  convertResponsesToChatRequest,
  convertChatToResponsesResponse,
  ChatToResponsesStreamTransformer,
} from "./chat-converter.js";
import {
  UpstreamConnectError,
  parseRetryAfter,
  SseEventSplitter,
  dataPayloads,
  sseErrorEvent,
  type StreamAccounting,
  type UpstreamCallOptions,
  type UpstreamResult,
} from "./raw.js";

type RequestBuilder = (
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
) => UpstreamRequest;

const builders: Record<string, RequestBuilder> = {
  cerebras: cerebrasCreateRequest,
};

function defaultChatCreateRequest(
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
): UpstreamRequest {
  const chatBody = convertResponsesToChatRequest(body, body.model);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...provider.extraHeaders,
  };
  if (provider.auth?.type !== "none" && apiKey && apiKey !== "none") {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return {
    url: `${provider.baseUrl}/chat/completions`,
    headers,
    body: JSON.stringify(chatBody),
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function wrapChatStream(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
  model: string,
): Response {
  const reader = upstream.body!.getReader();
  const splitter = new SseEventSplitter();
  const transformer = new ChatToResponsesStreamTransformer(model);
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
    try {
      controller.enqueue(encoder.encode(sseErrorEvent(code, message)));
    } catch {
      /* controller already closed */
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

async function bufferAndConvertChatJson(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
  model: string,
): Promise<Response> {
  const text = await upstream.text();
  accounting.firstTokenMs = Date.now() - startedAtMs;
  options.onFirstToken?.(accounting.firstTokenMs);

  let responsesBodyStr = text;
  try {
    const chatJson = JSON.parse(text) as Record<string, unknown>;
    const responsesJson = convertChatToResponsesResponse(chatJson, model);
    responsesBodyStr = JSON.stringify(responsesJson);

    const usage = responsesJson.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      accounting.realUsage = {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      };
    }
  } catch {
    /* not JSON - pass text through */
  }

  accounting.outputChars = responsesBodyStr.length;
  options.onChunk?.(responsesBodyStr.length);

  return new Response(responsesBodyStr, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}

export async function callUpstream(
  providerName: string,
  provider: ProviderConfig,
  providerModelId: string,
  body: ResponsesRequestBody,
  apiKey: string,
  options: UpstreamCallOptions,
): Promise<UpstreamResult> {
  const builder = builders[providerName] ?? defaultChatCreateRequest;
  const request = builder(provider, { ...body, model: providerModelId }, apiKey);
  const startedAtMs = Date.now();

  const controller = new AbortController();
  const connectTimer =
    options.connectTimeoutMs > 0 ? setTimeout(() => controller.abort(), options.connectTimeoutMs) : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } catch (err) {
    const timeout =
      controller.signal.aborted ||
      (err as Error).name === "TimeoutError" ||
      (err as Error).name === "AbortError" ||
      ((err as Error).cause as Error | undefined)?.name === "TimeoutError";
    throw new UpstreamConnectError(`failed to reach provider "${providerName}": ${(err as Error).message}`, timeout);
  } finally {
    if (connectTimer) clearTimeout(connectTimer);
  }

  const retryAfterMs = parseRetryAfter(upstream.headers.get("retry-after"));
  if (upstream.status >= 400) {
    return { kind: "error", status: upstream.status, response: upstream, retryAfterMs };
  }

  const accounting: StreamAccounting = { firstTokenMs: 0, outputChars: 0, aborted: false };
  const wantsStream = body.stream === true;
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  if (wantsStream && isSse && upstream.body) {
    return {
      kind: "stream",
      response: wrapChatStream(upstream, accounting, options, startedAtMs, providerModelId),
      accounting,
      retryAfterMs,
    };
  }

  if (upstream.body === null) {
    return { kind: "json", response: upstream, accounting, retryAfterMs };
  }

  const response = await bufferAndConvertChatJson(upstream, accounting, options, startedAtMs, providerModelId);
  return { kind: "json", response, accounting, retryAfterMs };
}
