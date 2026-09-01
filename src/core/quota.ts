/**
 * Quota accounting (M2a): in-memory accumulation per (date, provider,
 * model), flushed to SQLite asynchronously every flushIntervalMs or when
 * flushBatchSize pending records accumulate — never blocking the request
 * path. Flush failures only log a warning. Graceful shutdown forces a
 * final flush.
 *
 * The in-memory accumulator keeps the full day (seeded from usage_daily
 * at startup, never cleared), so routing decisions always see the real
 * total; each flush writes only the delta since the last successful
 * flush and SQLite's ON CONFLICT keeps accumulating across restarts.
 *
 * Usage: real upstream numbers when available, otherwise conservative
 * estimates (request body chars / 4 for input, accumulated SSE output
 * chars / 4). The per-day source column is real | estimated | mixed.
 */
import { logger } from "../observability/logger.js";
import { StateStore, type RequestLogEntry, type UsageRow } from "./state.js";

export type UsageSource = "real" | "estimated" | "mixed";

export interface UsageRecord {
  /** Real input tokens from upstream usage; omit to estimate. */
  inputTokens?: number;
  /** Real output tokens from upstream usage; omit to estimate. */
  outputTokens?: number;
  /** Request body char count used for the input estimate. */
  inputChars: number;
  /** Output char count used for the output estimate. */
  outputChars: number;
}

export interface RequestLogInput {
  requestId: string;
  ts: string;
  alias: string;
  provider: string;
  model: string;
  status: number;
  failover: number;
  durationMs: number;
  usage: UsageRecord;
}

interface Accumulator {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Any real token value seen for this day (input or output). */
  sawReal: boolean;
  /** Any estimated token value seen for this day (input or output). */
  sawEstimated: boolean;
}

/** The part of an accumulator already persisted to usage_daily. */
interface FlushedSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CandidateUsageSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  source: UsageSource;
}

export interface QuotaManagerOptions {
  store: StateStore;
  /** Flush interval in ms (default 5000). */
  flushIntervalMs?: number;
  /** Pending record count triggering an immediate flush (default 20). */
  flushBatchSize?: number;
  now?: () => Date;
  onRecord?: (provider: string, model: string, usedRequests: number) => void;
}

export const TOKENS_PER_CHAR = 4;

