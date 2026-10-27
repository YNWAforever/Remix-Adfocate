import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach } from "vitest";
const h = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@tanstack/react-router", async original => ({ ...(await original<object>()), useNavigate: () => vi.fn() }));
vi.mock("@/lib/academy", async original => ({ ...(await original<object>()), getAdminAcademy: h.get, updateAcademy: h.update }));
vi.mock("./AcademyLessonsEditor", () => ({ AcademyLessonsEditor: () => null }));
import { AcademyEditor } from "./AcademyEditor";
const metadata = { duration: { zh: "10 分鐘", en: "10 minutes" }, levelLabel: { zh: "新手", en: "Starter" }, future: { retain: [1,2] }, learningEnabled: false };
const initial = { id: "owned-track", kind: "track", slug: "owned-track", status: "draft", title_zh: "合成 parent", body_zh: "", metadata, required_level: "L0", updated_at: "2026-10-23T00:00:00Z" };
function show() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<QueryClientProvider client={client}><AcademyEditor id="owned-track" /></QueryClientProvider>); return client; }
beforeEach(() => { vi.clearAllMocks(); h.get.mockResolvedValue({ item: initial }); h.update.mockImplementation(async (_id, patch) => ({ item: { ...initial, ...patch } })); });
afterEach(cleanup);
describe("F27 parent metadata business form", () => {
  it("edits localized learning time with no raw JSON editor and preserves unknown metadata", async () => {
    show(); const field = await screen.findByRole("textbox", { name: "Learning time (中文)" });
    expect(field).toHaveValue("10 分鐘"); expect(screen.queryByRole("textbox", { name: /Metadata/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Learning time (EN)" }), { target: { value: "15 minutes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("owned-track", { metadata: { ...metadata, duration: { zh: "10 分鐘", en: "15 minutes" } }, updated_at: initial.updated_at }));
  });
  it("retains authored parent metadata after failure and saves it on explicit retry", async () => {
    h.update.mockRejectedValueOnce(new Error("Unavailable")); show();
    const field = await screen.findByRole("textbox", { name: "Learning time (中文)" });
    fireEvent.change(field, { target: { value: "保留的時間" } }); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert"); expect(field).toHaveValue("保留的時間");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument()); expect(field).toHaveValue("保留的時間");
  });
  it("409 comparison rebases only the edited language and retains concurrent unknown keys", async () => {
    const latest = { ...initial, metadata: { ...metadata, duration: { zh: "10 分鐘", en: "20 minutes" }, future: { retain: [3] }, serverAdded: true }, updated_at: "2026-10-24T00:00:00Z" };
    h.get.mockResolvedValueOnce({ item: initial }).mockResolvedValue({ item: latest });
    h.update.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 })); show();
    fireEvent.change(await screen.findByRole("textbox", { name: "Learning time (中文)" }), { target: { value: "我的時間" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep my edits on this revision" }));
    expect(screen.getByRole("textbox", { name: "Learning time (中文)" })).toHaveValue("我的時間");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith("owned-track", { metadata: { ...latest.metadata, duration: { zh: "我的時間", en: "20 minutes" } }, updated_at: latest.updated_at }));
  });
  it("background refresh preserves authored metadata until the operator decides to save", async () => {
    const client = show(); const field = await screen.findByRole("textbox", { name: "Learning time (中文)" });
    fireEvent.change(field, { target: { value: "未儲存時間" } });
    h.get.mockResolvedValue({ item: { ...initial, metadata: { ...metadata, duration: { zh: "伺服器更新", en: "Server" } } } });
    await act(async () => { await client.refetchQueries(); }); expect(field).toHaveValue("未儲存時間");
  });
  it("409 normalizes legacy plain-string translations before merging another language's update", async () => {
    const legacy = { ...initial, metadata: { ...metadata, duration: "Legacy time" } };
    const latest = { ...legacy, metadata: { ...legacy.metadata, duration: { zh: "Legacy time", en: "Concurrent EN" }, futureAdded: true }, updated_at: "2026-10-24T01:00:00Z" };
    h.get.mockResolvedValueOnce({ item: legacy }).mockResolvedValue({ item: latest });
    h.update.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 })); show();
    fireEvent.change(await screen.findByRole("textbox", { name: "Learning time (中文)" }), { target: { value: "我的時間" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep my edits on this revision" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith("owned-track", { metadata: { ...latest.metadata, duration: { zh: "我的時間", en: "Concurrent EN" } }, updated_at: latest.updated_at }));
  });
  it("resource format edits preserve its download link and unknown fields without JSON", async () => {
    const row = { ...initial, kind: "resource", metadata: { type: "PDF", fileUrl: "https://example.invalid/owned.pdf", future: { retain: true } } };
    h.get.mockResolvedValue({ item: row }); h.update.mockImplementation(async (_id, patch) => ({ item: { ...row, ...patch } })); show();
    fireEvent.change(await screen.findByRole("textbox", { name: "Resource format / 資源格式" }), { target: { value: "Guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("owned-track", { metadata: { ...row.metadata, type: "Guide" }, updated_at: initial.updated_at }));
    expect(screen.queryByRole("textbox", { name: /Metadata/ })).not.toBeInTheDocument();
  });
  it("playbook idea editing preserves the other language and nested future fields", async () => {
    const row = { ...initial, kind: "playbook", metadata: { ideas: [{ zh: "原中文", en: "Original", future: true }], levels: ["L0"], extension: 9 } };
    h.get.mockResolvedValue({ item: row }); h.update.mockImplementation(async (_id, patch) => ({ item: { ...row, ...patch } })); show();
    await screen.findByRole("textbox", { name: "Content ideas (中文)" }); fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Content ideas (EN)" }), { target: { value: "Authored idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("owned-track", { metadata: { ...row.metadata, ideas: [{ zh: "原中文", en: "Authored idea", future: true }] }, updated_at: initial.updated_at }));
  });
});
