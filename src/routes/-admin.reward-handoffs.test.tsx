import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActivationAnalyticsSink } from "@/lib/activationAnalytics";
import type { RewardHandoffQueueItem } from "@/lib/adminRewardHandoff";

const h = vi.hoisted(() => ({
  authed: true,
  workspaceSlug: "alpha",
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  fetchRewardHandoffs: vi.fn(),
  setRewardProcessingWindow: vi.fn(),
  reportAuthError: vi.fn(),
  lang: "en" as "en" | "zh",
  localeReady: true,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => h.search,
    useNavigate: () => h.navigate,
  }),
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({
    authed: h.authed,
    reportAuthError: h.reportAuthError,
  }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({
    workspace: "workspace-id",
    workspaceSlug: h.workspaceSlug,
    setWorkspace: vi.fn(),
  }),
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    lang: h.lang,
    localeReady: h.localeReady,
    t: (key: string) => ({
      "app.admin.rewardHandoff.selectWorkspace": "Select a workspace.",
      "app.admin.rewardHandoff.loading": "Loading reward handoffs…",
      "app.admin.rewardHandoff.loadError": "Unable to load reward handoffs.",
      "app.admin.rewardHandoff.retry": "Retry reward handoffs",
    })[key] ?? key,
  }),
}));
vi.mock("@/lib/adminRewardHandoff", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/adminRewardHandoff")>();
  return {
    ...original,
    fetchRewardHandoffs: h.fetchRewardHandoffs,
    setRewardProcessingWindow: h.setRewardProcessingWindow,
  };
});
vi.mock("@/components/admin/RewardHandoffQueue", () => ({
  RewardHandoffQueue: (props: {
    workspaceKey: string;
    items: RewardHandoffQueueItem[];
    filters: Record<string, unknown>;
    processingWindowDays: number | null;
    onFiltersChange: (filters: Record<string, unknown>) => void;
    onSaveProcessingWindow: (days: number | null) => Promise<void>;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => Promise<void>;
  }) => (
    <div>
      <p data-testid="route-items">{props.items.map((item) => item.creatorDisplayName).join(",")}</p>
      <p data-testid="route-window">{String(props.processingWindowDays)}</p>
      <p data-testid="route-filters">{JSON.stringify(props.filters)}</p>
      <button
        type="button"
        onClick={() => props.onFiltersChange({
          due: "overdue", component: "points", status: "cancelled",
        })}
      >
        Route apply filters
      </button>
      <button
        type="button"
        onClick={() => props.onFiltersChange({
          due: "no_target", component: "cash", status: "pending",
        })}
      >
        Route apply latest filters
      </button>
      <button type="button" onClick={() => void props.onSaveProcessingWindow(0)}>
        Route save setting
      </button>
      {props.hasMore ? (
        <button type="button" disabled={props.loadingMore} onClick={() => void props.onLoadMore()}>
          Route load more
        </button>
      ) : null}
    </div>
  ),
}));

function queueItem(): RewardHandoffQueueItem {
  return {
    id: "pending-1", workflowId: "workflow-1", submissionId: "submission-1",
    creatorId: "creator-private", missionId: "mission-private",
    rewardContractId: "contract-1", completionDecisionId: "decision-1",
    cancellationDecisionId: null,
    reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
    status: "pending", processingWindowDays: 7,
    targetAt: "2026-08-02T10:00:00.000Z", createdAt: "2026-07-26T10:00:00.000Z",
    cancelledAt: null, decision: null, creatorDisplayName: "Amy Wong",
    missionTitle: "Summer launch",
    completionDecision: {
      id: "decision-1", kind: "approved", decidedAt: "2026-07-26T10:00:00.000Z",
      requiredItemCount: 2, verifiedRequiredItemCount: 2, evidenceAvailable: true,
    },
  };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderRoute(queryClient = client()) {
  const Component = Route.options.component as React.ComponentType;
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>,
    ),
  };
}

import {
  AdminRewardHandoffsRoute,
  Route,
  validateRewardHandoffSearch,
} from "./admin.reward-handoffs";

