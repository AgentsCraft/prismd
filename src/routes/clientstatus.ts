import { Hono } from "hono";
import { clientUsageSink, type ClientStatusSnapshot } from "../observability/client-sink.js";

export type {
  ClientEndpointStat,
  ClientFailureStat,
  ClientRecentRequest,
  ClientStatusSnapshot,
} from "../observability/client-sink.js";

export function buildClientStatus(now: number = Date.now()): ClientStatusSnapshot {
  return clientUsageSink.snapshot(now);
}

export const clientstatusRoute = new Hono();

clientstatusRoute.get("/v1/clientstatus", (c) => {
  return c.json(buildClientStatus(), 200);
});
