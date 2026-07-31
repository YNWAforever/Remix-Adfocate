import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { MissionPublicationView, PublicationProofAttemptView } from "@/lib/activeMission";
import { I18nProvider } from "@/lib/i18n";
import { ProofAttemptHistory } from "./ProofAttemptHistory";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("lang", "zh");
});

it("localizes every creator-visible proof history label in Traditional Chinese", async () => {
  const attempt: PublicationProofAttemptView = {
    id: "copy-attempt", attemptNumber: 3,
    primaryUrl: "https://www.instagram.com/p/final",
    additionalUrls: ["https://www.instagram.com/p/story"],
    submittedAt: "2026-07-27T08:00:00.000Z", submittedLate: true,
    metadataStatus: "available", metadataSnapshot: { pageTitle: "Launch reel" }, metadataErrorCategory: null,
    evidence: [{
      id: "evidence-1", originalFilename: "proof.webp", mimeType: "image/webp",
      sizeBytes: 100, checksum: "checksum", signedUrl: "https://example.test/proof.webp",
    }],
    review: {
      id: "copy-review", state: "correction_requested", decision: "rejected",
      reviewedAt: "2026-07-27T10:00:00.000Z", createdAt: "2026-07-27T08:00:00.000Z",
      creatorResponseDeadline: "2026-07-29T10:00:00.000Z",
    },
    corrections: [{ id: "correction-1", category: "disclosure", text: "Add #Ad", position: 1 }],
  };
  const publication: MissionPublicationView = {
    workItemId: "item-1", platform: "instagram", state: "proof_correction_requested", revision: 5,
    approvedVersionId: "version-1",
    instructions: {
      publicationInstructions: "Publish.", requiredDisclosures: [], expectedAccount: null,
      proofEvidencePolicy: {}, publishDueAt: "2026-07-27T08:00:00.000Z", frozenAt: null,
    },
    attempts: [attempt], currentAttempt: attempt, acceptedAttempt: null,
  };

  render(<I18nProvider><ProofAttemptHistory publication={publication} /></I18nProvider>);
  await waitFor(() => expect(document.documentElement.lang).toBe("zh-Hant-HK"));

  expect(screen.getByRole("heading", { name: "發佈證明記錄" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "發佈證明提交 3" })).toBeVisible();
  expect(screen.getByText("逾期提交")).toBeVisible();
  expect(screen.getByText(/提交時間/)).toBeVisible();
  expect(screen.getByRole("link", { name: "主要發佈網址" })).toBeVisible();
  expect(screen.getByRole("link", { name: "其他發佈網址 1" })).toBeVisible();
  expect(screen.getByText(/預覽標題/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "私人證明" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "需要修正" })).toBeVisible();
  expect(screen.getByText("回應期限")).toBeVisible();
  expect(screen.getByText("披露標示")).toBeVisible();
});
