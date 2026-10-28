import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ creator: vi.fn(), admin: vi.fn(), applications: vi.fn(), campaigns: vi.fn() }));
vi.mock("@tanstack/react-router", async original => ({ ...(await original<object>()),
  createFileRoute: () => (options: object) => ({ options }), useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), apiFetch: h.creator }));
vi.mock("@/lib/admin", async original => ({ ...(await original<object>()), adminFetch: h.admin,
  fetchApplications: h.applications, fetchCampaigns: h.campaigns,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "owned" }) }));
import { Route as History } from "./_app.redemption.history";
import { Route as Campaigns } from "./_app.campaigns.index";
import { Route as Guide } from "./_app.guide.index";
import { Route as Applications } from "./admin.applications";
import { Route as AdminCampaigns } from "./admin.campaigns.index";
import { Route as Content } from "./admin.content.index";
import { ApiError } from "@/lib/api";
import { adminKeys } from "@/lib/admin";

const emptyBundle = { docs: [], tracks: [], playbooks: [], resources: [] };
const unavailable = () => new ApiError(503, "unavailable", "Unavailable");
function show(route: { options: unknown }, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const C = (route.options as { component: ComponentType }).component;
  return { client, ...render(<QueryClientProvider client={client}><C /></QueryClientProvider>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.creator.mockImplementation(async (path: string) => path === "/me" ? { id: "owned", level: "L0", is_trusted: true }
    : path.startsWith("/academy") ? emptyBundle : path === "/campaigns" ? { campaigns: [] } : { redemptions: [] });
  h.admin.mockResolvedValue({ items: [], total: 0 });
  h.applications.mockResolvedValue({ applications: [] }); h.campaigns.mockResolvedValue({ campaigns: [] });
});
afterEach(cleanup);

describe("R2 original empty/list UI acceptance", () => {
  it("UC-C15 distinguishes a successful empty history and keeps the return entrance", async () => {
    show(History); expect(await screen.findByText("暫無兌換記錄" )).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/redemption");
  });
  it("UC-C15 failed history offers retry without claiming an empty history", async () => {
    h.creator.mockRejectedValueOnce(unavailable()); show(History);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("暫無兌換記錄")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("暫無兌換記錄")).toBeInTheDocument();
  });
  it("UC-C15 revoked permission hides a previously cached redemption code", async () => {
    const { client, unmount } = show(History); await screen.findByText("暫無兌換記錄");
    act(() => client.setQueryData(["redemptions"], [{ id: "old", points_spent: 1, code: "PRIVATE-CODE", created_at: "2026-10-01", redemption_gifts: { name: "Old gift" } }]));
    await screen.findByText(/PRIVATE-CODE/);
    h.creator.mockRejectedValueOnce(new ApiError(403, "forbidden", "Denied"));
    await act(async () => { await client.refetchQueries({ queryKey: ["redemptions"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Workspace access/);
    expect(screen.queryByText(/PRIVATE-CODE/)).not.toBeInTheDocument();
    h.creator.mockRejectedValue(unavailable());
    await act(async () => { await client.refetchQueries({ queryKey: ["redemptions"] }); });
    expect(screen.queryByText(/PRIVATE-CODE/)).not.toBeInTheDocument();
    unmount();
    show(History, client);
    await screen.findByRole("alert");
    expect(screen.queryByText(/PRIVATE-CODE/)).not.toBeInTheDocument();
  });
  it("UC-C16 shows no active challenge only after a successful read", async () => {
    show(Campaigns); expect(await screen.findByText("暫時未有進行中嘅挑戰，遲啲再嚟睇睇。" )).toBeInTheDocument();
  });
  it("UC-C16 failure is recoverable and is not an empty challenge result", async () => {
    h.creator.mockRejectedValueOnce(unavailable()); show(Campaigns);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("暫時未有進行中嘅挑戰，遲啲再嚟睇睇。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("暫時未有進行中嘅挑戰，遲啲再嚟睇睇。")).toBeInTheDocument();
  });
  it("UC-C17 names an empty Academy instead of rendering a blank course section", async () => {
    show(Guide); expect(await screen.findByText(/No courses available/)).toBeInTheDocument();
  });
  it("UC-C17 a failed bundle can retry without inventing courses", async () => {
    h.creator.mockImplementation(async path => { if (path.startsWith("/academy")) throw unavailable(); return { id: "owned", level: "L0", is_trusted: true }; });
    show(Guide); expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No courses available/)).not.toBeInTheDocument();
    h.creator.mockImplementation(async path => path.startsWith("/academy") ? emptyBundle : { id: "owned", level: "L0" });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText(/No courses available/)).toBeInTheDocument();
  });
  it("UC-C17 lists readable and locked requirements without promising lesson completion", async () => {
    h.creator.mockImplementation(async path => path.startsWith("/academy") ? { ...emptyBundle, tracks: [
      { id: "one", slug: "one", title: "Readable owned introduction", requiredLevel: "L0", meta: {}, contentStatus: "preparing" },
      { id: "locked", slug: "locked", title: "Advanced owned introduction", requiredLevel: "L3", meta: {} },
    ] } : { id: "owned", level: "L0", is_trusted: true });
    show(Guide); await screen.findByText("Advanced owned introduction");
    expect(screen.getByRole("link", { name: /Readable owned introduction/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Advanced owned introduction/ })).not.toBeInTheDocument();
    expect(screen.getByText(/L3/)).toBeInTheDocument();
  });
  it("UC-A45 empty applications are explicit; a failed read can retry", async () => {
    h.applications.mockRejectedValueOnce(unavailable()); show(Applications);
    await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("暫無待審批申請")).toBeInTheDocument();
  });
  it("UC-A45 stale applications remain visible with a warning but cannot be decided", async () => {
    h.applications.mockResolvedValue({ applications: [{ id: "a", creators: { display_name: "Owned applicant" }, missions: { title: "Owned mission" } }] });
    const { client } = show(Applications); await screen.findByText("Owned applicant");
    h.applications.mockRejectedValueOnce(unavailable());
    await act(async () => { await client.refetchQueries({ queryKey: adminKeys.applications("owned") }); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous saved data/);
    expect(screen.getByRole("button", { name: "接受" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒絕" })).toBeDisabled();
  });
  it("UC-A49 empty challenges retain the create entrance, and read failure has retry", async () => {
    h.campaigns.mockRejectedValueOnce(unavailable()); show(AdminCampaigns);
    await screen.findByRole("alert"); expect(screen.getByRole("link", { name: /新挑戰/ })).toHaveAttribute("href", "/admin/campaigns/new");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("此品牌尚未有挑戰。")).toBeInTheDocument();
  });
  it("UC-A49 content failure is not empty and retry preserves the selected status", async () => {
    show(Content); await screen.findByText("尚未有內容。");
    h.admin.mockRejectedValueOnce(unavailable());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "draft" } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("尚未有內容。")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("draft");
    expect(screen.getByRole("link", { name: /新增/ })).toHaveAttribute("href", "/admin/content/$id");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("尚未有內容。")).toBeInTheDocument();
  });
});
