// server/routes/adminMissions.ts
import { Hono, type Context } from "hono";
import { serviceClient } from "../lib/supabase.js";
import {
  type MissionInput, type MissionRecord, validateMission, validateEdit,
  normalizeBrief, nextDuplicateSlug,
} from "../lib/missionAuthoring.js";
import { normalizePortfolioUrl } from "../lib/profileMedia/service.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { shapeMissionActivity, type MissionActivityRow } from "../lib/missionActivity.js";
import type { AdminEnv } from "../lib/staffAuth.js";

/** Mission authoring mounted under the existing staff and workspace authorization gate.
 * serviceClient inherits that request scope. Relative imports carry .js ESM extensions. */
export const adminMissionRoutes = new Hono<AdminEnv>();

import { DEFAULT_MISSION_WORKFLOW_POLICY, validateMissionWorkflowAuthoring, type MissionWorkflowPolicyInput, type MissionDeliverableTemplateInput, type MissionWorkflowAuthoringInput } from "../../src/lib/missionWorkflowAuthoring.js";
export { DEFAULT_MISSION_WORKFLOW_POLICY, validateMissionWorkflowAuthoring };
export type { MissionWorkflowPolicyInput, MissionDeliverableTemplateInput, MissionWorkflowAuthoringInput };
type MissionAuthoringRequest = MissionInput & MissionWorkflowAuthoringInput;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeMissionWorkflowAuthoring(input: MissionWorkflowAuthoringInput = {}) {
  return {
    policy: {
      creator_workflow_mode: input.creator_workflow_mode ?? DEFAULT_MISSION_WORKFLOW_POLICY.creator_workflow_mode,
      fulfillment_required: input.fulfillment_required ?? DEFAULT_MISSION_WORKFLOW_POLICY.fulfillment_required,
      revision_limit: input.revision_limit ?? DEFAULT_MISSION_WORKFLOW_POLICY.revision_limit,
      review_sla_hours: input.review_sla_hours ?? DEFAULT_MISSION_WORKFLOW_POLICY.review_sla_hours,
      revision_response_hours: input.revision_response_hours ?? DEFAULT_MISSION_WORKFLOW_POLICY.revision_response_hours,
    } satisfies MissionWorkflowPolicyInput,
    templates: input.deliverable_templates ?? [],
  };
}

type MissionWorkflowRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};

type PersistMissionWorkflowAuthoringInput = {
  missionId: string | null;
  mission: Record<string, unknown>;
  policy: MissionWorkflowPolicyInput;
  templates: MissionDeliverableTemplateInput[];
};

/** True when the client sent the version it edited and the row has changed since. */
export function isStaleEdit(expected: unknown, current: string | null | undefined): boolean {
  if (typeof expected !== "string" || !expected || !current) return false;
  return Date.parse(expected) !== Date.parse(current);
}

export function staleEdit(c: Context) {
  return c.json({ error: "此項目已被其他人更新，請重新載入後再儲存。 / This was changed by someone else. Reload, then save again.", code: "STALE_EDIT" }, 409);
}

export function persistMissionWorkflowAuthoring(
  svc: MissionWorkflowRpcClient,
  input: PersistMissionWorkflowAuthoringInput,
) {
  return svc.rpc("author_mission_workflow", {
    p_mission_id: input.missionId,
    p_mission: input.mission,
    p_policy: input.policy,
    p_templates: input.templates,
  });
}

export function hydrateMissionWorkflowAuthoring(row: Record<string, unknown>) {
  const { policy } = normalizeMissionWorkflowAuthoring(row as MissionWorkflowAuthoringInput);
  const templates = Array.isArray(row.deliverable_templates)
    ? row.deliverable_templates.map((template) => {
      if (!isRecord(template)) return template;
      return {
        ...template,
        requirements: Array.isArray(template.requirements) ? template.requirements : [],
      };
    })
    : [];
  return {
    ...row,
    ...policy,
    deliverable_templates: templates,
  };
}

