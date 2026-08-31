/**
 * E2E journey: Codex catalog generation (scripts/generate-codex-catalog.mjs).
 *
 * 环境准备：不污染本机 ~/.codex —— 一律传 --out 到临时文件；模板来源用
 * --models-path 指向临时 fixture（不读真实 ~/.codex/models.json）。
 * 黑盒视角：只调用 CLI（spawnSync node scripts/generate-codex-catalog.mjs），
 * 断言输出文件结构，不 import 脚本内部。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "generate-codex-catalog.mjs");

/** Temp root with presets/providers.json + a codex models.json template. */
function makeCatalogRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "prismd-e2e-catalog-"));
  mkdirSync(join(root, "presets"), { recursive: true });
  writeFileSync(
    join(root, "presets", "providers.json"),
    JSON.stringify(
      {
        providers: {
          openrouter: { type: "responses", baseUrl: "https://openrouter.ai/api/v1", apiKeyField: "openrouter" },
          groq: { type: "responses", baseUrl: "https://api.groq.com/openai/v1", apiKeyField: "groq" },
        },
        models: {
          laguna: {
            provider: "openrouter",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
          tiny: {
            provider: "groq",
            contextWindow: 4096,
            maxOutputTokens: 100,
            supportsTools: false,
            supportsReasoning: false,
            limits: { dailyRequests: 10, rpm: 30, maxConcurrent: 4 },
            tags: ["free", "fast"],
          },
        },
        aliases: {
          "free-auto": { description: "auto", candidates: ["laguna", "tiny"] },
          "free-fast": { candidates: ["tiny"] },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "models.json"),
    JSON.stringify({
      models: [
        {
          slug: "template-model",
          display_name: "Template Model",
          context_window: 131072,
          max_context_window: 131072,
          supported_reasoning_levels: [{ effort: "low", description: "low" }],
          shell_type: "shell_command",
          visibility: "list",
          supported_in_api: true,
          priority: 42,
          support_verbosity: true,
          truncation_policy: { mode: "tokens", limit: 9999 },
          experimental_supported_tools: [],
          base_instructions: "e2e-template-clone",
        },
      ],
    }),
  );
  return root;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

test("旅程 11：catalog 生成 —— 每别名一条目、窗口取候选最小值、含 supported_reasoning_levels", async (t) => {
  // 前置条件：临时 root（presets 两个别名：free-auto [262144, 4096]、
  // free-fast [4096]）+ 临时 codex 模板（带可辨识 base_instructions）。
  const root = makeCatalogRoot();
  const outPath = join(root, "prismd-models.json");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const run = runCli(["--root", root, "--models-path", join(root, "models.json"), "--out", outPath]);

  // 断言点：退出码 0；输出文件生成在 --out（本机 ~/.codex 未被触碰）。
  assert.equal(run.status, 0, `CLI must exit 0\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.ok(existsSync(outPath), "catalog file must be written to --out");

  const catalog = JSON.parse(readFileSync(outPath, "utf8")) as {
    models: Record<string, unknown>[];
  };

  // 每别名一条目，slug / display_name 即别名。
  assert.deepEqual(
    catalog.models.map((m) => m.slug),
    ["free-auto", "free-fast"],
  );
  for (const entry of catalog.models) {
    assert.equal(entry.display_name, entry.slug);
  }

  // context_window / max_context_window 取候选最小值（保守）。
  assert.equal(catalog.models[0].context_window, 4096, "min(262144, 4096)");
  assert.equal(catalog.models[0].max_context_window, 4096);
  assert.equal(catalog.models[1].context_window, 4096, "single candidate keeps its own window");

  // 必需字段（M0 坑）：supported_reasoning_levels 必须存在且非空；
  // 条目结构克隆自模板（base_instructions 可辨识）。
  for (const entry of catalog.models) {
    const levels = entry.supported_reasoning_levels as unknown[];
    assert.ok(Array.isArray(levels) && levels.length > 0, `supported_reasoning_levels missing on ${String(entry.slug)}`);
    assert.equal(entry.base_instructions, "e2e-template-clone", "entry structure must be cloned from the codex template");
  }
  assert.deepEqual(catalog.models.map((m) => m.priority), [1, 2], "priority must follow catalog order");
});

test("旅程 11 冒烟：对仓库真实 presets 生成 catalog，结构完整且含 free-auto", async (t) => {
  // 前置条件：直接以仓库为 --root（读取真实 presets + config.user.json）。
  const outDir = mkdtempSync(join(tmpdir(), "prismd-e2e-catalog-repo-"));
  const outPath = join(outDir, "prismd-models.json");
  t.after(() => rmSync(outDir, { recursive: true, force: true }));

  const run = runCli(["--root", REPO_ROOT, "--out", outPath]);

  assert.equal(run.status, 0, `CLI must exit 0 against the real repo\nstderr: ${run.stderr}`);
  const catalog = JSON.parse(readFileSync(outPath, "utf8")) as {
    models: Record<string, unknown>[];
  };
  assert.ok(catalog.models.length >= 1, "at least one alias entry");
  assert.ok(
    catalog.models.some((m) => m.slug === "free-auto"),
    "free-auto alias must be present",
  );
  for (const entry of catalog.models) {
    assert.equal(entry.display_name, entry.slug);
    assert.equal(typeof entry.context_window, "number");
    assert.ok((entry.context_window as number) > 0);
    const levels = entry.supported_reasoning_levels as unknown[];
    assert.ok(Array.isArray(levels) && levels.length > 0, `supported_reasoning_levels missing on ${String(entry.slug)}`);
  }
});
