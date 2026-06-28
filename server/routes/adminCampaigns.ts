import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import {
  type CampaignInput, type CampaignRecord, validateCampaign, validateEdit,
  canAttachMission, CAMPAIGN_EDITABLE_COLS,
} from "../lib/campaignAuthoring.js";
import { shapeLeaderboard } from "../lib/campaignLeaderboard.js";
import { notifyCampaignStarted } from "../lib/notifyCampaignStarted.js";

export const adminCampaignRoutes = new Hono();

const CAMPAIGN_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_metric, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at, " +
  "created_by, created_at, updated_at";

function pickEditable(body: CampaignInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPAIGN_EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}
async function participantCount(svc: ReturnType<typeof serviceClient>, campaignId: string) {
  const { count } = await svc.from("campaign_participants").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

// List ------------------------------------------------------------------------------------------
adminCampaignRoutes.get("/campaigns", async (c) => {
  const workspace = c.req.query("workspace");
  const status = c.req.query("status");
  const svc = serviceClient();
  let q = svc.from("campaigns").select(CAMPAIGN_COLS).order("updated_at", { ascending: false });
  if (workspace) q = q.eq("workspace_id", workspace);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ campaigns: data ?? [] });
});

// Detail (campaign + attached missions + participant count) -------------------------------------
adminCampaignRoutes.get("/campaigns/:id", async (c) => {
  const svc = serviceClient();
  const { data: campaign, error } = await svc.from("campaigns").select(CAMPAIGN_COLS)
    .eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const row = campaign as unknown as { id: string };
  const { data: missions } = await svc.from("campaign_missions")
    .select("mission_id, added_at, removed_at, missions(title, slug, status)")
    .eq("campaign_id", row.id).is("removed_at", null);
  return c.json({ campaign, missions: missions ?? [], participants: await participantCount(svc, row.id) });
});

// Create draft ----------------------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns", async (c) => {
  const body = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const { ok, errors } = validateCampaign(body, "draft");
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const insert = { ...pickEditable(body), workspace_id: body.workspace_id, status: "draft" };
  const { data, error } = await serviceClient().from("campaigns").insert(insert).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ campaign: data }, 201);
});

// Edit ------------------------------------------------------------------------------------------
adminCampaignRoutes.patch("/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const svc = serviceClient();
  const { data: existing, error: exErr } = await svc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  const hasEngagement = (await participantCount(svc, id)) > 0;
  const { ok, errors } = validateEdit(existing as unknown as CampaignRecord, patch, hasEngagement);
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const updates = { ...pickEditable(patch), updated_at: new Date().toISOString() };
  const { data, error } = await svc.from("campaigns").update(updates).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Publish (draft -> active) ---------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns/:id/publish", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: existing } = await svc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as unknown as CampaignRecord).status !== "draft") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  const { ok, errors } = validateCampaign(existing as unknown as CampaignInput, "publish");
  if (!ok) return c.json({ error: "未符合發佈條件", code: "validation", fields: errors }, 422);
  const { data, error } = await svc.from("campaigns")
    .update({ status: "active", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  await notifyCampaignStarted(c.req.param("id"));   // best-effort; never throws
  return c.json({ campaign: data });
});

// Attach / detach mission -----------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns/:id/missions", async (c) => {
  const id = c.req.param("id");
  const { mission_id } = await c.req.json<{ mission_id: string }>().catch(() => ({ mission_id: "" }));
  const svc = serviceClient();
  const { data: campaign } = await svc.from("campaigns").select("id, workspace_id, status").eq("id", id).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  if (campaign.status === "settled") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  // Friendly pre-check (the partial-unique index is the real guard).
  const { data: active } = await svc.from("campaign_missions").select("mission_id").eq("mission_id", mission_id).is("removed_at", null);
  const guard = canAttachMission(new Set((active ?? []).map((r) => r.mission_id as string)), mission_id);
  if (!guard.ok) return c.json({ error: guard.error, code: "conflict" }, 409);
  const { error } = await svc.from("campaign_missions")
    .insert({ campaign_id: id, mission_id, workspace_id: campaign.workspace_id });
  if (error) {
    if (error.code === "23505") return c.json({ error: "此任務已連結到進行中的挑戰", code: "conflict" }, 409);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ ok: true }, 201);
});

adminCampaignRoutes.delete("/campaigns/:id/missions/:missionId", async (c) => {
  const svc = serviceClient();
  const { data: campaign } = await svc.from("campaigns").select("status").eq("id", c.req.param("id")).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  if (campaign.status === "closed" || campaign.status === "settled") {
    return c.json({ error: "結束後不可移除任務", code: "conflict" }, 409);
  }
  const { error } = await svc.from("campaign_missions").update({ removed_at: new Date().toISOString() })
    .eq("campaign_id", c.req.param("id")).eq("mission_id", c.req.param("missionId")).is("removed_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

// Close / settle --------------------------------------------------------------------------------
function mapRpcError(c: import("hono").Context, msg: string) {
  if (msg.includes("insufficient_budget")) return c.json({ error: "預算不足，請增值後再結算", code: "insufficient_budget" }, 402);
  if (msg.includes("invalid_prize_tiers")) return c.json({ error: "獎品階級無效", code: "validation" }, 422);
  if (msg.includes("wrong_state")) return c.json({ error: "狀態不符", code: "conflict" }, 409);
  if (msg.includes("not_found")) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ error: msg, code: "db_error" }, 500);
}

adminCampaignRoutes.post("/campaigns/:id/close", async (c) => {
  const { data, error } = await serviceClient().rpc("close_campaign", { p_campaign: c.req.param("id") });
  if (error) return mapRpcError(c, String(error.message));
  return c.json({ campaign: data });
});

adminCampaignRoutes.post("/campaigns/:id/settle", async (c) => {
  const { data, error } = await serviceClient().rpc("settle_campaign", { p_campaign: c.req.param("id") });
  if (error) return mapRpcError(c, String(error.message));
  return c.json({ campaign: data });
});

// Leaderboard (operator view) -------------------------------------------------------------------
adminCampaignRoutes.get("/campaigns/:id/leaderboard", async (c) => {
  const svc = serviceClient();
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: c.req.param("id") });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
