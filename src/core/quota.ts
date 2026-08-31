/**
 * Quota accounting (M2a): in-memory accumulation per (date, provider,
 * model), flushed to SQLite asynchronously every flushIntervalMs or when
 * flushBatchSize pending records accumulate — never blocking the request
 * path. Flush failures only log a warning. Graceful shutdown forces a
 * final flush.
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

export interface QuotaManagerOptions {
  store: StateStore;
  /** Flush interval in ms (default 5000). */
  flushIntervalMs?: number;
  /** Pending record count triggering an immediate flush (default 20). */
  flushBatchSize?: number;
  now?: () => Date;
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
  private readonly pendingUsage = new Map<string, Accumulator>();
  private readonly pendingLogs: RequestLogEntry[] = [];
  private readonly timer: NodeJS.Timeout;
  private flushing = false;
  private closed = false;

  constructor(options: QuotaManagerOptions) {
    this.store = options.store;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.flushBatchSize = options.flushBatchSize ?? 20;
    this.now = options.now ?? (() => new Date());
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
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

  /** Force a synchronous flush of pending usage and logs. */
  flushSync(): void {
    if (this.closed) return;
    if (this.pendingUsage.size === 0 && this.pendingLogs.length === 0) return;
    const rows: UsageRow[] = [];
    for (const [key, acc] of this.pendingUsage) {
      const [date, provider, model] = key.split("\u0000");
      rows.push({
        date,
        provider,
        model,
        requests: acc.requests,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        source: acc.sawReal && !acc.sawEstimated ? "real" : acc.sawReal ? "mixed" : "estimated",
      });
    }
    try {
      this.store.flushUsage(rows);
      this.store.insertRequestLogs(this.pendingLogs);
    } catch (err) {
      logger.warn({ err: String(err) }, "quota flush failed; keeping data in memory");
      return; // keep pending data; retried on the next flush
    }
    this.pendingUsage.clear();
    this.pendingLogs.length = 0;
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
