import type { MiddlewareHandler } from "hono";
import { resolveLocalToken } from "./config.js";

/**
 * Local token check: Supports both "Authorization: Bearer <token>" and
 * Anthropic / Claude Code default "x-api-key: <token>".
 * Matches against the token resolved from auth.localTokenField
 * (env var > ~/.prismd/.env > ~/.prismd/keys.yaml).
 * Rejects before any upstream call, so 401 never touches a provider.
 */
export const auth =
  (localTokenField: string): MiddlewareHandler =>
  async (c, next) => {
    const expected = resolveLocalToken(localTokenField);
    const authHeader = c.req.header("authorization")?.trim() ?? "";
    const xApiKey = c.req.header("x-api-key")?.trim() ?? "";

    let bearerToken = "";
    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      bearerToken = match ? match[1].trim() : authHeader;
    }

    const isValid = Boolean(
      expected &&
        ((bearerToken && bearerToken === expected) || (xApiKey && xApiKey === expected)),
    );

    if (!isValid) {
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
