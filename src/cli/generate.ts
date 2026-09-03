import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateConfigStringAsync } from "../generate-config.js";

export async function runGenerateCli(): Promise<number> {
  const home = process.env.PRISMD_HOME ?? homedir();
  const cwd = process.env.PRISMD_CWD ?? process.cwd();
  const targetDir = join(home, ".prismd");
  const targetPath = join(targetDir, "prismd.json");
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  console.log("Querying upstreams to discover active models...");
  const content = await generateConfigStringAsync({
    homeDir: home,
    cwd,
    liveCheck: true,
    warn: (msg) => console.log(`  ${msg}`),
  });
  writeFileSync(targetPath, content, { mode: 0o600 });
  console.log(`Generated verified configuration at ${targetPath}`);
  return 0;
}
