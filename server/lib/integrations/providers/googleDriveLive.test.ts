// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createGoogleSigningKeyResolver, GoogleDriveLiveProvider } from "./googleDriveLive.js";
import { actor, connection, context, fileMetadata, fixtureHttp, googleScopes, grant, now, textPdf } from "./fixtures.js";
const token = { access_token: "fixture-new", refresh_token: "fixture-refresh", expires_in: 3600, token_type: "Bearer", scope: googleScopes, id_token: "fixture-id-token" };
function provider(replies: Parameters<typeof fixtureHttp>[0], selected = true) {
  const fixture = fixtureHttp(replies);
  const verifyIdentity = vi.fn(async () => ({ subject: "google-sub" }));
  return { ...fixture, verifyIdentity, adapter: new GoogleDriveLiveProvider({ http: fixture.http, clientId: "fixture-client", clientSecret: "fixture-secret", grantProject: "fixture-project", verifyIdentity, isSelected: async (ref, id) => selected && ref.workspaceId === actor.workspaceId && id === "selected" }) };
}
describe("Google Drive live protocol with offline transport", () => {
  it("exchanges code with PKCE, verifies nonce identity, retains actual scopes and fixture provenance", async () => {
    const { adapter, requests, verifyIdentity } = provider([token]);
    const actual = await adapter.authorize("fixture-code", actor, now, context);
    expect(actual).toMatchObject({ subject: "google-sub", accessToken: "fixture-new", refreshToken: "fixture-refresh", scopes: googleScopes.split(" "), expiresAt: "2026-10-31T01:00:00.000Z", issuedAt: now.toISOString(), grantProject: "fixture-project" });
    expect(adapter.mode).toBe("live_pilot"); expect(adapter.sampleOnly).toBe(true);
    expect(verifyIdentity).toHaveBeenCalledWith("fixture-id-token", "fixture-nonce");
    const form = new URLSearchParams(requests[0].body);
    expect(form.get("code_verifier")).toBe("x".repeat(43)); expect(form.get("redirect_uri")).toBe(context.redirectUri);
    expect(requests[0].url).toBe("https://oauth2.googleapis.com/token");
  });
  it("fails before exchange without identity verifier or callback nonce", async () => {
    const { http, requests } = fixtureHttp([token]);
    const missing = new GoogleDriveLiveProvider({ http, clientId: "x", clientSecret: "x", grantProject: "x" });
    await expect(missing.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_REQUIRED" });
    await expect(provider([token]).adapter.authorize("code", actor, now, { ...context, nonce: undefined })).rejects.toMatchObject({ code: "INVALID_OAUTH_CONTEXT" });
    expect(requests).toHaveLength(0);
  });
  it("rejects invalid identity, malformed grants and does not promote partial scopes", async () => {
    const invalid = provider([token]); invalid.verifyIdentity.mockRejectedValueOnce(new Error("private jwt"));
    await expect(invalid.adapter.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_FAILED", message: "IDENTITY_VERIFICATION_FAILED" });
    for (const broken of [{ ...token, expires_in: "3600" }, { ...token, token_type: "MAC" }, { ...token, id_token: "" }, { ...token, scope: undefined }]) {
      await expect(provider([broken]).adapter.authorize("code", actor, now, context)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    }
    const partial = await provider([{ ...token, scope: "openid" }]).adapter.authorize("code", actor, now, context);
    expect(partial.scopes).toEqual(["openid"]);
  });
  it("preserves refresh token when rotation is omitted, applies rotation and scope reduction", async () => {
    const next = { access_token: "rotated", token_type: "Bearer", expires_in: 1800 };
    const p = provider([next, { ...next, refresh_token: "new-refresh", scope: "openid" }]);
    expect(await p.adapter.refresh(grant, now)).toMatchObject({ refreshToken: "fixture-refresh", subject: "google-sub", scopes: googleScopes.split(" "), expiresAt: "2026-10-31T00:30:00.000Z" });
    expect(await p.adapter.refresh(grant, now)).toMatchObject({ refreshToken: "new-refresh", scopes: ["openid"] });
    expect(new URLSearchParams(p.requests[0].body).get("grant_type")).toBe("refresh_token");
  });
  it("propagates lifecycle failure and revokes refresh grant by POST form body", async () => {
    const bad = provider([new Response("secret", { status: 400 })]);
    await expect(bad.adapter.refresh(grant, now)).rejects.toMatchObject({ code: "PROVIDER_REQUEST_REJECTED" });
    const p = provider([new Response(null, { status: 200 })]);
    await p.adapter.revoke(grant);
    expect(p.requests[0]).toMatchObject({ url: "https://oauth2.googleapis.com/revoke", method: "POST" });
    expect(new URLSearchParams(p.requests[0].body).get("token")).toBe("fixture-refresh");
  });
  it("never lists Drive and denies unselected or other-workspace IDs before any HTTP", async () => {
    const p = provider([], false);
    expect(await p.adapter.files(connection, grant)).toEqual([]);
    await expect(p.adapter.file(connection, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    await expect(provider([]).adapter.file({ ...connection, workspaceId: "other" }, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    expect(p.requests).toHaveLength(0);
  });
  it.each(["text/plain", "application/vnd.google-apps.document"])("reads selected %s with metadata before/after and no inferred sharing rights", async mimeType => {
    const metadata = { ...fileMetadata, mimeType, size: mimeType === "text/plain" ? "12" : undefined };
    const p = provider([metadata, new Response("Hello world!"), metadata]);
    expect(await p.adapter.file(connection, grant, "selected")).toMatchObject({ content: "Hello world!", version: "7", sizeBytes: 12, rights: "unknown" });
    expect(p.requests).toHaveLength(3);
    expect(p.requests[1].url).toBe(mimeType === "text/plain" ? "https://www.googleapis.com/drive/v3/files/selected?alt=media" : "https://www.googleapis.com/drive/v3/files/selected/export?mimeType=text%2Fplain");
  });
  it("extracts a real PDF rather than returning fake parser text", async () => {
    const bytes = textPdf();
    const metadata = { ...fileMetadata, mimeType: "application/pdf", size: String(bytes.length) };
    const p = provider([metadata, new Response(Uint8Array.from(bytes)), metadata]);
    expect(await p.adapter.file(connection, grant, "selected")).toMatchObject({ content: "Synthetic PDF text", sizeBytes: bytes.length });
  });
  it.each([
    [{ version: "8" }, "SOURCE_CHANGED"], [{ trashed: true }, "SOURCE_UNAVAILABLE"], [{ capabilities: { canDownload: false } }, "SOURCE_UNAVAILABLE"], [{ mimeType: "application/pdf" }, "SOURCE_CHANGED"], [{ name: "Changed" }, "SOURCE_CHANGED"],
  ])("discards bytes if the post-download metadata changed: %j", async (change, code) => {
    await expect(provider([fileMetadata, new Response("Hello world!"), { ...fileMetadata, ...change as object }]).adapter.file(connection, grant, "selected")).rejects.toMatchObject({ code });
  });
  it.each([
    { driveId: "shared-drive" }, { mimeType: "application/vnd.google-apps.shortcut" }, { size: "5242881" },
    { capabilities: { canDownload: false } }, { trashed: true }, { version: undefined }, { id: "not-selected" },
  ])("denies unsupported/malformed metadata without downloading: %j", async change => {
    const p = provider([{ ...fileMetadata, ...change }]);
    await expect(p.adapter.file(connection, grant, "selected")).rejects.toThrow();
    expect(p.requests).toHaveLength(1);
  });
  it("checks selected authority again after download and sanitizes permission failures", async () => {
    const p = provider([fileMetadata, new Response("Hello world!"), fileMetadata]);
    const selected = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const adapter = new GoogleDriveLiveProvider({ http: p.http, clientId: "x", clientSecret: "x", grantProject: "fixture-project", isSelected: selected });
    await expect(adapter.file(connection, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    await expect(provider([new Response("private filename", { status: 403 })]).adapter.file(connection, grant, "selected")).rejects.toMatchObject({ message: "SOURCE_UNAVAILABLE" });
  });
  it("rejects cross-project grants before HTTP", async () => {
    const p = provider([]);
    await expect(p.adapter.file(connection, { ...grant, grantProject: "other-project" }, "selected")).rejects.toMatchObject({ code: "PROVIDER_GRANT_MISMATCH" });
    expect(p.requests).toHaveLength(0);
  });
  it("scopes pending consent to a separate adapter without changing the original selection authority", async () => {
    const p = provider([fileMetadata, new Response("Hello world!"), fileMetadata], false);
    let requestActive = true;
    const scoped = p.adapter.withSelection((ref, id) => requestActive && ref.creatorId === actor.creatorId && ref.workspaceId === actor.workspaceId && ref.id === connection.id && ref.generation === connection.generation && id === "selected");
    await expect(scoped.file({ ...connection, generation: 2 }, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    expect(await scoped.file(connection, grant, "selected")).toMatchObject({ content: "Hello world!" });
    await expect(p.adapter.file(connection, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    requestActive = false;
    await expect(scoped.file(connection, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    expect(p.requests).toHaveLength(3);
    expect(scoped.sampleOnly).toBe(true);
  });
  it("reads explicitly consented candidates before persistence and leaves durable file reads denied", async () => {
    const p = provider([fileMetadata, new Response("Hello world!"), fileMetadata], false);
    const callerConnection = { ...connection };
    const ids = ["selected"];
    const pending = p.adapter.selectedFiles(callerConnection, grant, ids);
    // A caller mutating its objects while reads are pending cannot widen/change this request.
    callerConnection.workspaceId = "changed-workspace"; callerConnection.generation = 2; ids.push("unconsented");
    expect(await pending).toMatchObject([{ externalId: "selected", rights: "unknown", content: "Hello world!" }]);
    await expect(p.adapter.file(connection, grant, "selected")).rejects.toMatchObject({ code: "FILE_NOT_SELECTED" });
    expect(p.requests).toHaveLength(3);
  });
  it.each([[], ["selected", "selected"], ["1", "2", "3", "4", "5", "6"], ["../unselected"]].map(ids => ({ ids })))("denies invalid candidate sets before any HTTP: %j", async ({ ids }) => {
    const p = provider([]);
    await expect(p.adapter.selectedFiles(connection, grant, ids)).rejects.toMatchObject({ code: "INVALID_SELECTION" });
    expect(p.requests).toHaveLength(0);
  });
  it("resolves only a bounded RSA signing key set from Google's fixed certs endpoint", async () => {
    const key = { kid: "fixture-kid", kty: "RSA", use: "sig", alg: "RS256", n: "A".repeat(342), e: "AQAB", x5u: "https://evil.test/keys" };
    const p = fixtureHttp([{ keys: [key] }, { keys: [key] }]);
    const resolve = createGoogleSigningKeyResolver(p.http);
    expect(await resolve("fixture-kid")).toMatchObject({ kty: "RSA", n: key.n, e: "AQAB", use: "sig", alg: "RS256" });
    expect(await resolve("missing")).toBeNull();
    expect(p.requests.every(r => r.url === "https://www.googleapis.com/oauth2/v3/certs")).toBe(true);
    const tooMany = createGoogleSigningKeyResolver(fixtureHttp([{ keys: Array.from({ length: 11 }, (_, i) => ({ ...key, kid: String(i) })) }]).http);
    await expect(tooMany("fixture-kid")).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    const duplicates = createGoogleSigningKeyResolver(fixtureHttp([{ keys: [key, key] }]).http);
    await expect(duplicates("fixture-kid")).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    const invalid = fixtureHttp([]);
    expect(await createGoogleSigningKeyResolver(invalid.http)("https://evil.test/kid")).toBeNull();
    expect(invalid.requests).toHaveLength(0);
  });
});
