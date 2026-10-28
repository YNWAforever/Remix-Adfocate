import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const h = vi.hoisted(() => ({ api: vi.fn(), completed: false, conflict: false, version: 1, actor: "creator-a" }));
vi.mock("@tanstack/react-router", async original => ({ ...(await original<object>()),
  useParams: () => ({ trackId: "owned-course" }), Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMe: () => ({ data: { id: h.actor, level: "L0", is_trusted: false } }) }));
vi.mock("@/lib/academy", async original => ({ ...(await original<object>()), fetchAcademyTrack: async () => ({ item: {
  id: "track", slug: "owned-course", title: "Owned course", kind: "track", requiredLevel: "L0", body: "Course introduction", excerpt: "Overview", meta: { duration: "4 lessons" }, learningEnabled: true,
} }) }));
vi.mock("@/lib/api", async original => ({ ...(await original<object>()), apiFetch: h.api }));
import { ApiError } from "@/lib/api";
import { Route } from "./_app.guide.track.$trackId";

function bundle() {
  const completed = h.completed && h.actor === "creator-a" && h.version === 1;
  return { lessons: [
    { id: "first", trackId: "track", title: "First actual unit", body: `## Unit one v${h.version}\n\nActual lesson reading.`, position: 0, contentVersion: h.version, status: "published", completed, completedAt: completed ? "2026-10-23T09:00:00Z" : null },
    { id: "second", trackId: "track", title: "Second actual unit", body: "Second lesson reading.", position: 1, contentVersion: 1, status: "published", completed: false, completedAt: null },
  ], progress: { completed: completed ? 1 : 0, total: 2 }, history: h.completed ? [{ lessonId: "first", contentVersion: 1, completedAt: "2026-10-23T09:00:00Z" }] : [] };
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = Route.options.component as ComponentType;
  return { client, ...render(<QueryClientProvider client={client}><C /></QueryClientProvider>) };
}
beforeEach(() => {
  vi.clearAllMocks(); h.completed = false; h.conflict = false; h.version = 1; h.actor = "creator-a";
  h.api.mockImplementation(async (_path: string, options?: { method?: string }) => {
    if (options?.method === "POST") {
      if (h.conflict) throw new ApiError(409, "version_changed", "version_changed");
      h.completed = true; return { completedAt: "2026-10-23T09:00:00Z" };
    }
    return bundle();
  });
});
describe("D15 learning UI", () => {
  it("keeps denied lesson cache hidden through later outages until a successful authorized read", async () => {
    const { client } = show(); await screen.findByRole("heading", { name: "Unit one v1" });
    for (const error of [new ApiError(403, "forbidden", "Denied"), new ApiError(503, "unavailable", "Unavailable"), new TypeError("Network unavailable")]) {
      h.api.mockRejectedValue(error);
      await act(async () => { await client.refetchQueries({ queryKey: ["academy-learning"] }); });
      expect(screen.queryByRole("heading", { name: "Unit one v1" })).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    }
    h.api.mockResolvedValue(bundle());
    await act(async () => { await client.refetchQueries({ queryKey: ["academy-learning"] }); });
    expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
  });

  it("does not clear completion denial after an unsuccessful refresh", async () => {
    show(); await screen.findByRole("heading", { name: "Unit one v1" });
    h.api.mockRejectedValueOnce(new ApiError(403, "forbidden", "Denied"));
    fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
    await screen.findByRole("alert");
    h.api.mockRejectedValue(new ApiError(503, "unavailable", "Unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "重試載入單元" }));
    await waitFor(() => expect(h.api).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Unit one v1" })).not.toBeInTheDocument();
    h.api.mockResolvedValue(bundle());
    fireEvent.click(screen.getByRole("button", { name: "重試載入單元" }));
    expect(await screen.findByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
  });

  it("hides lessons after denied completion and recovers reading after access is restored", async () => {
    show(); await screen.findByRole("heading", { name: "Unit one v1" });
    h.api.mockRejectedValueOnce(new ApiError(403, "forbidden", "Access revoked"));
    fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "Unit one v1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試載入單元" }));
    expect(await screen.findByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
    expect(screen.getByText("0 / 2 已完成")).toBeInTheDocument();
  });
  it.each([401, 403, 404, 503])("handles a cached lesson refetch denied with %s", async status => {
    const { client } = show();
    await screen.findByRole("heading", { name: "Unit one v1" });
    h.api.mockRejectedValue(new ApiError(status, "read_failed", "Read failed"));
    await act(async () => { await client.refetchQueries({ queryKey: ["academy-learning"] }); });
    await screen.findByRole("alert");
    if (status === 503) expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
    else expect(screen.queryByRole("heading", { name: "Unit one v1" })).not.toBeInTheDocument();
  });
  it("renders actual units, completes one, and reads the same 1/2 on a fresh mount", async () => {
    const first = show();
    expect(await screen.findByText("0 / 2 已完成")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
    expect(screen.queryByText(/4 lessons/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
    expect(await screen.findByText("1 / 2 已完成")).toBeInTheDocument();
    first.unmount(); show(); expect(await screen.findByText("1 / 2 已完成")).toBeInTheDocument();
  });
  it("409 preserves the reading and refreshes the new version without completing it", async () => {
    h.conflict = true; show(); await screen.findByText("0 / 2 已完成");
    fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/版本/);
    expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
    h.version = 2; h.completed = true;
    fireEvent.click(screen.getByRole("button", { name: "重新載入單元" }));
    expect(await screen.findByRole("heading", { name: "Unit one v2" })).toBeInTheDocument();
    expect(screen.getByText("0 / 2 已完成")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("v1");
  });
  it("does not carry another Creator's cached progress into the new identity", async () => {
    h.completed = true; const first = show(); await screen.findByText("1 / 2 已完成");
    expect(first.client.getQueryCache().getAll().some(q => q.queryKey.includes("creator-a"))).toBe(true);
    first.unmount(); h.actor = "creator-b"; show();
    await waitFor(() => expect(screen.getByText("0 / 2 已完成")).toBeInTheDocument());
  });
  it("an unavailable read can retry and an unavailable write never advances completion", async () => {
    h.api.mockRejectedValueOnce(new ApiError(503, "learning_unavailable", "Storage unavailable"));
    show(); expect(await screen.findByRole("alert")).toHaveTextContent("無法載入單元");
    fireEvent.click(screen.getByRole("button", { name: "重試載入單元" }));
    await screen.findByText("0 / 2 已完成");
    h.api.mockRejectedValueOnce(new ApiError(503, "learning_unavailable", "Storage unavailable"));
    fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未確認完成");
    expect(screen.getByText("0 / 2 已完成")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新載入單元" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("0 / 2 已完成")).toBeInTheDocument();
  });
});

it("retains a completion denial across remount until the same query reads successfully", async () => {
  const first = show(); await screen.findByRole("heading", { name: "Unit one v1" });
  h.api.mockRejectedValueOnce(new ApiError(403, "forbidden", "Denied"));
  fireEvent.click(screen.getAllByRole("button", { name: "標記完成" })[0]);
  await screen.findByRole("alert");
  first.unmount();
  h.api.mockRejectedValue(new ApiError(503, "unavailable", "Unavailable"));
  const C = Route.options.component as ComponentType;
  render(<QueryClientProvider client={first.client}><C /></QueryClientProvider>);
  await act(async () => { await first.client.refetchQueries({ queryKey: ["academy-learning"] }); });
  expect(screen.queryByRole("heading", { name: "Unit one v1" })).not.toBeInTheDocument();
  h.api.mockResolvedValue(bundle());
  await act(async () => { await first.client.refetchQueries({ queryKey: ["academy-learning"] }); });
  expect(screen.getByRole("heading", { name: "Unit one v1" })).toBeInTheDocument();
});
