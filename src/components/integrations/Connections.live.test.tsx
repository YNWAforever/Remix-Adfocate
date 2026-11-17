import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import { beginProviderLogin } from "@/lib/integrations/navigation";
import type { IntegrationConnection, LiveAuthorization } from "@/lib/integrations/types";
import { Route } from "@/routes/_app.connections";

vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: vi.fn() }));
vi.mock("./McpSkills", () => ({ McpSkills: () => null }));
vi.mock("@/lib/integrations/navigation", () => ({ beginProviderLogin: vi.fn() }));
vi.mock("@tanstack/react-router", async original => ({
  ...await original<object>(), Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
const fetchMock = vi.mocked(apiFetch), beginMock = vi.mocked(beginProviderLogin);
const clients: QueryClient[] = [];
const instagram: IntegrationConnection = {
  id: "ig-1", provider: "instagram", label: "@live_creator", status: "connected",
  scopes: ["instagram_business_basic", "instagram_business_manage_insights"], generation: 1,
  lastSyncAt: null, expiresAt: "2099-11-18T00:00:00Z", lastError: null, sampleOnly: false, providerRevocation: "not_requested",
};
function mount() {
  localStorage.setItem("lang", "en");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const Page = Route.options.component as () => ReactNode;
  return render(<QueryClientProvider client={client}><I18nProvider><Page /></I18nProvider></QueryClientProvider>);
}
beforeEach(() => {
  fetchMock.mockReset();
  beginMock.mockReset();
  window.history.replaceState(null, "", "/connections");
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("live Instagram connection", () => {
  it("starts a real provider authorization and opens the provider login", async () => {
    const authorization: LiveAuthorization = {
      authorizationUrl: "https://api.instagram.com/oauth/authorize?client_id=app", expiresAt: new Date(Date.now() + 600000).toISOString(),
      provider: "instagram", scopes: instagram.scopes, sampleOnly: false,
    };
    fetchMock.mockImplementation(async (path, init) => path === "/me/integrations" ? { mode: "live_pilot", live: true, connections: [] }
      : init?.method === "POST" && path.endsWith("/start") ? authorization : {});
    mount();
    expect(await screen.findByRole("note", { name: "Live connection pilot" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "D0 offline verification" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Connect Instagram" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("instagram_business_manage_insights");
    fireEvent.click(screen.getByRole("button", { name: "Continue to Instagram" }));
    expect(beginMock).toHaveBeenCalledWith(authorization.authorizationUrl);
    expect(fetchMock.mock.calls.some(([path, init]) => path.endsWith("/start") && init?.method === "POST")).toBe(true);
  });

  it("completes the callback ticket once and cleans the URL", async () => {
    window.history.replaceState(null, "", "/connections#integration=instagram&ticket=ticket-123");
    fetchMock.mockImplementation(async (path, init) => path === "/me/integrations" ? { mode: "live_pilot", live: true, connections: [] }
      : init?.method === "POST" && path.endsWith("/complete") ? { connection: { id: "ig-1", generation: 1 }, returnPath: "/connections", sampleOnly: false } : {});
    mount();
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, init]) => path.endsWith("/complete") && init?.method === "POST" && String(init.body).includes("ticket-123"))).toBe(true));
    expect(window.location.hash).toBe("");
    expect(await screen.findByText("Provider account connected.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === "/me/integrations")).toHaveLength(2);
  });

  it("syncs and revokes through the real service endpoints", async () => {
    fetchMock.mockImplementation(async (path, init) => path === "/me/integrations" ? { mode: "live_pilot", live: true, connections: [instagram] }
      : init?.method === "POST" && path.endsWith("/sync") ? { status: "completed", resources: [] }
        : init?.method === "POST" && path.endsWith("/revoke") ? { local: "revoked", provider: "revoked" } : {});
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Sync insights" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/sync"))).toBe(true));
    expect(await screen.findByText("Insights synced.")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/revoke"))).toBe(true));
  });
});
