import { randomUUID } from "node:crypto";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  DEMO_WS,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "../helpers";

const CREATOR_EMAIL = "publication-proof-release-creator@test.local";
const OPERATOR_EMAIL = "publication-proof-release-operator@test.local";
const MISSION_SLUG = "test-publication-proof-release";

const ITEM_TITLES = {
  requiredMetadataSuccess: "Required evidence — metadata success",
  requiredMetadataUnavailable: "Required evidence — metadata unavailable",
  optionalEvidence: "Optional evidence",
  existingApprovedSetupRequired: "Existing approved — setup required",
} as const;

type FixtureItemName = keyof typeof ITEM_TITLES;
type FixtureItem = { id: string };

export type PublicationProofReleaseFixture = {
  workspace: { id: string; slug: string };
  creator: { id: string; email: string; jwt: string };
  operator: { id: string; email: string; jwt: string };
  mission: { id: string; slug: string };
  submission: { id: string };
  workflow: { id: string };
  items: {
    requiredMetadataSuccess: FixtureItem;
    requiredMetadataUnavailable: FixtureItem;
    optionalEvidence: FixtureItem;
    existingApprovedSetupRequired: FixtureItem;
  };
  rewardBaseline: Awaited<ReturnType<typeof creatorRewardSnapshot>>;
  budgetBaseline: Record<string, unknown>;
};

export const PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC =
  "Publication proof fixture is partial; run `supabase db reset` before reseeding.";

export type PublicationProofReleaseInvariantSnapshot = {
  workspace: { id: string; slug: string } | null;
  mission: { id: string; workspaceId: string; slug: string } | null;
  creator: { id: string; workspaceId: string; email: string } | null;
  operatorStaff: { userId: string; email: string; active: boolean } | null;
  operatorMembership: {
    userId: string;
    workspaceId: string;
    email: string;
    active: boolean;
  } | null;
  submission: {
    id: string;
    missionId: string;
    creatorId: string;
    workspaceId: string;
    status: string;
  } | null;
  workflow: {
    id: string;
    submissionId: string;
    workspaceId: string;
    state: string;
  } | null;
  items: Array<{
    id: string;
    title: string;
    platform: string;
    position: number;
    required: boolean;
    sourceTemplateId: string | null;
    state: string;
    currentSubmittedVersionId: string | null;
    approvedVersionId: string | null;
    currentProofAttemptId: string | null;
    verifiedProofAttemptId: string | null;
  }>;
  drafts: Array<{
    workItemId: string;
    revision: number;
    archivedAt: string | null;
  }>;
  versions: Array<{
    id: string;
    workItemId: string;
    versionNumber: number;
    submittedBy: string;
  }>;
  reviewRounds: Array<{
    workItemId: string;
    versionId: string;
    state: string;
    reviewerId: string | null;
  }>;
  instructions: Array<{
    workItemId: string;
    sourceTemplateId: string | null;
    platform: string;
    publicationInstructions: string;
    publicationWindowHours: number;
    requiredDisclosures: unknown;
    expectedAccount: string | null;
    proofEvidencePolicy: unknown;
    publicationDueAt: string | null;
    frozenAt: string | null;
  }>;
  proofAttempts: Array<{ id: string; workItemId: string }>;
  proofReviews: Array<{ id: string; attemptId: string }>;
};

const EXPECTED_ITEM_INVARIANTS = {
  requiredMetadataSuccess: {
    title: ITEM_TITLES.requiredMetadataSuccess,
    position: 0,
    required: true,
    instructions: "Publish the approved post for metadata-success acceptance.",
    disclosures: ["#ad"],
    policy: { required: true, metadataPath: "success" },
  },
  requiredMetadataUnavailable: {
    title: ITEM_TITLES.requiredMetadataUnavailable,
    position: 1,
    required: true,
    instructions: "Publish the approved post for metadata-unavailable acceptance.",
    disclosures: ["#ad"],
    policy: { required: true, metadataPath: "unavailable" },
  },
  optionalEvidence: {
    title: ITEM_TITLES.optionalEvidence,
    position: 2,
    required: false,
    instructions: "Publish the optional approved post.",
    disclosures: [],
    policy: {},
  },
  existingApprovedSetupRequired: {
    title: ITEM_TITLES.existingApprovedSetupRequired,
    position: 3,
    required: true,
    instructions: null,
    disclosures: null,
    policy: null,
  },
} as const;

