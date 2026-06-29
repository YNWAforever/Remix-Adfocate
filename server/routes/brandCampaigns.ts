// server/routes/brandCampaigns.ts
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { type BrandEnv } from "../lib/brandAuth.js";
import {
  type CampaignInput, type CampaignRecord, validateCampaign, validateEdit,
  canAttachMission, CAMPAIGN_EDITABLE_COLS,
} from "../lib/campaignAuthoring.js";
import { shapeLeaderboard } from "../lib/campaignLeaderboard.js";

/** Brand self-serve campaigns: AUTHOR + CLOSE only (settle is operator-only). Reads/writes run
 *  through makeUserClient(jwt) so 0025 brand RLS enforces workspace isolation — a cross-workspace
 *  campaign is invisible (→ 404). workspace_id always comes from c.var.brand, never the body.
 *  serviceClient is used ONLY for the two SECURITY-DEFINER ops (close_campaign, rank_campaign),
 *  each gated by brandOwnsCampaign() (an RLS read that 404s a foreign campaign). */

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

const CAMPAIGN_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_metric, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at, " +
  "created_by, created_at, updated_at";

export const brandCampaignRoutes = new Hono<BrandEnv>();

function pickEditable(body: CampaignInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPAIGN_EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}

/** RLS ownership gate: read the campaign as the brand user; null = not theirs / nonexistent → 404. */
async function brandOwnsCampaign(uc: SupabaseClient, id: string) {
  const { data } = await uc.from("campaigns").select("id, workspace_id, status").eq("id", id).maybeSingle();
  return data as null | { id: string; workspace_id: string; status: string };
}

async function participantCount(uc: SupabaseClient, campaignId: string) {
  const { count } = await uc.from("campaign_participants").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

// List ------------------------------------------------------------------------------------------
brandCampaignRoutes.get("/", async (c) => {
  const b = c.var.brand;
  const status = c.req.query("status") || "";
  let q = makeUserClient(bearer(c)).from("campaigns").select(CAMPAIGN_COLS)
    .eq("workspace_id", b.workspaceId).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) { console.error("[brandCampaigns] list", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ campaigns: data ?? [] });
});

// Detail (campaign + attached missions + participant count) -------------------------------------
brandCampaignRoutes.get("/:id", async (c) => {
  const uc = makeUserClient(bearer(c));
  const { data: campaign, error } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) { console.error("[brandCampaigns] detail", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const cid = (campaign as unknown as { id: string }).id;
  const { data: missions } = await uc.from("campaign_missions")
    .select("mission_id, added_at, removed_at, missions(title, slug, status)")
    .eq("campaign_id", cid).is("removed_at", null);
  return c.json({ campaign, missions: missions ?? [], participants: await participantCount(uc, cid) });
});

// Create draft ----------------------------------------------------------------------------------
brandCampaignRoutes.post("/", async (c) => {
  const b = c.var.brand;
  const body = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const input: CampaignInput = { ...body, workspace_id: b.workspaceId };   // never trust the body's workspace
  const { ok, errors } = validateCampaign(input, "draft");
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const insert = { ...pickEditable(input), workspace_id: b.workspaceId, status: "draft" };
  const { data, error } = await makeUserClient(bearer(c)).from("campaigns").insert(insert).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    console.error("[brandCampaigns] create", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data }, 201);
});

// Edit ------------------------------------------------------------------------------------------
brandCampaignRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const uc = makeUserClient(bearer(c));
  const { data: existing, error: exErr } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (exErr) { console.error("[brandCampaigns] edit-read", exErr); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  const hasEngagement = (await participantCount(uc, id)) > 0;
  const { ok, errors } = validateEdit(existing as unknown as CampaignRecord, patch, hasEngagement);
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const updates = { ...pickEditable(patch), updated_at: new Date().toISOString() };   // status/closed_at/settled_at are NOT editable cols
  const { data, error } = await uc.from("campaigns").update(updates).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    console.error("[brandCampaigns] edit", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Publish (draft -> active) ---------------------------------------------------------------------
brandCampaignRoutes.post("/:id/publish", async (c) => {
  const id = c.req.param("id");
  const uc = makeUserClient(bearer(c));
  const { data: existing } = await uc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as unknown as { status: string }).status !== "draft") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  const { ok, errors } = validateCampaign(existing as unknown as CampaignInput, "publish");
  if (!ok) return c.json({ error: "未符合發佈條件", code: "validation", fields: errors }, 422);
  const now = new Date().toISOString();
  const { data, error } = await uc.from("campaigns")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) { console.error("[brandCampaigns] publish", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ campaign: data });
});

