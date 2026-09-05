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
 *
 * Upstream error bodies are read through a bounded, deadline-bounded reader
 * (readBoundedBodyText): reading stops at the character cap (cancelling the
 * body) and races a short deadline, so a stalled or oversized error body can
 * never hold the failover loop — and with it the rate limiter's concurrency
 * slot — hostage.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { gatewayError } from "./errors.js";
import type { FilteredCandidate } from "./limits.js";
import { msUntilNextDailyWindow } from "./quota.js";

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

/** Loop-collected failed attempt: the candidate plus what happened to it. */
export interface AttemptOutcome<C> {
  candidate: C;
  status: number | null;
  retryAfterMs?: number;
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
 * (whole seconds) when a recovery time is known; request correlation uses
 * the global x-request-id header set by the app middleware.
 */
export function renderProblemJson(problem: GatewayProblem, protocol: ProblemProtocol): RenderedProblem {
  const headers: Record<string, string> = {};
  if (problem.retryAfterMs !== undefined && problem.retryAfterMs > 0) {
    headers["retry-after"] = String(Math.max(1, Math.ceil(problem.retryAfterMs / 1000)));
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

/** Send a rendered problem as the HTTP error response, in the given protocol. */
export function problemResponse(c: Context, problem: GatewayProblem, protocol: ProblemProtocol): Response {
  const { body, headers } = renderProblemJson(problem, protocol);
  return c.json(body, problem.status as ContentfulStatusCode, headers);
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
  if (attempts.length === 0) {
    // Degenerate case (nothing was recorded): keep the legacy answer.
    return { status: 502, code: "gateway_all_candidates_failed" };
  }
  const anyRateLimited = attempts.some((a) => a.status === 429);
  if (anyRateLimited) {
    const maxRetryAfterMs = attempts.reduce((max, a) => Math.max(max, a.retryAfterMs ?? 0), 0);
    return {
      status: 429,
      code: "rate_limit_exceeded",
      ...(maxRetryAfterMs > 0 ? { retryAfterMs: maxRetryAfterMs } : {}),
    };
  }
  if (attempts.every((a) => a.status === null)) {
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

/** Flatten loop-collected attempt outcomes into FailedAttempts. */
export function toFailedAttempts<C extends { provider: string; providerModelId: string }>(
  outcomes: ReadonlyArray<AttemptOutcome<C>>,
): FailedAttempt[] {
  return outcomes.map(({ candidate, status, retryAfterMs, snippet }) => ({
    provider: candidate.provider,
    model: candidate.providerModelId,
    status,
    retryAfterMs,
    snippet,
  }));
}

/** A candidate rejected before any upstream call, with its real filter reason. */
export interface UnavailableCandidate {
  provider: string;
  model: string;
  reason: string;
  contextWindow?: number;
}

/** The selection pieces the precheck fallback needs (see core/limits.ts). */
export interface PrecheckSelection {
  filtered: FilteredCandidate[];
  windowExceeded: { provider: string; model: string; contextWindow: number }[];
}

/**
 * Retry-After decision for the precheck "nothing selectable" branch (ms):
 * an actual cooldown recovery wins; with no cooldown anywhere and every
 * candidate rejected for daily-quota exhaustion, the next daily window
 * reset is used (quota keys are local dates, so counters roll over at
 * local midnight — see quota.msUntilNextDailyWindow); otherwise no
 * Retry-After. Defined values are at least 1s.
 */
export function precheckRetryAfterMs(
  unavailable: UnavailableCandidate[],
  earliestCooldownRecoveryAt: number | null,
  nowMs: number,
): number | undefined {
  if (earliestCooldownRecoveryAt !== null) {
    return Math.max(1000, earliestCooldownRecoveryAt - nowMs);
  }
  if (unavailable.length > 0 && unavailable.every((u) => u.reason === "quota_exhausted")) {
    return Math.max(1000, msUntilNextDailyWindow(new Date(nowMs)));
  }
  return undefined;
}

/** Human-readable recovery hint for problem messages ("~20s", "~5m", "~21h"). */
function formatRecoveryIn(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds >= 3600) return `~${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `~${Math.ceil(seconds / 60)}m`;
  return `~${seconds}s`;
}

/**
 * Build the precheck "nothing selectable" problem (429), shared by all
 * three ingresses: the message names the real per-candidate reasons
 * (cooling down / quota exhausted / unhealthy) and when the first
 * candidate recovers, so clients can back off instead of blind-retrying.
 */
export function buildNoCandidatesProblem(
  alias: string,
  selection: PrecheckSelection,
  candidates: ReadonlyArray<{ provider: string; providerModelId: string }>,
  earliestRecoveryAt: (provider: string, model: string) => number | null,
  nowMs: number = Date.now(),
): GatewayProblem {
  const unavailable: UnavailableCandidate[] = [
    ...selection.filtered,
    ...selection.windowExceeded.map((w) => ({
      provider: w.provider,
      model: w.model,
      reason: "context_window_exceeded",
      contextWindow: w.contextWindow,
    })),
  ];
  let earliest: number | null = null;
  for (const candidate of candidates) {
    const at = earliestRecoveryAt(candidate.provider, candidate.providerModelId);
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }
  const retryAfterMs = precheckRetryAfterMs(unavailable, earliest, nowMs);
  const details = unavailable.map((u) => `${u.provider}/${u.model} → ${u.reason}`).join(", ");
  const message =
    `no candidates for alias "${alias}" are currently available: ${details}` +
    (retryAfterMs !== undefined ? `. earliest recovery in ${formatRecoveryIn(retryAfterMs)}` : "");
  return {
    status: 429,
    code: "quota_exceeded",
    message,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    metadata: { candidates: unavailable },
  };
}

export const ERROR_SNIPPET_MAX_CHARS = 200;
/** Hard cap (chars) when buffering an upstream error body for rewriting. */
export const UPSTREAM_ERROR_BODY_MAX_CHARS = 4096;
/** Cap for the detail carried inside rewritten upstream error messages. */
export const UPSTREAM_ERROR_MESSAGE_MAX_CHARS = 500;
/** Upper bound for the error-body read deadline (also clamps streamIdleTimeoutMs). */
export const ERROR_BODY_READ_TIMEOUT_MS = 2000;

/** Collapse whitespace and truncate so snippets stay one readable line. */
export function truncateSnippet(text: string, maxChars = ERROR_SNIPPET_MAX_CHARS): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/** Snippet for a connect-level failure (timeout vs refusal), from any thrown value. */
export function describeConnectFailure(err: unknown, timeout: boolean): string {
  const message = err instanceof Error ? err.message : String(err);
  return truncateSnippet(`${timeout ? "connection timeout" : "connection error"}: ${message}`);
}

/**
 * Bounded, deadline-bounded text read of an upstream error body: stops at
 * maxChars (cancelling the body so the connection is released), races a
 * short deadline — min(streamIdleTimeoutMs, ERROR_BODY_READ_TIMEOUT_MS) —
 * so a stalled body cannot hold the failover loop, and degrades to
 * undefined on timeout or read errors instead of throwing.
 */
export async function readBoundedBodyText(
  response: Response,
  streamIdleTimeoutMs: number,
  maxChars: number,
): Promise<string | undefined> {
  try {
    const body = response.body;
    if (!body) return undefined;
    const timeoutMs =
      streamIdleTimeoutMs > 0 ? Math.min(streamIdleTimeoutMs, ERROR_BODY_READ_TIMEOUT_MS) : ERROR_BODY_READ_TIMEOUT_MS;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    return await new Promise<string | undefined>((resolve) => {
      let settled = false;
      let text = "";
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      timer.unref(); // never hold process shutdown for an error body
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Release the body either way: on truncation the rest is discarded.
        void reader.cancel().catch(() => {});
        resolve(value);
      };
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.length >= maxChars) break;
          }
          finish(text.slice(0, maxChars));
        } catch {
          finish(undefined);
        }
      })();
    });
  } catch {
    return undefined;
  }
}

/**
 * Read the upstream error body as a truncated one-line snippet (bounded
 * read, then the body is released). Missing/unreadable bodies yield
 * undefined, never throw.
 */
export async function readUpstreamErrorSnippet(
  response: Response,
  streamIdleTimeoutMs: number,
  maxChars = ERROR_SNIPPET_MAX_CHARS,
): Promise<string | undefined> {
  const text = await readBoundedBodyText(response, streamIdleTimeoutMs, maxChars);
  if (text === undefined) return undefined;
  const snippet = truncateSnippet(text, maxChars);
  return snippet.length > 0 ? snippet : undefined;
}

/**
 * Rewrite an upstream error body for the Anthropic protocol: OpenAI-shaped
 * bodies ({"error":{"message",...}}) become {"type":"error","error":{...}}
 * with the upstream message prefixed by provider/model; non-JSON bodies go
 * into the message verbatim (capped, see UPSTREAM_ERROR_MESSAGE_MAX_CHARS).
 * The error type follows the status unless the upstream already used an
 * Anthropic type name.
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
  const cap = UPSTREAM_ERROR_MESSAGE_MAX_CHARS;
  const detail =
    upstreamMessage !== undefined
      ? truncateSnippet(upstreamMessage, cap)
      : rawText.trim() !== ""
        ? truncateSnippet(rawText, cap)
        : `upstream returned status ${status}`;
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
