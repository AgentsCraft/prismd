export interface ProviderConfig {
  /** Unique provider id, also the key into src/providers/<name>.ts */
  name: string;
  /** Upstream protocol; only "responses" is implemented so far */
  type: "responses";
  baseUrl: string;
  /** Env var holding the upstream API key */
  apiKeyEnv: string;
  /** Model ids this provider accepts; the request "model" is looked up here */
  models: string[];
}

export interface PrismdConfig {
  providers: ProviderConfig[];
}
