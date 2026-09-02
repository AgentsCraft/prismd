/**
 * Lazy singletons wiring the core state: health manager, key pool,
 * quota manager and the SQLite store behind them. Like getConfig, they
 * initialize on first use (server.ts touches them at startup so the DB
 * is created and pruned up front) and provide a shutdown hook for graceful exit.
 */
import { join } from "node:path";
import { getConfig } from "../config.js";
import { HealthManager } from "./health.js";
import { KeyPool } from "./key-pool.js";
import { QuotaManager } from "./quota.js";
import { StateStore } from "./state.js";
import { statusBroadcaster } from "./status-events.js";

const DEFAULT_DATA_PATH = join(process.cwd(), "data", "prismd.sqlite");

let keyPool: KeyPool | undefined;
let health: HealthManager | undefined;
let quota: QuotaManager | undefined;

function makeKeyPool(): KeyPool {
  const policies = getConfig().policies;
  return new KeyPool({
    failThreshold: policies.failThreshold,
    cooldownMs: policies.cooldownMs,
    respectRetryAfter: policies.respectRetryAfter,
  });
}

function makeHealth(kp: KeyPool): HealthManager {
  const policies = getConfig().policies;
  const hm = new HealthManager({
    failThreshold: policies.failThreshold,
    cooldownMs: policies.cooldownMs,
    respectRetryAfter: policies.respectRetryAfter,
    keyPool: kp,
  });
  hm.on("change", ({ provider, model, health }) => {
    statusBroadcaster.notifyHealthChange(provider, model, health);
  });
  return hm;
}

function makeQuota(): QuotaManager {
  const store = new StateStore(process.env.PRISMD_DATA_PATH ?? DEFAULT_DATA_PATH);
  return new QuotaManager({
    store,
    onRecord: (provider, model, usedRequests) => {
      const config = getConfig();
      for (const aliasModel of Object.values(config.models)) {
        const candidate = aliasModel.candidates.find(
          (c) => c.provider === provider && c.providerModelId === model,
        );
        if (candidate) {
          statusBroadcaster.notifyQuotaChange(
            provider,
            model,
            usedRequests,
            candidate.limits.dailyRequests,
            config.policies.quotaSoftLimitRatio,
          );
          break;
        }
      }
    },
  });
}

/** Shared KeyPool instance (per-process singleton). */
export function getKeyPool(): KeyPool {
  keyPool ??= makeKeyPool();
  return keyPool;
}

/** Shared passive-health state machine (per-process singleton). */
export function getHealth(): HealthManager {
  health ??= makeHealth(getKeyPool());
  return health;
}

/** Shared quota manager; opens data/prismd.sqlite on first use. */
export function getQuota(): QuotaManager {
  quota ??= makeQuota();
  return quota;
}

/** Flush pending quota data and close the store (graceful shutdown). */
export function shutdownRuntime(): void {
  quota?.shutdown();
  quota = undefined;
  health = undefined;
  keyPool?.reset();
  keyPool = undefined;
  statusBroadcaster.reset();
}

/** Test-only: drop singletons so the next use rebuilds from current config. */
export function resetRuntimeForTests(): void {
  quota?.shutdown();
  quota = undefined;
  health = undefined;
  keyPool?.reset();
  keyPool = undefined;
  statusBroadcaster.reset();
}
