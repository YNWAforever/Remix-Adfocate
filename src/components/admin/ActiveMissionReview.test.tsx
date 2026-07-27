import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveMissionReview } from "./ActiveMissionReview";
import { PublicationProofReview } from "./PublicationProofReview";
import { AdminRequestError } from "@/lib/admin";
import type { ActiveMissionWorkflow } from "@/lib/admin";

const localeState = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict[localeState.lang][key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: localeState.lang, localeReady: true, setLang: vi.fn(), t }),
  };
});

beforeEach(() => { localeState.lang = "en"; });

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

function proofWorkflow(state: "proof_submitted" | "proof_under_review" | "proof_verified" = "proof_under_review"): ActiveMissionWorkflow {
  const result = workflow();
  result.workItems[0] = {
    ...result.workItems[0], state, approved_version_id: "version-2",
    current_proof_attempt_id: "attempt-2", revision: 7,
  } as ActiveMissionWorkflow["workItems"][number];
  result.publicationInstructions = [{
    id: "instructions-1", workItemId: "work-item-2",
    publicationInstructions: "Publish the approved reel without edits.",
    publicationWindowHours: 48, requiredDisclosures: ["#ad"], expectedAccount: "@amy",
    proofEvidencePolicy: { required: true }, publicationDueAt: "2099-07-21T12:00:00.000Z",
    frozenAt: "2099-07-19T12:00:00.000Z", revision: 1,
  }];
  result.proofAttempts = [{
    id: "attempt-1", workItemId: "work-item-2", attemptNumber: 1,
    primaryUrl: "https://www.instagram.com/p/first", additionalUrls: [],
    submittedAt: "2099-07-19T13:00:00.000Z", submittedLate: false,
    metadataStatus: "unavailable", metadataSnapshot: { privilegedFetchTrace: "must-not-render" },
    metadataErrorCategory: "network",
  }, {
    id: "attempt-2", workItemId: "work-item-2", attemptNumber: 2,
    primaryUrl: "https://www.instagram.com/p/current",
    additionalUrls: ["https://www.instagram.com/reel/current"],
    submittedAt: "2099-07-20T13:00:00.000Z", submittedLate: true,
    metadataStatus: "available",
    metadataSnapshot: {
      pageTitle: "Amy's approved reel", finalCanonicalUrl: "https://www.instagram.com/p/current",
      httpStatusCategory: "success", fetchedAt: "2099-07-20T13:00:01.000Z",
      privilegedFetchTrace: "must-not-render",
    },
    metadataErrorCategory: null,
  }];
  result.proofReviews = [{
    id: "proof-review-1", attemptId: "attempt-1", reviewNumber: 1,
    state: "correction_requested", decision: "correction_requested", reviewerId: "reviewer-1",
    reviewedAt: "2099-07-19T14:00:00.000Z", decisionAt: "2099-07-19T14:00:00.000Z",
    creatorResponseDeadline: "2099-07-20T14:00:00.000Z", checklist: null,
    summary: "Update the disclosure.",
    items: [{ id: "proof-item-1", category: "disclosure", text: "Add #ad.", passed: false, position: 0 }],
  }, {
    id: "proof-review-2", attemptId: "attempt-2", reviewNumber: 2,
    state: state === "proof_verified" ? "verified" : "open",
    decision: state === "proof_verified" ? "verified" : null,
    reviewerId: state === "proof_submitted" ? null : "reviewer-1",
    reviewedAt: "2099-07-20T14:00:00.000Z",
    decisionAt: state === "proof_verified" ? "2099-07-20T15:00:00.000Z" : null,
    creatorResponseDeadline: null, checklist: null, summary: null, items: [],
  }];
  result.proofAssets = [{
    id: "proof-asset-1", attemptId: "attempt-2", originalFilename: "analytics.png",
    contentType: "image/png", sizeBytes: 1024, createdAt: "2099-07-20T13:00:00.000Z",
    signedUrl: "https://signed.example.com/evidence",
  }];
  return result;
}

function renderProof(overrides: Partial<React.ComponentProps<typeof PublicationProofReview>> = {}) {
  const handlers = {
    onClaim: vi.fn().mockResolvedValue({}), onRequestCorrection: vi.fn().mockResolvedValue({}),
    onVerify: vi.fn().mockResolvedValue({}), onRefreshMetadata: vi.fn().mockResolvedValue({}),
    onSetInstructions: vi.fn().mockResolvedValue({}),
    onSetupExistingInstructions: vi.fn().mockResolvedValue({}),
  };
  render(<PublicationProofReview workflow={proofWorkflow()} selectedWorkItemId="work-item-2"
    currentOperatorId="reviewer-1" {...handlers} {...overrides} />);
  return handlers;
}

