import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context, MiddlewareHandler } from "hono";
import { serviceClient } from "./supabase.js";

export type BrandRole = "owner" | "member";
export type BrandRow = { user_id: string; workspace_id: string; email: string; role: BrandRole; active: boolean };

/** Authenticated brand identity set on the Hono context by requireBrand. */
export type BrandIdentity = { userId: string; email: string; workspaceId: string; role: BrandRole };

/** Hono Env for the brand sub-app (separate from creator + admin). */
export type BrandEnv = { Variables: { brand: BrandIdentity } };

/** Resolve a Supabase user to an ACTIVE brand membership. Unlike resolveStaff there is NO
 *  auto-promotion — a brand exists only if invited (a brand_users row was created on accept).
 *  A deactivated (active=false) row is a durable revocation → null. Throws on DB error. */
export async function resolveBrand(svc: SupabaseClient, userId: string): Promise<BrandRow | null> {
  const { data, error } = await svc
    .from("brand_users")
    .select("user_id, workspace_id, email, role, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as BrandRow | null;
  return row && row.active ? row : null;
}

/** Accept-or-resolve: if an ACTIVE brand_users row exists → return its identity (returning brand,
 *  keeps existing workspace); a deactivated row is a durable revocation → null. Else consume a
 *  valid pending invite for the *verified* email → create the membership, stamp accepted_at.
 *  Else null (no access). `svc` MUST be the service client (writes brand_users / brand_invites,
 *  which are RLS-closed). */
export async function acceptBrandInvite(
  svc: SupabaseClient,
  { userId, email, now }: { userId: string; email: string; now: string },
): Promise<BrandIdentity | null> {
  const { data: existingData, error: exErr } = await svc
    .from("brand_users")
    .select("user_id, workspace_id, email, role, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (exErr) throw exErr;
  // The raw row is authoritative — resolveBrand collapses "revoked" into "absent", which here
  // would let a revoked user re-consume an invite for the same address and reactivate themselves.
  const existing = existingData as BrandRow | null;
  if (existing) {
    return existing.active
      ? { userId, email: existing.email, workspaceId: existing.workspace_id, role: existing.role }
      : null;
  }

  const lower = email.toLowerCase();
  const { data: invite, error } = await svc
    .from("brand_invites")
    .select("id, email, workspace_id, role")
    .eq("email", lower)
    .is("accepted_at", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!invite) return null;

  // Claim before writing the membership: stamping accepted_at only while it is still null makes
  // the invite single-use, and doing it first means a caller that loses the race never creates a
  // membership off an invite someone else consumed.
  const { data: claimed, error: claimErr } = await svc
    .from("brand_invites")
    .update({ accepted_at: now })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .select("id, workspace_id, role")
    .maybeSingle();
  if (claimErr) throw claimErr;
  // Lost the race: the winner creates the same membership, so read it back rather than lock the
  // user out of an invite that was consumed on their behalf.
  if (!claimed) {
    const winner = await resolveBrand(svc, userId);
    return winner ? { userId, email: winner.email, workspaceId: winner.workspace_id, role: winner.role } : null;
  }

  const { data: row, error: upErr } = await svc
    .from("brand_users")
    .upsert({ user_id: userId, workspace_id: claimed.workspace_id, email: lower, role: claimed.role, active: true }, { onConflict: "user_id" })
    .select("user_id, workspace_id, email, role, active")
    .single();
  if (upErr) throw upErr;
  const r = row as BrandRow;
  return { userId, email: r.email, workspaceId: r.workspace_id, role: r.role };
}

/** Hono middleware: verify the bearer JWT (via the service client's auth.getUser), resolve an
 *  ACTIVE brand membership, set it on the context. 401 (no/invalid token) / 403 (not a brand).
 *  Mirror server/lib/staffAuth.ts requireStaff for the exact token-extraction idiom. */
export function requireBrand(): MiddlewareHandler<BrandEnv> {
  return async (c: Context<BrandEnv>, next) => {
    const auth = c.req.header("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return c.json({ error: "unauthorized", code: "no_token" }, 401);
    const svc = serviceClient();
    const { data: userData, error } = await svc.auth.getUser(jwt);
    if (error || !userData.user) return c.json({ error: "unauthorized", code: "bad_token" }, 401);
    let row;
    try {
      row = await resolveBrand(svc, userData.user.id);
    } catch (err) {
      console.error("[requireBrand] resolveBrand threw:", err);
      return c.json({ error: "brand lookup failed", code: "db_error" }, 500);
    }
    if (!row) return c.json({ error: "not a brand", code: "not_brand" }, 403);
    c.set("brand", { userId: row.user_id, email: row.email, workspaceId: row.workspace_id, role: row.role });
    await next();
  };
}
