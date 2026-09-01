import type { Context } from "hono";
import { resolveProviderApiKey } from "../config.js";
import { getConfig } from "../config.js";
import { gatewayError } from "../core/errors.js";
import { beginStream, endStream } from "../core/drain.js";
import { getHealth } from "../core/runtime.js";
import { getQuota } from "../core/runtime.js";
import { routeAlias, resolveClaudeModelAlias } from "../core/router.js";
import type { Candidate } from "../types/config.js";
import {
  callRawHttpUpstream,
  SseEventSplitter,
  dataPayloads,
} from "../egress/raw.js";
import {
  callUpstream as responsesCallUpstream,
  UpstreamConnectError,
  type StreamAccounting,
  type UpstreamResult,
} from "../egress/responses.js";
import { exporter } from "../observability/exporter.js";
import { logger } from "../observability/logger.js";
import {
  convertChatToResponsesRequest,
  wrapResponsesStreamToChat,
  bufferAndConvertResponsesJson,
} from "../egress/chat-converter.js";
import {
  convertAnthropicToChatRequest,
  convertChatToAnthropicResponse,
  ChatToAnthropicStreamTransformer,
  type AnthropicRequestBody,
} from "./messages-converter.js";

const RELAY_HEADERS = ["content-type", "retry-after"] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function messages(c: Context): Promise<Response> {
  const requestId = c.get("requestId") as string;
  const startedAt = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  let body: AnthropicRequestBody;
  try {
    body = await c.req.json<AnthropicRequestBody>();
  } catch {
    return c.json(
      gatewayError(400, "invalid_request_error", "request body must be valid JSON"),
      400,
    );
  }
  if (typeof body.model !== "string" || body.model === "") {
    return c.json(gatewayError(400, "invalid_request_error", 'missing "model" field'), 400);
  }

  const config = getConfig();
  const quota = getQuota();
  const health = getHealth();
  const inputChars = JSON.stringify(body).length;

  // Resolve alias: automatic fallback for Claude Code / Anthropic model names
  const aliasKey = resolveClaudeModelAlias(config.models, body.model);

  const routed = routeAlias(config.models, aliasKey, {
    inputChars,
    dailyRequests: (provider, model) => quota.getDailyRequests(provider, model),
    isHealthy: (provider, model) => health.isHealthy(provider, model),
    quotaSoftLimitRatio: config.policies.quotaSoftLimitRatio,
  });
  if (!routed) {
    return c.json(gatewayError(404, "model_not_found", `model alias "${body.model}" is not defined`), 404);
  }
  const { selection, candidates } = routed;

  if (selection.allWindowExceeded) {
    return c.json(
      gatewayError(
        422,
        "context_window_exceeded",
        `input exceeds the context window of every candidate for alias "${body.model}"`,
        { candidates: selection.windowExceeded },
      ),
      422,
    );
  }
  if (candidates.length === 0) {
    return c.json(
      gatewayError(500, "gateway_internal_error", `alias "${body.model}" has no candidates defined`),
      500,
    );
  }
  if (!selection.selected) {
    return c.json(
      gatewayError(
        429,
        "quota_exceeded",
        `all candidates for alias "${body.model}" are filtered by quota or health`,
        {
          candidates: [
            ...selection.filtered,
            ...selection.windowExceeded.map((w) => ({ ...w, reason: "context_window_exceeded" })),
          ],
        },
      ),
      429,
    );
  }

  exporter.onRequestStart({ requestId, ts: startedAt, method, path, alias: body.model });

  const attempts = config.policies.retryBeforeStream
    ? Math.min(selection.ordered.length, config.policies.maxCandidatesPerRequest)
    : 1;

  let failovers = 0;
  const attemptStatuses: { candidate: Candidate; status: number | null }[] = [];

  for (let i = 0; i < attempts; i += 1) {
    const candidate = selection.ordered[i];
    const provider = config.providers[candidate.provider];
    if (!provider) {
      return c.json(
        gatewayError(
          500,
          "gateway_internal_error",
          `candidate "${candidate.providerModelId}" references unknown provider "${candidate.provider}"`,
        ),
        500,
      );
    }
    const apiKey = resolveProviderApiKey(provider.apiKeyField);
    if (!apiKey) {
      return c.json(
        gatewayError(
          500,
          "gateway_internal_error",
          `missing API key for provider "${candidate.provider}" (field "${provider.apiKeyField}")`,
        ),
        500,
      );
    }

    const options = {
      connectTimeoutMs: config.policies.connectTimeoutMs,
      streamIdleTimeoutMs: config.policies.streamIdleTimeoutMs,
      onFirstToken: (latencyMs: number) =>
        exporter.onFirstToken({
          requestId,
          ts: Date.now(),
          alias: body.model,
          provider: candidate.provider,
          model: candidate.providerModelId,
          latencyMs,
        }),
      onChunk: (bytes: number) =>
        exporter.onChunk({
          requestId,
          ts: Date.now(),
          alias: body.model,
          provider: candidate.provider,
          model: candidate.providerModelId,
          bytes,
        }),
    };

    const chatRequest = convertAnthropicToChatRequest(body, candidate.providerModelId);

    let result: UpstreamResult;
    try {
      if (provider.type === "chat") {
        const url = `${provider.baseUrl}/chat/completions`;
        const headers = {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...provider.extraHeaders,
        };
        const bodyStr = JSON.stringify(chatRequest);
        result = await callRawHttpUpstream(
          candidate.provider,
          url,
          headers,
          bodyStr,
          body.stream === true,
          options,
        );
      } else {
        const responsesReq = convertChatToResponsesRequest(chatRequest, candidate.providerModelId);
        const startedAtMs = Date.now();
        const rawResult = await responsesCallUpstream(
          candidate.provider,
          provider,
          candidate.providerModelId,
          responsesReq,
          apiKey,
          options,
        );

        if (rawResult.kind === "stream" && rawResult.response.body) {
          result = {
            kind: "stream",
            response: wrapResponsesStreamToChat(
              rawResult.response,
              rawResult.accounting,
              options,
              startedAtMs,
              candidate.providerModelId,
            ),
            accounting: rawResult.accounting,
            retryAfterMs: rawResult.retryAfterMs,
          };
        } else if (rawResult.kind === "json") {
          result = {
            kind: "json",
            response: await bufferAndConvertResponsesJson(
              rawResult.response,
              rawResult.accounting,
              options,
              startedAtMs,
              candidate.providerModelId,
            ),
            accounting: rawResult.accounting,
            retryAfterMs: rawResult.retryAfterMs,
          };
        } else {
          result = rawResult;
        }
      }
    } catch (err) {
      const isTimeout = err instanceof UpstreamConnectError ? err.timeout : false;
      health.recordFailure(candidate.provider, candidate.providerModelId, {});
      logger.warn(
        {
          requestId,
          alias: body.model,
          provider: candidate.provider,
          model: candidate.providerModelId,
          timeout: isTimeout,
          error: (err as Error).message,
        },
        "upstream connection failed",
      );
      attemptStatuses.push({ candidate, status: null });
      failovers += 1;
      continue;
    }

    if (result.kind === "stream" || result.kind === "json") {
      health.recordSuccess(candidate.provider, candidate.providerModelId);
      return await relayAnthropicSuccess({
        requestId,
        startedAt,
        method,
        path,
        alias: body.model,
        candidate,
        result,
        inputChars,
        failovers,
      });
    }

    if (!config.policies.failoverOn.includes(String(result.status))) {
      return relayUpstreamError({ requestId, startedAt, method, path, alias: body.model, candidate, result, inputChars, failovers });
    }

    health.recordFailure(candidate.provider, candidate.providerModelId, {
      status: result.status,
      retryAfterMs: result.retryAfterMs,
    });
    void result.response.body?.cancel();
    attemptStatuses.push({ candidate, status: result.status });
    failovers += 1;
  }

  const metadata = attemptStatuses.map(({ candidate, status }) => ({
    provider: candidate.provider,
    model: candidate.providerModelId,
    status: status ?? "connection_error",
  }));
  exporter.onError({
    requestId,
    ts: Date.now(),
    alias: body.model,
    code: "gateway_all_candidates_failed",
    message: `all candidates for alias "${body.model}" failed`,
  });

  const finalAttempt = attemptStatuses[attemptStatuses.length - 1];
  getQuota().record({
    requestId,
    ts: new Date().toISOString(),
    alias: body.model,
    provider: finalAttempt.candidate.provider,
    model: finalAttempt.candidate.providerModelId,
    status: 502,
    failover: failovers,
    durationMs: Date.now() - startedAt,
    usage: { inputChars, outputChars: 0 },
  });
  exporter.onRequestEnd({
    requestId,
    ts: Date.now(),
    method,
    path,
    alias: body.model,
    provider: finalAttempt.candidate.provider,
    model: finalAttempt.candidate.providerModelId,
    status: 502,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: Math.ceil(inputChars / 4),
      outputTokens: 0,
      source: "estimated",
    },
    failovers,
  });

  return c.json(
    gatewayError(
      502,
      "gateway_all_candidates_failed",
      `all candidates for alias "${body.model}" failed`,
      { candidates: metadata },
    ),
    502,
  );
}

