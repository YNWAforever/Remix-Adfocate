// @vitest-environment node
import { describe, expect, it } from "vitest";
import { publishActorFromVerifiedSession } from "./publishSession.js";

const creatorId = "00000000-0000-4000-8000-000000000011";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000021";
const token = (payload: unknown) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.synthetic-verified-by-test-middleware`;
const identity = (patch: Record<string, unknown> = {}) => ({ workspaceId, creatorId, verifiedJwt: token({ sub: creatorId, session_id: sessionId, ...patch }) });

describe("publish actor derived after workspaceAuth", () => {
  it("keeps a stable non-secret binding across access refresh in the same verified session", () => {
    const first = publishActorFromVerifiedSession(identity({ iat: 100, exp: 200 }));
    const refreshed = publishActorFromVerifiedSession(identity({ iat: 150, exp: 250 }));
    expect(first).toEqual(refreshed);
    expect(first).toEqual({ creatorId, workspaceId, sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(first)).not.toContain(sessionId);
    expect(JSON.stringify(first)).not.toContain("synthetic-verified");
  });

  it("isolates sessions, workspaces and creators", () => {
    const initial = publishActorFromVerifiedSession(identity()).sessionHash;
    expect(publishActorFromVerifiedSession(identity({ session_id: "00000000-0000-4000-8000-000000000022" })).sessionHash).not.toBe(initial);
    expect(publishActorFromVerifiedSession({ ...identity(), workspaceId: "00000000-0000-4000-8000-000000000002" }).sessionHash).not.toBe(initial);
    const other = "00000000-0000-4000-8000-000000000012";
    expect(publishActorFromVerifiedSession({ workspaceId, creatorId: other, verifiedJwt: token({ sub: other, session_id: sessionId }) }).sessionHash).not.toBe(initial);
  });

  it.each([undefined, null, "", "not-a-session", {}, 123])("rejects missing or invalid session identity %j", (session_id) => {
    expect(() => publishActorFromVerifiedSession(identity({ session_id }))).toThrowError("PUBLISH_SESSION_REQUIRED");
  });

  it("rejects a JWT subject that differs from the middleware's verified creator", () => {
    expect(() => publishActorFromVerifiedSession(identity({ sub: "00000000-0000-4000-8000-000000000012" }))).toThrowError("PUBLISH_SESSION_REQUIRED");
  });

  it.each(["", "Bearer secret", "a.b.c.d", "a.!!!!.b", "a." + "x".repeat(16_384) + ".b"])("returns only a bounded code for malformed token input", (verifiedJwt) => {
    try { publishActorFromVerifiedSession({ workspaceId, creatorId, verifiedJwt }); expect.fail("must reject"); }
    catch (error) { expect((error as Error).message).toBe("PUBLISH_SESSION_REQUIRED"); }
  });

  it.each([[], null, "secret", 123])("rejects non-object verified payloads", (payload) => {
    expect(() => publishActorFromVerifiedSession({ workspaceId, creatorId, verifiedJwt: token(payload) })).toThrowError("PUBLISH_SESSION_REQUIRED");
  });

  it("rejects missing middleware identity even if JWT contains valid-looking IDs", () => {
    expect(() => publishActorFromVerifiedSession({ ...identity(), workspaceId: "" })).toThrowError("PUBLISH_SESSION_REQUIRED");
    expect(() => publishActorFromVerifiedSession({ ...identity(), creatorId: "" })).toThrowError("PUBLISH_SESSION_REQUIRED");
  });
});
