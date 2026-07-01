import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

function r(id: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentEditor id={id} />
    </QueryClientProvider>,
  );
}

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
