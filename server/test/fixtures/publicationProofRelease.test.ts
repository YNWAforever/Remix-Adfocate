import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  serviceForTests,
} from "../helpers";
import {
  assertNoPublicationProofReleaseAuthResidue,
  assertPublicationProofReleaseInvariant,
  PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC,
  publicationProofReleaseSummary,
  seedPublicationProofReleaseFixture,
  type PublicationProofReleaseFixture,
  type PublicationProofReleaseInvariantSnapshot,
} from "./publicationProofRelease";

const CREATOR_EMAIL = "publication-proof-release-creator@test.local";
const OPERATOR_EMAIL = "publication-proof-release-operator@test.local";
const MISSION_SLUG = "test-publication-proof-release";
const ITEM_TITLES = {
  requiredMetadataSuccess: "Required evidence — metadata success",
  requiredMetadataUnavailable: "Required evidence — metadata unavailable",
  optionalEvidence: "Optional evidence",
  existingApprovedSetupRequired: "Existing approved — setup required",
} as const;
const RESET_DIAGNOSTIC =
  "Publication proof fixture is partial; run `supabase db reset` before reseeding.";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;

function fixtureShape(): PublicationProofReleaseFixture {
  return {
    workspace: { id: DEMO_WS, slug: "demo" },
    creator: { id: "creator-id", email: CREATOR_EMAIL, jwt: "creator-secret-jwt" },
    operator: { id: "operator-id", email: OPERATOR_EMAIL, jwt: "operator-secret-jwt" },
    mission: { id: "mission-id", slug: MISSION_SLUG },
    submission: { id: "submission-id" },
    workflow: { id: "workflow-id" },
    items: {
      requiredMetadataSuccess: { id: "item-required-success" },
      requiredMetadataUnavailable: { id: "item-required-unavailable" },
      optionalEvidence: { id: "item-optional" },
      existingApprovedSetupRequired: { id: "item-existing" },
    },
    rewardBaseline: {
      xp: 0,
      points: 250,
      earnings: 0,
      pointTransactions: 0,
      earningsTransactions: 0,
      budget: 0,
      budgetTransactions: 0,
    },
    budgetBaseline: { balance: 0, enforced: false, transactions: 0 },
  };
}

