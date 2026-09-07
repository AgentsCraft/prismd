import type { DatabaseSync as DatabaseSyncType, StatementSync as StatementSyncType } from "node:sqlite";

// Suppress experimental warning for node:sqlite on Node 22/23/24
// to avoid alarming users with experimental status messages on stderr.
const originalEmitWarning = process.emitWarning.bind(process);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.emitWarning = function (warning: any, ...args: any[]) {
  if (typeof warning === "string" && warning.includes("SQLite")) return;
  if (warning && typeof warning === "object" && warning.message && warning.message.includes("SQLite")) return;
  return originalEmitWarning(warning, ...args);
};

const { DatabaseSync } = (await import("node:sqlite")) as {
  DatabaseSync: typeof DatabaseSyncType;
};

export { DatabaseSync };
export type DatabaseSync = DatabaseSyncType;
export type StatementSync = StatementSyncType;