describe("admin reward handoffs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.authed = true;
    h.workspaceSlug = "alpha";
    h.search = {};
    h.lang = "en";
    h.localeReady = true;
    h.fetchRewardHandoffs.mockResolvedValue({
      items: [queueItem()],
      rewardProcessingWindowDays: 7,
    });
    h.setRewardProcessingWindow.mockResolvedValue({
      workspaceId: "workspace-id",
      rewardProcessingWindowDays: 0,
    });
  });

  afterEach(() => act(() => setActivationAnalyticsSink(null)));

  it("normalizes malformed search to the pending-only default", () => {
    expect(validateRewardHandoffSearch({
      due: "tomorrow", component: ["cash"], status: "paid",
      creator: "creator-private", reward: 125,
    })).toEqual({ status: "pending" });
    expect(validateRewardHandoffSearch({
      due: "due_soon", component: "cash", status: "cancelled",
    })).toEqual({ due: "due_soon", component: "cash", status: "cancelled" });
  });

  it("loads a workspace-isolated pending query and preserves server order", async () => {
    renderRoute();
    expect(await screen.findByTestId("route-items")).toHaveTextContent("Amy Wong");
    expect(h.fetchRewardHandoffs).toHaveBeenCalledWith({
      workspace: "alpha", status: "pending",
    });
    expect(screen.getByTestId("route-filters")).toHaveTextContent('"status":"pending"');
    expect(screen.getByTestId("route-window")).toHaveTextContent("7");
  });

  it("uses a distinct query for each workspace", async () => {
    const queryClient = client();
    const first = renderRoute(queryClient);
    await screen.findByText("Amy Wong");
    first.unmount();
    h.workspaceSlug = "beta";
    renderRoute(queryClient);
    await screen.findByText("Amy Wong");
    await waitFor(() => expect(h.fetchRewardHandoffs).toHaveBeenCalledWith({
      workspace: "beta", status: "pending",
    }));
  });

  it("ignores a stale load-more success after the workspace changes", async () => {
    const latePage = deferred<{
      items: RewardHandoffQueueItem[];
      rewardProcessingWindowDays: number | null;
      pageInfo: { hasMore: boolean; nextCursor: string | null; limit: number };
    }>();
    const alpha = queueItem();
    const beta = { ...queueItem(), id: "pending-beta", creatorDisplayName: "Beta Creator" };
    const stale = { ...queueItem(), id: "pending-stale", creatorDisplayName: "Stale Alpha Creator" };
    h.fetchRewardHandoffs.mockImplementation((filters: { workspace: string; cursor?: string }) => {
      if (filters.cursor) return latePage.promise;
      if (filters.workspace === "beta") return Promise.resolve({
        items: [beta], rewardProcessingWindowDays: 7,
        pageInfo: { hasMore: false, nextCursor: null, limit: 50 },
      });
      return Promise.resolve({
        items: [alpha], rewardProcessingWindowDays: 7,
        pageInfo: { hasMore: true, nextCursor: "alpha-cursor", limit: 50 },
      });
    });
    const view = renderRoute();
    await screen.findByText("Amy Wong");
    fireEvent.click(screen.getByRole("button", { name: "Route load more" }));
    await waitFor(() => expect(h.fetchRewardHandoffs).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: "alpha", cursor: "alpha-cursor" }),
    ));

    h.workspaceSlug = "beta";
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    await screen.findByText("Beta Creator");
    latePage.resolve({
      items: [stale], rewardProcessingWindowDays: 7,
      pageInfo: { hasMore: true, nextCursor: "stale-cursor", limit: 50 },
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("route-items")).toHaveTextContent("Beta Creator");
    expect(screen.getByTestId("route-items")).not.toHaveTextContent("Stale Alpha Creator");
    expect(screen.queryByRole("button", { name: "Route load more" })).not.toBeInTheDocument();
  });
  it("writes only bounded due/component/status filters to URL search", async () => {
    renderRoute();
    await screen.findByText("Amy Wong");
    fireEvent.click(screen.getByRole("button", { name: "Route apply filters" }));
    expect(h.navigate).toHaveBeenCalledWith({
      search: { due: "overdue", component: "points", status: "cancelled" },
      replace: true,
    });
  });

  it("saves SLA explicitly then invalidates and refetches settings and queue", async () => {
    const { queryClient } = renderRoute();
    await screen.findByText("Amy Wong");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Route save setting" }));
    await waitFor(() => expect(h.setRewardProcessingWindow).toHaveBeenCalledWith({
      workspace: "alpha", days: 0,
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(h.fetchRewardHandoffs.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps late workspace-A save settlement scoped to A after switching to B", async () => {
    const pending = deferred<{ workspaceId: string; rewardProcessingWindowDays: number }>();
    h.setRewardProcessingWindow.mockReturnValueOnce(pending.promise);
    const view = renderRoute();
    await screen.findByText("Amy Wong");
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Route save setting" }));
    expect(h.setRewardProcessingWindow).toHaveBeenCalledWith({ workspace: "alpha", days: 0 });

    h.workspaceSlug = "beta";
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(h.fetchRewardHandoffs).toHaveBeenCalledWith({
      workspace: "beta", status: "pending",
    }));
    const betaFetches = h.fetchRewardHandoffs.mock.calls.filter(
      ([filters]) => filters.workspace === "beta",
    ).length;

    pending.resolve({ workspaceId: "workspace-alpha", rewardProcessingWindowDays: 0 });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["admin-reward-handoffs", "alpha"],
    }));
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["admin-reward-handoffs", "beta"],
    });
    expect(h.fetchRewardHandoffs.mock.calls.filter(
      ([filters]) => filters.workspace === "beta",
    )).toHaveLength(betaFetches);
  });

  it("bounds load errors and offers a successful retry", async () => {
    h.fetchRewardHandoffs
      .mockRejectedValueOnce(new Error("private database creator@example.com"))
      .mockResolvedValueOnce({ items: [queueItem()], rewardProcessingWindowDays: null });
    renderRoute();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load reward handoffs.");
    expect(screen.queryByText(/creator@example/)).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry reward handoffs" });
    expect(retry.className).toMatch(/hover:/);
    fireEvent.click(retry);
    expect(await screen.findByText("Amy Wong")).toBeVisible();
  });

  it("emits one view per successful workspace/query load and bounded filter categories only", async () => {
    const sink = vi.fn((_event: {
      name: keyof import("@/lib/activationAnalytics").ActivationEventMap; properties: object;
    }) => {
      void _event;
      return true;
    });
    setActivationAnalyticsSink(sink);
    const view = renderRoute();
    await screen.findByText("Amy Wong");
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(
      sink.mock.calls.filter(([event]) => event.name === "reward_handoff_queue_viewed"),
    ).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Route apply filters" }));
    const filtered = sink.mock.calls.find(
      ([event]) => event.name === "reward_handoff_queue_filtered",
    )?.[0];
    expect(filtered).toEqual({
      name: "reward_handoff_queue_filtered",
      properties: {
        locale: "en", dueFilter: "overdue",
        componentFilter: "points", statusFilter: "cancelled",
      },
    });
    expect(JSON.stringify(filtered)).not.toMatch(
      /creator-private|mission-private|Amy Wong|125|500|operator|note/i,
    );
  });

  it("waits for locale readiness before analytics delivery", async () => {
    const sink = vi.fn((_event: {
      name: keyof import("@/lib/activationAnalytics").ActivationEventMap; properties: object;
    }) => {
      void _event;
      return true;
    });
    setActivationAnalyticsSink(sink);
    h.localeReady = false;
    const view = renderRoute();
    await screen.findByText("Amy Wong");
    expect(sink).not.toHaveBeenCalled();
    h.localeReady = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sink).toHaveBeenCalledWith({
      name: "reward_handoff_queue_viewed",
      properties: {
        locale: "en", dueFilter: "all",
        componentFilter: "all", statusFilter: "pending",
      },
    }));
  });

  it("retains only the latest pre-ready filter analytics and delivers it exactly once", async () => {
    const sink = vi.fn((_event: {
      name: keyof import("@/lib/activationAnalytics").ActivationEventMap; properties: object;
    }) => {
      void _event;
      return true;
    });
    setActivationAnalyticsSink(sink);
    h.localeReady = false;
    const view = renderRoute();
    await screen.findByText("Amy Wong");
    fireEvent.click(screen.getByRole("button", { name: /^Route apply filters$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Route apply latest filters" }));
    expect(sink).not.toHaveBeenCalled();

    h.localeReady = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sink.mock.calls.filter(
      ([event]) => event.name === "reward_handoff_queue_filtered",
    )).toHaveLength(1));
    const filtered = sink.mock.calls.find(
      ([event]) => event.name === "reward_handoff_queue_filtered",
    )?.[0];
    expect(filtered).toEqual({
      name: "reward_handoff_queue_filtered",
      properties: {
        locale: "en", dueFilter: "no_target",
        componentFilter: "cash", statusFilter: "pending",
      },
    });
    expect(JSON.stringify(filtered)).not.toMatch(/alpha|beta|creator|mission|125|500|note/i);

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <AdminRewardHandoffsRoute />
      </QueryClientProvider>,
    );
    expect(sink.mock.calls.filter(
      ([event]) => event.name === "reward_handoff_queue_filtered",
    )).toHaveLength(1);
  });

  it("does not query without authentication or a workspace", () => {
    h.authed = false;
    h.workspaceSlug = "";
    renderRoute();
    expect(screen.getByText("Select a workspace.")).toBeVisible();
    expect(h.fetchRewardHandoffs).not.toHaveBeenCalled();
  });
});