function invariantSnapshot(): PublicationProofReleaseInvariantSnapshot {
  const itemRows = [
    {
      id: "item-required-success",
      title: ITEM_TITLES.requiredMetadataSuccess,
      position: 0,
      required: true,
      sourceTemplateId: "template-success",
    },
    {
      id: "item-required-unavailable",
      title: ITEM_TITLES.requiredMetadataUnavailable,
      position: 1,
      required: true,
      sourceTemplateId: "template-unavailable",
    },
    {
      id: "item-optional",
      title: ITEM_TITLES.optionalEvidence,
      position: 2,
      required: false,
      sourceTemplateId: "template-optional",
    },
    {
      id: "item-existing",
      title: ITEM_TITLES.existingApprovedSetupRequired,
      position: 3,
      required: true,
      sourceTemplateId: null,
    },
  ];
  const items = itemRows.map((item, index) => ({
    ...item,
    platform: "instagram",
    state: "approved_to_publish",
    currentSubmittedVersionId: `version-${index + 1}`,
    approvedVersionId: `version-${index + 1}`,
    currentProofAttemptId: null,
    verifiedProofAttemptId: null,
  }));
  return {
    workspace: { id: DEMO_WS, slug: "demo" },
    mission: { id: "mission-id", workspaceId: DEMO_WS, slug: MISSION_SLUG },
    creator: { id: "creator-id", workspaceId: DEMO_WS, email: CREATOR_EMAIL },
    operatorStaff: { userId: "operator-id", email: OPERATOR_EMAIL, active: true },
    operatorMembership: {
      userId: "operator-id",
      workspaceId: DEMO_WS,
      email: OPERATOR_EMAIL,
      active: true,
    },
    submission: {
      id: "submission-id",
      missionId: "mission-id",
      creatorId: "creator-id",
      workspaceId: DEMO_WS,
      status: "joined",
    },
    workflow: {
      id: "workflow-id",
      submissionId: "submission-id",
      workspaceId: DEMO_WS,
      state: "approved_to_publish",
    },
    items,
    drafts: items.map((item) => ({
      workItemId: item.id,
      revision: 1,
      archivedAt: null,
    })),
    versions: items.map((item, index) => ({
      id: `version-${index + 1}`,
      workItemId: item.id,
      versionNumber: 1,
      submittedBy: "creator-id",
    })),
    reviewRounds: items.map((item, index) => ({
      workItemId: item.id,
      versionId: `version-${index + 1}`,
      state: index === 3 ? "open" : "approved_to_publish",
      reviewerId: index === 3 ? null : "operator-id",
    })),
    instructions: [
      {
        workItemId: "item-required-success",
        sourceTemplateId: "template-success",
        platform: "instagram",
        publicationInstructions: "Publish the approved post for metadata-success acceptance.",
        publicationWindowHours: 72,
        requiredDisclosures: ["#ad"],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: { required: true, metadataPath: "success" },
        publicationDueAt: "2026-08-01T00:00:00.000Z",
        frozenAt: "2026-07-27T00:00:00.000Z",
      },
      {
        workItemId: "item-required-unavailable",
        sourceTemplateId: "template-unavailable",
        platform: "instagram",
        publicationInstructions: "Publish the approved post for metadata-unavailable acceptance.",
        publicationWindowHours: 72,
        requiredDisclosures: ["#ad"],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: { required: true, metadataPath: "unavailable" },
        publicationDueAt: "2026-08-01T00:00:00.000Z",
        frozenAt: "2026-07-27T00:00:00.000Z",
      },
      {
        workItemId: "item-optional",
        sourceTemplateId: "template-optional",
        platform: "instagram",
        publicationInstructions: "Publish the optional approved post.",
        publicationWindowHours: 72,
        requiredDisclosures: [],
        expectedAccount: "@publication_proof_fixture",
        proofEvidencePolicy: {},
        publicationDueAt: "2026-08-01T00:00:00.000Z",
        frozenAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    proofAttempts: [],
    proofReviews: [],
  };
}

describe("publication proof release output", () => {
  it("summarizes only acceptance identifiers and never secrets", () => {
    const summary = publicationProofReleaseSummary(fixtureShape());
    const output = JSON.stringify(summary);

    expect(summary).toEqual({
      workspaceSlug: "demo",
      creatorEmail: CREATOR_EMAIL,
      operatorEmail: OPERATOR_EMAIL,
      missionSlug: MISSION_SLUG,
      submissionId: "submission-id",
      workflowId: "workflow-id",
      itemIds: {
        requiredMetadataSuccess: "item-required-success",
        requiredMetadataUnavailable: "item-required-unavailable",
        optionalEvidence: "item-optional",
        existingApprovedSetupRequired: "item-existing",
      },
    });
    expect(output).not.toContain("creator-secret-jwt");
    expect(output).not.toContain("operator-secret-jwt");
    expect(output).not.toMatch(/jwt|key|password|magic|signed.?url/i);
  });

  it("keeps the executable seed script on the shared secret-safe summary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/seed-publication-proof-acceptance.ts"),
      "utf8",
    );

    expect(source).toContain("seedPublicationProofReleaseFixture");
    expect(source).toContain("publicationProofReleaseSummary");
    expect(source).not.toMatch(/\.jwt|SUPABASE_(?:ANON|SERVICE)_KEY|password|magic.?link|signed.?url/i);
  });
});

