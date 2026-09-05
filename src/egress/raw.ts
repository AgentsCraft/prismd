/**
 * Raw HTTP upstream caller with connection timeout, stream-idle timeout,
 * and StreamAccounting. Shared across all ingress protocol adapters.
 */

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
  /** Real usage reported by the upstream (response.completed / JSON body / SSE usage). */
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Split an incoming text stream into complete SSE event blocks ("\n\n" or "\r\n\r\n" separated). */
export class SseEventSplitter {
  private buffer = "";

  push(text: string): string[] {
    this.buffer += text;
    const events: string[] = [];
    const delimiter = /\r?\n\r?\n/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = delimiter.exec(this.buffer)) !== null) {
      events.push(this.buffer.slice(lastIndex, match.index));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }
    return events;
  }

  end(): string[] {
    if (this.buffer === "") return [];
    const rest = this.buffer;
    this.buffer = "";
    return [rest];
  }

  /** True when a partial event has been seen and not yet terminated. */
  get hasPending(): boolean {
    return this.buffer !== "";
  }
}

/** Extract all payload data from lines starting with "data:" in an SSE event. */
export function dataPayloads(event: string): string[] {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => (line[5] === " " ? line.slice(6) : line.slice(5)));
}

/** Try to extract token usage from a JSON payload or text body across diverse provider formats. */
export function tryExtractUsage(payloadOrText: string): { inputTokens?: number; outputTokens?: number } | undefined {
  try {
    const obj = JSON.parse(payloadOrText) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return undefined;

    // Check obj.usage or nested usage (obj.response.usage, obj.message.usage)
    const u = (obj.usage ??
      (obj.response as Record<string, unknown> | undefined)?.usage ??
      (obj.message as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;

    if (u && typeof u === "object") {
      const input =
        typeof u.input_tokens === "number"
          ? u.input_tokens
          : typeof u.prompt_tokens === "number"
            ? u.prompt_tokens
            : undefined;
      const output =
        typeof u.output_tokens === "number"
          ? u.output_tokens
          : typeof u.completion_tokens === "number"
            ? u.completion_tokens
            : undefined;
      if (input !== undefined || output !== undefined) {
        return { inputTokens: input, outputTokens: output };
      }
    }
  } catch {
    /* ignore non-json */
  }
  return undefined;
}

/** Protocol of an SSE stream output, deciding the mid-stream error event shape. */
export type SseErrorProtocol = "chat" | "responses" | "anthropic";

/** Protocol of the upstream API a raw egress call talks to (providers are chat or responses only). */
export type UpstreamProtocol = "chat" | "responses";

/**
 * SSE error event terminating a broken stream, rendered in the protocol of the
 * stream it is injected into: every stream wrapper emits errors in its OUTPUT
 * protocol, and converters translate upstream error events into theirs.
 * - chat: bare `data: {"error":{...}}` (no event name, no [DONE] — the SDK
 *   throws as soon as it parses the error object; the stream closes after).
 * - responses: `event: response.failed` with the Responses error envelope.
 * - anthropic: `event: error` with the Anthropic error envelope.
 */
export function sseErrorEvent(code: string, message: string, protocol: SseErrorProtocol): string {
  if (protocol === "chat") {
    return `data: ${JSON.stringify({ error: { message, type: "upstream_error", code } })}\n\n`;
  }
  if (protocol === "responses") {
    return `event: response.failed\ndata: ${JSON.stringify({
      type: "response.failed",
      response: { id: "resp_error", status: "failed", error: { code, message } },
    })}\n\n`;
  }
  return `event: error\ndata: ${JSON.stringify({ type: "error", error: { message, type: "upstream_error", code } })}\n\n`;
}

/** How often a silent SSE stream gets a keep-alive (matching OpenAI/Anthropic practice). */
export const SSE_KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * Keep-alive for one output protocol: OpenAI-side streams use a bare comment
 * line (ignored by every spec-conformant SSE parser), Anthropic streams use
 * the protocol's own ping event.
 */
export function keepAliveEvent(protocol: SseErrorProtocol): string {
  if (protocol === "anthropic") {
    return `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`;
  }
  return ": keep-alive\n\n";
}

/**
 * Re-emit a relayed SSE stream with keep-alives during silent periods, so
 * client-side idle timeouts (and intermediate proxies) don't kill a healthy
 * connection while a model thinks or an upstream stalls before its idle
 * timeout fires. Emitted only between complete SSE events — the splitter
 * tracks pending partial events, so a heartbeat can never land mid-event or
 * mid-line. Callers must pass an SSE stream; injection happens downstream of
 * the egress accounting, so heartbeats never inflate usage metrics.
 */
export function addSseKeepAlive(
  source: ReadableStream<Uint8Array>,
  protocol: SseErrorProtocol,
  intervalMs: number = SSE_KEEP_ALIVE_INTERVAL_MS,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const splitter = new SseEventSplitter();
  const decoder = new TextDecoder();
  const keepAlive = encoder.encode(keepAliveEvent(protocol));
  let idleTimer: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller);
    },
    cancel(reason) {
      clearIdle();
      return reader.cancel(reason);
    },
  });

  function clearIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function scheduleIdle(controller: ReadableStreamDefaultController<Uint8Array>): void {
    clearIdle();
    if (intervalMs <= 0) return;
    idleTimer = setTimeout(() => {
      // Between events only: a comment injected mid-event would break SSE framing.
      if (!splitter.hasPending) {
        try {
          controller.enqueue(keepAlive);
        } catch {
          /* client went away */
          clearIdle();
          return;
        }
      }
      scheduleIdle(controller);
    }, intervalMs);
    idleTimer.unref();
  }

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      scheduleIdle(controller);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearIdle();
        // Bookkeeping only: raw chunks are relayed untouched.
        splitter.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
        scheduleIdle(controller);
      }
      clearIdle();
      controller.close();
    } catch (err) {
      clearIdle();
      try {
        controller.error(err);
      } catch {
        /* already closed */
      }
    }
  }

  return stream;
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("-")) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (seconds >= 0) return seconds * 1000;
    return undefined;
  }
  if (!/[a-zA-Z]/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

/**
 * Wrap an upstream SSE body with stream-idle timeout, first token latency tracking,
 * real-time usage extraction, and mid-stream error handling. The stream is a raw
 * passthrough, so injected error events use the upstream's own protocol.
 */
function wrapRawStream(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
  upstreamProtocol: UpstreamProtocol,
): Response {
  const reader = upstream.body!.getReader();
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const splitter = new SseEventSplitter();
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
    if (isSse) {
      try {
        controller.enqueue(encoder.encode(sseErrorEvent(code, message, upstreamProtocol)));
      } catch {
        /* already closed */
      }
    }
    try {
      controller.close();
    } catch {
      /* already closed */
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

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      resetIdle(controller);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!firstTokenSent) {
          firstTokenSent = true;
          accounting.firstTokenMs = Date.now() - startedAtMs;
          options.onFirstToken?.(accounting.firstTokenMs);
        }
        options.onChunk?.(value.byteLength);

        if (isSse) {
          const text = decoder.decode(value, { stream: true });
          for (const event of splitter.push(text)) {
            for (const payload of dataPayloads(event)) {
              accounting.outputChars += payload.length;
              const u = tryExtractUsage(payload);
              if (u) {
                accounting.realUsage = {
                  inputTokens: u.inputTokens ?? accounting.realUsage?.inputTokens,
                  outputTokens: u.outputTokens ?? accounting.realUsage?.outputTokens,
                };
              }
            }
          }
        } else {
          accounting.outputChars += value.byteLength;
        }

        resetIdle(controller);
        controller.enqueue(value);
      }

      if (isSse) {
        for (const event of splitter.end()) {
          for (const payload of dataPayloads(event)) {
            accounting.outputChars += payload.length;
            const u = tryExtractUsage(payload);
            if (u) {
              accounting.realUsage = {
                inputTokens: u.inputTokens ?? accounting.realUsage?.inputTokens,
                outputTokens: u.outputTokens ?? accounting.realUsage?.outputTokens,
              };
            }
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
async function bufferRawJson(
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

  const u = tryExtractUsage(text);
  if (u) {
    accounting.realUsage = u;
  }

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

/**
 * Execute raw HTTP upstream call with connection timeout, stream idle timeout,
 * and unified StreamAccounting. `upstreamProtocol` decides the shape of the
 * error event injected into a broken passthrough SSE stream.
 */
export async function callRawHttpUpstream(
  providerName: string,
  url: string,
  headers: Record<string, string>,
  bodyStr: string,
  wantsStream: boolean,
  options: UpstreamCallOptions,
  upstreamProtocol: UpstreamProtocol,
): Promise<UpstreamResult> {
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const connectTimer =
    options.connectTimeoutMs > 0 ? setTimeout(() => controller.abort(), options.connectTimeoutMs) : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
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
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

  if (wantsStream && isSse && upstream.body) {
    return {
      kind: "stream",
      response: wrapRawStream(upstream, accounting, options, startedAtMs, upstreamProtocol),
      accounting,
      retryAfterMs,
    };
  }
  if (upstream.body === null) {
    return { kind: "json", response: upstream, accounting, retryAfterMs };
  }
  const response = await bufferRawJson(upstream, accounting, options, startedAtMs);
  return { kind: "json", response, accounting, retryAfterMs };
}
