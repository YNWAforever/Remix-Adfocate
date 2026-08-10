import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CreatorCasePublicationProof, CreatorCasePublicationProofAttempt } from "@/lib/creatorCase";
import { PublicationProofReviewPanel } from "./PublicationProofReviewPanel";

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

describe("PublicationProofReviewPanel", () => {
  it("renders an empty state when the case has no proofs", () => {
    render(<PublicationProofReviewPanel workspaceId="workspace-1" creatorId="creator-1" publicationProofs={[]} />);

    expect(screen.getByRole("heading", { name: "Publication proof review" })).toBeInTheDocument();
    expect(screen.getByText("No publication proofs linked to this creator case.")).toBeInTheDocument();
  });

  it("renders a draft proof without a verification action", () => {
    render(
      <PublicationProofReviewPanel
        workspaceId="workspace-1"
        creatorId="creator-1"
        publicationProofs={[proof(attempt({ state: "draft" }))]}
      />,
    );

    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("instagram attempt 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify publication proof" })).not.toBeInTheDocument();
  });

  it("renders a submitted proof without changing its state", () => {
    render(<PublicationProofReviewPanel workspaceId="workspace-1" creatorId="creator-1" publicationProofs={[proof()]} />);

    expect(screen.getByText("https://example.com/published-post")).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByText("instagram attempt 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify publication proof" })).toBeInTheDocument();
  });

  it("renders a verified proof without a verification action", () => {
    render(
      <PublicationProofReviewPanel
        workspaceId="workspace-1"
        creatorId="creator-1"
        publicationProofs={[proof(attempt({ state: "verified" }))]}
      />,
    );

    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify publication proof" })).not.toBeInTheDocument();
  });

  it("renders a proof attempt history when present", () => {
    render(
      <PublicationProofReviewPanel
        workspaceId="workspace-1"
        creatorId="creator-1"
        publicationProofs={[
          proof(attempt({ id: "attempt-2", sequence: 2 }), [
            attempt({ id: "attempt-1", state: "changes_requested", operatorMessage: "Please include the campaign tag." }),
          ]),
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Attempt history"));

    expect(screen.getByText("Attempt 1: changes_requested")).toBeInTheDocument();
    expect(screen.getByText("Please include the campaign tag.")).toBeInTheDocument();
  });
});
