import { Hono } from "hono";
import { auth } from "./auth.js";
import { getConfig } from "./config.js";
import { responses } from "./ingress/responses.js";

export const app = new Hono();

// Config is resolved lazily at request time so importing the app never
// reads prismd.json (server.ts validates it explicitly at startup).
app.use("/v1/responses", async (c, next) => {
  return auth(getConfig().auth.localTokenEnv)(c, next);
});
app.post("/v1/responses", responses);
