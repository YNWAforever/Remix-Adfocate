import { Hono } from "hono";
import { MISSION_LIST_SELECT, serializeMission } from "../lib/missionDecision.js";
import { missionCategoryValues } from "../../src/lib/missionCategories.js";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { profileInputError } from "../lib/profileInput.js";

export const onboardingRoutes = new Hono<Env>();

/** GET /api/onboarding/status — step pointer + completion. */
onboardingRoutes.get("/status", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select("onboarding_step, onboarding_completed")
    .eq("id", c.get("userId"))
    .single();
  if (error) return dbError(c, error, "db_error", 500);
  const completion_pct = data.onboarding_completed
    ? 100
    : Math.round(((data.onboarding_step - 1) / 4) * 100);
  return c.json({ ...data, completion_pct });
});

/** PUT /api/onboarding/profile — save partial profile + advance the step pointer. */
onboardingRoutes.put("/profile", async (c) => {
  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string;
    categories?: string[];
    step?: number;
  }>();
  const invalid = profileInputError(body as Record<string, unknown>);
  if (invalid) return c.json({ error: "資料格式或長度不正確 / Invalid or too long profile field", code: "invalid_profile", field: invalid }, 400);
  const supabase = makeUserClient(c.get("jwt"));

  const { data: cur, error: readErr } = await supabase
    .from("creators")
    .select("onboarding_step")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return dbError(c, readErr, "db_error", 500);

  const nextStep = Math.max(cur.onboarding_step, body.step ?? cur.onboarding_step);
  const patch: Record<string, unknown> = { onboarding_step: nextStep };
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.avatar_url !== undefined) patch.avatar_url = body.avatar_url;
  if (body.categories !== undefined) patch.categories = body.categories;

  const { error } = await supabase.from("creators").update(patch).eq("id", c.get("userId"));
  if (error) return dbError(c, error, "db_error", 500);
  return c.json({ onboarding_step: nextStep });
});

/** POST /api/onboarding/social/connect — append a self-reported handle. */
onboardingRoutes.post("/social/connect", async (c) => {
  const { platform, handle, followers } = await c.req.json<{
    platform: string;
    handle: string;
    followers?: number;
  }>();
  if (!platform || !handle) {
    return c.json({ error: "platform and handle required", code: "bad_input" }, 400);
  }
  const supabase = makeUserClient(c.get("jwt"));
  const { data: cur, error: readErr } = await supabase
    .from("creators")
    .select("social_handles")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return dbError(c, readErr, "db_error", 500);

  const handles = Array.isArray(cur.social_handles) ? cur.social_handles : [];
  handles.push({ platform, handle, followers: followers ?? null, verified: false });

  const { error } = await supabase
    .from("creators")
    .update({ social_handles: handles })
    .eq("id", c.get("userId"));
  if (error) return dbError(c, error, "db_error", 500);
  return c.json({ social_handles: handles });
});

/** GET /api/onboarding/recommended-missions — up to 3 open missions matching categories. */
onboardingRoutes.get("/recommended-missions", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: me, error: creatorError } = await supabase
    .from("creators")
    .select("categories")
    .eq("id", c.get("userId"))
    .single();
  if (creatorError) return dbError(c, creatorError, "db_error", 500);

  let q = supabase
    .from("missions")
    .select(MISSION_LIST_SELECT)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("status", "active")
    .eq("access_type", "open")
    .limit(3);
  if (me?.categories?.length) q = q.in("category", [...new Set((me.categories as string[]).flatMap(missionCategoryValues))]);

  const { data, error } = await q;
  if (error) return dbError(c, error, "db_error", 500);
  return c.json({ missions: (data ?? []).map(serializeMission) });
});

/** POST /api/onboarding/complete — award the welcome bonus (idempotent) + finish. */
onboardingRoutes.post("/complete", async (c) => {
  const svc = serviceClient();
  const { error } = await svc.rpc("award_welcome_bonus", { p_creator: c.get("userId") });
  if (error) return dbError(c, error, "db_error", 500);

  const { data, error: readErr } = await svc
    .from("creators")
    .select("referral_code, onboarding_completed, onboarding_step")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return dbError(c, readErr, "db_error", 500);
  return c.json(data);
});
