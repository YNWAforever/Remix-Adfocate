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

  it("seeds the form and the metadata textarea from the loaded record", async () => {
    h.getAdminAcademy.mockResolvedValue({ item: row("a1", "新手指南") });
    r("a1");

    await waitFor(() => expect(title().value).toBe("新手指南"));
    expect((screen.getByRole("textbox", { name: /Metadata/ }) as HTMLTextAreaElement).value)
      .toBe(JSON.stringify({ steps: 3 }, null, 2));
  });

  it("keeps in-progress edits when a background refetch returns the same record", async () => {
    h.getAdminAcademy.mockResolvedValue({ item: row("a1", "新手指南") });
    const { qc } = r("a1");
    await waitFor(() => expect(title().value).toBe("新手指南"));

    fireEvent.change(title(), { target: { value: "未儲存的草稿" } });
    const meta = screen.getByRole("textbox", { name: /Metadata/ }) as HTMLTextAreaElement;
    fireEvent.change(meta, { target: { value: '{"steps": 9}' } });

    await act(async () => { await qc.refetchQueries({ queryKey: ["admin", "academy", "a1"] }); });

    expect(h.getAdminAcademy).toHaveBeenCalledTimes(2);
    expect(title().value).toBe("未儲存的草稿");
    expect((screen.getByRole("textbox", { name: /Metadata/ }) as HTMLTextAreaElement).value).toBe('{"steps": 9}');
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
