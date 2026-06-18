import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("creator profile media API", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates, updates, caps, and deletes portfolio links", async () => {
    const creator = await makeCreator("profile-media-api@test.local");

    const created = await req("/me/profile-media/portfolio", creator.jwt, {
      method: "POST",
      body: JSON.stringify({
        url: "example.com/launch",
        title: "Launch reel",
        platform_type: "instagram",
        caption: "Beauty launch",
        sort_order: 2,
        public_highlight: true,
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.link).toMatchObject({
      url: "https://example.com/launch",
      title: "Launch reel",
      platformType: "instagram",
      publicHighlight: true,
    });

    const patched = await req(`/me/profile-media/portfolio/${createdBody.link.id}`, creator.jwt, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated reel", caption: "" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).link).toMatchObject({ title: "Updated reel", caption: null });

    for (const index of [1, 2]) {
      const res = await req("/me/profile-media/portfolio", creator.jwt, {
        method: "POST",
        body: JSON.stringify({
          url: `https://example.com/highlight-${index}`,
          title: `Highlight ${index}`,
          platform_type: "website",
          public_highlight: true,
        }),
      });
      expect(res.status).toBe(200);
    }

    const fourth = await req("/me/profile-media/portfolio", creator.jwt, {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com/highlight-4",
        title: "Highlight 4",
        platform_type: "website",
        public_highlight: true,
      }),
    });
    expect(fourth.status).toBe(400);
    expect((await fourth.json()).code).toBe("highlight_limit");

    const deleted = await req(`/me/profile-media/portfolio/${createdBody.link.id}`, creator.jwt, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).deleted).toBe(true);
  }, 120_000);

  it("returns upload metadata and selects an owned uploaded avatar", async () => {
    const creator = await makeCreator("profile-media-avatar@test.local");
    const upload = await req("/me/profile-media/avatar-upload", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ fileName: "face.png", contentType: "image/png", sizeBytes: 1024 }),
    });
    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    expect(uploadBody.bucket).toBe("creator-avatars");
    expect(uploadBody.path).toMatch(new RegExp(`^${creator.userId}/.+\\.png$`));
    expect(uploadBody.publicUrl).toContain("/storage/v1/object/public/creator-avatars/");

    const svc = serviceForTests();
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { error: objectErr } = await svc.storage
      .from("creator-avatars")
      .upload(uploadBody.path, pngBytes, { contentType: "image/png" });
    expect(objectErr).toBeNull();

    const selected = await req("/me/profile-media/avatar-select", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ storagePath: uploadBody.path }),
    });
    expect(selected.status).toBe(200);
    expect((await selected.json()).avatarUrl).toBe(uploadBody.publicUrl);
  }, 120_000);

  it("rejects selecting another creator's path and selecting a missing upload", async () => {
    const creator = await makeCreator("profile-media-avatar-reject@test.local");
    const otherCreator = await makeCreator("profile-media-avatar-other@test.local");

    const foreignStoragePath = `${otherCreator.userId}/foreign.png`;
    const foreignPath = await req("/me/profile-media/avatar-select", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ storagePath: foreignStoragePath }),
    });
    expect(foreignPath.status).toBe(400);
    expect(await foreignPath.json()).toMatchObject({ code: "bad_avatar_path" });

    const missingPath = `${creator.userId}/missing.png`;
    const missing = await req("/me/profile-media/avatar-select", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ storagePath: missingPath }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
  }, 120_000);

  it("publishes only public-safe avatar and selected highlights", async () => {
    const creator = await makeCreator("profile-media-publish@test.local");
    const svc = serviceForTests();

    await svc.from("creators").update({ avatar_url: "https://cdn.example.com/selected-avatar.jpg" }).eq("id", creator.userId);
    await svc.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "privatehandle",
      sync_status: "synced",
      follower_count: 123456,
      engagement_rate: 9.9,
      external_avatar_url: "https://cdn.example.com/external-private.jpg",
      api_synced_at: new Date().toISOString(),
    });
    await svc.from("creator_portfolio_links").insert([
      {
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/public",
        title: "Public work",
        platform_type: "website",
        caption: "Launch proof",
        sort_order: 1,
        public_highlight: true,
      },
      {
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/private",
        title: "Private work",
        platform_type: "website",
        sort_order: 2,
        public_highlight: false,
      },
    ]);

    const published = await req("/me/profile-media/publish", creator.jwt, { method: "POST" });
    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.published.avatarUrl).toBe("https://cdn.example.com/selected-avatar.jpg");
    expect(body.published.highlights).toEqual([
      {
        url: "https://example.com/public",
        title: "Public work",
        platform_type: "website",
        caption: "Launch proof",
        sort_order: 1,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("privatehandle");
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(body)).not.toContain("external-private");
  }, 120_000);

  it("returns private completeness to the owner", async () => {
    const creator = await makeCreator("profile-media-completeness@test.local");
    const res = await req("/me/profile-media", creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completeness.score).toBeGreaterThanOrEqual(0);
    expect(body.completeness.items.map((item: { key: string }) => item.key)).toContain("avatar");
    expect(body.published).toEqual({ avatarUrl: null, highlights: [], publishedAt: null });
  }, 120_000);
});
