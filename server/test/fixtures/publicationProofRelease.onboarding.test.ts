import { describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  DEMO_WS,
  creatorRewardSnapshot,
  serviceForTests,
} from "../helpers";
import {
  PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC,
  seedPublicationProofReleaseFixture,
} from "./publicationProofRelease";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const CREATOR_EMAIL = "publication-proof-release-creator@test.local";

async function workspaceRewardState() {
  const svc = serviceForTests();
  const [gifts, budget, budgetTransactions] = await Promise.all([
    svc.from("redemption_gifts")
      .select("stock_qty, stock_remaining")
      .eq("workspace_id", DEMO_WS),
    svc.from("workspace_budgets")
      .select("balance, enforced")
      .eq("workspace_id", DEMO_WS)
      .maybeSingle(),
    svc.from("workspace_budget_transactions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", DEMO_WS),
  ]);
  for (const result of [gifts, budget, budgetTransactions]) {
    if (result.error) throw result.error;
  }
  return {
    rewardCatalogCount: gifts.data?.length ?? 0,
    rewardCatalogInventory: {
      total: (gifts.data ?? []).reduce((sum, gift) => sum + gift.stock_qty, 0),
      remaining: (gifts.data ?? []).reduce((sum, gift) => sum + gift.stock_remaining, 0),
    },
    budget: {
      balance: budget.data?.balance ?? null,
      enforced: budget.data?.enforced ?? false,
      transactions: budgetTransactions.count ?? 0,
    },
  };
}

integrationSuite("publication proof release browser readiness", () => {

  it("fresh seed preserves workspace reward state and starts at the exact creator baseline", async () => {
    const svc = serviceForTests();
    const existingCreator = await svc.from("creators")
      .select("id", { count: "exact", head: true })
      .eq("display_name", CREATOR_EMAIL);
    expect(existingCreator.error).toBeNull();
    expect(existingCreator.count).toBe(0);
    const before = await workspaceRewardState();

    const fixture = await seedPublicationProofReleaseFixture();
    const baseline = await creatorRewardSnapshot(fixture.creator.id);

    expect(await workspaceRewardState()).toEqual(before);
    expect(baseline).toEqual({
      xp: 0,
      points: 250,
      earnings: 0,
      pointTransactions: 0,
      earningsTransactions: 0,
      redemptions: 0,
      rewardCatalogCount: before.rewardCatalogCount,
      rewardCatalogInventory: before.rewardCatalogInventory,
      budget: before.budget.balance,
      budgetTransactions: before.budget.transactions,
    });
    expect(fixture.rewardBaseline).toEqual(baseline);
  });

  it("replays with completed onboarding without changing rewards", async () => {
    const fixture = await seedPublicationProofReleaseFixture();
    const svc = serviceForTests();
    const baseline = await creatorRewardSnapshot(fixture.creator.id);

    const creator = await svc.from("creators")
      .select("onboarding_completed, onboarding_step")
      .eq("id", fixture.creator.id)
      .single();
    expect(creator.error).toBeNull();
    expect(creator.data).toEqual({
      onboarding_completed: true,
      onboarding_step: 5,
    });

    const replay = await seedPublicationProofReleaseFixture();
    expect(replay.creator.id).toBe(fixture.creator.id);
    expect(await creatorRewardSnapshot(fixture.creator.id)).toEqual(baseline);
    expect(baseline).toEqual(fixture.rewardBaseline);

    const madeWrongStep = await svc.from("creators")
      .update({ onboarding_completed: true, onboarding_step: 4 })
      .eq("id", fixture.creator.id);
    expect(madeWrongStep.error).toBeNull();
    try {
      await expect(seedPublicationProofReleaseFixture())
        .rejects.toThrow(PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC);
    } finally {
      const restored = await svc.from("creators")
        .update({ onboarding_completed: true, onboarding_step: 5 })
        .eq("id", fixture.creator.id);
      expect(restored.error).toBeNull();
    }

    const madeIncomplete = await svc.from("creators")
      .update({ onboarding_completed: false, onboarding_step: 5 })
      .eq("id", fixture.creator.id);
    expect(madeIncomplete.error).toBeNull();
    try {
      await expect(seedPublicationProofReleaseFixture())
        .rejects.toThrow(PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC);
    } finally {
      const restored = await svc.from("creators")
        .update({ onboarding_completed: true, onboarding_step: 5 })
        .eq("id", fixture.creator.id);
      expect(restored.error).toBeNull();
    }

    expect(await creatorRewardSnapshot(fixture.creator.id)).toEqual(baseline);
  });
});