const ENGAGED_STATUSES = ["applied", "joined", "submitted", "under_review", "approved"];

const MISSION_COLS =
  "id, workspace_id, slug, title, description, category, mission_type, access_type, required_level, " +
  "points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota, filled, status, " +
  "deliverables, requirements, platforms, effort, " +
  "target_audience, dos, donts, key_messages, reference_links, " +
  "creator_workflow_mode, fulfillment_required, revision_limit, review_sla_hours, revision_response_hours, " +
  "deliverable_templates:mission_deliverable_templates!mission_templates_mission_workspace_fk(id, title, platform, position, required, draft_due_offset_hours, publication_instructions, publication_window_hours, required_disclosures, expected_account, proof_evidence_policy, " +
  "requirements:mission_deliverable_requirements!mission_requirements_template_workspace_fk(id, category, text:requirement_text, required, position)), " +
  "created_at, updated_at, published_at, closed_at";

const EDITABLE_COLS: (keyof MissionInput)[] = [
  "slug", "title", "description", "category", "mission_type", "access_type", "required_level",
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "deadline", "quota",
  "deliverables", "requirements", "platforms", "effort",
  "target_audience", "dos", "donts", "key_messages", "reference_links",
];

// normalizeBrief() trims/dedupes brief fields; here we additionally canonicalize each
// reference link to a full http(s) URL (validateMission/validateEdit already rejected
// invalid ones, so this is non-throwing for anything that reaches insert/update).
function normalizeBriefForWrite(input: MissionInput) {
  const brief = normalizeBrief(input);
  return { ...brief, reference_links: brief.reference_links.map((u) => normalizePortfolioUrl(u)) };
}

// Asia/Hong_Kong YYYY-MM-DD. The route (not the pure module) is where the clock lives.
// en-CA formats as YYYY-MM-DD; HK = UTC+8, no DST.
function hkToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function countEngaged(svc: ReturnType<typeof serviceClient>, missionId: string) {
  return svc
    .from("mission_submissions")
    .select("id", { count: "exact", head: true })
    .eq("mission_id", missionId)
    .in("status", ENGAGED_STATUSES);
}

adminMissionRoutes.get("/workspaces", async (c) => {
  const { data, error } = await serviceClient().from("workspaces").select("id, slug, name")
    .eq("id", c.get("authorizedWorkspace").workspaceId).order("name");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ workspaces: data ?? [] });
});

adminMissionRoutes.get("/missions", async (c) => {
  const workspace = c.req.query("workspace");
  const status = c.req.query("status");
  const svc = serviceClient();
  let q = svc.from("missions").select(MISSION_COLS).order("updated_at", { ascending: false });
  if (workspace) q = q.eq("workspace_id", workspace);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string; filled: number | null }>;
  const ids = rows.map((r) => r.id);
  let engagedSet = new Set<string>();
  if (ids.length) {
    const { data: subs, error: sErr } = await svc
      .from("mission_submissions").select("mission_id").in("mission_id", ids).in("status", ENGAGED_STATUSES);
    if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
    engagedSet = new Set((subs ?? []).map((s) => s.mission_id as string));
  }
  const missions = rows.map((r) => ({
    ...hydrateMissionWorkflowAuthoring(r),
    engaged: engagedSet.has(r.id) || (r.filled ?? 0) > 0,
  }));
  return c.json({ missions });
});

adminMissionRoutes.get("/missions/:id", async (c) => {
  const { data, error } = await serviceClient().from("missions").select(MISSION_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ mission: hydrateMissionWorkflowAuthoring(data as unknown as Record<string, unknown>) });
});

