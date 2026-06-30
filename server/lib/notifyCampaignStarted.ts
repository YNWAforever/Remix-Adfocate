import { serviceClient } from "./supabase.js";
import { creatorQualifiesForCampaign, type MatchMission } from "./missionMatch.js";

/** Best-effort: fan out a campaign_started notification to category/level-matched creators.
 *  NEVER throws — a broadcast failure must not affect the publish response. */
export async function notifyCampaignStarted(campaignId: string): Promise<{ matched: number } | null> {
  try {
    const svc = serviceClient();
    const { data: campaign } = await svc.from("campaigns")
      .select("id, workspace_id").eq("id", campaignId).maybeSingle();
    if (!campaign) return null;
    const workspaceId = typeof (campaign as Record<string, unknown>).workspace_id === "string"
      ? (campaign as { workspace_id: string }).workspace_id
      : null;
    if (!workspaceId) return null;

    const { data: cmRows } = await svc.from("campaign_missions")
      .select("missions(id, slug, title, category, mission_type, required_level, points_reward, cash_reward, deadline, quota, filled)")
      .eq("campaign_id", campaignId).is("removed_at", null);
    const missions = (cmRows ?? [])
      .map((r: { missions: MatchMission | MatchMission[] | null }) => {
        const m = r.missions;
        return Array.isArray(m) ? m[0] : m;
      })
      .filter((m): m is MatchMission => m != null);
    if (missions.length === 0) return { matched: 0 };

    const { data: creators } = await svc.from("creators")
      .select("id, level, categories")
      .eq("workspace_id", workspaceId)
      .eq("status", "active");

    const matchedIds = (creators ?? [])
      .filter((cr: { level: string | null; categories: string[] | null }) =>
        creatorQualifiesForCampaign(
          { level: cr.level ?? "L0", categories: cr.categories ?? [], reliability: null, brandSafety: null, content: null },
          missions))
      .map((cr: { id: string }) => cr.id);
    if (matchedIds.length === 0) return { matched: 0 };

    const { error: rpcErr } = await svc.rpc("broadcast_campaign_started", { p_campaign: campaignId, p_creator_ids: matchedIds });
    if (rpcErr) { console.error("[notifyCampaignStarted] rpc error", rpcErr); return null; }
    return { matched: matchedIds.length };
  } catch (err) {
    console.error("[notifyCampaignStarted] non-fatal", err);
    return null;
  }
}
