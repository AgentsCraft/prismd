#!/usr/bin/env node
import { serve, type ServerType } from "@hono/node-server";
import { app } from "./app.js";
import { getConfig, reloadConfig } from "./config.js";
import { waitForStreams } from "./core/drain.js";
import { runStatusCli } from "./cli/status.js";
import { runSyncCli } from "./cli/sync.js";
import { runGenerateCli } from "./cli/generate.js";
import { printHelpCli } from "./cli/help.js";
import { logger } from "./observability/logger.js";
import { validateUpstreamModels } from "./core/catalog-sync.js";
import { getHealth, getKeyPool, initRuntime, shutdownRuntime } from "./core/runtime.js";

const cliCommand = process.argv[2];

if (cliCommand === "status") {
  try {
    await runStatusCli();
    process.exit(0);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute status command");
    process.exit(1);
  }
}

if (cliCommand === "sync" || cliCommand === "check") {
  try {
    const exitCode = await runSyncCli();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute sync command");
    process.exit(1);
  }
}

if (cliCommand === "generate" || cliCommand === "init") {
  try {
    const exitCode = await runGenerateCli();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute generate command");
    process.exit(1);
  }
}

if (cliCommand === "--help" || cliCommand === "-h") {
  printHelpCli();
  process.exit(0);
}

// Loads and validates prismd.json up front: schema violations and
// non-loopback server.host fail fast here, before any socket opens.
const config = getConfig();
// Initialize the core runtime singletons atomically up front: creates data/,
// migrates, prunes request_log, and verifies key pool and health state.
initRuntime();

const SHUTDOWN_GRACE_MS = 30_000;

const server: ServerType = serve(
  { fetch: app.fetch, port: config.server.port, hostname: config.server.host },
  (info) => {
    logger.info({ host: info.address, port: info.port }, "prismd listening");
    // Asynchronously validate upstream model catalogs in background without blocking startup
    if (process.env.PRISMD_DISABLE_CATALOG_SYNC !== "1") {
      void validateUpstreamModels(config, getHealth(), getKeyPool()).catch((err) => {
        logger.debug({ error: (err as Error).message }, "background catalog validation error");
      });
    }
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
    if (process.env.PRISMD_DISABLE_CATALOG_SYNC !== "1") {
      void validateUpstreamModels(newConfig, getHealth(), getKeyPool()).catch(() => {});
    }
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to reload configuration; keeping active config");
  }
});
