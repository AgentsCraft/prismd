/**
 * Passive health checking (M2a): per (provider, model) in-memory state
 * machine, no active probes (they would burn free quota). State resets on
 * restart by design — cheap to re-learn, no persistence complexity.
 *
 *   healthy  --failures >= failThreshold-->  cooldown (unhealthy)
 *   cooldown --cooldown elapsed-->           half_open (1 probe allowed)
 *   half_open --probe success-->             healthy
 *   half_open --probe failure-->             cooldown (re-cooled)
 *
 * A 429 with Retry-After (when respectRetryAfter) cools down for
 * max(cooldownMs, Retry-After). 401/403 record a lastError so /healthz
 * (M2b) and logs can highlight broken keys. State changes are emitted
 * through an EventEmitter for M2b SSE reuse.
 */
import { EventEmitter } from "node:events";

export type HealthState = "healthy" | "cooldown" | "half_open";

export interface CandidateHealth {
  state: HealthState;
  /** Consecutive failure count (reset to 0 on a successful probe). */
  consecutiveFailures: number;
  /** Absolute timestamp (ms) when the current cooldown ends, if cooling. */
  cooldownUntil: number | null;
  /** "auth_error", "429", status code, or undefined. */
  lastError?: string;
  /** ISO timestamp when the last failure occurred, or null. */
  lastErrorAt?: string | null;
}

export interface HealthOptions {
  /** Consecutive failures before a candidate goes into cooldown. */
  failThreshold?: number;
  /** Base cooldown duration in ms. */
  cooldownMs?: number;
  /** Honor upstream Retry-After headers on 429 (cooldown = max(base, retry-after)). */
  respectRetryAfter?: boolean;
  /** Clock injection for tests. */
  now?: () => number;
  /** Optional KeyPool integration for multi-key providers */
  keyPool?: {
    isProviderHealthy(provider: string): boolean;
    getProviderHealth(provider: string, model: string): CandidateHealth;
    hasKeys(provider: string): boolean;
    on(event: string, listener: (event: { provider: string; model: string; health: CandidateHealth }) => void): void;
  };
}

export interface RecordFailureInput {
  /** Upstream HTTP status (401/403 flag auth errors; 429 may carry Retry-After). */
  status?: number;
  /** Retry-After header parsed to ms, when present. */
  retryAfterMs?: number;
}

export const AUTH_ERROR = "auth_error";

const DEFAULT_FAIL_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

