import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import type { PostgrestError } from "@supabase/supabase-js";

export const missionRoutes = new Hono<Env>();
export const MY_MISSIONS_SELECT =
  "id, status, content_urls, points_awarded, submitted_at, reviewed_at, created_at, mission_workflows(id), missions!inner(slug, title, category, points_reward, mission_type, creator_workflow_mode)";
export const LEGACY_MY_MISSIONS_SELECT =
  "id, status, content_urls, points_awarded, submitted_at, reviewed_at, created_at, missions!inner(slug, title, category, points_reward, mission_type)";

function isMissingWorkflowMode(error: Pick<PostgrestError, "code" | "message"> | null) {
  return Boolean(
    error
      && (error.code === "42703" || error.code === "PGRST204")
      && error.message.includes("creator_workflow_mode"),
  );
}

export async function findMissionForMode(
  supabase: ReturnType<typeof makeUserClient>,
  workspaceId: string,
  slug: string,
  activeOnly = false,
) {
  let currentQuery = supabase
    .from("missions")
    .select("id, creator_workflow_mode")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug);
  if (activeOnly) currentQuery = currentQuery.eq("status", "active");
  const current = await currentQuery.maybeSingle();
  if (!current.error || !isMissingWorkflowMode(current.error)) return current;

  let legacyQuery = supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug);
  if (activeOnly) legacyQuery = legacyQuery.eq("status", "active");
  const legacy = await legacyQuery.maybeSingle();
  return {
    data: legacy.data ? { id: legacy.data.id, creator_workflow_mode: "legacy" as const } : null,
    error: legacy.error,
  };
}

export async function listMyMissions(
  supabase: ReturnType<typeof makeUserClient>,
  creatorId: string,
  status?: string,
) {
  let currentQuery = supabase
    .from("mission_submissions")
    .select(MY_MISSIONS_SELECT)
    .eq("creator_id", creatorId);
  if (status) currentQuery = currentQuery.eq("status", status);
  const current = await currentQuery.order("created_at", { ascending: false });
  if (!current.error || !isMissingWorkflowMode(current.error)) return current;

  let legacyQuery = supabase
    .from("mission_submissions")
    .select(LEGACY_MY_MISSIONS_SELECT)
    .eq("creator_id", creatorId);
  if (status) legacyQuery = legacyQuery.eq("status", status);
  return legacyQuery.order("created_at", { ascending: false });
}

// RPC raise-messages double as stable codes. Map them to HTTP; anything else is a 500.
const RPC_409 = new Set([
  "mission_full", "already_joined", "not_open", "closed",
  "level_locked", "wrong_state", "empty_urls", "not_authenticated",
  "not_application", "already_applied", "verification_required",
]);
function rpcError(c: Context<Env>, error: PostgrestError) {
  const msg = error.message ?? "";
  if (msg === "not_found") return c.json({ error: msg, code: msg }, 404);
  if (RPC_409.has(msg)) return c.json({ error: msg, code: msg }, 409);
  return c.json({ error: msg || "rpc error", code: "db_error" }, 500);
}

missionRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("missions")
    .select("id, slug, title, description, category, mission_type, access_type, points_reward, deadline, quota, filled, status")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("status", "active")            // B1: never surface draft/closed to creators
    .order("created_at", { ascending: false });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  // Annotate each mission with the caller's submission status (or null).
  const { data: subs } = await supabase
    .from("mission_submissions")
    .select("mission_id, status")
    .eq("creator_id", c.get("userId"));
  const byId = new Map((subs ?? []).map((s) => [s.mission_id, s.status]));
  const missions = (data ?? []).map((m) => ({ ...m, my_status: byId.get(m.id) ?? null }));
  return c.json({ missions });
});

