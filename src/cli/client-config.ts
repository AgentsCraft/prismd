/**
 * Automated client configuration helpers for coding agents (Claude Code,
 * Codex CLI, OpenCode, Pi Agent).
 *
 * Each helper writes standard configuration files to user directories or
 * generates lightweight launcher scripts without external dependencies.
 * Automatically creates timestamped backups when target files already exist.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClientDefinition {
  id: string;
  name: string;
  description: string;
  configFile?: string;
  launchCommand: (token: string) => string;
}

export const SUPPORTED_CLIENTS: ClientDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Launch helper script + environment setup",
    launchCommand: (token) =>
      `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1" ANTHROPIC_API_KEY="${token}" && claude`,
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "~/.codex/prismd.config.toml profile",
    configFile: "~/.codex/prismd.config.toml",
    launchCommand: (token) => `PRISMD_API_KEY="${token}" codex --profile prismd`,
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "~/.config/opencode/config.json provider",
    configFile: "~/.config/opencode/config.json",
    launchCommand: () => "opencode --model prismd/free-auto",
  },
  {
    id: "pi",
    name: "Pi Agent",
    description: "~/.pi/config.json provider",
    configFile: "~/.pi/config.json",
    launchCommand: () => "pi run",
  },
];

export interface SetupResult {
  name: string;
  filesWritten: string[];
  backupsCreated: string[];
  launchCommand: string;
  notes?: string;
}

/**
 * Safely create a timestamped backup of a file if it already exists.
 * Returns the created backup path, or null if original file did not exist.
 */
export function backupFileIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupPath = `${filePath}.bak.${ts}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Resolve standard target config file path for a client (if applicable).
 */
export function getClientConfigPath(clientId: string, homeDir: string): string | null {
  switch (clientId) {
    case "codex":
      return join(homeDir, ".codex", "prismd.config.toml");
    case "opencode":
      return join(homeDir, ".config", "opencode", "config.json");
    case "pi":
      return join(homeDir, ".pi", "config.json");
    default:
      return null;
  }
}

/**
 * Configure Claude Code helper scripts in ~/.prismd/
 */
export function setupClaudeCode(homeDir: string, token: string): SetupResult {
  const prismdDir = join(homeDir, ".prismd");
  mkdirSync(prismdDir, { recursive: true, mode: 0o700 });

  const written: string[] = [];
  const backups: string[] = [];

  // 1. Unix shell wrapper
  const shPath = join(prismdDir, "claude-prismd.sh");
  const bSh = backupFileIfExists(shPath);
  if (bSh) backups.push(bSh);
  const shContent = [
    "#!/usr/bin/env bash",
    'export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"',
    `export ANTHROPIC_API_KEY="${token}"`,
    'exec claude "$@"',
    "",
  ].join("\n");
  writeFileSync(shPath, shContent, { mode: 0o755 });
  written.push(shPath);

  // 2. Windows cmd and ps1 wrappers
  const cmdPath = join(prismdDir, "claude-prismd.cmd");
  const bCmd = backupFileIfExists(cmdPath);
  if (bCmd) backups.push(bCmd);
  const cmdContent = [
    "@echo off",
    "set ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1",
    `set ANTHROPIC_API_KEY=${token}`,
    "claude %*",
    "",
  ].join("\r\n");
  writeFileSync(cmdPath, cmdContent, { mode: 0o600 });
  written.push(cmdPath);

  const ps1Path = join(prismdDir, "claude-prismd.ps1");
  const bPs1 = backupFileIfExists(ps1Path);
  if (bPs1) backups.push(bPs1);
  const ps1Content = [
    '$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787/v1"',
    `$env:ANTHROPIC_API_KEY = "${token}"`,
    "& claude @args",
    "",
  ].join("\r\n");
  writeFileSync(ps1Path, ps1Content, { mode: 0o600 });
  written.push(ps1Path);

  return {
    name: "Claude Code",
    filesWritten: written,
    backupsCreated: backups,
    launchCommand: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1" ANTHROPIC_API_KEY="${token}" && claude`,
    notes: `Launcher scripts saved to ~/.prismd/ (e.g. ${process.platform === "win32" ? "claude-prismd.cmd" : "claude-prismd.sh"})`,
  };
}

