// server/routes/adminMissions.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import {
  type MissionInput, type MissionRecord, validateMission, validateEdit,
  normalizeBrief, nextDuplicateSlug,
} from "../lib/missionAuthoring.js";
import { normalizePortfolioUrl } from "../lib/profileMedia/service.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { shapeMissionActivity, type MissionActivityRow } from "../lib/missionActivity.js";

/** Secret-gated mission authoring (Slice B1). Mounted under the /admin shared-secret gate;
 *  uses serviceClient (bypasses RLS). Real per-workspace role auth lands with the Brand
 *  Dashboard (B3). All relative imports carry the .js ESM extension. */
export const adminMissionRoutes = new Hono();

export type MissionWorkflowPolicyInput = {
  creator_workflow_mode: "legacy" | "active_workspace";
  fulfillment_required: boolean;
  revision_limit: number;
  review_sla_hours: number;
  revision_response_hours: number;
};

export type MissionDeliverableTemplateInput = {
  id?: string;
  title: string;
  platform: string | null;
  position: number;
  required: boolean;
  draft_due_offset_hours: number;
  publication_instructions: string;
  publication_window_hours: number;
  required_disclosures: string[];
  expected_account: string | null;
  proof_evidence_policy: Record<string, unknown>;
  requirements: {
    id?: string;
    category: "format" | "key_message" | "compliance" | "quality" | "other";
    text: string;
    required: boolean;
    position: number;
  }[];
};

export type MissionWorkflowAuthoringInput = Partial<MissionWorkflowPolicyInput> & {
  deliverable_templates?: MissionDeliverableTemplateInput[];
};

type MissionAuthoringRequest = MissionInput & MissionWorkflowAuthoringInput;

export const DEFAULT_MISSION_WORKFLOW_POLICY: MissionWorkflowPolicyInput = {
  creator_workflow_mode: "legacy",
  fulfillment_required: false,
  revision_limit: 2,
  review_sla_hours: 48,
  revision_response_hours: 48,
};

