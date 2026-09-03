export function printHelpCli(): void {
  console.log(`prismd - Local-first LLM gateway aggregating free and low-cost model APIs

Usage:
  prismd                 Start the gateway server
  prismd status          Display candidate health and quota metrics
  prismd sync            Check and validate models against upstream catalogs
  prismd generate        Generate ~/.prismd/prismd.json from keys and presets
  prismd --help, -h      Show this help message
`);
}
