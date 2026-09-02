/**
 * Black-box e2e harness: spawns the real gateway process (tsx src/server.ts)
 * in a hermetic temp environment and drives it only over HTTP. Reused by all
 * e2e journeys; never imports src internals.
 *
 * Environment preparation (same for every journey):
 *   - Node >= 23.4 (node:sqlite built-in), deps installed (`npm install`).
 *   - Temp dir per gateway: prismd.json (schema-valid, providers pointed at
 *     local mock upstream ports), PRISMD_DATA_PATH -> temp sqlite, HOME ->
 *     temp (so the real ~/.prismd keys.yaml is never read), fake keys via
 *     env (OPENROUTER_API_KEY / GROQ_API_KEY / PRISMD_API_KEY).
 *   - Gateway started via `tsx src/server.ts` on an ephemeral 127.0.0.1 port.
 *   - Upstream = local scriptable mock (test/mock-upstream.ts), no real
 *     provider quota is consumed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Local gateway token used across all journeys (matches PRISMD_API_KEY). */
export const GATEWAY_TOKEN = "e2e-local-token";

export interface GatewayHandle {
  port: number;
  url: string;
  dataPath: string;
  configPath: string;
  dir: string;
  stderrLines: string[];
  signal: (sig: NodeJS.Signals) => void;
  /**
   * SIGTERM (graceful shutdown + quota flush), then SIGKILL on timeout.
   * Returns the process exit code. Removes the temp dir unless keepDir.
   */
  stop: () => Promise<number | null>;
}

export interface StartGatewayOptions {
  /** Reuse an existing SQLite file (restart journeys). */
  dataPath?: string;
  /** Keep the temp dir after stop() so dataPath survives; caller cleans up. */
  keepDir?: boolean;
  /** Extra environment variables passed to the child process. */
  env?: Record<string, string>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** An ephemeral free TCP port on loopback. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Spawn the real gateway process and wait until it accepts connections.
 * Fails with the captured stderr when the process exits early (config
 * error) or never listens (crash), so a failure is attributable to the
 * gateway side without guessing.
 */
export async function startGateway(
  config: Record<string, unknown>,
  options: StartGatewayOptions = {},
): Promise<GatewayHandle> {
  const dir = mkdtempSync(join(tmpdir(), "prismd-e2e-"));
  mkdirSync(join(dir, "home"), { recursive: true });
  const port = await freePort();
  const finalConfig = {
    ...config,
    server: { ...(config.server as Record<string, unknown>), host: "127.0.0.1", port },
  };
  const configPath = join(dir, "prismd.json");
  writeFileSync(configPath, JSON.stringify(finalConfig));
  const dataPath = options.dataPath ?? join(dir, "data", "prismd.sqlite");

  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", join(REPO_ROOT, "src", "server.ts")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: join(dir, "home"),
        PRISMD_CONFIG_PATH: configPath,
        PRISMD_DATA_PATH: dataPath,
        PRISMD_API_KEY: GATEWAY_TOKEN,
        OPENROUTER_API_KEY: "e2e-upstream-key",
        GROQ_API_KEY: "e2e-upstream-key",
        CEREBRAS_API_KEY: "e2e-upstream-key",
        PRISMD_LOG_LEVEL: "warn",
        PRISMD_DISABLE_CATALOG_SYNC: "1",
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderrLines: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrLines.push(chunk.toString());
    if (stderrLines.length > 200) stderrLines.shift();
  });
  child.stdout?.on("data", () => {});

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `gateway exited early with code ${child.exitCode}:\n${stderrLines.join("")}`,
      );
    }
    try {
      // Any response (404/401/...) means the server is listening.
      const res = await fetch(`${url}/v1/responses`, { method: "GET", signal: AbortSignal.timeout(500) });
      await res.body?.cancel();
      break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`gateway did not start listening in time:\n${stderrLines.join("")}`);
    }
    await sleep(50);
  }

  return {
    port,
    url,
    dataPath,
    configPath,
    dir,
    stderrLines,
    signal: (sig: NodeJS.Signals) => {
      child.kill(sig);
    },
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => child.once("exit", () => resolve())),
          sleep(10_000).then(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
          }),
        ]);
      }
      if (!options.keepDir) rmSync(dir, { recursive: true, force: true });
      return child.exitCode;
    },
  };
}

/** POST /v1/responses with a Bearer token (defaults to the harness token). */
export function postResponses(
  gatewayUrl: string,
  body: Record<string, unknown>,
  token: string = GATEWAY_TOKEN,
): Promise<Response> {
  return fetch(`${gatewayUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Tail of the gateway stderr, for error messages (locates failures). */
export function logTail(handle: GatewayHandle, lines = 15): string {
  const tail = handle.stderrLines.slice(-lines).join("");
  return tail === ""
    ? "(gateway stderr empty)"
    : `--- gateway stderr (last ${lines} lines) ---\n${tail}--- end gateway stderr ---`;
}

/** Split a raw SSE body into ordered events with their data payloads. */
export function parseSse(body: string): { data: string[] }[] {
  return body
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => ({
      data: block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => (line[5] === " " ? line.slice(6) : line.slice(5))),
    }));
}
