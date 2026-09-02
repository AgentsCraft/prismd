/**
 * Responses egress: builds the upstream request per provider and delegates
 * execution, timeout handling, stream-idle timeout, and usage extraction
 * to the unified Raw HTTP Egress layer (raw.ts).
 */
import type { ProviderConfig } from "../types/config.js";
import type { ResponsesRequestBody, UpstreamRequest } from "../types/protocol.js";
import { createRequest as openrouterCreateRequest } from "../providers/openrouter.js";
import { createRequest as groqCreateRequest } from "../providers/groq.js";
import {
  callRawHttpUpstream,
  type UpstreamCallOptions,
  type UpstreamResult,
} from "./raw.js";

export {
  UpstreamConnectError,
  parseRetryAfter,
  SseEventSplitter,
  dataPayloads,
  sseErrorEvent,
  tryExtractUsage,
  type StreamAccounting,
  type UpstreamCallOptions,
  type UpstreamResult,
} from "./raw.js";

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

function defaultResponsesCreateRequest(
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

/**
 * Call the upstream and return a relay-ready result. The request body keeps
 * the client's shape but the alias in "model" is replaced with the concrete
 * upstream providerModelId.
 */
export async function callUpstream(
  providerName: string,
  provider: ProviderConfig,
  providerModelId: string,
  body: ResponsesRequestBody,
  apiKey: string,
  options: UpstreamCallOptions,
): Promise<UpstreamResult> {
  const builder = builders[providerName] ?? defaultResponsesCreateRequest;
  const request = builder(provider, { ...body, model: providerModelId }, apiKey);
  return callRawHttpUpstream(
    providerName,
    request.url,
    request.headers,
    request.body,
    body.stream === true,
    options,
  );
}