adminMissionRoutes.post("/missions", async (c) => {
  const body = await c.req.json<MissionAuthoringRequest>().catch(() => ({}) as MissionAuthoringRequest);
  const { ok, errors } = validateMission(body, "draft");
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const workflow = validateMissionWorkflowAuthoring(body);
  if (!workflow.ok) {
    return c.json({ error: "validation_failed", code: "validation", fields: workflow.errors }, 422);
  }
  const insert: Record<string, unknown> = {
    workspace_id: body.workspace_id, slug: body.slug, title: body.title, mission_type: body.mission_type,
    description: body.description ?? null, category: body.category ?? null,
    access_type: body.access_type ?? "open", required_level: body.required_level ?? "L0",
    points_reward: body.points_reward ?? 0, cash_reward: body.cash_reward ?? null,
    cpm_rate: body.cpm_rate ?? null, cpm_budget_pool: body.cpm_budget_pool ?? null,
    deadline: body.deadline ?? null, quota: body.quota ?? 10,
    deliverables: body.deliverables ?? [], requirements: body.requirements ?? [], platforms: body.platforms ?? [],
    effort: body.effort ?? null, status: "draft",
    ...normalizeBriefForWrite(body),
  };
  const { data, error } = await persistMissionWorkflowAuthoring(serviceClient(), {
    missionId: null,
    mission: insert,
    policy: workflow.policy,
    templates: workflow.templates,
  });
  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: hydrateMissionWorkflowAuthoring(data as Record<string, unknown>) }, 201);
});

adminMissionRoutes.patch("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<MissionAuthoringRequest>().catch(() => ({}) as MissionAuthoringRequest);
  const svc = serviceClient();

  const { data: existing, error: exErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as unknown as { status: string }).status === "closed") {
    return c.json({ error: "已關閉的任務不可編輯", code: "invalid_transition" }, 409);
  }
  // Optimistic lock: an editor saving over a newer version gets a conflict, not a silent overwrite.
  if (isStaleEdit((patch as { expected_updated_at?: unknown }).expected_updated_at, (existing as unknown as { updated_at: string }).updated_at)) {
    return staleEdit(c);
  }

  const { count, error: cErr } = await countEngaged(svc, id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  const engaged = ((existing as unknown as { filled: number | null }).filled ?? 0) > 0 || (count ?? 0) > 0;

  const { ok, errors } = validateEdit(existing as unknown as MissionRecord, patch, engaged);
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const workflow = validateMissionWorkflowAuthoring({
    ...(existing as unknown as Record<string, unknown>),
    ...patch,
  });
  if (!workflow.ok) {
    return c.json({ error: "validation_failed", code: "validation", fields: workflow.errors }, 422);
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = patch[k];

  // Normalize brief fields that were actually sent (don't resurrect absent ones).
  const briefDefaults = normalizeBriefForWrite(patch);
  for (const k of ["target_audience", "dos", "donts", "key_messages", "reference_links"] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = briefDefaults[k];
  }

  const { data, error } = await persistMissionWorkflowAuthoring(svc, {
    missionId: id,
    mission: updates,
    policy: workflow.policy,
    templates: workflow.templates,
  });
  if (error) {
    if (error.message.includes("mission_template_snapshotted")) {
      return c.json({ error: "A deliverable used by an existing workflow cannot be removed", code: "MISSION_TEMPLATE_SNAPSHOTTED" }, 409);
    }
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: hydrateMissionWorkflowAuthoring(data as Record<string, unknown>) });
});

adminMissionRoutes.post("/missions/:id/publish", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as unknown as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以發佈", code: "invalid_transition" }, 409);

  const { ok, errors } = validateMission(m as unknown as MissionInput, "publish", hkToday());
  if (!ok) return c.json({ error: "發佈前請完成必填欄位", code: "validation", fields: errors }, 422);

  const workflow = validateMissionWorkflowAuthoring(m);
  if (!workflow.ok) return c.json({ error: "validation_failed", code: "validation", fields: workflow.errors }, 422);

  const now = new Date().toISOString();
  // Conditional on the status read above, so a double submit cannot publish twice.
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).eq("status", "draft").select(MISSION_COLS).maybeSingle();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "只有草稿可以發佈", code: "invalid_transition" }, 409);
  return c.json({ mission: data });
});

