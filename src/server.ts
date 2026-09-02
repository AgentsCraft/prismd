#!/usr/bin/env node
import { serve, type ServerType } from "@hono/node-server";
import { app } from "./app.js";
import { getConfig, reloadConfig } from "./config.js";
import { waitForStreams } from "./core/drain.js";
import { getQuota, shutdownRuntime } from "./core/runtime.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runStatusCli } from "./cli/status.js";
import { generateConfigString } from "./generate-config.js";
import { logger } from "./observability/logger.js";

if (process.argv[2] === "status") {
  await runStatusCli();
  process.exit(0);
}

if (process.argv[2] === "generate" || process.argv[2] === "init") {
  const home = process.env.PRISMD_HOME ?? homedir();
  const cwd = process.env.PRISMD_CWD ?? process.cwd();
  const targetDir = join(home, ".prismd");
  const targetPath = join(targetDir, "prismd.json");
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const content = generateConfigString({ homeDir: home, cwd });
  writeFileSync(targetPath, content, { mode: 0o600 });
  console.log(`Generated configuration at ${targetPath}`);
  process.exit(0);
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(`prismd - Local-first LLM gateway aggregating free and low-cost model APIs

Usage:
  prismd                 Start the gateway server
  prismd status          Display candidate health and quota metrics
  prismd generate        Generate ~/.prismd/prismd.json from keys and presets
  prismd --help, -h      Show this help message
`);
  process.exit(0);
}

// Loads and validates prismd.json up front: schema violations and
// non-loopback server.host fail fast here, before any socket opens.
const config = getConfig();
// Open the SQLite store up front: creates data/, migrates, prunes the
// request_log and chmod 600 — so startup problems surface immediately.
getQuota();

const SHUTDOWN_GRACE_MS = 30_000;

const server: ServerType = serve(
  { fetch: app.fetch, port: config.server.port, hostname: config.server.host },
  (info) => {
    logger.info({ host: info.address, port: info.port }, "prismd listening");
  },
);

/**
 * Graceful exit: stop accepting connections, let in-flight streams finish
 * (up to 30s), force a quota flush, then exit. Streams still running past
 * the grace period are cut with a warning.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close();

  void (async () => {
    const drained = await waitForStreams(SHUTDOWN_GRACE_MS);
    if (!drained) {
      logger.warn("grace period elapsed; forcing shutdown with streams in flight");
    }
    shutdownRuntime();
    logger.info("quota flushed, exiting");
    process.exit(0);
  })();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGHUP", () => {
  logger.info("received SIGHUP, reloading configuration");
  try {
    const newConfig = reloadConfig();
    logger.info({ models: Object.keys(newConfig.models) }, "configuration reloaded successfully");
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to reload configuration; keeping active config");
  }
});
