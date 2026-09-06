/**
 * In-memory client usage window: aggregates request outcomes per
 * client (User-Agent mapped to a display name; unmatched UAs kept
 * verbatim) × protocol endpoint over a sliding 24h window.
 *
 * Implemented as an extra Exporter so the request path itself is untouched.
 * Deliberately not persisted: the value is "how is usage going right now",
 * cumulative accounting already lives in SQLite (usage_daily), and a restart
 * simply resets the window.
 */
import type {
  ChunkEvent,
  ErrorEvent,
  Exporter,
  FirstTokenEvent,
  RequestEndEvent,
  RequestStartEvent,
} from "./exporter.js";

export const CLIENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS_PER_BUCKET = 1000;
const MAX_TRACKED_REQUESTS = 2000;
/** UAs are stored verbatim up to this bound so hostile clients cannot bloat memory. */
const MAX_UA_LENGTH = 200;
const DISPLAY_UA_MAX_LENGTH = 48;
const TOP_FAILURES = 3;
const RECENT_LIMIT = 10;
const UNKNOWN_CLIENT = "unknown-UA";

export interface ClientFailureStat {
  reason: string;
  count: number;
}

export interface ClientRecentRequest {
  at: string;
  status: number;
  durationMs: number;
  failovers: number;
}

export interface ClientEndpointStat {
  /** Mapped client name, or the raw (truncated) UA when unmatched. */
  client: string;
  /** Protocol endpoint path, e.g. /v1/messages. */
  endpoint: string;
  requests: number;
  /** 0..1, rounded to 4 decimals. */
  successRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  failovers: number;
  topFailures: ClientFailureStat[];
  lastError: { at: string; reason: string } | null;
  /** Most recent requests, newest first. */
  recent: ClientRecentRequest[];
}

export interface ClientStatusSnapshot {
  timestamp: string;
  windowMs: number;
  clients: ClientEndpointStat[];
}

export interface ClientUsageSinkOptions {
  now?: () => number;
  windowMs?: number;
  maxRecordsPerBucket?: number;
  maxTrackedRequests?: number;
}

interface BucketRecord {
  ts: number;
  status: number;
  durationMs: number;
  failovers: number;
  ok: boolean;
  reason: string | null;
}

interface Bucket {
  client: string;
  endpoint: string;
  records: BucketRecord[];
}

interface InFlightEntry {
  bucketKey: string;
  client: string;
  endpoint: string;
  errorCode?: string;
}

/**
 * Maps a User-Agent to a client display name. Only confident mappings are
 * listed; anything else is returned as null so the raw UA stays visible
 * instead of being silently merged into a generic bucket.
 */
export function mapUserAgent(userAgent: string): string | null {
  const ua = userAgent.trim();
  if (!ua) return null;
  if (ua.startsWith("claude-cli/")) return "claude-code";
  if (ua.startsWith("codex_cli_rs/")) return "codex";
  if (ua.includes("opencode")) return "opencode";
  if (ua.includes("aider")) return "aider";
  return null;
}

function resolveClient(userAgent: string): { key: string; display: string } {
  const mapped = mapUserAgent(userAgent);
  if (mapped) return { key: mapped, display: mapped };
  const ua = userAgent.trim().slice(0, MAX_UA_LENGTH);
  if (!ua) return { key: UNKNOWN_CLIENT, display: UNKNOWN_CLIENT };
  const display =
    ua.length > DISPLAY_UA_MAX_LENGTH ? ua.slice(0, DISPLAY_UA_MAX_LENGTH) + "…" : ua;
  return { key: `raw:${ua}`, display };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length, Math.ceil(q * sorted.length)) - 1);
  return sorted[idx];
}

function failureReason(status: number, errorCode?: string): string {
  if (errorCode) return status >= 400 ? `${status} ${errorCode}` : errorCode;
  return String(status);
}

export class ClientUsageSink implements Exporter {
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxRecordsPerBucket: number;
  private readonly maxTrackedRequests: number;
  private readonly buckets = new Map<string, Bucket>();
  /** requestId → request that started but has not ended yet. */
  private readonly inFlight = new Map<string, InFlightEntry>();
  /**
   * requestId → already finalized record, kept so a late error event (the
   * aborted-stream path reports after request end) can still mark the
   * request as failed.
   */
  private readonly finalized = new Map<string, { bucket: Bucket; record: BucketRecord }>();

