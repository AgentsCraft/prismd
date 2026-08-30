import { Hono } from "hono";
import { auth } from "./auth.js";
import { responses } from "./ingress/responses.js";

export const app = new Hono();

app.use("/v1/responses", auth());
app.post("/v1/responses", responses);
