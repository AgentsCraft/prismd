/** Runtime config types, mirroring config.schema.json (validated by ajv at load). */

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  localTokenEnv: string;
}

/** Reserved for M3+ oauth; phase 1 only api_key is used. */
export type ProviderAuthType = "api_key" | "oauth" | "none";

export interface ProviderConfig {
  type: "responses";
  baseUrl: string;
  /** Env var holding the upstream API key */
  apiKeyEnv: string;
  auth?: {
    type: ProviderAuthType;
    [key: string]: unknown;
  };
  /** Static upstream headers (e.g. OpenRouter HTTP-Referer / X-Title) */
  extraHeaders?: Record<string, string>;
}

/**
 * Soft limits used as routing weights (M2), never hard blocks.
 * dailyRequests is null when the daily quota is unknown.
 */
export interface LimitsConfig {
  dailyRequests: number | null;
  rpm: number;
  maxConcurrent: number;
}

export interface Candidate {
  provider: string;
  providerModelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  limits: LimitsConfig;
  tags: string[];
}

export interface AliasModel {
  description?: string;
  candidates: Candidate[];
}

export interface PoliciesConfig {
  failoverOn: string[];
  retryBeforeStream: boolean;
  retryAfterStream: boolean;
  maxCandidatesPerRequest: number;
  respectRetryAfter: boolean;
  quotaSoftLimitRatio: number;
  connectTimeoutMs: number;
  streamIdleTimeoutMs: number;
}

export interface PrismdConfig {
  version: number;
  server: ServerConfig;
  auth: AuthConfig;
  providers: Record<string, ProviderConfig>;
  models: Record<string, AliasModel>;
  policies: PoliciesConfig;
}
