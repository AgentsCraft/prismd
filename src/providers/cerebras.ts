import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";
import { convertResponsesToChatRequest } from "../egress/chat-converter.js";

/**
 * Cerebras Chat Completions request builder.
 * baseUrl: https://api.cerebras.ai/v1
 * Endpoint: /chat/completions
 */
export function createRequest(
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
): UpstreamRequest {
  const chatBody = convertResponsesToChatRequest(body, body.model);
  return {
    url: `${provider.baseUrl}/chat/completions`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...provider.extraHeaders,
    },
    body: JSON.stringify(chatBody),
  };
}
