import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { buildPassport } from "../lib/passport.js";

/** Supabase stores phone digits without a leading '+'. Re-add it for E.164 display. */
function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/** The column set returned to the client for the current creator (GET /me and PUT /me/profile). */
const ME_PROJECTION =
  "id, display_name, avatar_url, level, level_seen, xp, categories, scores, phone, onboarding_step, onboarding_completed, referral_code, social_handles";

type SocialHandle = { platform: string; handle: string; followers?: number | null; verified?: boolean };

/** Unguarded: runs before a creator row exists. Resolves workspace from body slug. */
export const meBootstrap = new Hono<Env>();
meBootstrap.post("/bootstrap", async (c) => {
  const auth = c.req.header("Authorization");
  const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "Missing bearer token", code: "no_auth" }, 401);

  const { slug, ref } = await c.req.json<{ slug: string; ref?: string }>();
  if (!slug) return c.json({ error: "Missing slug", code: "no_workspace" }, 400);

  const user = makeUserClient(jwt);
  const { data: u } = await user.auth.getUser();
  if (!u.user) return c.json({ error: "Invalid token", code: "bad_token" }, 401);

  const svc = serviceClient();
  const { data: ws } = await svc.from("workspaces").select("id").eq("slug", slug).single();
  if (!ws) return c.json({ error: "Unknown workspace", code: "no_workspace" }, 404);

  // Identity may be phone-primary or email — derive a non-empty display name.
  // Phone-OTP users carry email === "" (empty string, not null), so use || not ??.
  const e164 = toE164(u.user.phone);
  const displayName = u.user.email || e164 || "KOC";

  // Resolve an optional referral code from the signup link (reject self-referral).
  let referredBy: string | null = null;
  if (ref) {
    const { data: r } = await svc.from("creators").select("id").eq("referral_code", ref).maybeSingle();
    if (r && r.id !== u.user.id) referredBy = r.id;
  }

  // First-login detection: did a creator row already exist?
  const { data: existing } = await svc.from("creators").select("id").eq("id", u.user.id).maybeSingle();
  const created = !existing;

  // ignoreDuplicates → an existing row is never overwritten; only first insert sets these.
  await svc.from("creators").upsert(
    {
      id: u.user.id,
      workspace_id: ws.id,
      display_name: displayName,
      phone: e164,
      ...(referredBy ? { referred_by: referredBy } : {}),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  await svc.from("point_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, balance: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );
  await svc.from("earnings_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, available: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );

  return c.json({ created });
});

/** Guarded: current creator profile (includes onboarding state for the gate).
 *  Mounted at `/me`, so the handler path is "/" → final route is GET /api/me. */
export const meRoutes = new Hono<Env>();
meRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select(ME_PROJECTION)
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});

/** PUT /api/me/profile — edit own profile. Replace semantics, no onboarding-step coupling.
 *  Uses the user client so RLS (creators_self_update from migration 0003 + the column
 *  grants in 0004) scopes the write to id = auth.uid(): a creator can only edit their own row. */
meRoutes.put("/profile", async (c) => {
  let body: { display_name?: string; categories?: string[]; social_handles?: SocialHandle[] } = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty or non-JSON body → treat as a no-op (the empty-patch guard below returns the current row).
  }
  const supabase = makeUserClient(c.get("jwt"));

  const patch: Record<string, unknown> = {};
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.categories !== undefined) patch.categories = body.categories;
  // social_handles is written WHOLE (full replace) so the editor controls the exact set.
  if (body.social_handles !== undefined) patch.social_handles = body.social_handles;

  // No fields provided → return the current row unchanged (PostgREST rejects empty updates).
  if (Object.keys(patch).length === 0) {
    const { data, error } = await supabase
      .from("creators")
      .select(ME_PROJECTION)
      .eq("id", c.get("userId"))
      .single();
    if (error) return c.json({ error: error.message, code: "db_error" }, 500);
    return c.json(data);
  }

  const { data, error } = await supabase
    .from("creators")
    .update(patch)
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});

/** GET /api/me/passport — the Creator Passport: live level + XP, four score rings, and
 *  data-derived badges, all computed on read. Reliability + Influence come from the caller's
 *  own submissions / social handles via the user client (RLS self-scoped); Content is the
 *  average quality_rating across approved submissions scaled to 0-100; Brand Safety is the
 *  non-rejection rate over reviewed submissions. The referrer badge needs a count of OTHER
 *  creators' rows (referred_by = me) which RLS hides from the user client, so that one count
 *  uses the service client — it exposes a number, not other creators' data. */
meRoutes.get("/passport", async (c) => {
  const userId = c.get("userId");
  const supabase = makeUserClient(c.get("jwt"));

  const { data: creator, error: cErr } = await supabase
    .from("creators")
    .select("level, xp, social_handles")
    .eq("id", userId)
    .single();
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);

  const { data: subs, error: sErr } = await supabase
    .from("mission_submissions")
    .select("status, quality_rating")
    .eq("creator_id", userId);
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);

  const { count: referredCount, error: rErr } = await serviceClient()
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", userId);
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);

  const passport = buildPassport({
    level: creator.level,
    xp: creator.xp,
    socialHandles: creator.social_handles as { followers?: number | null }[] | null,
    statuses: (subs ?? []).map((s) => s.status as string),
    // Only approved submissions carry a quality_rating (set by approve_submission); the
    // status guard makes that invariant explicit and keeps Content honest if a rating on
    // any other status is ever introduced.
    ratings: (subs ?? [])
      .filter((s) => {
        const row = s as { status: string; quality_rating?: number | null };
        return row.status === "approved" && row.quality_rating != null;
      })
      .map((s) => (s as { quality_rating: number }).quality_rating),
    referredCount: referredCount ?? 0,
  });
  return c.json(passport);
});

/** POST /api/me/level-seen — acknowledge the level-up celebration. Reads the caller's
 *  current level server-side (so the value can't be forged) and stores it as level_seen,
 *  clearing the pending celebration. Idempotent; RLS scopes the write to id = auth.uid(). */
meRoutes.post("/level-seen", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));

  const { data: current, error: readErr } = await supabase
    .from("creators")
    .select("level")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);

  const { data, error } = await supabase
    .from("creators")
    .update({ level_seen: current.level })
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
