/**
 * Automated client configuration helpers for coding agents (Claude Code,
 * Codex CLI, OpenCode, Pi Agent).
 *
 * Each helper writes standard native configuration files to user directories
 * so clients can be started with their original native commands (e.g. claude,
 * codex, opencode, pi) without requiring long custom command lines.
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
    description: "~/.claude/settings.json",
    configFile: "~/.claude/settings.json",
    launchCommand: () => "claude",
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "~/.codex/config.toml & auth.json",
    configFile: "~/.codex/config.toml",
    launchCommand: () => "codex",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "~/.config/opencode/opencode.json",
    configFile: "~/.config/opencode/opencode.json",
    launchCommand: () => "opencode",
  },
  {
    id: "pi",
    name: "Pi Agent",
    description: "~/.pi/config.json",
    configFile: "~/.pi/config.json",
    launchCommand: () => "pi",
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
 * Resolve standard target primary config file path for a client (if applicable).
 */
export function getClientConfigPath(clientId: string, homeDir: string): string | null {
  switch (clientId) {
    case "claude":
      return join(homeDir, ".claude", "settings.json");
    case "codex":
      return join(homeDir, ".codex", "config.toml");
    case "opencode":
      return join(homeDir, ".config", "opencode", "opencode.json");
    case "pi":
      return join(homeDir, ".pi", "config.json");
    default:
      return null;
  }
}

/**
 * Update top-level model/model_provider keys and [model_providers.prismd] in a TOML string
 * without external dependencies. Preserves all other sections and comments.
 */
