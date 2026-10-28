import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from "@tanstack/react-router";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";
import { WorkspaceSwitcher } from "@/components/admin/WorkspaceSwitcher";
import type { ActiveMissionWorkflow, CreatorCaseProofItem, fetchCreatorDetail } from "@/lib/admin";
import { I18nProvider } from "@/lib/i18n";
import { AdminActiveMissionReviewRoute, Route as reviewRoute } from "./admin.active-missions.$workflowId";
import { Route as creatorRoute } from "./operator.creators.$creatorId";

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

const creatorDetail: Awaited<ReturnType<typeof fetchCreatorDetail>> = {
  creator: {
    id: "creator-1", workspace_id: proof.workspaceId, display_name: "Creator", avatar_url: null,
    level: "L1", categories: [], scores: {}, social_handles: null, created_at: proof.submittedAt,
  },
  socialAccounts: [],
  social: {
    platforms: [], syncStatus: null, followerCount: null, engagementRate: null, apiSyncedAt: null,
    label: "Not synced", ownershipLabel: "Ownership not verified",
  },
  profileMedia: {
    avatarUrl: null, portfolioLinks: [], publicHighlights: [],
    published: { avatarUrl: null, highlights: [], publishedAt: null }, completeness: { score: 0, items: [] },
  },
  review: {
    status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null,
  },
  notes: [], shortlists: [], audit: [], missionHistory: [],
};

const caseProofKey = ["admin-creator-proofs", "creator-1"] as const;
const caseProofUrl = "/api/admin/creators/creator-1/publication-proofs";

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

