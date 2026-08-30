import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = 8787;
const hostname = "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`prismd listening on http://${info.address}:${info.port}`);
});
