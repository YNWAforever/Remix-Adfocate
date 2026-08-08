import type { SupabaseClient } from "@supabase/supabase-js";
import { nonEmptyText, projectReviewStatus } from "./serializers.js";
import type {
  MissionShortlistSource,
  MissionShortlistStatus,
  OperatorContext,
} from "./types.js";

const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
const SHORTLIST_PROJECTION =
  "mission_id, creator_id, workspace_id, status, source, notes, created_by, updated_by, created_at, updated_at, missions(id, slug, title)";

export class OperatorCrmError extends Error {
  constructor(
    public code:
      | "creator_not_found"
      | "mission_not_found"
      | "shortlist_not_found"
      | "workspace_mismatch"
      | "flagged_note_required"
      | "flagged_invite_blocked"
      | "db_error",
    message: string = code,
  ) {
    super(message);
  }
}

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
  creator_id: string;
  workspace_id: string;
  status: string;
  risk_level: string;
  summary: string | null;
  reviewed_by: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
};

type ShortlistRow = {
  mission_id: string;
  creator_id: string;
  workspace_id: string;
  status: MissionShortlistStatus;
  source: MissionShortlistSource;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  missions?: { id: string; slug: string; title: string } | Array<{ id: string; slug: string; title: string }> | null;
};

type MissionRow = {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  category?: string | null;
};

function failDb(error: { message?: string | null } | null): never {
  throw new OperatorCrmError("db_error", error?.message ?? "db_error");
}

async function mustGetCreator(supabase: SupabaseClient, creatorId: string): Promise<CreatorRow> {
  const { data, error } = await supabase.from("creators").select(CREATOR_PROJECTION).eq("id", creatorId).maybeSingle();
  if (error) failDb(error);
  if (!data) throw new OperatorCrmError("creator_not_found");
  return data as CreatorRow;
}

async function mustGetMission(supabase: SupabaseClient, missionId: string): Promise<MissionRow> {
  const { data, error } = await supabase.from("missions").select("id, workspace_id, slug, title, category").eq("id", missionId).maybeSingle();
  if (error) failDb(error);
  if (!data) throw new OperatorCrmError("mission_not_found");
  return data as MissionRow;
}


export async function enrichAdminMissionRows<
  T extends { creator_id: string; mission_id: string },
>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<
  Array<
    T & {
      creator_review: { status: string; risk_level: string };
      mission_shortlist: { status: string } | null;
    }
  >
> {
  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((row) => row.creator_id))];
  const missionIds = [...new Set(rows.map((row) => row.mission_id))];

  const { data: reviews, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select("creator_id, status, risk_level")
    .in("creator_id", creatorIds);
  if (reviewError) throw new OperatorCrmError("db_error", reviewError.message);

  const { data: shortlists, error: shortlistError } = await supabase
    .from("mission_shortlists")
    .select("creator_id, mission_id, status")
    .in("creator_id", creatorIds)
    .in("mission_id", missionIds);
  if (shortlistError) throw new OperatorCrmError("db_error", shortlistError.message);

  const reviewByCreator = new Map((reviews ?? []).map((row) => [row.creator_id as string, row]));
  const shortlistByPair = new Map((shortlists ?? []).map((row) => [`${row.mission_id}:${row.creator_id}`, row]));

  return rows.map((row) => {
    const review = reviewByCreator.get(row.creator_id);
    const shortlist = shortlistByPair.get(`${row.mission_id}:${row.creator_id}`);

    return {
      ...row,
      creator_review: {
        status: (review?.status as string | undefined) ?? "needs_review",
        risk_level: (review?.risk_level as string | undefined) ?? "unknown",
      },
      mission_shortlist: shortlist ? { status: shortlist.status as string } : null,
    };
  });
}

function assertMatchingWorkspace(mission: MissionRow, creator: CreatorRow) {
  if (mission.workspace_id !== creator.workspace_id) {
    throw new OperatorCrmError("workspace_mismatch");
  }
}

function normalizeShortlistRow(row: ShortlistRow) {
  const mission = Array.isArray(row.missions) ? row.missions[0] ?? null : row.missions ?? null;
  return {
    mission_id: row.mission_id,
    creator_id: row.creator_id,
    workspace_id: row.workspace_id,
    status: row.status,
    source: row.source,
    notes: row.notes,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mission,
  };
}

async function insertAuditEvent(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    context: OperatorContext;
    eventType: string;
    targetType: string;
    targetId: string;
    creatorId?: string | null;
    missionId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("operator_audit_events").insert({
    workspace_id: input.workspaceId,
    operator_id: input.context.operatorId,
    actor_label: input.context.actorLabel,
    event_type: input.eventType,
    target_type: input.targetType,
    target_id: input.targetId,
    creator_id: input.creatorId ?? null,
    mission_id: input.missionId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) failDb(error);
}

/**
 * Read-only mission-shortlist projection kept with the mission-shortlist module.
 * CreatorCase composes this at the HTTP boundary after it has verified workspace access.
 */
export async function listCreatorShortlistMemberships(
  supabase: SupabaseClient,
  creatorId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("mission_shortlists")
    .select(SHORTLIST_PROJECTION)
    .eq("creator_id", creatorId)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) failDb(error);
  return ((data ?? []) as ShortlistRow[]).map(normalizeShortlistRow);
}

