import type { AliasModel, Candidate } from "../types/config.js";
import { selectCandidate, type SelectionContext, type SelectionResult } from "./limits.js";

/**
 * Resolve a model alias to its ordered candidate list. Order is exactly
 * as written in the config; quota/health/window filtering and soft
 * demotion happen in selectCandidate (see limits.ts).
 *
 * Returns undefined when the alias is not defined.
 */
export function resolveAlias(
  models: Record<string, AliasModel>,
  alias: string,
): Candidate[] | undefined {
  const model = models[alias];
  return model?.candidates;
}

/**
 * Resolve an alias and pick a candidate with M2a routing rules.
 * Returns undefined when the alias is unknown; the SelectionResult
 * carries the per-candidate filter reasons for error metadata.
 */
export function routeAlias(
  models: Record<string, AliasModel>,
  alias: string,
  ctx: SelectionContext,
): { candidates: Candidate[]; selection: SelectionResult } | undefined {
  const candidates = resolveAlias(models, alias);
  if (!candidates) return undefined;
  return { candidates, selection: selectCandidate(candidates, ctx) };
}

/**
 * Automatically resolves a Claude model name requested by Claude Code / Anthropic SDK
 * (e.g. claude-3-5-sonnet-20241022, claude-3-7-sonnet, claude-3-5-haiku) to a matching
 * configured alias or falls back to "free-auto" / available alias for zero-config usage.
 */
export function resolveClaudeModelAlias(
  models: Record<string, AliasModel>,
  requestedModel: string,
): string {
  // 1. Exact match
  if (models[requestedModel]) {
    return requestedModel;
  }

  const configuredKeys = Object.keys(models);
  if (configuredKeys.length === 0) {
    return requestedModel;
  }

  const reqLower = requestedModel.toLowerCase();

  // 2. Exact case-insensitive match
  const caseMatch = configuredKeys.find((k) => k.toLowerCase() === reqLower);
  if (caseMatch) return caseMatch;

  // 3. Strip date suffix if present (e.g. claude-3-5-sonnet-20241022 -> claude-3-5-sonnet)
  const strippedDate = reqLower.replace(/-\d{8}$/, "");
  const dateMatch = configuredKeys.find((k) => k.toLowerCase() === strippedDate);
  if (dateMatch) return dateMatch;

  // 4. Strip -latest suffix if present (e.g. claude-3-5-sonnet-latest -> claude-3-5-sonnet)
  const strippedLatest = reqLower.replace(/-latest$/, "");
  const latestMatch = configuredKeys.find((k) => k.toLowerCase() === strippedLatest);
  if (latestMatch) return latestMatch;

  // 5. Look for semantic model family keywords (sonnet, haiku, opus)
  for (const keyword of ["sonnet", "haiku", "opus"]) {
    if (reqLower.includes(keyword)) {
      const match = configuredKeys.find((k) => k.toLowerCase().includes(keyword));
      if (match) return match;
    }
  }

  // 6. Look for partial substring match among configured keys
  const partial = configuredKeys.find(
    (k) => reqLower.includes(k.toLowerCase()) || k.toLowerCase().includes(reqLower),
  );
  if (partial) return partial;

  // 7. Fallback to free-auto if defined
  if (models["free-auto"]) {
    return "free-auto";
  }

  // 8. Fallback to default if defined
  if (models["default"]) {
    return "default";
  }

  // 9. Fallback to first configured alias
  return configuredKeys[0];
}

/**
 * Determines whether an upstream HTTP status code should trigger failover
 * to the next candidate. Supports explicit status codes ("404", "429"),
 * HTTP status classes ("4xx", "5xx"), and wildcards ("*", "all").
 */
export function shouldFailover(status: number, failoverOn: string[]): boolean {
  if (status < 400) return false;
  if (!failoverOn || failoverOn.length === 0) return true;
  const statusStr = String(status);
  const statusClass = `${Math.floor(status / 100)}xx`.toLowerCase();
  for (const pattern of failoverOn) {
    const p = pattern.toLowerCase();
    if (p === "*" || p === "all" || p === statusClass || p === statusStr) {
      return true;
    }
  }
  return false;
}

/**
 * Parses tags from header or query string (e.g. "coding,fast" or ["coding", "fast"]).
 */
export function parseTagsHeader(raw?: string | string[] | null): string[] | undefined {
  if (!raw) return undefined;
  const items = Array.isArray(raw) ? raw : raw.split(",");
  const cleaned = items.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}
