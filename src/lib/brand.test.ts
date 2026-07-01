import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBrandResources, fetchBrandResource, brandKeys, BrandAuthError } from "./brand";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

describe("brand resources client", () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("brandKeys.resources/resource are stable tuples", () => {
    expect(brandKeys.resources(2)).toEqual(["brand-resources", 2]);
    expect(brandKeys.resource("guide-1")).toEqual(["brand-resource", "guide-1"]);
  });

  it("fetchBrandResources hits /api/brand/resources with the bearer token and page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), { status: 200 }),
    );
    await fetchBrandResources(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/brand/resources?page=2",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer jwt-123" }) }),
    );
  });

  it("fetchBrandResource hits /api/brand/resources/:slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ item: {
        id: "1", slug: "guide-1", kind: "article", title: "Guide", excerpt: null,
        coverImageUrl: null, publishedAt: null, pinned: false, views: 0,
      } }), { status: 200 }),
    );
    const { item } = await fetchBrandResource("guide-1");
    expect(item.slug).toBe("guide-1");
  });

  it("throws BrandAuthError on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    await expect(fetchBrandResources()).rejects.toBeInstanceOf(BrandAuthError);
  });
});