adminMissionRoutes.post("/missions/:id/close", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "active") return c.json({ error: "只有進行中的任務可以關閉", code: "invalid_transition" }, 409);

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).eq("status", "active").select(MISSION_COLS).maybeSingle();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "只有進行中的任務可以關閉", code: "invalid_transition" }, 409);
  return c.json({ mission: data });
});

adminMissionRoutes.delete("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以刪除", code: "invalid_transition" }, 409);

  const { count, error: cErr } = await svc.from("mission_submissions").select("id", { count: "exact", head: true }).eq("mission_id", id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  if ((count ?? 0) > 0) return c.json({ error: "已有報名紀錄的草稿不可刪除", code: "invalid_transition" }, 409);

  const { error: dErr } = await svc.from("missions").delete().eq("id", id);
  if (dErr) return c.json({ error: dErr.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

adminMissionRoutes.post("/missions/:id/duplicate", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();

  // 1. Load source (any status).
  const { data: src, error: sErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
  if (!src) return c.json({ error: "not_found", code: "not_found" }, 404);
  const source = src as unknown as Record<string, unknown> & { workspace_id: string; slug: string };

  // 2. Resolve target workspace.
  const body = await c.req.json<{ workspace_id?: string }>().catch(() => ({}) as { workspace_id?: string });
  const targetWs = body.workspace_id ?? source.workspace_id;
  if (body.workspace_id) {
    const { data: ws, error: wErr } = await svc.from("workspaces").select("id").eq("id", body.workspace_id).maybeSingle();
    if (wErr) return c.json({ error: wErr.message, code: "db_error" }, 500);
    if (!ws) return c.json({ error: "not_found", code: "not_found" }, 404);
  }

  // Pure draft-builder from a source row + chosen slug.
  const draftFrom = (slug: string) => {
    const base: Record<string, unknown> = {};
    for (const k of EDITABLE_COLS) base[k] = source[k as string];
    return {
      ...base,
      workspace_id: targetWs,
      slug,
      status: "draft",
      filled: 0,
      published_at: null,
      closed_at: null,
      created_by: null,
    };
  };

  const fetchSlugs = async () => {
    const { data, error } = await svc.from("missions").select("slug").eq("workspace_id", targetWs);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.slug as string);
  };

  // 3-5. Compute slug, insert, retry once on a racy unique clash.
  try {
    let slug = nextDuplicateSlug(source.slug, await fetchSlugs());
    let ins = await svc.from("missions").insert(draftFrom(slug)).select(MISSION_COLS).single();
    if (ins.error?.code === "23505") {
      slug = nextDuplicateSlug(source.slug, await fetchSlugs());
      ins = await svc.from("missions").insert(draftFrom(slug)).select(MISSION_COLS).single();
    }
    if (ins.error?.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "無法產生唯一 slug，請稍後再試" } }, 422);
    }
    if (ins.error) return c.json({ error: ins.error.message, code: "db_error" }, 500);
    return c.json({ mission: ins.data }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "duplicate failed", code: "db_error" }, 500);
  }
});

adminMissionRoutes.get("/missions/:id/activity", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();

  const { data: mission, error: mErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!mission) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data: rows, error: rErr } = await svc
    .from("mission_submissions")
    .select("id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("mission_id", id)
    .order("created_at", { ascending: true });
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);

  try {
    const enriched = (await enrichAdminMissionRows(svc, rows ?? [])) as unknown as MissionActivityRow[];
    const m = mission as unknown as { filled: number | null; quota: number | null };
    return c.json({ mission, ...shapeMissionActivity(m, enriched) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich activity";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

// Re-export helpers for Tasks 8–9 to import from this file.
export { hkToday, countEngaged, EDITABLE_COLS, MISSION_COLS, normalizeBriefForWrite };