  constructor(options: ClientUsageSinkOptions = {}) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? CLIENT_WINDOW_MS;
    this.maxRecordsPerBucket = options.maxRecordsPerBucket ?? MAX_RECORDS_PER_BUCKET;
    this.maxTrackedRequests = options.maxTrackedRequests ?? MAX_TRACKED_REQUESTS;
  }

  onRequestStart(event: RequestStartEvent): void {
    const client = resolveClient(event.userAgent);
    const bucketKey = `${client.key}\n${event.path}`;
    this.track(this.inFlight, event.requestId, {
      bucketKey,
      client: client.display,
      endpoint: event.path,
    });
  }

  onFirstToken(_event: FirstTokenEvent): void {}

  onChunk(_event: ChunkEvent): void {}

  onError(event: ErrorEvent): void {
    const live = this.inFlight.get(event.requestId);
    if (live) {
      live.errorCode = event.code;
      return;
    }
    const done = this.finalized.get(event.requestId);
    if (done && done.record.ok) {
      done.record.ok = false;
      done.record.reason = failureReason(done.record.status, event.code);
    }
  }

  onRequestEnd(event: RequestEndEvent): void {
    const live = this.inFlight.get(event.requestId);
    if (!live) return;
    this.inFlight.delete(event.requestId);

    const ok = event.status < 400;
    const record: BucketRecord = {
      ts: event.ts,
      status: event.status,
      durationMs: event.durationMs,
      failovers: event.failovers,
      ok,
      reason: ok ? null : failureReason(event.status, live.errorCode),
    };

    let bucket = this.buckets.get(live.bucketKey);
    if (!bucket) {
      bucket = { client: live.client, endpoint: live.endpoint, records: [] };
      this.buckets.set(live.bucketKey, bucket);
    }
    bucket.records.push(record);
    if (bucket.records.length > this.maxRecordsPerBucket) {
      bucket.records.shift();
    }

    this.track(this.finalized, event.requestId, { bucket, record });
  }

  snapshot(now: number = this.now()): ClientStatusSnapshot {
    this.prune(now);

    const clients: ClientEndpointStat[] = [];
    for (const bucket of this.buckets.values()) {
      const { records } = bucket;
      if (records.length === 0) continue;
      const okCount = records.reduce((sum, r) => sum + (r.ok ? 1 : 0), 0);
      const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);

      const failureCounts = new Map<string, number>();
      for (const r of records) {
        if (!r.ok && r.reason) {
          failureCounts.set(r.reason, (failureCounts.get(r.reason) ?? 0) + 1);
        }
      }
      const topFailures = [...failureCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1))
        .slice(0, TOP_FAILURES);

      const lastErrorRecord = [...records].reverse().find((r) => !r.ok);

      clients.push({
        client: bucket.client,
        endpoint: bucket.endpoint,
        requests: records.length,
        successRate: Number((okCount / records.length).toFixed(4)),
        p50Ms: Math.round(percentile(durations, 0.5)),
        p95Ms: Math.round(percentile(durations, 0.95)),
        failovers: records.reduce((sum, r) => sum + r.failovers, 0),
        topFailures,
        lastError: lastErrorRecord
          ? {
              at: new Date(lastErrorRecord.ts).toISOString(),
              reason: lastErrorRecord.reason ?? String(lastErrorRecord.status),
            }
          : null,
        recent: records.slice(-RECENT_LIMIT).reverse().map((r) => ({
          at: new Date(r.ts).toISOString(),
          status: r.status,
          durationMs: r.durationMs,
          failovers: r.failovers,
        })),
      });
    }

    clients.sort(
      (a, b) =>
        b.requests - a.requests ||
        (a.client < b.client ? -1 : a.client > b.client ? 1 : 0) ||
        (a.endpoint < b.endpoint ? -1 : 1),
    );

    return {
      timestamp: new Date(now).toISOString(),
      windowMs: this.windowMs,
      clients,
    };
  }

  reset(): void {
    this.buckets.clear();
    this.inFlight.clear();
    this.finalized.clear();
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      // Records are appended in ts order, so an intact prefix is already expired.
      if (bucket.records.length === 0 || bucket.records[0].ts >= cutoff) continue;
      bucket.records = bucket.records.filter((r) => r.ts >= cutoff);
      if (bucket.records.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  private track<T>(map: Map<string, T>, key: string, value: T): void {
    if (map.has(key)) {
      map.set(key, value);
      return;
    }
    if (map.size >= this.maxTrackedRequests) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
    map.set(key, value);
  }
}

export const clientUsageSink = new ClientUsageSink();
