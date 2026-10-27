// server/routes/adminRadar.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeRadar } from "../lib/radar.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const DAY_MS = 86_400_000;
const VALID_DAYS = [30] as const; // only 30d in Slice 2; extend later

export const adminRadarRoutes = new Hono<AdminEnv>();

// GET /admin/radar?workspace=<uuid?>&days=<30>
// Inherits the staff-auth middleware from adminRoutes — no extra guard.
adminRadarRoutes.get("/radar", async (c) => {
  const rawDays = c.req.query("days");
  const days = rawDays ? Number(rawDays) : 30;
  if (!(VALID_DAYS as readonly number[]).includes(days)) {
    return c.json({ error: "days must be 30", code: "validation" }, 422);
  }
  const ws = c.req.query("workspace") || "";

  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const cutoffIso = new Date(nowMs - days * DAY_MS).toISOString();
  // At-risk lookback: creators idle for > 30d must have had activity in the past 180d to appear.
  // This fence prevents a full table scan as submission volume grows.
  const atRiskFenceIso = new Date(nowMs - 180 * DAY_MS).toISOString();
  // Due-soon threshold: deadlines within the next 2 calendar days
  const dueSoonIso = new Date(nowMs + 2 * DAY_MS).toISOString();

  const svc = serviceClient();

  // Five queries run in parallel — wall-clock ≈ slowest single query.
  // Queue A: all historical submissions with creator info (used to derive at-risk creators).
  let allSubsQ = svc
    .from("mission_submissions")
    .select("creator_id, status, created_at, submitted_at, reviewed_at, creators!inner(display_name, phone)")
    .gte("created_at", atRiskFenceIso);
  if (ws) allSubsQ = allSubsQ.eq("workspace_id", ws);

  // Queue B: submissions whose review_deadline is overdue OR due within 2 days.
  let overdueQ = svc
    .from("mission_submissions")
    .select("id, creator_id, status, review_deadline, creators!inner(display_name), missions!inner(title)")
    .in("status", ["submitted", "under_review"])
    .not("review_deadline", "is", null)
    .lte("review_deadline", dueSoonIso)
    .order("review_deadline", { ascending: true });
  if (ws) overdueQ = overdueQ.eq("workspace_id", ws);

  // Queue C: approved submissions in last `days` days (quality signal for rising performers).
  let risingQ = svc
    .from("mission_submissions")
    .select("creator_id, quality_rating, creators!inner(display_name, level)")
    .eq("status", "approved")
    .gte("reviewed_at", cutoffIso);
  if (ws) risingQ = risingQ.eq("workspace_id", ws);

  // Queue D: creators registered in last `days` days.
  // Creator ownership uses the same authorized workspace as every other queue.
  const newCreatorsQ = svc
    .from("creators")
    .select("id, display_name, phone, created_at")
    .eq("workspace_id", ws)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false });

  // Queue D anti-join: all distinct creator_ids with any participation.
  // Anti-join done in JS (see shapeRadar) to avoid PostgREST NOT IN limitations.
  let participantsQ = svc.from("mission_submissions").select("creator_id");
  if (ws) participantsQ = participantsQ.eq("workspace_id", ws);

  const [allSubs, overdue, rising, newCreators, participants] = await Promise.all([
    allSubsQ,
    overdueQ,
    risingQ,
    newCreatorsQ,
    participantsQ,
  ]);

  for (const r of [allSubs, overdue, rising, newCreators, participants]) {
    if (r.error) return c.json({ error: r.error.message, code: "db_error" }, 500);
  }

  const radar = shapeRadar({
    now,
    days,
    allSubmissions: (allSubs.data ?? []) as unknown as Parameters<typeof shapeRadar>[0]["allSubmissions"],
    overdueSubmissions: (overdue.data ?? []) as unknown as Parameters<typeof shapeRadar>[0]["overdueSubmissions"],
    recentApprovals: (rising.data ?? []) as unknown as Parameters<typeof shapeRadar>[0]["recentApprovals"],
    newCreators: (newCreators.data ?? []) as Parameters<typeof shapeRadar>[0]["newCreators"],
    allParticipantIds: (participants.data ?? []).map((r: { creator_id: string }) => r.creator_id),
  });

  return c.json({ radar });
});
