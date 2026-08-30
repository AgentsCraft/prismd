/** Shared test fixtures: schema-valid prismd.json builders. No secrets, no network. */

const FIXTURE_POLICIES = {
  failoverOn: ["401", "403", "429", "500", "502", "503", "504"],
  retryBeforeStream: true,
  retryAfterStream: false,
  maxCandidatesPerRequest: 2,
  respectRetryAfter: true,
  quotaSoftLimitRatio: 0.8,
  connectTimeoutMs: 10000,
  streamIdleTimeoutMs: 300000,
};

export function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] !== null &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** A valid prismd.json object; `overrides` are deep-merged on top. */
export function makeValidConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    version: 1,
    server: { host: "127.0.0.1", port: 8787 },
    auth: { localTokenEnv: "PRISMD_API_KEY" },
    providers: {
      openrouter: {
        type: "responses",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        extraHeaders: { "HTTP-Referer": "https://localhost/prismd", "X-Title": "prismd" },
      },
      groq: {
        type: "responses",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnv: "GROQ_API_KEY",
      },
    },
    models: {
      "free-auto": {
        description: "auto",
        candidates: [
          {
            provider: "openrouter",
            providerModelId: "poolside/laguna-s-2.1:free",
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
            supportsReasoning: true,
            limits: { dailyRequests: 50, rpm: 20, maxConcurrent: 2 },
            tags: ["free"],
          },
          {
            provider: "groq",
            providerModelId: "llama-3.3-70b-versatile",
            contextWindow: 131072,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsReasoning: false,
            limits: { dailyRequests: null, rpm: 30, maxConcurrent: 4 },
            tags: ["free", "fast"],
          },
        ],
      },
    },
    policies: FIXTURE_POLICIES,
  };
  return deepMerge(base, overrides);
}
