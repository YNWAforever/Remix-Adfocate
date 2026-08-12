import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creator-case side panels read from sources that can be absent (a table not yet
 * provisioned in this environment) or transiently broken (a query error). Neither
 * should take down the whole case file, so each panel is wrapped in this envelope
 * and the UI degrades to an explanatory placeholder instead of an error boundary.
 */
export type CreatorCaseEnrichment<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "source_error" | "not_configured" };

export type CreatorCaseProofReviewState =
  | "awaiting_review"
  | "in_review"
  | "correction_requested"
  | "verified";

export type CreatorCaseProofItem = {
  attemptId: string;
  workflowId: string;
  workItemId: string;
  workItemTitle: string;
  platform: string;
  missionTitle: string | null;
  missionSlug: string | null;
  attemptNumber: number;
  primaryUrl: string;
  submittedAt: string;
  submittedLate: boolean;
  metadataStatus: "available" | "unavailable" | "unsafe";
  reviewState: CreatorCaseProofReviewState;
  reviewSummary: string | null;
  reviewedAt: string | null;
};

/**
 * Both embeds name their constraint explicitly: `mission_work_items` reaches
 * `mission_workflows` through a single-column FK *and* a composite workspace FK, so an
 * unhinted embed is ambiguous (PGRST201). The attempts hint matches the one asserted in
 * `active-mission-schema.test.ts`.
 *
 * The chain stops at `mission_workflows`.
 * `20260720193637_resolve_mission_submission_relationships` dropped
 * `mission_workflows_mission_submission_id_fkey`, so the submission can no longer be
 * embedded from the workflow — that hop is joined in JS below, the same way
 * `adminActiveMissions` does it.
 */
const PROOF_PROJECTION =
  "id, attempt_number, primary_url, submitted_at, submitted_late, metadata_status, " +
  "mission_work_items!mission_publication_proof_attempts_work_item_workspace_fk!inner(id, title, platform, mission_workflow_id, " +
  "mission_workflows!mission_work_items_workflow_workspace_fk!inner(id, mission_submission_id)), " +
  "mission_publication_proof_reviews(review_number, state, summary, reviewed_at)";

/**
 * `mission_submissions_mission_id_fkey` was dropped by the same migration, so the mission
 * embed must name the surviving composite constraint explicitly.
 */
const SUBMISSION_MISSION_PROJECTION = "id, missions!mission_submissions_mission_workspace_fk(title, slug)";

export type CreatorCaseMission = { title: string | null; slug: string | null };

/** Pending work sorts above settled work, oldest first, so the queue reads as a to-do list. */
const STATE_RANK: Record<CreatorCaseProofReviewState, number> = {
  awaiting_review: 0,
  correction_requested: 1,
  in_review: 2,
  verified: 3,
};

