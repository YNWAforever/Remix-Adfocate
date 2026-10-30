import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { dbError } from "../lib/httpErrors.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY_MS = 86_400_000;

export const adminBrandInviteRoutes = new Hono<AdminEnv>();

// POST /admin/brand-invites { email, workspace_id, role }
adminBrandInviteRoutes.post("/brand-invites", async (c) => {
  const { email, workspace_id, role } = await c.req.json().catch(() => ({}));
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(e)) return c.json({ error: "invalid email", code: "validation" }, 422);
  if (typeof workspace_id !== "string" || !workspace_id) return c.json({ error: "workspace_id required", code: "validation" }, 422);
  const r = role === "owner" ? "owner" : "member";

  const svc = serviceClient();
  const { error: insErr } = await svc.from("brand_invites").insert({
    email: e, workspace_id, role: r,
    invited_by_staff: c.var.staff.userId,
    expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  });
  if (insErr) return dbError(c, insErr, "db_error", 500);

  // Send the magic-link (Supabase's configured email). Best-effort: the invite row is the
  // authorization; if email send fails the brand can still request a link at /brand/login.
  const origin = c.req.header("Origin") ?? "";
  const { error: otpErr } = await svc.auth.signInWithOtp({
    email: e,
    options: { emailRedirectTo: `${origin}/brand/auth/callback` },
  });
  return c.json({ ok: true, emailed: !otpErr });
});
