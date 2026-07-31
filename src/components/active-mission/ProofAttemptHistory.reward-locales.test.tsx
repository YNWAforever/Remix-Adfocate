import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { MissionPublicationView, PublicationProofAttemptView } from "@/lib/activeMission";
import { I18nProvider } from "@/lib/i18n";
import { ProofAttemptHistory } from "./ProofAttemptHistory";

const attempt: PublicationProofAttemptView = {
  id: "locale-attempt", attemptNumber: 1,
  primaryUrl: "https://www.instagram.com/p/final", additionalUrls: [],
  submittedAt: "2026-07-27T08:00:00.000Z", submittedLate: false,
  metadataStatus: "available", metadataSnapshot: { pageTitle: "Launch reel" }, metadataErrorCategory: null,
  evidence: [], corrections: [],
  review: {
    id: "locale-review", state: "verified", decision: "verified",
    reviewedAt: "2026-07-27T10:00:00.000Z", createdAt: "2026-07-27T08:00:00.000Z",
    creatorResponseDeadline: null,
  },
};

const publication: MissionPublicationView = {
  workItemId: "item-1", platform: "instagram", state: "proof_verified", revision: 5,
  approvedVersionId: "version-1",
  instructions: {
    publicationInstructions: "Publish.", requiredDisclosures: [], expectedAccount: null,
    proofEvidencePolicy: {}, publishDueAt: "2026-07-27T08:00:00.000Z", frozenAt: null,
  },
  attempts: [attempt], currentAttempt: attempt, acceptedAttempt: attempt,
};

async function renderHistory(locale: "en" | "zh", variant: "reward_pending" | "reward_reassessment") {
  window.localStorage.setItem("lang", locale);
  render(
    <I18nProvider>
      <ProofAttemptHistory publication={publication} variant={variant} autoFocusVerifiedHeading={false} />
    </I18nProvider>,
  );
  await waitFor(() => expect(document.documentElement.lang).toBe(locale === "zh" ? "zh-Hant-HK" : "en"));
}

describe("reward proof-history locale variants", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders pending context in Traditional Chinese", async () => {
    await renderHistory("zh", "reward_pending");
    expect(screen.getByText("你已核實的發佈證明會保留記錄，同時財務團隊正審核任務完成交接。")).toBeVisible();
  });

  it("renders reassessment context in English", async () => {
    await renderHistory("en", "reward_reassessment");
    expect(screen.getByText("Your verified publication proof remains on record while mission completion is reviewed again.")).toBeVisible();
  });
});
