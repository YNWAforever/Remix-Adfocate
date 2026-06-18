import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("creator profile media schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets a creator CRUD only their own portfolio links", async () => {
    const c1 = await makeCreator("profile-media-rls-1@test.local");
    const c2 = await makeCreator("profile-media-rls-2@test.local");
    const user1 = userForJwt(c1.jwt);
    const user2 = userForJwt(c2.jwt);

    const { data: own, error: insertErr } = await user1
      .from("creator_portfolio_links")
      .insert({
        creator_id: c1.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/work",
        title: "Launch reel",
        platform_type: "instagram",
        caption: "Beauty launch",
        sort_order: 10,
        public_highlight: true,
      })
      .select("id, creator_id, title, public_highlight")
      .single();

    expect(insertErr).toBeNull();
    expect(own).toMatchObject({ creator_id: c1.userId, title: "Launch reel", public_highlight: true });

    const { data: visibleToOwner, error: ownerReadErr } = await user1
      .from("creator_portfolio_links")
      .select("id, title");
    expect(ownerReadErr).toBeNull();
    expect(visibleToOwner).toHaveLength(1);

    const { data: visibleToOther, error: otherReadErr } = await user2
      .from("creator_portfolio_links")
      .select("id, title");
    expect(otherReadErr).toBeNull();
    expect(visibleToOther).toEqual([]);

    const { error: otherUpdateErr } = await user2
      .from("creator_portfolio_links")
      .update({ title: "Cross-tenant edit" })
      .eq("id", own!.id);
    expect(otherUpdateErr).toBeNull();

    const { data: afterBlockedUpdate, error: reloadErr } = await user1
      .from("creator_portfolio_links")
      .select("title")
      .eq("id", own!.id)
      .single();
    expect(reloadErr).toBeNull();
    expect(afterBlockedUpdate).toEqual({ title: "Launch reel" });
  });

  it("enforces at most three public highlights per creator", async () => {
    const creator = await makeCreator("profile-media-highlight-cap@test.local");
    const svc = serviceForTests();

    const rows = [1, 2, 3].map((n) => ({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: `https://example.com/work-${n}`,
      title: `Work ${n}`,
      platform_type: "website",
      sort_order: n,
      public_highlight: true,
    }));

    const { error: firstErr } = await svc.from("creator_portfolio_links").insert(rows);
    expect(firstErr).toBeNull();

    const { error: fourthErr } = await svc.from("creator_portfolio_links").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: "https://example.com/work-4",
      title: "Work 4",
      platform_type: "website",
      sort_order: 4,
      public_highlight: true,
    });

    expect(fourthErr).not.toBeNull();
    expect(fourthErr?.message).toContain("creator_portfolio_links highlight limit exceeded");
  });

  it("keeps public profile snapshots service-owned and bounded", async () => {
    const creator = await makeCreator("profile-media-snapshot@test.local");
    const svc = serviceForTests();
    const user = userForJwt(creator.jwt);

    const { error: directInsertErr } = await user.from("creator_public_profile_snapshots").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [],
      published_by: creator.userId,
    });
    expect(directInsertErr).not.toBeNull();

    const { error: serviceInsertErr } = await svc.from("creator_public_profile_snapshots").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [
        { url: "https://example.com/1", title: "One", platform_type: "website", caption: null, sort_order: 1 },
        { url: "https://example.com/2", title: "Two", platform_type: "website", caption: null, sort_order: 2 },
        { url: "https://example.com/3", title: "Three", platform_type: "website", caption: null, sort_order: 3 },
      ],
      published_by: creator.userId,
    });
    expect(serviceInsertErr).toBeNull();

    const { error: tooManyErr } = await svc.from("creator_public_profile_snapshots").upsert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [
        { url: "https://example.com/1", title: "One", platform_type: "website", caption: null, sort_order: 1 },
        { url: "https://example.com/2", title: "Two", platform_type: "website", caption: null, sort_order: 2 },
        { url: "https://example.com/3", title: "Three", platform_type: "website", caption: null, sort_order: 3 },
        { url: "https://example.com/4", title: "Four", platform_type: "website", caption: null, sort_order: 4 },
      ],
      published_by: creator.userId,
    });
    expect(tooManyErr).not.toBeNull();
  });

  it("creates the public creator avatar storage bucket with upload limits", async () => {
    const svc = serviceForTests();
    const { data, error } = await svc.storage.getBucket("creator-avatars");

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: "creator-avatars",
      public: true,
      file_size_limit: 5_242_880,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
  });
});
