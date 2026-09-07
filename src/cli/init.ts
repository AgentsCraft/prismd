/**
 * prismd init — interactive setup wizard.
 *
 * Guides the user through:
 *   - Mode selection when existing configs are found (clients only, re-configure, regenerate)
 *   - Local auth token generation/configuration (prismd:)
 *   - Selecting cloud providers (OpenRouter, Groq, Google Gemini, Cerebras, etc.)
 *   - Entering API keys (multi-key pooling supported)
 *   - Automated coding client setup (Claude Code, Codex CLI, OpenCode, Pi Agent) with backups
 *   - Generating ~/.prismd/keys.yaml (chmod 600) and ~/.prismd/prismd.json
 *
 * Zero external dependencies — uses pure Node built-ins (crypto, fs, path, os).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { generateConfigStringAsync } from "../generate-config.js";
import { loadKeyStore } from "../keys.js";
import {
  SUPPORTED_CLIENTS,
  setupClient,
  backupFileIfExists,
  getClientConfigPath,
  type ClientDefinition,
  type SetupResult,
} from "./client-config.js";

// ── ANSI helpers (only when TTY) ─────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  bold:  (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:  (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  yellow:(s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
};

// ── Provider catalogue ────────────────────────────────────────────────────────
interface ProviderDef {
  id: string;
  label: string;
  hint: string;
  keyUrl: string;
  multiKey: boolean;
  keyExample: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "One key covers 100+ free models — easiest to start",
    keyUrl: "https://openrouter.ai/keys",
    multiKey: false,
    keyExample: "sk-or-v1-xxxx",
  },
  {
    id: "groq",
    label: "Groq",
    hint: "Fastest inference, generous free tier",
    keyUrl: "https://console.groq.com/keys",
    multiKey: true,
    keyExample: "gsk_xxxx",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    hint: "Gemini 2.0 Flash, 15 rpm free",
    keyUrl: "https://aistudio.google.com/apikey",
    multiKey: true,
    keyExample: "AIzaSyxxxx",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    hint: "Ultra-fast Llama inference",
    keyUrl: "https://cloud.cerebras.ai",
    multiKey: true,
    keyExample: "csk_xxxx",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    hint: "NVIDIA hosted open models",
    keyUrl: "https://build.nvidia.com",
    multiKey: false,
    keyExample: "nvapi-xxxx",
  },
  {
    id: "github",
    label: "GitHub Models",
    hint: "Free via GitHub personal token",
    keyUrl: "https://github.com/settings/tokens",
    multiKey: false,
    keyExample: "ghp_xxxx",
  },
  {
    id: "amd",
    label: "AMD Developer Cloud",
    hint: "Optional: AMD hosted models",
    keyUrl: "https://developer.amd.com",
    multiKey: false,
    keyExample: "amd_token_xxxx",
  },
];

// ── Stream / input reader ─────────────────────────────────────────────────────

class PromptReader {
  private lines: string[] = [];
  private waiters: ((line: string) => void)[] = [];
  private closed = false;

  constructor() {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (this.waiters.length > 0) {
          const waiter = this.waiters.shift()!;
          waiter(line);
        } else {
          this.lines.push(line);
        }
      }
    });
    process.stdin.on("end", () => {
      this.closed = true;
      if (buffer.length > 0) {
        const line = buffer;
        buffer = "";
        if (this.waiters.length > 0) {
          this.waiters.shift()!(line);
        } else {
          this.lines.push(line);
        }
      }
      while (this.waiters.length > 0) {
        this.waiters.shift()!("");
      }
    });
  }

  async readLine(prompt?: string): Promise<string> {
    if (prompt) process.stdout.write(prompt);
    if (this.lines.length > 0) {
      return this.lines.shift()!;
    }
    if (this.closed) return "";
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async readSecret(prompt: string): Promise<string> {
    if (!isTTY || process.platform === "win32") {
      return (await this.readLine(prompt)).trim();
    }
    process.stdout.write(prompt);
    return new Promise((resolve) => {
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const onData = (ch: string) => {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input.trim());
        } else if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += ch;
          process.stdout.write("*");
        }
      };
      process.stdin.on("data", onData);
    });
  }

  close(): void {
    process.stdin.pause();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomToken(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

function printBanner(): void {
  console.log();
  console.log(c.bold("  " + "=".repeat(43)));
  console.log(c.bold("  ") + c.cyan(c.bold("        prismd  --  setup wizard")));
  console.log(c.bold("  " + "=".repeat(43)));
  console.log();
  console.log("  This wizard creates " + c.cyan("~/.prismd/keys.yaml") + " and");
  console.log("  generates your gateway config.");
  console.log();
}

function printProviderMenu(providers: ProviderDef[], selected: Set<number>): void {
  console.log(c.bold("  Available providers:"));
  console.log();
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const tick = selected.has(i) ? c.green("[ok]") : " ";
    const num = String(i + 1).padStart(2);
    console.log(`  [${tick}] ${num}. ${c.bold(p.label)}`);
    console.log(`          ${c.dim(p.hint)}`);
  }
  console.log();
}

function printClientMenu(
  clients: ClientDefinition[],
  selected: Set<number>,
  homeDir: string,
): void {
  console.log(c.bold("  Supported coding clients:"));
  console.log();
  for (let i = 0; i < clients.length; i++) {
    const cl = clients[i];
    const tick = selected.has(i) ? c.green("[ok]") : " ";
    const num = String(i + 1).padStart(2);
    const targetFile = getClientConfigPath(cl.id, homeDir);
    const exists = targetFile && existsSync(targetFile);
    const tag = exists ? c.yellow(" [existing config — will backup]") : "";
    console.log(`  [${tick}] ${num}. ${c.bold(cl.name)}${tag}`);
    console.log(`          ${c.dim(cl.description)}`);
  }
  console.log();
}

/**
 * Interactive selection and execution of client configurations.
 */
