/**
 * Key Pool & Sharding (M5):
 * - Round-robin scheduling across multiple API keys per provider
 * - Single-key circuit breaking & cooldown isolation
 * - Seamless in-candidate failover when a key encounters 429/5xx/auth errors
 */
import { EventEmitter } from "node:events";
import { resolveProviderApiKeys, getConfig } from "../config.js";
import { AUTH_ERROR, type CandidateHealth, type RecordFailureInput } from "./health.js";

export type KeyHealthState = "healthy" | "cooldown" | "half_open";

export interface KeyHealth {
  key: string;
  state: KeyHealthState;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  lastError?: string;
  lastErrorAt?: string | null;
}

export interface KeyPoolOptions {
  failThreshold?: number;
  cooldownMs?: number;
  respectRetryAfter?: boolean;
  now?: () => number;
  keyResolver?: (field: string) => string[];
  providerResolver?: (provider: string) => { apiKeyField?: string; auth?: { type?: string } } | undefined;
}

const DEFAULT_FAIL_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

function keyStateId(provider: string, key: string): string {
  return `${provider}\u0000${key}`;
}

export class KeyPool extends EventEmitter {
  private readonly cursors = new Map<string, number>();
  private readonly states = new Map<string, KeyHealth>();
  private readonly options: Required<Omit<KeyPoolOptions, "keyResolver" | "providerResolver">> & {
    keyResolver?: (field: string) => string[];
    providerResolver?: (provider: string) => { apiKeyField?: string; auth?: { type?: string } } | undefined;
  };

  constructor(options: KeyPoolOptions = {}) {
    super();
    this.options = {
      failThreshold: options.failThreshold ?? DEFAULT_FAIL_THRESHOLD,
      cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      respectRetryAfter: options.respectRetryAfter ?? true,
      now: options.now ?? (() => Date.now()),
      keyResolver: options.keyResolver,
      providerResolver: options.providerResolver,
    };
  }

  getKeys(provider: string): string[] {
    const keyResolver = this.options.keyResolver;
    if (this.options.providerResolver) {
      const def = this.options.providerResolver(provider);
      if (def?.auth?.type === "none") return ["none"];
      if (!def?.apiKeyField) return [];
      return keyResolver ? keyResolver(def.apiKeyField) : resolveProviderApiKeys(def.apiKeyField);
    }
    if (keyResolver) {
      try {
        const config = getConfig();
        const def = config.providers[provider];
        if (def?.auth?.type === "none") return ["none"];
        if (!def?.apiKeyField) return [];
        return keyResolver(def.apiKeyField);
      } catch {
        // Fallback: pass provider directly as field name
        return keyResolver(provider);
      }
    }
    try {
      const config = getConfig();
      const def = config.providers[provider];
      if (def?.auth?.type === "none") return ["none"];
      if (!def?.apiKeyField) return [];
      return resolveProviderApiKeys(def.apiKeyField);
    } catch {
      return [];
    }
  }

  hasKeys(provider: string): boolean {
    if (this.options.providerResolver) {
      const def = this.options.providerResolver(provider);
      if (def?.auth?.type && def.auth.type !== "api_key") return true;
      if (!def?.apiKeyField) return true;
    } else {
      try {
        const config = getConfig();
        const def = config.providers[provider];
        if (def?.auth?.type && def.auth.type !== "api_key") return true;
        if (!def?.apiKeyField) return true;
      } catch {
        // continue
      }
    }
    return this.getKeys(provider).length > 0;
  }

  getKeyHealth(provider: string, key: string): KeyHealth {
    const id = keyStateId(provider, key);
    const existing = this.states.get(id);
    if (existing) return { ...existing };
    return {
      key,
      state: "healthy",
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastErrorAt: null,
    };
  }

  isKeyHealthy(provider: string, key: string): boolean {
    const id = keyStateId(provider, key);
    const entry = this.states.get(id);
    if (!entry) return true;
    if (entry.state === "healthy") return true;
    if (entry.state === "cooldown") {
      if (this.options.now() >= (entry.cooldownUntil ?? 0)) {
        entry.state = "half_open";
        this.emit("keyChange", { provider, key, health: { ...entry } });
        return true;
      }
      return false;
    }
    return true; // half_open probe
  }

