import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionPublicationView, PublicationProofAttemptView } from "@/lib/activeMission";
import { I18nProvider } from "@/lib/i18n";
import { ProofAttemptHistory } from "./ProofAttemptHistory";

const accepted: PublicationProofAttemptView = {
  id: "attempt-review",
  attemptNumber: 2,
  primaryUrl: "https://www.instagram.com/p/final",
  additionalUrls: ["https://www.instagram.com/p/story"],
  submittedAt: "2026-07-27T08:00:00.000Z",
  submittedLate: true,
  metadataStatus: "unavailable",
  metadataSnapshot: {},
  metadataErrorCategory: "platform_blocked",
  evidence: [],
  review: {
    id: "review-2",
    state: "verified",
    decision: "verified",
    reviewedAt: "2026-07-27T10:00:00.000Z",
    createdAt: "2026-07-27T08:00:00.000Z",
    creatorResponseDeadline: null,
  },
  corrections: [],
};

function publication(): MissionPublicationView {
  return {
    workItemId: "item-1",
    platform: "instagram",
    state: "proof_verified",
    revision: 5,
    approvedVersionId: "version-1",
    instructions: {
      publicationInstructions: "Publish.", requiredDisclosures: [], expectedAccount: null,
      proofEvidencePolicy: {}, publishDueAt: "2026-07-27T08:00:00.000Z", frozenAt: null,
    },
    attempts: [accepted], currentAttempt: accepted, acceptedAttempt: accepted,
  };
}

async function renderLocale(locale: "en" | "zh", variant: "reward_pending" | "reward_reassessment") {
  window.localStorage.setItem("lang", locale);
  const result = render(
    <I18nProvider>
      <ProofAttemptHistory publication={publication()} variant={variant} autoFocusVerifiedHeading={false} />
    </I18nProvider>,
  );
  await waitFor(() => expect(document.documentElement.lang).toBe(locale === "zh" ? "zh-Hant-HK" : "en"));
  return result;
}

describe("localized reward proof history", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("uses reward-neutral pending copy and does not compete for focus", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await renderLocale("en", "reward_pending");
    expect(screen.getByRole("heading", { name: "Proof verified" })).toBeVisible();
    expect(screen.getByText("Your verified publication proof remains on record while finance reviews the handoff.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Proof attempt 2" })).toBeVisible();
    expect(screen.getByText("Accepted attempt 2")).toBeVisible();
    expect(screen.getByText("Submitted late")).toBeVisible();
    expect(screen.getByRole("link", { name: "Primary published URL" })).toBeVisible();
    expect(screen.getByText("Automatic preview is unavailable. Your proof is still ready for manual review.")).toBeVisible();
    expect(focus).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(/\b(?:paid|credited|available|issued)\b|reversed funds/i);
  });

  it("localizes reassessment history in Traditional Chinese without reward promises", async () => {
    await renderLocale("zh", "reward_reassessment");
    expect(screen.getByRole("heading", { name: "發佈證明已核實" })).toBeVisible();
    expect(screen.getByText("你已核實的發佈證明會保留記錄，同時任務完成狀態正再次接受審核。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "發佈證明提交 2" })).toBeVisible();
    expect(screen.getByText("已接納提交 2")).toBeVisible();
    expect(screen.getByText("逾期提交")).toBeVisible();
    expect(screen.getByRole("link", { name: "主要發佈網址" })).toBeVisible();
    expect(screen.getByText("未能顯示自動預覽。你的發佈證明仍可供人手審核。")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/已付款|已入帳|可用|已發放|扣回/);
  });

  it("contains long unbroken metadata, filenames, corrections, and attempt labels", async () => {
    const metadataTitle = "metadata-" + "x".repeat(180);
    const filename = "evidence-" + "y".repeat(180) + ".png";
    const correctionText = "correction-" + "z".repeat(180);
    const overflowAttempt: PublicationProofAttemptView = {
      ...accepted,
      attemptNumber: Number.MAX_SAFE_INTEGER,
      metadataStatus: "available",
      metadataSnapshot: { pageTitle: metadataTitle },
      evidence: [{
        id: "asset-with-a-long-identifier",
        originalFilename: filename,
        mimeType: "image/png",
        sizeBytes: 128,
        checksum: "checksum",
        signedUrl: "https://example.com/private-evidence",
      }],
      corrections: [{
        id: "correction-with-a-long-identifier",
        category: "content",
        text: correctionText,
        position: 1,
      }],
    };
    const value = { ...publication(), attempts: [overflowAttempt], currentAttempt: overflowAttempt, acceptedAttempt: overflowAttempt };
    window.localStorage.setItem("lang", "en");
    render(<I18nProvider><ProofAttemptHistory publication={value} autoFocusVerifiedHeading={false} /></I18nProvider>);
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));

    const attemptHeading = screen.getByRole("heading", { name: "Proof attempt " + Number.MAX_SAFE_INTEGER });
    expect(attemptHeading.closest("article")).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(attemptHeading).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
    expect(screen.getByText(metadataTitle)).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
    expect(screen.getByRole("link", { name: filename })).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
    expect(screen.getByText(correctionText)).toHaveClass("min-w-0", "break-words", "[overflow-wrap:anywhere]");
  });
});
