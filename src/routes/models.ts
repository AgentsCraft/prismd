import { Hono } from "hono";
import { getConfig } from "../config.js";

export const modelsRoute = new Hono();

modelsRoute.get("/v1/models", (c) => {
  const config = getConfig();
  const data = Object.keys(config.models).map((alias) => ({
    id: alias,
    object: "model",
    created: 1700000000,
    owned_by: "prismd",
  }));
  return c.json({
    object: "list",
    data,
  });
});
