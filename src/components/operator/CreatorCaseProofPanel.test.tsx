import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CreatorCaseProofItem } from "@/lib/admin";
import { CreatorCaseProofPanel } from "./CreatorCaseProofPanel";

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<object>("@tanstack/react-router")),
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
}));

function proof(overrides: Partial<CreatorCaseProofItem> = {}): CreatorCaseProofItem {
  return {
    attemptId: "attempt-1",
    workflowId: "workflow-1",
    workItemId: "work-item-1",
    workItemTitle: "IG Reel",
    platform: "instagram",
    missionTitle: "Summer launch",
    missionSlug: "summer-launch",
    attemptNumber: 1,
    primaryUrl: "https://example.com/post",
    submittedAt: "2026-08-01T00:00:00.000Z",
    submittedLate: false,
    metadataStatus: "available",
    reviewState: "awaiting_review",
    reviewSummary: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe("CreatorCaseProofPanel", () => {
  it("lists proofs and badges the pending count", () => {
    render(
      <CreatorCaseProofPanel
        proofs={{
          status: "available",
          value: [proof(), proof({ attemptId: "attempt-2", reviewState: "verified" })],
        }}
      />,
    );

    expect(screen.getByText("awaiting review")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("links the published post and the review surface", () => {
    render(<CreatorCaseProofPanel proofs={{ status: "available", value: [proof()] }} />);

    expect(screen.getByRole("link", { name: /open published post/i })).toHaveAttribute(
      "href",
      "https://example.com/post",
    );
    expect(screen.getByRole("link", { name: /review proof/i })).toBeInTheDocument();
  });

  it("surfaces late and unsafe-metadata risk flags", () => {
    render(
      <CreatorCaseProofPanel
        proofs={{ status: "available", value: [proof({ submittedLate: true, metadataStatus: "unsafe" })] }}
      />,
    );

    expect(screen.getByText("late")).toBeInTheDocument();
    expect(screen.getByText("unsafe metadata")).toBeInTheDocument();
  });

  it("explains a not_configured source without implying a fault", () => {
    render(<CreatorCaseProofPanel proofs={{ status: "unavailable", reason: "not_configured" }} />);

    expect(screen.getByText(/not enabled in this environment/i)).toBeInTheDocument();
  });

  it("reassures that the rest of the case file survives a source error", () => {
    render(<CreatorCaseProofPanel proofs={{ status: "unavailable", reason: "source_error" }} />);

    expect(screen.getByText(/rest of this case file is unaffected/i)).toBeInTheDocument();
  });

  it("shows an empty state when the creator has no proofs", () => {
    render(<CreatorCaseProofPanel proofs={{ status: "available", value: [] }} />);

    expect(screen.getByText("No publication proofs submitted")).toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(<CreatorCaseProofPanel isLoading />);

    expect(screen.getByText(/loading publication proofs/i)).toBeInTheDocument();
  });
});
