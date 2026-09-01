import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchLiveStatus, renderLiveStatus, renderOfflineStatus } from "../src/cli/status.js";
import { StateStore } from "../src/core/state.js";
import type { ModelStatusResponse } from "../routes/modelstatus.js";

test("renderLiveStatus formats model status table without throwing", () => {
  const mockData: ModelStatusResponse = {
    timestamp: new Date().toISOString(),
    uptime: 3600,
    aliases: {
      "free-auto": {
        activeCandidate: "openrouter/poolside/laguna-s-2.1:free",
        candidates: [
          {
            provider: "openrouter",
            model: "poolside/laguna-s-2.1:free",
            status: "healthy",
            health: {
              state: "healthy",
              consecutiveFailures: 0,
              cooldownRemainingMs: 0,
              lastError: null,
              lastErrorAt: null,
            },
            quota: {
              dailyRequests: { used: 10, limit: 50, ratio: 0.2 },
              inputTokens: 10000,
              outputTokens: 2000,
              source: "real",
            },
            contextWindow: 262144,
            supportsTools: true,
            tags: ["free"],
          },
        ],
      },
    },
  };

  let logs = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs += args.join(" ") + "\n";
  };
  try {
    renderLiveStatus(mockData);
    assert.ok(logs.includes("prismd status"));
    assert.ok(logs.includes("free-auto"));
    assert.ok(logs.includes("openrouter/poolside/laguna-s-2.1:free"));
  } finally {
    console.log = origLog;
  }
});

test("renderOfflineStatus reads from SQLite database", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-cli-"));
  const dbPath = join(dir, "prismd.sqlite");
  const store = new StateStore(dbPath);
  const today = new Date().toISOString().slice(0, 10);
  store.flushUsageAndLogs(
    [
      {
        date: today,
        provider: "openrouter",
        model: "test-model",
        requests: 5,
        inputTokens: 500,
        outputTokens: 250,
        source: "real",
      },
    ],
    [],
  );
  store.close();

  let logs = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs += args.join(" ") + "\n";
  };
  try {
    renderOfflineStatus(dbPath);
    assert.ok(logs.includes("prismd gateway is not running"));
    assert.ok(logs.includes("openrouter/test-model"));
    assert.ok(logs.includes("5"));
  } finally {
    console.log = origLog;
  }
});
