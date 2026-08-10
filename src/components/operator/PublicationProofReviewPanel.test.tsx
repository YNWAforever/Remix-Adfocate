import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError, AdminRequestError } from "@/lib/adminTransport";
import type { CreatorCasePublicationProof, CreatorCasePublicationProofAttempt } from "@/lib/creatorCase";
import { PublicationProofReviewPanel } from "./PublicationProofReviewPanel";

const mocks = vi.hoisted(() => ({
  postCreatorPublicationProofReview: vi.fn(),
}));

vi.mock("@/lib/creatorCase", () => ({
  postCreatorPublicationProofReview: mocks.postCreatorPublicationProofReview,
}));

const attempt = (overrides: Partial<CreatorCasePublicationProofAttempt> = {}): CreatorCasePublicationProofAttempt => ({
  id: "attempt-1",
  submissionId: "submission-1",
  workflowId: "workflow-1",
  workItemId: "work-item-1",
  creatorId: "creator-1",
  workspaceId: "workspace-1",
  parentAttemptId: null,
  sequence: 1,
  publishedUrl: "https://example.com/published-post",
  platform: "instagram",
  state: "submitted" as const,
  operatorMessage: null,
  submittedAt: "2026-08-11T00:00:00.000Z",
  decidedAt: null,
  ...overrides,
});

const proof = (
  currentAttempt: CreatorCasePublicationProofAttempt | null = attempt(),
  history: CreatorCasePublicationProofAttempt[] = [],
): CreatorCasePublicationProof => ({
  submissionId: "submission-1",
  workflowId: "workflow-1",
  workItemId: "work-item-1",
  creatorId: "creator-1",
  workspaceId: "workspace-1",
  currentAttempt,
  history,
});

