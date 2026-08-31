import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";

/**
 * OpenRouter Responses request. Differences from other providers
 * (base URL, extra headers) converge in this module.
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
      // Static upstream headers (HTTP-Referer / X-Title) only when configured.
      ...provider.extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
