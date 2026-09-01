#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "../config.js";
import type { ModelStatusResponse } from "../routes/modelstatus.js";

export type SupportedLang = "en" | "zh-CN" | "ja" | "ko" | "de" | "fr" | "es" | "it";

export interface CliTranslations {
  title: string;
  uptime: string;
  config: string;
  totalTokens: string;
  alias: string;
  provider: string;
  model: string;
  providerModel: string;
  status: string;
  requests: string;
  inputTokens: string;
  outputTokens: string;
  tokensInOut: string;
  context: string;
  tools: string;
  health: string;
  offlineWarning: string;
  noDatabase: string;
  noUsageToday: string;
  usageFor: string;
}

export const CLI_TRANSLATIONS: Record<SupportedLang, CliTranslations> = {
  en: {
    title: "prismd status",
    uptime: "uptime",
    config: "Config",
    totalTokens: "Total Tokens",
    alias: "ALIAS",
    provider: "PROVIDER",
    model: "MODEL",
    providerModel: "PROVIDER / MODEL",
    status: "STATUS",
    requests: "REQUESTS",
    inputTokens: "INPUT TOKENS",
    outputTokens: "OUTPUT TOKENS",
    tokensInOut: "TOKENS (IN/OUT)",
    context: "CONTEXT",
    tools: "TOOLS",
    health: "HEALTH",
    offlineWarning: "prismd gateway is not running (offline view from SQLite)",
    noDatabase: "No database found at",
    noUsageToday: "No recorded usage for today",
    usageFor: "Usage for",
  },
  "zh-CN": {
    title: "prismd 状态",
    uptime: "运行时间",
    config: "配置",
    totalTokens: "总 Token",
    alias: "别名",
    provider: "提供方",
    model: "模型",
    providerModel: "提供方 / 模型",
    status: "状态",
    requests: "请求数",
    inputTokens: "输入 TOKEN",
    outputTokens: "输出 TOKEN",
    tokensInOut: "TOKEN (输入/输出)",
    context: "上下文",
    tools: "工具",
    health: "健康度",
    offlineWarning: "prismd 网关未运行（来自 SQLite 离线视图）",
    noDatabase: "未找到数据库：",
    noUsageToday: "今日暂无记录的用量",
    usageFor: "今日用量：",
  },
  ja: {
    title: "prismd ステータス",
    uptime: "稼働時間",
    config: "設定",
    totalTokens: "合計 Token",
    alias: "エイリアス",
    provider: "プロバイダー",
    model: "モデル",
    providerModel: "プロバイダー / モデル",
    status: "ステータス",
    requests: "リクエスト数",
    inputTokens: "入力 TOKEN",
    outputTokens: "出力 TOKEN",
    tokensInOut: "TOKEN (入力/出力)",
    context: "コンテキスト",
    tools: "ツール",
    health: "ヘルス",
    offlineWarning: "prismd ゲートウェイは停止中（SQLite からのオフライン表示）",
    noDatabase: "データベースが見つかりません:",
    noUsageToday: "本日の使用量記録はありません",
    usageFor: "本日の使用量:",
  },
  ko: {
    title: "prismd 상태",
    uptime: "가동 시간",
    config: "구성",
    totalTokens: "총 토큰",
    alias: "별칭",
    provider: "제공자",
    model: "모델",
    providerModel: "제공자 / 모델",
    status: "상태",
    requests: "요청 수",
    inputTokens: "입력 토큰",
    outputTokens: "출력 토큰",
    tokensInOut: "토큰 (입력/출력)",
    context: "컨텍스트",
    tools: "도구",
    health: "건강도",
    offlineWarning: "prismd 게이트웨이가 실행 중이지 않음 (SQLite 오프라인 보기)",
    noDatabase: "데이터베이스를 찾을 수 없습니다:",
    noUsageToday: "오늘 기록된 사용량이 없습니다",
    usageFor: "오늘 사용량:",
  },
  de: {
    title: "prismd Status",
    uptime: "Betriebszeit",
    config: "Konfiguration",
    totalTokens: "Gesamt-Tokens",
    alias: "ALIAS",
    provider: "ANBIETER",
    model: "MODELL",
    providerModel: "ANBIETER / MODELL",
    status: "STATUS",
    requests: "ANFRAGEN",
    inputTokens: "EINGABE-TOKENS",
    outputTokens: "AUSGABE-TOKENS",
    tokensInOut: "TOKENS (EIN/AUS)",
    context: "KONTEXT",
    tools: "TOOLS",
    health: "GESUNDHEIT",
    offlineWarning: "prismd Gateway läuft nicht (Offline-Ansicht aus SQLite)",
    noDatabase: "Keine Datenbank gefunden unter",
    noUsageToday: "Keine aufgezeichnete Nutzung für heute",
    usageFor: "Nutzung für",
  },
  fr: {
    title: "Statut prismd",
    uptime: "Temps de fonctionnement",
    config: "Configuration",
    totalTokens: "Total de tokens",
    alias: "ALIAS",
    provider: "FOURNISSEUR",
    model: "MODÈLE",
    providerModel: "FOURNISSEUR / MODÈLE",
    status: "STATUT",
    requests: "REQUÊTES",
    inputTokens: "TOKENS ENTRÉE",
    outputTokens: "TOKENS SORTIE",
    tokensInOut: "TOKENS (ENTRÉE/SORTIE)",
    context: "CONTEXTE",
    tools: "OUTILS",
    health: "SANTÉ",
    offlineWarning: "La passerelle prismd n'est pas en cours d'exécution (vue hors ligne depuis SQLite)",
    noDatabase: "Aucune base de données trouvée à",
    noUsageToday: "Aucune utilisation enregistrée pour aujourd'hui",
    usageFor: "Utilisation pour",
  },
  es: {
    title: "Estado prismd",
    uptime: "Tiempo de actividad",
    config: "Configuración",
    totalTokens: "Total de tokens",
    alias: "ALIAS",
    provider: "PROVEEDOR",
    model: "MODELO",
    providerModel: "PROVEEDOR / MODELO",
    status: "ESTADO",
    requests: "SOLICITUDES",
    inputTokens: "TOKENS ENTRADA",
    outputTokens: "TOKENS SALIDA",
    tokensInOut: "TOKENS (ENTRADA/SALIDA)",
    context: "CONTEXTO",
    tools: "HERRAMIENTAS",
    health: "SALUD",
    offlineWarning: "La pasarela prismd no se está ejecutando (vista sin conexión desde SQLite)",
    noDatabase: "No se encontró ninguna base de datos en",
    noUsageToday: "No hay uso registrado para hoy",
    usageFor: "Uso para",
  },
  it: {
    title: "Stato prismd",
    uptime: "Tempo di attività",
    config: "Configurazione",
    totalTokens: "Token totali",
    alias: "ALIAS",
    provider: "PROVIDER",
    model: "MODELLO",
    providerModel: "PROVIDER / MODELLO",
    status: "STATO",
    requests: "RICHIESTE",
    inputTokens: "TOKEN INPUT",
    outputTokens: "TOKEN OUTPUT",
    tokensInOut: "TOKEN (IN/OUT)",
    context: "CONTESTO",
    tools: "STRUMENTI",
    health: "SALUTE",
    offlineWarning: "Il gateway prismd non è in esecuzione (vista offline da SQLite)",
    noDatabase: "Nessun database trovato in",
    noUsageToday: "Nessun utilizzo registrato per oggi",
    usageFor: "Utilizzo per",
  },
};

