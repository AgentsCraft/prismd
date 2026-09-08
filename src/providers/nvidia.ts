// NVIDIA NIM Chat Completions request builder.
// baseUrl: https://integrate.api.nvidia.com/v1
// Endpoint: /chat/completions (OpenAI-compatible)

import { convertResponsesToChatRequest } from "../egress/chat-converter.js";
import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";

/**
 * NVIDIA NIM uses OpenAI-compatible chat/completions endpoint
 * Convert ResponsesRequestBody to OpenAI-style chat body for NIM compatibility
 */
export function createRequest(
  provider: ProviderConfig,
  body: ResponsesRequestBody,
  apiKey: string,
): UpstreamRequest {
  const chatBody = convertResponsesToChatRequest(body, body.model);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: body.stream ? "text/event-stream" : "application/json",
    ...provider.extraHeaders,
  };
  if (provider.auth?.type !== "none" && apiKey && apiKey !== "none") {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body: JSON.stringify(chatBody),
  };
}