export function updateCodexToml(existingToml: string): string {
  const lines = existingToml.split(/\r?\n/);
  const resultLines: string[] = [];

  let inPrismdSection = false;
  let seenModelProvider = false;
  let seenModel = false;
  let hasPrismdSection = false;

  for (const line of lines) {
    if (/^\s*\[model_providers\.prismd\]\s*$/.test(line)) {
      hasPrismdSection = true;
      break;
    }
  }

  let inFirstSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isSectionHeader = /^\s*\[/.test(line);

    if (isSectionHeader) {
      inFirstSection = true;
      if (/^\s*\[model_providers\.prismd\]\s*$/.test(line)) {
        inPrismdSection = true;
        resultLines.push("[model_providers.prismd]");
        resultLines.push('name = "prismd"');
        resultLines.push('base_url = "http://127.0.0.1:8787/v1"');
        resultLines.push('wire_api = "responses"');
        resultLines.push("requires_openai_auth = true");
        continue;
      } else {
        inPrismdSection = false;
      }
    }

    if (inPrismdSection) {
      continue;
    }

    if (!inFirstSection) {
      if (/^\s*model_provider\s*=/.test(line)) {
        resultLines.push('model_provider = "prismd"');
        seenModelProvider = true;
        continue;
      }
      if (/^\s*model\s*=/.test(line)) {
        resultLines.push('model = "gpt-5.5"');
        seenModel = true;
        continue;
      }
    }

    resultLines.push(line);
  }

  const prepends: string[] = [];
  if (!seenModelProvider) {
    prepends.push('model_provider = "prismd"');
  }
  if (!seenModel) {
    prepends.push('model = "gpt-5.5"');
  }

  let finalOutput = resultLines;
  if (prepends.length > 0) {
    finalOutput = [...prepends, "", ...resultLines];
  }

  if (!hasPrismdSection) {
    finalOutput.push("");
    finalOutput.push("[model_providers.prismd]");
    finalOutput.push('name = "prismd"');
    finalOutput.push('base_url = "http://127.0.0.1:8787/v1"');
    finalOutput.push('wire_api = "responses"');
    finalOutput.push("requires_openai_auth = true");
  }

  return finalOutput.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Configure Claude Code native settings at ~/.claude/settings.json
 * plus lightweight fallback wrappers in ~/.prismd/.
 */
export function setupClaudeCode(homeDir: string, token: string): SetupResult {
  const claudeDir = join(homeDir, ".claude");
  mkdirSync(claudeDir, { recursive: true, mode: 0o700 });

  const written: string[] = [];
  const backups: string[] = [];

  // 1. Primary: Native ~/.claude/settings.json
  const settingsPath = join(claudeDir, "settings.json");
  const bSettings = backupFileIfExists(settingsPath);
  if (bSettings) backups.push(bSettings);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existingSettings: Record<string, any> = {};
  if (bSettings) {
    try {
      existingSettings = JSON.parse(readFileSync(bSettings, "utf8"));
    } catch {
      existingSettings = {};
    }
  }

  if (!existingSettings.env || typeof existingSettings.env !== "object") {
    existingSettings.env = {};
  }

  // Strip stale third-party proxy model overrides that cause Claude Code client-side validation failures
  const staleEnvKeys = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
    "CLAUDE_CODE_SUBAGENT_MODEL",
  ];
  for (const k of staleEnvKeys) {
    delete existingSettings.env[k];
  }
  delete existingSettings.modelOverrides;

  // Anthropic SDK / Claude Code appends `/v1/messages` to ANTHROPIC_BASE_URL.
  existingSettings.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8787";
  existingSettings.env.ANTHROPIC_API_KEY = token;

  writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2) + "\n", {
    mode: 0o600,
  });
  written.push(settingsPath);

  // 2. Auxiliary launcher scripts in ~/.prismd/
  const prismdDir = join(homeDir, ".prismd");
  mkdirSync(prismdDir, { recursive: true, mode: 0o700 });

  const shPath = join(prismdDir, "claude-prismd.sh");
  const bSh = backupFileIfExists(shPath);
  if (bSh) backups.push(bSh);
  const shContent = [
    "#!/usr/bin/env bash",
    "unset ANTHROPIC_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL CLAUDE_CODE_SUBAGENT_MODEL",
    'export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"',
    `export ANTHROPIC_API_KEY="${token}"`,
    'exec claude "$@"',
    "",
  ].join("\n");
  writeFileSync(shPath, shContent, { mode: 0o755 });
  written.push(shPath);

  const cmdPath = join(prismdDir, "claude-prismd.cmd");
  const bCmd = backupFileIfExists(cmdPath);
  if (bCmd) backups.push(bCmd);
  const cmdContent = [
    "@echo off",
    "set ANTHROPIC_MODEL=",
    "set ANTHROPIC_DEFAULT_SONNET_MODEL=",
    "set ANTHROPIC_DEFAULT_HAIKU_MODEL=",
    "set ANTHROPIC_DEFAULT_OPUS_MODEL=",
    "set CLAUDE_CODE_SUBAGENT_MODEL=",
    "set ANTHROPIC_BASE_URL=http://127.0.0.1:8787",
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
    "$env:ANTHROPIC_MODEL = $null",
    "$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $null",
    "$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $null",
    "$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $null",
    "$env:CLAUDE_CODE_SUBAGENT_MODEL = $null",
    '$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787"',
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
    launchCommand: "claude",
    notes: "Configured ~/.claude/settings.json. Launch by running 'claude' directly.",
  };
}

/**
 * Ensure free-auto metadata exists in ~/.codex/models.json so Codex CLI does not warn.
 */
