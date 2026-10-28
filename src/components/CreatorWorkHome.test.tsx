import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType, ReactNode } from "react";
import { creatorWorkWorkspace as workspace } from "@/test/creatorWorkWorkspace";
import { ApiError } from "@/lib/api";
import { deriveCreatorActivation } from "@/lib/creatorActivation";
import { I18nProvider } from "@/lib/i18n";
import type { MyMission } from "@/lib/queries/kocmax";
import type { UseCreatorActivationResult } from "@/lib/useCreatorActivation";

const mocks = vi.hoisted(() => ({
  activation: {} as UseCreatorActivationResult,
  api: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/lib/useCreatorActivation", () => ({ useCreatorActivation: () => mocks.activation }));
vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(), apiFetch: (...args: unknown[]) => mocks.api(...args),
}));
vi.mock("@/lib/queries/kocmax", () => ({ useBalance: () => ({ data: { balance: 50 } }) }));
vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: vi.fn() }));
vi.mock("@/lib/activationAnalytics", () => ({ trackActivationEvent: (...args: unknown[]) => mocks.track(...args) }));
vi.mock("@/lib/content", () => ({ contentKeys: { news: () => ["news"] }, fetchNews: async () => ({ items: [] }) }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...await original<typeof import("@tanstack/react-router")>(),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
import { Route } from "@/routes/_app.home";

function mission(id: string, active = true): MyMission {
  return { id, status: "joined", content_urls: [], points_awarded: 0, created_at: "2026-10-20T00:00:00Z",
    creator_workflow_mode: active ? "active_workspace" : "legacy",
    missions: { slug: id, title: `Mission ${id}`, points_reward: 50, mission_type: "ugc" } };
}


function setup(missions: MyMission[]) {
  const me = { id: "creator-home", level: "L1", xp: 10, display_name: "Creator", onboarding_step: 5, onboarding_completed: true, categories: ["beauty"] };
  const snapshot = deriveCreatorActivation({ me, myMissions: missions });
  const section = <T,>(data: T) => ({ data, loading: false, error: null, refetch: vi.fn().mockResolvedValue({ data }) });
  mocks.activation = { snapshot, me: section(me), activeMissions: section(missions), recommendations: section([]), earnings: section({ available: 0, pending: 0 }),
    readiness: section({ readinessPercent: 60, completedReadinessWeight: 60, totalReadinessWeight: 100, milestones: [] }) };
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Home = Route.options.component as ComponentType;
  const view = render(<QueryClientProvider client={client}><I18nProvider><Home /></I18nProvider></QueryClientProvider>);
  return { ...view, client };
}

describe("Creator work home (unit transport fixtures)", () => {
  beforeEach(() => { localStorage.setItem("lang", "en"); mocks.api.mockReset(); mocks.track.mockClear(); setup([]); });

  it("prioritizes a revision over an earlier draft and links directly to the canonical work item", async () => {
    setup([mission("draft"), mission("revision")]);
    mocks.api.mockImplementation(async (path: string) => path.includes("/revision/")
      ? workspace("revision", "revision_requested", "revision_requested") : workspace("draft", "drafting", "drafting"));
    renderHome();
    const cta = await screen.findByRole("link", { name: "Revise draft" });
    expect(cta).toHaveAttribute("href", "/my/revision?item=item-revision");
    expect(screen.getByText("You are responsible for addressing the requested changes.")).toBeInTheDocument();
    expect(screen.getByText("28 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText("item-revision")).not.toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith("activation_action_viewed", { locale: "en", actionKind: "revise" });
    expect(mocks.track).not.toHaveBeenCalledWith("activation_action_viewed", { locale: "en", actionKind: "submit_proof" });
  });

  it.each([
    ["in_review", "under_review", "View submitted version", "Adfocate is responsible for reviewing your submission."],
    ["approved_to_publish", "approved_to_publish", "View publishing instructions", "You are responsible for publishing only when instructed."],
    ["publication_in_progress", "proof_under_review", "View submitted version", "Adfocate is responsible for reviewing your submission."],
  ] as const)("renders %s from canonical workflow without a join or resubmit primary action", async (state, itemState, label, body) => {
    setup([mission("current")]);
    mocks.api.mockResolvedValue(workspace("current", state, itemState));
    renderHome();
    const cta = await screen.findByRole("link", { name: label });
    expect(cta).toHaveAttribute("href", "/my/current?item=item-current");
    expect(screen.getByText(body)).toBeInTheDocument();
    const card = cta.closest("section")!;
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    expect(card).not.toHaveTextContent(/Add proof|Join mission/);
  });

  it("keeps reward_pending separate even with an optional draft and no reward projection", async () => {
    setup([mission("reward")]);
    const value = workspace("reward", "reward_pending", "proof_verified");
    value.workItems.push({ ...value.workItems[0], id: "optional", required: false, state: "drafting" });
    mocks.api.mockResolvedValue(value);
    renderHome();
    const cta = await screen.findByRole("link", { name: "View reward review" });
    expect(cta).toHaveAttribute("href", "/my/reward");
    expect(cta.closest("section")).toHaveTextContent("Pending reward is not payment and is not available to withdraw.");
    expect(cta.closest("section")).not.toHaveTextContent(/Continue draft|Submit proof|Withdraw reward/);
    expect(screen.getByRole("link", { name: "View wallet details" })).toHaveAttribute("href", "/wallet");
  });

  it("keeps a submitted legacy mission ahead of recommendations", async () => {
    setup([{ ...mission("legacy", false), status: "submitted" }]);
    renderHome();
    expect(await screen.findByRole("link", { name: "View submitted version" })).toHaveAttribute("href", "/mission/legacy");
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it.each(["applied", "declined"] as const)("does not load a nonexistent workflow for a %s application or hide started work", async status => {
    setup([{ ...mission("application"), status, active_workflow_id: null }, mission("current")]);
    mocks.api.mockImplementation(async (path: string) => {
      if (path.includes("/application/")) throw new ApiError(404, "WORKFLOW_NOT_FOUND", "Application has no workflow");
      return workspace("current", "drafting", "drafting");
    });
    renderHome();
    expect(await screen.findByRole("link", { name: "Continue draft" })).toHaveAttribute("href", "/my/current?item=item-current");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/my-missions/current/workspace");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show a guessed task or empty state while workspace data is loading", async () => {
    setup([mission("loading")]);
    mocks.api.mockReturnValue(new Promise(() => {}));
    renderHome();
    expect(await screen.findByText("Loading your current work…")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add proof" })).not.toBeInTheDocument();
    expect(screen.queryByText("You have no current work.")).not.toBeInTheDocument();
  });

  it("distinguishes a failed read from empty work and retries without losing the mission", async () => {
    setup([mission("recover")]);
    mocks.api.mockRejectedValueOnce(new ApiError(503, "UNAVAILABLE", "offline"))
      .mockResolvedValue(workspace("recover", "drafting", "drafting"));
    renderHome();
    expect(await screen.findByText("Your current work could not be updated. Please retry.")).toBeInTheDocument();
    expect(screen.queryByText("You have no current work.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry current work" }));
    expect(await screen.findByRole("link", { name: "Continue draft" })).toHaveAttribute("href", "/my/recover?item=item-recover");
  });

  it("retains cached work with a visible stale warning after a 503", async () => {
    setup([mission("cached")]);
    mocks.api.mockResolvedValue(workspace("cached", "revision_requested", "revision_requested"));
    const { client } = renderHome();
    await screen.findByRole("link", { name: "Revise draft" });
    mocks.api.mockRejectedValue(new ApiError(503, "UNAVAILABLE", "offline"));
    await client.refetchQueries({ queryKey: ["active-mission", "cached"] });
    expect(await screen.findByText("Showing previously loaded work. It may have changed; retry to update it.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revise draft" })).toBeInTheDocument();
  });

  it.each([401, 403, 404])("hides cached protected work after %s and offers recovery", async (status) => {
    setup([mission("private")]);
    mocks.api.mockResolvedValue(workspace("private", "drafting", "drafting"));
    const { client } = renderHome();
    await screen.findByRole("link", { name: "Continue draft" });
    mocks.api.mockRejectedValue(new ApiError(status, "DENIED", "denied"));
    await client.refetchQueries({ queryKey: ["active-mission", "private"] });
    await waitFor(() => expect(screen.queryByText("Mission private")).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Continue draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your current work is unavailable. Check your sign-in and workspace access, then retry.");
  });

  it("shows a genuine empty state only after a successful empty list read", () => {
    renderHome();
    expect(screen.getByText("You have no current work.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open guide" })).toBeInTheDocument();
  });

  it.each([401, 403, 404])("keeps work hidden after %s followed by a 503, including a remount", async status => {
    setup([mission("private")]);
    mocks.api.mockResolvedValue(workspace("private", "drafting", "drafting"));
    const { client, unmount } = renderHome();
    await screen.findByRole("link", { name: "Continue draft" });
    mocks.api.mockRejectedValue(new ApiError(status, "DENIED", "denied"));
    await act(async () => { await client.refetchQueries({ queryKey: ["active-mission", "private"] }); });
    await waitFor(() => expect(screen.queryAllByText("Mission private")).toHaveLength(0));
    mocks.api.mockRejectedValue(new ApiError(503, "UNAVAILABLE", "offline"));
    await act(async () => { await client.refetchQueries({ queryKey: ["active-mission", "private"] }); });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Continue draft" })).not.toBeInTheDocument());
    client.setQueryDefaults(["active-mission", "private"], { gcTime: Infinity });
    unmount();
    const Home = Route.options.component as ComponentType;
    render(<QueryClientProvider client={client}><I18nProvider><Home /></I18nProvider></QueryClientProvider>);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryAllByText("Mission private")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Continue draft" })).not.toBeInTheDocument();
    mocks.api.mockResolvedValue(workspace("private", "drafting", "drafting"));
    await act(async () => { await client.refetchQueries({ queryKey: ["active-mission", "private"] }); });
    expect(await screen.findByRole("link", { name: "Continue draft" })).toBeInTheDocument();
  });

  it("shows verified proof as awaiting completion rather than another publishing action", async () => {
    setup([mission("verified")]);
    mocks.api.mockResolvedValue(workspace("verified", "proof_verified", "proof_verified"));
    renderHome();
    const cta = await screen.findByRole("link", { name: "View verified proof" });
    expect(cta.closest("section")).toHaveTextContent("Adfocate is checking completion. Your proof remains verified.");
    expect(cta).toHaveAttribute("href", "/my/verified?item=item-verified");
  });
});
