import type { Context } from "hono";
import { getConfig } from "../config.js";
import { gatewayError } from "../core/errors.js";
import { beginStream, endStream } from "../core/drain.js";
import { getHealth, getKeyPool, getQuota } from "../core/runtime.js";
import { routeAlias, shouldFailover, parseTagsHeader } from "../core/router.js";
import type { Candidate } from "../types/config.js";
import { callUpstream as responsesCallUpstream, UpstreamConnectError, type StreamAccounting, type UpstreamResult } from "../egress/responses.js";
import { callUpstream as chatCallUpstream } from "../egress/chat.js";
import { exporter } from "../observability/exporter.js";
import { logger } from "../observability/logger.js";
import type { ResponsesRequestBody } from "../types/protocol.js";

/**
 * POST /v1/responses ingress with KeyPool and M2a failover decision tree:
 *
 *   try candidate i (<= maxCandidatesPerRequest)
 *     try next available key in candidate's provider pool
 *       -> connect failure / connect timeout / failoverOn status (401/403/429/5xx)
 *          -> record key failure, try next key in provider pool
 *          -> when provider pool keys exhausted, switch to candidate i+1
 *       -> other 4xx (400/404/422) -> passthrough verbatim, no switch
 *       -> 2xx -> relay; stream breaks afterwards are never retried
 *          (SSE error event ends the stream)
 *   all candidates failed -> 502 gateway_all_candidates_failed
 */

const RELAY_HEADERS = ["content-type", "retry-after"] as const;

export async function responses(c: Context): Promise<Response> {
  const requestId = c.get("requestId") as string;
  const startedAt = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  let body: ResponsesRequestBody;
  try {
    body = await c.req.json<ResponsesRequestBody>();
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
  const keyPool = getKeyPool();
  const inputChars = JSON.stringify(body).length;

  const rawTags = c.req.header("x-prismd-tags") ?? c.req.query("tags");
  const tags = parseTagsHeader(rawTags);
  const requireTools = Array.isArray(body.tools) && body.tools.length > 0;
  const requireReasoning =
    body.reasoning_effort !== undefined ||
    c.req.header("x-prismd-require-reasoning") === "true";

  const routed = routeAlias(config.models, body.model, {
    inputChars,
    dailyRequests: (provider, model) => quota.getDailyRequests(provider, model),
    isHealthy: (provider, model) => health.isHealthy(provider, model),
    quotaSoftLimitRatio: config.policies.quotaSoftLimitRatio,
    requireTools,
    requireReasoning,
    tags,
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
    const onlyCapabilityFiltered =
      selection.filtered.length > 0 &&
      selection.filtered.every(
        (f) => f.reason === "tools_unsupported" || f.reason === "reasoning_unsupported",
      );

    if (onlyCapabilityFiltered) {
      return c.json(
        gatewayError(
          400,
          "capability_unsupported",
          `all candidates for alias "${body.model}" do not support the required capabilities (tools/reasoning)`,
          { candidates: selection.filtered },
        ),
        400,
      );
    }

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
    if (!keyPool.hasKeys(candidate.provider)) {
      return c.json(
        gatewayError(
          500,
          "gateway_internal_error",
          `missing API key for provider "${candidate.provider}" (field "${provider.apiKeyField}")`,
        ),
        500,
      );
    }

    const triedKeys = new Set<string>();

    while (true) {
      const apiKey = keyPool.getNextKey(candidate.provider, triedKeys);
      if (!apiKey) {
        break;
      }
      triedKeys.add(apiKey);

      const caller = provider.type === "chat" ? chatCallUpstream : responsesCallUpstream;
      let result: UpstreamResult;
      try {
        result = await caller(
          candidate.provider,
          provider,
          candidate.providerModelId,
          body,
          apiKey,
          {
            connectTimeoutMs: config.policies.connectTimeoutMs,
            streamIdleTimeoutMs: config.policies.streamIdleTimeoutMs,
            onFirstToken: (latencyMs) =>
              exporter.onFirstToken({
                requestId,
                ts: Date.now(),
                alias: body.model,
                provider: candidate.provider,
                model: candidate.providerModelId,
                latencyMs,
              }),
            onChunk: (bytes) =>
              exporter.onChunk({
                requestId,
                ts: Date.now(),
                alias: body.model,
                provider: candidate.provider,
                model: candidate.providerModelId,
                bytes,
              }),
          },
        );
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
        attemptStatuses.push({ candidate, status: null });
        failovers += 1;
        continue;
      }

      if (result.kind === "stream" || result.kind === "json") {
        keyPool.recordSuccess(candidate.provider, candidate.providerModelId, apiKey);
        return relaySuccess({
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

      // kind === "error": failover or passthrough, decided by status.
      if (!shouldFailover(result.status, config.policies.failoverOn)) {
        // Request-class 4xx and any non-listed status: relay verbatim, no switch.
        return relayUpstreamError({ requestId, startedAt, method, path, alias: body.model, candidate, result, inputChars, failovers });
      }

      keyPool.recordFailure(candidate.provider, candidate.providerModelId, apiKey, {
        status: result.status,
        retryAfterMs: result.retryAfterMs,
      });
      // Free the unused error body so the upstream connection is released.
      void result.response.body?.cancel();
      attemptStatuses.push({ candidate, status: result.status });
      failovers += 1;
    }
  }

  // All attempts failed: 502 with per-candidate upstream status codes.
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

  const fallbackCandidate = selection.selected ?? selection.ordered[0];
  const finalCandidate = attemptStatuses[attemptStatuses.length - 1]?.candidate ?? fallbackCandidate;
  if (finalCandidate) {
    getQuota().record({
      requestId,
      ts: new Date().toISOString(),
      alias: body.model,
      provider: finalCandidate.provider,
      model: finalCandidate.providerModelId,
      status: 502,
      failover: failovers,
      durationMs: Date.now() - startedAt,
      usage: { inputChars, outputChars: 0 },
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

function relaySuccess(ctx: RelayContext & { result: OkResult }): Response {
  const { result } = ctx;
  const accounting = result.accounting;
  const headers: Record<string, string> = {};
  for (const name of RELAY_HEADERS) {
    const value = result.response.headers.get(name);
    if (value !== null) headers[name] = value;
  }

  if (result.kind === "stream") {
    beginStream();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      endStream();
      finalize({ ...ctx, status: result.response.status }, accounting);
    };
    const relayed = result.response.body!.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
        flush: () => {
          finish();
        },
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const reader = relayed.getReader();
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                finish();
                controller.close();
                return;
              }
              controller.enqueue(value);
            }
          } catch (err) {
            finish();
            controller.error(err);
          }
        })();
      },
      cancel(reason) {
        finish();
        return relayed.cancel(reason);
      },
    });
    return new Response(body, { status: result.response.status, headers });
  }

  finalize({ ...ctx, status: result.response.status }, accounting);
  return new Response(result.response.body, { status: result.response.status, headers });
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
