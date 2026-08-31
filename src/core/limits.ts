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

export type FilterReason = "quota_exhausted" | "context_window_exceeded" | "unhealthy";

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
}

export interface SelectionResult {
  /** The chosen candidate, undefined when nothing is left. */
  selected?: Candidate;
  /** All eligible candidates in attempt order (survivors + demoted tail). */
  ordered: Candidate[];
  /** Candidates excluded for quota/health reasons (metadata for 429). */
  filtered: FilteredCandidate[];
  /** True when every candidate's window is smaller than the input estimate. */
  allWindowExceeded: boolean;
  /** Candidates with window overflow (metadata for 422). */
  windowExceeded: { provider: string; model: string; contextWindow: number }[];
}

export function estimateInputTokens(inputChars: number): number {
  return estimateTokens(inputChars);
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

  const survivors: Candidate[] = [];
  const demoted: Candidate[] = [];
  const softThreshold = ctx.quotaSoftLimitRatio;

  for (const candidate of candidates) {
    const inputTokens = estimateInputTokens(ctx.inputChars);

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

    // Soft demotion: quota nearly exhausted -> try other candidates first.
    if (daily !== null && softThreshold > 0 && used >= daily * softThreshold) {
      demoted.push(candidate);
    } else {
      survivors.push(candidate);
    }
  }

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
