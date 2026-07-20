import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveMissionReview } from "./ActiveMissionReview";
import { AdminRequestError } from "@/lib/admin";
import type { ActiveMissionWorkflow } from "@/lib/admin";

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: "en", localeReady: true, setLang: vi.fn(), t }),
  };
});

const workflow = (revisionLimit = 2): ActiveMissionWorkflow => ({
  workflow: {
    id: "workflow-1",
    revision_limit: revisionLimit,
    revision_response_hours: 1_000_000,
    deadline: "2099-07-21T12:00:00.000Z",
  },
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
      state: "under_review",
      deadline: "2099-07-21T12:00:00.000Z",
      current_reviewer_id: "reviewer-1",
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

function twoDeliverableWorkflow(): ActiveMissionWorkflow {
  const result = workflow(0);
  result.workItems[0] = { ...result.workItems[0], title: "Deliverable A" };
  result.workItems.push({
    ...result.workItems[0],
    id: "work-item-b",
    title: "Deliverable B",
    current_submitted_version_id: "version-b",
  });
  result.versions.push({
    ...result.versions[0],
    id: "version-b",
    mission_work_item_id: "work-item-b",
  });
  return result;
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

  it("shows assets attached to the exact submitted version only", () => {
    const activeWorkflow = workflow();
    activeWorkflow.assets.push({
      ...activeWorkflow.assets[0],
      id: "working-asset",
      mission_draft_version_id: null,
      original_filename: "working-copy.mp4",
      signedUrl: "https://example.com/signed/working-copy.mp4",
    });

    renderReview({ workflow: activeWorkflow });

    expect(screen.getByRole("link", { name: "reel.mp4" })).toBeVisible();
    expect(screen.queryByText("working-copy.mp4")).not.toBeInTheDocument();
  });

  it("starts review for the exact selected work item", async () => {
    const submitted = workflow();
    submitted.workItems[0] = {
      ...submitted.workItems[0],
      state: "submitted",
      current_reviewer_id: null,
    };
    const handlers = renderReview({ workflow: submitted });
    expect(screen.getByRole("button", { name: "Request revision" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve version" })).toBeDisabled();
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
    expect(screen.getByLabelText("Revision deadline")).not.toHaveValue("");

    fireEvent.change(screen.getByLabelText("Required change 1"), {
      target: { value: "Use the approved disclosure wording" },
    });
    fireEvent.change(screen.getByLabelText("Revision deadline"), {
      target: { value: "2099-07-21T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));

    await waitFor(() => expect(handlers.onRequestRevision).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "work-item-2",
      expectedState: "under_review",
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
      expectedState: "under_review",
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

  it("blocks review decisions after revision_requested and shipping after received", () => {
    const closed = workflow();
    closed.workItems[0] = { ...closed.workItems[0], state: "revision_requested" };
    closed.fulfillment = { status: "received" };
    const handlers = renderReview({ workflow: closed });

    expect(screen.getByRole("button", { name: "Request revision" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve version" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Mark shipped" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve version" }));
    expect(handlers.onRequestRevision).not.toHaveBeenCalled();
    expect(handlers.onApproveVersion).not.toHaveBeenCalled();
    expect(handlers.onMarkShipped).not.toHaveBeenCalled();
  });

  it("allows shipping only while fulfillment is preparing", () => {
    const preparing = workflow();
    preparing.fulfillment = { status: "preparing" };
    renderReview({ workflow: preparing });

    expect(screen.getByRole("button", { name: "Mark shipped" })).toBeEnabled();
  });

  it("announces action failures and preserves the original error for auth handling", async () => {
    const error = new AdminRequestError("The workflow changed", "WORKFLOW_STALE");
    const onActionError = vi.fn();
    renderReview({
      onApproveVersion: vi.fn().mockRejectedValue(error),
      onActionError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve version" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("WORKFLOW_STALE: The workflow changed");
    expect(onActionError).toHaveBeenCalledWith(error);
  });

  it("clears action state when switching deliverables", async () => {
    const handlers = renderReview({ workflow: twoDeliverableWorkflow() });

    fireEvent.change(screen.getByLabelText("Grant reason"), {
      target: { value: "Brief changed for A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant another revision" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Request revision" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    fireEvent.change(screen.getByLabelText("Required change 1"), {
      target: { value: "A-only feedback" },
    });
    fireEvent.change(screen.getByLabelText("Revision deadline"), {
      target: { value: "2099-07-21T10:00" },
    });

    fireEvent.change(screen.getByLabelText("Deliverable"), {
      target: { value: "work-item-b" },
    });

    expect(screen.getByRole("heading", { name: "Deliverable B" })).toBeVisible();
    expect(screen.queryByLabelText("Required change 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Grant reason")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Request revision" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Grant reason"), {
      target: { value: "Brief changed for B" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant another revision" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Request revision" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    expect(screen.getByLabelText("Required change 1")).toHaveValue("");
    expect(screen.getByLabelText("Revision deadline")).not.toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));

    expect(screen.getByText("Add at least one required change")).toBeVisible();
    expect(handlers.onRequestRevision).not.toHaveBeenCalled();
  });

  it("defaults and caps the revision deadline at the strictest workflow contract", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    try {
      const constrained = workflow();
      constrained.workflow.revision_response_hours = 48;
      constrained.workflow.deadline = "2026-07-21T12:00:00.000Z";
      constrained.workItems[0] = {
        ...constrained.workItems[0],
        deadline: "2026-07-22T12:00:00.000Z",
      };
      const handlers = renderReview({ workflow: constrained });

      fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
      const input = screen.getByLabelText("Revision deadline") as HTMLInputElement;
      expect(input.value).toBe(input.max);
      expect(new Date(input.value).toISOString()).toBe("2026-07-21T12:00:00.000Z");

      fireEvent.change(screen.getByLabelText("Required change 1"), { target: { value: "Tighten the opening" } });
      fireEvent.change(input, { target: { value: "2026-07-22T10:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
      expect(screen.getByText("Choose a deadline within the allowed response window")).toBeVisible();
      expect(handlers.onRequestRevision).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
