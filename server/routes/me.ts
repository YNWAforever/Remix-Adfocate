import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";

/** Supabase stores phone digits without a leading '+'. Re-add it for E.164 display. */
function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

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

  // Identity may be phone-primary (no email) or email — derive a non-null display name.
  const e164 = toE164(u.user.phone);
  const displayName = u.user.email ?? e164 ?? "KOC";

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

  return c.json({ created });
});

/** Guarded: current creator profile (includes onboarding state for the gate). */
export const meRoutes = new Hono<Env>();
meRoutes.get("/me", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select(
      "id, display_name, avatar_url, level, xp, categories, scores, phone, onboarding_step, onboarding_completed, referral_code",
    )
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
