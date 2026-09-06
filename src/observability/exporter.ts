/**
 * Observability exporter interface: the gateway reports request lifecycle
 * events here; phase 1 has a single implementation that writes pino JSON
 * to stderr. Future exporters (OTLP, HTTP push, file) implement the same
 * interface without touching the request path.
 *
 * Every event carries requestId + alias (+ provider/model once selected)
 * and a timestamp, so the events form a machine-readable trace per request.
 */
import { logger } from "./logger.js";
import { clientUsageSink } from "./client-sink.js";

export interface RequestStartEvent {
  requestId: string;
  ts: number;
  method: string;
  path: string;
  alias: string;
  /** Raw User-Agent header as sent by the client ("" when absent). */
  userAgent: string;
}

export interface FirstTokenEvent {
  requestId: string;
  ts: number;
  alias: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface ChunkEvent {
  requestId: string;
  ts: number;
  alias: string;
  provider: string;
  model: string;
  bytes: number;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  source: "real" | "estimated" | "mixed";
}

export interface RequestEndEvent {
  requestId: string;
  ts: number;
  method: string;
  path: string;
  alias: string;
  provider: string;
  model: string;
  status: number;
  firstTokenMs?: number;
  durationMs: number;
  usage?: UsageSummary;
  failovers: number;
}

export interface ErrorEvent {
  requestId: string;
  ts: number;
  alias: string;
  provider?: string;
  model?: string;
  code: string;
  message: string;
}

export interface Exporter {
  onRequestStart(event: RequestStartEvent): void;
  onFirstToken(event: FirstTokenEvent): void;
  onChunk(event: ChunkEvent): void;
  onRequestEnd(event: RequestEndEvent): void;
  onError(event: ErrorEvent): void;
}

/**
 * Phase 1 exporter: pino structured JSON to stderr. Chunk-level events
 * are logged at trace level so the default output stays one line per
 * request plus first-token/end summaries.
 */
export class PinoExporter implements Exporter {
  onRequestStart(event: RequestStartEvent): void {
    logger.info({ event: "request_start", ...event }, "request start");
  }

  onFirstToken(event: FirstTokenEvent): void {
    logger.info({ event: "first_token", ...event }, "first token received");
  }

  onChunk(event: ChunkEvent): void {
    logger.trace({ event: "chunk", ...event }, "stream chunk");
  }

  onRequestEnd(event: RequestEndEvent): void {
    logger.info({ event: "request_end", ...event }, "request end");
  }

  onError(event: ErrorEvent): void {
    logger.error({ event: "error", ...event }, event.message);
  }
}

/**
 * Fans lifecycle events out to every registered exporter (pino logging plus
 * the in-memory client usage window) while keeping a single `exporter` handle
 * on the request path. Methods are instance-bound so tests can wrap them by
 * extracting the function from the singleton.
 */
export class CompositeExporter implements Exporter {
  private readonly sinks: readonly Exporter[];

  constructor(sinks: readonly Exporter[]) {
    this.sinks = sinks;
  }

  onRequestStart = (event: RequestStartEvent): void => {
    for (const sink of this.sinks) sink.onRequestStart(event);
  };

  onFirstToken = (event: FirstTokenEvent): void => {
    for (const sink of this.sinks) sink.onFirstToken(event);
  };

  onChunk = (event: ChunkEvent): void => {
    for (const sink of this.sinks) sink.onChunk(event);
  };

  onRequestEnd = (event: RequestEndEvent): void => {
    for (const sink of this.sinks) sink.onRequestEnd(event);
  };

  onError = (event: ErrorEvent): void => {
    for (const sink of this.sinks) sink.onError(event);
  };
}

export const exporter: Exporter = new CompositeExporter([new PinoExporter(), clientUsageSink]);
