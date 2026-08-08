import type { SupabaseClient } from "@supabase/supabase-js";
import { projectReviewStatus } from "../operatorCrm/serializers";
import { CreatorCaseError, type CreatorCaseErrorCode } from "./errors";
import type { CreatorCaseRepository } from "./repository";
import type {
  AppendCreatorNoteCommand,
  ApplyCreatorReviewCommand,
  CreatorAuditEvent,
  CreatorCaseCommandContext,
  CreatorCaseReadContext,
  CreatorCaseReadModel,
  CreatorReviewNote,
  CreatorReviewQueue,
  CreatorReviewQueueFilters,
} from "./types";

type CreatorRow = {
  id: string;
  workspace_id: string;
  display_name: string | null;
  avatar_url: string | null;
  level: string | null;
  categories: string[] | null;
  scores: Record<string, number | null> | null;
  social_handles: unknown;
  created_at: string;
};

type ReviewRow = {
  status: string;
  risk_level: string;
  summary: string | null;
  reviewed_by: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
};

type NoteRow = {
  id: string;
  creator_id: string;
  workspace_id: string;
  operator_id: string;
  category: CreatorReviewNote["category"];
  body: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  workspace_id: string;
  operator_id: string;
  actor_label: string;
  event_type: string;
  target_type: string;
  target_id: string;
  creator_id: string | null;
  mission_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
const NOTE_PROJECTION = "id, creator_id, workspace_id, operator_id, category, body, created_at";
const AUDIT_PROJECTION = "id, workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, mission_id, metadata, created_at";

const KNOWN_ERROR_CODES: CreatorCaseErrorCode[] = [
  "workspace_required",
  "creator_not_found",
  "mission_not_found",
  "workspace_mismatch",
  "bad_review_status",
  "bad_risk_level",
  "bad_note_category",
  "bad_note_body",
  "flagged_review_note_required",
  "command_conflict",
  "enrichment_unavailable",
];

function failDb(error: { message?: string | null } | null): never {
  const message = error?.message ?? "Database request failed";
  const code = KNOWN_ERROR_CODES.find((candidate) => message.includes(candidate));
  if (code) throw new CreatorCaseError(code, message);
  throw new CreatorCaseError("db_error", message);
}

function toNote(row: NoteRow): CreatorReviewNote {
  return {
    id: row.id,
    creatorId: row.creator_id,
    workspaceId: row.workspace_id,
    operatorId: row.operator_id,
    category: row.category,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toAudit(row: AuditRow): CreatorAuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    operatorId: row.operator_id,
    actorLabel: row.actor_label,
    eventType: row.event_type,
    targetType: row.target_type,
    targetId: row.target_id,
    creatorId: row.creator_id,
    missionId: row.mission_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export class SupabaseCreatorCaseRepository implements CreatorCaseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listReviewQueue(
    _context: CreatorCaseReadContext,
    _filters: CreatorReviewQueueFilters,
  ): Promise<CreatorReviewQueue> {
    throw new CreatorCaseError("enrichment_unavailable", "Creator review queue is not implemented by the command adapter");
  }

  async getCase(context: CreatorCaseReadContext, creatorId: string): Promise<CreatorCaseReadModel> {
    if (!context.workspaceId) throw new CreatorCaseError("workspace_required", "workspaceId is required");

    const creatorRes = await this.supabase
      .from("creators")
      .select(CREATOR_PROJECTION)
      .eq("id", creatorId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (creatorRes.error) failDb(creatorRes.error);
    if (!creatorRes.data) throw new CreatorCaseError("creator_not_found", "Creator was not found");

    const [reviewRes, notesRes, auditRes] = await Promise.all([
      this.supabase
        .from("creator_review_statuses")
        .select(REVIEW_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle(),
      this.supabase
        .from("creator_review_notes")
        .select(NOTE_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("operator_audit_events")
        .select(AUDIT_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .order("created_at", { ascending: true }),
    ]);
    if (reviewRes.error) failDb(reviewRes.error);
    if (notesRes.error) failDb(notesRes.error);
    if (auditRes.error) failDb(auditRes.error);

    const creator = creatorRes.data as CreatorRow;
    return {
      creator: {
        id: creator.id,
        workspaceId: creator.workspace_id,
        displayName: creator.display_name,
        avatarUrl: creator.avatar_url,
        level: creator.level,
        categories: creator.categories ?? [],
        scores: creator.scores ?? {},
        socialHandles: creator.social_handles,
        createdAt: creator.created_at,
      },
      review: projectReviewStatus((reviewRes.data as ReviewRow | null) ?? null),
      notes: ((notesRes.data ?? []) as NoteRow[]).map(toNote),
      audit: ((auditRes.data ?? []) as AuditRow[]).map(toAudit),
      social: { status: "unavailable", reason: "not_configured" },
      profile: { status: "unavailable", reason: "not_configured" },
      missionHistory: { status: "unavailable", reason: "not_configured" },
    };
  }

  async applyReview(context: CreatorCaseCommandContext, command: ApplyCreatorReviewCommand): Promise<CreatorCaseReadModel> {
    const { error } = await this.supabase.rpc("apply_creator_review", {
      p_command_id: context.commandId,
      p_workspace_id: context.workspaceId,
      p_creator_id: command.creatorId,
      p_operator_id: context.actorId,
      p_actor_label: context.actorLabel,
      p_status: command.status,
      p_risk_level: command.riskLevel,
      p_summary: command.summary,
      p_note_category: command.note?.category ?? null,
      p_note_body: command.note?.body ?? null,
    });
    if (error) failDb(error);
    return this.getCase(context, command.creatorId);
  }

  async appendNote(context: CreatorCaseCommandContext, command: AppendCreatorNoteCommand): Promise<CreatorCaseReadModel> {
    const { error } = await this.supabase.rpc("append_creator_review_note", {
      p_command_id: context.commandId,
      p_workspace_id: context.workspaceId,
      p_creator_id: command.creatorId,
      p_operator_id: context.actorId,
      p_actor_label: context.actorLabel,
      p_note_category: command.category,
      p_note_body: command.body,
    });
    if (error) failDb(error);
    return this.getCase(context, command.creatorId);
  }
}
