/**
 * Raw HTTP upstream caller with connection timeout, stream-idle timeout,
 * and StreamAccounting. Shared across all ingress protocol adapters.
 */
import {
  UpstreamConnectError,
  parseRetryAfter,
  type StreamAccounting,
  type UpstreamCallOptions,
  type UpstreamResult,
} from "./responses.js";

const encoder = new TextEncoder();

class SseEventSplitter {
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
}

function dataPayloads(event: string): string[] {
  return event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => (line[5] === " " ? line.slice(6) : line.slice(5)));
}

function tryExtractUsage(payload: string): { inputTokens?: number; outputTokens?: number } | undefined {
  try {
    const obj = JSON.parse(payload) as {
      usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    if (obj?.usage) {
      const u = obj.usage;
      const input = typeof u.input_tokens === "number" ? u.input_tokens : u.prompt_tokens;
      const output = typeof u.output_tokens === "number" ? u.output_tokens : u.completion_tokens;
      return {
        inputTokens: typeof input === "number" ? input : undefined,
        outputTokens: typeof output === "number" ? output : undefined,
      };
    }
  } catch {
    /* ignore non-json */
  }
  return undefined;
}

function sseErrorEvent(code: string, message: string): string {
  return `data: ${JSON.stringify({ type: "error", error: { message, type: "upstream_error", code } })}\n\n`;
}

function wrapRawStream(
  upstream: Response,
  accounting: StreamAccounting,
  options: UpstreamCallOptions,
  startedAtMs: number,
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
        controller.enqueue(encoder.encode(sseErrorEvent(code, message)));
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
          const text = new TextDecoder().decode(value);
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

export async function callRawHttpUpstream(
  providerName: string,
  url: string,
  headers: Record<string, string>,
  bodyStr: string,
  wantsStream: boolean,
  options: UpstreamCallOptions,
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
    return { kind: "stream", response: wrapRawStream(upstream, accounting, options, startedAtMs), accounting, retryAfterMs };
  }
  if (upstream.body === null) {
    return { kind: "json", response: upstream, accounting, retryAfterMs };
  }
  const response = await bufferRawJson(upstream, accounting, options, startedAtMs);
  return { kind: "json", response, accounting, retryAfterMs };
}
