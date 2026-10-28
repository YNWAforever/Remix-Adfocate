import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  getAdminAcademy: vi.fn(),
  createAcademy: vi.fn(),
  updateAcademy: vi.fn(),
  academyAction: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  useNavigate: () => h.navigate,
}));

vi.mock("@/lib/academy", () => ({
  getAdminAcademy: h.getAdminAcademy,
  createAcademy: h.createAcademy,
  updateAcademy: h.updateAcademy,
  academyAction: h.academyAction,
  academyKeys: { adminItem: (id: string) => ["admin", "academy", id] },
}));

import { AcademyEditor } from "./AcademyEditor";

function r(id: string, qc = new QueryClient()) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <AcademyEditor id={id} />
    </QueryClientProvider>,
  );
  const showId = (nextId: string) =>
    utils.rerender(
      <QueryClientProvider client={qc}>
        <AcademyEditor id={nextId} />
      </QueryClientProvider>,
    );
  return { ...utils, qc, showId };
}

function row(id: string, title: string) {
  return {
    id, kind: "guide_doc", slug: id, status: "draft",
    title_zh: title, title_en: null, excerpt_zh: null, excerpt_en: null,
    body_zh: "內容", body_en: null, category: "start", required_level: null,
    emoji: "📘", color: "", sort: 0, metadata: { steps: 3 },
    published_at: null, archived_at: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
  };
}

const title = () => screen.getByPlaceholderText("Title") as HTMLInputElement;

describe("AcademyEditor — form seeding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds the form and preserves unknown metadata by omitting unedited fields from the patch", async () => {
    h.getAdminAcademy.mockResolvedValue({ item: row("a1", "新手指南") });
    r("a1");

    await waitFor(() => expect(title().value).toBe("新手指南"));
    expect(screen.queryByRole("textbox", { name: /Metadata/ })).not.toBeInTheDocument();
    h.updateAcademy.mockResolvedValueOnce({ item: { ...row("a1", "改動標題") } });
    fireEvent.change(title(), { target: { value: "改動標題" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateAcademy).toHaveBeenCalledWith("a1", { title_zh: "改動標題", updated_at: "2026-07-01T00:00:00Z" }));
  });

  it("keeps in-progress edits when a background refetch returns the same record", async () => {
    h.getAdminAcademy.mockResolvedValue({ item: row("a1", "新手指南") });
    const { qc } = r("a1");
    await waitFor(() => expect(title().value).toBe("新手指南"));

    fireEvent.change(title(), { target: { value: "未儲存的草稿" } });
    const body = screen.getByRole("textbox", { name: "Body (中文)" });
    fireEvent.change(body, { target: { value: "未儲存的正文" } });

    await act(async () => { await qc.refetchQueries({ queryKey: ["admin", "academy", "a1"] }); });

    expect(h.getAdminAcademy).toHaveBeenCalledTimes(2);
    expect(title().value).toBe("未儲存的草稿");
    expect(body).toHaveValue("未儲存的正文");
  });

  it("seeds from cached data when the query does not re-run on mount", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(["admin", "academy", "a1"], row("a1", "新手指南"));
    r("a1", qc);

    await waitFor(() => expect(title().value).toBe("新手指南"));
    expect(h.getAdminAcademy).not.toHaveBeenCalled();
  });

  it("loads the new record when the editor switches to a different id", async () => {
    h.getAdminAcademy.mockImplementation(async (id: string) => ({ item: row(id, id === "a1" ? "新手指南" : "第二篇") }));
    const { showId } = r("a1");
    await waitFor(() => expect(title().value).toBe("新手指南"));

    fireEvent.change(title(), { target: { value: "未儲存的草稿" } });
    showId("a2");

    await waitFor(() => expect(title().value).toBe("第二篇"));
  });
});

describe("D14 Academy authoring", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("labels title, excerpt and body, including the resource body", () => {
    r("new");
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "resource" } });
    expect(screen.getByRole("textbox", { name: "Title (中文)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Excerpt (中文)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Body (中文)" }), { target: { value: "## 可閱讀的資源正文" } });
    expect(screen.getByRole("heading", { name: "可閱讀的資源正文" })).toBeInTheDocument();
  });

  it("shows save failure, preserves the body and allows a successful retry", async () => {
    h.getAdminAcademy.mockResolvedValue({ item: row("a1", "課程草稿") });
    h.updateAcademy.mockRejectedValueOnce(new Error("Service unavailable"))
      .mockResolvedValueOnce({ item: { ...row("a1", "課程草稿"), body_zh: "保留的正文" } });
    r("a1");
    await waitFor(() => expect(title()).toHaveValue("課程草稿"));
    fireEvent.change(screen.getByPlaceholderText("Markdown…"), { target: { value: "保留的正文" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Service unavailable/);
    expect(screen.getByPlaceholderText("Markdown…")).toHaveValue("保留的正文");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateAcademy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("a published edit sends changed fields and revision, without resubmitting the locked slug", async () => {
    const current = { ...row("a1", "課程正文"), status: "published" };
    h.getAdminAcademy.mockResolvedValue({ item: current });
    h.updateAcademy.mockResolvedValue({ item: { ...current, body_zh: "已修正文" } });
    r("a1");
    await waitFor(() => expect(title()).toHaveValue("課程正文"));
    fireEvent.change(screen.getByPlaceholderText("Markdown…"), { target: { value: "已修正文" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateAcademy).toHaveBeenCalledWith("a1", { body_zh: "已修正文", updated_at: current.updated_at }));
  });

  it("409 review keeps the draft and rebases only edited fields after explicit acknowledgement", async () => {
    const initial = row("a1", "原有標題");
    const latest = { ...initial, title_zh: "其他作者更新", updated_at: "2026-07-02T00:00:00Z" };
    h.getAdminAcademy.mockResolvedValueOnce({ item: initial }).mockResolvedValue({ item: latest });
    h.updateAcademy.mockRejectedValueOnce(Object.assign(new Error("stale"), { status: 409 }))
      .mockResolvedValue({ item: { ...latest, body_zh: "我的正文草稿" } });
    r("a1");
    await waitFor(() => expect(title()).toHaveValue(initial.title_zh));
    fireEvent.change(screen.getByPlaceholderText("Markdown…"), { target: { value: "我的正文草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compare latest" }));
    expect(await screen.findByText(/其他作者更新/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Markdown…")).toHaveValue("我的正文草稿");
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits on this revision" }));
    expect(title()).toHaveValue("其他作者更新");
    expect(screen.getByPlaceholderText("Markdown…")).toHaveValue("我的正文草稿");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateAcademy).toHaveBeenLastCalledWith("a1", { body_zh: "我的正文草稿", updated_at: latest.updated_at }));
  });
});
