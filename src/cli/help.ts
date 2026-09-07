export function printHelpCli(): void {
  console.log(`prismd - Local-first LLM gateway aggregating free and low-cost model APIs

Usage:
  prismd                 Start the gateway server
  prismd init            Interactive setup wizard (create keys.yaml + generate config)
  prismd status          Display candidate health and quota metrics
  prismd generate        Silently regenerate ~/.prismd/prismd.json from keys (CI-friendly)
  prismd sync            Check and validate models against upstream catalogs
  prismd --help, -h      Show this help message
`);
}

