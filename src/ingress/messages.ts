import type { Context } from "hono";
import { getConfig } from "../config.js";
import {
  buildFailoverProblem,
  buildNoCandidatesProblem,
  describeConnectFailure,
  problemResponse,
  readBoundedBodyText,
  readUpstreamErrorSnippet,
  rewriteUpstreamErrorBody,
  toFailedAttempts,
  UPSTREAM_ERROR_BODY_MAX_CHARS,
  type AttemptOutcome,
} from "../core/error-contract.js";
import { beginStream, endStream } from "../core/drain.js";
import { getHealth, getKeyPool, getQuota, getRateLimiter } from "../core/runtime.js";
import { statusBroadcaster } from "../core/status-events.js";
import { routeAlias, shouldFailover, resolveClaudeModelAlias, parseTagsHeader } from "../core/router.js";
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
    return problemResponse(
      c,
      { status: 400, code: "invalid_request_error", message: "request body must be valid JSON" },
      "anthropic",
    );
  }
  if (typeof body.model !== "string" || body.model === "") {
    return problemResponse(
      c,
      { status: 400, code: "invalid_request_error", message: 'missing "model" field' },
      "anthropic",
    );
  }

  const config = getConfig();
  const quota = getQuota();
  const health = getHealth();
  const keyPool = getKeyPool();
  const inputChars = JSON.stringify(body).length;

  // Resolve alias: automatic fallback for Claude Code / Anthropic model names
  const aliasKey = resolveClaudeModelAlias(config.models, body.model);

  const rawTags = c.req.header("x-prismd-tags") ?? c.req.query("tags");
  const tags = parseTagsHeader(rawTags);
  const requireTools = Array.isArray(body.tools) && body.tools.length > 0;
  const requireReasoning =
    body.thinking !== undefined ||
    c.req.header("x-prismd-require-reasoning") === "true";

  const rateLimiter = getRateLimiter();

  const routed = routeAlias(config.models, aliasKey, {
    inputChars,
    dailyRequests: (provider, model) => quota.getDailyRequests(provider, model),
    isHealthy: (provider, model) => health.isHealthy(provider, model),
    quotaSoftLimitRatio: config.policies.quotaSoftLimitRatio,
    requireTools,
    requireReasoning,
    tags,
    checkRateLimit: (cand) => rateLimiter.check(cand),
  });
  if (!routed) {
    return problemResponse(
      c,
      { status: 404, code: "model_not_found", message: `model alias "${body.model}" is not defined` },
      "anthropic",
    );
  }
  const { selection, candidates } = routed;

  if (selection.allWindowExceeded) {
    return problemResponse(
      c,
      {
        status: 422,
        code: "context_window_exceeded",
        message: `input exceeds the context window of every candidate for alias "${body.model}"`,
        metadata: { candidates: selection.windowExceeded },
      },
      "anthropic",
    );
  }
  if (candidates.length === 0) {
    return problemResponse(
      c,
      { status: 500, code: "gateway_internal_error", message: `alias "${body.model}" has no candidates defined` },
      "anthropic",
    );
  }
  if (!selection.selected) {
    const onlyCapabilityFiltered =
      selection.filtered.length > 0 &&
      selection.filtered.every(
        (f) => f.reason === "tools_unsupported" || f.reason === "reasoning_unsupported",
      );

    if (onlyCapabilityFiltered) {
      return problemResponse(
        c,
        {
          status: 400,
          code: "capability_unsupported",
          message: `all candidates for alias "${body.model}" do not support the required capabilities (tools/reasoning)`,
          metadata: { candidates: selection.filtered },
        },
        "anthropic",
      );
    }

    const onlyRateLimitFiltered =
      selection.filtered.length > 0 &&
      selection.filtered.every(
        (f) => f.reason === "concurrency_exceeded" || f.reason === "rpm_exceeded",
      );

    if (onlyRateLimitFiltered) {
      return problemResponse(
        c,
        {
          status: 429,
          code: "rate_limit_exceeded",
          message: `all candidates for alias "${body.model}" exceeded concurrency or RPM limits`,
          metadata: { candidates: selection.filtered },
        },
        "anthropic",
      );
    }

    // Nothing selectable: quota exhausted, candidates cooling down after
    // upstream failures, or unhealthy. Tell the client the real reasons and
    // when the first candidate recovers instead of blind 429s.
    return problemResponse(
      c,
      buildNoCandidatesProblem(body.model, selection, candidates, (provider, model) =>
        health.earliestRecoveryAt(provider, model),
      ),
      "anthropic",
    );
  }

  exporter.onRequestStart({ requestId, ts: startedAt, method, path, alias: body.model });

  const attempts = config.policies.retryBeforeStream
    ? Math.min(selection.ordered.length, config.policies.maxCandidatesPerRequest)
    : 1;

  let failovers = 0;
  const attemptStatuses: AttemptOutcome<Candidate>[] = [];

  for (let i = 0; i < attempts; i += 1) {
    const candidate = selection.ordered[i];
    if (!rateLimiter.acquire(candidate)) {
      failovers += 1;
      attemptStatuses.push({ candidate, status: 429 });
      continue;
    }
    let handedOff = false;
    statusBroadcaster.notifyRequestActive({
      requestId,
      alias: body.model,
      provider: candidate.provider,
      model: candidate.providerModelId,
      failovers,
    });

    const provider = config.providers[candidate.provider];
    if (!provider) {
      rateLimiter.release(candidate);
      return problemResponse(
        c,
        {
          status: 500,
          code: "gateway_internal_error",
          message: `candidate "${candidate.providerModelId}" references unknown provider "${candidate.provider}"`,
        },
        "anthropic",
      );
    }
    if (!keyPool.hasKeys(candidate.provider)) {
      rateLimiter.release(candidate);
      return problemResponse(
        c,
        {
          status: 500,
          code: "gateway_internal_error",
          message: `missing API key for provider "${candidate.provider}" (field "${provider.apiKeyField}")`,
        },
        "anthropic",
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
    const triedKeys = new Set<string>();

    while (true) {
      const apiKey = keyPool.getNextKey(candidate.provider, triedKeys);
      if (!apiKey) {
        break;
      }
      triedKeys.add(apiKey);

      let result: UpstreamResult;
      try {
        if (provider.type === "chat") {
          const url = `${provider.baseUrl}/chat/completions`;
          const headers: Record<string, string> = {
            "content-type": "application/json",
            ...provider.extraHeaders,
          };
          if (provider.auth?.type !== "none" && apiKey && apiKey !== "none") {
            headers.authorization = `Bearer ${apiKey}`;
          }
          const bodyStr = JSON.stringify(chatRequest);
          result = await callRawHttpUpstream(
            candidate.provider,
            url,
            headers,
            bodyStr,
            body.stream === true,
            options,
            "chat",
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
        keyPool.recordFailure(candidate.provider, candidate.providerModelId, apiKey, {});
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
        attemptStatuses.push({
          candidate,
          status: null,
          snippet: describeConnectFailure(err, isTimeout),
        });
        failovers += 1;
        continue;
      }

      if (result.kind === "stream" || result.kind === "json") {
        keyPool.recordSuccess(candidate.provider, candidate.providerModelId, apiKey);
        handedOff = true;
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

      if (!shouldFailover(result.status, config.policies.failoverOn)) {
        handedOff = true;
        return relayUpstreamError({ requestId, startedAt, method, path, alias: body.model, candidate, result, inputChars, failovers });
      }

      keyPool.recordFailure(candidate.provider, candidate.providerModelId, apiKey, {
        status: result.status,
        retryAfterMs: result.retryAfterMs,
      });
      // Read (then release) the upstream error body — bounded and under a
      // short deadline — so the final problem can carry a real reason
      // snippet instead of a bare status code.
      const snippet = await readUpstreamErrorSnippet(result.response, config.policies.streamIdleTimeoutMs);
      attemptStatuses.push({
        candidate,
        status: result.status,
        retryAfterMs: result.retryAfterMs,
        snippet,
      });
      failovers += 1;
    }
    if (!handedOff) {
      rateLimiter.release(candidate);
    }
  }

  // Every attempt failed: classify the outcome (any 429 -> 429 with the max
  // Retry-After, all connect failures -> 503, otherwise 502) and render the
  // per-attempt reasons instead of a bare status code.
  const problem = buildFailoverProblem(body.model, toFailedAttempts(attemptStatuses), requestId);
  const finalStatus = problem.status;

  exporter.onError({
    requestId,
    ts: Date.now(),
    alias: body.model,
    code: problem.code,
    message: problem.message,
  });

  const fallbackCandidate = selection.selected ?? selection.ordered[0];
  const finalCandidate = attemptStatuses[attemptStatuses.length - 1]?.candidate ?? fallbackCandidate;
  if (finalCandidate) {
    getQuota().record({
      requestId,
      ts: new Date().toISOString(),
      alias: body.model,
      provider: finalCandidate.provider,
      model: finalCandidate.providerModelId,
      status: finalStatus,
      failover: failovers,
      durationMs: Date.now() - startedAt,
      usage: { inputChars, outputChars: 0 },
    });
    statusBroadcaster.notifyRequestFailed({
      requestId,
      alias: body.model,
      provider: finalCandidate.provider,
      model: finalCandidate.providerModelId,
      status: finalStatus,
      durationMs: Date.now() - startedAt,
      failovers,
    });
  }
  exporter.onRequestEnd({
    requestId,
    ts: Date.now(),
    method,
    path,
    alias: body.model,
    provider: finalCandidate?.provider ?? "unknown",
    model: finalCandidate?.providerModelId ?? "unknown",
    status: finalStatus,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: Math.ceil(inputChars / 4),
      outputTokens: 0,
      source: "estimated",
    },
    failovers,
  });

  return problemResponse(c, problem, "anthropic");
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

    const streamHeaders: Record<string, string> = {
      "content-type": "text/event-stream",
      "x-prismd-provider": ctx.candidate.provider,
      "x-prismd-model": ctx.candidate.providerModelId,
      "x-prismd-alias": ctx.alias,
    };
    if (ctx.failovers > 0) streamHeaders["x-prismd-failovers"] = String(ctx.failovers);

    return new Response(bodyStream, {
      status: result.response.status,
      headers: streamHeaders,
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
  const jsonHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-prismd-provider": ctx.candidate.provider,
    "x-prismd-model": ctx.candidate.providerModelId,
    "x-prismd-alias": ctx.alias,
  };
  if (ctx.failovers > 0) jsonHeaders["x-prismd-failovers"] = String(ctx.failovers);
  return new Response(anthropicJsonStr, {
    status: result.response.status,
    headers: jsonHeaders,
  });
}

/**
 * Relay a non-failover upstream error to the Anthropic client. The upstream
 * body is parsed and rewritten into the Anthropic error shape (the message
 * is prefixed with provider/model so the failing upstream stays visible);
 * status and relay headers are preserved. chat/responses keep relaying the
 * OpenAI-shaped body verbatim.
 */
async function relayUpstreamError(ctx: RelayContext & { result: HttpErrorResult }): Promise<Response> {
  const { result } = ctx;
  const headers: Record<string, string> = {};
  for (const name of RELAY_HEADERS) {
    const value = result.response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  // The body is rewritten by us, so the content type is ours to set.
  headers["content-type"] = "application/json";
  headers["x-prismd-provider"] = ctx.candidate.provider;
  headers["x-prismd-model"] = ctx.candidate.providerModelId;
  headers["x-prismd-alias"] = ctx.alias;
  if (ctx.failovers > 0) {
    headers["x-prismd-failovers"] = String(ctx.failovers);
  }
  // Bounded, deadline-bounded read of the upstream body (never throws);
  // the text is then rewritten into the Anthropic shape below.
  const rawText =
    (await readBoundedBodyText(
      result.response,
      getConfig().policies.streamIdleTimeoutMs,
      UPSTREAM_ERROR_BODY_MAX_CHARS,
    )) ?? "";
  const anthropicBody = rewriteUpstreamErrorBody(
    rawText,
    result.status,
    ctx.candidate.provider,
    ctx.candidate.providerModelId,
  );
  const response = new Response(JSON.stringify(anthropicBody), {
    status: result.status,
    headers,
  });
  finalize({ ...ctx, status: result.status }, {
    firstTokenMs: 0,
    outputChars: 0,
    aborted: false,
  });
  statusBroadcaster.notifyRequestFailed({
    requestId: ctx.requestId,
    alias: ctx.alias,
    provider: ctx.candidate.provider,
    model: ctx.candidate.providerModelId,
    status: result.status,
    durationMs: Date.now() - ctx.startedAt,
    failovers: ctx.failovers,
  });
  return response;
}

function finalize(ctx: RelayContext & { status: number }, accounting: StreamAccounting): void {
  getRateLimiter().release(ctx.candidate);
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
  statusBroadcaster.notifyRequestCompleted({
    requestId: ctx.requestId,
    alias: ctx.alias,
    provider: ctx.candidate.provider,
    model: ctx.candidate.providerModelId,
    status: ctx.status,
    durationMs: Date.now() - ctx.startedAt,
    failovers: ctx.failovers,
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
