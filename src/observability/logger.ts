/**
 * Structured logging baseline: pino JSON to stderr. All secret redaction
 * converges on sanitize()/redactSecrets() here — no bare console.log of
 * request objects anywhere else.
 */
import { destination, pino } from "pino";

export const logger = pino(
  {
    level: process.env.PRISMD_LOG_LEVEL ?? "info",
  },
  destination({ dest: 2, sync: true }),
);

const REDACTED = "****";

/** Header names and object keys whose values are always masked. */
const SENSITIVE_KEYS = new Set(["authorization", "x-api-key", "api-key", "api_key", "token"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Mask values under sensitive keys (Authorization, x-api-key, ...). */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] =
        SENSITIVE_KEYS.has(key.toLowerCase()) && v !== null && v !== undefined && v !== ""
          ? REDACTED
          : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** Replace literal secret values in a message string with "****". */
export function redactString(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * One-stop sanitizer for log payloads: masks sensitive keys and literal
 * occurrences of the given secret values inside every string.
 */
export function sanitize(value: unknown, secrets: Iterable<string> = []): unknown {
  const list = [...secrets].filter((s) => s.length >= 4);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactString(v, list);
    if (Array.isArray(v)) return v.map(walk);
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v)) {
        out[key] =
          SENSITIVE_KEYS.has(key.toLowerCase()) && val !== null && val !== undefined && val !== ""
            ? REDACTED
            : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
