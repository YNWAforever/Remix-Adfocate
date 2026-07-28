import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError, AdminRequestError } from "@/lib/admin";
import type { ActiveMissionQueueItem, ActiveMissionWorkflow } from "@/lib/admin";
import { ActiveMissionQueue } from "@/components/admin/ActiveMissionQueue";
import { setActivationAnalyticsSink } from "@/lib/activationAnalytics";

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: "en", localeReady: true, setLang: vi.fn(), t }),
  };
});

const h = vi.hoisted(() => ({
  fetchActiveMissionQueue: vi.fn(),
  fetchActiveMissionWorkflow: vi.fn(),
  startActiveMissionReview: vi.fn(),
  requestActiveMissionRevision: vi.fn(),
  grantActiveMissionRevision: vi.fn(),
  approveActiveMissionVersion: vi.fn(),
  markActiveMissionShipped: vi.fn(),
  startProofReview: vi.fn(),
  requestProofCorrection: vi.fn(),
  verifyProof: vi.fn(),
  refreshProofMetadata: vi.fn(),
  setPublicationInstructions: vi.fn(),
  setupExistingPublicationInstructions: vi.fn(),
  reportAuthError: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a href="/" className={className}>{children}</a>,
    Outlet: () => <div data-testid="admin-active-missions-outlet" />,
  };
});
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "reviewer-1", email: "op@example.com" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "workspace-id", workspaceSlug: "demo", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...original,
    fetchActiveMissionQueue: h.fetchActiveMissionQueue,
    fetchActiveMissionWorkflow: h.fetchActiveMissionWorkflow,
    startActiveMissionReview: h.startActiveMissionReview,
    requestActiveMissionRevision: h.requestActiveMissionRevision,
    grantActiveMissionRevision: h.grantActiveMissionRevision,
    approveActiveMissionVersion: h.approveActiveMissionVersion,
    markActiveMissionShipped: h.markActiveMissionShipped,
    setActiveMissionPublicationInstructions: h.setPublicationInstructions,
    setupActiveMissionPublicationInstructions: h.setupExistingPublicationInstructions,
  };
});
vi.mock("@/lib/queries/activeMission", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queries/activeMission")>();
  return {
    ...original,
    useStartProofReview: () => ({ mutateAsync: h.startProofReview, isPending: false }),
    useRequestProofCorrection: () => ({ mutateAsync: h.requestProofCorrection, isPending: false }),
    useVerifyProof: () => ({ mutateAsync: h.verifyProof, isPending: false }),
    useRefreshProofMetadata: () => ({ mutateAsync: h.refreshProofMetadata, isPending: false }),
  };
});

const items: ActiveMissionQueueItem[] = [
  {
    workflowId: "workflow-today",
    workItemId: "item-today",
    missionId: "mission-1",
    creatorDisplayName: "Amy Wong",
    missionTitle: "Summer launch",
    deliverableTitle: "Instagram reel",
    state: "submitted",
    creatorDeadline: "2026-07-20T18:00:00.000Z",
    submittedAt: "2026-07-19T02:00:00.000Z",
    reviewDueAt: "2026-07-19T18:00:00.000Z",
    reviewerId: null,
    riskBucket: "due_soon",
    proofAttemptId: "attempt-today",
    proofAttemptNumber: 2,
    submittedLate: true,
    metadataStatus: "unavailable",
  },
  {
    workflowId: "workflow-later",
    workItemId: "item-later",
    missionId: "mission-2",
    creatorDisplayName: "Ben Lee",
    missionTitle: "Autumn launch",
    deliverableTitle: "Story set",
    state: "under_review",
    creatorDeadline: "2026-07-23T18:00:00.000Z",
    submittedAt: "2026-07-18T02:00:00.000Z",
    reviewDueAt: "2026-07-21T18:00:00.000Z",
    reviewerId: "reviewer-1",
    riskBucket: "on_track",
  },
];

