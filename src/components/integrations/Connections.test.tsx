import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { IntegrationConnection } from "@/lib/integrations/types";
import { Route } from "@/routes/_app.connections";
import { integrationKeys } from "@/lib/integrations/queries";

vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: vi.fn() }));
vi.mock("@tanstack/react-router", async original => ({
  ...await original<object>(), Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
const fetchMock = vi.mocked(apiFetch);
const clients: QueryClient[] = [];
const drive: IntegrationConnection = {
  id: "drive-1", provider: "google_drive", label: "Mock Drive", status: "connected",
  scopes: ["https://www.googleapis.com/auth/drive.file"], generation: 1,
  lastSyncAt: null, expiresAt: "2099-10-31T00:00:00Z", lastError: null,
  sampleOnly: true, providerRevocation: "not_requested",
};
function mount(lang = "en", owner?: string) {
  localStorage.setItem("lang", lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  if (owner) client.setQueryData(["me"], { id: owner });
  const Page = Route.options.component as () => ReactNode;
  return { client, ...render(<QueryClientProvider client={client}><I18nProvider><Page /></I18nProvider></QueryClientProvider>) };
}
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("mock connection journeys", () => {
  it.each(["start", "complete", "sync", "revoke", "purge"].flatMap(action => [401, 503].map(status => ({ action, status }))))("ignores old creator $action failure $status after identity switch", async ({ action, status }) => {
    let rejectStart!: (error: Error) => void;
    const pending = new Promise((_, reject) => { rejectStart = reject; });
    let nextCreator = false;
    const ig = { ...drive, id: "old-ig", provider: "instagram", label: "OLD_ACCOUNT", scopes: ["instagram_business_basic", "instagram_business_manage_insights"] };
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") return { mode: "mock", connections: !nextCreator && ["sync", "revoke", "purge"].includes(action) ? [ig] : [] };
      if (action === "complete" && path.endsWith("/start")) return { state: "old-state", provider: "instagram", scopes: ig.scopes, sampleOnly: true, expiresAt: drive.expiresAt };
      return pending;
    });
    const { client } = mount("en", "creator-a");
    const button = await screen.findByRole("button", { name: action === "sync" ? "Update mock insights" : action === "revoke" ? "Revoke mock Instagram" : action === "purge" ? "Delete imported content and derived drafts" : "Connect mock Instagram" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    if (action === "purge") fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    if (action === "complete") fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow mock connection" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith(`/${action}`))).toBe(true));
    nextCreator = true;
    act(() => { client.setQueryData(["me"], { id: "creator-b" }); });
    await waitFor(() => expect(client.getQueryData(integrationKeys.list("creator-b"))).toEqual({ mode: "mock", connections: [] }));
    await act(async () => { rejectStart(new ApiError(status, "old_error", "OLD_PRIVATE_ERROR")); await pending.catch(() => undefined); });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByRole("button", { name: "Connect mock Instagram" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Go to sign in" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/OLD_PRIVATE_ERROR|OLD_ACCOUNT|Imported mock content deleted/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(client.getQueryData(integrationKeys.list("creator-b"))).toEqual({ mode: "mock", connections: [] });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(action === "complete" ? 2 : 1);
  });
  it.each(["start", "complete", "sync", "revoke", "purge"])("isolates delayed %s from the next creator", async action => {
    let resolveOperation!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveOperation = resolve; });
    let nextCreator = false;
    const ig = { ...drive, id: "old-ig", provider: "instagram" as const, label: "OLD_PRIVATE_ACCOUNT", scopes: ["instagram_business_basic", "instagram_business_manage_insights"] };
    const consent = { state: "old-consent", provider: "instagram", scopes: ig.scopes, sampleOnly: true, expiresAt: drive.expiresAt };
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") return { mode: "mock", connections: !nextCreator && ["sync", "revoke", "purge"].includes(action) ? [ig] : [] };
      if (action === "complete" && path.endsWith("/start")) return consent;
      return pending;
    });
    const { client } = mount("en", "creator-a");
    const trigger = await screen.findByRole("button", { name: action === "sync" ? "Update mock insights" : action === "revoke" ? "Revoke mock Instagram" : action === "purge" ? "Delete imported content and derived drafts" : "Connect mock Instagram" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    if (action === "purge") fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    if (action === "complete") {
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Allow mock connection" }));
    }
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path.endsWith(`/${action}`))).toHaveLength(1));
    nextCreator = true;
    act(() => { client.setQueryData(["me"], { id: "next-creator" }); });
    await waitFor(() => expect(client.getQueryData(integrationKeys.list("next-creator"))).toEqual({ mode: "mock", connections: [] }));
    const originalAccountList = client.getQueryData(integrationKeys.list("creator-a"));
    await act(async () => {
      resolveOperation(action === "start" ? consent : action === "complete" ? { connection: ig } : action === "revoke" ? { local: "revoked", provider: "revoked" } : action === "purge" ? { state: "complete" } : { resources: [], status: "completed" });
      await pending;
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getMutationCache().getAll().at(-1)?.state.error).toMatchObject({ code: "STALE_CONNECTION" });
    expect(client.getQueryData(integrationKeys.list("creator-a"))).toEqual(originalAccountList);
    expect(client.getQueryData(integrationKeys.list("next-creator"))).toEqual({ mode: "mock", connections: [] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/OLD_PRIVATE_ACCOUNT|Mock data updated|old-consent|Imported mock content deleted/);
    expect(screen.getByRole("button", { name: "Connect mock Instagram" })).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith(`/${action}`))).toHaveLength(1);
  });

  it("settles a delayed start after ordinary unmount without reopening consent", async () => {
    let resolveStart!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveStart = resolve; });
    fetchMock.mockImplementation(async path => path.endsWith("/start") ? pending : { mode: "mock", connections: [] });
    const { client, unmount, container } = mount();
    const trigger = await screen.findByRole("button", { name: "Connect mock Instagram" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/start"))).toBe(true));
    unmount();
    await act(async () => {
      resolveStart({ state: "late-consent", provider: "instagram", scopes: ["instagram_business_basic"], sampleOnly: true, expiresAt: drive.expiresAt });
      await pending;
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe("success");
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("hides consent after complete401 without replaying the completion", async () => {
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") return { mode: "mock", connections: [] };
      if (path.endsWith("/start")) return { state: "private-state", provider: "instagram", scopes: ["instagram_business_basic"], sampleOnly: true, expiresAt: drive.expiresAt };
      throw new ApiError(401, "no_auth", "PRIVATE_COMPLETE_ERROR");
    });
    mount();
    const connect = await screen.findByRole("button", { name: "Connect mock Instagram" });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow mock connection" }));
    expect(await screen.findByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("PRIVATE_COMPLETE_ERROR");
    expect(screen.queryByRole("button", { name: "Connect mock Instagram" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect mock Google Drive" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
  });

  it.each(["start", "sync", "purge"])("does not restore account UI when delayed %s succeeds after list401", async action => {
    let resolveOperation!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveOperation = resolve; });
    let expired = false;
    const ig = { ...drive, id: "ig-race", provider: "instagram", label: "PRIVATE_RACE_ACCOUNT", scopes: ["instagram_business_basic", "instagram_business_manage_insights"] };
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") {
        if (expired) throw new ApiError(401, "no_auth", "private diagnostic");
        return { mode: "mock", connections: action === "start" ? [] : [ig] };
      }
      return pending;
    });
    const { client } = mount();
    const button = await screen.findByRole("button", { name: action === "start" ? "Connect mock Instagram" : action === "sync" ? "Update mock insights" : "Delete imported content and derived drafts" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    if (action === "purge") fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expired = true;
    await act(async () => { await client.invalidateQueries({ queryKey: integrationKeys.all }); });
    await screen.findByRole("link", { name: "Go to sign in" });
    await act(async () => {
      resolveOperation(action === "start"
        ? { state: "late-private-state", provider: "instagram", scopes: ig.scopes, sampleOnly: true, expiresAt: drive.expiresAt }
        : action === "sync" ? { resources: [], status: "completed" } : { state: "complete" });
      await pending;
    });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/PRIVATE_RACE_ACCOUNT|Mock data updated|Imported mock content deleted/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("hides cached accounts after list401 and does not uncover them after transient failure",async()=>{
    fetchMock.mockResolvedValue({mode:"mock",connections:[drive]});
    const {client}=mount();
    await screen.findByText("Mock Drive");
    fetchMock.mockRejectedValue(new ApiError(401,"no_auth","PRIVATE_ERROR"));
    await act(async()=>{await client.invalidateQueries({queryKey:integrationKeys.all});});
    await screen.findByRole("link",{name:"Go to sign in"});
    expect(document.body).not.toHaveTextContent("Mock Drive");
    expect(document.body).not.toHaveTextContent("PRIVATE_ERROR");
    expect(screen.queryByRole("button",{name:"Revoke mock Google Drive"})).not.toBeInTheDocument();
    fetchMock.mockRejectedValue(new ApiError(503,"offline","offline"));
    await act(async()=>{await client.invalidateQueries({queryKey:integrationKeys.all});});
    expect(screen.getByRole("link",{name:"Go to sign in"})).toHaveAttribute("href","/login");
    expect(document.body).not.toHaveTextContent("Mock Drive");
  });
  it.each(["start","sync","revoke","purge"])("contains the account page after mock %s401 without replay or false completion",async action=>{
    const ig={...drive,id:"ig-1",provider:"instagram",label:"PRIVATE_IG_ACCOUNT",scopes:["instagram_business_basic","instagram_business_manage_insights"]};
    fetchMock.mockImplementation(async(path)=>{
      if(path==="/me/integrations")return {mode:"mock",connections:action==="start"?[]:[ig]};
      throw new ApiError(401,"no_auth","PRIVATE_ERROR");
    });
    mount();
    if(action==="start") {
      const button=await screen.findByRole("button",{name:"Connect mock Instagram"});
      await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
    }
    else if(action==="sync")fireEvent.click(await screen.findByRole("button",{name:"Update mock insights"}));
    else if(action==="revoke")fireEvent.click(await screen.findByRole("button",{name:"Revoke mock Instagram"}));
    else {
      fireEvent.click(await screen.findByRole("button",{name:"Delete imported content and derived drafts"}));
      fireEvent.click(screen.getByRole("button",{name:"Confirm deletion"}));
    }
    await screen.findByRole("link",{name:"Go to sign in"});
    expect(document.body).not.toHaveTextContent("PRIVATE_IG_ACCOUNT");
    expect(document.body).not.toHaveTextContent("PRIVATE_ERROR");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("Imported mock content deleted.");
  });
  it("shows D0 boundaries and proposed live scopes without offering a real connection", async () => {
    fetchMock.mockResolvedValue({ mode: "live_pilot", pilot: { stage: "D0", externalAccess: false }, connections: [] });
    mount();
    expect(await screen.findByRole("note", { name: "D0 offline verification" })).toHaveTextContent(/sample data only/i);
    const card = screen.getByRole("region", { name: /Google Drive/ });
    fireEvent.click(within(card).getByText("Proposed live pilot permissions"));
    expect(card).toHaveTextContent("https://www.googleapis.com/auth/drive.file");
    expect(card).toHaveTextContent("openid");
    expect(card).toHaveTextContent(/stable account identifier/);
    expect(card).toHaveTextContent(/create and modify/);
    expect(within(card).getByRole("button", { name: "Live Google Drive connection unavailable in D0" })).toBeDisabled();
    expect(card).not.toHaveTextContent(/Mock skill ready|Connected live/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a live-shaped account inert in D0 without mislabelling it as a connected mock", async () => {
    fetchMock.mockResolvedValue({ mode: "live_pilot", pilot: { stage: "D0", externalAccess: false }, connections: [{ ...drive, sampleOnly: false, label: "Boundary fixture" }] });
    mount();
    const card = await screen.findByRole("region", { name: "Google Drive offline pilot" });
    expect(card).toHaveTextContent("Offline · live access disabled");
    expect(card).not.toHaveTextContent("Mock skill ready");
    expect(within(card).queryByRole("button", { name: "Choose mock Drive files" })).not.toBeInTheDocument();
    for (const button of within(card).getAllByRole("button")) expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps sample revoke and purge available when the reading switch is off", async () => {
    fetchMock.mockImplementation(async path => path.endsWith("/revoke")
      ? { local: "revoked", provider: "pending" } : { mode: "disabled", connections: [drive] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke mock Google Drive" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/revoke"))).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: /Delete imported content/ })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Choose mock Drive files" })).not.toBeInTheDocument();
  });

  it.each(["pending", "manual_action", "not_requested"] as const)("does not reconnect while platform revocation is unresolved (%s)", async providerRevocation => {
    fetchMock.mockResolvedValue({ mode: "mock", connections: [{ ...drive, status: "revoked", providerRevocation }] });
    mount();
    expect(await screen.findByText(/Resolve platform revocation before reconnecting/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect mock Google Drive" })).toBeDisabled();
    expect(screen.getByText(/same Google project/)).toHaveTextContent(/other workspaces/);
    expect(screen.getByRole("button", { name: "Revoke mock Google Drive" })).toBeEnabled();
  });

  it("closes private consent immediately when the authenticated creator changes", async () => {
    fetchMock.mockImplementation(async path => path.endsWith("/start")
      ? { state: "mock-state", provider: "google_drive", scopes: drive.scopes, sampleOnly: true, expiresAt: drive.expiresAt }
      : { mode: "mock", connections: [] });
    const { client } = mount();
    const connect = await screen.findByRole("button", { name: "Connect mock Google Drive" });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await screen.findByRole("dialog");
    const { act } = await import("@testing-library/react");
    act(() => { client.setQueryData(["me"], { id: "another-creator" }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps basic missions and six later providers when the feature endpoint is absent", async () => {
    fetchMock.mockRejectedValue(new ApiError(404, "NOT_FOUND", "off"));
    mount();
    expect(await screen.findByText(/Mock connections are not enabled/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Start creating/ })).toHaveAttribute("href", "/home");
    for (const name of ["TikTok", "YouTube", "Search Console", "Calendar", "Gmail", "Telegram"]) {
      expect(screen.getByRole("heading", { name })).toBeVisible();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discloses the entire Drive scope and keeps connection consent separate; Escape returns focus", async () => {
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") return { mode: "mock", connections: [] };
      if (path === "/me/integrations/google_drive/start") return {
        state: "mock-state", provider: "google_drive", scopes: drive.scopes, sampleOnly: true, expiresAt: "2099-10-31T00:00:00Z",
      };
      throw new Error(`Unexpected request ${path}`);
    });
    mount();
    const trigger = await screen.findByRole("button", { name: "Connect mock Google Drive" });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: /Mock Google Drive consent/ });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText("https://www.googleapis.com/auth/drive.file")).toBeVisible();
    expect(dialog).toHaveTextContent(/create and modify/);
    expect(dialog).toHaveTextContent(/AI processing and sharing require separate/);
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("button", { name: "Allow mock connection" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  });

  it("revokes in one click, distinguishes pending platform revocation, and requires purge confirmation", async () => {
    let connection = drive;
    fetchMock.mockImplementation(async path => {
      if (path === "/me/integrations") return { mode: "mock", connections: [connection] };
      if (path.endsWith("/revoke")) {
        connection = { ...drive, status: "revoked", generation: 2, providerRevocation: "pending" };
        return { local: "revoked", provider: "pending" };
      }
      if (path.endsWith("/purge")) return { state: "complete" };
      throw new Error(`Unexpected request ${path}`);
    });
    const { client } = mount();
    client.setQueryData(["studio", "thread", "thread-1"], { saved: true });
    fireEvent.click(await screen.findByRole("button", { name: /Revoke mock Google Drive/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/revoke"))).toBe(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText(/Platform revocation pending/)).toBeVisible();
    expect(client.getQueryState(["studio", "thread", "thread-1"])?.isInvalidated).toBe(true);
    const purge = screen.getByRole("button", { name: /Delete imported content/ });
    purge.focus(); fireEvent.click(purge);
    let dialog = screen.getByRole("dialog", { name: /Delete mock imported content/ });
    expect(dialog).toHaveTextContent(/delivered copies/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/purge"))).toBe(false);
    expect(purge).toHaveFocus();
    fireEvent.click(purge);
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText(/Imported mock content deleted/)).toBeVisible();
  });

  it.each([
    [{ status: "partial" }, /Partial permission/],
    [{ status: "reauth_required" }, /Expired/],
    [{ expiresAt: "2000-01-01T00:00:00Z" }, /Expired/],
    [{ lastError: "RATE_LIMITED" }, /Temporarily limited/],
    [{ status: "revoked" }, /Revoked/],
  ] as const)("shows a usable recovery state for %j", async (changes, label) => {
    fetchMock.mockResolvedValue({ mode: "mock", connections: [{ ...drive, ...changes }] });
    mount();
    expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByRole("link", { name: /Start creating/ })).toBeVisible();
  });

  it("uses Traditional Chinese for controls and never prints raw API errors", async () => {
    fetchMock.mockRejectedValue(new ApiError(503, "error", "private server diagnostic"));
    mount("zh");
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時");
    expect(screen.getByRole("link", { name: "先開始創作" })).toBeVisible();
    expect(screen.queryByText(/private server diagnostic/)).not.toBeInTheDocument();
  });

  it("does not claim platform revocation when only local revocation is known", async () => {
    fetchMock.mockResolvedValue({ mode: "mock", connections: [{ ...drive, status: "revoked", providerRevocation: "not_requested" }] });
    mount();
    expect(await screen.findByText(/Platform revocation not confirmed/)).toBeVisible();
    expect(screen.queryByText(/Local and mock platform access revoked/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revoke mock Google Drive/ })).toBeEnabled();
  });
});
