import { Hono } from "hono";
import { auth } from "./auth.js";
import { getConfig } from "./config.js";
import { chatCompletions } from "./ingress/chat.js";
import { messages } from "./ingress/messages.js";
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
const v1Paths = ["/v1/responses", "/v1/chat/completions", "/v1/messages"] as const;

for (const path of v1Paths) {
  app.use(path, async (c, next) => {
    const requestId = newRequestId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
    c.res?.headers.set("x-request-id", requestId);
  });
  app.use(path, async (c, next) => {
    return auth(getConfig().auth.localTokenField)(c, next);
  });
}

// Ingress endpoints
app.post("/v1/responses", responses);
app.post("/v1/chat/completions", chatCompletions);
app.post("/v1/messages", messages);
