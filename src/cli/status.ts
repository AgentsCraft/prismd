#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "../config.js";
import type { ModelStatusResponse } from "../routes/modelstatus.js";

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "—";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return String(num);
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function colorStatus(status: string): string {
  if (process.stdout.isTTY) {
    if (status === "healthy") return `\x1b[32m${status}\x1b[0m`;
    if (status === "rate_limited" || status === "cooldown") return `\x1b[33m${status}\x1b[0m`;
    if (status === "unavailable") return `\x1b[31m${status}\x1b[0m`;
  }
  return status;
}

export async function fetchLiveStatus(host: string, port: number): Promise<ModelStatusResponse | null> {
  const url = `http://${host}:${port}/v1/modelstatus`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return (await res.json()) as ModelStatusResponse;
  } catch {
    return null;
  }
}

export function renderLiveStatus(data: ModelStatusResponse): void {
  console.log(`\n\x1b[1mprismd status\x1b[0m (uptime: ${formatUptime(data.uptime)})\n`);

  for (const [alias, aliasInfo] of Object.entries(data.aliases)) {
    console.log(`\x1b[1m${alias}\x1b[0m`);
    console.log("─".repeat(88));
    console.log(
      `${"PROVIDER / MODEL".padEnd(44)} ${"STATUS".padEnd(16)} ${"REQUESTS".padEnd(14)} ${"TOKENS (IN/OUT)".padEnd(18)}`,
    );
    console.log("─".repeat(88));

    for (const c of aliasInfo.candidates) {
      const isActive = aliasInfo.activeCandidate === `${c.provider}/${c.model}`;
      const activeMark = isActive ? "★ " : "  ";
      const name = `${activeMark}${c.provider}/${c.model}`.padEnd(44);
      const colored = colorStatus(c.status);
      const pad = " ".repeat(Math.max(0, 16 - c.status.length));
      const statusText = `${colored}${pad}`;

      let reqs = "— / —";
      if (c.quota.dailyRequests && c.quota.dailyRequests.limit !== null) {
        const used = c.quota.dailyRequests.used ?? 0;
        const limit = c.quota.dailyRequests.limit;
        const ratio = Math.round((c.quota.dailyRequests.ratio ?? 0) * 100);
        reqs = `${used}/${limit} (${ratio}%)`;
      }
      const reqsText = reqs.padEnd(14);
      const tokensText = `${formatNumber(c.quota.inputTokens)} / ${formatNumber(c.quota.outputTokens)} (${c.quota.source})`;

      console.log(`${name} ${statusText} ${reqsText} ${tokensText}`);
    }
    console.log();
  }
}

export function renderOfflineStatus(dbPath: string): void {
  console.log("\n\x1b[33mprismd gateway is not running (offline view from SQLite)\x1b[0m\n");
  if (!existsSync(dbPath)) {
    console.log(`No database found at ${dbPath}.`);
    return;
  }

  try {
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const stmt = db.prepare(
      "SELECT provider, model, requests, input_tokens, output_tokens, source FROM usage_daily WHERE date = ? ORDER BY provider, model",
    );
    const rows = stmt.all(today) as {
      provider: string;
      model: string;
      requests: number;
      input_tokens: number;
      output_tokens: number;
      source: string;
    }[];
    db.close();

    if (rows.length === 0) {
      console.log(`No recorded usage for today (${today}).`);
      return;
    }

    console.log(`Usage for ${today}:`);
    console.log("─".repeat(70));
    console.log(`${"PROVIDER / MODEL".padEnd(36)} ${"REQUESTS".padEnd(12)} ${"TOKENS (IN/OUT)".padEnd(20)}`);
    console.log("─".repeat(70));
    for (const r of rows) {
      const name = `${r.provider}/${r.model}`.slice(0, 35).padEnd(36);
      const reqs = String(r.requests).padEnd(12);
      const tokens = `${formatNumber(r.input_tokens)} / ${formatNumber(r.output_tokens)} (${r.source})`;
      console.log(`${name} ${reqs} ${tokens}`);
    }
    console.log();
  } catch (err) {
    console.error(`Failed to read database: ${(err as Error).message}`);
  }
}

export async function runStatusCli(): Promise<void> {
  let host = "127.0.0.1";
  let port = 8787;
  let dbPath = join(process.cwd(), "data", "prismd.sqlite");

  try {
    const config = getConfig();
    host = config.server.host;
    port = config.server.port;
  } catch {
    // Tolerated if prismd.json is not configured yet
  }
  if (process.env.PRISMD_DATA_PATH) {
    dbPath = process.env.PRISMD_DATA_PATH;
  }

  const live = await fetchLiveStatus(host, port);
  if (live) {
    renderLiveStatus(live);
  } else {
    renderOfflineStatus(dbPath);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runStatusCli();
}
