import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError, AdminRequestError } from "@/lib/admin";
import type { ActiveMissionQueueItem, ActiveMissionWorkflow } from "@/lib/admin";
import { ActiveMissionQueue } from "@/components/admin/ActiveMissionQueue";

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
  startProofReview: vi.fn(),
  requestProofCorrection: vi.fn(),
  verifyProof: vi.fn(),
  refreshProofMetadata: vi.fn(),
  setPublicationInstructions: vi.fn(),
  reportAuthError: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a href="/" className={className}>{children}</a>,
  };
});
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "reviewer-1", email: "op@example.com" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "demo", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...original,
    fetchActiveMissionQueue: h.fetchActiveMissionQueue,
    fetchActiveMissionWorkflow: h.fetchActiveMissionWorkflow,
    startActiveMissionReview: h.startActiveMissionReview,
    setActiveMissionPublicationInstructions: h.setPublicationInstructions,
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

  it("loads the canonical queue for the current workspace", async () => {
    const { Route } = await import("./admin.active-missions");
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
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchActiveMissionWorkflow.mockResolvedValue(operatorProofWorkflow());
    h.startProofReview.mockResolvedValue({});
    h.requestProofCorrection.mockResolvedValue({});
    h.verifyProof.mockResolvedValue({});
    h.refreshProofMetadata.mockResolvedValue({});
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
});
