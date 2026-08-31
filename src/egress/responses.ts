/**
 * Responses egress: builds the upstream request per provider and calls it
 * with a connect timeout. Successful responses come back ready to relay:
 * non-streaming bodies are buffered (small JSON — needed for usage
 * capture), streaming bodies are wrapped in a ReadableStream that applies
 * the stream-idle timeout and captures output chars + real usage from SSE
 * events. Failures return the raw upstream Response untouched so the
 * ingress can decide between failover and passthrough.
 */
import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";
import { createRequest as openrouterCreateRequest } from "../providers/openrouter.js";
import { createRequest as groqCreateRequest } from "../providers/groq.js";

type RequestBuilder = (
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
) => UpstreamRequest;

/** Every provider with type=responses needs a builder; keyed by provider name. */
const builders: Record<string, RequestBuilder> = {
  openrouter: openrouterCreateRequest,
  groq: groqCreateRequest,
};

/** Connection failure or connect-timeout while reaching the upstream. */
export class UpstreamConnectError extends Error {
  readonly timeout: boolean;

  constructor(message: string, timeout: boolean) {
    super(message);
    this.name = "UpstreamConnectError";
    this.timeout = timeout;
  }
}

/** Mutable per-attempt accounting, filled while the body streams. */
export interface StreamAccounting {
  /** Ms from request start to first body chunk (0 before first chunk). */
  firstTokenMs: number;
  /** Accumulated SSE `data:` payload characters (output estimate input). */
  outputChars: number;
  /** Real usage reported by the upstream (response.completed / JSON body). */
  realUsage?: { inputTokens?: number; outputTokens?: number };
  /** True when the stream ended abnormally (idle timeout or mid-stream error). */
  aborted: boolean;
}

export interface UpstreamCallOptions {
  connectTimeoutMs: number;
  streamIdleTimeoutMs: number;
  /** Called once when the first body chunk arrives (first-token latency). */
  onFirstToken?: (latencyMs: number) => void;
  /** Called per relayed chunk (bytes), for exporter.onChunk. */
  onChunk?: (bytes: number) => void;
}

export type UpstreamResult =
  | { kind: "stream"; response: Response; accounting: StreamAccounting; retryAfterMs?: number }
  | { kind: "json"; response: Response; accounting: StreamAccounting; retryAfterMs?: number }
  | { kind: "error"; status: number; response: Response; retryAfterMs?: number };

/** Split a char stream into complete SSE event blocks ("\n\n" separated). */
class SseEventSplitter {
  private buffer = "";

  push(text: string): string[] {
    this.buffer += text;
    const events: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      events.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 2);
    }
    return events;
  }

  end(): string[] {
    if (this.buffer === "") return [];
    const rest = this.buffer;
    this.buffer = "";
    return [rest];
  }
}

function dataPayloads(event: string): string[] {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
}

/** Try to find usage inside an SSE event payload (response.completed). */
function usageFromPayload(payload: string): { inputTokens?: number; outputTokens?: number } | undefined {
  let obj: { type?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  try {
    obj = JSON.parse(payload) as typeof obj;
  } catch {
    return undefined;
  }
  if (obj?.type === "response.completed" && obj.usage) {
    return {
      inputTokens: typeof obj.usage.input_tokens === "number" ? obj.usage.input_tokens : undefined,
      outputTokens: typeof obj.usage.output_tokens === "number" ? obj.usage.output_tokens : undefined,
    };
  }
  return undefined;
}

/** OpenAI-style SSE error event terminating a broken stream. */
function sseErrorEvent(code: string, message: string): string {
  return `data: ${JSON.stringify({ type: "error", error: { message, type: "upstream_error", code } })}\n\n`;
}

const encoder = new TextEncoder();

/** Wrap an upstream SSE body with idle-timeout + accounting; abort ends the stream. */
function wrapStream(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
): Response {
  const reader = upstream.body!.getReader();
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const splitter = new SseEventSplitter();
  let idleTimer: NodeJS.Timeout | undefined;

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
    if (isSse) {
      try {
        controller.enqueue(encoder.encode(sseErrorEvent(code, message)));
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
        abort(controller, "stream_idle_timeout", `no SSE events for ${options.streamIdleTimeoutMs}ms`);
      }, options.streamIdleTimeoutMs);
    }
  }

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      // Idle timeout also covers the wait for the first event.
      resetIdle(controller);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (accounting.firstTokenMs === 0) {
          accounting.firstTokenMs = Date.now() - startedAtMs;
          options.onFirstToken?.(accounting.firstTokenMs);
        }
        options.onChunk?.(value.byteLength);
        if (isSse) {
          const text = new TextDecoder().decode(value);
          for (const event of splitter.push(text)) {
            for (const payload of dataPayloads(event)) {
              accounting.outputChars += payload.length;
              accounting.realUsage ??= usageFromPayload(payload);
            }
          }
        } else {
          accounting.outputChars += value.byteLength;
        }
        resetIdle(controller);
        controller.enqueue(value);
      }
      // Normal end: account for any trailing partial event.
      if (isSse) {
        for (const event of splitter.end()) {
          for (const payload of dataPayloads(event)) {
            accounting.outputChars += payload.length;
            accounting.realUsage ??= usageFromPayload(payload);
          }
        }
      }
      clearIdle();
      controller.close();
    } catch (err) {
      abort(controller, "stream_error", `upstream stream interrupted: ${(err as Error).message}`);
    }
  }

  return new Response(stream, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

/** Buffer a non-streaming JSON body and capture usage + output chars. */
async function bufferJson(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
): Promise<Response> {
  const text = await upstream.text();
  accounting.outputChars = text.length;
  accounting.firstTokenMs = Date.now() - startedAtMs;
  options.onFirstToken?.(accounting.firstTokenMs);
  options.onChunk?.(text.length);
  try {
    const obj = JSON.parse(text) as { usage?: { input_tokens?: number; output_tokens?: number } };
    if (obj?.usage) {
      accounting.realUsage = {
        inputTokens: typeof obj.usage.input_tokens === "number" ? obj.usage.input_tokens : undefined,
        outputTokens: typeof obj.usage.output_tokens === "number" ? obj.usage.output_tokens : undefined,
      };
    }
  } catch {
    /* not JSON — relay verbatim, estimate-only accounting */
  }
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

/**
 * Call the upstream and return a relay-ready result. The request body keeps
 * the client's shape but the alias in "model" is replaced with the concrete
 * upstream providerModelId.
 */
export async function callUpstream(
  providerName: string,
  provider: ProviderConfig,
  providerModelId: string,
  body: ResponsesRequestBody,
  apiKey: string,
  options: UpstreamCallOptions,
): Promise<UpstreamResult> {
  const builder = builders[providerName];
  if (!builder) {
    throw new Error(`no responses egress for provider "${providerName}"`);
  }
  const request = builder(provider, { ...body, model: providerModelId }, apiKey);
  const startedAtMs = Date.now();
  // Connect timeout via a clearable controller: the timer is dropped as
  // soon as the response headers arrive, so long streams are never killed
  // by the connect deadline (stream idling is governed by the idle timer).
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
    return { kind: "stream", response: wrapStream(upstream, accounting, options, startedAtMs), accounting, retryAfterMs };
  }
  if (upstream.body === null) {
    return { kind: "json", response: upstream, accounting, retryAfterMs };
  }
  const response = await bufferJson(upstream, accounting, options, startedAtMs);
  return { kind: "json", response, accounting, retryAfterMs };
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (seconds >= 0) return seconds * 1000;
    return undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}