describe("publication proof release auth-only residue", () => {
  it.each([
    ["creator", CREATOR_EMAIL],
    ["operator", OPERATOR_EMAIL],
  ])("rejects a stable %s auth user without fixture app rows", (_label, email) => {
    expect(() => assertNoPublicationProofReleaseAuthResidue([{ email }]))
      .toThrow(RESET_DIAGNOSTIC);
  });

  it("ignores unrelated auth users", () => {
    expect(() => assertNoPublicationProofReleaseAuthResidue([{ email: "other@test.local" }]))
      .not.toThrow();
  });
});

describe("publication proof release replay invariant", () => {
  it("returns all four stable named item IDs for a clean pre-action fixture", () => {
    expect(PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC).toBe(RESET_DIAGNOSTIC);
    expect(assertPublicationProofReleaseInvariant(invariantSnapshot())).toEqual({
      requiredMetadataSuccess: { id: "item-required-success" },
      requiredMetadataUnavailable: { id: "item-required-unavailable" },
      optionalEvidence: { id: "item-optional" },
      existingApprovedSetupRequired: { id: "item-existing" },
    });
  });

  it.each([
    ["missing named item", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.items.pop();
    }],
    ["inactive staff identity", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.operatorStaff!.active = false;
    }],
    ["inactive workspace membership", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.operatorMembership!.active = false;
    }],
    ["wrong required flag", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.items[2].required = true;
    }],
    ["missing approved version", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.items[3].approvedVersionId = null;
    }],
    ["mismatched draft revision", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.drafts[0].revision = 2;
    }],
    ["mismatched evidence policy", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.instructions[0].proofEvidencePolicy = {};
    }],
    ["missing compatibility review round", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.reviewRounds.pop();
    }],
    ["wrong compatibility review round", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.reviewRounds[3].state = "approved_to_publish";
    }],
  ])("rejects partial replay state: %s", (_label, mutate) => {
    const snapshot = invariantSnapshot();
    mutate(snapshot);
    expect(() => assertPublicationProofReleaseInvariant(snapshot))
      .toThrow(RESET_DIAGNOSTIC);
  });

  it.each([
    ["proof attempt", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.proofAttempts.push({ id: "attempt-1", workItemId: snapshot.items[0].id });
    }],
    ["proof review", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.proofReviews.push({ id: "review-1", attemptId: "attempt-1" });
    }],
    ["proof-submitted item", (snapshot: PublicationProofReleaseInvariantSnapshot) => {
      snapshot.items[0].state = "proof_submitted";
      snapshot.items[0].currentProofAttemptId = "attempt-1";
    }],
  ])("rejects post-action replay state: %s", (_label, mutate) => {
    const snapshot = invariantSnapshot();
    mutate(snapshot);
    expect(() => assertPublicationProofReleaseInvariant(snapshot))
      .toThrow(RESET_DIAGNOSTIC);
  });
});