const detailWorkflow: ActiveMissionWorkflow = {
  workflow: { id: "workflow-today", revision_limit: 2 },
  submission: {
    creators: { id: "creator-1", display_name: "Amy Wong" },
    missions: {
      id: "mission-1",
      title: "Summer launch",
      mission_type: "ugc",
      description: null,
      key_messages: [],
      dos: [],
      donts: [],
    },
  },
  workItems: [{
    id: "item-today",
    title: "Instagram reel",
    platform: "instagram",
    position: 0,
    state: "submitted",
    deadline: "2099-07-20T12:00:00.000Z",
    current_reviewer_id: null,
    current_submitted_version_id: "version-1",
    approved_version_id: null,
    requirements_snapshot: [],
  }],
  fulfillment: null,
  versions: [{
    id: "version-1",
    mission_work_item_id: "item-today",
    version_number: 1,
    caption_snapshot: "Ready.",
    external_draft_url_snapshot: null,
    checklist_snapshot: {},
    submitted_at: "2026-07-19T02:00:00.000Z",
  }],
  reviews: [],
  grants: [],
  events: [],
  assets: [],
};

function renderWithQueryClient(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("ActiveMissionQueue", () => {
  it("keeps server order and shows the required review metadata", () => {
    render(<ActiveMissionQueue items={items} now={new Date("2026-07-19T09:00:00.000Z")} />);
    const cards = screen.getAllByTestId("queue-item");
    expect(cards[0]).toHaveTextContent("Due today");
    expect(cards[0]).toHaveTextContent("Instagram reel");
    expect(cards[0]).toHaveTextContent("Summer launch");
    expect(cards[0]).toHaveTextContent("Amy Wong");
    expect(cards[0]).toHaveTextContent("Unassigned");
    expect(cards[0]).toHaveTextContent("Submitted late");
    expect(cards[0]).toHaveTextContent("unavailable");
    expect(cards[0]).toHaveTextContent("Submitted 7 hours ago");
    expect(cards[1]).toHaveTextContent("reviewer-1");
  });

  it("waits for an explicit apply before emitting UUID filters", () => {
    const onFiltersChange = vi.fn();
    render(<ActiveMissionQueue items={items} filters={{}} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText("SLA risk"), { target: { value: "overdue" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "under_review" } });
    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "reviewer-1" } });
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "mission-1" } });
    expect(onFiltersChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({
      risk: "overdue", state: "under_review", reviewer: "reviewer-1", mission: "mission-1",
    });
    expect(within(screen.getAllByTestId("queue-item")[0]).getByText("Amy Wong")).toBeVisible();
  });
});

