/**
 * Pre-stream error contract: a protocol-neutral gateway problem model plus
 * per-protocol renderers, so clients of every ingress see the same facts in
 * their native error shape.
 *
 *   - OpenAI protocol (chat/completions, responses): {"error":{"message",
 *     "type","code",metadata}} — same shape as core/errors.gatewayError().
 *   - Anthropic protocol (messages): {"type":"error","error":{"type","message"}}.
 *
 * Problems carry self-contained messages (per-candidate reasons), Retry-After
 * when a recovery time is known, and a truncated upstream error snippet so a
 * 429 never masquerades as a 502 "server error" for the client.
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { gatewayError } from "./errors.js";

export type ProblemProtocol = "openai" | "anthropic";

/** One failed candidate attempt, as collected by a failover loop. */
export interface FailedAttempt {
  provider: string;
  model: string;
  /** Upstream HTTP status, or null when the upstream could not be reached. */
  status: number | null;
  /** Retry-After parsed from the upstream error response, in ms. */
  retryAfterMs?: number;
  /** Truncated upstream error body / connect-failure text. */
  snippet?: string;
}

export interface ProblemCandidate {
  provider: string;
  model: string;
  status: number | "connection_error";
  snippet?: string;
}

export interface GatewayProblem {
  status: number;
  code: string;
  message: string;
  /** Known time until the gateway may serve this request again, in ms. */
  retryAfterMs?: number;
  /** Per-candidate details for the failover-all-failed problem. */
  candidates?: ProblemCandidate[];
  /** Extra OpenAI metadata (e.g. precheck filter details); takes precedence over candidates. */
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface RenderedProblem {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Anthropic error type names (the codomain of the status mapping below). */
const ANTHROPIC_ERROR_TYPE_NAMES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "request_too_large",
  "rate_limit_error",
  "api_error",
  "overloaded_error",
]);

/**
 * Map an HTTP status to the Anthropic error type names Claude SDKs switch on.
 * 529 (Anthropic overloaded) is checked before the 5xx bucket.
 */
