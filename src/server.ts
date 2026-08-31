#!/usr/bin/env node
import { serve, type ServerType } from "@hono/node-server";
import { app } from "./app.js";
import { getConfig } from "./config.js";
import { waitForStreams } from "./core/drain.js";
import { getQuota, shutdownRuntime } from "./core/runtime.js";
import { logger } from "./observability/logger.js";

import { runStatusCli } from "./cli/status.js";

if (process.argv[2] === "status") {
  await runStatusCli();
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