function firstRecord(value: unknown): Record<string, unknown> | null {
  // PostgREST returns embedded to-one relations as an object, but some client/PostgREST
  // version pairs return a single-element array. Accept either shape.
  if (Array.isArray(value)) return firstRecord(value[0] ?? null);
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  const single = firstRecord(value);
  return single ? [single] : [];
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveReviewState(reviews: Record<string, unknown>[]): {
  state: CreatorCaseProofReviewState;
  summary: string | null;
  reviewedAt: string | null;
} {
  if (reviews.length === 0) {
    return { state: "awaiting_review", summary: null, reviewedAt: null };
  }

  // The newest review round wins; earlier rounds are history.
  const latest = reviews.reduce((newest, candidate) =>
    (readNumber(candidate, "review_number") ?? 0) > (readNumber(newest, "review_number") ?? 0) ? candidate : newest,
  );

  const raw = readString(latest, "state");
  const state: CreatorCaseProofReviewState =
    raw === "verified" ? "verified" : raw === "correction_requested" ? "correction_requested" : "in_review";

  return { state, summary: readString(latest, "summary"), reviewedAt: readString(latest, "reviewed_at") };
}

function metadataStatusOf(row: Record<string, unknown>): CreatorCaseProofItem["metadataStatus"] {
  const raw = readString(row, "metadata_status");
  return raw === "available" || raw === "unsafe" ? raw : "unavailable";
}

/**
 * Pure projection from PostgREST rows to the panel's read model. Split out from the
 * query so the shaping rules are unit-testable without a database.
 */
export function projectCreatorCaseProofs(
  rows: unknown,
  missionsBySubmissionId: Map<string, CreatorCaseMission> = new Map(),
): CreatorCaseProofItem[] {
  const items: CreatorCaseProofItem[] = [];

  for (const row of asArray(rows)) {
    const workItem = firstRecord(row.mission_work_items);
    const workflow = firstRecord(workItem?.mission_workflows);
    const submissionId = readString(workflow, "mission_submission_id");
    const mission = submissionId ? missionsBySubmissionId.get(submissionId) : undefined;

    const attemptId = readString(row, "id");
    const workItemId = readString(workItem, "id");
    const workflowId = readString(workflow, "id") ?? readString(workItem, "mission_workflow_id");
    const primaryUrl = readString(row, "primary_url");
    const submittedAt = readString(row, "submitted_at");

    // A proof with no work item, workflow, or URL cannot be actioned by the operator,
    // so drop it rather than render a dead row.
    if (!attemptId || !workItemId || !workflowId || !primaryUrl || !submittedAt) continue;

    const review = deriveReviewState(asArray(row.mission_publication_proof_reviews));

    items.push({
      attemptId,
      workflowId,
      workItemId,
      workItemTitle: readString(workItem, "title") ?? "Untitled deliverable",
      platform: readString(workItem, "platform") ?? "unknown",
      missionTitle: mission?.title ?? null,
      missionSlug: mission?.slug ?? null,
      attemptNumber: readNumber(row, "attempt_number") ?? 1,
      primaryUrl,
      submittedAt,
      submittedLate: row.submitted_late === true,
      metadataStatus: metadataStatusOf(row),
      reviewState: review.state,
      reviewSummary: review.summary,
      reviewedAt: review.reviewedAt,
    });
  }

  return items.sort((a, b) => {
    const rank = STATE_RANK[a.reviewState] - STATE_RANK[b.reviewState];
    if (rank !== 0) return rank;
    return a.submittedAt.localeCompare(b.submittedAt);
  });
}

/**
 * `42P01` is Postgres "undefined_table"; `PGRST205` is PostgREST failing to find the
 * relation in its schema cache. Both mean the publication-proof migrations have not
 * been applied here, which is a configuration state rather than a fault.
 */
function isNotConfigured(error: { code?: string | null } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * Resolves mission titles for the workflows behind these proofs. A failure here degrades to
 * unlabelled rows ("Untitled mission") rather than hiding the queue: the panel is read-only
 * and deep-links out, so a pending count with a missing label still beats showing nothing.
 */
async function loadMissions(supabase: SupabaseClient, rows: unknown): Promise<Map<string, CreatorCaseMission>> {
  const submissionIds = [
    ...new Set(
      asArray(rows)
        .map((row) => readString(firstRecord(firstRecord(row.mission_work_items)?.mission_workflows), "mission_submission_id"))
        .filter((id): id is string => !!id),
    ),
  ];

  const missions = new Map<string, CreatorCaseMission>();
  if (submissionIds.length === 0) return missions;

  try {
    const { data, error } = await supabase
      .from("mission_submissions")
      .select(SUBMISSION_MISSION_PROJECTION)
      .in("id", submissionIds);
    if (error) return missions;

    for (const row of asArray(data)) {
      const id = readString(row, "id");
      const mission = firstRecord(row.missions);
      if (id) missions.set(id, { title: readString(mission, "title"), slug: readString(mission, "slug") });
    }
  } catch {
    return missions;
  }

  return missions;
}

export async function getCreatorCaseProofs(
  supabase: SupabaseClient,
  creatorId: string,
): Promise<CreatorCaseEnrichment<CreatorCaseProofItem[]>> {
  try {
    const { data, error } = await supabase
      .from("mission_publication_proof_attempts")
      .select(PROOF_PROJECTION)
      .eq("submitted_by", creatorId)
      .order("submitted_at", { ascending: false });

    if (error) {
      return { status: "unavailable", reason: isNotConfigured(error) ? "not_configured" : "source_error" };
    }

    return { status: "available", value: projectCreatorCaseProofs(data, await loadMissions(supabase, data)) };
  } catch {
    // Network/transport faults degrade the panel, never the case file.
    return { status: "unavailable", reason: "source_error" };
  }
}
