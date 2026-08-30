/** OpenAI Responses request body as received from the client (passthrough-first). */
export interface ResponsesRequestBody {
  model: string;
  input: unknown;
  stream?: boolean;
  [key: string]: unknown;
}

/** Upstream HTTP request produced by a provider module. */
export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** OpenAI-style error body; Codex parses this shape. */
export interface GatewayError {
  error: {
    message: string;
    type: string;
    code: string;
    metadata?: Record<string, unknown>;
  };
}