function keyOf(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

export class HealthManager extends EventEmitter {
  private readonly states = new Map<string, CandidateHealth>();
  private readonly options: Required<Omit<HealthOptions, "keyPool">> & {
    keyPool?: HealthOptions["keyPool"];
  };

  constructor(options: HealthOptions = {}) {
    super();
    this.options = {
      failThreshold: options.failThreshold ?? DEFAULT_FAIL_THRESHOLD,
      cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      respectRetryAfter: options.respectRetryAfter ?? true,
      now: options.now ?? (() => Date.now()),
      keyPool: options.keyPool,
    };
    if (this.options.keyPool) {
      this.options.keyPool.on("change", (event: { provider: string; model: string; health: CandidateHealth }) => {
        this.emit("change", event);
      });
    }
  }

  /** Current (possibly defaulted) health record for a candidate. */
  get(provider: string, model: string): CandidateHealth {
    const key = keyOf(provider, model);
    const entry = this.states.get(key);
    if (entry && (entry.state !== "healthy" || entry.lastError || entry.consecutiveFailures > 0)) {
      if (entry.state === "cooldown" && this.options.now() >= (entry.cooldownUntil ?? 0)) {
        entry.state = "half_open";
        this.emit("change", { provider, model, health: this.snapshot(entry) });
      }
      return this.snapshot(entry);
    }
    if (this.options.keyPool && this.options.keyPool.hasKeys(provider)) {
      const poolHealth = this.options.keyPool.getProviderHealth(provider, model);
      if (poolHealth.state !== "healthy" || poolHealth.lastError || poolHealth.consecutiveFailures > 0) {
        return poolHealth;
      }
    }
    if (entry) return this.snapshot(entry);
    return { state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastErrorAt: null };
  }

  /**
   * Earliest absolute timestamp (ms) at which the candidate may serve again,
   * or null when it can serve now (healthy / half-open probe) or nothing is
   * cooling down. Merges KeyPool per-key cooldowns via get().
   */
  earliestRecoveryAt(provider: string, model: string): number | null {
    const health = this.get(provider, model);
    if (health.state === "cooldown" && health.cooldownUntil !== null && health.cooldownUntil > this.options.now()) {
      return health.cooldownUntil;
    }
    return null;
  }

  /** True when a candidate may serve requests (healthy, or half-open probe). */
  isHealthy(provider: string, model: string): boolean {
    const key = keyOf(provider, model);
    const entry = this.states.get(key);
    if (entry) {
      if (entry.lastError === "model_not_found" || entry.lastError === AUTH_ERROR) {
        return false;
      }
      if (entry.state === "cooldown") {
        if (this.options.now() >= (entry.cooldownUntil ?? 0)) {
          entry.state = "half_open";
          this.emit("change", { provider, model, health: this.snapshot(entry) });
        } else {
          return false;
        }
      }
    }
    if (this.options.keyPool && this.options.keyPool.hasKeys(provider)) {
      if (!this.options.keyPool.isProviderHealthy(provider)) {
        return false;
      }
    }
    return true; // half_open: allow the single probe
  }

  /** Record a candidate failure; moves toward cooldown per the state machine. */
  recordFailure(provider: string, model: string, input: RecordFailureInput = {}): CandidateHealth {
    const key = keyOf(provider, model);
    let entry = this.states.get(key);
    if (!entry) {
      entry = { state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastErrorAt: null };
      this.states.set(key, entry);
    }

    const { now, cooldownMs, failThreshold, respectRetryAfter } = this.options;
    const currentNow = now();
    entry.consecutiveFailures += 1;
    entry.lastErrorAt = new Date(currentNow).toISOString();

    if (input.status === 401 || input.status === 403) {
      entry.lastError = AUTH_ERROR;
    } else if (input.status === 429) {
      entry.lastError = "429";
    } else if (input.status === 404 || input.status === 410) {
      entry.lastError = "model_not_found";
    } else if (input.status !== undefined) {
      entry.lastError = String(input.status);
    }

    let coolFor = cooldownMs;
    if (input.status === 429 && respectRetryAfter && input.retryAfterMs !== undefined) {
      coolFor = Math.max(cooldownMs, input.retryAfterMs);
    }

    if (
      entry.state === "healthy" &&
      entry.consecutiveFailures < failThreshold &&
      input.status !== 404 &&
      input.status !== 410 &&
      input.status !== 401 &&
      input.status !== 403
    ) {
      this.emit("change", { provider, model, health: this.snapshot(entry) });
      return this.snapshot(entry);
    }
    // Failures above the threshold (or 404/410/401/403 or any failure in half-open) re-cool.
    entry.state = "cooldown";
    entry.cooldownUntil = currentNow + (input.status === 404 || input.status === 410 ? 86400_000 : coolFor);
    this.emit("change", { provider, model, health: this.snapshot(entry) });
    return this.snapshot(entry);
  }

  /** Record a success; resets the failure count and lastError. */
  recordSuccess(provider: string, model: string): CandidateHealth {
    const key = keyOf(provider, model);
    const entry = this.states.get(key);
    if (!entry) {
      const fresh: CandidateHealth = { state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastErrorAt: null };
      this.states.set(key, fresh);
      return this.snapshot(fresh);
    }
    entry.state = "healthy";
    entry.consecutiveFailures = 0;
    entry.cooldownUntil = null;
    entry.lastError = undefined;
    entry.lastErrorAt = null;
    this.emit("change", { provider, model, health: this.snapshot(entry) });
    return this.snapshot(entry);
  }

  /** Test-only: reset all state. */
  reset(): void {
    this.states.clear();
  }

  private snapshot(entry: CandidateHealth): CandidateHealth {
    return { ...entry };
  }
}
