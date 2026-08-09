import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SubmissionWorkspace } from "@/lib/queries/creatorStudio";

const mocks = vi.hoisted(() => ({
  save: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null, reset: vi.fn() },
  grant: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  finalize: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  submit: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofAttempt: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofGrant: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofFinalize: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofCancel: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofSubmit: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  proofRefresh: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  upload: vi.fn(),
  uploadProof: vi.fn(),
}));

vi.mock("@/lib/queries/creatorStudio", () => ({
  useSaveCreatorDraft: () => mocks.save,
  useCreateDraftAssetGrant: () => mocks.grant,
  useFinalizeDraftAsset: () => mocks.finalize,
  useSubmitWorkItem: () => mocks.submit,
  useCreatePublicationProofAttempt: () => mocks.proofAttempt,
  useCreateProofEvidenceGrant: () => mocks.proofGrant,
  useFinalizeProofEvidence: () => mocks.proofFinalize,
  useCancelProofEvidence: () => mocks.proofCancel,
  useSubmitPublicationProof: () => mocks.proofSubmit,
  useRefreshProofMetadata: () => mocks.proofRefresh,
  uploadDraftAsset: mocks.upload,
  uploadPublicationProofEvidence: mocks.uploadProof,
  creatorStudioKeys: { workspace: (submissionId: string) => ["creator-studio", "workspace", submissionId] },
}));

import { CreatorStudioWorkbench } from "./CreatorStudioWorkbench";

function draftingWorkspace(): SubmissionWorkspace {
  return {
    submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined", deadline: null },
    brief: { missionId: "mission-1", title: "Spring launch mission", description: null, deliverables: ["Story", "Reel"], requirements: ["Include disclosure"], platforms: ["instagram"] },
    workflow: { id: "workflow-1", state: "drafting", revision: 1 },
    workItems: [
      {
        id: "story", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: false, checklist: ["Disclosure"] }, requiresAsset: false,
        proofRequirement: null, publicationProof: { required: false, currentAttempt: null, history: [] },
        state: "drafting", validation: { caption: true, externalUrl: true, checklist: false, assets: true, publicationProof: true },
        draft: { caption: "Draft caption", externalUrl: null, checklist: { Disclosure: false }, version: 2, updatedAt: "2026-08-09T00:00:00.000Z" },
        assets: [], reviewFeedback: { status: "available", value: [] },
      },
      {
        id: "reel", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: false, externalUrl: true, checklist: [] }, requiresAsset: false,
        proofRequirement: null, publicationProof: { required: false, currentAttempt: null, history: [] },
        state: "not_started", validation: { caption: false, externalUrl: false, checklist: true, assets: true, publicationProof: true }, draft: null, assets: [],
        reviewFeedback: { status: "unavailable", reason: "temporarily_unavailable" },
      },
    ],
    nextAction: { workItemId: "story", state: "drafting", label: "Finish draft" },
  };
}

function changesRequestedWorkspace(): SubmissionWorkspace {
  const workspace = draftingWorkspace();
  workspace.workflow.state = "changes_requested";
  workspace.workItems[0] = {
    ...workspace.workItems[0],
    state: "changes_requested",
    validation: { caption: true, externalUrl: true, checklist: true, assets: true, publicationProof: true },
    draft: { caption: "Corrected caption", externalUrl: null, checklist: { Disclosure: true }, version: 3, updatedAt: "2026-08-09T01:00:00.000Z" },
    assets: [{ id: "asset-1", fileName: "proof.png", mimeType: "image/png", byteSize: 1, checksumSha256: null, state: "finalized", storagePath: "proof.png" }],
    reviewFeedback: { status: "available", value: [{ id: "feedback-1", state: "changes_requested", message: "Add the disclosure line" }] },
  };
  workspace.nextAction = { workItemId: "story", state: "changes_requested", label: "Resubmit deliverable" };
  return workspace;
}