describe("PublicationProofReview", () => {
  it("shows approved content, safe proof links, bounded metadata, signed evidence, and history", () => {
    renderProof();
    expect(screen.getByRole("heading", { name: "Publication proof attempt 2" })).toBeVisible();
    expect(screen.getByText("Ready for summer.")).toBeVisible();
    expect(screen.getByRole("link", { name: "reel.mp4" })).toHaveAttribute("href", "https://example.com/signed/reel.mp4");
    expect(screen.getByText("Publish the approved reel without edits.")).toBeVisible();
    expect(screen.getByText("#ad")).toBeVisible();
    expect(screen.getByRole("link", { name: "Primary published URL" })).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(screen.getByText("Amy's approved reel")).toBeVisible();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "analytics.png" })).toHaveAttribute("href", "https://signed.example.com/evidence");
    expect(screen.getByText("Update the disclosure.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /reward/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("proof-review-actions")).toHaveClass("sticky", "bottom-0");
  });

  it("requires all six checklist answers and the exact attempt number before verification", async () => {
    const handlers = renderProof();
    const labels = ["Publicly accessible", "Platform matches", "Account matches",
      "Content matches approved version", "Timing acceptable", "Disclosures present"];
    expect(screen.getByRole("button", { name: "Verify proof" })).toBeDisabled();
    labels.forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    expect(screen.getByRole("button", { name: "Verify proof" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
    expect(screen.getByText("Verify publication proof attempt 2?")).toBeVisible();
    expect(screen.getByText("No reward is issued by this action.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Type attempt number 2 to confirm"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
    await waitFor(() => expect(handlers.onVerify).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "work-item-2", attemptId: "attempt-2",
      expectedState: "proof_under_review", expectedRevision: 7,
      checklist: {
        publiclyAccessible: true, platformMatches: true, accountMatches: true,
        contentMatchesApprovedVersion: true, timingAcceptable: true, disclosuresPresent: true,
      },
    })));
  });

  it("treats exact-attempt verification as an alert dialog with keyboard-safe focus restoration", async () => {
    renderProof();
    [
      "Publicly accessible",
      "Platform matches",
      "Account matches",
      "Content matches approved version",
      "Timing acceptable",
      "Disclosures present",
    ].forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    const trigger = screen.getByRole("button", { name: "Verify proof" });

    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog", { name: "Verify publication proof attempt 2?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Type attempt number 2 to confirm")).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel verification" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps keyboard focus within the verification confirmation", () => {
    renderProof();
    [
      "Publicly accessible",
      "Platform matches",
      "Account matches",
      "Content matches approved version",
      "Timing acceptable",
      "Disclosures present",
    ].forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
    fireEvent.change(screen.getByLabelText("Type attempt number 2 to confirm"), { target: { value: "2" } });

    const confirmation = screen.getByRole("button", { name: "Confirm verification" });
    confirmation.focus();
    expect(fireEvent.keyDown(confirmation, { key: "Tab" })).toBe(false);
    expect(screen.getByLabelText("Type attempt number 2 to confirm")).toHaveFocus();
  });

  it("creates and focuses the first categorized correction from the empty sticky action", async () => {
    renderProof();
    expect(screen.queryByLabelText("Correction 1")).not.toBeInTheDocument();
    expect(screen.getByTestId("proof-review-actions")).toHaveClass("sticky", "bottom-0");

    fireEvent.click(screen.getByRole("button", { name: "Request correction" }));

    expect(await screen.findByLabelText("Correction 1")).toHaveFocus();
    expect(screen.getByLabelText("Correction category 1")).toHaveValue("other");
  });

  it("validates categorized corrections and claims an unowned submitted attempt", async () => {
    const handlers = renderProof({ workflow: proofWorkflow("proof_submitted") });
    expect(screen.getByRole("button", { name: "Request correction" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Claim review" }));
    await waitFor(() => expect(handlers.onClaim).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-2", expectedState: "proof_submitted", expectedRevision: 7,
    })));
    const claimedHandlers = renderProof({ workflow: proofWorkflow("proof_under_review") });
    fireEvent.click(screen.getByRole("button", { name: "Add correction" }));
    fireEvent.click(screen.getByRole("button", { name: "Send correction request" }));
    expect(screen.getByText("Add at least one categorized correction.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Correction category 1"), { target: { value: "disclosure" } });
    fireEvent.change(screen.getByLabelText("Correction 1"), { target: { value: "Add the approved #ad disclosure." } });
    fireEvent.click(screen.getByRole("button", { name: "Send correction request" }));
    await waitFor(() => expect(claimedHandlers.onRequestCorrection).toHaveBeenCalledWith(expect.objectContaining({
      corrections: [{ category: "disclosure", text: "Add the approved #ad disclosure.", position: 0 }],
    })));
  });

describe("PublicationProofReview localization and setup", () => {
  it("renders the operator proof experience in Traditional Chinese", () => {
    localeState.lang = "zh";
    renderProof();
    expect(screen.getByRole("heading", { name: "發佈證明第 2 次提交" })).toBeVisible();
    expect(screen.getByText("已凍結的發佈指示")).toBeVisible();
    expect(screen.getByRole("button", { name: "核實證明" })).toBeVisible();
  });

  it("validates and submits explicit publication setup for approved legacy work", async () => {
    const setupWorkflow = proofWorkflow();
    setupWorkflow.workItems[0] = {
      ...setupWorkflow.workItems[0],
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      publicationSetupRequired: true,
    };
    setupWorkflow.publicationInstructions = [];
    setupWorkflow.proofAttempts = [];
    setupWorkflow.proofReviews = [];
    const handlers = renderProof({ workflow: setupWorkflow });
    fireEvent.click(screen.getByRole("button", { name: "Set up publication proof" }));
    expect(screen.getByText("Complete the publication instructions and window, then confirm the frozen setup.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Publication instructions"), { target: { value: "Publish exactly as approved." } });
    fireEvent.change(screen.getByLabelText("Publication window (hours)"), { target: { value: "48" } });
    fireEvent.change(screen.getByLabelText("Required disclosures (one per line)"), { target: { value: "#ad\nPaid partnership" } });
    fireEvent.change(screen.getByLabelText("Expected account (optional)"), { target: { value: "@amy" } });
    fireEvent.click(screen.getByLabelText("Require private evidence"));
    fireEvent.click(screen.getByLabelText("I confirm these complete instructions will be frozen immediately."));
    fireEvent.click(screen.getByRole("button", { name: "Set up publication proof" }));
    await waitFor(() => expect(handlers.onSetupExistingInstructions).toHaveBeenCalledWith(expect.objectContaining({
      expectedState: "approved_to_publish", expectedRevision: 7,
      instructions: expect.objectContaining({
        publicationInstructions: "Publish exactly as approved.",
        requiredDisclosures: ["#ad", "Paid partnership"], expectedAccount: "@amy",
        proofEvidencePolicy: { required: true },
      }),
    })));
    expect(handlers.onSetInstructions).not.toHaveBeenCalled();
  });

  it("omits a false private-evidence flag from legacy publication setup", async () => {
    const setupWorkflow = proofWorkflow();
    setupWorkflow.workItems[0] = {
      ...setupWorkflow.workItems[0],
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      publicationSetupRequired: true,
    };
    setupWorkflow.publicationInstructions = [];
    setupWorkflow.proofAttempts = [];
    setupWorkflow.proofReviews = [];
    const handlers = renderProof({ workflow: setupWorkflow });
    fireEvent.change(screen.getByLabelText("Publication instructions"), { target: { value: "Publish exactly as approved." } });
    fireEvent.change(screen.getByLabelText("Publication window (hours)"), { target: { value: "48" } });
    fireEvent.click(screen.getByLabelText("I confirm these complete instructions will be frozen immediately."));
    fireEvent.click(screen.getByRole("button", { name: "Set up publication proof" }));

    await waitFor(() => expect(handlers.onSetupExistingInstructions).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.objectContaining({
        proofEvidencePolicy: {},
      }),
    })));
  });

  it("does not infer setup eligibility from missing instructions", () => {
    const setupWorkflow = proofWorkflow();
    setupWorkflow.workItems[0] = {
      ...setupWorkflow.workItems[0],
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      publicationSetupRequired: false,
    };
    setupWorkflow.publicationInstructions = [];
    setupWorkflow.proofAttempts = [];
    setupWorkflow.proofReviews = [];
    setupWorkflow.events = [{
      mission_work_item_id: setupWorkflow.workItems[0].id,
      event_type: "mission_publication_existing_instructions_setup",
      metadata: { idempotency_key: "history-only" },
    }];

    renderProof({ workflow: setupWorkflow });

    expect(screen.queryByRole("button", { name: "Set up publication proof" })).not.toBeInTheDocument();
  });
});
});