describe("admin active missions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchActiveMissionQueue.mockResolvedValue({ items });
  });
  it("renders nested active-mission routes through the parent outlet", async () => {
    const { Route } = await import("./admin.active-missions");
    const Component = Route.options.component as React.ComponentType;
    renderWithQueryClient(<Component />);
    expect(screen.getByTestId("admin-active-missions-outlet")).toBeVisible();
  });

  it("loads the canonical queue for the current workspace", async () => {
    const { Route } = await import("./admin.active-missions.index");
    const Component = Route.options.component as React.ComponentType;
    renderWithQueryClient(<Component />);
    await screen.findByText("Amy Wong");
    await waitFor(() => expect(h.fetchActiveMissionQueue).toHaveBeenCalledWith({ workspace: "demo" }));
    const cards = screen.getAllByTestId("queue-item");
    expect(cards[0]).toHaveTextContent("Amy Wong");
    expect(cards[1]).toHaveTextContent("Ben Lee");
  });

  it("binds detail actions and routes auth failures through the admin auth context", async () => {
    const authError = new AdminAuthError("unauthorized");
    h.fetchActiveMissionWorkflow.mockResolvedValue(detailWorkflow);
    h.startActiveMissionReview.mockRejectedValue(authError);
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");

    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );

    await screen.findByRole("heading", { name: "Instagram reel" });
    expect(h.fetchActiveMissionWorkflow).toHaveBeenCalledWith("workflow-today", "demo");
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("unauthorized");
    expect(h.startActiveMissionReview).toHaveBeenCalledWith(
      "workflow-today",
      "item-today",
      { workspace: "demo", expectedState: "submitted" },
    );
    expect(h.reportAuthError).toHaveBeenCalledWith(authError);
  });
  it("passes the canonical workspace slug to revision, approval, and shipping actions", async () => {
    const reviewWorkflow = structuredClone(detailWorkflow);
    reviewWorkflow.workItems[0] = {
      ...reviewWorkflow.workItems[0], state: "under_review", current_reviewer_id: "reviewer-1",
    };
    reviewWorkflow.fulfillment = { status: "preparing" };
    h.fetchActiveMissionWorkflow.mockResolvedValue(reviewWorkflow);
    h.requestActiveMissionRevision.mockResolvedValue({});
    h.approveActiveMissionVersion.mockResolvedValue({});
    h.markActiveMissionShipped.mockResolvedValue({});
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");

    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    await screen.findByRole("heading", { name: "Instagram reel" });

    fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
    fireEvent.change(screen.getByLabelText("Required change 1"), {
      target: { value: "Use the approved disclosure wording" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send revision request" }));
    await waitFor(() => expect(h.requestActiveMissionRevision).toHaveBeenCalledWith(
      "workflow-today",
      "item-today",
      expect.objectContaining({
        workspace: "demo", expectedState: "under_review", versionId: "version-1",
      }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Approve version" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(h.approveActiveMissionVersion).toHaveBeenCalledWith(
      "workflow-today",
      "item-today",
      { workspace: "demo", expectedState: "under_review", versionId: "version-1" },
    ));

    fireEvent.click(screen.getByRole("button", { name: "Mark shipped" }));
    fireEvent.change(screen.getByLabelText("Shipping note"), {
      target: { value: "Courier collected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm shipped" }));
    await waitFor(() => expect(h.markActiveMissionShipped).toHaveBeenCalledWith(
      "workflow-today",
      { workspace: "demo", note: "Courier collected" },
    ));
  });

  it("passes the canonical workspace slug when granting another revision", async () => {
    const exhausted = structuredClone(detailWorkflow);
    exhausted.workflow.revision_limit = 1;
    exhausted.workItems[0] = {
      ...exhausted.workItems[0], state: "under_review", current_reviewer_id: "reviewer-1",
    };
    exhausted.reviews = [{
      id: "review-1",
      mission_work_item_id: "item-today",
      mission_draft_version_id: "version-1",
      round_number: 1,
      state: "revision_requested",
      mission_review_items: [],
    }];
    h.fetchActiveMissionWorkflow.mockResolvedValue(exhausted);
    h.grantActiveMissionRevision.mockResolvedValue({});
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");

    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.change(await screen.findByLabelText("Grant reason"), {
      target: { value: "The mission brief changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant another revision" }));

    await waitFor(() => expect(h.grantActiveMissionRevision).toHaveBeenCalledWith(
      "workflow-today",
      "item-today",
      { workspace: "demo", reason: "The mission brief changed", grantedCount: 1 },
    ));
  });});

describe("publication proof queue filters", () => {
  it("applies proof state, lateness, metadata, platform, deadline, mission, and reviewer only after Apply", () => {
    const onFiltersChange = vi.fn();
    render(<ActiveMissionQueue items={items} filters={{}} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText("Proof state"), { target: { value: "proof_submitted" } });
    fireEvent.change(screen.getByLabelText("Lateness"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Metadata status"), { target: { value: "unavailable" } });
    fireEvent.change(screen.getByLabelText("Platform"), { target: { value: "instagram" } });
    fireEvent.change(screen.getByLabelText("Publication deadline"), { target: { value: "overdue" } });
    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "reviewer-1" } });
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "mission-1" } });
    expect(onFiltersChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      proofState: "proof_submitted",
      late: true,
      metadataStatus: "unavailable",
      platform: "instagram",
      publicationDeadline: "overdue",
      reviewer: "reviewer-1",
      mission: "mission-1",
    });
    expect(screen.getAllByTestId("queue-item")[0]).toHaveTextContent("Amy Wong");
    fireEvent.change(screen.getByLabelText("Lateness"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ late: false }));
  });
});