interface RelayContext {
  requestId: string;
  startedAt: number;
  method: string;
  path: string;
  alias: string;
  candidate: Candidate;
  inputChars: number;
  failovers: number;
}

type OkResult = Extract<UpstreamResult, { kind: "stream" | "json" }>;
type HttpErrorResult = Extract<UpstreamResult, { kind: "error" }>;

async function relayAnthropicSuccess(ctx: RelayContext & { result: OkResult }): Promise<Response> {
  const { result } = ctx;
  const accounting = result.accounting;

  if (result.kind === "stream") {
    beginStream();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      endStream();
      finalize({ ...ctx, status: result.response.status }, accounting);
    };

    const reader = result.response.body!.getReader();
    const transformer = new ChatToAnthropicStreamTransformer(ctx.alias);
    const splitter = new SseEventSplitter();

    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;

              const text = decoder.decode(value, { stream: true });
              for (const event of splitter.push(text)) {
                for (const payload of dataPayloads(event)) {
                  const anthropicEvents = transformer.processDataPayload(payload);
                  for (const ev of anthropicEvents) {
                    controller.enqueue(encoder.encode(ev));
                  }
                }
              }
            }

            for (const event of splitter.end()) {
              for (const payload of dataPayloads(event)) {
                const anthropicEvents = transformer.processDataPayload(payload);
                for (const ev of anthropicEvents) {
                  controller.enqueue(encoder.encode(ev));
                }
              }
            }

            const finishEvents = transformer.finish();
            for (const ev of finishEvents) {
              controller.enqueue(encoder.encode(ev));
            }

            const usage = transformer.getUsage();
            if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
              accounting.realUsage = {
                inputTokens: usage.inputTokens || accounting.realUsage?.inputTokens,
                outputTokens: usage.outputTokens || accounting.realUsage?.outputTokens,
              };
            }

            finish();
            controller.close();
          } catch (err) {
            finish();
            controller.error(err);
          }
        })();
      },
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
    });

    return new Response(bodyStream, {
      status: result.response.status,
      headers: { "content-type": "text/event-stream" },
    });
  }

  // Non-streaming JSON response: convert to Anthropic response JSON
  const rawText = await result.response.text();
  let anthropicJsonStr = rawText;
  try {
    const rawObj = JSON.parse(rawText) as Record<string, unknown>;
    const anthropicObj = convertChatToAnthropicResponse(rawObj, ctx.alias);
    anthropicJsonStr = JSON.stringify(anthropicObj);
    if (anthropicObj.usage && typeof anthropicObj.usage === "object") {
      const u = anthropicObj.usage as Record<string, unknown>;
      accounting.realUsage = {
        inputTokens: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
        outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
      };
    }
  } catch {
    /* not json */
  }
  finalize({ ...ctx, status: result.response.status }, accounting);
  return new Response(anthropicJsonStr, {
    status: result.response.status,
    headers: { "content-type": "application/json" },
  });
}

