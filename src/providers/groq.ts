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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...provider.extraHeaders,
  };
  if (provider.auth?.type !== "none" && apiKey && apiKey !== "none") {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return {
    url: `${provider.baseUrl}/responses`,
    headers,
    body: JSON.stringify(body),
  };
}