function operatorProofWorkflow(): ActiveMissionWorkflow {
  const value = structuredClone(detailWorkflow);
  value.workflow.review_sla_hours = 48;
  value.workItems[0] = {
    ...value.workItems[0], state: "proof_under_review", approved_version_id: "version-1",
    current_proof_attempt_id: "attempt-current", revision: 4,
  };
  value.publicationInstructions = [{
    id: "instruction-1", workItemId: "item-today", publicationInstructions: "Publish exactly as approved.",
    publicationWindowHours: 24, requiredDisclosures: ["#ad"], expectedAccount: "@amy",
    proofEvidencePolicy: {}, publicationDueAt: "2099-07-21T12:00:00.000Z",
    frozenAt: "2099-07-20T12:00:00.000Z", revision: 1,
  }];
  value.proofAttempts = [{
    id: "attempt-current", workItemId: "item-today", attemptNumber: 3,
    primaryUrl: "https://www.instagram.com/p/current", additionalUrls: [],
    submittedAt: "2099-07-20T13:00:00.000Z", submittedLate: false,
    metadataStatus: "available", metadataSnapshot: { pageTitle: "Current proof" },
    metadataErrorCategory: null,
  }];
  value.proofReviews = [{
    id: "review-current", attemptId: "attempt-current", reviewNumber: 1, state: "open",
    decision: null, reviewerId: "reviewer-1", reviewedAt: "2099-07-20T14:00:00.000Z",
    decisionAt: null, creatorResponseDeadline: null, checklist: null, summary: null, items: [],
  }];
  value.proofAssets = [];
  return value;
}

