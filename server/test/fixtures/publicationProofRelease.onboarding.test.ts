import { describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  serviceForTests,
} from "../helpers";
import {
  PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC,
  seedPublicationProofReleaseFixture,
} from "./publicationProofRelease";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;

integrationSuite("publication proof release browser readiness", () => {
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

    const madeIncomplete = await svc.from("creators")
      .update({ onboarding_completed: false })
      .eq("id", fixture.creator.id);
    expect(madeIncomplete.error).toBeNull();
    try {
      await expect(seedPublicationProofReleaseFixture())
        .rejects.toThrow(PUBLICATION_PROOF_RELEASE_RESET_DIAGNOSTIC);
    } finally {
      const restored = await svc.from("creators")
        .update({ onboarding_completed: true })
        .eq("id", fixture.creator.id);
      expect(restored.error).toBeNull();
    }

    expect(await creatorRewardSnapshot(fixture.creator.id)).toEqual(baseline);
  });
});
