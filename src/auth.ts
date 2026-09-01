import type { MiddlewareHandler } from "hono";
import { resolveLocalToken } from "./config.js";

/**
 * Local token check: Authorization: Bearer must match the token resolved
 * from auth.localTokenField (env var > ~/.prismd/.env > ~/.prismd/keys.yaml).
 * Rejects before any upstream call, so 401 never touches a provider.
 */
export const auth =
  (localTokenField: string): MiddlewareHandler =>
  async (c, next) => {
    const expected = resolveLocalToken(localTokenField);
    const header = c.req.header("authorization") ?? "";
    const xApiKey = c.req.header("x-api-key") ?? "";
    let token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!token && xApiKey) {
      token = xApiKey;
    }
    if (!expected || token !== expected) {
      return c.json(
        {
          error: {
            message: "invalid or missing API key",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        401,
      );
    }
    await next();
  };
