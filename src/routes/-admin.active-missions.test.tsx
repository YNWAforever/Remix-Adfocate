import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveMissionQueueItem } from "@/lib/admin";
import { ActiveMissionQueue } from "@/components/admin/ActiveMissionQueue";

const h = vi.hoisted(() => ({ fetchActiveMissionQueue: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "reviewer-1", email: "op@example.com" }, reportAuthError: vi.fn() }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "demo", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin")>();
  return { ...original, fetchActiveMissionQueue: h.fetchActiveMissionQueue };
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

describe("ActiveMissionQueue", () => {
  it("keeps server order and shows the required review metadata", () => {
    render(<ActiveMissionQueue items={items} now={new Date("2026-07-19T09:00:00.000Z")} />);
    const cards = screen.getAllByTestId("queue-item");
    expect(cards[0]).toHaveTextContent("Due today");
    expect(cards[0]).toHaveTextContent("Instagram reel");
    expect(cards[0]).toHaveTextContent("Summer launch");
    expect(cards[0]).toHaveTextContent("Amy Wong");
    expect(cards[0]).toHaveTextContent("Unassigned");
    expect(cards[0]).toHaveTextContent("Submitted 7 hours ago");
    expect(cards[1]).toHaveTextContent("reviewer-1");
  });

  it("emits SLA risk, state, reviewer, and mission filters without sorting locally", () => {
    const onFiltersChange = vi.fn();
    render(<ActiveMissionQueue items={items} filters={{}} onFiltersChange={onFiltersChange} />);
    fireEvent.change(screen.getByLabelText("SLA risk"), { target: { value: "overdue" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ risk: "overdue" });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "under_review" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ state: "under_review" });
    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "reviewer-1" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ reviewer: "reviewer-1" });
    fireEvent.change(screen.getByLabelText("Mission"), { target: { value: "mission-1" } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ mission: "mission-1" });
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
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Component />
      </QueryClientProvider>,
    );
    await screen.findByText("Amy Wong");
    await waitFor(() => expect(h.fetchActiveMissionQueue).toHaveBeenCalledWith({ workspace: "demo" }));
    const cards = screen.getAllByTestId("queue-item");
    expect(cards[0]).toHaveTextContent("Amy Wong");
    expect(cards[1]).toHaveTextContent("Ben Lee");
  });
});
