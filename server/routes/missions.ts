import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import type { PostgrestError } from "@supabase/supabase-js";

export const missionRoutes = new Hono<Env>();

// RPC raise-messages double as stable codes. Map them to HTTP; anything else is a 500.
const RPC_409 = new Set([
  "mission_full", "already_joined", "not_open", "closed",
  "level_locked", "wrong_state", "empty_urls", "not_authenticated",
  "not_application", "already_applied", "verification_required",
]);
function rpcError(c: Context<Env>, error: PostgrestError) {
  const msg = error.message ?? "";
  if (msg === "not_found") return c.json({ error: msg, code: msg }, 404);
  if (RPC_409.has(msg)) return c.json({ error: msg, code: msg }, 409);
  return c.json({ error: msg || "rpc error", code: "db_error" }, 500);
}

missionRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("missions")
    .select("id, slug, title, description, category, mission_type, access_type, points_reward, deadline, quota, filled, status")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  // Annotate each mission with the caller's submission status (or null).
  const { data: subs } = await supabase
    .from("mission_submissions")
    .select("mission_id, status")
    .eq("creator_id", c.get("userId"));
  const byId = new Map((subs ?? []).map((s) => [s.mission_id, s.status]));
  const missions = (data ?? []).map((m) => ({ ...m, my_status: byId.get(m.id) ?? null }));
  return c.json({ missions });
});

/** Caller's own submissions (joined to their missions). Registered before /:slug. */
missionRoutes.get("/my", async (c) => {
  const status = c.req.query("status");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("mission_submissions")
    .select(
      "id, status, content_urls, points_awarded, submitted_at, reviewed_at, created_at, missions!inner(slug, title, category, points_reward, mission_type)",
    )
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ submissions: data ?? [] });
});

missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*, workspaces(name)")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  // Flatten the joined brand name to a top-level `brand`; drop the nested object.
  const { workspaces, ...rest } = data as Record<string, unknown> & { workspaces?: { name?: string } | null };
  return c.json({ ...rest, brand: workspaces?.name ?? null });
});

/** Join an open mission. */
missionRoutes.post("/:slug/join", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("join_mission", { p_mission: m.id });
  if (error) return rpcError(c, error);
  return c.json(data);
});

/** Submit content for a joined mission. */
missionRoutes.put("/:slug/submit", async (c) => {
  const body = await c.req.json<{ content_urls: string[]; submission_data?: Record<string, unknown> }>();
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("submit_mission", {
    p_mission: m.id,
    p_urls: body.content_urls ?? [],
    p_data: body.submission_data ?? {},
  });
  if (error) return rpcError(c, error);
  return c.json(data);
});

/** Apply to an application-gated mission (one-tap). Operator vets via /admin/applications. */
missionRoutes.post("/:slug/apply", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("apply_mission", { p_mission: m.id });
  if (error) return rpcError(c, error);
  return c.json(data);
});
