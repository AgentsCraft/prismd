import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";

/**
 * Groq Responses request. Placeholder entry until a Groq key and models
 * are available; same shape as OpenRouter, differences converge here.
 */
export function createRequest(
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
): UpstreamRequest {
  return {
    url: `${provider.baseUrl}/responses`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...provider.extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
