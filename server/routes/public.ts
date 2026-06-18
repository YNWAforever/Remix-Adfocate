import { Hono } from "hono";
import type { Env } from "../app.js";
import { getPublicPassportByToken } from "../lib/publicPassport.js";

export const publicRoutes = new Hono<Env>();

publicRoutes.get("/passports/:token", async (c) => {
  const passport = await getPublicPassportByToken(c.req.param("token"));
  if (!passport) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(passport);
});
