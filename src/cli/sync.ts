import { getConfig } from "../config.js";
import { validateUpstreamModels } from "../core/catalog-sync.js";
import { getHealth, getKeyPool } from "../core/runtime.js";

export async function runSyncCli(): Promise<number> {
  const config = getConfig();
  console.log("Checking upstream provider model catalogs...");
  const results = await validateUpstreamModels(config, getHealth(), getKeyPool());
  let missingCount = 0;
  for (const r of results) {
    if (r.status === "ok") {
      console.log(`✓ [${r.provider}] All ${r.configuredModels.length} configured model(s) available (${r.availableModels.length} total upstream)`);
    } else if (r.status === "model_missing") {
      missingCount += r.missingModels.length;
      console.log(`✗ [${r.provider}] Missing model(s): ${r.missingModels.join(", ")}`);
      console.log(`  Available models: ${r.availableModels.slice(0, 6).join(", ")}...`);
    } else if (r.status === "auth_error") {
      console.log(`✗ [${r.provider}] Authentication failed (check API key in ~/.prismd/keys.yaml)`);
    } else {
      console.log(`! [${r.provider}] Unreachable or skipped (${r.error ?? "network error"})`);
    }
  }
  if (missingCount > 0) {
    console.log(`\nFound ${missingCount} outdated model candidate(s). Run 'prismd generate' to refresh presets or update config.user.json.`);
    return 1;
  }
  console.log("\nAll candidate models are synchronized and verified.");
  return 0;
}
