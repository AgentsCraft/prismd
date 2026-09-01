/**
 * Structured logging baseline: pino JSON to stderr. Secret values are
 * masked at the boundary by pino's redact option (key names listed below
 * are censored no matter where they appear in a logged object) — no bare
 * console.log of request objects anywhere else.
 */
import { destination, pino } from "pino";

/** Redact paths for the shared logger; exported for tests. */
export const REDACT_PATHS = [
  "authorization",
  "*.authorization",
  "Authorization",
  "*.Authorization",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "api-key",
  "*.api-key",
  "token",
  "*.token",
  "apiKeyValue",
  "*.apiKeyValue",
  "authorizationHeader",
  "*.authorizationHeader",
  "x-api-key",
  "*.x-api-key",
  "X-Api-Key",
  "*.X-Api-Key",
];

export const logger = pino(
  {
    level: process.env.PRISMD_LOG_LEVEL ?? "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "****",
    },
  },
  destination({ dest: 2, sync: true }),
);
