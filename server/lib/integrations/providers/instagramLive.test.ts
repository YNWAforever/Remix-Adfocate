// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InstagramLiveProvider } from "./instagramLive.js";
import { actor, context, fixtureHttp, now } from "./fixtures.js";

const scopes = ["instagram_business_basic", "instagram_business_manage_insights"];
const igConnection = { ...actor, id: "ig-connection", provider: "instagram" as const, generation: 1 };
const igGrant = { subject: "123", label: "@fixture", scopes, accessToken: "fixture-long", refreshToken: "", expiresAt: "2026-11-29T00:00:00.000Z", issuedAt: "2026-10-01T00:00:00.000Z", grantProject: "fixture-meta" };
const account = { user_id: "123", username: "fixture", account_type: "BUSINESS" };
const media = { id: "456", caption: "Synthetic media", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-10-30T17:00:00+0000", permalink: "https://www.instagram.com/p/fixture/" };
const insights = { data: [{ name: "reach", period: "lifetime", values: [{ value: 0 }] }, { name: "views", period: "lifetime", total_value: { value: 12 } }, { name: "saved", period: "lifetime", values: [{ value: 3 }] }] };
function provider(replies: Parameters<typeof fixtureHttp>[0]) {
  const fixture = fixtureHttp(replies);
  return { ...fixture, adapter: new InstagramLiveProvider({ http: fixture.http, clientId: "fixture-client", clientSecret: "fixture-secret", apiVersion: "v26.0", grantProject: "fixture-meta" }) };
}
describe("Instagram Login offline live-protocol adapter", () => {
  it("pins v26.0 and fails closed on unspecified/different versions", () => {
    const { http } = fixtureHttp([]);
    for (const apiVersion of [null, "v25.0", "v26.0/../../me"]) expect(() => new InstagramLiveProvider({ http, clientId: "x", clientSecret: "x", apiVersion: apiVersion as string })).toThrow("INSTAGRAM_VERSION_UNVERIFIED");
    expect(provider([]).adapter.sampleOnly).toBe(true);
  });
  it("exchanges code for short then long-lived token, reads identity/scopes and invents no refresh token", async () => {
    const p = provider([{ data: [{ access_token: "fixture-short", user_id: "123", permissions: scopes.join(",") }] }, { access_token: "fixture-long", token_type: "bearer", expires_in: 5184000 }, account]);
    expect(await p.adapter.authorize("fixture-code", actor, now, context)).toMatchObject({ subject: "123", scopes, refreshToken: "", expiresAt: "2026-12-30T00:00:00.000Z", issuedAt: now.toISOString(), grantProject: "fixture-meta" });
    expect(p.requests[0]).toMatchObject({ url: "https://api.instagram.com/oauth/access_token", method: "POST" });
    expect(new URLSearchParams(p.requests[0].body).get("grant_type")).toBe("authorization_code");
    expect(new URL(p.requests[1].url).searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(new URL(p.requests[2].url).pathname).toBe("/v26.0/me");
  });
  it("retains partial permissions and rejects account substitution or personal accounts", async () => {
    const prefix = [{ access_token: "short", user_id: "123", permissions: scopes[0] }, { access_token: "long", expires_in: 5184000 }];
    const partial = provider([...prefix, account]);
    expect((await partial.adapter.authorize("code", actor, now, context)).scopes).toEqual([scopes[0]]);
    await expect(provider([...prefix, { ...account, user_id: "999" }]).adapter.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_MISMATCH" });
    await expect(provider([...prefix, { ...account, account_type: "PERSONAL" }]).adapter.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "INSTAGRAM_ACCOUNT_UNSUPPORTED" });
  });
  it("accepts documented wrapped profile responses and distinguishes app-scoped id from professional user_id", async () => {
    const p = provider([{ data: [{ access_token: "short", user_id: "987", permissions: scopes.join(",") }] }, { access_token: "long", expires_in: 5184000 }, { data: [{ id: "987", user_id: "123", username: "fixture", account_type: "Media_Creator" }] }]);
    expect(await p.adapter.authorize("code", actor, now, context)).toMatchObject({ subject: "123", scopes });
    expect(p.requests).toHaveLength(3);
    await expect(provider([{ access_token: "short", user_id: "123" }]).adapter.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
  });
  it("refreshes the long-lived token itself only after 24h and before expiry", async () => {
    const p = provider([{ access_token: "new-long", expires_in: 5184000 }]);
    expect(await p.adapter.refresh(igGrant, now)).toMatchObject({ accessToken: "new-long", refreshToken: "", issuedAt: now.toISOString() });
    expect(new URL(p.requests[0].url).searchParams.get("grant_type")).toBe("ig_refresh_token");
    for (const patch of [{ issuedAt: now.toISOString() }, { issuedAt: undefined }, { expiresAt: now.toISOString() }]) {
      await expect(provider([]).adapter.refresh({ ...igGrant, ...patch }, now)).rejects.toThrow();
    }
    await expect(provider([]).adapter.refresh({ ...igGrant, scopes: [] }, now)).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPES" });
  });
  it("revokes permissions with DELETE and validates success", async () => {
    const p = provider([{ success: true }]); await p.adapter.revoke(igGrant);
    expect(p.requests[0]).toMatchObject({ url: "https://graph.instagram.com/v26.0/123/permissions", method: "DELETE" });
    await expect(provider([{ success: false }]).adapter.revoke(igGrant)).rejects.toMatchObject({ code: "PROVIDER_REVOKE_FAILED" });
  });
  it("normalizes real zero, missing and saved->saves, labels lifetime separately from selection and no HK claim", async () => {
    const p = provider([{ data: [media] }, insights]);
    const [snapshot] = await p.adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(snapshot.metrics).toMatchObject({ reach: { value: 0, availability: "available" }, views: { value: 12 }, saves: { value: 3 }, likes: { value: null, availability: "missing" } });
    expect(snapshot.period).toBeNull();
    expect(snapshot.coverage).toEqual({ region: null, language: null, partial: false });
    expect(snapshot.evidence).toMatchObject({ apiVersion: "v26.0", measurementPeriod: "lifetime", selectionPeriod: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-31T00:00:00.000Z" }, permalink: media.permalink });
    expect(snapshot.excerpt).toContain("lifetime");
    expect(new URL(p.requests[1].url).searchParams.get("metric")).toBe("reach,views,likes,saved");
    expect(p.requests.every(r => !r.url.includes("media_url") && !r.url.includes("total_likes"))).toBe(true);
  });
  it("filters using instants across UTC/HKT boundaries and ignores Stories, carousel children and future media", async () => {
    const items = [media, { ...media, id: "457", timestamp: "2026-10-01T07:59:59+0800" }, { ...media, id: "458", timestamp: "2026-10-01T08:00:00+0800", media_type: "CAROUSEL_ALBUM" }, { ...media, id: "459", media_product_type: "STORY" }, { ...media, id: "460", timestamp: "2026-11-01T00:00:00Z" }];
    const p = provider([{ data: items }, insights, { data: [] }]);
    const result = await p.adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(result.map(s => s.resourceId)).toEqual(["456", "458"]);
    expect(result[1].metrics.reach).toMatchObject({ value: null, availability: "missing" });
  });
  it("validates paging host, rebuilds cursor requests and bounds repeated cursors", async () => {
    const hostile = provider([{ data: [media], paging: { next: "https://evil.test/?access_token=private", cursors: { after: "a" } } }]);
    await expect(hostile.adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_INVALID_PAGINATION" });
    expect(hostile.requests).toHaveLength(1);
    const page = { data: [media], paging: { next: "https://graph.instagram.com/v26.0/123/media?after=a&access_token=untrusted", cursors: { after: "a" } } };
    const p = provider([page, insights, page]);
    const results = await p.adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(results).toHaveLength(1); expect(results[0].coverage.partial).toBe(true);
    expect(p.requests[2].url).not.toContain("untrusted");
  });
  it("returns explicitly partial earlier results for later rate limit, but never hides auth or cancellation", async () => {
    const page = { data: [media], paging: { next: "https://graph.instagram.com/v26.0/123/media?after=a", cursors: { after: "a" } } };
    const p = provider([page, insights, new Response("rate limit", { status: 429 })]);
    expect((await p.adapter.read(igConnection, igGrant, now, new AbortController().signal))[0].coverage.partial).toBe(true);
    await expect(provider([{ data: [media] }, new Response("denied", { status: 403 })]).adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    const controller = new AbortController(); controller.abort();
    await expect(provider([]).adapter.read(igConnection, igGrant, now, controller.signal)).rejects.toMatchObject({ code: "PROVIDER_CANCELLED" });
  });
  it("does not invent sums for multiple values, unsupported periods or malformed data", async () => {
    for (const response of [{ data: [{ name: "reach", period: "lifetime", values: [{ value: 3 }, { value: 4 }] }] }, { data: [{ name: "reach", period: "day", values: [{ value: 3 }] }] }, { data: "malformed" }]) {
      await expect(provider([{ data: [media] }, response]).adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    }
  });
  it("accepts agreeing values and total_value but rejects contradictory counts", async () => {
    const valid = { data: [{ name: "reach", period: "lifetime", values: [{ value: 0 }], total_value: { value: 0 } }] };
    const results = await provider([{ data: [media] }, valid]).adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(results[0].metrics.reach).toMatchObject({ value: 0, availability: "available" });
    const invalid = { data: [{ name: "reach", period: "lifetime", values: [{ value: 1 }], total_value: { value: 2 } }] };
    await expect(provider([{ data: [media] }, invalid]).adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
  });
  it("rejects partial-scope reads before HTTP, and marks rejected metric combinations unsupported", async () => {
    await expect(provider([]).adapter.read(igConnection, { ...igGrant, scopes: [scopes[0]] }, now, new AbortController().signal)).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPES" });
    const result = await provider([{ data: [media] }, new Response("not supported", { status: 400 })]).adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(result[0].metrics.reach).toMatchObject({ value: null, availability: "unsupported" });
    expect(result[0].coverage.partial).toBe(true);
  });
  it("caps media at 50 and pages at five, never reporting truncated empty scans as success", async () => {
    const p = provider([{ data: Array.from({ length: 51 }, (_, index) => ({ ...media, id: String(1000 + index) })) }, ...Array.from({ length: 50 }, () => insights)]);
    const results = await p.adapter.read(igConnection, igGrant, now, new AbortController().signal);
    expect(results).toHaveLength(50); expect(results.every(row => row.coverage.partial)).toBe(true); expect(p.requests).toHaveLength(51);
    const empty = provider(Array.from({ length: 5 }, (_, index) => ({ data: [], paging: { next: `https://graph.instagram.com/v26.0/123/media?after=${index}`, cursors: { after: String(index) } } })));
    await expect(empty.adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_INCOMPLETE" });
    expect(empty.requests).toHaveLength(5);
  });
  it("does not send requests for expired grants or malformed identities", async () => {
    await expect(provider([]).adapter.read(igConnection, { ...igGrant, expiresAt: now.toISOString() }, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_AUTH_REQUIRED" });
    await expect(provider([{ data: [media] }, { data: [{ name: "reach", period: "lifetime", values: [{ value: 1 }] }, { name: "reach", period: "lifetime", values: [{ value: 2 }] }] }]).adapter.read(igConnection, igGrant, now, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
  });
});
