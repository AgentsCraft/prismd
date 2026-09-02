import { logger } from "../observability/logger.js";
import type { HealthManager } from "./health.js";
import type { KeyPool } from "./key-pool.js";
import type { PrismdConfig } from "../types/config.js";

export interface ModelValidationResult {
  provider: string;
  configuredModels: string[];
  availableModels: string[];
  missingModels: string[];
  status: "ok" | "model_missing" | "auth_error" | "unreachable";
  error?: string;
}

export interface UpstreamModelMeta {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Probes the upstream provider's /models endpoint to fetch active models and parameters.
 * Non-blocking, short timeout, uses 0 tokens/quota.
 */
export async function fetchProviderModels(
  _providerName: string,
  baseUrl: string,
  apiKey?: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs: number = 5000,
): Promise<{
  ok: boolean;
  models: string[];
  metadata: Map<string, UpstreamModelMeta>;
  status: number;
  error?: string;
}> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extraHeaders,
    };
    if (apiKey && apiKey !== "none") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, models: [], metadata: new Map(), status: res.status, error: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as any;
    const modelList: string[] = [];
    const metadata = new Map<string, UpstreamModelMeta>();

    const parseItem = (item: any) => {
      if (!item || typeof item !== "object") return;
      const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : undefined;
      if (!id) return;
      modelList.push(id);

      const contextWindow =
        typeof item.context_length === "number"
          ? item.context_length
          : typeof item.context_window === "number"
            ? item.context_window
            : typeof item.top_provider?.context_length === "number"
              ? item.top_provider.context_length
              : undefined;

      const maxOutputTokens =
        typeof item.max_completion_tokens === "number"
          ? item.max_completion_tokens
          : typeof item.max_output_tokens === "number"
            ? item.max_output_tokens
            : typeof item.top_provider?.max_completion_tokens === "number"
              ? item.top_provider.max_completion_tokens
              : undefined;

      metadata.set(id, { id, contextWindow, maxOutputTokens });
    };

    if (Array.isArray(json.data)) {
      for (const item of json.data) parseItem(item);
    } else if (Array.isArray(json.models)) {
      for (const item of json.models) parseItem(item);
    }

    return { ok: true, models: modelList, metadata, status: 200 };
  } catch (err: any) {
    return { ok: false, models: [], metadata: new Map(), status: 0, error: err.message };
  }
}

/**
 * Validates configured candidates against upstream model catalogs asynchronously.
 * Marks missing models as unavailable in HealthManager to prevent requests from failing.
 */
export async function validateUpstreamModels(
  config: PrismdConfig,
  health: HealthManager,
  keyPool: KeyPool,
): Promise<ModelValidationResult[]> {
  const results: ModelValidationResult[] = [];
  const providersChecked = new Set<string>();

  // Collect configured models grouped by provider
  const providerModelsMap = new Map<string, Set<string>>();
  for (const aliasModel of Object.values(config.models)) {
    for (const candidate of aliasModel.candidates) {
      let set = providerModelsMap.get(candidate.provider);
      if (!set) {
        set = new Set();
        providerModelsMap.set(candidate.provider, set);
      }
      set.add(candidate.providerModelId);
    }
  }

  for (const [providerName, configuredSet] of providerModelsMap.entries()) {
    const providerDef = config.providers[providerName];
    if (!providerDef) continue;
    if (providersChecked.has(providerName)) continue;
    providersChecked.add(providerName);

    const configuredModels = Array.from(configuredSet);
    const apiKey = keyPool.getNextKey(providerName);

    // Skip if provider requires API key but none is configured
    if (providerDef.auth?.type !== "none" && !apiKey) {
      continue;
    }

    const { ok, models, metadata, status, error } = await fetchProviderModels(
      providerName,
      providerDef.baseUrl,
      apiKey,
      providerDef.extraHeaders,
    );

    if (ok) {
      const availableSet = new Set(models);
      const missing: string[] = [];

      for (const configuredModel of configuredModels) {
        // Match exact or prefix if vendor includes namespace
        const found = availableSet.has(configuredModel);
        if (!found) {
          missing.push(configuredModel);
          // Mark in HealthManager so router automatically excludes it
          health.recordFailure(providerName, configuredModel, { status: 404 });
          logger.warn(
            { provider: providerName, model: configuredModel },
            `upstream model not found in provider catalog (marked unavailable in router; update prismd.json to fix)`,
          );
        }
      }

      // Auto-hydrate upstream metadata (contextWindow, maxOutputTokens) into candidate config
      for (const aliasModel of Object.values(config.models)) {
        for (const candidate of aliasModel.candidates) {
          if (candidate.provider !== providerName) continue;
          const meta = metadata.get(candidate.providerModelId);
          if (meta) {
            if (typeof meta.contextWindow === "number" && meta.contextWindow > 0 && meta.contextWindow !== candidate.contextWindow) {
              logger.info(
                {
                  provider: providerName,
                  model: candidate.providerModelId,
                  from: candidate.contextWindow,
                  to: meta.contextWindow,
                },
                "auto-synced model contextWindow from upstream",
              );
              candidate.contextWindow = meta.contextWindow;
            }
            if (typeof meta.maxOutputTokens === "number" && meta.maxOutputTokens > 0 && meta.maxOutputTokens !== candidate.maxOutputTokens) {
              logger.info(
                {
                  provider: providerName,
                  model: candidate.providerModelId,
                  from: candidate.maxOutputTokens,
                  to: meta.maxOutputTokens,
                },
                "auto-synced model maxOutputTokens from upstream",
              );
              candidate.maxOutputTokens = meta.maxOutputTokens;
            }
          }
        }
      }

      if (missing.length > 0) {
        results.push({
          provider: providerName,
          configuredModels,
          availableModels: models,
          missingModels: missing,
          status: "model_missing",
        });
      } else {
        results.push({
          provider: providerName,
          configuredModels,
          availableModels: models,
          missingModels: [],
          status: "ok",
        });
      }
    } else if (status === 401 || status === 403) {
      for (const configuredModel of configuredModels) {
        health.recordFailure(providerName, configuredModel, { status: 401 });
      }
      logger.warn(
        { provider: providerName, status },
        `upstream provider authentication failed during catalog check`,
      );
      results.push({
        provider: providerName,
        configuredModels,
        availableModels: [],
        missingModels: [],
        status: "auth_error",
        error,
      });
    } else {
      logger.debug(
        { provider: providerName, error },
        `upstream catalog check skipped or unreachable`,
      );
      results.push({
        provider: providerName,
        configuredModels,
        availableModels: [],
        missingModels: [],
        status: "unreachable",
        error,
      });
    }
  }

  return results;
}
