import { EventEmitter } from "node:events";
import type { CandidateHealth } from "./health.js";

export interface CandidateChangedEvent {
  provider: string;
  model: string;
  field: string;
  from: string | number;
  to: string | number;
  reason?: string;
  at: string;
}

export interface RequestActivityEvent {
  type?: "request_activity";
  requestId: string;
  alias: string;
  provider: string;
  model: string;
  status: "in_flight" | "completed" | "failed";
  statusCode?: number;
  durationMs?: number;
  failovers: number;
  at: string;
}

export class StatusBroadcaster extends EventEmitter {
  private lastHealthStates = new Map<string, string>();
  private lastQuotaRatios = new Map<string, number>();
  private latestActivity: RequestActivityEvent | null = null;
  private inFlightCount = 0;

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  notifyRequestActive(info: {
    requestId: string;
    alias: string;
    provider: string;
    model: string;
    failovers: number;
  }): void {
    this.inFlightCount += 1;
    const event: RequestActivityEvent = {
      type: "request_activity",
      requestId: info.requestId,
      alias: info.alias,
      provider: info.provider,
      model: info.model,
      status: "in_flight",
      failovers: info.failovers,
      at: new Date().toISOString(),
    };
    this.latestActivity = event;
    this.emit("request_activity", event);
  }

  notifyRequestCompleted(info: {
    requestId: string;
    alias: string;
    provider: string;
    model: string;
    status: number;
    durationMs: number;
    failovers: number;
  }): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    const event: RequestActivityEvent = {
      type: "request_activity",
      requestId: info.requestId,
      alias: info.alias,
      provider: info.provider,
      model: info.model,
      status: info.status >= 200 && info.status < 400 ? "completed" : "failed",
      statusCode: info.status,
      durationMs: info.durationMs,
      failovers: info.failovers,
      at: new Date().toISOString(),
    };
    this.latestActivity = event;
    this.emit("request_activity", event);
  }

  notifyRequestFailed(info: {
    requestId: string;
    alias: string;
    provider: string;
    model: string;
    status: number;
    durationMs: number;
    failovers: number;
  }): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    const event: RequestActivityEvent = {
      type: "request_activity",
      requestId: info.requestId,
      alias: info.alias,
      provider: info.provider,
      model: info.model,
      status: "failed",
      statusCode: info.status,
      durationMs: info.durationMs,
      failovers: info.failovers,
      at: new Date().toISOString(),
    };
    this.latestActivity = event;
    this.emit("request_activity", event);
  }

  getLatestActivity(): RequestActivityEvent | null {
    return this.latestActivity;
  }

  getInFlightCount(): number {
    return this.inFlightCount;
  }

  notifyHealthChange(provider: string, model: string, health: CandidateHealth): void {
    const key = `${provider}\u0000${model}`;
    const prev = this.lastHealthStates.get(key) ?? "healthy";
    const current = health.state === "cooldown" ? "unhealthy" : health.state;
    this.lastHealthStates.set(key, current);

    if (prev !== current || health.lastError) {
      const evt: CandidateChangedEvent = {
        provider,
        model,
        field: "health.state",
        from: prev,
        to: current,
        reason: health.lastError ?? (current === "healthy" ? "recovered" : "failure"),
        at: health.lastErrorAt ?? new Date().toISOString(),
      };
      this.emit("candidate_changed", evt);
    }
  }

  notifyQuotaChange(
    provider: string,
    model: string,
    used: number,
    limit: number | null,
    softLimitRatio: number = 0.8,
  ): void {
    if (limit === null || limit <= 0) return;
    const key = `${provider}\u0000${model}`;
    const prevRatio = this.lastQuotaRatios.get(key) ?? 0;
    const currentRatio = used / limit;
    this.lastQuotaRatios.set(key, currentRatio);

    if (prevRatio < 1.0 && currentRatio >= 1.0) {
      this.emit("candidate_changed", {
        provider,
        model,
        field: "quota.dailyRequests",
        from: `${Math.floor(prevRatio * 100)}%`,
        to: "100%",
        reason: "quota_exhausted",
        at: new Date().toISOString(),
      });
    } else if (prevRatio < softLimitRatio && currentRatio >= softLimitRatio) {
      this.emit("candidate_changed", {
        provider,
        model,
        field: "quota.dailyRequests",
        from: `${Math.floor(prevRatio * 100)}%`,
        to: `${Math.floor(currentRatio * 100)}%`,
        reason: "soft_limit",
        at: new Date().toISOString(),
      });
    }
  }

  reset(): void {
    this.lastHealthStates.clear();
    this.lastQuotaRatios.clear();
    this.latestActivity = null;
    this.inFlightCount = 0;
    this.removeAllListeners();
  }
}

export const statusBroadcaster = new StatusBroadcaster();
