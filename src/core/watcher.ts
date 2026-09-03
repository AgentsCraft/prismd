import { watch, type FSWatcher, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { reloadConfig, resolveConfigPath } from "../config.js";
import { logger } from "../observability/logger.js";
import { validateUpstreamModels } from "./catalog-sync.js";
import { getHealth, getKeyPool } from "./runtime.js";
import type { PrismdConfig } from "../types/config.js";

export interface WatcherOptions {
  configPath?: string;
  keysYamlPath?: string;
  debounceMs?: number;
  onReload?: (newConfig: PrismdConfig) => void;
  onError?: (err: Error) => void;
}

export interface ConfigWatcher {
  close: () => void;
}

/**
 * Watches configuration and key files for changes and reloads dynamically.
 * Features debounce protection and graceful error handling to preserve
 * active configuration if a reload fails.
 */
export function startConfigWatcher(options: WatcherOptions = {}): ConfigWatcher {
  const debounceMs = options.debounceMs ?? 200;
  const configPath = options.configPath ?? resolveConfigPath();
  const homeDir = process.env.PRISMD_HOME ?? homedir();
  const keysYamlPath = options.keysYamlPath ?? join(homeDir, ".prismd", "keys.yaml");

  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;

  const triggerReload = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      logger.info("file change detected, dynamically reloading configuration");
      try {
        const newConfig = reloadConfig(configPath);
        logger.info({ models: Object.keys(newConfig.models) }, "configuration reloaded successfully via watcher");
        if (process.env.PRISMD_DISABLE_CATALOG_SYNC !== "1") {
          void validateUpstreamModels(newConfig, getHealth(), getKeyPool()).catch(() => {});
        }
        if (options.onReload) {
          options.onReload(newConfig);
        }
      } catch (err) {
        logger.error({ error: (err as Error).message }, "failed to reload configuration via watcher; keeping active config");
        if (options.onError) {
          options.onError(err as Error);
        }
      }
    }, debounceMs);
  };

  // Aggregate targets by directory to avoid duplicate watchers and detect newly created files
  const dirTargets = new Map<string, Set<string>>();
  for (const targetPath of [configPath, keysYamlPath]) {
    const dir = dirname(targetPath);
    const base = basename(targetPath);
    if (!dirTargets.has(dir)) {
      dirTargets.set(dir, new Set());
    }
    dirTargets.get(dir)!.add(base);
  }

  for (const [dir, bases] of dirTargets.entries()) {
    if (!existsSync(dir)) continue;
    try {
      const w = watch(dir, (_eventType, filename) => {
        if (!filename || bases.has(filename)) {
          triggerReload();
        }
      });
      watchers.push(w);
    } catch (err) {
      logger.debug({ path: dir, error: (err as Error).message }, "could not attach fs.watch to directory");
    }
  }

  return {
    close: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore error on close
        }
      }
      watchers.length = 0;
    },
  };
}
