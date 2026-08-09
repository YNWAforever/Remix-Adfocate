import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SubmissionWorkspace } from "@/lib/queries/creatorStudio";

const mocks = vi.hoisted(() => ({
  save: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  grant: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  finalize: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  submit: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  upload: vi.fn(),
}));

vi.mock("@/lib/queries/creatorStudio", () => ({
  useSaveCreatorDraft: () => mocks.save,
  useCreateDraftAssetGrant: () => mocks.grant,
  useFinalizeDraftAsset: () => mocks.finalize,
  useSubmitWorkItem: () => mocks.submit,
  uploadDraftAsset: mocks.upload,
  creatorStudioKeys: { workspace: (submissionId: string) => ["creator-studio", "workspace", submissionId] },
}));

import { CreatorStudioWorkbench } from "./CreatorStudioWorkbench";

function draftingWorkspace(): SubmissionWorkspace {
  return {
    submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" },
    brief: { missionId: "mission-1", title: "Spring launch mission", deliverables: ["Story", "Reel"], requirements: ["Include disclosure"], platforms: ["instagram"] },
    workflow: { id: "workflow-1", state: "drafting", revision: 1 },
    workItems: [
      {
        id: "story", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: false, checklist: ["Disclosure"] }, requiresAsset: false,
        state: "drafting", validation: { caption: true, externalUrl: true, checklist: false, assets: true },
        draft: { caption: "Draft caption", externalUrl: null, checklist: { Disclosure: false }, version: 2, updatedAt: "2026-08-09T00:00:00.000Z" },
        assets: [], reviewFeedback: { status: "available", value: [] },
      },
      {
        id: "reel", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: false, externalUrl: true, checklist: [] }, requiresAsset: false,
        state: "not_started", validation: { caption: false, externalUrl: false, checklist: true, assets: true }, draft: null, assets: [],
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
    validation: { caption: true, externalUrl: true, checklist: true, assets: true },
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

function resetMutation(mutation: { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean; error: Error | null }) {
  mutation.mutateAsync.mockReset();
  mutation.mutateAsync.mockResolvedValue({});
  mutation.isPending = false;
  mutation.error = null;
}

beforeEach(() => {
  resetMutation(mocks.save);
  resetMutation(mocks.grant);
  resetMutation(mocks.finalize);
  resetMutation(mocks.submit);
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreatorStudioWorkbench", () => {
  it("shows the focused editor, navigator, and disables submission until server readiness", () => {
    const workspace = draftingWorkspace();
    workspace.nextAction = { workItemId: "story", state: "ready_to_submit", label: "Submit deliverable" };
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    expect(screen.getByRole("heading", { name: "Spring launch mission" })).toBeInTheDocument();
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

  it("keeps an upload error retryable without discarding the draft", async () => {
    mocks.grant.mutateAsync.mockRejectedValueOnce(new Error("grant failed"));
    const workspace = draftingWorkspace();
    workspace.workItems[0].requiresAsset = true;
    render(<CreatorStudioWorkbench submissionId="submission-1" workspace={workspace} />);

    fireEvent.upload(screen.getByLabelText("Proof asset"), new File(["x"], "proof.png", { type: "image/png" }));

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

    fireEvent.upload(screen.getByLabelText("Proof asset"), new File(["x"], "proof.png", { type: "image/png" }));
    await waitFor(() => expect(mocks.finalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.any(String) })));
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-42" }), expect.any(File));
    expect(await screen.findByText("Proof asset finalized.")).toBeInTheDocument();
  });
});
