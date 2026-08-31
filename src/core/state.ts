/**
 * SQLite state store: data/prismd.sqlite (node:sqlite built-in module),
 * WAL mode, chmod 600. Table DDL follows the 05 plan draft verbatim.
 *
 *   schema_version  — schema migration marker
 *   usage_daily     — daily aggregation, the data source for quota routing
 *   request_log     — one row per request for troubleshooting; pruned to
 *                     the last N days at startup
 */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface UsageRow {
  date: string;
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  source: "real" | "estimated" | "mixed";
}

export interface RequestLogEntry {
  requestId: string;
  ts: string;
  alias: string;
  provider: string;
  model: string;
  status: number;
  inputTokens: number;
  outputTokens: number;
  estimated: number;
  failover: number;
  durationMs: number;
}

const SCHEMA_VERSION = 1;
const REQUEST_LOG_RETENTION_DAYS = 14;

export class StateStore {
  readonly dbPath: string;
  private db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // WAL improves concurrent read/write behavior; single file + sidecars.
    this.db.exec("PRAGMA journal_mode = WAL;");
    // chmod 600: only the local user may read usage data.
    chmodSync(dbPath, 0o600);
    this.migrate();
    this.pruneRequestLogs(REQUEST_LOG_RETENTION_DAYS);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_daily (
        date          TEXT NOT NULL,
        provider      TEXT NOT NULL,
        model         TEXT NOT NULL,
        requests      INTEGER NOT NULL DEFAULT 0,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        source        TEXT NOT NULL DEFAULT 'estimated',
        PRIMARY KEY (date, provider, model)
      );

      CREATE TABLE IF NOT EXISTS request_log (
        request_id    TEXT PRIMARY KEY,
        ts            TEXT NOT NULL,
        alias         TEXT NOT NULL,
        provider      TEXT NOT NULL,
        model         TEXT NOT NULL,
        status        INTEGER,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        estimated     INTEGER NOT NULL DEFAULT 0,
        failover      INTEGER NOT NULL DEFAULT 0,
        duration_ms   INTEGER
      );
    `);
    const rows = this.db.prepare("SELECT version FROM schema_version").all() as { version: number }[];
    if (rows.length === 0) {
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    } else if (rows[0].version !== SCHEMA_VERSION) {
      throw new Error(
        `unsupported schema version ${rows[0].version} (expected ${SCHEMA_VERSION}); ` +
          "delete data/prismd.sqlite to rebuild",
      );
    }
  }

  /** Merge in-memory usage deltas into usage_daily. */
  flushUsage(rows: UsageRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO usage_daily (date, provider, model, requests, input_tokens, output_tokens, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (date, provider, model) DO UPDATE SET
        requests = usage_daily.requests + excluded.requests,
        input_tokens = usage_daily.input_tokens + excluded.input_tokens,
        output_tokens = usage_daily.output_tokens + excluded.output_tokens,
        source = CASE
          WHEN usage_daily.source = excluded.source THEN excluded.source
          ELSE 'mixed'
        END
    `);
    for (const row of rows) {
      stmt.run(
        row.date,
        row.provider,
        row.model,
        row.requests,
        row.inputTokens,
        row.outputTokens,
        row.source,
      );
    }
  }

  /** Read one day's usage rows (accumulator seed when the process starts). */
  getDailyUsage(date: string): UsageRow[] {
    return this.db
      .prepare(
        `SELECT date, provider, model, requests,
                input_tokens AS inputTokens, output_tokens AS outputTokens, source
         FROM usage_daily WHERE date = ?`,
      )
      .all(date) as unknown as UsageRow[];
  }

  /**
   * Atomically write usage deltas + request logs in one transaction, so a
   * failure partway never leaves usage counted while logs are missing
   * (which would double-count the usage delta on the next flush retry).
   */
  flushUsageAndLogs(rows: UsageRow[], entries: RequestLogEntry[]): void {
    if (rows.length === 0 && entries.length === 0) return;
    this.db.exec("BEGIN");
    try {
      this.flushUsage(rows);
      this.insertRequestLogs(entries);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* connection already broken; nothing left to roll back */
      }
      throw err;
    }
  }

  /** Append request_log entries (batch insert). */
  insertRequestLogs(entries: RequestLogEntry[]): void {
    if (entries.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO request_log
        (request_id, ts, alias, provider, model, status, input_tokens, output_tokens, estimated, failover, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of entries) {
      stmt.run(
        entry.requestId,
        entry.ts,
        entry.alias,
        entry.provider,
        entry.model,
        entry.status,
        entry.inputTokens,
        entry.outputTokens,
        entry.estimated,
        entry.failover,
        entry.durationMs,
      );
    }
  }

  /** Delete request_log rows older than the given number of days. */
  pruneRequestLogs(days: number): void {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM request_log WHERE ts < ?").run(cutoff);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
