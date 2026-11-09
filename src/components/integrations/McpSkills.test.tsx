import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: h.apiFetch }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));

import { McpSkills } from "./McpSkills";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><McpSkills /></QueryClientProvider>);
}

describe("mcp data skills section", () => {
  it("renders nothing when the registry endpoint is unavailable", async () => {
    h.apiFetch.mockRejectedValue(new ApiError(404, "mcp_disabled", "off"));
    const { container } = mount();
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows read-only skills and grants consent", async () => {
    h.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/mcp/skills" && !init) return { available: true, skills: [{ id: SERVER_ID, name: "notes", tools: ["lookup_note"], consented: false }] };
      return { id: SERVER_ID, consented: true };
    });
    mount();
    expect(await screen.findByRole("heading", { name: "notes" })).toBeVisible();
    expect(screen.getByText("lookup_note")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Allow read-only" }));
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalledWith(`/mcp/skills/${SERVER_ID}/consent`, { method: "POST" }));
  });

  it("shows connect and disconnect actions for an OAuth skill", async () => {
    h.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/mcp/skills" && !init) return { available: true, skills: [{ id: SERVER_ID, name: "mysocial", tools: ["search_content"], consented: true, auth_mode: "oauth", connected: false }] };
      return { authorizationUrl: "https://provider.example/authorize" };
    });
    mount();
    expect(await screen.findByRole("button", { name: "Connect account" })).toBeVisible();
    expect(screen.getByText("Not connected")).toBeVisible();
  });

  it("offers reconnect when an OAuth token expired", async () => {
    h.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/mcp/skills" && !init) return { available: true, skills: [{ id: SERVER_ID, name: "mysocial", tools: ["search_content"], consented: true, auth_mode: "oauth", connected: false, expired: true }] };
      return { authorizationUrl: "https://provider.example/authorize" };
    });
    mount();
    expect(await screen.findByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(screen.getByText("Reconnect needed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("revokes consent for an already-allowed skill", async () => {
    h.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/mcp/skills" && !init) return { available: true, skills: [{ id: SERVER_ID, name: "notes", tools: ["lookup_note"], consented: true }] };
      return { id: SERVER_ID, consented: false };
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(h.apiFetch).toHaveBeenCalledWith(`/mcp/skills/${SERVER_ID}/consent`, { method: "DELETE" }));
  });
});
