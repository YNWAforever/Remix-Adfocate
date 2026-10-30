import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { PROFILE_MEDIA_BUCKET } from "../lib/profileMedia/types.js";

// F-009: self-service data export and account deletion (anonymisation).
export const accountRoutes = new Hono<Env>();

const EXPORT_TABLES: Array<[label: string, table: string, column: string, select: string]> = [
  ["profile", "creators", "id", "id, display_name, avatar_url, phone, categories, social_handles, level, xp, status, created_at, referral_code"],
  ["consents", "creator_consents", "creator_id", "document, version, granted, recorded_at"],
  ["submissions", "mission_submissions", "creator_id", "id, mission_id, status, content_urls, submission_data, reviewer_notes, submitted_at, reviewed_at, created_at"],
  ["points", "point_transactions", "creator_id", "type, delta, balance_after, description, created_at"],
  ["earnings", "earnings_transactions", "creator_id", "type, amount, balance_after, description, created_at"],
  ["redemptions", "redemptions", "creator_id", "id, gift_id, points_spent, code, status, created_at"],
  ["socialAccounts", "creator_social_accounts", "creator_id", "platform, handle, owner_verified, follower_count, created_at"],
  ["portfolioLinks", "creator_portfolio_links", "creator_id", "platform_type, url, title, caption, created_at"],
  ["notifications", "notifications", "user_id", "type, data, read_at, created_at"],
];

/** GET /api/me/export — everything we hold about the caller, as a JSON download. */
accountRoutes.get("/export", async (c) => {
  const svc = serviceClient();
  const userId = c.get("userId");
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), creatorId: userId };
  for (const [label, table, column, select] of EXPORT_TABLES) {
    const { data, error } = await svc.from(table).select(select).eq(column, userId);
    if (error) return dbError(c, error, "export_unavailable", 503);
    out[label] = label === "profile" ? (data?.[0] ?? null) : (data ?? []);
  }
  const { data: authUser } = await svc.auth.admin.getUserById(userId);
  out.account = { email: authUser?.user?.email ?? null, phone: authUser?.user?.phone || null, createdAt: authUser?.user?.created_at ?? null };
  const conversations = await svc.from("assistant_conversations")
    .select("id, started_at, messages:assistant_messages(role, content, created_at)").eq("creator_id", userId);
  if (conversations.error) return dbError(c, conversations.error, "export_unavailable", 503);
  out.assistantConversations = conversations.data ?? [];
  c.header("Content-Disposition", `attachment; filename="adfocate-data-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(out);
});

/**
 * POST /api/me/delete {confirm:"DELETE"} — anonymise the account. Ledgers, decisions and audit
 * history are kept under the pseudonymous id; personal data, files and the login identity are
 * removed. Idempotent: a retry after a partial failure completes the remaining steps.
 */
accountRoutes.post("/delete", async (c) => {
  const body = await c.req.json<{ confirm?: unknown }>();
  if (body.confirm !== "DELETE") return c.json({ error: "Type DELETE to confirm", code: "confirmation_required" }, 400);
  const svc = serviceClient();
  const userId = c.get("userId");

  const anonymised = await svc.rpc("anonymize_creator_account", { p_creator: userId });
  if (anonymised.error) return dbError(c, anonymised.error, "deletion_unavailable", 503);

  // Avatar files live under "<uid>/" in the public profile-media bucket.
  const files = await svc.storage.from(PROFILE_MEDIA_BUCKET).list(userId, { limit: 1000 });
  if (files.error) return dbError(c, files.error, "deletion_incomplete", 503);
  if (files.data?.length) {
    const removed = await svc.storage.from(PROFILE_MEDIA_BUCKET).remove(files.data.map((f) => `${userId}/${f.name}`));
    if (removed.error) return dbError(c, removed.error, "deletion_incomplete", 503);
  }

  // Release the email/phone and block sign-in; the access token in hand stops working because
  // workspaceAuth refuses deleted creators.
  const auth = await svc.auth.admin.updateUserById(userId, {
    email: `deleted-${userId}@deleted.invalid`, email_confirm: true,
    user_metadata: {}, ban_duration: "876000h",
  });
  if (auth.error) return dbError(c, auth.error, "deletion_incomplete", 503);
  const { data: user } = await svc.auth.admin.getUserById(userId);
  if (user?.user?.phone) {
    const phone = await svc.auth.admin.updateUserById(userId, { phone: "" });
    if (phone.error) return dbError(c, phone.error, "deletion_incomplete", 503);
  }
  return c.json({ deleted: true });
});