const REQUIREMENT_CATEGORIES = new Set(["format", "key_message", "compliance", "quality", "other"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function validateMissionWorkflowAuthoring(input: unknown) {
  const errors: Record<string, string> = {};
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) errors.root = "Must be an object";

  const policy = {
    creator_workflow_mode: raw.creator_workflow_mode === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.creator_workflow_mode
      : raw.creator_workflow_mode,
    fulfillment_required: raw.fulfillment_required === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.fulfillment_required
      : raw.fulfillment_required,
    revision_limit: raw.revision_limit === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.revision_limit
      : raw.revision_limit,
    review_sla_hours: raw.review_sla_hours === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.review_sla_hours
      : raw.review_sla_hours,
    revision_response_hours: raw.revision_response_hours === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.revision_response_hours
      : raw.revision_response_hours,
  };

  if (!(policy.creator_workflow_mode === "legacy" || policy.creator_workflow_mode === "active_workspace")) {
    errors.creator_workflow_mode = "Invalid creator workflow";
  }
  if (typeof policy.fulfillment_required !== "boolean") errors.fulfillment_required = "Must be a boolean";
  if (typeof policy.revision_limit !== "number" || !Number.isInteger(policy.revision_limit) || policy.revision_limit < 0) {
    errors.revision_limit = "Must be a non-negative integer";
  }
  if (typeof policy.review_sla_hours !== "number" || !Number.isInteger(policy.review_sla_hours) || policy.review_sla_hours <= 0) errors.review_sla_hours = "Must be a positive integer";
  if (typeof policy.revision_response_hours !== "number" || !Number.isInteger(policy.revision_response_hours) || policy.revision_response_hours <= 0) errors.revision_response_hours = "Must be a positive integer";

  let templates: unknown[] = [];
  if (raw.deliverable_templates !== undefined) {
    if (Array.isArray(raw.deliverable_templates)) templates = raw.deliverable_templates;
    else errors.deliverable_templates = "Must be an array";
  }
  if (policy.creator_workflow_mode === "active_workspace" && !templates.some((template) => isRecord(template) && template.required === true)) {
    errors.deliverable_templates = "Add at least one required deliverable";
  }
  const positions = new Set<number>();
  templates.forEach((template, templateIndex) => {
    const key = `deliverable_templates.${templateIndex}`;
    if (!isRecord(template)) {
      errors[key] = "Must be an object";
      return;
    }
    if (template.id !== undefined && (typeof template.id !== "string" || !UUID_PATTERN.test(template.id))) {
      errors[`${key}.id`] = "Must be a UUID";
    }
    if (typeof template.title !== "string" || !template.title.trim()) errors[`${key}.title`] = "Title is required";
    if (!(template.platform === null || (typeof template.platform === "string" && template.platform.trim()))) {
      errors[`${key}.platform`] = "Platform must be null or a non-empty string";
    }
    if (typeof template.position !== "number" || !Number.isInteger(template.position) || template.position < 0) errors[`${key}.position`] = "Must be a non-negative integer";
    else if (positions.has(template.position as number)) errors[`${key}.position`] = "Deliverable positions must be unique";
    else positions.add(template.position as number);
    if (typeof template.required !== "boolean") errors[`${key}.required`] = "Must be a boolean";
    if (typeof template.draft_due_offset_hours !== "number" || !Number.isInteger(template.draft_due_offset_hours) || template.draft_due_offset_hours < 0) {
      errors[`${key}.draft_due_offset_hours`] = "Must be a non-negative integer";
    }
    if (policy.creator_workflow_mode === "active_workspace") {
      if (typeof template.publication_instructions !== "string" || !template.publication_instructions.trim()) {
        errors[`${key}.publication_instructions`] = "PUBLICATION_INSTRUCTIONS_REQUIRED";
      }
      if (typeof template.publication_window_hours !== "number" || !Number.isInteger(template.publication_window_hours) || template.publication_window_hours <= 0) {
        errors[`${key}.publication_window_hours`] = "PUBLICATION_WINDOW_HOURS_INVALID";
      }
      if (!Array.isArray(template.required_disclosures)) {
        errors[`${key}.required_disclosures`] = "REQUIRED_DISCLOSURES_INVALID";
      } else {
        template.required_disclosures.forEach((disclosure, disclosureIndex) => {
          if (typeof disclosure !== "string" || !disclosure.trim()) errors[`${key}.required_disclosures.${disclosureIndex}`] = "REQUIRED_DISCLOSURE_REQUIRED";
        });
      }
      if (!(template.expected_account === null || template.expected_account === undefined
        || (typeof template.expected_account === "string" && template.expected_account.trim()))) {
        errors[`${key}.expected_account`] = "EXPECTED_ACCOUNT_INVALID";
      }
      if (!isRecord(template.proof_evidence_policy)) errors[`${key}.proof_evidence_policy`] = "PROOF_EVIDENCE_POLICY_INVALID";
    }

    if (!Array.isArray(template.requirements)) {
      errors[`${key}.requirements`] = "Must be an array";
      return;
    }
    const requirementPositions = new Set<number>();
    template.requirements.forEach((requirement, requirementIndex) => {
      const requirementKey = `${key}.requirements.${requirementIndex}`;
      if (!isRecord(requirement)) {
        errors[requirementKey] = "Must be an object";
        return;
      }
      if (requirement.id !== undefined && (typeof requirement.id !== "string" || !UUID_PATTERN.test(requirement.id))) {
        errors[`${requirementKey}.id`] = "Must be a UUID";
      }
      if (typeof requirement.text !== "string" || !requirement.text.trim()) {
        errors[`${requirementKey}.text`] = "Requirement text is required";
      }
      if (typeof requirement.category !== "string" || !REQUIREMENT_CATEGORIES.has(requirement.category)) errors[`${requirementKey}.category`] = "Invalid requirement category";
      if (typeof requirement.position !== "number" || !Number.isInteger(requirement.position) || requirement.position < 0) errors[`${requirementKey}.position`] = "Must be a non-negative integer";
      else if (requirementPositions.has(requirement.position as number)) errors[`${requirementKey}.position`] = "Requirement positions must be unique";
      else requirementPositions.add(requirement.position as number);
      if (typeof requirement.required !== "boolean") errors[`${requirementKey}.required`] = "Must be a boolean";
    });
  });

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    policy: policy as MissionWorkflowPolicyInput,
    templates: templates as MissionDeliverableTemplateInput[],
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
  const { data, error } = await serviceClient().from("workspaces").select("id, slug, name").order("name");
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

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
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
    .update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
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