export function detectCliLanguage(env: NodeJS.ProcessEnv = process.env): SupportedLang {
  const langEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  const lower = langEnv.toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("it")) return "it";
  return "en";
}

export function stringWidth(str: string): number {
  let width = 0;
  // strip ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  const clean = str.replace(/\x1b\[[0-9;]*m/g, "");
  for (const char of clean) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x9fff) || // CJK Radicals & Ideographs
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth symbols
      (code >= 0x3040 && code <= 0x30ff)    // Hiragana & Katakana
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function padEndWidth(str: string, targetWidth: number): string {
  const w = stringWidth(str);
  if (w >= targetWidth) return str;
  return str + " ".repeat(targetWidth - w);
}

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

export function renderLiveStatus(data: ModelStatusResponse, lang?: SupportedLang): void {
  const currentLang = lang ?? detectCliLanguage();
  const t = CLI_TRANSLATIONS[currentLang] ?? CLI_TRANSLATIONS.en;

  let totalTokens = 0;
  const seen = new Set<string>();
  for (const aliasInfo of Object.values(data.aliases)) {
    for (const c of aliasInfo.candidates) {
      const key = `${c.provider}/${c.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        totalTokens += (c.quota.inputTokens ?? 0) + (c.quota.outputTokens ?? 0);
      }
    }
  }

  console.log(`\n\x1b[1m${t.title}\x1b[0m (${t.uptime}: ${formatUptime(data.uptime)} | ${t.totalTokens}: ${formatNumber(totalTokens)})\n`);

  for (const [alias, aliasInfo] of Object.entries(data.aliases)) {
    console.log(`\x1b[1m${alias}\x1b[0m`);
    console.log("─".repeat(95));
    console.log(
      `${padEndWidth(t.providerModel, 44)} ${padEndWidth(t.status, 16)} ${padEndWidth(t.requests, 14)} ${padEndWidth(t.tokensInOut, 18)}`,
    );
    console.log("─".repeat(95));

    for (const c of aliasInfo.candidates) {
      const isActive = aliasInfo.activeCandidate === `${c.provider}/${c.model}`;
      const activeMark = isActive ? "★ " : "  ";
      const name = padEndWidth(`${activeMark}${c.provider}/${c.model}`, 44);
      const statusText = padEndWidth(colorStatus(c.status), 16);

      let reqs = "— / —";
      if (c.quota.dailyRequests && c.quota.dailyRequests.limit !== null) {
        const used = c.quota.dailyRequests.used ?? 0;
        const limit = c.quota.dailyRequests.limit;
        const ratio = Math.round((c.quota.dailyRequests.ratio ?? 0) * 100);
        reqs = `${used}/${limit} (${ratio}%)`;
      }
      const reqsText = padEndWidth(reqs, 14);
      const tokensText = `${formatNumber(c.quota.inputTokens)} / ${formatNumber(c.quota.outputTokens)} (${c.quota.source})`;

      console.log(`${name} ${statusText} ${reqsText} ${tokensText}`);
    }
    console.log();
  }
}

export function renderOfflineStatus(dbPath: string, lang?: SupportedLang): void {
  const currentLang = lang ?? detectCliLanguage();
  const t = CLI_TRANSLATIONS[currentLang] ?? CLI_TRANSLATIONS.en;

  console.log(`\n\x1b[33m${t.offlineWarning}\x1b[0m\n`);
  if (!existsSync(dbPath)) {
    console.log(`${t.noDatabase} ${dbPath}.`);
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
      console.log(`${t.noUsageToday} (${today}).`);
      return;
    }

    console.log(`${t.usageFor} ${today}:`);
    console.log("─".repeat(70));
    console.log(`${padEndWidth(t.providerModel, 36)} ${padEndWidth(t.requests, 12)} ${padEndWidth(t.tokensInOut, 20)}`);
    console.log("─".repeat(70));
    for (const r of rows) {
      const name = padEndWidth(`${r.provider}/${r.model}`.slice(0, 35), 36);
      const reqs = padEndWidth(String(r.requests), 12);
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