integrationSuite("publication proof release live fixture", () => {
  it("replays safely with mixed publication paths and pre-action baselines", async () => {
    const first = await seedPublicationProofReleaseFixture();
    const fixture = await seedPublicationProofReleaseFixture();
    const svc = serviceForTests();

    expect(fixture).toMatchObject({
      workspace: { id: DEMO_WS, slug: "demo" },
      creator: { email: CREATOR_EMAIL },
      operator: { email: OPERATOR_EMAIL },
      mission: { slug: MISSION_SLUG },
    });
    expect(fixture.creator.id).toBe(first.creator.id);
    expect(fixture.operator.id).toBe(first.operator.id);
    expect(fixture.mission.id).toBe(first.mission.id);
    expect(fixture.submission.id).toBe(first.submission.id);
    expect(fixture.workflow.id).toBe(first.workflow.id);
    expect(fixture.items).toEqual(first.items);

    const [missionRows, creatorRows, operatorRows, membership, items, instructions, attempts] =
      await Promise.all([
        svc.from("missions").select("id").eq("slug", MISSION_SLUG),
        svc.from("creators").select("id").eq("display_name", CREATOR_EMAIL),
        svc.from("staff_users").select("user_id, active").eq("email", OPERATOR_EMAIL),
        svc.from("brand_users")
          .select("user_id, workspace_id, active")
          .eq("user_id", fixture.operator.id)
          .eq("workspace_id", DEMO_WS)
          .single(),
        svc.from("mission_work_items")
          .select("id, title, required, state, current_proof_attempt_id, approved_version_id")
          .eq("mission_workflow_id", fixture.workflow.id)
          .order("position"),
        svc.from("mission_publication_instructions")
          .select("mission_work_item_id, proof_evidence_policy")
          .eq("workspace_id", DEMO_WS)
          .in("mission_work_item_id", Object.values(fixture.items).map(({ id }) => id)),
        svc.from("mission_publication_proof_attempts")
          .select("id, mission_work_item_id, metadata_status")
          .eq("workspace_id", DEMO_WS)
          .in("mission_work_item_id", Object.values(fixture.items).map(({ id }) => id)),
      ]);

    for (const result of [
      missionRows,
      creatorRows,
      operatorRows,
      membership,
      items,
      instructions,
      attempts,
    ]) {
      expect(result.error).toBeNull();
    }
    expect(missionRows.data).toHaveLength(1);
    expect(creatorRows.data).toHaveLength(1);
    expect(operatorRows.data).toEqual([{ user_id: fixture.operator.id, active: true }]);
    expect(membership.data).toEqual({
      user_id: fixture.operator.id,
      workspace_id: DEMO_WS,
      active: true,
    });

    const itemsByTitle = new Map((items.data ?? []).map((item) => [item.title, item]));
    expect(itemsByTitle.get(ITEM_TITLES.requiredMetadataSuccess)).toMatchObject({
      id: fixture.items.requiredMetadataSuccess.id,
      required: true,
      state: "approved_to_publish",
    });
    expect(itemsByTitle.get(ITEM_TITLES.requiredMetadataUnavailable)).toMatchObject({
      id: fixture.items.requiredMetadataUnavailable.id,
      required: true,
      state: "approved_to_publish",
    });
    expect(itemsByTitle.get(ITEM_TITLES.optionalEvidence)).toMatchObject({
      id: fixture.items.optionalEvidence.id,
      required: false,
      state: "approved_to_publish",
    });
    expect(itemsByTitle.get(ITEM_TITLES.existingApprovedSetupRequired)).toMatchObject({
      id: fixture.items.existingApprovedSetupRequired.id,
      required: true,
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      approved_version_id: expect.any(String),
    });

    const instructionsByItem = new Map(
      (instructions.data ?? []).map((instruction) => [
        instruction.mission_work_item_id,
        instruction,
      ]),
    );
    expect(instructionsByItem.get(fixture.items.requiredMetadataSuccess.id)?.proof_evidence_policy)
      .toMatchObject({ required: true, metadataPath: "success" });
    expect(instructionsByItem.get(fixture.items.requiredMetadataUnavailable.id)?.proof_evidence_policy)
      .toMatchObject({ required: true, metadataPath: "unavailable" });
    expect(instructionsByItem.get(fixture.items.optionalEvidence.id)?.proof_evidence_policy).toEqual({});
    expect(instructionsByItem.has(fixture.items.existingApprovedSetupRequired.id)).toBe(false);
    expect(attempts.data).toEqual([]);

    expect(fixture.rewardBaseline).toEqual(
      await creatorRewardSnapshot(fixture.creator.id),
    );
    expect(fixture.budgetBaseline).toMatchObject({
      balance: fixture.rewardBaseline.budget,
      transactions: fixture.rewardBaseline.budgetTransactions,
    });
  });

  it("survives the shared integration cleanup ownership sweep", async () => {
    const first = await seedPublicationProofReleaseFixture();

    await cleanup();

    const replay = await seedPublicationProofReleaseFixture();
    expect(replay).toMatchObject({
      creator: { id: first.creator.id },
      operator: { id: first.operator.id },
      mission: { id: first.mission.id },
      workflow: { id: first.workflow.id },
    });
  });
});
