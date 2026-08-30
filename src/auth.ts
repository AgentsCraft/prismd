import type { MiddlewareHandler } from "hono";

/**
 * Local token check: Authorization: Bearer must match PRISMD_API_KEY.
 * Rejects before any upstream call, so 401 never touches a provider.
 */
export const auth = (): MiddlewareHandler => async (c, next) => {
  const expected = process.env.PRISMD_API_KEY;
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
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
