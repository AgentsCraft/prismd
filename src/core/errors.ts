import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { GatewayError } from "../types/protocol.js";

/**
 * Build an OpenAI-style error body (Codex parses this shape). `type`
 * follows the status: 5xx is server_error, everything else is
 * invalid_request_error. `metadata` carries structured details for
 * troubleshooting; never put secrets in it.
 */
export function gatewayError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): GatewayError {
  return {
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code,
      ...(metadata ? { metadata } : {}),
    },
  };
}