function mount(initialProof = proof) {
  const root = createRootRoute();
  const operator = createRoute({ getParentRoute: () => root, path: "operator", component: OperatorLayout });
  const creator = createRoute({
    getParentRoute: () => operator, path: "creators/$creatorId",
    component: creatorRoute.options.component,
  });
  const admin = createRoute({ getParentRoute: () => root, path: "admin", component: AdminLayout });
  const review = createRoute({
    getParentRoute: () => admin, path: "active-missions/$workflowId",
    validateSearch: reviewRoute.options.validateSearch, component: AdminActiveMissionReviewRoute,
  });
  history = createBrowserHistory();
  const router = createRouter({ routeTree: root.addChildren([operator.addChildren([creator]), admin.addChildren([review])]), history });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  queryClient.setQueryData(["admin-creator-detail", "creator-1"], creatorDetail);
  queryClient.setQueryData(caseProofKey, { proofs: { status: "available", value: [initialProof] } });
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

function confirmVerification() {
  ["Publicly accessible", "Platform matches", "Account matches",
    "Content matches approved version", "Timing acceptable", "Disclosures present"]
    .forEach((label) => fireEvent.click(screen.getByLabelText(label)));
  fireEvent.click(screen.getByRole("button", { name: "Verify proof" }));
  fireEvent.change(screen.getByLabelText("Type attempt number 1 to confirm"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
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

  it.each([
    { action: "start", initialState: "awaiting_review", nextState: "in_review", label: "in review", pending: true },
    { action: "corrections", initialState: "in_review", nextState: "correction_requested", label: "correction requested", pending: true },
    { action: "verify", initialState: "in_review", nextState: "verified", label: "verified", pending: false },
  ] as const)("refetches a fresh creator case after a successful $action review", async ({ action, initialState, nextState, label, pending }) => {
    window.history.replaceState(null, "", "/operator/creators/creator-1");
    const initialProof = { ...proof, reviewState: initialState };
    const nextProof = { ...proof, reviewState: nextState, reviewSummary: `Saved ${action} result` };
    const detail = structuredClone(workflow);
    detail.workItems[0].state = action === "start" ? "proof_submitted" : "proof_under_review";
    detail.proofReviews = [{
      id: "review-1", attemptId: proof.attemptId, reviewNumber: 1, state: "open",
      reviewerId: action === "start" ? null : "reviewer-1", checklist: {},
      summary: null, decision: null, reviewedAt: null, decisionAt: null, creatorResponseDeadline: null, items: [],
    }];
    const mutationUrl = `/api/admin/active-missions/${proof.workflowId}/work-items/${proof.workItemId}/proof-review/${action}`;
    const mutationResponse = deferred<Response>();
    requests.mockImplementation(async (url: string) => {
      if (url === "/api/admin/workspaces") return Response.json({ workspaces });
      if (url === `/api/admin/active-missions/${proof.workflowId}`) return Response.json(detail);
      if (url === mutationUrl) return mutationResponse.promise;
      if (url === caseProofUrl) return Response.json({ proofs: { status: "available", value: [nextProof] } });
      throw new Error(`Unexpected request: ${url}`);
    });
    mount(initialProof);
    expect(await screen.findByText("1 pending")).toBeVisible();
    const seededAt = queryClient.getQueryState(caseProofKey)!.dataUpdatedAt;
    expect(requests.mock.calls.filter(([url]) => url === caseProofUrl)).toHaveLength(0);

    fireEvent.click(screen.getByRole("link", { name: "Review proof" }));
    await screen.findByRole("heading", { name: "Publication proof attempt 1" });
    if (action === "start") {
      fireEvent.click(screen.getByRole("button", { name: "Claim review" }));
    } else if (action === "corrections") {
      fireEvent.click(screen.getByRole("button", { name: "Request correction" }));
      fireEvent.change(screen.getByLabelText("Correction 1"), { target: { value: "Use the approved account" } });
      fireEvent.click(screen.getByRole("button", { name: "Send correction request" }));
    } else {
      confirmVerification();
    }
    await waitFor(() => expect(requests.mock.calls.filter(([url]) => url === mutationUrl)).toHaveLength(1));
    expect(queryClient.getQueryState(caseProofKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(caseProofKey)).toEqual({ proofs: { status: "available", value: [initialProof] } });

    await act(async () => { mutationResponse.resolve(Response.json({ reviewNumber: 1 })); });
    await waitFor(() => expect(queryClient.getMutationCache().getAll().some((mutation) => mutation.state.status === "success")).toBe(true));
    // The inactive case is invalidated without fetching until the operator returns.
    expect(requests.mock.calls.filter(([url]) => url === caseProofUrl)).toHaveLength(0);
    await act(async () => { history.back(); });
    const panel = await screen.findByRole("region", { name: "Publication proofs" });
    expect(await within(panel).findByText(nextProof.reviewSummary)).toBeVisible();
    expect(within(panel).getByText(label)).toBeVisible();
    expect(Boolean(within(panel).queryByText("1 pending"))).toBe(pending);
    expect(requests.mock.calls.filter(([url]) => url === caseProofUrl)).toHaveLength(1);
    expect(Date.now() - seededAt).toBeLessThan(30_000);
    expect(queryClient.getQueryData(caseProofKey)).toEqual({ proofs: { status: "available", value: [nextProof] } });
  });

  it("keeps the actual case state and pending count when verification fails", async () => {
    window.history.replaceState(null, "", "/operator/creators/creator-1");
    const initialProof = { ...proof, reviewState: "in_review" as const };
    const detail = structuredClone(workflow);
    detail.workItems[0].state = "proof_under_review";
    detail.proofReviews = [{
      id: "review-1", attemptId: proof.attemptId, reviewNumber: 1, state: "open", reviewerId: "reviewer-1",
      checklist: {}, summary: null, decision: null, reviewedAt: null, decisionAt: null, creatorResponseDeadline: null, items: [],
    }];
    requests.mockImplementation(async (url: string) => {
      if (url === "/api/admin/workspaces") return Response.json({ workspaces });
      if (url === `/api/admin/active-missions/${proof.workflowId}`) return Response.json(detail);
      if (url.endsWith("/proof-review/verify")) return Response.json({ error: "Verification failed" }, { status: 500 });
      throw new Error(`Unexpected request: ${url}`);
    });
    mount(initialProof);
    fireEvent.click(await screen.findByRole("link", { name: "Review proof" }));
    await screen.findByRole("heading", { name: "Publication proof attempt 1" });
    confirmVerification();
    expect(await screen.findByRole("alert")).toHaveTextContent("Verification failed");
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(queryClient.getQueryState(caseProofKey)?.isInvalidated).toBe(false);

    await act(async () => { history.back(); });
    const panel = await screen.findByRole("region", { name: "Publication proofs" });
    expect(within(panel).getByText("in review")).toBeVisible();
    expect(within(panel).getByText("1 pending")).toBeVisible();
    expect(within(panel).queryByText("verified")).not.toBeInTheDocument();
    expect(requests.mock.calls.filter(([url]) => url === caseProofUrl)).toHaveLength(0);
    expect(queryClient.getQueryData(caseProofKey)).toEqual({ proofs: { status: "available", value: [initialProof] } });
  });
});