/** Conservative estimate: chars / 4, rounded up. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / TOKENS_PER_CHAR);
}

export class QuotaManager {
  private readonly store: StateStore;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;
  private readonly now: () => Date;
  private readonly onRecord?: (provider: string, model: string, usedRequests: number) => void;
  /** Full-day totals; never cleared so getDailyRequests sees everything. */
  private readonly pendingUsage = new Map<string, Accumulator>();
  /** Per key, the totals already persisted to usage_daily. */
  private readonly flushedUsage = new Map<string, FlushedSnapshot>();
  private readonly pendingLogs: RequestLogEntry[] = [];
  private readonly timer: NodeJS.Timeout;
  private flushing = false;
  private closed = false;

  constructor(options: QuotaManagerOptions) {
    this.store = options.store;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.flushBatchSize = options.flushBatchSize ?? 20;
    this.now = options.now ?? (() => new Date());
    this.onRecord = options.onRecord;
    this.seedDailyCounters();
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  /** Load today's usage_daily rows as the in-memory seed (restart-safe). */
  private seedDailyCounters(): void {
    const date = localDate(this.now());
    for (const row of this.store.getDailyUsage(date)) {
      const key = keyOf(row.date, row.provider, row.model);
      this.pendingUsage.set(key, {
        requests: row.requests,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        sawReal: row.source !== "estimated",
        sawEstimated: row.source !== "real",
      });
      this.flushedUsage.set(key, {
        requests: row.requests,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });
    }
  }

  /**
   * Record one finished request: accumulate usage and queue the request_log
   * row. Requests counted even when the upstream call failed (they consume
   * attempts against daily quotas).
   */
  record(input: RequestLogInput): void {
    const date = localDate(this.now());
    const key = keyOf(date, input.provider, input.model);
    let acc = this.pendingUsage.get(key);
    if (!acc) {
      acc = { requests: 0, inputTokens: 0, outputTokens: 0, sawReal: false, sawEstimated: false };
      this.pendingUsage.set(key, acc);
    }
    const { usage } = input;
    const inputReal = usage.inputTokens !== undefined;
    const outputReal = usage.outputTokens !== undefined;
    const inputTokens = inputReal ? (usage.inputTokens as number) : estimateTokens(usage.inputChars);
    const outputTokens = outputReal ? (usage.outputTokens as number) : estimateTokens(usage.outputChars);
    acc.requests += 1;
    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.sawReal ||= inputReal || outputReal;
    acc.sawEstimated ||= !inputReal || !outputReal;

    this.onRecord?.(input.provider, input.model, acc.requests);

    this.pendingLogs.push({
      requestId: input.requestId,
      ts: input.ts,
      alias: input.alias,
      provider: input.provider,
      model: input.model,
      status: input.status,
      inputTokens,
      outputTokens,
      estimated: inputReal && outputReal ? 0 : 1,
      failover: input.failover,
      durationMs: input.durationMs,
    });

    if (this.pendingLogs.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  /** Today's accumulated request count for a candidate (routing decision). */
  getDailyRequests(provider: string, model: string): number {
    const key = keyOf(localDate(this.now()), provider, model);
    return this.pendingUsage.get(key)?.requests ?? 0;
  }

  /** Today's accumulated usage snapshot (requests, tokens, source) in memory. */
  getUsageSnapshot(provider: string, model: string): CandidateUsageSnapshot {
    const key = keyOf(localDate(this.now()), provider, model);
    const acc = this.pendingUsage.get(key);
    if (!acc) {
      return { requests: 0, inputTokens: 0, outputTokens: 0, source: "estimated" };
    }
    const source: UsageSource =
      acc.sawReal && !acc.sawEstimated ? "real" : acc.sawReal ? "mixed" : "estimated";
    return {
      requests: acc.requests,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      source,
    };
  }

  /** Force a synchronous flush of pending usage and logs. */
  flushSync(): void {
    if (this.closed) return;
    if (this.pendingUsage.size === 0 && this.pendingLogs.length === 0) return;
    // Only the part not yet persisted is written: the in-memory accumulator
    // keeps the full day, so a flush never zeroes getDailyRequests().
    const deltas: { key: string; row: UsageRow }[] = [];
    for (const [key, acc] of this.pendingUsage) {
      const flushed = this.flushedUsage.get(key);
      const requests = acc.requests - (flushed?.requests ?? 0);
      const inputTokens = acc.inputTokens - (flushed?.inputTokens ?? 0);
      const outputTokens = acc.outputTokens - (flushed?.outputTokens ?? 0);
      if (requests === 0 && inputTokens === 0 && outputTokens === 0) continue;
      const [date, provider, model] = key.split("\u0000");
      deltas.push({
        key,
        row: {
          date,
          provider,
          model,
          requests,
          inputTokens,
          outputTokens,
          source: acc.sawReal && !acc.sawEstimated ? "real" : acc.sawReal ? "mixed" : "estimated",
        },
      });
    }
    try {
      this.store.flushUsageAndLogs(
        deltas.map((d) => d.row),
        this.pendingLogs,
      );
    } catch (err) {
      // Pass the error object under `err` so pino's built-in err serializer
      // (type/message/stack) applies, matching the rest of observability.
      logger.warn({ err }, "quota flush failed; keeping data in memory");
      return; // keep pending data; retried on the next flush
    }
    for (const { key } of deltas) {
      const acc = this.pendingUsage.get(key)!;
      this.flushedUsage.set(key, {
        requests: acc.requests,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
      });
    }
    this.pendingLogs.length = 0;
    // Drop accumulators for past days now that their deltas are safely
    // persisted: without this, a long-running process crossing midnight
    // would keep yesterday's keys in both maps forever.
    this.pruneStaleKeys();
  }

  /** Delete every non-today key from the in-memory maps (flush-safe). */
  private pruneStaleKeys(): void {
    const today = localDate(this.now());
    const prefix = `${today}\u0000`;
    for (const key of this.pendingUsage.keys()) {
      if (key.startsWith(prefix)) continue;
      this.pendingUsage.delete(key);
      this.flushedUsage.delete(key);
    }
  }

  /** Async flush used by the interval timer; never throws. */
  async flush(): Promise<void> {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    try {
      this.flushSync();
    } finally {
      this.flushing = false;
    }
  }

  /** Clear all in-memory accumulators and wipe database usage records. */
  resetAll(): void {
    this.pendingUsage.clear();
    this.flushedUsage.clear();
    this.pendingLogs.length = 0;
    this.store.clearAllUsage();
  }

  /** Stop the timer and force a final flush (graceful shutdown). */
  shutdown(): void {
    if (this.closed) return;
    clearInterval(this.timer);
    this.flushSync();
    this.closed = true;
    this.store.close();
  }
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function keyOf(date: string, provider: string, model: string): string {
  return `${date}\u0000${provider}\u0000${model}`;
}
