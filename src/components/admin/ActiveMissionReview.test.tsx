import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveMissionReview } from "./ActiveMissionReview";
import type { ActiveMissionWorkflow } from "@/lib/admin";

const workflow = (revisionLimit = 2): ActiveMissionWorkflow => ({
  workflow: { id: "workflow-1", revision_limit: revisionLimit },
  submission: {
    creators: { id: "creator-1", display_name: "Amy Wong" },
    missions: {
      id: "mission-1",
      title: "Summer launch",
      description: "Show the new collection in a bright outdoor setting.",
      key_messages: ["Made for Hong Kong summers"],
      dos: ["Show the product in use"],
      donts: ["Do not mention competitors"],
    },
  },
  workItems: [
    {
      id: "work-item-2",
      title: "Instagram reel",
      platform: "instagram",
      position: 0,
      state: "submitted",
      deadline: "2099-07-20T12:00:00.000Z",
      current_reviewer_id: null,
      current_submitted_version_id: "version-2",
      approved_version_id: null,
      requirements_snapshot: [
        { id: "requirement-1", category: "compliance", text: "Use the approved disclosure wording", required: true },
      ],
    },
  ],
  fulfillment: null,
  versions: [
    {
      id: "version-2",
      mission_work_item_id: "work-item-2",
      version_number: 2,
      caption_snapshot: "Ready for summer.",
      external_draft_url_snapshot: "https://example.com/draft-2",
      checklist_snapshot: { "requirement-1": true },
      submitted_at: "2026-07-19T02:00:00.000Z",
    },
  ],
  reviews: [],
  grants: [],
  events: [],
  assets: [
    {
      id: "asset-1",
      mission_work_item_id: "work-item-2",
      mission_draft_version_id: "version-2",
      original_filename: "reel.mp4",
      mime_type: "video/mp4",
      signedUrl: "https://example.com/signed/reel.mp4",
    },
  ],
});

function renderReview(overrides: Partial<React.ComponentProps<typeof ActiveMissionReview>> = {}) {
  const handlers = {
    onStartReview: vi.fn().mockResolvedValue({}),
    onRequestRevision: vi.fn().mockResolvedValue({}),
    onGrantRevision: vi.fn().mockResolvedValue({}),
    onApproveVersion: vi.fn().mockResolvedValue({}),
    onMarkShipped: vi.fn().mockResolvedValue({}),
  };
  render(
    <ActiveMissionReview
      workflow={workflow()}
      selectedWorkItemId="work-item-2"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("ActiveMissionReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the brief beside the immutable submitted version and stacks sticky actions on mobile", () => {
    renderReview();
    const layout = screen.getByTestId("review-layout");
    expect(layout).toHaveClass("lg:grid-cols-2");
    expect(screen.getByRole("heading", { name: "Brief and checklist" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Version 2" })).toBeVisible();
    expect(screen.getByText("Ready for summer.")).toBeVisible();
    expect(screen.getByRole("link", { name: "reel.mp4" })).toHaveAttribute("href", "https://example.com/signed/reel.mp4");
    expect(screen.getByTestId("review-actions")).toHaveClass("sticky", "bottom-0");
  });

  it("starts review for the exact selected work item", async () => {
    const handlers = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    await waitFor(() => expect(handlers.onStartReview).toHaveBeenCalledWith({
      workItemId: "work-item-2",
      expectedState: "submitted",
    }));
  });

  it("requires a future deadline and at least one structured required change", async () => {
    const handlers = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
    expect(screen.getByText("Add at least one required change")).toBeVisible();
    expect(screen.getByText("Choose a future revision deadline")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Required change 1"), {
      target: { value: "Use the approved disclosure wording" },
    });
    fireEvent.change(screen.getByLabelText("Revision deadline"), {
      target: { value: "2099-07-21T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));

    await waitFor(() => expect(handlers.onRequestRevision).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "work-item-2",
      expectedState: "submitted",
      versionId: "version-2",
      items: [expect.objectContaining({
        category: "other",
        text: "Use the approved disclosure wording",
        required: true,
      })],
    })));
  });

  it("names the exact version in approval confirmation and states that no reward is issued", async () => {
    const handlers = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Approve version" }));
    expect(screen.getByText("Approve version 2?")).toBeVisible();
    expect(screen.getByText("This approves version 2 for publishing. No reward is issued by this action.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(handlers.onApproveVersion).toHaveBeenCalledWith({
      workItemId: "work-item-2",
      expectedState: "submitted",
      versionId: "version-2",
    }));
  });

  it("requires a grant reason before another revision request when the limit is exhausted", async () => {
    const exhausted = workflow(1);
    exhausted.reviews = [{
      id: "review-1",
      mission_work_item_id: "work-item-2",
      mission_draft_version_id: "version-2",
      round_number: 1,
      state: "revision_requested",
      mission_review_items: [],
    }];
    const handlers = renderReview({ workflow: exhausted });

    expect(screen.getByRole("button", { name: "Request revision" })).toBeDisabled();
    expect(screen.getByText("Revision limit reached")).toBeVisible();
    expect(screen.getByRole("button", { name: "Grant another revision" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Grant reason"), { target: { value: "The mission brief changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant another revision" }));
    await waitFor(() => expect(handlers.onGrantRevision).toHaveBeenCalledWith({
      workItemId: "work-item-2",
      reason: "The mission brief changed",
      grantedCount: 1,
    }));
    expect(screen.getByRole("button", { name: "Request revision" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    fireEvent.change(screen.getByLabelText("Required change 1"), {
      target: { value: "Update the opening shot" },
    });
    fireEvent.change(screen.getByLabelText("Revision deadline"), {
      target: { value: "2099-07-21T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
    await waitFor(() => expect(handlers.onRequestRevision).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Request revision" })).toBeDisabled();
  });
});
