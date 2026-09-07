#!/usr/bin/env node
import { logger } from "./observability/logger.js";

// Suppress experimental warnings for built-in SQLite (Node 22/23/24)
// to maintain a clean CLI user experience across all supported platforms.
const originalEmitWarning = process.emitWarning.bind(process);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.emitWarning = function (warning: any, ...args: any[]) {
  if (typeof warning === "string" && warning.includes("SQLite")) return;
  if (warning && typeof warning === "object" && warning.message && warning.message.includes("SQLite")) return;
  return originalEmitWarning(warning, ...args);
};

const cliCommand = process.argv[2];

if (cliCommand === "--help" || cliCommand === "-h") {
  const { printHelpCli } = await import("./cli/help.js");
  printHelpCli();
  process.exit(0);
}

if (cliCommand === "status") {
  try {
    const { runStatusCli } = await import("./cli/status.js");
    await runStatusCli();
    process.exit(0);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute status command");
    process.exit(1);
  }
}

if (cliCommand === "sync" || cliCommand === "check") {
  try {
    const { runSyncCli } = await import("./cli/sync.js");
    const exitCode = await runSyncCli();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute sync command");
    process.exit(1);
  }
}

if (cliCommand === "generate") {
  try {
    const { runGenerateCli } = await import("./cli/generate.js");
    const exitCode = await runGenerateCli();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute generate command");
    process.exit(1);
  }
}

if (cliCommand === "init") {
  try {
    const { runInitCli } = await import("./cli/init.js");
    const exitCode = await runInitCli();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ error: (err as Error).message }, "failed to execute init command");
    process.exit(1);
  }
}

// Start Gateway Server dynamically
const { serve } = await import("@hono/node-server");
const { app } = await import("./app.js");
const { getConfig, reloadConfig } = await import("./config.js");
const { waitForStreams } = await import("./core/drain.js");
const { validateUpstreamModels } = await import("./core/catalog-sync.js");
const { getHealth, getKeyPool, initRuntime, shutdownRuntime } = await import("./core/runtime.js");
import type { ConfigWatcher } from "./core/watcher.js";
const { startConfigWatcher } = await import("./core/watcher.js");

// Loads and validates prismd.json up front: schema violations and
// non-loopback server.host fail fast here, before any socket opens.
const config = getConfig();
// Initialize the core runtime singletons atomically up front: creates data/,
// migrates, prunes request_log, and verifies key pool and health state.
initRuntime();

const SHUTDOWN_GRACE_MS = 30_000;

let configWatcher: ConfigWatcher | null = null;
if (process.env.PRISMD_DISABLE_WATCHER !== "1") {
  try {
    configWatcher = startConfigWatcher();
  } catch (err) {
    logger.debug({ error: (err as Error).message }, "failed to initialize config watcher");
  }
}

const server = serve(
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
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
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
