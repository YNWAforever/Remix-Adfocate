import { Hono } from "hono";
import type { Env } from "../app";
import { serviceClient, makeUserClient } from "../lib/supabase";

/** Unguarded: runs before a creator row exists. Resolves workspace from body slug. */
export const meBootstrap = new Hono<Env>();
meBootstrap.post("/bootstrap", async (c) => {
  const auth = c.req.header("Authorization");
  const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "Missing bearer token", code: "no_auth" }, 401);

  const { slug } = await c.req.json<{ slug: string }>();
  if (!slug) return c.json({ error: "Missing slug", code: "no_workspace" }, 400);

  const user = makeUserClient(jwt);
  const { data: u } = await user.auth.getUser();
  if (!u.user) return c.json({ error: "Invalid token", code: "bad_token" }, 401);

  const svc = serviceClient();
  const { data: ws } = await svc.from("workspaces").select("id").eq("slug", slug).single();
  if (!ws) return c.json({ error: "Unknown workspace", code: "no_workspace" }, 404);

  await svc.from("creators").upsert(
    { id: u.user.id, workspace_id: ws.id, display_name: u.user.email },
    { onConflict: "id", ignoreDuplicates: true },
  );
  await svc.from("point_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, balance: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );

  return c.json({ ok: true });
});

/** Guarded: current creator profile. */
export const meRoutes = new Hono<Env>();
meRoutes.get("/me", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select("id, display_name, avatar_url, level, xp, categories, scores")
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
