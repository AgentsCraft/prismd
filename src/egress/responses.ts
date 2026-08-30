import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";
import { createRequest as openrouterCreateRequest } from "../providers/openrouter.js";
import { createRequest as groqCreateRequest } from "../providers/groq.js";

type RequestBuilder = (
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
) => UpstreamRequest;

/** Every provider with type=responses needs a builder; keyed by provider name. */
const builders: Record<string, RequestBuilder> = {
  openrouter: openrouterCreateRequest,
  groq: groqCreateRequest,
};

/**
 * Call the upstream and return its Response; the body stream is relayed
 * to the client without buffering (SSE chunks pass through as they arrive).
 *
 * The request body keeps the client's shape but the alias in "model" is
 * replaced with the concrete upstream providerModelId.
 */
export async function callUpstream(
  providerName: string,
  provider: ProviderConfig,
  providerModelId: string,
  body: ResponsesRequestBody,
  apiKey: string,
): Promise<Response> {
  const builder = builders[providerName];
  if (!builder) {
    throw new Error(`no responses egress for provider "${providerName}"`);
  }
  const request = builder(provider, { ...body, model: providerModelId }, apiKey);
  return fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
}
