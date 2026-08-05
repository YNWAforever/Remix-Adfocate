import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  getAdminContent: vi.fn(),
  createContent: vi.fn(),
  updateContent: vi.fn(),
  contentAction: vi.fn(),
  listCategories: vi.fn(),
  uploadContentImage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  useNavigate: () => h.navigate,
}));

vi.mock("@/lib/content", () => ({
  getAdminContent: h.getAdminContent,
  createContent: h.createContent,
  updateContent: h.updateContent,
  contentAction: h.contentAction,
  listCategories: h.listCategories,
  uploadContentImage: h.uploadContentImage,
  contentKeys: {
    adminItem: (id: string) => ["admin", "content", id],
    categories: () => ["admin", "content-categories"],
  },
}));

import { ContentEditor } from "./ContentEditor";

function r(id: string, qc = new QueryClient()) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <ContentEditor id={id} />
    </QueryClientProvider>,
  );
  const showId = (nextId: string) =>
    utils.rerender(
      <QueryClientProvider client={qc}>
        <ContentEditor id={nextId} />
      </QueryClientProvider>,
    );
  return { ...utils, qc, showId };
}

function row(id: string, title: string) {
  return {
    id, kind: "article", audience: "creator", slug: id, status: "draft",
    title_zh: title, title_en: null, excerpt_zh: null, excerpt_en: null,
    body_zh: "內容", body_en: null, cover_image_url: null, category_id: null,
    pinned: false, pinned_rank: null, views: 0, scheduled_for: null,
    published_at: null, updated_at: "2026-07-01T00:00:00Z",
  };
}

const title = () => screen.getByPlaceholderText("Title") as HTMLInputElement;

describe("ContentEditor — audience selector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listCategories.mockResolvedValue({ categories: [] });
  });

  it("defaults a new item's audience to creator and includes the chosen audience in the create payload", async () => {
    h.createContent.mockResolvedValue({ item: { id: "c1", kind: "article", audience: "brand", title_zh: "t", body_zh: "b" } });
    r("new");

    const audienceLabel = await screen.findByText("Audience");
    const audienceSelect = within(audienceLabel).getByRole("combobox") as HTMLSelectElement;
    expect(audienceSelect.value).toBe("creator");

    fireEvent.change(audienceSelect, { target: { value: "brand" } });
    expect(audienceSelect.value).toBe("brand");

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(h.createContent).toHaveBeenCalledWith(expect.objectContaining({ audience: "brand" })));
  });

  it("reflects an existing brand-audience item's value when editing", async () => {
    h.getAdminContent.mockResolvedValue({
      item: {
        id: "c1", kind: "article", audience: "brand", slug: "guide-1", status: "draft",
        title_zh: "指南", title_en: null, excerpt_zh: null, excerpt_en: null,
        body_zh: "內容", body_en: null, cover_image_url: null, category_id: null,
        pinned: false, pinned_rank: null, views: 0, scheduled_for: null,
        published_at: null, updated_at: "2026-07-01T00:00:00Z",
      },
    });
    r("c1");

    const audienceLabel = await screen.findByText("Audience");
    const audienceSelect = within(audienceLabel).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(audienceSelect.value).toBe("brand"));
  });
});

describe("ContentEditor — form seeding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listCategories.mockResolvedValue({ categories: [] });
  });

  it("keeps in-progress edits when a background refetch returns the same record", async () => {
    h.getAdminContent.mockResolvedValue({ item: row("c1", "指南") });
    const { qc } = r("c1");
    await waitFor(() => expect(title().value).toBe("指南"));

    fireEvent.change(title(), { target: { value: "未儲存的草稿" } });

    await act(async () => { await qc.refetchQueries({ queryKey: ["admin", "content", "c1"] }); });

    expect(h.getAdminContent).toHaveBeenCalledTimes(2);
    expect(title().value).toBe("未儲存的草稿");
  });

  it("seeds from cached data when the query does not re-run on mount", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(["admin", "content", "c1"], row("c1", "指南"));
    r("c1", qc);

    await waitFor(() => expect(title().value).toBe("指南"));
    expect(h.getAdminContent).not.toHaveBeenCalled();
  });

  it("loads the new record when the editor switches to a different id", async () => {
    h.getAdminContent.mockImplementation(async (id: string) => ({ item: row(id, id === "c1" ? "指南" : "第二篇") }));
    const { showId } = r("c1");
    await waitFor(() => expect(title().value).toBe("指南"));

    fireEvent.change(title(), { target: { value: "未儲存的草稿" } });
    showId("c2");

    await waitFor(() => expect(title().value).toBe("第二篇"));
  });
});