export function ensureCodexModelMetadata(codexDir: string): { path: string; backupPath: string | null } {
  const modelsPath = join(codexDir, "models.json");
  let backupPath: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let catalog: { models?: any[] } = {};
  if (existsSync(modelsPath)) {
    try {
      catalog = JSON.parse(readFileSync(modelsPath, "utf8"));
    } catch {
      catalog = {};
    }
  }

  if (!Array.isArray(catalog.models)) {
    catalog.models = [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = catalog.models.find((m: any) => m && m.slug === "free-auto");
  if (!existing) {
    backupPath = backupFileIfExists(modelsPath);
    const template =
      catalog.models.length > 0 && typeof catalog.models[0] === "object"
        ? structuredClone(catalog.models[0])
        : {
            shell_type: "shell_command",
            visibility: "list",
            supported_in_api: true,
            support_verbosity: true,
            truncation_policy: { mode: "tokens", limit: 10000 },
            experimental_supported_tools: [],
            supported_reasoning_levels: [
              { effort: "low", description: "Fast responses with lighter reasoning" },
              { effort: "high", description: "Deep reasoning" },
            ],
            supports_parallel_tool_calls: true,
            input_modalities: ["text"],
            supports_image_detail_original: false,
          };

    template.slug = "free-auto";
    template.display_name = "free-auto";
    template.description = "prismd aggregated free models";
    template.context_window = 131072;
    template.max_context_window = 131072;
    template.priority = 1;

    catalog.models.unshift(template);
    writeFileSync(modelsPath, JSON.stringify(catalog, null, 2) + "\n", { mode: 0o600 });
  }

  return { path: modelsPath, backupPath };
}

/**
 * Configure Codex CLI native profile at ~/.codex/config.toml & ~/.codex/auth.json
 */
export function setupCodex(homeDir: string, token: string): SetupResult {
  const codexDir = join(homeDir, ".codex");
  mkdirSync(codexDir, { recursive: true, mode: 0o700 });

  const written: string[] = [];
  const backups: string[] = [];

  // 1. ~/.codex/auth.json
  const authPath = join(codexDir, "auth.json");
  const bAuth = backupFileIfExists(authPath);
  if (bAuth) backups.push(bAuth);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existingAuth: Record<string, any> = {};
  if (bAuth) {
    try {
      existingAuth = JSON.parse(readFileSync(bAuth, "utf8"));
    } catch {
      existingAuth = {};
    }
  }
  existingAuth.OPENAI_API_KEY = token;
  writeFileSync(authPath, JSON.stringify(existingAuth, null, 2) + "\n", { mode: 0o600 });
  written.push(authPath);

  // 2. ~/.codex/config.toml
  const tomlPath = join(codexDir, "config.toml");
  const bToml = backupFileIfExists(tomlPath);
  if (bToml) backups.push(bToml);

  let tomlContent = "";
  if (bToml) {
    try {
      tomlContent = readFileSync(bToml, "utf8");
    } catch {
      tomlContent = "";
    }
  }

  const updatedToml = updateCodexToml(tomlContent);
  writeFileSync(tomlPath, updatedToml, { mode: 0o600 });
  written.push(tomlPath);

  // 3. ~/.codex/models.json (metadata for free-auto)
  const { path: modelsPath, backupPath: bModels } = ensureCodexModelMetadata(codexDir);
  if (bModels) backups.push(bModels);
  written.push(modelsPath);

  return {
    name: "Codex CLI",
    filesWritten: written,
    backupsCreated: backups,
    launchCommand: "codex",
    notes: "Configured ~/.codex/config.toml, auth.json & models.json. Launch by running 'codex' directly.",
  };
}

/**
 * Configure OpenCode at ~/.config/opencode/opencode.json
 */
export function setupOpenCode(homeDir: string, token: string): SetupResult {
  const configDir = join(homeDir, ".config", "opencode");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });

  const jsonPath = join(configDir, "opencode.json");
  const backups: string[] = [];
  const b = backupFileIfExists(jsonPath);
  if (b) backups.push(b);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existingConfig: Record<string, any> = {};
  if (b) {
    try {
      existingConfig = JSON.parse(readFileSync(b, "utf8"));
    } catch {
      existingConfig = {};
    }
  }

  existingConfig.$schema = existingConfig.$schema ?? "https://opencode.ai/config.json";
  existingConfig.model = "prismd/free-auto";

  if (!existingConfig.provider || typeof existingConfig.provider !== "object") {
    existingConfig.provider = {};
  }

  existingConfig.provider.prismd = {
    npm: "@ai-sdk/openai",
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: token,
    models: {
      "free-auto": {
        name: "free-auto",
      },
    },
  };

  writeFileSync(jsonPath, JSON.stringify(existingConfig, null, 2) + "\n", {
    mode: 0o600,
  });

  return {
    name: "OpenCode",
    filesWritten: [jsonPath],
    backupsCreated: backups,
    launchCommand: "opencode",
    notes: "Configured ~/.config/opencode/opencode.json. Launch by running 'opencode' directly.",
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    launchCommand: "pi",
    notes: "Configured ~/.pi/config.json. Launch by running 'pi' directly.",
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