async function runClientConfigurationFlow(
  reader: PromptReader,
  homeDir: string,
  prismdToken: string,
): Promise<SetupResult[]> {
  console.log(c.bold("  Configure coding clients:"));
  console.log();
  console.log("  Enter numbers of the clients you want to set up (space/comma separated).");
  console.log("  Press " + c.bold("Enter") + " to skip.");
  console.log();

  printClientMenu(SUPPORTED_CLIENTS, new Set(), homeDir);

  const raw = (await reader.readLine("  Select clients (e.g. 1 2, or Enter to skip): ")).trim();
  if (raw === "") {
    return [];
  }

  const selectedNums = raw
    .split(/[\s,]+/)
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((n) => !isNaN(n) && n >= 0 && n < SUPPORTED_CLIENTS.length);

  const selectedSet = new Set(selectedNums);
  const clientResults: SetupResult[] = [];

  if (selectedSet.size > 0) {
    console.log();
    console.log(c.bold("  Writing client configurations..."));
    for (const idx of [...selectedSet].sort((a, b) => a - b)) {
      const clientDef = SUPPORTED_CLIENTS[idx];
      const res = setupClient(clientDef.id, homeDir, prismdToken);
      if (res) {
        clientResults.push(res);
        for (const b of res.backupsCreated) {
          console.log(c.yellow("  [!] ") + `${res.name}: backed up previous config to ${c.dim(b)}`);
        }
        for (const f of res.filesWritten) {
          console.log(c.green("  [+] ") + `${res.name}: configured ${c.dim(f)}`);
        }
        if (res.notes) {
          console.log(c.dim(`      ${res.notes}`));
        }
      }
    }
  }

  return clientResults;
}