// Attach / detach mission -----------------------------------------------------------------------
brandCampaignRoutes.post("/:id/missions", async (c) => {
  const b = c.var.brand;
  const id = c.req.param("id");
  const { mission_id } = await c.req.json<{ mission_id: string }>().catch(() => ({ mission_id: "" }));
  const uc = makeUserClient(bearer(c));
  const { data: campaign } = await uc.from("campaigns").select("id, status").eq("id", id).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const st = (campaign as { status: string }).status;
  if (st === "closed" || st === "settled") return c.json({ error: "結束後不可加入任務", code: "conflict" }, 409);
  // Friendly pre-check only — the partial-unique index on campaign_missions is the real guard.
  // A read error here harmlessly falls through to the insert, which surfaces 23505 → 409 below.
  const { data: active } = await uc.from("campaign_missions").select("mission_id").eq("mission_id", mission_id).is("removed_at", null);
  const guard = canAttachMission(new Set((active ?? []).map((r) => r.mission_id as string)), mission_id);
  if (!guard.ok) return c.json({ error: guard.error, code: "conflict" }, 409);
  // RLS insert (with_check brand workspace) + the composite FK guarantees mission ∈ brand workspace.
  const { error } = await uc.from("campaign_missions").insert({ campaign_id: id, mission_id, workspace_id: b.workspaceId });
  if (error) {
    if (error.code === "23505") return c.json({ error: "此任務已連結到進行中的挑戰", code: "conflict" }, 409);
    if (error.code === "23503") return c.json({ error: "此任務不存在或不屬於你的 workspace", code: "conflict" }, 409);  // composite FK
    console.error("[brandCampaigns] attach", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ ok: true }, 201);
});

brandCampaignRoutes.delete("/:id/missions/:missionId", async (c) => {
  const uc = makeUserClient(bearer(c));
  const { data: campaign } = await uc.from("campaigns").select("status").eq("id", c.req.param("id")).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const st = (campaign as { status: string }).status;
  if (st === "closed" || st === "settled") return c.json({ error: "結束後不可移除任務", code: "conflict" }, 409);
  const { error } = await uc.from("campaign_missions").update({ removed_at: new Date().toISOString() })
    .eq("campaign_id", c.req.param("id")).eq("mission_id", c.req.param("missionId")).is("removed_at", null);
  if (error) { console.error("[brandCampaigns] detach", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  return c.json({ ok: true });
});

// Close (active -> closed) — SECURITY-DEFINER RPC behind the RLS ownership gate -------------------
brandCampaignRoutes.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const owned = await brandOwnsCampaign(makeUserClient(bearer(c)), id);
  if (!owned) return c.json({ error: "not_found", code: "not_found" }, 404);
  const { data, error } = await serviceClient().rpc("close_campaign", { p_campaign: id });
  if (error) {
    const msg = String(error.message);
    if (msg.includes("wrong_state")) return c.json({ error: "狀態不符", code: "conflict" }, 409);
    if (msg.includes("not_found")) return c.json({ error: "not_found", code: "not_found" }, 404);
    console.error("[brandCampaigns] close", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Leaderboard — SECURITY-DEFINER rank_campaign behind the RLS ownership gate ----------------------
brandCampaignRoutes.get("/:id/leaderboard", async (c) => {
  const id = c.req.param("id");
  const owned = await brandOwnsCampaign(makeUserClient(bearer(c)), id);
  if (!owned) return c.json({ error: "not_found", code: "not_found" }, 404);
  const svc = serviceClient();
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: id });
  if (error) { console.error("[brandCampaigns] leaderboard", error); return c.json({ error: "伺服器錯誤", code: "db_error" }, 500); }
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