function resetFixture(): never {
  throw new Error(PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertPublicationProofReleaseInvariant(
  snapshot: PublicationProofReleaseInvariantSnapshot,
): Record<FixtureItemName, FixtureItem> {
  const {
    workspace,
    mission,
    creator,
    operatorStaff,
    operatorMembership,
    submission,
    workflow,
  } = snapshot;
  if (
    workspace?.id !== DEMO_WS
    || workspace.slug !== "demo"
    || mission?.workspaceId !== DEMO_WS
    || mission.slug !== MISSION_SLUG
    || !nonBlank(mission.id)
    || creator?.workspaceId !== DEMO_WS
    || creator.email !== CREATOR_EMAIL
    || !nonBlank(creator.id)
    || operatorStaff?.email !== OPERATOR_EMAIL
    || operatorStaff.active !== true
    || !nonBlank(operatorStaff.userId)
    || operatorMembership?.userId !== operatorStaff.userId
    || operatorMembership.workspaceId !== DEMO_WS
    || operatorMembership.email !== OPERATOR_EMAIL
    || operatorMembership.active !== true
    || submission?.missionId !== mission.id
    || submission.creatorId !== creator.id
    || submission.workspaceId !== DEMO_WS
    || submission.status !== "joined"
    || !nonBlank(submission.id)
    || workflow?.submissionId !== submission.id
    || workflow.workspaceId !== DEMO_WS
    || workflow.state !== "approved_to_publish"
    || !nonBlank(workflow.id)
  ) {
    resetFixture();
  }

  if (
    snapshot.items.length !== 4
    || new Set(snapshot.items.map((item) => item.id)).size !== 4
    || snapshot.proofAttempts.length !== 0
    || snapshot.proofReviews.length !== 0
  ) {
    resetFixture();
  }

  const itemsByTitle = new Map(snapshot.items.map((item) => [item.title, item]));
  const draftsByItem = new Map(snapshot.drafts.map((draft) => [draft.workItemId, draft]));
  const versionsByItem = new Map(snapshot.versions.map((version) => [version.workItemId, version]));
  const roundsByItem = new Map(snapshot.reviewRounds.map((round) => [round.workItemId, round]));
  const instructionsByItem = new Map(
    snapshot.instructions.map((instruction) => [instruction.workItemId, instruction]),
  );
  if (
    itemsByTitle.size !== 4
    || draftsByItem.size !== 4
    || snapshot.drafts.length !== 4
    || versionsByItem.size !== 4
    || snapshot.versions.length !== 4
    || roundsByItem.size !== 3
    || snapshot.reviewRounds.length !== 3
    || instructionsByItem.size !== 3
    || snapshot.instructions.length !== 3
  ) {
    resetFixture();
  }

  const resolved = {} as Record<FixtureItemName, FixtureItem>;
  for (const [name, expected] of Object.entries(EXPECTED_ITEM_INVARIANTS) as Array<
    [FixtureItemName, (typeof EXPECTED_ITEM_INVARIANTS)[FixtureItemName]]
  >) {
    const item = itemsByTitle.get(expected.title);
    if (
      !item
      || !nonBlank(item.id)
      || item.platform !== "instagram"
      || item.position !== expected.position
      || item.required !== expected.required
      || item.state !== "approved_to_publish"
      || !nonBlank(item.approvedVersionId)
      || item.currentSubmittedVersionId !== item.approvedVersionId
      || item.currentProofAttemptId !== null
      || item.verifiedProofAttemptId !== null
    ) {
      resetFixture();
    }
    const isCompatibilityItem = name === "existingApprovedSetupRequired";
    if (
      (isCompatibilityItem && item.sourceTemplateId !== null)
      || (!isCompatibilityItem && !nonBlank(item.sourceTemplateId))
    ) {
      resetFixture();
    }

    const draft = draftsByItem.get(item.id);
    const version = versionsByItem.get(item.id);
    if (
      !draft
      || draft.revision !== 1
      || draft.archivedAt !== null
      || !version
      || version.id !== item.approvedVersionId
      || version.versionNumber !== 1
      || version.submittedBy !== creator.id
    ) {
      resetFixture();
    }

    const round = roundsByItem.get(item.id);
    if (isCompatibilityItem) {
      if (round || instructionsByItem.has(item.id)) resetFixture();
    } else {
      if (
        !round
        || round.versionId !== version.id
        || round.state !== "approved_to_publish"
        || round.reviewerId !== operatorStaff.userId
      ) {
        resetFixture();
      }
      const instruction = instructionsByItem.get(item.id);
      if (
        !instruction
        || instruction.sourceTemplateId !== item.sourceTemplateId
        || instruction.platform !== "instagram"
        || instruction.publicationInstructions !== expected.instructions
        || instruction.publicationWindowHours !== 72
        || instruction.expectedAccount !== "@publication_proof_fixture"
        || canonicalJson(instruction.requiredDisclosures) !== canonicalJson(expected.disclosures)
        || canonicalJson(instruction.proofEvidencePolicy) !== canonicalJson(expected.policy)
        || !nonBlank(instruction.publicationDueAt)
        || !nonBlank(instruction.frozenAt)
      ) {
        resetFixture();
      }
    }
    resolved[name] = { id: item.id };
  }
  return resolved;
}
export function publicationProofReleaseSummary(fixture: PublicationProofReleaseFixture) {
  return {
    workspaceSlug: fixture.workspace.slug,
    creatorEmail: fixture.creator.email,
    operatorEmail: fixture.operator.email,
    missionSlug: fixture.mission.slug,
    submissionId: fixture.submission.id,
    workflowId: fixture.workflow.id,
    itemIds: {
      requiredMetadataSuccess: fixture.items.requiredMetadataSuccess.id,
      requiredMetadataUnavailable: fixture.items.requiredMetadataUnavailable.id,
      optionalEvidence: fixture.items.optionalEvidence.id,
      existingApprovedSetupRequired: fixture.items.existingApprovedSetupRequired.id,
    },
  };
}

function failure(context: string, error: { message?: string | null } | null): never {
  throw new Error(`${context}: ${error?.message ?? "missing data"}`);
}

async function signInFixtureUser(email: string) {
  const { data, error } = await userForJwt("").auth.signInWithPassword({
    email,
    password: "test-pw-123456",
  });
  if (error) throw error;
  return { userId: data.user!.id, jwt: data.session!.access_token };
}

async function workspaceBudgetSnapshot() {
  const svc = serviceForTests();
  const [budget, transactions] = await Promise.all([
    svc.from("workspace_budgets")
      .select("balance, enforced")
      .eq("workspace_id", DEMO_WS)
      .maybeSingle(),
    svc.from("workspace_budget_transactions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", DEMO_WS),
  ]);
  if (budget.error) failure("read publication proof fixture budget", budget.error);
  if (transactions.error) {
    failure("read publication proof fixture budget transactions", transactions.error);
  }
  return {
    balance: budget.data?.balance ?? null,
    enforced: budget.data?.enforced ?? false,
    transactions: transactions.count ?? 0,
  };
}

async function approveGeneratedItem(input: {
  submissionId: string;
  creatorId: string;
  workflowId: string;
  workItemId: string;
  operatorId: string;
  title: string;
}) {
  const svc = serviceForTests();
  const saved = await svc.rpc("save_active_mission_draft", {
    p_submission: input.submissionId,
    p_creator: input.creatorId,
    p_workspace: DEMO_WS,
    p_work_item: input.workItemId,
    p_expected_revision: 0,
    p_patch: { caption: `Approved acceptance copy for ${input.title}` },
  });
  if (saved.error) failure("save publication proof fixture draft", saved.error);

  const submitted = await svc.rpc("submit_active_mission_draft", {
    p_submission: input.submissionId,
    p_creator: input.creatorId,
    p_workspace: DEMO_WS,
    p_work_item: input.workItemId,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  if (submitted.error) failure("submit publication proof fixture draft", submitted.error);

  const started = await svc.rpc("start_mission_review", {
    p_workflow: input.workflowId,
    p_work_item: input.workItemId,
    p_operator: input.operatorId,
    p_workspace: DEMO_WS,
    p_expected_state: "submitted",
  });
  if (started.error) failure("start publication proof fixture review", started.error);

  const versionId = submitted.data?.version?.id as string | undefined;
  if (!versionId) failure("resolve publication proof fixture version", null);
  const approved = await svc.rpc("approve_mission_version", {
    p_workflow: input.workflowId,
    p_work_item: input.workItemId,
    p_version: versionId,
    p_operator: input.operatorId,
    p_workspace: DEMO_WS,
    p_expected_state: "under_review",
  });
  if (approved.error) failure("approve publication proof fixture version", approved.error);
}

function itemMap(rows: Array<{ id: string; title: string }>): Record<FixtureItemName, FixtureItem> {
  const byTitle = new Map(rows.map((row) => [row.title, row.id]));
  const item = (name: FixtureItemName) => {
    const id = byTitle.get(ITEM_TITLES[name]);
    if (!id) failure(`resolve publication proof fixture item ${name}`, null);
    return { id };
  };
  return {
    requiredMetadataSuccess: item("requiredMetadataSuccess"),
    requiredMetadataUnavailable: item("requiredMetadataUnavailable"),
    optionalEvidence: item("optionalEvidence"),
    existingApprovedSetupRequired: item("existingApprovedSetupRequired"),
  };
}

async function assembleExistingFixture(): Promise<PublicationProofReleaseFixture | null> {
  const svc = serviceForTests();
  const [workspace, mission, creator, operatorStaff, operatorMembership] = await Promise.all([
    svc.from("workspaces").select("id, slug").eq("id", DEMO_WS).single(),
    svc.from("missions")
      .select("id, workspace_id, slug")
      .eq("workspace_id", DEMO_WS)
      .eq("slug", MISSION_SLUG)
      .maybeSingle(),
    svc.from("creators")
      .select("id, workspace_id, display_name")
      .eq("workspace_id", DEMO_WS)
      .eq("display_name", CREATOR_EMAIL)
      .maybeSingle(),
    svc.from("staff_users")
      .select("user_id, email, active")
      .eq("email", OPERATOR_EMAIL)
      .maybeSingle(),
    svc.from("brand_users")
      .select("user_id, workspace_id, email, active")
      .eq("workspace_id", DEMO_WS)
      .eq("email", OPERATOR_EMAIL)
      .maybeSingle(),
  ]);
  for (const [context, result] of [
    ["read fixture workspace", workspace],
    ["read fixture mission", mission],
    ["read fixture creator", creator],
    ["read fixture operator staff", operatorStaff],
    ["read fixture operator membership", operatorMembership],
  ] as const) {
    if (result.error) failure(context, result.error);
  }
  if (
    !mission.data
    && !creator.data
    && !operatorStaff.data
    && !operatorMembership.data
  ) {
    return null;
  }
  if (
    !workspace.data
    || !mission.data
    || !creator.data
    || !operatorStaff.data
    || !operatorMembership.data
  ) {
    resetFixture();
  }

  const submission = await svc.from("mission_submissions")
    .select("id, mission_id, creator_id, workspace_id, status")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_id", mission.data.id)
    .eq("creator_id", creator.data.id)
    .maybeSingle();
  if (submission.error) failure("read fixture submission", submission.error);
  if (!submission.data) resetFixture();
  const workflow = await svc.from("mission_workflows")
    .select("id, mission_submission_id, workspace_id, state")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_submission_id", submission.data.id)
    .maybeSingle();
  if (workflow.error) failure("read fixture workflow", workflow.error);
  if (!workflow.data) resetFixture();

  const [items, drafts, versions, reviewRounds, instructions, proofAttempts] =
    await Promise.all([
      svc.from("mission_work_items")
        .select("id, title, platform, position, required, source_template_id, state, current_submitted_version_id, approved_version_id, current_proof_attempt_id, verified_proof_attempt_id")
        .eq("workspace_id", DEMO_WS)
        .eq("mission_workflow_id", workflow.data.id),
      svc.from("mission_working_drafts")
        .select("mission_work_item_id, revision, archived_at")
        .eq("workspace_id", DEMO_WS),
      svc.from("mission_draft_versions")
        .select("id, mission_work_item_id, version_number, submitted_by")
        .eq("workspace_id", DEMO_WS),
      svc.from("mission_review_rounds")
        .select("mission_work_item_id, mission_draft_version_id, state, reviewer_id")
        .eq("workspace_id", DEMO_WS),
      svc.from("mission_publication_instructions")
        .select("mission_work_item_id, source_template_id, platform, publication_instructions, publication_window_hours, required_disclosures, expected_account, proof_evidence_policy, publication_due_at, frozen_at")
        .eq("workspace_id", DEMO_WS),
      svc.from("mission_publication_proof_attempts")
        .select("id, mission_work_item_id")
        .eq("workspace_id", DEMO_WS),
    ]);
  for (const [context, result] of [
    ["read fixture work items", items],
    ["read fixture drafts", drafts],
    ["read fixture versions", versions],
    ["read fixture review rounds", reviewRounds],
    ["read fixture instructions", instructions],
    ["read fixture proof attempts", proofAttempts],
  ] as const) {
    if (result.error) failure(context, result.error);
  }

  const itemIds = new Set((items.data ?? []).map((item) => item.id as string));
  const fixtureDrafts = (drafts.data ?? []).filter((draft) =>
    itemIds.has(draft.mission_work_item_id as string));
  const fixtureVersions = (versions.data ?? []).filter((version) =>
    itemIds.has(version.mission_work_item_id as string));
  const fixtureRounds = (reviewRounds.data ?? []).filter((round) =>
    itemIds.has(round.mission_work_item_id as string));
  const fixtureInstructions = (instructions.data ?? []).filter((instruction) =>
    itemIds.has(instruction.mission_work_item_id as string));
  const fixtureAttempts = (proofAttempts.data ?? []).filter((attempt) =>
    itemIds.has(attempt.mission_work_item_id as string));
  let fixtureReviews: Array<{ id: string; mission_publication_proof_attempt_id: string }> = [];
  if (fixtureAttempts.length) {
    const proofReviews = await svc.from("mission_publication_proof_reviews")
      .select("id, mission_publication_proof_attempt_id")
      .eq("workspace_id", DEMO_WS)
      .in("mission_publication_proof_attempt_id", fixtureAttempts.map((attempt) => attempt.id));
    if (proofReviews.error) failure("read fixture proof reviews", proofReviews.error);
    fixtureReviews = proofReviews.data ?? [];
  }

  const invariant: PublicationProofReleaseInvariantSnapshot = {
    workspace: workspace.data,
    mission: {
      id: mission.data.id,
      workspaceId: mission.data.workspace_id,
      slug: mission.data.slug,
    },
    creator: {
      id: creator.data.id,
      workspaceId: creator.data.workspace_id,
      email: creator.data.display_name,
    },
    operatorStaff: {
      userId: operatorStaff.data.user_id,
      email: operatorStaff.data.email,
      active: operatorStaff.data.active,
    },
    operatorMembership: {
      userId: operatorMembership.data.user_id,
      workspaceId: operatorMembership.data.workspace_id,
      email: operatorMembership.data.email,
      active: operatorMembership.data.active,
    },
    submission: {
      id: submission.data.id,
      missionId: submission.data.mission_id,
      creatorId: submission.data.creator_id,
      workspaceId: submission.data.workspace_id,
      status: submission.data.status,
    },
    workflow: {
      id: workflow.data.id,
      submissionId: workflow.data.mission_submission_id,
      workspaceId: workflow.data.workspace_id,
      state: workflow.data.state,
    },
    items: (items.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      platform: item.platform,
      position: item.position,
      required: item.required,
      sourceTemplateId: item.source_template_id,
      state: item.state,
      currentSubmittedVersionId: item.current_submitted_version_id,
      approvedVersionId: item.approved_version_id,
      currentProofAttemptId: item.current_proof_attempt_id,
      verifiedProofAttemptId: item.verified_proof_attempt_id,
    })),
    drafts: fixtureDrafts.map((draft) => ({
      workItemId: draft.mission_work_item_id,
      revision: draft.revision,
      archivedAt: draft.archived_at,
    })),
    versions: fixtureVersions.map((version) => ({
      id: version.id,
      workItemId: version.mission_work_item_id,
      versionNumber: version.version_number,
      submittedBy: version.submitted_by,
    })),
    reviewRounds: fixtureRounds.map((round) => ({
      workItemId: round.mission_work_item_id,
      versionId: round.mission_draft_version_id,
      state: round.state,
      reviewerId: round.reviewer_id,
    })),
    instructions: fixtureInstructions.map((instruction) => ({
      workItemId: instruction.mission_work_item_id,
      sourceTemplateId: instruction.source_template_id,
      platform: instruction.platform,
      publicationInstructions: instruction.publication_instructions,
      publicationWindowHours: instruction.publication_window_hours,
      requiredDisclosures: instruction.required_disclosures,
      expectedAccount: instruction.expected_account,
      proofEvidencePolicy: instruction.proof_evidence_policy,
      publicationDueAt: instruction.publication_due_at,
      frozenAt: instruction.frozen_at,
    })),
    proofAttempts: fixtureAttempts.map((attempt) => ({
      id: attempt.id,
      workItemId: attempt.mission_work_item_id,
    })),
    proofReviews: fixtureReviews.map((review) => ({
      id: review.id,
      attemptId: review.mission_publication_proof_attempt_id,
    })),
  };
  const resolvedItems = assertPublicationProofReleaseInvariant(invariant);

  const [creatorSession, operatorSession] = await Promise.all([
    signInFixtureUser(CREATOR_EMAIL),
    signInFixtureUser(OPERATOR_EMAIL),
  ]);
  if (
    creatorSession.userId !== creator.data.id
    || operatorSession.userId !== operatorStaff.data.user_id
  ) {
    resetFixture();
  }
  const [rewardBaseline, budgetBaseline] = await Promise.all([
    creatorRewardSnapshot(creator.data.id),
    workspaceBudgetSnapshot(),
  ]);
  return {
    workspace: workspace.data,
    creator: { id: creatorSession.userId, email: CREATOR_EMAIL, jwt: creatorSession.jwt },
    operator: { id: operatorSession.userId, email: OPERATOR_EMAIL, jwt: operatorSession.jwt },
    mission: { id: mission.data.id, slug: mission.data.slug },
    submission: { id: submission.data.id },
    workflow: { id: workflow.data.id },
    items: resolvedItems,
    rewardBaseline,
    budgetBaseline,
  };
}

export async function seedPublicationProofReleaseFixture():
  Promise<PublicationProofReleaseFixture> {
  const skipReason = activeMissionIntegrationSkipReason();
  if (skipReason) {
    throw new Error(`Publication proof acceptance seed is local-only: ${skipReason}`);
  }

  const existing = await assembleExistingFixture();
  if (existing) return existing;

  const operator = await makeStaff(OPERATOR_EMAIL);
  const svc = serviceForTests();
  const membership = await svc.from("brand_users").upsert({
    user_id: operator.userId,
    workspace_id: DEMO_WS,
    email: OPERATOR_EMAIL,
    role: "member",
    active: true,
  }, { onConflict: "user_id,workspace_id" });
  if (membership.error) failure("link publication proof fixture operator", membership.error);

  const active = await seedActiveMission({
    email: CREATOR_EMAIL,
    slug: MISSION_SLUG,
    deliverables: [
      {
        title: ITEM_TITLES.requiredMetadataSuccess,
        platform: "instagram",
        required: true,
        publicationInstructions: "Publish the approved post for metadata-success acceptance.",
        publicationWindowHours: 72,
        requiredDisclosures: ["#ad"],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: { required: true, metadataPath: "success" },
      },
      {
        title: ITEM_TITLES.requiredMetadataUnavailable,
        platform: "instagram",
        required: true,
        publicationInstructions: "Publish the approved post for metadata-unavailable acceptance.",
        publicationWindowHours: 72,
        requiredDisclosures: ["#ad"],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: { required: true, metadataPath: "unavailable" },
      },
      {
        title: ITEM_TITLES.optionalEvidence,
        platform: "instagram",
        required: false,
        publicationInstructions: "Publish the optional approved post.",
        publicationWindowHours: 72,
        requiredDisclosures: [],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: {},
      },
    ],
  });
  const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
    p_submission: active.submission.id,
  });
  if (created.error) failure("create publication proof fixture workflow", created.error);
  const workflowId = created.data?.id as string | undefined;
  if (!workflowId) failure("resolve publication proof fixture workflow", null);

  const generatedItems = await svc.from("mission_work_items")
    .select("id, title")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_workflow_id", workflowId)
    .order("position");
  if (generatedItems.error) {
    failure("read publication proof fixture work items", generatedItems.error);
  }
  if ((generatedItems.data ?? []).length !== 3) {
    failure("resolve generated publication proof fixture work items", null);
  }

  const legacyItem = await svc.from("mission_work_items").insert({
    workspace_id: DEMO_WS,
    mission_workflow_id: workflowId,
    source_template_id: null,
    title: ITEM_TITLES.existingApprovedSetupRequired,
    platform: "instagram",
    requirements_snapshot: [],
    required: true,
    position: 3,
    deadline: null,
    state: "drafting",
  }).select("id, title").single();
  if (legacyItem.error) failure("create existing-approved fixture work item", legacyItem.error);
  const legacyDraft = await svc.from("mission_working_drafts").insert({
    workspace_id: DEMO_WS,
    mission_work_item_id: legacyItem.data.id,
  });
  if (legacyDraft.error) failure("create existing-approved fixture draft", legacyDraft.error);

  for (const item of generatedItems.data ?? []) {
    await approveGeneratedItem({
      submissionId: active.submission.id,
      creatorId: active.creator.id,
      workflowId,
      workItemId: item.id,
      operatorId: operator.userId,
      title: item.title,
    });
  }

  const legacySaved = await svc.rpc("save_active_mission_draft", {
    p_submission: active.submission.id,
    p_creator: active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: legacyItem.data.id,
    p_expected_revision: 0,
    p_patch: { caption: "Approved legacy acceptance copy" },
  });
  if (legacySaved.error) failure("save existing-approved fixture draft", legacySaved.error);
  const legacySubmitted = await svc.rpc("submit_active_mission_draft", {
    p_submission: active.submission.id,
    p_creator: active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: legacyItem.data.id,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  if (legacySubmitted.error) {
    failure("submit existing-approved fixture draft", legacySubmitted.error);
  }
  const legacyVersionId = legacySubmitted.data?.version?.id as string | undefined;
  if (!legacyVersionId) failure("resolve existing-approved fixture version", null);
  const legacyApproved = await svc.from("mission_work_items").update({
    state: "approved_to_publish",
    current_submitted_version_id: legacyVersionId,
    approved_version_id: legacyVersionId,
    review_started_at: null,
    review_due_at: null,
  }).eq("id", legacyItem.data.id).eq("workspace_id", DEMO_WS);
  if (legacyApproved.error) failure("mark existing-approved fixture item", legacyApproved.error);
  const refreshed = await svc.rpc("refresh_mission_workflow_state", { p_workflow: workflowId });
  if (refreshed.error) failure("refresh publication proof fixture workflow", refreshed.error);

  const workspace = await svc.from("workspaces").select("id, slug").eq("id", DEMO_WS).single();
  if (workspace.error || !workspace.data) {
    failure("resolve publication proof fixture workspace", workspace.error);
  }
  const allItems = [...(generatedItems.data ?? []), legacyItem.data];
  const [rewardBaseline, budgetBaseline] = await Promise.all([
    creatorRewardSnapshot(active.creator.id),
    workspaceBudgetSnapshot(),
  ]);
  return {
    workspace: workspace.data,
    creator: { id: active.creator.id, email: CREATOR_EMAIL, jwt: active.creator.jwt },
    operator: { id: operator.userId, email: OPERATOR_EMAIL, jwt: operator.jwt },
    mission: { id: active.mission.id, slug: active.mission.slug },
    submission: { id: active.submission.id },
    workflow: { id: workflowId },
    items: itemMap(allItems),
    rewardBaseline,
    budgetBaseline,
  };
}
