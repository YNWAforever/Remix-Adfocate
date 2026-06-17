import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator, serviceForTests } from "./helpers";

vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(
    async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => ({
      platform,
      handle,
      profileUrl:
        platform === "instagram"
          ? `https://www.instagram.com/${handle}/`
          : `https://www.threads.net/@${handle}`,
      followerCount: 12000,
      followingCount: 321,
      postCount: 42,
      bio: "Public leak sentinel bio",
      externalAvatarUrl: "https://cdn.example.com/private-social-avatar.jpg",
      engagementRate: 4.5,
      avgLikes: 500,
      avgComments: 40,
      postingFrequency: 2,
      freshnessScore: 100,
      contentThemes: ["beauty"],
      recentPostsSummary: [
        {
          id: "secret-post",
          postedAt: "2026-06-16T00:00:00.000Z",
          likeCount: 500,
          commentCount: 40,
          text: "secret post text",
        },
      ],
      summary: { mocked: true },
    }),
  ),
}));

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;
const PUBLIC_PASSPORT_EMAILS = [
  "public-passport@test.local",
  "public-avatar@test.local",
  "public-self-report@test.local",
];

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

async function cleanupPublicPassportCreators() {
  const svc = serviceForTests();
  const { data } = await svc.from("creators").select("id").in("display_name", PUBLIC_PASSPORT_EMAILS);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return;

  await svc.from("creator_public_passports").delete().in("creator_id", ids);
  await svc.from("creator_social_accounts").delete().in("creator_id", ids);
  await svc.from("point_balances").delete().in("creator_id", ids);
  await svc.from("earnings_balances").delete().in("creator_id", ids);
  await svc.from("creators").delete().in("id", ids);

  for (const id of ids) {
    await svc.auth.admin.deleteUser(id);
  }
}

suite("public passport privacy", () => {
  beforeAll(cleanupPublicPassportCreators, 120_000);
  afterAll(cleanupPublicPassportCreators, 120_000);

  it("creates, resolves, and revokes a public passport without raw social leaks", async () => {
    const c = await makeCreator("public-passport@test.local");
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", handle: "@secretcreator" }),
      })
    ).json();
    await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });

    const share = await req("/me/passport/share", c.jwt, { method: "POST" });
    expect(share.status).toBe(200);
    const shareBody = await share.json();
    expect(shareBody.publicUrl).toMatch(/^\/passport\//);

    const token = shareBody.token as string;
    const publicRes = await app.request(`/api/public/passports/${token}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json();
    expect(body.creator.displayName).toBe("public-passport@test.local");
    expect(body.badges).not.toContain("social_linked");
    expect(body.socialTrustBadges).toContain("social_scan_connected");
    expect(JSON.stringify(body)).not.toContain("secretcreator");
    expect(JSON.stringify(body)).not.toContain("12000");
    expect(JSON.stringify(body)).not.toContain("4.5");
    expect(JSON.stringify(body)).not.toContain("secret-post");
    expect(JSON.stringify(body)).not.toContain("private-social-avatar");

    const revoke = await req("/me/passport/share", c.jwt, { method: "DELETE" });
    expect(revoke.status).toBe(200);
    const afterRevoke = await app.request(`/api/public/passports/${token}`);
    expect(afterRevoke.status).toBe(404);
  }, 120_000);

  it("uses a scanned avatar publicly only after explicit avatar selection", async () => {
    const c = await makeCreator("public-avatar@test.local");
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", handle: "avatarcreator" }),
      })
    ).json();
    await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });

    const firstShare = await (await req("/me/passport/share", c.jwt, { method: "POST" })).json();
    const before = await (await app.request(`/api/public/passports/${firstShare.token}`)).json();
    expect(before.creator.avatarUrl).toBeNull();

    const avatar = await req("/me/avatar/from-social", c.jwt, {
      method: "POST",
      body: JSON.stringify({ accountId: created.id }),
    });
    expect(avatar.status).toBe(200);

    const after = await (await app.request(`/api/public/passports/${firstShare.token}`)).json();
    expect(after.creator.avatarUrl).toBe("https://cdn.example.com/private-social-avatar.jpg");
  }, 120_000);

  it("does not derive public social badges or influence from self-reported handles alone", async () => {
    const c = await makeCreator("public-self-report@test.local");
    const profile = await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({
        social_handles: [{ platform: "Instagram", handle: "@selfreportedsecret", followers: 999999 }],
      }),
    });
    expect(profile.status).toBe(200);

    const share = await req("/me/passport/share", c.jwt, { method: "POST" });
    expect(share.status).toBe(200);
    const { token } = (await share.json()) as { token: string };

    const publicRes = await app.request(`/api/public/passports/${token}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json();
    expect(body.scores.influence).toBeNull();
    expect(body.badges).not.toContain("social_linked");
    expect(body.socialTrustBadges).not.toContain("social_scan_connected");
    expect(JSON.stringify(body)).not.toContain("selfreportedsecret");
    expect(JSON.stringify(body)).not.toContain("999999");
  }, 120_000);
});
