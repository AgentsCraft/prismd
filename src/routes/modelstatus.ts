import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getConfig } from "../config.js";
import { selectCandidate, type SelectionContext } from "../core/limits.js";
import { getHealth, getQuota } from "../core/runtime.js";
import { statusBroadcaster, type CandidateChangedEvent, type RequestActivityEvent } from "../core/status-events.js";
import type { HealthManager } from "../core/health.js";
import type { QuotaManager } from "../core/quota.js";
import type { PrismdConfig } from "../types/config.js";

export type CandidateStatus = "healthy" | "rate_limited" | "cooldown" | "unavailable";

export interface CandidateStatusInfo {
  provider: string;
  model: string;
  status: CandidateStatus;
  health: {
    state: "healthy" | "unhealthy" | "half_open";
    consecutiveFailures: number;
    cooldownRemainingMs: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  quota: {
    dailyRequests: {
      used: number | null;
      limit: number | null;
      ratio: number | null;
    };
    inputTokens: number;
    outputTokens: number;
    source: "real" | "estimated" | "mixed";
  };
  contextWindow: number;
  supportsTools: boolean;
  supportsReasoning?: boolean;
  tags: string[];
}

export interface AliasStatusInfo {
  candidates: CandidateStatusInfo[];
  activeCandidate: string | null;
}

export interface ModelStatusResponse {
  timestamp: string;
  uptime: number;
  aliases: Record<string, AliasStatusInfo>;
  latestActivity?: RequestActivityEvent | null;
  inFlightCount?: number;
}

export function computeCandidateStatus(
  healthState: "healthy" | "unhealthy" | "half_open",
  lastError: string | null | undefined,
  quotaRatio: number | null,
): CandidateStatus {
  if (lastError === "auth_error" || lastError === "401" || lastError === "403") {
    return "unavailable";
  }
  if (
    (healthState !== "healthy" && lastError === "429") ||
    (quotaRatio !== null && quotaRatio >= 1.0)
  ) {
    return "rate_limited";
  }
  if (healthState !== "healthy") {
    return "cooldown";
  }
  return "healthy";
}

export function buildModelStatus(
  config: PrismdConfig,
  health: HealthManager,
  quota: QuotaManager,
  now: number = Date.now(),
): ModelStatusResponse {
  const aliases: Record<string, AliasStatusInfo> = {};

  for (const [aliasName, aliasModel] of Object.entries(config.models)) {
    const candidateInfos: CandidateStatusInfo[] = [];

    for (const candidate of aliasModel.candidates) {
      // Trigger any pending cooldown -> half_open transition
      health.isHealthy(candidate.provider, candidate.providerModelId);
      const h = health.get(candidate.provider, candidate.providerModelId);
      const healthState: "healthy" | "unhealthy" | "half_open" =
        h.state === "cooldown" ? "unhealthy" : h.state;
      const cooldownRemainingMs =
        h.cooldownUntil !== null ? Math.max(0, h.cooldownUntil - now) : 0;

      const usage = quota.getUsageSnapshot(candidate.provider, candidate.providerModelId);
      const limit = candidate.limits.dailyRequests;
      let dailyRequests: { used: number | null; limit: number | null; ratio: number | null };

      let quotaRatio: number | null = null;
      if (limit !== null && limit !== undefined) {
        const used = quota.getDailyRequests(candidate.provider, candidate.providerModelId);
        quotaRatio = limit > 0 ? Number((used / limit).toFixed(4)) : 1.0;
        dailyRequests = {
          used,
          limit,
          ratio: quotaRatio,
        };
      } else {
        dailyRequests = {
          used: null,
          limit: null,
          ratio: null,
        };
      }

      const status = computeCandidateStatus(healthState, h.lastError, quotaRatio);

      candidateInfos.push({
        provider: candidate.provider,
        model: candidate.providerModelId,
        status,
        health: {
          state: healthState,
          consecutiveFailures: h.consecutiveFailures,
          cooldownRemainingMs,
          lastError: h.lastError ?? null,
          lastErrorAt: h.lastErrorAt ?? null,
        },
        quota: {
          dailyRequests,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          source: usage.source,
        },
        contextWindow: candidate.contextWindow,
        supportsTools: candidate.supportsTools ?? false,
        supportsReasoning: candidate.supportsReasoning ?? false,
        tags: candidate.tags ?? [],
      });
    }

    const ctx: SelectionContext = {
      inputChars: 0,
      dailyRequests: (p, m) => quota.getDailyRequests(p, m),
      isHealthy: (p, m) => health.isHealthy(p, m),
      quotaSoftLimitRatio: config.policies.quotaSoftLimitRatio,
    };
    const selection = selectCandidate(aliasModel.candidates, ctx);
    const activeCandidate = selection.selected
      ? `${selection.selected.provider}/${selection.selected.providerModelId}`
      : null;

    aliases[aliasName] = {
      candidates: candidateInfos,
      activeCandidate,
    };
  }

  return {
    timestamp: new Date(now).toISOString(),
    uptime: Math.floor(process.uptime()),
    aliases,
    latestActivity: statusBroadcaster.getLatestActivity(),
    inFlightCount: statusBroadcaster.getInFlightCount(),
  };
}

export const modelstatusRoute = new Hono();

modelstatusRoute.get("/v1/modelstatus", (c) => {
  const status = buildModelStatus(getConfig(), getHealth(), getQuota());
  return c.json(status, 200);
});

modelstatusRoute.post("/v1/usage/reset", (c) => {
  getQuota().resetAll();
  statusBroadcaster.emit("candidate_changed", {
    provider: "all",
    model: "all",
    from: "any",
    to: "reset",
    reason: "usage_reset",
    at: new Date().toISOString(),
  });
  return c.json({ ok: true, message: "Usage counters and request logs reset successfully" }, 200);
});

modelstatusRoute.get("/v1/modelstatus/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    // 1. Initial snapshot
    const initial = buildModelStatus(getConfig(), getHealth(), getQuota());
    await stream.writeSSE({
      event: "status",
      data: JSON.stringify(initial),
    });

    let done = false;
    const signal = c.req.raw.signal;

    // 2. Incremental candidate_changed listener
    const listener = async (event: CandidateChangedEvent) => {
      if (done || stream.aborted || signal?.aborted) return;
      try {
        await stream.writeSSE({
          event: "candidate_changed",
          data: JSON.stringify(event),
        });
      } catch {
        done = true;
      }
    };

    const activityListener = async (event: RequestActivityEvent) => {
      if (done || stream.aborted || signal?.aborted) return;
      try {
        await stream.writeSSE({
          event: "request_activity",
          data: JSON.stringify(event),
        });
      } catch {
        done = true;
      }
    };

    statusBroadcaster.on("candidate_changed", listener);
    statusBroadcaster.on("request_activity", activityListener);

    // 3. Heartbeat every 30s
    const timer = setInterval(async () => {
      if (done || stream.aborted || signal?.aborted) {
        clearInterval(timer);
        return;
      }
      try {
        const full = buildModelStatus(getConfig(), getHealth(), getQuota());
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify(full),
        });
      } catch {
        done = true;
        clearInterval(timer);
      }
    }, 30_000);
    timer.unref();

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        done = true;
        resolve();
      });
      signal?.addEventListener(
        "abort",
        () => {
          done = true;
          resolve();
        },
        { once: true },
      );
    });

    clearInterval(timer);
    statusBroadcaster.off("candidate_changed", listener);
    statusBroadcaster.off("request_activity", activityListener);
  });
});