export async function listMissionShortlist(supabase: SupabaseClient, missionId: string) {
  const mission = await mustGetMission(supabase, missionId);
  const { data, error } = await supabase
    .from("mission_shortlists")
    .select("mission_id, creator_id, workspace_id, status, source, notes, created_by, updated_by, created_at, updated_at, creators(id, display_name, avatar_url, level)")
    .eq("mission_id", missionId)
    .order("updated_at", { ascending: false });
  if (error) failDb(error);

  return {
    mission,
    shortlists: data ?? [],
  };
}

export async function upsertMissionShortlist(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    source: MissionShortlistSource;
    notes: string | null;
    context: OperatorContext;
  },
) {
  const [mission, creator] = await Promise.all([
    mustGetMission(supabase, input.missionId),
    mustGetCreator(supabase, input.creatorId),
  ]);
  assertMatchingWorkspace(mission, creator);
  const { data: review, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select(REVIEW_PROJECTION)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (reviewError) failDb(reviewError);
  const projectedReview = projectReviewStatus((review as ReviewRow | null) ?? null);
  if (projectedReview.status === "flagged" && !nonEmptyText(input.notes)) {
    throw new OperatorCrmError("flagged_note_required");
  }

  const insertAttempt = await supabase
    .from("mission_shortlists")
    .insert({
      mission_id: input.missionId,
      creator_id: input.creatorId,
      workspace_id: mission.workspace_id,
      status: "shortlisted",
      source: input.source,
      notes: input.notes,
      created_by: input.context.operatorId,
      updated_by: input.context.operatorId,
    })
    .select(SHORTLIST_PROJECTION)
    .single();

  let data = insertAttempt.data as ShortlistRow | null;
  let eventType: "mission_shortlist.created" | "mission_shortlist.updated" = "mission_shortlist.created";

  if (insertAttempt.error) {
    if (insertAttempt.error.code !== "23505") failDb(insertAttempt.error);

    const updateAttempt = await supabase
      .from("mission_shortlists")
      .update({
        status: "shortlisted",
        source: input.source,
        notes: input.notes,
        updated_by: input.context.operatorId,
      })
      .eq("mission_id", input.missionId)
      .eq("creator_id", input.creatorId)
      .select(SHORTLIST_PROJECTION)
      .single();
    if (updateAttempt.error) failDb(updateAttempt.error);
    data = updateAttempt.data as ShortlistRow;
    eventType = "mission_shortlist.updated";
  }

  await insertAuditEvent(supabase, {
    workspaceId: mission.workspace_id,
    context: input.context,
    eventType,
    targetType: "mission_shortlist",
    targetId: `${input.missionId}:${input.creatorId}`,
    creatorId: creator.id,
    missionId: mission.id,
    metadata: { status: "shortlisted", source: input.source },
  });

  return normalizeShortlistRow(data as ShortlistRow);
}

export async function updateMissionShortlistStatus(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    status: MissionShortlistStatus;
    notes?: string | null;
    context: OperatorContext;
  },
) {
  const { data: shortlist, error: shortlistError } = await supabase
    .from("mission_shortlists")
    .select(SHORTLIST_PROJECTION)
    .eq("mission_id", input.missionId)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (shortlistError) failDb(shortlistError);
  if (!shortlist) throw new OperatorCrmError("shortlist_not_found");

  const { data: review, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select(REVIEW_PROJECTION)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (reviewError) failDb(reviewError);
  if (input.status === "invited" && projectReviewStatus((review as ReviewRow | null) ?? null).status === "flagged") {
    throw new OperatorCrmError("flagged_invite_blocked");
  }

  const existing = shortlist as ShortlistRow;
  const notes = input.notes === undefined ? existing.notes : input.notes;
  const { data, error } = await supabase
    .from("mission_shortlists")
    .update({
      status: input.status,
      notes,
      updated_by: input.context.operatorId,
    })
    .eq("mission_id", input.missionId)
    .eq("creator_id", input.creatorId)
    .select(SHORTLIST_PROJECTION)
    .single();
  if (error) failDb(error);

  await insertAuditEvent(supabase, {
    workspaceId: existing.workspace_id,
    context: input.context,
    eventType: "mission_shortlist.updated",
    targetType: "mission_shortlist",
    targetId: `${input.missionId}:${input.creatorId}`,
    creatorId: input.creatorId,
    missionId: input.missionId,
    metadata: { status: input.status },
  });

  return normalizeShortlistRow(data as ShortlistRow);
}
