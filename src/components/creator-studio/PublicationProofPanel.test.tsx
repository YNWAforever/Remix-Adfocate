import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PublicationProofAttempt, WorkItem } from "@/lib/queries/creatorStudio";

const mocks = vi.hoisted(() => ({
  attempt: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  grant: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  finalize: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  cancel: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  submit: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  refresh: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  upload: vi.fn(),
}));

vi.mock("@/lib/queries/creatorStudio", () => ({
  useCreatePublicationProofAttempt: () => mocks.attempt,
  useCreateProofEvidenceGrant: () => mocks.grant,
  useFinalizeProofEvidence: () => mocks.finalize,
  useCancelProofEvidence: () => mocks.cancel,
  useSubmitPublicationProof: () => mocks.submit,
  useRefreshProofMetadata: () => mocks.refresh,
  uploadPublicationProofEvidence: mocks.upload,
}));

import { PublicationProofPanel } from "./PublicationProofPanel";

const draftAttempt = (overrides: Partial<PublicationProofAttempt> = {}): PublicationProofAttempt => ({
  id: "attempt-1",
  workItemId: "story",
  parentAttemptId: null,
  sequence: 1,
  publishedUrl: "https://example.com/published",
  platform: "instagram",
  state: "draft",
  metadataState: "unavailable",
  metadata: null,
  operatorMessage: null,
  submittedAt: null,
  decidedAt: null,
  evidence: [],
  ...overrides,
});

const workItem = (currentAttempt: PublicationProofAttempt | null = null, history: PublicationProofAttempt[] = []): WorkItem => ({
  id: "story",
  position: 1,
  title: "Story",
  instructions: "Create a story",
  requirements: { caption: true, externalUrl: false, checklist: [] },
  requiresAsset: false,
  proofRequirement: { kind: "publication_url", allowedPlatforms: ["instagram", "youtube"], evidence: "optional" },
  state: "drafting",
  validation: { caption: true, externalUrl: true, checklist: true, assets: true, publicationProof: currentAttempt?.state === "submitted" },
  draft: { caption: "Draft caption", externalUrl: null, checklist: {}, version: 1, updatedAt: "2026-08-10T00:00:00.000Z" },
  assets: [],
  publicationProof: { required: true, currentAttempt, history },
  reviewFeedback: { status: "unavailable", reason: "not_requested" },
});

function resetMutation(mutation: { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean; error: Error | null }) {
  mutation.mutateAsync.mockReset();
  mutation.mutateAsync.mockResolvedValue({});
  mutation.isPending = false;
  mutation.error = null;
}

beforeEach(() => {
  resetMutation(mocks.attempt);
  resetMutation(mocks.grant);
  resetMutation(mocks.finalize);
  resetMutation(mocks.cancel);
  resetMutation(mocks.submit);
  resetMutation(mocks.refresh);
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue(undefined);
});

describe("PublicationProofPanel", () => {
  it("does not render for legacy deliverables", () => {
    const legacy = workItem();
    legacy.proofRequirement = null;
    legacy.publicationProof = { required: false, currentAttempt: null, history: [] };

    render(<PublicationProofPanel submissionId="submission-1" workItem={legacy} />);

    expect(screen.queryByRole("heading", { name: "Publication proof" })).not.toBeInTheDocument();
  });

  it("saves a draft URL with the selected allowed platform", async () => {
    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Published URL" }), { target: { value: "https://example.com/new-post" } });
    fireEvent.click(screen.getByRole("button", { name: "Create proof attempt" }));

    await waitFor(() => expect(mocks.attempt.mutateAsync).toHaveBeenCalledWith({
      commandId: expect.any(String), publishedUrl: "https://example.com/new-post", platform: "instagram",
    }));
    expect(await screen.findByText("Proof details saved.")).toBeInTheDocument();
  });

  it("shows failed metadata as a manual-review fallback and renders immutable history", () => {
    const previous = draftAttempt({ id: "attempt-0", sequence: 1, state: "changes_requested", publishedUrl: "https://example.com/old", operatorMessage: "Use the public post URL." });
    const current = draftAttempt({ sequence: 2, metadataState: "failed" });

    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem(current, [previous])} />);

    expect(screen.getByText("Metadata refresh failed; manual review is required.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Publication proof history" })).toHaveTextContent("Attempt 1: changes_requested");
    expect(screen.getByRole("region", { name: "Publication proof history" })).toHaveTextContent("Use the public post URL.");
    expect(screen.getByRole("heading", { name: "Publication proof" }).closest("section")).toHaveAttribute("tabindex", "-1");
  });

  it("offers a linked correction action for a changes-requested attempt", async () => {
    const current = draftAttempt({ state: "changes_requested", operatorMessage: "Add the campaign tag." });
    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem(current)} />);

    expect(screen.getAllByText("Add the campaign tag.")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Start correction" }));

    await waitFor(() => expect(mocks.attempt.mutateAsync).toHaveBeenCalledWith({
      commandId: expect.any(String), publishedUrl: "https://example.com/published", platform: "instagram",
    }));
  });

  it("keeps submitted attempts immutable while showing the operator state", () => {
    const submitted = draftAttempt({ state: "submitted", submittedAt: "2026-08-10T01:00:00.000Z" });
    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem(submitted)} />);

    expect(screen.getByText("Proof submitted for review.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Published URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit publication proof" })).not.toBeInTheDocument();
  });

  it("uploads, finalizes, and submits optional evidence", async () => {
    mocks.grant.mutateAsync.mockResolvedValue({
      bucket: "mission-publication-proof-assets",
      path: "creator-1/workflow-1/story/evidence-1.png",
      token: "signed-token",
      assetId: "evidence-1",
      expiresAt: "2026-08-10T02:00:00.000Z",
    });
    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem(draftAttempt())} />);

    fireEvent.change(screen.getByLabelText("Publication proof evidence"), { target: { files: [new File(["proof"], "proof.png", { type: "image/png" })] } });

    await waitFor(() => expect(mocks.grant.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String), fileName: "proof.png" })));
    await waitFor(() => expect(mocks.finalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String), byteSize: 5, mimeType: "image/png" })));
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ assetId: "evidence-1" }), expect.any(File));
  });

  it("surfaces a failed pending-evidence discard", async () => {
    mocks.cancel.mutateAsync.mockRejectedValue(Object.assign(new Error("cancel failed"), { code: "proof_evidence_invalid" }));
    const pending = draftAttempt({ evidence: [{
      id: "evidence-1", attemptId: "attempt-1", storagePath: "creator-1/workflow-1/story/evidence-1.png",
      mimeType: "image/png", byteSize: 0, checksumSha256: null, status: "pending",
    }] });
    render(<PublicationProofPanel submissionId="submission-1" workItem={workItem(pending)} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard pending evidence" }));

    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent("Pending evidence could not be discarded");
  });
});