function approvedWorkspace(): SubmissionWorkspace {
  const workspace = changesRequestedWorkspace();
  workspace.workflow.state = "approved";
  workspace.workItems = [
    { ...workspace.workItems[0], state: "approved", reviewFeedback: { status: "available", value: [{ id: "feedback-approved", state: "approved", message: "Approved by the review team" }] } },
  ];
  workspace.nextAction = { workItemId: "story", state: "approved", label: "Approved" };
  return workspace;
}

function publicationProofWorkspace(): SubmissionWorkspace {
  const workspace = draftingWorkspace();
  workspace.workItems[0] = {
    ...workspace.workItems[0],
    proofRequirement: { kind: "publication_url", allowedPlatforms: ["instagram", "youtube"], evidence: "optional" },
    publicationProof: { required: true, currentAttempt: null, history: [] },
    validation: { ...workspace.workItems[0].validation, publicationProof: false },
  };
  workspace.nextAction = { workItemId: "story", state: "drafting", label: "Complete publication proof" };
  return workspace;
}

function resetMutation(mutation: { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean; error: Error | null }) {
  mutation.mutateAsync.mockReset();
  mutation.mutateAsync.mockResolvedValue({});
  mutation.isPending = false;
  mutation.error = null;
}

beforeEach(() => {
  resetMutation(mocks.save);
  mocks.save.reset.mockReset();
  resetMutation(mocks.grant);
  resetMutation(mocks.finalize);
  resetMutation(mocks.submit);
  resetMutation(mocks.proofAttempt);
  resetMutation(mocks.proofGrant);
  resetMutation(mocks.proofFinalize);
  resetMutation(mocks.proofCancel);
  resetMutation(mocks.proofSubmit);
  resetMutation(mocks.proofRefresh);
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue(undefined);
  mocks.uploadProof.mockReset();
  mocks.uploadProof.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreatorStudioWorkbench", () => {
  it("shows the focused editor, navigator, and disables submission until server readiness", () => {
    const workspace = draftingWorkspace();
    workspace.brief.description = "Create a spring launch story with a clear disclosure.";
    workspace.submission.deadline = "2026-09-01";
    workspace.nextAction = { workItemId: "story", state: "ready_to_submit", label: "Submit deliverable" };
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    expect(screen.getByRole("heading", { name: "Spring launch mission" })).toBeInTheDocument();
    expect(screen.getByText("Create a spring launch story with a clear disclosure.")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Draft caption");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit deliverable" })).toBeDisabled();
  });

  it("shows requested changes and enables resubmission when the projection is ready", () => {
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={changesRequestedWorkspace()} />);

    expect(screen.getByRole("region", { name: "Review feedback" })).toHaveTextContent("Add the disclosure line");
    expect(screen.getByRole("button", { name: "Resubmit deliverable" })).toBeEnabled();
  });

  it("renders the publication proof form and persists a new attempt", async () => {
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={publicationProofWorkspace()} />);

    expect(screen.getByRole("heading", { name: "Publication proof" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Published URL" }), { target: { value: "https://example.com/published" } });
    fireEvent.click(screen.getByRole("button", { name: "Create proof attempt" }));

    await waitFor(() => expect(mocks.proofAttempt.mutateAsync).toHaveBeenCalledWith({
      commandId: expect.any(String), publishedUrl: "https://example.com/published", platform: "instagram",
    }));
    expect(await screen.findByText("Proof details saved.")).toBeInTheDocument();
  });

  it("uploads, finalizes, and submits optional publication evidence", async () => {
    const workspace = publicationProofWorkspace();
    workspace.workItems[0].publicationProof = {
      required: true,
      currentAttempt: {
        id: "attempt-1", workItemId: "story", parentAttemptId: null, sequence: 1,
        publishedUrl: "https://example.com/published", platform: "instagram", state: "draft",
        metadataState: "unavailable", metadata: null, operatorMessage: null,
        submittedAt: null, decidedAt: null, evidence: [],
      },
      history: [],
    };
    mocks.proofGrant.mutateAsync.mockResolvedValue({ bucket: "mission-publication-proof-assets", path: "creator-1/workflow-1/story/proof-evidence/evidence-1.png", token: "signed-token", assetId: "evidence-1", expiresAt: "2026-08-10T01:00:00.000Z" });
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.change(screen.getByLabelText("Publication proof evidence"), { target: { files: [new File(["proof"], "proof.png", { type: "image/png" })] } });
    await waitFor(() => expect(mocks.proofGrant.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String), fileName: "proof.png", mimeType: "image/png" })));
    await waitFor(() => expect(mocks.proofFinalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String), byteSize: 5, mimeType: "image/png" })));
    expect(mocks.uploadProof).toHaveBeenCalledWith(expect.objectContaining({ assetId: "evidence-1" }), expect.any(File));
    fireEvent.click(await screen.findByRole("button", { name: "Submit publication proof" }));
    await waitFor(() => expect(mocks.proofSubmit.mutateAsync).toHaveBeenCalledWith({ commandId: expect.any(String) }));
  });

  it("discards a pending publication evidence reservation", async () => {
    const workspace = publicationProofWorkspace();
    workspace.workItems[0].publicationProof = {
      required: true,
      currentAttempt: {
        id: "attempt-1", workItemId: "story", parentAttemptId: null, sequence: 1,
        publishedUrl: "https://example.com/published", platform: "instagram", state: "draft",
        metadataState: "unavailable", metadata: null, operatorMessage: null,
        submittedAt: null, decidedAt: null,
        evidence: [{
          id: "evidence-1", attemptId: "attempt-1", storagePath: "creator-1/workflow-1/story/evidence-1.png",
          mimeType: "image/png", byteSize: 0, checksumSha256: null, status: "pending",
        }],
      },
      history: [],
    };
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard pending evidence" }));

    await waitFor(() => expect(mocks.proofCancel.mutateAsync).toHaveBeenCalledWith({ commandId: expect.any(String) }));
  });

  it("requires saving local draft edits before the primary submit action can mutate", () => {
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={changesRequestedWorkspace()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), { target: { value: "Unsaved correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save latest draft" }));

    expect(mocks.submit.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Save your latest draft before submitting.")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save draft" }));
  });

  it("keeps an upload error retryable without discarding the draft", async () => {
    mocks.grant.mutateAsync.mockRejectedValueOnce(new Error("grant failed"));
    const workspace = draftingWorkspace();
    workspace.workItems[0].requiresAsset = true;
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.change(screen.getByLabelText("Proof asset"), { target: { files: [new File(["x"], "proof.png", { type: "image/png" })] } });

    expect(await screen.findByText("Upload failed. Retry without losing your draft.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Draft caption");
    expect(screen.getByRole("button", { name: "Retry upload" })).toBeInTheDocument();
  });

  it("keeps the selected deliverable by ID when a refetch changes array order", () => {
    const workspace = draftingWorkspace();
    const { rerender } = render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.click(screen.getByRole("button", { name: /Reel/ }));
    expect(screen.getByRole("heading", { name: "Reel" })).toBeInTheDocument();

    rerender(<CreatorStudioWorkbench submissionId="submission-1" workspace={{ ...workspace, workItems: [...workspace.workItems].reverse() }} />);
    expect(screen.getByRole("heading", { name: "Reel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reel/ })).toHaveAttribute("aria-current", "step");
  });

  it("keeps the brief and editor visible when optional review is unavailable", () => {
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={draftingWorkspace()} />);

    fireEvent.click(screen.getByRole("button", { name: /Reel/ }));
    expect(screen.getByText("Review feedback is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reel" })).toBeInTheDocument();
  });

  it("shows the terminal approved completion summary", () => {
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={approvedWorkspace()} />);

    expect(screen.getByText("Approved by the review team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approved" })).toBeDisabled();
    expect(screen.getByText("All deliverables are approved.")).toBeInTheDocument();
  });

  it("renders draft validation failures beside the active work item", () => {
    mocks.save.error = Object.assign(new Error("Draft is incomplete"), { code: "draft_invalid" });
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={draftingWorkspace()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Draft is incomplete");
  });

  it("finalizes only the asset ID returned by the successful grant", async () => {
    mocks.grant.mutateAsync.mockResolvedValue({ assetId: "asset-42", bucket: "proof", path: "proof.png", token: "signed-token", expiresAt: "2026-08-09T01:00:00.000Z" });
    const workspace = draftingWorkspace();
    workspace.workItems[0].requiresAsset = true;
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.change(screen.getByLabelText("Proof asset"), { target: { files: [new File(["x"], "proof.png", { type: "image/png" })] } });
    await waitFor(() => expect(mocks.finalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String) })));
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-42" }), expect.any(File));
    expect(await screen.findByText("Proof asset finalized.")).toBeInTheDocument();
  });

  it("reloads the fresh draft after a version conflict", async () => {
    const freshWorkspace = draftingWorkspace();
    freshWorkspace.workItems[0].draft = { caption: "Fresh server draft", externalUrl: null, checklist: { Disclosure: true }, version: 3, updatedAt: "2026-08-09T03:00:00.000Z" };
    const reloadWorkspace = vi.fn().mockResolvedValue(freshWorkspace);
    mocks.save.error = Object.assign(new Error("Version conflict"), { code: "version_conflict" });
    mocks.save.mutateAsync.mockRejectedValue(new Error("Version conflict"));
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={draftingWorkspace()} onReloadWorkspace={reloadWorkspace} />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(1));
    const staleCommandId = mocks.save.mutateAsync.mock.calls[0][0].commandId;
    fireEvent.click(screen.getByRole("button", { name: "Reload latest draft" }));

    await waitFor(() => expect(reloadWorkspace).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Fresh server draft");
    expect(mocks.save.reset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.save.mutateAsync.mock.calls[1][0].commandId).not.toBe(staleCommandId);
  });

  it("uses a new submit command after reloading a conflicted draft version", async () => {
    const workspace = draftingWorkspace();
    workspace.workItems[0] = {
      ...workspace.workItems[0],
      state: "ready_to_submit",
      validation: { caption: true, externalUrl: true, checklist: true, assets: true, publicationProof: true },
    };
    workspace.nextAction = { workItemId: "story", state: "ready_to_submit", label: "Submit deliverable" };
    const freshWorkspace = structuredClone(workspace);
    freshWorkspace.workItems[0].draft = {
      caption: "Fresh server draft",
      externalUrl: null,
      checklist: { Disclosure: true },
      version: 3,
      updatedAt: "2026-08-09T04:00:00.000Z",
    };
    const reloadWorkspace = vi.fn().mockResolvedValue(freshWorkspace);
    mocks.submit.mutateAsync.mockRejectedValue(new Error("Version conflict"));
    mocks.save.error = Object.assign(new Error("Version conflict"), { code: "version_conflict" });
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} onReloadWorkspace={reloadWorkspace} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit deliverable" }));
    await waitFor(() => expect(mocks.submit.mutateAsync).toHaveBeenCalledTimes(1));
    const staleCommand = mocks.submit.mutateAsync.mock.calls[0][0];

    fireEvent.click(screen.getAllByRole("button", { name: "Reload latest draft" })[0]);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Fresh server draft"));
    fireEvent.click(screen.getByRole("button", { name: "Submit deliverable" }));

    await waitFor(() => expect(mocks.submit.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mutateAsync.mock.calls[1][0]).toMatchObject({ expectedVersion: 3 });
    expect(mocks.submit.mutateAsync.mock.calls[1][0].commandId).not.toBe(staleCommand.commandId);
  });

  it("surfaces a submit version conflict and reloads the latest draft", async () => {
    const workspace = draftingWorkspace();
    workspace.workItems[0] = {
      ...workspace.workItems[0],
      state: "ready_to_submit",
      validation: { caption: true, externalUrl: true, checklist: true, assets: true, publicationProof: true },
    };
    workspace.nextAction = { workItemId: "story", state: "ready_to_submit", label: "Submit deliverable" };
    const reloadWorkspace = vi.fn().mockResolvedValue(workspace);
    mocks.submit.mutateAsync.mockRejectedValueOnce(Object.assign(new Error("Version conflict"), { code: "version_conflict" }));

    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} onReloadWorkspace={reloadWorkspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit deliverable" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This submission changed elsewhere. Reload the latest draft before retrying.");
    fireEvent.click(screen.getByRole("button", { name: "Reload latest draft" }));
    await waitFor(() => expect(reloadWorkspace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("uses a fresh save command ID after draft input changes", async () => {
    mocks.save.mutateAsync.mockRejectedValue(new Error("offline"));
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={draftingWorkspace()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(1));
    const firstCommandId = mocks.save.mutateAsync.mock.calls[0][0].commandId;
    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), { target: { value: "Changed caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.save.mutateAsync.mock.calls[1][0].commandId).not.toBe(firstCommandId);
  });

  it("keeps a save command ID for an unchanged retry", async () => {
    mocks.save.mutateAsync.mockRejectedValue(new Error("offline"));
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={draftingWorkspace()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.save.mutateAsync.mock.calls[1][0].commandId).toBe(mocks.save.mutateAsync.mock.calls[0][0].commandId);
  });

  it("starts a new upload command sequence for a different replacement file", async () => {
    mocks.grant.mutateAsync.mockRejectedValue(new Error("grant failed"));
    const workspace = draftingWorkspace();
    workspace.workItems[0].requiresAsset = true;
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.change(screen.getByLabelText("Proof asset"), { target: { files: [new File(["first"], "first.png", { type: "image/png", lastModified: 1 })] } });
    await waitFor(() => expect(mocks.grant.mutateAsync).toHaveBeenCalledTimes(1));
    const firstCommandId = mocks.grant.mutateAsync.mock.calls[0][0].commandId;
    fireEvent.change(screen.getByLabelText("Proof asset"), { target: { files: [new File(["second"], "second.png", { type: "image/png", lastModified: 2 })] } });
    await waitFor(() => expect(mocks.grant.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.grant.mutateAsync.mock.calls[1][0].commandId).not.toBe(firstCommandId);
  });

  it("focuses the authoritative action target instead of exposing a no-op", () => {
    const workspace = draftingWorkspace();
    workspace.workItems[0] = { ...workspace.workItems[0], state: "not_started" };
    workspace.nextAction = { workItemId: "story", state: "not_started", label: "Start drafting" };
    const { rerender } = render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Start drafting" }));
    expect(document.activeElement).toBe(screen.getByTestId("creator-draft-editor-story"));

    workspace.nextAction = { workItemId: "story", state: "drafting", label: "Finish draft" };
    rerender(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish draft" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save draft" }));
  });

  it("focuses proof and review controls for their primary actions", () => {
    const workspace = changesRequestedWorkspace();
    workspace.workItems[0] = { ...workspace.workItems[0], state: "drafting", requiresAsset: true, validation: { caption: true, externalUrl: true, checklist: true, assets: false, publicationProof: true } };
    workspace.nextAction = { workItemId: "story", state: "drafting", label: "Upload proof" };
    const { rerender } = render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload proof" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Proof asset"));

    workspace.workItems[0] = { ...workspace.workItems[0], state: "changes_requested", validation: { caption: false, externalUrl: true, checklist: true, assets: true, publicationProof: true } };
    workspace.nextAction = { workItemId: "story", state: "changes_requested", label: "Review requested changes" };
    rerender(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Review requested changes" }));
    expect(document.activeElement).toBe(screen.getByTestId("creator-review-feedback-story"));
  });
});
