import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchWorkspaces: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  fetchWorkspaces: h.fetchWorkspaces,
  adminMissionKeys: { workspaces: ["admin-workspaces"] },
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));

import { AdminWorkspaceProvider, useAdminWorkspace } from "./AdminWorkspaceContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type WorkspaceResult = {
  workspaces: Array<{ id: string; slug: string; name: string }>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe() {
  const { workspace, workspaceSlug } = useAdminWorkspace();
  return (
    <>
      <div data-testid="ws">{workspace || "ALL"}</div>
      <div data-testid="ws-slug">{workspaceSlug || "ALL"}</div>
    </>
  );
}

function wrap(queryClient = new QueryClient()) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AdminWorkspaceProvider>
        <WorkspaceSwitcher />
        <Probe />
      </AdminWorkspaceProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...result };
}

const canonicalWorkspaces: WorkspaceResult = {
  workspaces: [
    { id: "w1", slug: "brand-a", name: "Brand A" },
    { id: "w2", slug: "brand-b", name: "Brand B" },
  ],
};

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/admin/missions");
    h.fetchWorkspaces.mockResolvedValue(canonicalWorkspaces);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to All and persists a selection to sessionStorage + URL", async () => {
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("ALL");
    await screen.findByRole("option", { name: "Brand A" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "w1" } });
    expect(screen.getByTestId("ws").textContent).toBe("w1");
    expect(screen.getByTestId("ws-slug").textContent).toBe("brand-a");
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe("w1");
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBe("brand-a");
    expect(new URLSearchParams(window.location.search).get("ws")).toBe("w1");
  });

  it("reads the initial selection from the URL", async () => {
    window.history.replaceState(null, "", "/admin/missions?ws=w2");
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("w2");
  });

  it("does not expose a persisted slug before async UUID validation and hydrates the canonical slug once", async () => {
    sessionStorage.setItem("adfocate_admin_workspace", "w1");
    sessionStorage.setItem("adfocate_admin_workspace_slug", "stale-brand");
    window.history.replaceState(null, "", "/admin/missions?ws=w1");
    const pending = deferred<WorkspaceResult>();
    h.fetchWorkspaces.mockReturnValue(pending.promise);
    const replaceState = vi.spyOn(window.history, "replaceState");

    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("w1");
    expect(screen.getByTestId("ws-slug").textContent).toBe("ALL");

    pending.resolve(canonicalWorkspaces);
    await screen.findByRole("option", { name: "Brand A" });
    await waitFor(() => expect(screen.getByTestId("ws-slug").textContent).toBe("brand-a"));
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBe("brand-a");
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored slug when the URL selects a different UUID", async () => {
    sessionStorage.setItem("adfocate_admin_workspace", "w1");
    sessionStorage.setItem("adfocate_admin_workspace_slug", "brand-a");
    window.history.replaceState(null, "", "/admin/missions?ws=w2");
    const pending = deferred<WorkspaceResult>();
    h.fetchWorkspaces.mockReturnValue(pending.promise);

    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("w2");
    expect(screen.getByTestId("ws-slug").textContent).toBe("ALL");

    pending.resolve(canonicalWorkspaces);
    await waitFor(() => expect(screen.getByTestId("ws-slug").textContent).toBe("brand-b"));
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBe("w2");
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBe("brand-b");
  });

  it("ignores and clears an orphan persisted slug without a workspace UUID", () => {
    sessionStorage.setItem("adfocate_admin_workspace_slug", "orphan-brand");
    wrap();
    expect(screen.getByTestId("ws").textContent).toBe("ALL");
    expect(screen.getByTestId("ws-slug").textContent).toBe("ALL");
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBeNull();
  });

  it("clears an invalid UUID after the authoritative list loads and stays idempotent on refetch", async () => {
    sessionStorage.setItem("adfocate_admin_workspace", "invalid-workspace");
    sessionStorage.setItem("adfocate_admin_workspace_slug", "stale-brand");
    window.history.replaceState(null, "", "/admin/missions?ws=invalid-workspace");
    const pending = deferred<WorkspaceResult>();
    h.fetchWorkspaces.mockReturnValue(pending.promise);
    const replaceState = vi.spyOn(window.history, "replaceState");

    const { queryClient } = wrap();
    expect(screen.getByTestId("ws").textContent).toBe("invalid-workspace");
    expect(screen.getByTestId("ws-slug").textContent).toBe("ALL");
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBeNull();

    pending.resolve(canonicalWorkspaces);
    await waitFor(() => expect(screen.getByTestId("ws").textContent).toBe("ALL"));
    expect(screen.getByTestId("ws-slug").textContent).toBe("ALL");
    expect(sessionStorage.getItem("adfocate_admin_workspace")).toBeNull();
    expect(sessionStorage.getItem("adfocate_admin_workspace_slug")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("ws")).toBeNull();
    expect(replaceState).toHaveBeenCalledTimes(1);

    await act(async () => {
      queryClient.setQueryData(["admin-workspaces"], {
        workspaces: [...canonicalWorkspaces.workspaces],
      });
      await Promise.resolve();
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
