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
  const [workspace, mission, creator, operator] = await Promise.all([
    svc.from("workspaces").select("id, slug").eq("id", DEMO_WS).single(),
    svc.from("missions")
      .select("id, slug")
      .eq("workspace_id", DEMO_WS)
      .eq("slug", MISSION_SLUG)
      .maybeSingle(),
    svc.from("creators")
      .select("id")
      .eq("workspace_id", DEMO_WS)
      .eq("display_name", CREATOR_EMAIL)
      .maybeSingle(),
    svc.from("staff_users").select("user_id").eq("email", OPERATOR_EMAIL).maybeSingle(),
  ]);
  for (const [context, result] of [
    ["read fixture workspace", workspace],
    ["read fixture mission", mission],
    ["read fixture creator", creator],
    ["read fixture operator", operator],
  ] as const) {
    if (result.error) failure(context, result.error);
  }
  if (!mission.data && !creator.data && !operator.data) return null;
  if (!workspace.data || !mission.data || !creator.data || !operator.data) {
    throw new Error("Publication proof fixture is partial; run `supabase db reset` before reseeding.");
  }

  const submission = await svc.from("mission_submissions")
    .select("id")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_id", mission.data.id)
    .eq("creator_id", creator.data.id)
    .maybeSingle();
  if (submission.error) failure("read fixture submission", submission.error);
  if (!submission.data) {
    throw new Error("Publication proof fixture is partial; run `supabase db reset` before reseeding.");
  }
  const workflow = await svc.from("mission_workflows")
    .select("id")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_submission_id", submission.data.id)
    .maybeSingle();
  if (workflow.error) failure("read fixture workflow", workflow.error);
  if (!workflow.data) {
    throw new Error("Publication proof fixture is partial; run `supabase db reset` before reseeding.");
  }
  const rows = await svc.from("mission_work_items")
    .select("id, title")
    .eq("workspace_id", DEMO_WS)
    .eq("mission_workflow_id", workflow.data.id);
  if (rows.error) failure("read fixture work items", rows.error);
  if ((rows.data ?? []).length !== 4) {
    throw new Error("Publication proof fixture is partial; run `supabase db reset` before reseeding.");
  }

  const [creatorSession, operatorSession, rewardBaseline, budgetBaseline] = await Promise.all([
    signInFixtureUser(CREATOR_EMAIL),
    signInFixtureUser(OPERATOR_EMAIL),
    creatorRewardSnapshot(creator.data.id),
    workspaceBudgetSnapshot(),
  ]);
  return {
    workspace: workspace.data,
    creator: { id: creatorSession.userId, email: CREATOR_EMAIL, jwt: creatorSession.jwt },
    operator: { id: operatorSession.userId, email: OPERATOR_EMAIL, jwt: operatorSession.jwt },
    mission: mission.data,
    submission: submission.data,
    workflow: workflow.data,
    items: itemMap(rows.data ?? []),
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
