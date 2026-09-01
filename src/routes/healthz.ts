import { Hono } from "hono";
import { getConfig } from "../config.js";
import { getHealth } from "../core/runtime.js";
import type { HealthManager } from "../core/health.js";
import type { PrismdConfig } from "../types/config.js";

export interface HealthzCandidate {
  provider: string;
  model: string;
  state: string;
  consecutiveFailures: number;
  lastError?: string;
}

export interface HealthzAuthError {
  provider: string;
  model: string;
  error: string;
}

export interface HealthzResponse {
  status: "ok" | "degraded";
  uptime: number;
  timestamp: string;
  candidates: HealthzCandidate[];
  authErrors?: HealthzAuthError[];
}

export function buildHealthz(config: PrismdConfig, health: HealthManager): HealthzResponse {
  const candidates: HealthzCandidate[] = [];
  const authErrors: HealthzAuthError[] = [];
  const seen = new Set<string>();

  for (const aliasModel of Object.values(config.models)) {
    for (const candidate of aliasModel.candidates) {
      const key = `${candidate.provider}\u0000${candidate.providerModelId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Probe check to refresh expired cooldown state to half-open
      health.isHealthy(candidate.provider, candidate.providerModelId);
      const h = health.get(candidate.provider, candidate.providerModelId);
      candidates.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        state: h.state,
        consecutiveFailures: h.consecutiveFailures,
        lastError: h.lastError,
      });
      if (h.lastError === "auth_error") {
        authErrors.push({
          provider: candidate.provider,
          model: candidate.providerModelId,
          error: "auth_error (check API key / .env)",
        });
      }
    }
  }

  return {
    status: authErrors.length > 0 ? "degraded" : "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    candidates,
    ...(authErrors.length > 0 ? { authErrors } : {}),
  };
}

export const healthzRoute = new Hono();

healthzRoute.get("/healthz", (c) => {
  const healthz = buildHealthz(getConfig(), getHealth());
  return c.json(healthz, 200);
});
