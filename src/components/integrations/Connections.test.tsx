import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { IntegrationConnection } from "@/lib/integrations/types";
import { Route } from "@/routes/_app.connections";

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
function mount(lang = "en") {
  localStorage.setItem("lang", lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const Page = Route.options.component as () => ReactNode;
  return { client, ...render(<QueryClientProvider client={client}><I18nProvider><Page /></I18nProvider></QueryClientProvider>) };
}
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("mock connection journeys", () => {
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
