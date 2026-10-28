import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from "@tanstack/react-router";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";
import { WorkspaceSwitcher } from "@/components/admin/WorkspaceSwitcher";
import { CreatorCaseProofPanel } from "@/components/operator/CreatorCaseProofPanel";
import type { ActiveMissionWorkflow, CreatorCaseProofItem } from "@/lib/admin";
import { I18nProvider } from "@/lib/i18n";
import { AdminActiveMissionReviewRoute, Route as reviewRoute } from "./admin.active-missions.$workflowId";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-token" } } }) } },
}));

const proof: CreatorCaseProofItem = {
  attemptId: "attempt-1", workspaceId: "workspace-owner", isCurrentAttempt: true,
  workflowId: "workflow-1", workItemId: "work-item-1", workItemTitle: "IG Reel",
  platform: "instagram", missionTitle: "Summer launch", missionSlug: "summer-launch",
  attemptNumber: 1, primaryUrl: "https://example.com/post", submittedAt: "2026-08-01T00:00:00.000Z",
  submittedLate: false, metadataStatus: "available", reviewState: "awaiting_review",
  reviewSummary: null, reviewedAt: null,
};

const workflow: ActiveMissionWorkflow = {
  workflow: { id: proof.workflowId, state: "proof_submitted", revision_limit: 3 },
  submission: { creators: { id: "creator-1", display_name: "Creator" }, missions: { id: "mission-1", title: "Summer launch" } },
  workItems: [{
    id: proof.workItemId, title: proof.workItemTitle, platform: proof.platform, position: 0,
    state: "proof_submitted", deadline: null, current_reviewer_id: null,
    current_submitted_version_id: null, approved_version_id: null, requirements_snapshot: [],
    current_proof_attempt_id: proof.attemptId,
  }],
  fulfillment: null, versions: [], reviews: [], grants: [], events: [], assets: [],
  proofAttempts: [{
    id: proof.attemptId, workItemId: proof.workItemId, attemptNumber: 1,
    primaryUrl: proof.primaryUrl, additionalUrls: [], submittedAt: proof.submittedAt,
    submittedLate: false, metadataStatus: "available", metadataSnapshot: {}, metadataErrorCategory: null,
  }],
};

const workspaces = [
  { id: "workspace-owner", slug: "owning-brand", name: "Owning brand" },
  { id: "workspace-other", slug: "other-brand", name: "Other brand" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Match the separate /operator and /admin provider lifetimes in the application.
function OperatorLayout() {
  return <AdminWorkspaceProvider><Outlet /></AdminWorkspaceProvider>;
}
function AdminLayout() {
  return <AdminWorkspaceProvider><WorkspaceSwitcher /><Outlet /></AdminWorkspaceProvider>;
}

let history: ReturnType<typeof createBrowserHistory>;
let queryClient: QueryClient;
const requests = vi.fn();

function mount() {
  const root = createRootRoute();
  const operator = createRoute({ getParentRoute: () => root, path: "operator", component: OperatorLayout });
  const creator = createRoute({
    getParentRoute: () => operator, path: "creators/$creatorId",
    component: () => <CreatorCaseProofPanel proofs={{ status: "available", value: [proof] }} />,
  });
  const admin = createRoute({ getParentRoute: () => root, path: "admin", component: AdminLayout });
  const review = createRoute({
    getParentRoute: () => admin, path: "active-missions/$workflowId",
    validateSearch: reviewRoute.options.validateSearch, component: AdminActiveMissionReviewRoute,
  });
  history = createBrowserHistory();
  const router = createRouter({ routeTree: root.addChildren([operator.addChildren([creator]), admin.addChildren([review])]), history });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AdminAuthContext.Provider value={{ authed: true, staff: { userId: "reviewer-1", email: "reviewer@test.local" }, reportAuthError: vi.fn() }}>
          <RouterProvider router={router as never} />
        </AdminAuthContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function workflowRequests() {
  return requests.mock.calls.filter(([url]) => url === `/api/admin/active-missions/${proof.workflowId}`);
}

describe("creator case proof navigation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.setItem("lang", "en");
    requests.mockReset();
    vi.stubGlobal("fetch", requests);
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(() => {
    history?.destroy();
    queryClient?.clear();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it.each(["", "workspace-other"])("loads the owning workspace from selection '%s' after canonical validation", async (selected) => {
    sessionStorage.setItem("adfocate_admin_workspace", selected);
    sessionStorage.setItem("adfocate_admin_workspace_slug", "other-brand");
    window.history.replaceState(null, "", `/operator/creators/creator-1${selected ? `?ws=${selected}` : ""}`);
    const list = deferred<Response>();
    requests.mockImplementation(async (url: string) => {
      if (url === "/api/admin/workspaces") return list.promise;
      if (url === `/api/admin/active-missions/${proof.workflowId}`) return Response.json(workflow);
      throw new Error(`Unexpected request: ${url}`);
    });
    mount();
    fireEvent.click(await screen.findByRole("link", { name: "Review proof" }));
    await screen.findByRole("combobox", { name: "workspace" });
    expect(new URLSearchParams(window.location.search).get("ws")).toBe(proof.workspaceId);
    expect(new URLSearchParams(window.location.search).get("workItemId")).toBe(proof.workItemId);
    expect(workflowRequests()).toHaveLength(0);

    await act(async () => { list.resolve(Response.json({ workspaces })); });
    await screen.findByRole("heading", { name: "Publication proof attempt 1" });
    expect(screen.getByRole("combobox", { name: "workspace" })).toHaveValue(proof.workspaceId);
    expect(workflowRequests()).toHaveLength(1);
    expect(new Headers(workflowRequests()[0][1].headers).get("X-Workspace-Slug")).toBe("owning-brand");
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe(proof.workspaceId);
  });

  it("loads a copied destination URL in a fresh session using the owning workspace", async () => {
    window.history.replaceState(null, "", `/admin/active-missions/${proof.workflowId}?workItemId=${proof.workItemId}&ws=${proof.workspaceId}`);
    requests.mockImplementation(async (url: string) => {
      if (url === "/api/admin/workspaces") return Response.json({ workspaces });
      if (url === `/api/admin/active-missions/${proof.workflowId}`) return Response.json(workflow);
      throw new Error(`Unexpected request: ${url}`);
    });
    mount();
    await screen.findByRole("heading", { name: "Publication proof attempt 1" });
    expect(workflowRequests()).toHaveLength(1);
    expect(new Headers(workflowRequests()[0][1].headers).get("X-Workspace-Slug")).toBe("owning-brand");
  });

  it("does not request a proof workspace absent from the authorized workspace list", async () => {
    window.history.replaceState(null, "", "/operator/creators/creator-1?ws=workspace-other");
    requests.mockImplementation(async (url: string) => {
      if (url === "/api/admin/workspaces") return Response.json({ workspaces: [workspaces[1]] });
      throw new Error(`Unexpected request: ${url}`);
    });
    mount();
    fireEvent.click(await screen.findByRole("link", { name: "Review proof" }));
    await screen.findByRole("option", { name: "Other brand" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "workspace" })).toHaveValue("");
      expect(new URLSearchParams(window.location.search).get("ws")).toBeNull();
    });
    expect(workflowRequests()).toHaveLength(0);
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("ws")).toBeNull();
  });
});