export function anthropicErrorType(status: number): string {
  if (status === 529) return "overloaded_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  if (status === 400 || status === 405 || status === 422) return "invalid_request_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

/**
 * Render a problem for one wire protocol. Headers carry retry-after
 * (whole seconds) when a recovery time is known, plus the request id for
 * correlation across client logs and gateway traces.
 */
export function renderProblemJson(problem: GatewayProblem, protocol: ProblemProtocol): RenderedProblem {
  const headers: Record<string, string> = {};
  if (problem.retryAfterMs !== undefined && problem.retryAfterMs > 0) {
    headers["retry-after"] = String(Math.max(1, Math.ceil(problem.retryAfterMs / 1000)));
  }
  if (problem.requestId) {
    headers["x-prismd-request-id"] = problem.requestId;
  }

  if (protocol === "anthropic") {
    const body: Record<string, unknown> = {
      type: "error",
      error: {
        type: anthropicErrorType(problem.status),
        message: problem.message,
      },
    };
    return { body, headers };
  }

  const metadata = problem.metadata ?? (problem.candidates ? { candidates: problem.candidates } : undefined);
  const rendered = gatewayError(problem.status as ContentfulStatusCode, problem.code, problem.message, metadata);
  return { body: rendered as unknown as Record<string, unknown>, headers };
}

export interface FailoverOutcome {
  status: number;
  code: string;
  retryAfterMs?: number;
}

/**
 * Classify the final response when every failover attempt failed:
 * any 429 attempt -> 429 (Retry-After = max across attempts, so clients
 * back off instead of treating the rate limit as a server fault);
 * only connect-level failures -> 503 upstream_unreachable;
 * everything else (5xx mixes) -> 502.
 */
export function classifyFailoverOutcome(attempts: FailedAttempt[]): FailoverOutcome {
  const anyRateLimited = attempts.some((a) => a.status === 429);
  if (anyRateLimited) {
    const maxRetryAfterMs = attempts.reduce((max, a) => Math.max(max, a.retryAfterMs ?? 0), 0);
    return {
      status: 429,
      code: "rate_limit_exceeded",
      ...(maxRetryAfterMs > 0 ? { retryAfterMs: maxRetryAfterMs } : {}),
    };
  }
  if (attempts.length > 0 && attempts.every((a) => a.status === null)) {
    return { status: 503, code: "upstream_unreachable" };
  }
  return { status: 502, code: "gateway_all_candidates_failed" };
}

/** One-line, self-contained reason for a single failed attempt. */
export function describeAttempt(attempt: FailedAttempt): string {
  const id = `${attempt.provider}/${attempt.model}`;
  if (attempt.status === null) {
    return `${id} → ${attempt.snippet ?? "connection error"}`;
  }
  let line = `${id} → ${attempt.status}${attempt.status === 429 ? " rate limit exceeded" : ""}`;
  if (attempt.snippet) {
    line += `: ${attempt.snippet}`;
  }
  if (attempt.retryAfterMs !== undefined && attempt.retryAfterMs > 0) {
    line += `, retry after ${Math.max(1, Math.ceil(attempt.retryAfterMs / 1000))}s`;
  }
  return line;
}

/**
 * Build the all-candidates-failed problem: status/classification from the
 * attempts, message with the per-attempt reasons, candidates metadata with
 * snippets.
 */
export function buildFailoverProblem(alias: string, attempts: FailedAttempt[], requestId?: string): GatewayProblem {
  const outcome = classifyFailoverOutcome(attempts);
  const candidates = attempts.map(
    (a): ProblemCandidate => ({
      provider: a.provider,
      model: a.model,
      status: a.status ?? "connection_error",
      ...(a.snippet !== undefined ? { snippet: a.snippet } : {}),
    }),
  );
  const plural = attempts.length === 1 ? "" : "s";
  return {
    status: outcome.status,
    code: outcome.code,
    message: `all ${attempts.length} candidate attempt${plural} for alias "${alias}" failed: ${attempts
      .map(describeAttempt)
      .join("; ")}`,
    ...(outcome.retryAfterMs !== undefined ? { retryAfterMs: outcome.retryAfterMs } : {}),
    candidates,
    ...(requestId ? { requestId } : {}),
  };
}

/** A candidate rejected before any upstream call, with its real filter reason. */
export interface UnavailableCandidate {
  provider: string;
  model: string;
  reason: string;
  contextWindow?: number;
}

/**
 * Build the precheck "nothing selectable" problem (429): the message names
 * the real per-candidate reasons (cooling down / quota exhausted /
 * unhealthy) and the earliest cooldown recovery, so clients can back off
 * instead of blind-retrying.
 */
export function buildNoCandidatesProblem(
  alias: string,
  unavailable: UnavailableCandidate[],
  retryAfterMs?: number,
): GatewayProblem {
  const hasRetry = retryAfterMs !== undefined && retryAfterMs > 0;
  const details = unavailable.map((u) => `${u.provider}/${u.model} → ${u.reason}`).join(", ");
  const message =
    `no candidates for alias "${alias}" are currently available: ${details}` +
    (hasRetry ? `. earliest recovery in ~${Math.ceil((retryAfterMs as number) / 1000)}s` : "");
  return {
    status: 429,
    code: "quota_exceeded",
    message,
    ...(hasRetry ? { retryAfterMs } : {}),
    metadata: { candidates: unavailable },
  };
}

export const ERROR_SNIPPET_MAX_CHARS = 200;

/** Collapse whitespace and truncate so snippets stay one readable line. */
export function truncateSnippet(text: string, maxChars = ERROR_SNIPPET_MAX_CHARS): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/** Snippet for a connect-level failure (timeout vs refusal), from the error message. */
export function describeConnectFailure(message: string, timeout: boolean): string {
  return truncateSnippet(`${timeout ? "connection timeout" : "connection error"}: ${message}`);
}

/**
 * Read the upstream error body as a truncated snippet, then release the
 * body so the upstream connection is freed. Missing/unreadable bodies
 * yield undefined, never throw.
 */
export async function readUpstreamErrorSnippet(
  response: Response,
  maxChars = ERROR_SNIPPET_MAX_CHARS,
): Promise<string | undefined> {
  try {
    const snippet = truncateSnippet(await response.text(), maxChars);
    return snippet.length > 0 ? snippet : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      void response.body?.cancel().catch(() => {});
    } catch {
      /* body already consumed */
    }
  }
}

/**
 * Rewrite an upstream error body for the Anthropic protocol: OpenAI-shaped
 * bodies ({"error":{"message",...}}) become {"type":"error","error":{...}}
 * with the upstream message prefixed by provider/model; non-JSON bodies go
 * into the message verbatim. The error type follows the status unless the
 * upstream already used an Anthropic type name.
 */
export function rewriteUpstreamErrorBody(
  rawText: string,
  status: number,
  provider: string,
  model: string,
): Record<string, unknown> {
  let upstreamMessage: string | undefined;
  let upstreamType: string | undefined;
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: unknown; type?: unknown } } | null;
    if (parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object") {
      if (typeof parsed.error.message === "string" && parsed.error.message.trim() !== "") {
        upstreamMessage = parsed.error.message;
      }
      if (typeof parsed.error.type === "string" && parsed.error.type !== "") {
        upstreamType = parsed.error.type;
      }
    }
  } catch {
    /* not JSON */
  }
  const detail = upstreamMessage ?? (rawText.trim() !== "" ? rawText : `upstream returned status ${status}`);
  const type =
    upstreamType !== undefined && ANTHROPIC_ERROR_TYPE_NAMES.has(upstreamType)
      ? upstreamType
      : anthropicErrorType(status);
  return {
    type: "error",
    error: {
      type,
      message: `${provider}/${model}: ${detail}`,
    },
  };
}
