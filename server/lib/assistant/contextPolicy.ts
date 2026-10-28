import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistBasisVersion, AssistContext } from "../../../src/lib/missionAssist.js";
import type { StaffWorkspaceRole } from "../staffCapabilities.js";
import { UUID } from "./requestPolicy.js";
import type { RetrievedChunk } from "./retrieve.js";

export type AssistPrincipal = { workspaceId: string; userId: string; role: "creator" | StaffWorkspaceRole };
export class AssistError extends Error {
  constructor(public code: "bad_request" | "not_found" | "context_unavailable" | "assist_disabled" | "provider_outcome_unknown", public status: 400 | 404 | 503) { super(code); }
}
type Row = Record<string, unknown>;
type Client = Pick<SupabaseClient, "from">;
export type AuthorizedAssistContext = {
  context: AssistContext;
  chunks: RetrievedChunk[];
  basisVersion: AssistBasisVersion;
  limitations: string[];
  hasContent: boolean;
};

export function parseAssistContext(value: unknown): AssistContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssistError("bad_request", 400);
  const v = value as Row;
  if (Object.keys(v).some(k => !["workspaceId", "missionId", "workflowId", "workItemId", "versionId", "mode"].includes(k))
    || !["explain_brief", "summarize_changes"].includes(String(v.mode))) throw new AssistError("bad_request", 400);
  for (const k of ["workspaceId", "missionId", "workflowId", "workItemId", "versionId"]) {
    if ((k === "missionId" || v[k] !== undefined) && (typeof v[k] !== "string" || !UUID.test(v[k] as string))) throw new AssistError("bad_request", 400);
  }
  if ((v.workItemId && !v.workflowId) || (v.versionId && !v.workItemId)
    || (v.mode === "summarize_changes" && !v.versionId)) throw new AssistError("bad_request", 400);
  return v as AssistContext;
}

async function one(client: Client, table: string, columns: string, filters: Row): Promise<Row> {
  let query = client.from(table).select(columns);
  for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
  let result;
  try { result = await query.maybeSingle(); } catch { throw new AssistError("context_unavailable", 503); }
  if (result.error) throw new AssistError("context_unavailable", 503);
  const row = result.data as unknown as Row | null;
  if (!row || Object.entries(filters).some(([k, v]) => row[k] !== v)) throw new AssistError("not_found", 404);
  return row;
}
const text = (value: unknown, max = 6000) => typeof value === "string" ? value.slice(0, max) : "";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 30).map(v => text(v, 600)) : [];

