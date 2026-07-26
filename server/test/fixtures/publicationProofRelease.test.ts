import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  DEMO_WS,
  serviceForTests,
} from "../helpers";
import {
  publicationProofReleaseSummary,
  seedPublicationProofReleaseFixture,
  type PublicationProofReleaseFixture,
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

    const [missionRows, creatorRows, operatorRows, membership, items, instructions, attempts] =
      await Promise.all([
        svc.from("missions").select("id").eq("slug", MISSION_SLUG),
        svc.from("creators").select("id").eq("display_name", CREATOR_EMAIL),
        svc.from("staff_users").select("user_id").eq("email", OPERATOR_EMAIL),
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
    expect(operatorRows.data).toHaveLength(1);
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
});
