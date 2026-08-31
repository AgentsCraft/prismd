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