  getNextKey(provider: string, excludeKeys?: Set<string>): string | undefined {
    const keys = this.getKeys(provider);
    if (keys.length === 0) return undefined;

    const startIdx = this.cursors.get(provider) ?? 0;
    const len = keys.length;

    for (let offset = 0; offset < len; offset += 1) {
      const idx = (startIdx + offset) % len;
      const key = keys[idx];
      if (excludeKeys?.has(key)) continue;

      if (this.isKeyHealthy(provider, key)) {
        this.cursors.set(provider, (idx + 1) % len);
        return key;
      }
    }

    return undefined;
  }

  isProviderHealthy(provider: string): boolean {
    const keys = this.getKeys(provider);
    if (keys.length === 0) {
      return this.hasKeys(provider);
    }
    return keys.some((key) => this.isKeyHealthy(provider, key));
  }

  recordFailure(
    provider: string,
    model: string,
    key: string,
    input: RecordFailureInput = {},
  ): KeyHealth {
    const id = keyStateId(provider, key);
    let entry = this.states.get(id);
    if (!entry) {
      entry = {
        key,
        state: "healthy",
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastErrorAt: null,
      };
      this.states.set(id, entry);
    }

    const { now, cooldownMs, failThreshold, respectRetryAfter } = this.options;
    const currentNow = now();
    entry.consecutiveFailures += 1;
    entry.lastErrorAt = new Date(currentNow).toISOString();

    if (input.status === 401 || input.status === 403) {
      entry.lastError = AUTH_ERROR;
    } else if (input.status === 429) {
      entry.lastError = "429";
    } else if (input.status !== undefined) {
      entry.lastError = String(input.status);
    }

    let coolFor = cooldownMs;
    if (input.status === 429 && respectRetryAfter && input.retryAfterMs !== undefined) {
      coolFor = Math.max(cooldownMs, input.retryAfterMs);
    }

    if (entry.state === "healthy" && entry.consecutiveFailures < failThreshold) {
      this.emit("keyChange", { provider, key, health: { ...entry } });
      this.emitCandidateChange(provider, model);
      return { ...entry };
    }

    entry.state = "cooldown";
    entry.cooldownUntil = currentNow + coolFor;
    this.emit("keyChange", { provider, key, health: { ...entry } });
    this.emitCandidateChange(provider, model);
    return { ...entry };
  }

  recordSuccess(provider: string, model: string, key: string): KeyHealth {
    const id = keyStateId(provider, key);
    const entry = this.states.get(id);
    if (!entry) {
      const fresh: KeyHealth = {
        key,
        state: "healthy",
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastErrorAt: null,
      };
      this.states.set(id, fresh);
      return { ...fresh };
    }
    entry.state = "healthy";
    entry.consecutiveFailures = 0;
    entry.cooldownUntil = null;
    entry.lastError = undefined;
    entry.lastErrorAt = null;
    this.emit("keyChange", { provider, key, health: { ...entry } });
    this.emitCandidateChange(provider, model);
    return { ...entry };
  }

  getProviderHealth(provider: string, _model: string): CandidateHealth {
    const keys = this.getKeys(provider);
    if (keys.length === 0) {
      return { state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastErrorAt: null };
    }

    const healths = keys.map((k) => {
      this.isKeyHealthy(provider, k);
      return this.getKeyHealth(provider, k);
    });

    const anyHealthy = healths.some((h) => h.state === "healthy");
    if (anyHealthy) {
      return { state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastErrorAt: null };
    }

    const anyHalfOpen = healths.some((h) => h.state === "half_open");
    if (anyHalfOpen) {
      const maxFailures = Math.max(...healths.map((h) => h.consecutiveFailures));
      const lastErr = healths.find((h) => h.lastError)?.lastError;
      return { state: "half_open", consecutiveFailures: maxFailures, cooldownUntil: null, lastError: lastErr, lastErrorAt: null };
    }

    const cooldownUntils = healths
      .map((h) => h.cooldownUntil)
      .filter((u): u is number => u !== null);
    const earliestCooldown = cooldownUntils.length > 0 ? Math.min(...cooldownUntils) : null;
    const maxFailures = Math.max(...healths.map((h) => h.consecutiveFailures));
    const lastErr = healths.find((h) => h.lastError)?.lastError;
    const lastErrAt = healths.find((h) => h.lastErrorAt)?.lastErrorAt ?? null;

    return {
      state: "cooldown",
      consecutiveFailures: maxFailures,
      cooldownUntil: earliestCooldown,
      lastError: lastErr,
      lastErrorAt: lastErrAt,
    };
  }

  private emitCandidateChange(provider: string, model: string): void {
    const health = this.getProviderHealth(provider, model);
    this.emit("change", { provider, model, health });
  }

  reset(): void {
    this.cursors.clear();
    this.states.clear();
  }
}