/** A read projection over the existing active workflow; no tools, notes, assets, URLs or business writes. */
export async function authorizeAssistContext(client: Client, value: unknown, principal: AssistPrincipal): Promise<AuthorizedAssistContext> {
  const context = parseAssistContext(value);
  if (!principal?.userId || !UUID.test(principal.userId) || !UUID.test(principal.workspaceId)
    || (context.workspaceId && context.workspaceId !== principal.workspaceId)
    || !["creator", "operator", "reviewer", "workspace_admin"].includes(principal.role)
    || (principal.role === "creator" && context.mode !== "explain_brief")) throw new AssistError("not_found", 404);
  const workspace = principal.workspaceId;
  if (principal.role === "creator") await one(client, "creators", "id,workspace_id", { id: principal.userId, workspace_id: workspace });
  const mission = await one(client, "missions", "id,workspace_id,title,status,description,requirements,key_messages,dos,donts,updated_at", { id: context.missionId, workspace_id: workspace });
  if (principal.role === "creator" && mission.status !== "active" && mission.status !== "closed") throw new AssistError("not_found", 404);
  let workflow: Row | null = null, item: Row | null = null, version: Row | null = null, previous: Row | null = null;
  if (context.workflowId) {
    workflow = await one(client, "mission_workflows", "id,workspace_id,mission_submission_id,revision", { id: context.workflowId, workspace_id: workspace });
    await one(client, "mission_submissions", "id,workspace_id,mission_id,creator_id", { id: workflow.mission_submission_id, workspace_id: workspace, mission_id: mission.id,
      ...(principal.role === "creator" ? { creator_id: principal.userId } : {}) });
  }
  if (context.workItemId) item = await one(client, "mission_work_items", "id,workspace_id,mission_workflow_id,title,requirements_snapshot,current_submitted_version_id,approved_version_id", { id: context.workItemId, workspace_id: workspace, mission_workflow_id: workflow!.id });
  if (context.versionId) {
    version = await one(client, "mission_draft_versions", "id,workspace_id,mission_work_item_id,version_number,caption_snapshot,external_draft_url_snapshot,checklist_snapshot", { id: context.versionId, workspace_id: workspace, mission_work_item_id: item!.id });
    if (!Number.isInteger(version.version_number) || Number(version.version_number) < 1) throw new AssistError("context_unavailable", 503);
    if (context.mode === "summarize_changes" && Number(version.version_number) > 1) {
      try { previous = await one(client, "mission_draft_versions", "id,workspace_id,mission_work_item_id,version_number,caption_snapshot,external_draft_url_snapshot,checklist_snapshot", { workspace_id: workspace, mission_work_item_id: item!.id, version_number: Number(version.version_number) - 1 }); }
      catch (error) { if (!(error instanceof AssistError) || error.code !== "not_found") throw error; }
    }
  }
  const chunks: RetrievedChunk[] = [];
  const add = (ref: string, title: string, content: unknown) => chunks.push({ chunkId: ref, documentId: ref, title, content: JSON.stringify(content), sourceType: "mission_assist", sourceRef: ref, similarity: 1 });
  const brief = { description: text(mission.description), requirements: strings(mission.requirements), keyMessages: strings(mission.key_messages), dos: strings(mission.dos), donts: strings(mission.donts) };
  add(`mission:${mission.id}`, text(mission.title, 200), brief);
  const requirements = Array.isArray(item?.requirements_snapshot) ? item.requirements_snapshot.slice(0, 80).flatMap((r: unknown) => {
    if (!r || typeof r !== "object") return [];
    const row = r as Row;
    return [{ id: text(row.id, 120), text: text(row.text || row.label, 600), required: row.required !== false }];
  }) : [];
  if (item) add(`work-item:${item.id}`, text(item.title, 200), { authority: "frozen_requirements_snapshot", requirements });
  const projectVersion = (row: Row) => ({ versionNumber: row.version_number, currentlyApproved: row.id === item?.approved_version_id, caption: text(row.caption_snapshot),
    hasExternalDraft: Boolean(row.external_draft_url_snapshot), checklist: Object.fromEntries(requirements.map(r => [r.id,
      row.checklist_snapshot && typeof row.checklist_snapshot === "object" && (row.checklist_snapshot as Row)[r.id] === true])) });
  if (previous) add(`version:${previous.id}`, `v${previous.version_number}`, projectVersion(previous));
  if (version) add(`version:${version.id}`, `v${version.version_number}`, projectVersion(version));
  const basisVersion: AssistBasisVersion = {
    missionId: context.missionId, missionUpdatedAt: typeof mission.updated_at === "string" ? mission.updated_at : null,
    workflowId: context.workflowId ?? null, workflowRevision: typeof workflow?.revision === "number" ? workflow.revision : null,
    workItemId: context.workItemId ?? null, versionId: context.versionId ?? null,
    versionNumber: typeof version?.version_number === "number" ? version.version_number : null,
    previousVersionId: typeof previous?.id === "string" ? previous.id : null,
    previousVersionApproved: Boolean(previous && previous.id === item?.approved_version_id),
    versionApproved: Boolean(version && version.id === item?.approved_version_id),
    currentVersionId: typeof item?.current_submitted_version_id === "string" ? item.current_submitted_version_id : null,
    stale: Boolean(version && version.id !== item?.current_submitted_version_id),
    sourceHash: createHash("sha256").update(JSON.stringify(chunks)).digest("hex"),
  };
  const limitations = ["human_review_required", "no_business_actions", "payment_and_processing_date_unknown", "private_notes_and_assets_excluded", "bounded_text_projection"];
  if (basisVersion.stale) limitations.push("stale_version");
  if (context.mode === "summarize_changes" && !previous) limitations.push("previous_version_unavailable");
  const hasContent = context.mode === "summarize_changes" ? Boolean(version && previous)
    : Boolean(brief.description || brief.requirements.length || brief.keyMessages.length || brief.dos.length || brief.donts.length || requirements.length);
  return { context, chunks, basisVersion, limitations, hasContent };
}
