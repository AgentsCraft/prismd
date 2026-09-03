/**
 * Soft-limit routing (M2a): hard exclusions and soft demotion applied to
 * an alias's ordered candidate list, per the 05 plan.
 *
 *   resolve(alias)
 *     -> hard exclude: daily quota exhausted (limits.dailyRequests)
 *     -> hard exclude: input estimate > contextWindow (window overflow)
 *     -> hard exclude: unhealthy / in cooldown candidates
 *     -> soft demote: daily usage >= quotaSoftLimitRatio to the tail
 *     -> pick the first
 *
 * All numbers are soft by design: a stale preset limit never hard-blocks
 * a request — the fallback is upstream 429 + passive failover.
 */
import type { Candidate } from "../types/config.js";
import { estimateTokens } from "./quota.js";

export type FilterReason =
  | "quota_exhausted"
  | "context_window_exceeded"
  | "unhealthy"
  | "tools_unsupported"
  | "reasoning_unsupported"
  | "concurrency_exceeded"
  | "rpm_exceeded";

export interface FilteredCandidate {
  provider: string;
  model: string;
  reason: FilterReason;
  contextWindow: number;
}

export interface SelectionContext {
  /** Request body char count; the input estimate is chars/4. */
  inputChars: number;
  /** Today's accumulated request count for a (provider, model). */
  dailyRequests: (provider: string, model: string) => number;
  /** Health gate for a (provider, model); false = excluded. */
  isHealthy: (provider: string, model: string) => boolean;
  quotaSoftLimitRatio: number;
  /** Hard filter: requires candidate to support tools / function calling. */
  requireTools?: boolean;
  /** Hard filter: requires candidate to support reasoning / thinking. */
  requireReasoning?: boolean;
  /** Preferred tags (e.g. ['coding', 'fast']). Candidates matching more tags are prioritized. */
  tags?: string[];
  /** Optional rate limit check (concurrency semaphore & rolling RPM). */
  checkRateLimit?: (candidate: Candidate) => { allowed: boolean; reason?: "concurrency_exceeded" | "rpm_exceeded" };
}

export interface SelectionResult {
  /** The chosen candidate, undefined when nothing is left. */
  selected?: Candidate;
  /** All eligible candidates in attempt order (survivors + demoted tail). */
  ordered: Candidate[];
  /** Candidates excluded for quota/health/capability reasons. */
  filtered: FilteredCandidate[];
  /** True when every candidate's window is smaller than the input estimate. */
  allWindowExceeded: boolean;
  /** Candidates with window overflow (metadata for 422). */
  windowExceeded: { provider: string; model: string; contextWindow: number }[];
}

export function estimateInputTokens(inputChars: number): number {
  return estimateTokens(inputChars);
}

function computeTagScore(candidate: Candidate, requestedTags?: string[]): number {
  if (!requestedTags || requestedTags.length === 0) return 0;
  if (!candidate.tags || candidate.tags.length === 0) return 0;
  const candidateTagSet = new Set(candidate.tags.map((t) => t.toLowerCase()));
  let score = 0;
  for (const tag of requestedTags) {
    if (candidateTagSet.has(tag.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

/**
 * Apply hard exclusions, then soft demotion, and pick the first survivor.
 * Pure function of its inputs — no I/O, no globals.
 */
export function selectCandidate(
  candidates: Candidate[],
  ctx: SelectionContext,
): SelectionResult {
  const windowExceeded: SelectionResult["windowExceeded"] = [];
  const filtered: FilteredCandidate[] = [];

  const rawSurvivors: { candidate: Candidate; index: number; tagScore: number }[] = [];
  const rawDemoted: { candidate: Candidate; index: number; tagScore: number }[] = [];
  const softThreshold = ctx.quotaSoftLimitRatio;
  const inputTokens = estimateInputTokens(ctx.inputChars);

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    if (inputTokens > candidate.contextWindow) {
      windowExceeded.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        contextWindow: candidate.contextWindow,
      });
      continue;
    }

    if (!ctx.isHealthy(candidate.provider, candidate.providerModelId)) {
      filtered.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        reason: "unhealthy",
        contextWindow: candidate.contextWindow,
      });
      continue;
    }

    if (ctx.requireTools && !candidate.supportsTools) {
      filtered.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        reason: "tools_unsupported",
        contextWindow: candidate.contextWindow,
      });
      continue;
    }

    if (ctx.requireReasoning && !candidate.supportsReasoning) {
      filtered.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        reason: "reasoning_unsupported",
        contextWindow: candidate.contextWindow,
      });
      continue;
    }

    if (ctx.checkRateLimit) {
      const rateLimitRes = ctx.checkRateLimit(candidate);
      if (!rateLimitRes.allowed && rateLimitRes.reason) {
        filtered.push({
          provider: candidate.provider,
          model: candidate.providerModelId,
          reason: rateLimitRes.reason,
          contextWindow: candidate.contextWindow,
        });
        continue;
      }
    }

    const daily = candidate.limits.dailyRequests;
    const used = ctx.dailyRequests(candidate.provider, candidate.providerModelId);
    if (daily !== null && used >= daily) {
      filtered.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        reason: "quota_exhausted",
        contextWindow: candidate.contextWindow,
      });
      continue;
    }

    const tagScore = computeTagScore(candidate, ctx.tags);

    // Soft demotion: quota nearly exhausted -> try other candidates first.
    if (daily !== null && softThreshold > 0 && used >= daily * softThreshold) {
      rawDemoted.push({ candidate, index: i, tagScore });
    } else {
      rawSurvivors.push({ candidate, index: i, tagScore });
    }
  }

  // Stable sort by tagScore descending if tags are specified
  const sortByScore = (
    a: { candidate: Candidate; index: number; tagScore: number },
    b: { candidate: Candidate; index: number; tagScore: number },
  ) => {
    if (b.tagScore !== a.tagScore) {
      return b.tagScore - a.tagScore;
    }
    return a.index - b.index;
  };

  if (ctx.tags && ctx.tags.length > 0) {
    rawSurvivors.sort(sortByScore);
    rawDemoted.sort(sortByScore);
  }

  const survivors = rawSurvivors.map((item) => item.candidate);
  const demoted = rawDemoted.map((item) => item.candidate);

  const allWindowExceeded = windowExceeded.length === candidates.length && candidates.length > 0;
  const ordered = [...survivors, ...demoted];
  return {
    selected: ordered[0],
    ordered,
    filtered,
    allWindowExceeded,
    windowExceeded,
  };
}
