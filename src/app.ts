import { Hono } from "hono";
import { auth } from "./auth.js";
import { getConfig } from "./config.js";
import { responses } from "./ingress/responses.js";
import { newRequestId } from "./observability/request-id.js";
import { healthzRoute } from "./routes/healthz.js";
import { modelsRoute } from "./routes/models.js";
import { modelstatusRoute } from "./routes/modelstatus.js";
import { uiRoute } from "./routes/ui.js";

type Variables = {
  requestId: string;
};

export const app = new Hono<{ Variables: Variables }>();

// Unauthenticated status and discovery routes
app.route("", healthzRoute);
app.route("", modelsRoute);
app.route("", modelstatusRoute);
app.route("", uiRoute);

// Config is resolved lazily at request time so importing the app never
// reads prismd.json (server.ts validates it explicitly at startup).
app.use("/v1/responses", async (c, next) => {
  const requestId = newRequestId();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
  // c.header() only merges into c.json-style responses; relayed custom
  // Response objects (SSE streams) need the header set explicitly so every
  // response — including streamed ones — carries the request id.
  c.res?.headers.set("x-request-id", requestId);
});
app.use("/v1/responses", async (c, next) => {
  return auth(getConfig().auth.localTokenField)(c, next);
});
app.post("/v1/responses", responses);