/** Caller's own submissions (joined to their missions). Registered before /:slug. */
missionRoutes.get("/my", async (c) => {
  const status = c.req.query("status");
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await listMyMissions(
    supabase,
    c.get("userId"),
    status,
  );
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const submissions = (data ?? []).map((value) => {
    const row = value as typeof value & {
      mission_workflows?: { id: string } | Array<{ id: string }> | null;
      missions?: { creator_workflow_mode?: "legacy" | "active_workspace" };
    };
    const workflows = row.mission_workflows;
    const workflow = Array.isArray(workflows) ? workflows[0] : workflows;
    const { mission_workflows: _missionWorkflows, ...submission } = row;
    void _missionWorkflows;
    return { ...submission, creator_workflow_mode: row.missions?.creator_workflow_mode ?? "legacy", active_workflow_id: workflow?.id ?? null };
  });
  return c.json({ submissions });


});

missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*, workspaces(name)")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .eq("status", "active")            // B1: draft/closed → 404 for creators
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  // Flatten the joined brand name to a top-level `brand`; drop the nested object.
  const { workspaces, ...rest } = data as Record<string, unknown> & { workspaces?: { name?: string } | null };
  return c.json({ ...rest, brand: workspaces?.name ?? null });
});

/** Join an open mission. */
missionRoutes.post("/:slug/join", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await findMissionForMode(
    supabase,
    c.get("workspaceId"),
    c.req.param("slug"),
    true,
  );
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const result = await joinMissionWithWorkflowRecovery(
    supabase,
    m,
    c.get("userId"),
    c.get("workspaceId"),
  );
  if (result.error) return rpcError(c, result.error);
  return c.json(result.data);
});

/** Submit content for a joined mission. */
missionRoutes.put("/:slug/submit", async (c) => {
  const body = await c.req.json<{ content_urls: string[]; submission_data?: Record<string, unknown> }>();
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await findMissionForMode(
    supabase,
    c.get("workspaceId"),
    c.req.param("slug"),
  );
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const result = await submitMissionForMode(supabase, m, body);
  if (result.mismatch) return c.json({ code: "WORKFLOW_MODE_MISMATCH" }, 409);
  if (result.error) return rpcError(c, result.error);
  return c.json(result.data);
});

/** Apply to an application-gated mission (one-tap). Operator vets via /admin/applications. */
missionRoutes.post("/:slug/apply", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("apply_mission", { p_mission: m.id });
  if (error) return rpcError(c, error);
  return c.json(data);
});
type MissionMode = {
  id: string;
  creator_workflow_mode: string;
};

type SubmissionBody = {
  content_urls: string[];
  submission_data?: Record<string, unknown>;
};

export async function joinMissionWithWorkflowRecovery(
  supabase: ReturnType<typeof makeUserClient>,
  mission: MissionMode,
  creatorId: string,
  workspaceId: string,
) {
  if (mission.creator_workflow_mode !== "active_workspace") {
    const joined = await supabase.rpc("join_mission", { p_mission: mission.id });
    return { data: joined.data, error: joined.error };
  }

  const joined = await supabase.rpc("join_active_mission", {
    p_mission: mission.id,
  });
  if (!joined.error) {
    return { data: joined.data, error: null };
  }

  if (joined.error.message !== "already_joined") {
    return { data: null, error: joined.error };
  }

  // Historical joined submissions deliberately recover only the workflow. Their
  // joined reward values are unknown and require the audited operator backfill.
  let submission;
  {
    const existing = await supabase
      .from("mission_submissions")
      .select("*")
      .eq("mission_id", mission.id)
      .eq("creator_id", creatorId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (existing.error) return { data: null, error: existing.error };
    if (!existing.data || existing.data.status !== "joined") {
      return { data: null, error: joined.error };
    }
    submission = existing.data;
  }

  const workflow = await supabase.rpc("create_mission_workflow", {
    p_submission: submission.id,
  });
  if (workflow.error) return { data: null, error: workflow.error };
  return {
    data: { submission, workflow: workflow.data },
    error: null,
  };
}

export async function submitMissionForMode(
  supabase: ReturnType<typeof makeUserClient>,
  mission: MissionMode,
  body: SubmissionBody,
) {
  if (mission.creator_workflow_mode === "active_workspace") {
    return { mismatch: true, data: null, error: null };
  }
  const result = await supabase.rpc("submit_mission", {
    p_mission: mission.id,
    p_urls: body.content_urls ?? [],
    p_data: body.submission_data ?? {},
  });
  return { mismatch: false, data: result.data, error: result.error };
}
