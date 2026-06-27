import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { shapeLeaderboard, myStanding } from "../lib/campaignLeaderboard.js";

export const campaignRoutes = new Hono<Env>();

const PUBLIC_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at";

// List: active campaigns in the caller's workspace (client splits active vs upcoming by starts_at).
campaignRoutes.get("/", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc.from("campaigns").select(PUBLIC_COLS)
    .eq("workspace_id", c.get("workspaceId")).eq("status", "active")
    .order("ends_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ campaigns: data ?? [] });
});

// Detail + the caller's own progress.
campaignRoutes.get("/:slug", async (c) => {
  const svc = serviceClient();
  const ws = c.get("workspaceId");
  const { data: rawCampaign, error } = await svc.from("campaigns").select(PUBLIC_COLS)
    .eq("workspace_id", ws).eq("slug", c.req.param("slug")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const campaign = rawCampaign as { id: string; status: string; [key: string]: unknown } | null;
  if (!campaign || campaign.status === "draft") return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data: missions } = await svc.from("campaign_missions")
    .select("mission_id, missions(title, slug, status, points_reward, cash_reward)")
    .eq("campaign_id", campaign.id).is("removed_at", null);

  const { data: me } = await svc.from("campaign_participants")
    .select("approved_count, goal_reached_at, bonus_granted_at, prize_rank")
    .eq("campaign_id", campaign.id).eq("creator_id", c.get("userId")).maybeSingle();

  const { data: ranked } = await svc.rpc("rank_campaign", { p_campaign: campaign.id });
  const mine = myStanding(ranked ?? [], c.get("userId"));

  return c.json({
    campaign, missions: missions ?? [],
    my_progress: {
      approved: me?.approved_count ?? 0,
      goal_reached: !!me?.goal_reached_at,
      bonus_granted: !!me?.bonus_granted_at,
      prize_rank: me?.prize_rank ?? null,
      rank: mine?.rank ?? null,
    },
  });
});

// Public leaderboard for one campaign in the caller's workspace.
campaignRoutes.get("/:slug/leaderboard", async (c) => {
  const svc = serviceClient();
  const { data: rawLb } = await svc.from("campaigns").select("id")
    .eq("workspace_id", c.get("workspaceId")).eq("slug", c.req.param("slug")).maybeSingle();
  const campaign = rawLb as { id: string } | null;
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: campaign.id });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
