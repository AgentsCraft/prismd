import type { AliasModel, Candidate } from "../types/config.js";

/**
 * Resolve a model alias to its ordered candidate list. Order is exactly
 * as written in the config — no sorting or filtering here. Quota, health
 * and context-window filtering land on top of this in M2.
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
