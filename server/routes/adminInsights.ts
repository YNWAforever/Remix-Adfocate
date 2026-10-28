import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { getInsightsWindow, shapeInsights, type InsightsWindowDays } from "../lib/insights.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const VALID_WINDOWS: InsightsWindowDays[] = [7, 30, 90];
export const adminInsightsRoutes = new Hono<AdminEnv>();

// Stable pages prevent the Data API row cap from silently changing denominators.
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const result = await page(offset, offset + 999);
    if (result.error || !result.data) throw new Error("metrics_unavailable");
    rows.push(...result.data);
    if (result.data.length < 1000) return rows;
  }
  throw new Error("metrics_window_too_large");
}

adminInsightsRoutes.get("/insights", async c => {
  const days = Number(c.req.query("window") || 30) as InsightsWindowDays;
  if (!VALID_WINDOWS.includes(days)) return c.json({ error: "window must be 7, 30 or 90", code: "validation" }, 422);
  const ws = c.get("authorizedWorkspace")?.workspaceId;
  if (!ws) return c.json({ error: "Workspace access is required.", code: "workspace_required" }, 403);
  const to = new Date().toISOString(), window = getInsightsWindow(to, days);
  const priorFrom = new Date(window.priorFromMs).toISOString(), from = new Date(window.fromMs).toISOString(), until = new Date(window.toMs).toISOString();
  const svc = serviceClient();
  try {
    const [submissions, earnings, points, creators, missions, workItems, versions, reviews] = await Promise.all([
      allRows((a,b) => svc.from("mission_submissions").select("id,creator_id,status,points_awarded,created_at,submitted_at,reviewed_at").eq("workspace_id",ws).or(`created_at.gte.${priorFrom},submitted_at.gte.${priorFrom},reviewed_at.gte.${priorFrom}`).order("id").range(a,b)),
      allRows((a,b) => svc.from("earnings_transactions").select("id,type,amount,created_at").eq("workspace_id",ws).gte("created_at",priorFrom).lt("created_at",until).order("id").range(a,b)),
      allRows((a,b) => svc.from("point_transactions").select("id,type,delta,created_at").eq("workspace_id",ws).gte("created_at",priorFrom).lt("created_at",until).order("id").range(a,b)),
      allRows((a,b) => svc.from("creators").select("id,level").eq("workspace_id",ws).order("id").range(a,b)),
      allRows((a,b) => svc.from("missions").select("id,status,quota,filled").eq("workspace_id",ws).eq("status","active").order("id").range(a,b)),
      allRows((a,b) => svc.from("mission_work_items").select("id,state,required,deadline,created_at,workflow:mission_workflows!mission_work_items_workflow_workspace_fk!inner(created_at)").eq("workspace_id",ws).gte("created_at",from).lt("created_at",until).order("id").range(a,b)),
      allRows((a,b) => svc.from("mission_draft_versions").select("id,mission_work_item_id,submitted_at,version_number").eq("workspace_id",ws).gte("submitted_at",from).lt("submitted_at",until).order("id").range(a,b)),
      // A round opened in this window may be decided later; only completed decisions before the cutoff belong here.
      allRows((a,b) => svc.from("mission_review_rounds").select("id,mission_work_item_id,state,review_started_at,decision_at,round_number").eq("workspace_id",ws).gte("created_at",from).lt("created_at",until).lt("decision_at",until).order("id").range(a,b)),
    ]);
    const outcomes = workItems.map(item => {
      const submitted = versions.filter(v => v.mission_work_item_id === item.id).sort((a,b) => a.version_number - b.version_number);
      const decided = reviews.filter(r => r.mission_work_item_id === item.id && r.decision_at).sort((a,b) => a.round_number - b.round_number);
      const workflow = item.workflow as unknown as { created_at: string };
      return { id:item.id, joinedAt:workflow.created_at, firstSubmittedAt:submitted[0]?.submitted_at ?? null,
        firstReviewDecision:decided[0]?.state ?? null, revisionCount:decided.filter(r=>r.state==="revision_requested").length,
        required:item.required, deadline:item.deadline, approvedAt:decided.find(r=>r.state==="approved_to_publish")?.decision_at ?? null,
        cancelled:item.state==="cancelled", reviewDurationsMs:decided.flatMap(r=>r.review_started_at ? [Date.parse(r.decision_at!) - Date.parse(r.review_started_at)] : []),
      };
    });
    return c.json({ insights: shapeInsights({ to, days, submissions, earnings, points, creators, missions, outcomes }) });
  } catch {
    return c.json({ code:"metrics_unavailable", error:"Insights could not be refreshed. Please retry; saved records are unchanged." },503);
  }
});