function renderPanel(
  publicationProofs: CreatorCasePublicationProof[],
  options: { onAuthError?: (error: unknown) => void; onSuccess?: () => void } = {},
) {
  const queryClient = new QueryClient();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PublicationProofReviewPanel
          workspaceId="workspace-1"
          creatorId="creator-1"
          publicationProofs={publicationProofs}
          onAuthError={options.onAuthError}
          onSuccess={options.onSuccess}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("PublicationProofReviewPanel", () => {
  afterEach(() => {
    mocks.postCreatorPublicationProofReview.mockReset();
  });

  it("renders an empty state when the case has no proofs", () => {
    renderPanel([]);

    expect(screen.getByRole("heading", { name: "Publication proof review" })).toBeInTheDocument();
    expect(screen.getByText("No publication proofs linked to this creator case.")).toBeInTheDocument();
  });

  it("renders a draft proof without a verification action", () => {
    renderPanel([proof(attempt({ state: "draft" }))]);

    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("instagram attempt 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify publication proof" })).not.toBeInTheDocument();
  });

  it("renders a submitted proof without changing its state", () => {
    renderPanel([proof()]);

    expect(screen.getByText("https://example.com/published-post")).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByText("instagram attempt 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify publication proof" })).toBeInTheDocument();
  });

  it("renders a verified proof without a verification action", () => {
    renderPanel([proof(attempt({ state: "verified" }))]);

    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify publication proof" })).not.toBeInTheDocument();
  });

  it("renders a proof attempt history when present", () => {
    renderPanel([
      proof(attempt({ id: "attempt-2", sequence: 2 }), [
        attempt({ id: "attempt-1", state: "changes_requested", operatorMessage: "Please include the campaign tag." }),
      ]),
    ]);

    fireEvent.click(screen.getByText("Attempt history"));

    expect(screen.getByText("Attempt 1: changes_requested")).toBeInTheDocument();
    expect(screen.getByText("Please include the campaign tag.")).toBeInTheDocument();
  });

  it("verifies the current submitted attempt and calls the success callback", async () => {
    const onSuccess = vi.fn();
    mocks.postCreatorPublicationProofReview.mockResolvedValue({
      publicationProof: proof(attempt({ state: "verified", decidedAt: "2026-08-11T01:00:00.000Z" })),
    });

    renderPanel([proof()], { onSuccess });
    fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));

    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledWith(
      "workspace-1",
      "creator-1",
      {
        submissionId: "submission-1",
        workItemId: "work-item-1",
        attemptId: "attempt-1",
        decision: "verified",
        message: null,
      },
      expect.any(String),
    ));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("requires feedback before requesting changes", () => {
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));

    expect(screen.getByRole("textbox", { name: "Proof review feedback" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send change request" })).toBeDisabled();
  });

  it("submits trimmed feedback when requesting changes", async () => {
    mocks.postCreatorPublicationProofReview.mockResolvedValue({
      publicationProof: proof(attempt({ state: "changes_requested", operatorMessage: "Use the campaign tag." })),
    });
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Proof review feedback" }), {
      target: { value: "  Use the campaign tag.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send change request" }));

    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledWith(
      "workspace-1",
      "creator-1",
      {
        submissionId: "submission-1",
        workItemId: "work-item-1",
        attemptId: "attempt-1",
        decision: "changes_requested",
        message: "Use the campaign tag.",
      },
      expect.any(String),
    ));
  });

  it("reuses the command id when a proof decision is retried", async () => {
    mocks.postCreatorPublicationProofReview
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ publicationProof: proof(attempt({ state: "verified" })) });
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry proof review" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(2));

    expect(mocks.postCreatorPublicationProofReview.mock.calls[0][3])
      .toBe(mocks.postCreatorPublicationProofReview.mock.calls[1][3]);
  });

  it("uses a fresh command id when retrying edited change-request feedback", async () => {
    mocks.postCreatorPublicationProofReview
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ publicationProof: proof(attempt({ state: "changes_requested" })) });
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Proof review feedback" }), { target: { value: "Use the campaign tag." } });
    fireEvent.click(screen.getByRole("button", { name: "Send change request" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Proof review feedback" }), { target: { value: "Use the corrected campaign tag." } });
    fireEvent.click(screen.getByRole("button", { name: "Retry proof review" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(2));

    expect(mocks.postCreatorPublicationProofReview.mock.calls[1][2]).toMatchObject({
      decision: "changes_requested",
      message: "Use the corrected campaign tag.",
    });
    expect(mocks.postCreatorPublicationProofReview.mock.calls[1][3])
      .not.toBe(mocks.postCreatorPublicationProofReview.mock.calls[0][3]);
  });

  it("uses a fresh command id after a command conflict", async () => {
    mocks.postCreatorPublicationProofReview
      .mockRejectedValueOnce(new AdminRequestError("raw command conflict detail", "command_conflict"))
      .mockResolvedValueOnce({ publicationProof: proof(attempt({ state: "verified" })) });
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry proof review" }));
    await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(2));

    expect(mocks.postCreatorPublicationProofReview.mock.calls[1][3])
      .not.toBe(mocks.postCreatorPublicationProofReview.mock.calls[0][3]);
  });

  it("reports a mutation auth failure without exposing raw detail", async () => {
    const onAuthError = vi.fn();
    const authError = new AdminAuthError("raw unauthorized detail");
    mocks.postCreatorPublicationProofReview.mockRejectedValue(authError);
    renderPanel([proof()], { onAuthError });

    fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired. Please sign in again.");
    expect(onAuthError).toHaveBeenCalledWith(authError);
    expect(screen.queryByText("raw unauthorized detail")).not.toBeInTheDocument();
  });

  it("renders a safe message for a stale submitted attempt", async () => {
    mocks.postCreatorPublicationProofReview.mockRejectedValue(
      new AdminRequestError("raw database detail", "proof_attempt_not_submitted"),
    );
    renderPanel([proof()]);

    fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This attempt is no longer actionable. Reload the case.",
    );
    expect(screen.queryByText("raw database detail")).not.toBeInTheDocument();
  });
});
