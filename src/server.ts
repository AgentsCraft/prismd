#!/usr/bin/env node
import { serve, type ServerType } from "@hono/node-server";
import { app } from "./app.js";
import { getConfig, reloadConfig } from "./config.js";
import { waitForStreams } from "./core/drain.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runStatusCli } from "./cli/status.js";
import { generateConfigStringAsync } from "./generate-config.js";
import { logger } from "./observability/logger.js";
import { validateUpstreamModels } from "./core/catalog-sync.js";
import { getHealth, getKeyPool, getQuota, shutdownRuntime } from "./core/runtime.js";

if (process.argv[2] === "status") {
  await runStatusCli();
  process.exit(0);
}

if (process.argv[2] === "sync" || process.argv[2] === "check") {
  const config = getConfig();
  console.log("Checking upstream provider model catalogs...");
  const results = await validateUpstreamModels(config, getHealth(), getKeyPool());
  let missingCount = 0;
  for (const r of results) {
    if (r.status === "ok") {
      console.log(`✓ [${r.provider}] All ${r.configuredModels.length} configured model(s) available (${r.availableModels.length} total upstream)`);
    } else if (r.status === "model_missing") {
      missingCount += r.missingModels.length;
      console.log(`✗ [${r.provider}] Missing model(s): ${r.missingModels.join(", ")}`);
      console.log(`  Available models: ${r.availableModels.slice(0, 6).join(", ")}...`);
    } else if (r.status === "auth_error") {
      console.log(`✗ [${r.provider}] Authentication failed (check API key in ~/.prismd/keys.yaml)`);
    } else {
      console.log(`! [${r.provider}] Unreachable or skipped (${r.error ?? "network error"})`);
    }
  }
  if (missingCount > 0) {
    console.log(`\nFound ${missingCount} outdated model candidate(s). Run 'prismd generate' to refresh presets or update config.user.json.`);
  } else {
    console.log("\nAll candidate models are synchronized and verified.");
  }
  process.exit(0);
}

if (process.argv[2] === "generate" || process.argv[2] === "init") {
  const home = process.env.PRISMD_HOME ?? homedir();
  const cwd = process.env.PRISMD_CWD ?? process.cwd();
  const targetDir = join(home, ".prismd");
  const targetPath = join(targetDir, "prismd.json");
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  console.log("Querying upstreams to discover active models...");
  const content = await generateConfigStringAsync({ homeDir: home, cwd, liveCheck: true, warn: (msg) => console.log(`  ${msg}`) });
  writeFileSync(targetPath, content, { mode: 0o600 });
  console.log(`Generated verified configuration at ${targetPath}`);
  process.exit(0);
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(`prismd - Local-first LLM gateway aggregating free and low-cost model APIs

Usage:
  prismd                 Start the gateway server
  prismd status          Display candidate health and quota metrics
  prismd sync            Check and validate models against upstream catalogs
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
