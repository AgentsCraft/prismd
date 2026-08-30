import type { Context } from "hono";
import { getConfig } from "../config.js";
import { gatewayError } from "../core/errors.js";
import { resolveAlias } from "../core/router.js";
import { callUpstream } from "../egress/responses.js";
import type { ResponsesRequestBody } from "../types/protocol.js";

/**
 * POST /v1/responses ingress. Resolves the requested model alias to its
 * first candidate and relays the request/response verbatim (streaming or
 * non-streaming). M1 picks the first candidate only; failover, quota and
 * timeouts are M2.
 */
export async function responses(c: Context): Promise<Response> {
  let body: ResponsesRequestBody;
  try {
    body = await c.req.json<ResponsesRequestBody>();
  } catch {
    return c.json(
      gatewayError(400, "invalid_request_error", "request body must be valid JSON"),
      400,
    );
  }
  if (typeof body.model !== "string" || body.model === "") {
    return c.json(gatewayError(400, "invalid_request_error", 'missing "model" field'), 400);
  }

  const config = getConfig();
  const candidates = resolveAlias(config.models, body.model);
  if (!candidates) {
    return c.json(gatewayError(404, "model_not_found", `model alias "${body.model}" is not defined`), 404);
  }

  // M1: no failover yet — the first candidate is the only attempt.
  const candidate = candidates[0];
  const provider = config.providers[candidate.provider];
  if (!provider) {
    return c.json(
      gatewayError(
        500,
        "gateway_internal_error",
        `candidate "${candidate.providerModelId}" references unknown provider "${candidate.provider}"`,
      ),
      500,
    );
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    return c.json(
      gatewayError(
        500,
        "gateway_internal_error",
        `missing API key for provider "${candidate.provider}" (set ${provider.apiKeyEnv})`,
      ),
      500,
    );
  }

  let upstream: Response;
  try {
    upstream = await callUpstream(candidate.provider, provider, candidate.providerModelId, body, apiKey);
  } catch (err) {
    console.error("[prismd] upstream request failed:", err);
    return c.json(
      gatewayError(502, "gateway_all_candidates_failed", `failed to reach provider "${candidate.provider}"`),
      502,
    );
  }

  // Relay upstream response as-is: the body stream passes through without
  // buffering, so SSE events arrive in order and none are dropped.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
