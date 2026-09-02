import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectCliLanguage,
  fetchLiveStatus,
  renderLiveStatus,
  renderOfflineStatus,
  stringWidth,
  padEndWidth,
} from "../src/cli/status.js";
import { StateStore } from "../src/core/state.js";
import type { ModelStatusResponse } from "../routes/modelstatus.js";

test("detectCliLanguage matches 10 languages and falls back to en", () => {
  assert.equal(detectCliLanguage({ LANG: "zh_CN.UTF-8" }), "zh-CN");
  assert.equal(detectCliLanguage({ LC_ALL: "ja_JP.UTF-8" }), "ja");
  assert.equal(detectCliLanguage({ LC_MESSAGES: "ko_KR.UTF-8" }), "ko");
  assert.equal(detectCliLanguage({ LANG: "de_DE.UTF-8" }), "de");
  assert.equal(detectCliLanguage({ LANG: "fr_FR.UTF-8" }), "fr");
  assert.equal(detectCliLanguage({ LANG: "es_ES.UTF-8" }), "es");
  assert.equal(detectCliLanguage({ LANG: "it_IT.UTF-8" }), "it");
  assert.equal(detectCliLanguage({ LANG: "ar_AE.UTF-8" }), "ar");
  assert.equal(detectCliLanguage({ LANG: "tr_TR.UTF-8" }), "tr");
  assert.equal(detectCliLanguage({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(detectCliLanguage({ LANG: "C" }), "en");
  assert.equal(detectCliLanguage({}), "en");
});

test("stringWidth and padEndWidth handle CJK characters correctly", () => {
  assert.equal(stringWidth("hello"), 5);
  assert.equal(stringWidth("状态"), 4);
  assert.equal(stringWidth("ステータス"), 10);
  assert.equal(stringWidth("상태"), 4);

  const paddedZh = padEndWidth("状态", 10);
  assert.equal(stringWidth(paddedZh), 10);
});

test("renderLiveStatus formats model status table in default and specified languages", () => {
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
    // 1. Default (en)
    renderLiveStatus(mockData, "en");
    assert.ok(logs.includes("prismd status"));
    assert.ok(logs.includes("free-auto"));
    assert.ok(logs.includes("openrouter/poolside/laguna-s-2.1:free"));
    assert.ok(logs.includes("Total Tokens: 12.0k"));

    // 2. zh-CN
    logs = "";
    renderLiveStatus(mockData, "zh-CN");
    assert.ok(logs.includes("prismd 状态"));
    assert.ok(logs.includes("运行时间"));
    assert.ok(logs.includes("提供方 / 模型"));
    assert.ok(logs.includes("总 Token: 12.0k"));

    // 3. ja
    logs = "";
    renderLiveStatus(mockData, "ja");
    assert.ok(logs.includes("prismd ステータス"));
    assert.ok(logs.includes("稼働時間"));
    assert.ok(logs.includes("プロバイダー / モデル"));

    // 4. ko
    logs = "";
    renderLiveStatus(mockData, "ko");
    assert.ok(logs.includes("prismd 상태"));
    assert.ok(logs.includes("가동 시간"));
    assert.ok(logs.includes("제공자 / 모델"));

    // 5. de
    logs = "";
    renderLiveStatus(mockData, "de");
    assert.ok(logs.includes("prismd Status"));
    assert.ok(logs.includes("Betriebszeit"));
    assert.ok(logs.includes("ANBIETER / MODELL"));

    // 6. fr
    logs = "";
    renderLiveStatus(mockData, "fr");
    assert.ok(logs.includes("Statut prismd"));
    assert.ok(logs.includes("Temps de fonctionnement"));
    assert.ok(logs.includes("FOURNISSEUR / MODÈLE"));

    // 7. es
    logs = "";
    renderLiveStatus(mockData, "es");
    assert.ok(logs.includes("Estado prismd"));
    assert.ok(logs.includes("Tiempo de actividad"));
    assert.ok(logs.includes("PROVEEDOR / MODELO"));

    // 8. it
    logs = "";
    renderLiveStatus(mockData, "it");
    assert.ok(logs.includes("Stato prismd"));
    assert.ok(logs.includes("Tempo di attività"));
    assert.ok(logs.includes("PROVIDER / MODELLO"));

    // 9. ar
    logs = "";
    renderLiveStatus(mockData, "ar");
    assert.ok(logs.includes("حالة prismd"));
    assert.ok(logs.includes("وقت التشغيل"));
    assert.ok(logs.includes("المزود / النموذج"));

    // 10. tr
    logs = "";
    renderLiveStatus(mockData, "tr");
    assert.ok(logs.includes("prismd Durumu"));
    assert.ok(logs.includes("Çalışma süresi"));
    assert.ok(logs.includes("SAĞLAYICI / MODEL"));
  } finally {
    console.log = origLog;
  }
});

test("renderOfflineStatus reads from SQLite database with localization", () => {
  const dir = mkdtempSync(join(tmpdir(), "prismd-cli-"));
  const dbPath = join(dir, "prismd.sqlite");
  const store = new StateStore(dbPath);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
    renderOfflineStatus(dbPath, "en");
    assert.ok(logs.includes("prismd gateway is not running"));
    assert.ok(logs.includes("openrouter/test-model"));
    assert.ok(logs.includes("5"));

    logs = "";
    renderOfflineStatus(dbPath, "zh-CN");
    assert.ok(logs.includes("prismd 网关未运行"));
    assert.ok(logs.includes("提供方 / 模型"));
  } finally {
    console.log = origLog;
  }
});
