import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Window = { total: number; saved: number; unknown: number; failed: number; pending: number };
type ProposalWindow = { total: number; executed: number; failed: number };
type RequestRow = { state?: unknown; created_at?: unknown; request_id?: unknown };
type ProposalRow = { outcome?: unknown; created_at?: unknown };

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Assistant request/proposal outcomes for the operator view. Read-only, workspace scoped and
 * payload-free: state/outcome counts only, no messages or answers.
 */
export const adminAssistantRoutes = new Hono<AdminEnv>();

adminAssistantRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

adminAssistantRoutes.get("/reliability", async c => {
  const scope = c.get("authorizedWorkspace");
  const store = serviceClient();
  const [requests, proposals] = await Promise.all([
    store.from("assistant_requests").select("state,created_at,request_id")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false }).limit(1000),
    store.from("assistant_proposal_audit").select("outcome,created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  if (requests.error || proposals.error) return c.json({ code: "assistant_reliability_unavailable" }, 503);

  const now = Date.now();
  const requestWindow = (cutoff: number): Window => {
    const rows = ((requests.data ?? []) as RequestRow[]).filter(row => (timestamp(row.created_at) ?? 0) >= cutoff);
    const states = new Map<string, number>();
    for (const row of rows) states.set(String(row.state ?? "unknown"), (states.get(String(row.state ?? "unknown")) ?? 0) + 1);
    const saved = states.get("saved") ?? 0;
    const unknown = states.get("unknown") ?? 0;
    const failed = states.get("failed") ?? 0;
    return { total: rows.length, saved, unknown, failed, pending: rows.length - saved - unknown - failed };
  };
  const proposalWindow = (cutoff: number): ProposalWindow => {
    const rows = ((proposals.data ?? []) as ProposalRow[]).filter(row => (timestamp(row.created_at) ?? 0) >= cutoff);
    let executed = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.outcome === "executed") executed += 1;
      else failed += 1;
    }
    return { total: rows.length, executed, failed };
  };

  const unknownRows = ((requests.data ?? []) as RequestRow[]).filter(row => row.state === "unknown");
  const lastUnknown = unknownRows[0];
  const recentUnknown = unknownRows.slice(0, 5).flatMap(row => (typeof row.request_id === "string" && typeof row.created_at === "string" ? [{ request_id: row.request_id, created_at: row.created_at }] : []));
  return c.json({
    requests: { "24h": requestWindow(now - DAY_MS), "7d": requestWindow(now - 7 * DAY_MS) },
    proposals: { "24h": proposalWindow(now - DAY_MS), "7d": proposalWindow(now - 7 * DAY_MS) },
    last_unknown_at: typeof lastUnknown?.created_at === "string" ? lastUnknown.created_at : null,
    recent_unknown: recentUnknown,
  });
});