describe("admin publication proof review route", () => {
  const analyticsEvents: Array<{ name: string; properties: Record<string, unknown> }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchActiveMissionWorkflow.mockResolvedValue(operatorProofWorkflow());
    h.startProofReview.mockResolvedValue({});
    h.requestProofCorrection.mockResolvedValue({});
    h.verifyProof.mockResolvedValue({});
    h.refreshProofMetadata.mockResolvedValue({});
    h.setupExistingPublicationInstructions.mockResolvedValue({});
    analyticsEvents.length = 0;
    setActivationAnalyticsSink((event) => {
      analyticsEvents.push(event as { name: string; properties: Record<string, unknown> });
    });
  });

  afterEach(() => {
    setActivationAnalyticsSink(null);
  });

  it("routes a server-reported setup requirement through the separate compatibility client", async () => {
    const setup = operatorProofWorkflow();
    setup.workItems[0] = {
      ...setup.workItems[0],
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      publicationSetupRequired: true,
    };
    setup.publicationInstructions = [];
    setup.proofAttempts = [];
    setup.proofReviews = [];
    h.fetchActiveMissionWorkflow.mockResolvedValue(setup);
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");

    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );

    await screen.findByRole("button", { name: "Set up publication proof" });
    fireEvent.change(screen.getByLabelText("Publication instructions"), {
      target: { value: "Publish exactly as approved." },
    });
    fireEvent.change(screen.getByLabelText("Publication window (hours)"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByLabelText("I confirm these complete instructions will be frozen immediately."));
    fireEvent.click(screen.getByRole("button", { name: "Set up publication proof" }));

    await waitFor(() => expect(h.setupExistingPublicationInstructions).toHaveBeenCalledWith(
      "workflow-today",
      "item-today",
      expect.objectContaining({
        workspace: "demo",
        expectedState: "approved_to_publish",
        expectedRevision: 4,
        idempotencyKey: expect.any(String),
        instructions: expect.objectContaining({
          publicationInstructions: "Publish exactly as approved.",
          publicationWindowHours: 24,
        }),
      }),
    ));
    expect(h.setPublicationInstructions).not.toHaveBeenCalled();
  });

  it("refreshes a setup race reported as WRONG_STATE and hides history-only setup", async () => {
    const setup = operatorProofWorkflow();
    setup.workItems[0] = {
      ...setup.workItems[0],
      state: "approved_to_publish",
      current_proof_attempt_id: null,
      publicationSetupRequired: true,
    };
    setup.publicationInstructions = [];
    setup.proofAttempts = [];
    setup.proofReviews = [];
    const recovered = structuredClone(setup);
    recovered.workItems[0].publicationSetupRequired = false;
    recovered.events = [{
      mission_work_item_id: "item-today",
      event_type: "mission_publication_existing_instructions_setup",
      metadata: { idempotency_key: "history-only" },
    }];
    h.fetchActiveMissionWorkflow
      .mockResolvedValueOnce(setup)
      .mockResolvedValue(recovered);
    h.setupExistingPublicationInstructions.mockRejectedValueOnce(
      new AdminRequestError("state progressed", "WRONG_STATE"),
    );
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");

    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );

    await screen.findByRole("button", { name: "Set up publication proof" });
    fireEvent.change(screen.getByLabelText("Publication instructions"), {
      target: { value: "Publish exactly as approved." },
    });
    fireEvent.change(screen.getByLabelText("Publication window (hours)"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByLabelText(
      "I confirm these complete instructions will be frozen immediately.",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Set up publication proof" }));

    await waitFor(() => expect(h.fetchActiveMissionWorkflow.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Set up publication proof" }))
        .not.toBeInTheDocument();
    });
  });

  it("binds Task 9 proof hooks to the exact current attempt", async () => {
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(<AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />);
    await screen.findByRole("heading", { name: "Publication proof attempt 3" });
    ["Publicly accessible", "Platform matches", "Account matches",
      "Content matches approved version", "Timing acceptable", "Disclosures present"]
      .forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
    fireEvent.change(screen.getByLabelText("Type attempt number 3 to confirm"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
    await waitFor(() => expect(h.verifyProof).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "workflow-today", workItemId: "item-today", workspace: "demo",
      attemptId: "attempt-current", expectedState: "proof_under_review",
      expectedRevision: 4, idempotencyKey: expect.any(String),
    })));
  });

  it("reloads stale proof state and routes proof auth failures through AdminAuthContext", async () => {
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    const stale = operatorProofWorkflow();
    stale.workItems[0] = { ...stale.workItems[0], state: "proof_submitted" };
    stale.proofReviews![0] = { ...stale.proofReviews![0], reviewerId: null };
    h.fetchActiveMissionWorkflow.mockResolvedValue(stale);
    h.startProofReview.mockRejectedValueOnce(new AdminRequestError("changed", "WORKFLOW_STALE"));
    renderWithQueryClient(<AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />);
    await screen.findByRole("button", { name: "Claim review" });
    fireEvent.click(screen.getByRole("button", { name: "Claim review" }));
    await waitFor(() => expect(h.fetchActiveMissionWorkflow.mock.calls.length).toBeGreaterThan(1));

    h.startProofReview.mockRejectedValueOnce(new AdminAuthError("unauthorized"));
    fireEvent.click(screen.getByRole("button", { name: "Claim review" }));
    await waitFor(() => expect(h.reportAuthError).toHaveBeenCalledWith(expect.any(AdminAuthError)));
  });


  it("emits verified only after the canonical verify action succeeds", async () => {
    let resolveVerify!: (value: { reviewNumber: number }) => void;
    h.verifyProof.mockImplementationOnce(() => new Promise((resolve) => {
      resolveVerify = resolve;
    }));
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    await screen.findByRole("heading", { name: "Publication proof attempt 3" });
    ["Publicly accessible", "Platform matches", "Account matches",
      "Content matches approved version", "Timing acceptable", "Disclosures present"]
      .forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
    fireEvent.change(screen.getByLabelText("Type attempt number 3 to confirm"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();

    await act(async () => {
      resolveVerify({ reviewNumber: 1 });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Type attempt number 3 to confirm")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm verification" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify proof" })).toHaveFocus();
    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_verified",
    ));
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_verified")?.properties)
      .toEqual(expect.objectContaining({
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "proof_verified", attemptNumber: 3, reviewNumber: 1,
        metadataStatus: "available",
      }));
  });


  it("emits review-started only after claim succeeds", async () => {
    const submitted = operatorProofWorkflow();
    submitted.workItems[0] = { ...submitted.workItems[0], state: "proof_submitted" };
    submitted.proofReviews![0] = {
      ...submitted.proofReviews![0], reviewerId: null, state: "open",
    };
    h.fetchActiveMissionWorkflow.mockResolvedValue(submitted);
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Claim review" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_review_started",
    ));
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_review_started")?.properties)
      .toEqual(expect.objectContaining({
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "proof_under_review", attemptNumber: 3, reviewNumber: 1,
        metadataStatus: "available",
      }));
  });

  it("emits category-only correction telemetry after the correction succeeds", async () => {
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    await screen.findByRole("heading", { name: "Publication proof attempt 3" });
    fireEvent.click(screen.getByRole("button", { name: "Request correction" }));
    fireEvent.change(screen.getByLabelText("Correction category 1"), {
      target: { value: "content" },
    });
    fireEvent.change(screen.getByLabelText("Correction 1"), {
      target: { value: "Private operator correction prose" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send correction request" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_correction_requested",
    ));
    expect(h.requestProofCorrection).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "workflow-today", workItemId: "item-today", workspace: "demo",
      attemptId: "attempt-current", expectedState: "proof_under_review", expectedRevision: 4,
    }));
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_correction_requested")?.properties)
      .toEqual(expect.objectContaining({
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", attemptNumber: 3, reviewNumber: 1,
        checklistFailureCategories: ["content"],
      }));
    expect(JSON.stringify(analyticsEvents)).not.toContain("Private operator correction prose");
  });

  it("emits metadata recovery only for a real unavailable-to-available refresh", async () => {
    const unavailable = operatorProofWorkflow();
    unavailable.proofAttempts![0] = {
      ...unavailable.proofAttempts![0],
      metadataStatus: "unavailable",
      metadataErrorCategory: "private-network-detail",
    };
    h.fetchActiveMissionWorkflow.mockResolvedValue(unavailable);
    h.refreshProofMetadata.mockResolvedValue({
      attempt: { metadata_status: "available", metadata_error_category: null },
      idempotent: false,
    });
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh metadata" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_recovery_used",
    ));
    expect(h.refreshProofMetadata).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "workflow-today", workItemId: "item-today", workspace: "demo",
      attemptId: "attempt-current", expectedState: "proof_under_review", expectedRevision: 4,
    }));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_proof_recovery_used",
    ]);
    expect(analyticsEvents[0]?.properties).toEqual(expect.objectContaining({
      state: "proof_under_review",
      attemptNumber: 3,
      recoveryCategory: "metadata_unavailable",
    }));
    expect(JSON.stringify(analyticsEvents)).not.toContain("private-network-detail");
  });

  it("does not claim recovery when already-available metadata stays available", async () => {
    h.refreshProofMetadata.mockResolvedValue({
      attempt: { metadata_status: "available", metadata_error_category: null },
      idempotent: false,
    });
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh metadata" }));

    await waitFor(() => expect(h.refreshProofMetadata).toHaveBeenCalledTimes(1));
    expect(analyticsEvents).toEqual([]);
  });
  it("emits unavailable, not recovery, for an available-to-unavailable refresh", async () => {
    h.refreshProofMetadata.mockResolvedValue({
      attempt: {
        metadata_status: "unavailable",
        metadata_error_category: "private-network-detail",
      },
      idempotent: false,
    });
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh metadata" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_metadata_unavailable",
    ));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_proof_metadata_unavailable",
    ]);
    expect(JSON.stringify(analyticsEvents)).not.toContain("private-network-detail");
  });

  it("keeps an unavailable refresh classified as unavailable without claiming recovery", async () => {
    const unavailable = operatorProofWorkflow();
    unavailable.proofAttempts![0] = {
      ...unavailable.proofAttempts![0],
      metadataStatus: "unavailable",
      metadataErrorCategory: "private-network-detail",
    };
    h.fetchActiveMissionWorkflow.mockResolvedValue(unavailable);
    h.refreshProofMetadata.mockResolvedValue({
      attempt: {
        metadata_status: "unavailable",
        metadata_error_category: "private-network-detail",
      },
      idempotent: false,
    });
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Refresh metadata" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_metadata_unavailable",
    ));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_proof_metadata_unavailable",
    ]);
  });

  it("does not emit operator mutation outcomes when the action fails", async () => {
    h.verifyProof.mockRejectedValueOnce(new Error("failed verification"));
    const { AdminActiveMissionReviewView } = await import("./admin.active-missions.$workflowId");
    renderWithQueryClient(
      <AdminActiveMissionReviewView workflowId="workflow-today" workItemId="item-today" />,
    );
    await screen.findByRole("heading", { name: "Publication proof attempt 3" });
    ["Publicly accessible", "Platform matches", "Account matches",
      "Content matches approved version", "Timing acceptable", "Disclosures present"]
      .forEach((label) => fireEvent.click(screen.getByLabelText(label)));
    fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
    fireEvent.change(screen.getByLabelText("Type attempt number 3 to confirm"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("failed verification");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByLabelText("Type attempt number 3 to confirm")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Confirm verification" })).toBeEnabled();
    expect(analyticsEvents.map(({ name }) => name)).not.toContain("publication_proof_verified");
  });


});
