import { Hono } from "hono";
import { renderUiHtml } from "../ui/page.js";

export const uiRoute = new Hono();

uiRoute.get("/ui", (c) => {
  return c.html(renderUiHtml(), 200);
});
