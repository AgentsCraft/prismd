/** Runtime config types, mirroring config.schema.json (validated by ajv at load). */

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  /** Key field for the local gateway token in ~/.prismd/keys.yaml (env: <FIELD>_API_KEY). */
  localTokenField: string;
}

/** Reserved for M3+ oauth; phase 1 only api_key is used. */
export type ProviderAuthType = "api_key" | "oauth" | "none";

export interface ProviderConfig {
  type: "responses" | "chat";
  baseUrl: string;
  /** Key field in ~/.prismd/keys.yaml; env var lookup uses <FIELD>_API_KEY uppercased. */
  apiKeyField: string;
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
  /** Consecutive failures before a candidate is marked unhealthy (default 3). */
  failThreshold?: number;
  /** Cooldown duration in ms after unhealthy (default 60000). */
  cooldownMs?: number;
}

export interface PrismdConfig {
  version: number;
  server: ServerConfig;
  auth: AuthConfig;
  providers: Record<string, ProviderConfig>;
  models: Record<string, AliasModel>;
  policies: PoliciesConfig;
}
