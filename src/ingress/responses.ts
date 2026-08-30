import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { findProvider, getConfig } from "../config.js";
import { callUpstream } from "../egress/responses.js";
import type { GatewayError, ResponsesRequestBody } from "../types/protocol.js";

/**
 * POST /v1/responses ingress. Finds the provider that declares the
 * requested model and relays the request/response verbatim (streaming
 * or non-streaming). No vendor is hardcoded: presets drive routing.
 */
export async function responses(c: Context): Promise<Response> {
  let body: ResponsesRequestBody;
  try {
    body = await c.req.json<ResponsesRequestBody>();
  } catch {
    return gatewayError(c, 400, "invalid_request_error", "request body must be valid JSON");
  }
  if (typeof body.model !== "string" || body.model === "") {
    return gatewayError(c, 400, "invalid_request_error", 'missing "model" field');
  }

  const provider = findProvider(getConfig(), body.model);
  if (!provider) {
    return gatewayError(
      c,
      404,
      "model_not_found",
      `model "${body.model}" is not declared in any provider preset`,
    );
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    return gatewayError(
      c,
      500,
      "gateway_internal_error",
      `missing API key for provider "${provider.name}" (set ${provider.apiKeyEnv})`,
    );
  }

  let upstream: Response;
  try {
    upstream = await callUpstream(provider, body, apiKey);
  } catch (err) {
    console.error("[prismd] upstream request failed:", err);
    return gatewayError(c, 502, "gateway_upstream_error", `failed to reach provider "${provider.name}"`);
  }

  // Relay upstream response as-is: the body stream passes through without
  // buffering, so SSE events arrive in order and none are dropped.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

function gatewayError(c: Context, status: ContentfulStatusCode, code: string, message: string): Response {
  const body: GatewayError = {
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code,
    },
  };
  return c.json(body, status);
}