/**
 * Configure Codex CLI profile at ~/.codex/prismd.config.toml
 */
export function setupCodex(homeDir: string, token: string): SetupResult {
  const codexDir = join(homeDir, ".codex");
  mkdirSync(codexDir, { recursive: true, mode: 0o700 });

  const tomlPath = join(codexDir, "prismd.config.toml");
  const backups: string[] = [];
  const b = backupFileIfExists(tomlPath);
  if (b) backups.push(b);

  const tomlContent = [
    "# ~/.codex/prismd.config.toml — generated by prismd init",
    'model = "free-auto"',
    'model_provider = "prismd"',
    "",
    "[model_providers.prismd]",
    'name = "prismd"',
    'base_url = "http://127.0.0.1:8787/v1"',
    'env_key = "PRISMD_API_KEY"',
    'wire_api = "responses"',
    "request_max_retries = 2",
    "stream_max_retries = 1",
    "stream_idle_timeout_ms = 180000",
    "",
  ].join("\n");

  writeFileSync(tomlPath, tomlContent, { mode: 0o600 });

  return {
    name: "Codex CLI",
    filesWritten: [tomlPath],
    backupsCreated: backups,
    launchCommand: `PRISMD_API_KEY="${token}" codex --profile prismd`,
  };
}

/**
 * Configure OpenCode at ~/.config/opencode/config.json
 */
export function setupOpenCode(homeDir: string, token: string): SetupResult {
  const configDir = join(homeDir, ".config", "opencode");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });

  const jsonPath = join(configDir, "config.json");
  const backups: string[] = [];
  const b = backupFileIfExists(jsonPath);
  if (b) backups.push(b);

  let existingConfig: Record<string, any> = {};
  if (b) {
    try {
      existingConfig = JSON.parse(readFileSync(b, "utf8"));
    } catch {
      existingConfig = {};
    }
  }

  if (!existingConfig.providers || typeof existingConfig.providers !== "object") {
    existingConfig.providers = {};
  }

  existingConfig.providers.prismd = {
    type: "openai",
    baseUrl: "http://127.0.0.1:8787/v1",
    apiKey: token,
    models: ["free-auto"],
  };

  writeFileSync(jsonPath, JSON.stringify(existingConfig, null, 2) + "\n", {
    mode: 0o600,
  });

  return {
    name: "OpenCode",
    filesWritten: [jsonPath],
    backupsCreated: backups,
    launchCommand: "opencode --model prismd/free-auto",
  };
}

/**
 * Configure Pi Agent at ~/.pi/config.json
 */
export function setupPi(homeDir: string, token: string): SetupResult {
  const piDir = join(homeDir, ".pi");
  mkdirSync(piDir, { recursive: true, mode: 0o700 });

  const jsonPath = join(piDir, "config.json");
  const backups: string[] = [];
  const b = backupFileIfExists(jsonPath);
  if (b) backups.push(b);

  let existingConfig: Record<string, any> = {};
  if (b) {
    try {
      existingConfig = JSON.parse(readFileSync(b, "utf8"));
    } catch {
      existingConfig = {};
    }
  }

  existingConfig.provider = {
    name: "prismd",
    protocol: "openai-completions",
    endpoint: "http://127.0.0.1:8787/v1",
    apiKey: token,
    defaultModel: "free-auto",
  };

  writeFileSync(jsonPath, JSON.stringify(existingConfig, null, 2) + "\n", {
    mode: 0o600,
  });

  return {
    name: "Pi Agent",
    filesWritten: [jsonPath],
    backupsCreated: backups,
    launchCommand: "pi run",
  };
}

/**
 * Setup a client by ID.
 */
export function setupClient(
  clientId: string,
  homeDir: string,
  token: string,
): SetupResult | null {
  switch (clientId) {
    case "claude":
      return setupClaudeCode(homeDir, token);
    case "codex":
      return setupCodex(homeDir, token);
    case "opencode":
      return setupOpenCode(homeDir, token);
    case "pi":
      return setupPi(homeDir, token);
    default:
      return null;
  }
}
