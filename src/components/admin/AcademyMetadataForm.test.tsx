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
    await screen.findByRole("textbox", { name: "Content idea 1 (中文)" }); fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Content idea 1 (EN)" }), { target: { value: "Authored idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("owned-track", { metadata: { ...row.metadata, ideas: [{ zh: "原中文", en: "Authored idea", future: true }] }, updated_at: initial.updated_at }));
  });
});

it("keeps multilingual idea rows paired when removing one and adding another", async () => {
  const ideas = [{ zh: "第一項", en: "First idea", future: { keep: 1 } }, { zh: "第二項", en: "Second idea", future: { keep: 2 } }];
  const row = { ...initial, kind: "playbook", metadata: { ideas, extension: 9 } };
  h.get.mockResolvedValue({ item: row }); h.update.mockImplementation(async (_id, patch) => ({ item: { ...row, ...patch } })); show();
  await screen.findByRole("textbox", { name: "Content idea 1 (中文)" });
  fireEvent.click(screen.getByRole("button", { name: "Remove content idea 1 in both languages" }));
  expect(screen.getByRole("textbox", { name: "Content idea 1 (中文)" })).toHaveValue("第二項");
  fireEvent.click(screen.getByRole("button", { name: "Add content idea" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Content idea 2 (中文)" }), { target: { value: "新增項目\n保留換行" } });
  fireEvent.click(screen.getByRole("button", { name: "EN" }));
  expect(screen.getByRole("textbox", { name: "Content idea 1 (EN)" })).toHaveValue("Second idea");
  expect(screen.getByRole("textbox", { name: "Content idea 2 (EN)" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.update).toHaveBeenCalledWith("owned-track", { metadata: { extension: 9, ideas: [ideas[1], { zh: "新增項目\n保留換行", en: "" }] }, updated_at: initial.updated_at }));
});

it("rebases an edited idea translation without overwriting another author's language or extension", async () => {
  const row = { ...initial, kind: "playbook", metadata: { ideas: [{ zh: "原中文", en: "Original", future: true }, { zh: "第二項", en: "Second", extension: 1 }] } };
  const latest = { ...row, updated_at: "2026-10-24T01:00:00Z", metadata: { ideas: [{ zh: "原中文", en: "Concurrent EN", future: "remote" }, row.metadata.ideas[1]], added: true } };
  h.get.mockResolvedValueOnce({ item: row }).mockResolvedValue({ item: latest });
  h.update.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 })); show();
  fireEvent.change(await screen.findByRole("textbox", { name: "Content idea 1 (中文)" }), { target: { value: "我的中文" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep my edits on this revision" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.update).toHaveBeenLastCalledWith("owned-track", { metadata: { ...latest.metadata, ideas: [{ zh: "我的中文", en: "Concurrent EN", future: "remote" }, row.metadata.ideas[1]] }, updated_at: latest.updated_at }));
});

it.each(["reorder", "add"])("keeps both idea snapshots when concurrent %s makes translation pairing ambiguous", async change => {
  const ideas = [{ zh: "第一項", en: "First" }, { zh: "第二項", en: "Second" }];
  const row = { ...initial, kind: "playbook", metadata: { ideas } };
  const latest = { ...row, updated_at: "2026-10-24T01:00:00Z", metadata: { ideas: change === "reorder" ? [ideas[1], ideas[0]] : [...ideas, { zh: "遠端新增", en: "Remote added" }] } };
  h.get.mockResolvedValueOnce({ item: row }).mockResolvedValue({ item: latest });
  h.update.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 })); show();
  fireEvent.change(await screen.findByRole("textbox", { name: "Content idea 1 (中文)" }), { target: { value: "保留的本機中文" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep my edits on this revision" }));
  expect(await screen.findByText(/Idea rows changed; your draft and latest comparison are preserved/)).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Content idea 1 (中文)" })).toHaveValue("保留的本機中文");
  expect(screen.getByRole("button", { name: "Keep my edits on this revision" })).toBeVisible();
  expect(h.update).toHaveBeenCalledTimes(1);
});

it("explicitly adopts changed latest idea rows while retaining the other authored fields", async () => {
  const ideas = [{ zh: "第一項", en: "First" }, { zh: "第二項", en: "Second" }];
  const row = { ...initial, kind: "playbook", metadata: { ideas } };
  const latest = { ...row, updated_at: "2026-10-24T02:00:00Z", metadata: { ideas: [ideas[1], ideas[0], { zh: "遠端新增", en: "Remote added" }], future: "remote" } };
  h.get.mockResolvedValueOnce({ item: row }).mockResolvedValue({ item: latest });
  h.update.mockImplementation(async (_id, patch) => ({ item: { ...latest, ...patch } })).mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 })); show();
  fireEvent.change(await screen.findByRole("textbox", { name: "Content idea 1 (中文)" }), { target: { value: "本機點子修改" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Title (中文)" }), { target: { value: "保留的標題" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep my edits on this revision" }));
  await screen.findByText(/Idea rows changed; your draft and latest comparison are preserved/);
  expect(screen.getByRole("textbox", { name: "Content idea 1 (中文)" })).toHaveValue("本機點子修改");
  fireEvent.click(screen.getByRole("button", { name: "Use latest ideas and discard local idea edits" }));
  expect(screen.getByRole("textbox", { name: "Content idea 1 (中文)" })).toHaveValue("第二項");
  expect(screen.getByRole("textbox", { name: "Content idea 3 (中文)" })).toHaveValue("遠端新增");
  expect(screen.getByRole("textbox", { name: "Title (中文)" })).toHaveValue("保留的標題");
  fireEvent.click(screen.getByRole("button", { name: "Keep my edits on this revision" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.update).toHaveBeenLastCalledWith("owned-track", { title_zh: "保留的標題", updated_at: latest.updated_at }));
});