function serializeKeysYaml(
  keys: Record<string, string | string[]>,
  comments: Record<string, string>,
): string {
  const lines: string[] = [
    "# ~/.prismd/keys.yaml — generated by: prismd init",
    "# Treat this file like a password (chmod 600 is set automatically).",
    "",
  ];
  for (const [field, value] of Object.entries(keys)) {
    const comment = comments[field];
    if (comment) lines.push(`# ${comment}`);
    if (Array.isArray(value)) {
      lines.push(`${field}:`);
      for (const v of value) lines.push(`  - "${v}"`);
    } else {
      lines.push(`${field}: "${value}"`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Synchronize local auth token into ~/.prismd/keys.yaml.
 * Ensures the running or next started prismd gateway matches client credentials.
 */
export function updateLocalTokenInKeysYaml(keysPath: string, token: string): void {
  try {
    let content = "";
    if (existsSync(keysPath)) {
      content = readFileSync(keysPath, "utf8");
    }
    const tokenLine = `prismd: "${token}"`;
    if (/^prismd:\s*.*$/m.test(content)) {
      content = content.replace(/^prismd:\s*.*$/m, tokenLine);
    } else {
      content = tokenLine + (content ? "\n\n" + content : "\n");
    }
    writeFileSync(keysPath, content, { mode: 0o600 });
    console.log(c.green("  [+] ") + `Synced auth token to ${c.dim(keysPath)}`);
  } catch (err) {
    console.log(c.yellow("  [!] Failed to sync token to keys.yaml: ") + (err as Error).message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runInitCli(): Promise<number> {
  const homeDir = process.env.PRISMD_HOME ?? homedir();
  const cwd = process.env.PRISMD_CWD ?? process.cwd();
  const prismdDir = join(homeDir, ".prismd");
  const keysPath = join(prismdDir, "keys.yaml");
  const configPath = join(prismdDir, "prismd.json");

  printBanner();

  const reader = new PromptReader();

  try {
    // ── Existing config check ────────────────────────────────────────────────
    const keysExist = existsSync(keysPath);
    const configExists = existsSync(configPath);
    if (keysExist || configExists) {
      console.log(c.yellow("  [!] Existing configuration detected:"));
      if (keysExist)    console.log("     " + c.dim(keysPath));
      if (configExists) console.log("     " + c.dim(configPath));
      console.log();
      console.log(c.bold("  What would you like to do?"));
      console.log("    1. Configure coding clients only   " + c.dim("(Claude Code, Codex, OpenCode, Pi Agent)"));
      console.log("    2. Re-configure gateway API keys   " + c.dim("(Re-run full setup; keys.yaml will be backed up)"));
      console.log("    3. Regenerate prismd.json          " + c.dim("(Recompile gateway config from existing keys.yaml)"));
      console.log("    4. Exit");
      console.log();

      const choice = (await reader.readLine(`  Select option ${c.dim("[default: 1]")} : `)).trim();

      if (choice === "1" || choice === "") {
        // Mode 1: Configure coding clients only
        const store = loadKeyStore(homeDir, cwd);
        const rawToken = store.yaml?.["prismd"];
        const existingToken =
          typeof rawToken === "string" && rawToken.trim() !== "" ? rawToken.trim() : undefined;
        let tokenToUse = existingToken ?? randomToken();

        console.log();
        console.log(c.bold("  Local Auth Token"));
        console.log(`  Current token: ${c.cyan(tokenToUse)}`);
        const changeToken = (await reader.readLine("  Press Enter to keep this token, or enter a new one: ")).trim();
        if (changeToken !== "") {
          tokenToUse = changeToken;
        }
        console.log();

        if (rawToken !== tokenToUse) {
          updateLocalTokenInKeysYaml(keysPath, tokenToUse);
        }

        const clientResults = await runClientConfigurationFlow(reader, homeDir, tokenToUse);

        console.log();
        console.log("  " + "─".repeat(45));
        console.log();
        console.log(c.green(c.bold("  Client setup complete!")));
        console.log();
        if (clientResults.length > 0) {
          console.log(c.bold("  Launch your configured client(s):"));
          console.log();
          for (const cr of clientResults) {
            console.log(`    ${c.bold(cr.name)}:`);
            console.log("      " + c.cyan(cr.launchCommand));
            console.log();
          }
        }
        console.log("  Dashboard: " + c.cyan("http://127.0.0.1:8787/ui"));
        console.log();
        return 0;
      }

      if (choice === "3") {
        console.log();
        console.log("  Building gateway config from existing keys...");
        try {
          const content = await generateConfigStringAsync({
            homeDir,
            cwd,
            liveCheck: true,
            warn: (msg) => console.log(c.yellow("  [!] ") + msg),
          });
          writeFileSync(configPath, content, { mode: 0o600 });
          console.log(c.green("  [+] ") + "prismd.json written  " + c.dim(configPath));
        } catch (err) {
          console.log(c.yellow("  [!] Config generation failed: ") + (err as Error).message);
        }
        console.log();
        return 0;
      }

      if (choice === "4") {
        console.log("  Exited.");
        console.log();
        return 0;
      }

      if (choice !== "2") {
        console.log(c.yellow("  Unrecognized option. Exited."));
        console.log();
        return 0;
      }

      console.log();
    }

    // ── Step 1: local auth token ─────────────────────────────────────────────
    const existingStore = loadKeyStore(homeDir, cwd);
    const existingRawToken = existingStore.yaml?.["prismd"];
    const defaultToken =
      typeof existingRawToken === "string" && existingRawToken.trim() !== ""
        ? existingRawToken.trim()
        : randomToken();
    console.log(c.bold("  Step 1 / 4  —  Local auth token"));
    console.log();
    console.log("  Coding agents use this token to authenticate with prismd.");
    console.log("  Any string works — it never leaves your machine.");
    console.log();
    const tokenInput = (
      await reader.readLine(`  Token ${c.dim(`[default: ${defaultToken}]`)} : `)
    ).trim();
    const prismdToken = tokenInput !== "" ? tokenInput : defaultToken;
    console.log();

    // ── Step 2: provider selection ───────────────────────────────────────────
    console.log(c.bold("  Step 2 / 4  —  Select providers"));
    console.log();
    console.log("  Enter provider numbers (space/comma separated) to toggle selection.");
    console.log("  Press " + c.bold("Enter") + " on an empty line when done.");
    console.log();

    const selected = new Set<number>();
    printProviderMenu(PROVIDERS, selected);

    while (true) {
      const raw = (await reader.readLine("  Toggle (numbers) or Enter to confirm: ")).trim();

      if (raw === "") {
        if (selected.size === 0) {
          console.log(c.yellow("  Please select at least one provider."));
          continue;
        }
        break;
      }

      const nums = raw
        .split(/[\s,]+/)
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((n) => !isNaN(n) && n >= 0 && n < PROVIDERS.length);

      for (const n of nums) {
        selected.has(n) ? selected.delete(n) : selected.add(n);
      }

      // Reprint the updated menu
      console.log();
      printProviderMenu(PROVIDERS, selected);
    }

    const selectedProviders = [...selected]
      .sort((a, b) => a - b)
      .map((i) => PROVIDERS[i]);

    console.log();
    console.log(
      "  Selected: " + selectedProviders.map((p) => c.green(p.label)).join(", "),
    );
    console.log();

    // ── Step 3: key entry ────────────────────────────────────────────────────
    console.log(c.bold("  Step 3 / 4  —  Enter API keys"));
    console.log();

    const collectedKeys: Record<string, string | string[]> = { prismd: prismdToken };
    const keyComments: Record<string, string> = {
      prismd: "Local auth token — used by your coding agents",
    };

    for (const provider of selectedProviders) {
      console.log(
        `  ${c.bold(provider.label)}  ${c.dim("→")}  ${c.cyan(provider.keyUrl)}`,
      );

      if (provider.multiKey) {
        console.log(
          c.dim("  Supports multiple keys — enter one per prompt, empty line to stop."),
        );
        console.log();
        const providerKeys: string[] = [];
        let idx = 1;
        while (true) {
          const key = await reader.readSecret(
            `  Key ${idx} ${c.dim(`(${provider.keyExample})`)}${idx > 1 ? c.dim(" [empty to stop]") : ""} : `,
          );
          if (key.trim() === "") {
            if (providerKeys.length === 0) {
              console.log(c.yellow(`  Skipping ${provider.label}.`));
            }
            break;
          }
          providerKeys.push(key.trim());
          idx++;
        }
        if (providerKeys.length > 0) {
          collectedKeys[provider.id] =
            providerKeys.length === 1 ? providerKeys[0] : providerKeys;
          keyComments[provider.id] = `${provider.label} — ${provider.keyUrl}`;
        }
      } else {
        console.log();
        const key = await reader.readSecret(
          `  Key ${c.dim(`(${provider.keyExample})`)} : `,
        );
        if (key.trim() !== "") {
          collectedKeys[provider.id] = key.trim();
          keyComments[provider.id] = `${provider.label} — ${provider.keyUrl}`;
        } else {
          console.log(c.yellow(`  Skipping ${provider.label}.`));
        }
      }
      console.log();
    }

    // ── Write keys.yaml ───────────────────────────────────────────────────────
    mkdirSync(prismdDir, { recursive: true, mode: 0o700 });
    const keysBackup = backupFileIfExists(keysPath);
    if (keysBackup) {
      console.log(c.yellow("  [!] ") + "backed up previous keys.yaml to " + c.dim(keysBackup));
    }
    writeFileSync(keysPath, serializeKeysYaml(collectedKeys, keyComments), {
      mode: 0o600,
    });
    console.log(c.green("  [+] ") + "keys.yaml written  " + c.dim(keysPath));

    // ── Generate prismd.json ──────────────────────────────────────────────────
    console.log();
    console.log(
      "  Building gateway config" +
        c.dim(" (querying upstreams for active models…)"),
    );

    try {
      const content = await generateConfigStringAsync({
        homeDir,
        cwd,
        liveCheck: true,
        warn: (msg) => console.log(c.yellow("  [!] ") + msg),
      });
      writeFileSync(configPath, content, { mode: 0o600 });
      console.log(c.green("  [+] ") + "prismd.json written  " + c.dim(configPath));
    } catch (err) {
      console.log(
        c.yellow("  ⚠  Config generation failed: ") + (err as Error).message,
      );
      console.log(
        c.dim('     Run "prismd generate" manually after fixing the issue.'),
      );
    }

    // ── Step 4: configure coding clients ─────────────────────────────────────
    console.log();
    console.log(c.bold("  Step 4 / 4  —  Configure coding clients (optional)"));
    console.log();
    const clientResults = await runClientConfigurationFlow(reader, homeDir, prismdToken);

    // ── Next steps ────────────────────────────────────────────────────────────
    const configuredProviders = Object.keys(collectedKeys).filter((k) => k !== "prismd");

    console.log();
    console.log("  " + "─".repeat(45));
    console.log();
    console.log(c.green(c.bold("  Setup complete!")));
    console.log();
    console.log(`  ${c.bold("Auth token:")}  ${c.cyan(prismdToken)}`);
    console.log(`  ${c.bold("Providers:")}   ${configuredProviders.join(", ")}`);
    if (clientResults.length > 0) {
      console.log(`  ${c.bold("Clients:")}     ${clientResults.map((r) => r.name).join(", ")}`);
    }
    console.log();
    console.log(c.bold("  1. Start the gateway:"));
    console.log();
    console.log("    " + c.cyan("prismd"));
    console.log();

    if (clientResults.length > 0) {
      console.log(c.bold("  2. Launch your configured client(s):"));
      console.log();
      for (const cr of clientResults) {
        console.log(`    ${c.bold(cr.name)}:`);
        console.log("      " + c.cyan(cr.launchCommand));
        console.log();
      }
    } else {
      console.log(c.bold("  2. Connect an agent — Claude Code example:"));
      console.log();
      console.log(
        "    export ANTHROPIC_BASE_URL=" + c.cyan('"http://127.0.0.1:8787/v1"'),
      );
      console.log("    export ANTHROPIC_API_KEY=" + c.cyan(`"${prismdToken}"`));
      console.log("    " + c.cyan("claude"));
      console.log();
      console.log(
        c.dim(
          "  Codex CLI, OpenCode, Pi Agent, Cursor: https://github.com/AgentsCraft/prismd#connect-your-agent",
        ),
      );
      console.log();
    }

    console.log("  Dashboard: " + c.cyan("http://127.0.0.1:8787/ui"));
    console.log();

    return 0;
  } finally {
    reader.close();
  }
}