function relayUpstreamError(ctx: RelayContext & { result: HttpErrorResult }): Response {
  const { result } = ctx;
  const headers: Record<string, string> = {};
  for (const name of RELAY_HEADERS) {
    const value = result.response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const response = new Response(result.response.body, {
    status: result.status,
    headers,
  });
  finalize({ ...ctx, status: result.status }, {
    firstTokenMs: 0,
    outputChars: 0,
    aborted: false,
  });
  return response;
}

function finalize(ctx: RelayContext & { status: number }, accounting: StreamAccounting): void {
  const usage = {
    inputTokens: accounting.realUsage?.inputTokens,
    outputTokens: accounting.realUsage?.outputTokens,
    inputChars: ctx.inputChars,
    outputChars: accounting.outputChars,
  };
  getQuota().record({
    requestId: ctx.requestId,
    ts: new Date().toISOString(),
    alias: ctx.alias,
    provider: ctx.candidate.provider,
    model: ctx.candidate.providerModelId,
    status: ctx.status,
    failover: ctx.failovers,
    durationMs: Date.now() - ctx.startedAt,
    usage,
  });
  exporter.onRequestEnd({
    requestId: ctx.requestId,
    ts: Date.now(),
    method: ctx.method,
    path: ctx.path,
    alias: ctx.alias,
    provider: ctx.candidate.provider,
    model: ctx.candidate.providerModelId,
    status: ctx.status,
    firstTokenMs: accounting.firstTokenMs || undefined,
    durationMs: Date.now() - ctx.startedAt,
    usage: {
      inputTokens: usage.inputTokens ?? Math.ceil(usage.inputChars / 4),
      outputTokens: usage.outputTokens ?? Math.ceil(usage.outputChars / 4),
      source:
        usage.inputTokens !== undefined && usage.outputTokens !== undefined
          ? "real"
          : usage.inputTokens !== undefined || usage.outputTokens !== undefined
            ? "mixed"
            : "estimated",
    },
    failovers: ctx.failovers,
  });
  if (accounting.aborted) {
    exporter.onError({
      requestId: ctx.requestId,
      ts: Date.now(),
      alias: ctx.alias,
      provider: ctx.candidate.provider,
      model: ctx.candidate.providerModelId,
      code: "stream_error",
      message: "upstream stream ended abnormally",
    });
  }
}
