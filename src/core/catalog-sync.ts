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

/**
 * Probes the upstream provider's /models endpoint to fetch active models.
 * Non-blocking, short timeout, uses 0 tokens/quota.
 */
export async function fetchProviderModels(
  _providerName: string,
  baseUrl: string,
  apiKey?: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs: number = 5000,
): Promise<{ ok: boolean; models: string[]; status: number; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {
      "Accept": "application/json",
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
      return { ok: false, models: [], status: res.status, error: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as any;
    const modelList: string[] = [];
    if (Array.isArray(json.data)) {
      for (const item of json.data) {
        if (item && typeof item.id === "string") {
          modelList.push(item.id);
        } else if (item && typeof item.name === "string") {
          modelList.push(item.name);
        }
      }
    } else if (Array.isArray(json.models)) {
      for (const item of json.models) {
        if (item && typeof item.name === "string") {
          modelList.push(item.name);
        }
      }
    }

    return { ok: true, models: modelList, status: 200 };
  } catch (err: any) {
    return { ok: false, models: [], status: 0, error: err.message };
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

    const { ok, models, status, error } = await fetchProviderModels(
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
