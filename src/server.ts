#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { getConfig } from "./config.js";

// Loads and validates prismd.json up front: schema violations and
// non-loopback server.host fail fast here, before any socket opens.
const config = getConfig();

serve({ fetch: app.fetch, port: config.server.port, hostname: config.server.host }, (info) => {
  console.log(`prismd listening on http://${info.address}:${info.port}`);
});
