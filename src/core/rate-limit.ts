import type { Candidate } from "../types/config.js";

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: "rpm_exceeded" | "concurrency_exceeded";
  currentConcurrent: number;
  maxConcurrent: number;
  currentRpm: number;
  maxRpm: number;
}

export class RateLimiter {
  private concurrent = new Map<string, number>();
  private timestamps = new Map<string, number[]>();

  private key(provider: string, model: string): string {
    return `${provider}\u0000${model}`;
  }

  /**
   * Check whether a candidate currently has available capacity under both
   * concurrency semaphore and rolling 60-second RPM window.
   */
  public check(candidate: Candidate, now = Date.now()): RateLimitCheckResult {
    const k = this.key(candidate.provider, candidate.providerModelId);
    const windowStart = now - 60_000;
    const tsList = (this.timestamps.get(k) ?? []).filter((t) => t > windowStart);
    this.timestamps.set(k, tsList);

    const curConcurrent = this.concurrent.get(k) ?? 0;
    const maxConcurrent = candidate.limits.maxConcurrent;
    if (maxConcurrent > 0 && curConcurrent >= maxConcurrent) {
      return {
        allowed: false,
        reason: "concurrency_exceeded",
        currentConcurrent: curConcurrent,
        maxConcurrent,
        currentRpm: tsList.length,
        maxRpm: candidate.limits.rpm,
      };
    }

    const maxRpm = candidate.limits.rpm;
    if (maxRpm > 0 && tsList.length >= maxRpm) {
      return {
        allowed: false,
        reason: "rpm_exceeded",
        currentConcurrent: curConcurrent,
        maxConcurrent,
        currentRpm: tsList.length,
        maxRpm,
      };
    }

    return {
      allowed: true,
      currentConcurrent: curConcurrent,
      maxConcurrent,
      currentRpm: tsList.length,
      maxRpm,
    };
  }

  /**
   * Atomically acquire a concurrency slot and record an RPM timestamp.
   * Returns false if limits are exceeded.
   */
  public acquire(candidate: Candidate, now = Date.now()): boolean {
    const res = this.check(candidate, now);
    if (!res.allowed) {
      return false;
    }
    const k = this.key(candidate.provider, candidate.providerModelId);
    this.concurrent.set(k, (this.concurrent.get(k) ?? 0) + 1);
    const tsList = this.timestamps.get(k) ?? [];
    tsList.push(now);
    this.timestamps.set(k, tsList);
    return true;
  }

  /**
   * Release an acquired concurrency slot once the request completes or streams finish.
   */
  public release(candidate: Candidate): void {
    const k = this.key(candidate.provider, candidate.providerModelId);
    const cur = this.concurrent.get(k) ?? 0;
    if (cur > 1) {
      this.concurrent.set(k, cur - 1);
    } else {
      this.concurrent.delete(k);
    }
  }

  /**
   * Reset all counters (test utility).
   */
  public reset(): void {
    this.concurrent.clear();
    this.timestamps.clear();
  }
}
