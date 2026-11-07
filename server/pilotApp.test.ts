// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPilotApp } from "./pilotApp.js";
import { createPilotRuntime, observePilotTarget, type PilotApprovalRecord } from "./lib/integrations/pilotRuntime.js";
import { adminBrandInviteRoutes } from "./routes/adminBrandInvites.js";
import type { AdminEnv } from "./lib/staffAuth.js";

const mail = vi.hoisted(() => ({ insert: vi.fn(async () => ({ error: null })), send: vi.fn(async () => ({ error: null })) }));
vi.mock("./lib/supabase.js", () => ({ serviceClient: () => ({ from: () => ({ insert: mail.insert }), auth: { signInWithOtp: mail.send } }) }));

const now = new Date("2026-10-31T10:00:00.000Z");
const record: PilotApprovalRecord = {
  stage: "D1", ownerApprovalReference: "owner:d1", issuedAt: "2026-10-31T09:00:00.000Z", expiresAt: "2026-10-31T11:00:00.000Z",
  sourceSha: "a".repeat(40), schemaDigest: "b".repeat(64), artifactDigest: "c".repeat(64),
  deploymentId: "dpl_isolated", hostingProjectId: "prj_isolated", projectRef: "isolatedpilotproject", origin: "https://pilot.invalid",
  googleProjectId: "google-isolated", googleClientId: "isolated.apps.googleusercontent.com", metaAppId: "100", instagramAppId: "200",
  actors: [{ creatorId: "c1", workspaceId: "w1", subject: "s1" }], fixtureIds: ["fixture1"], providerEnablement: { google_drive: false, instagram: false },
};
async function setup() {
  let clock = now;
  const { actors, fixtureIds } = record;
  const target = Object.fromEntries(["sourceSha", "schemaDigest", "artifactDigest", "deploymentId", "hostingProjectId", "projectRef", "origin", "googleProjectId", "googleClientId", "metaAppId", "instagramAppId"].map(key => [key, record[key as keyof PilotApprovalRecord]]));
  const observed = await observePilotTarget(record, {
    readApproval: async () => record,
    readTarget: async () => ({ provenance: { source: "control-plane", ownerApprovalReference: record.ownerApprovalReference, observedAt: now.toISOString() }, target: { ...target, hostingProjectName: "kocmax-integrations-pilot" }, actors, fixtureIds }),
  }, () => now);
  const runtime = createPilotRuntime(record, observed, () => clock);
  const authenticate = vi.fn(async () => ({ creatorId: "c1", workspaceId: "w1", subject: "s1" }));
  const delegate = new Hono().all("*", c => c.json({ saved: true }));
  const dispatch = vi.fn((request: Request) => delegate.fetch(request));
  const deps = { origin: record.origin, getRuntime: () => runtime, authenticate, dispatch };
  return { app: createPilotApp(deps), authenticate, dispatch, expire: () => { clock = new Date(record.expiresAt); }, deps };
}
const request = (path: string, init?: RequestInit) => new Request(`https://pilot.invalid/api${path}`, init);

describe("isolated D1 API boundary", () => {
  it("answers a minimal status but denies application calls before constructing any client", async () => {
    const authenticate = vi.fn(), dispatch = vi.fn(), app = createPilotApp({ authenticate, dispatch });
    expect(await (await app.fetch(request("/health"))).json()).toMatchObject({ stage: "D1", externalAccess: false });
    expect((await app.fetch(request("/missions"))).status).toBe(503);
    expect(authenticate).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
  it("preserves authorized fixture application requests and rejects anonymous or foreign actors", async () => {
    const s = await setup();
    expect((await s.app.fetch(request("/missions"))).status).toBe(200);
    s.authenticate.mockResolvedValueOnce({ creatorId: "c2", workspaceId: "w1", subject: "s1" });
    expect((await s.app.fetch(request("/missions"))).status).toBe(403);
    s.authenticate.mockResolvedValueOnce(null as never);
    expect((await s.app.fetch(request("/missions"))).status).toBe(401);
    expect(s.dispatch).toHaveBeenCalledTimes(1);
  });
  it("rejects the wrong host, cross-site writes, expired or removed admission before delegation", async () => {
    const s = await setup();
    expect((await s.app.fetch(new Request("https://other.invalid/api/missions"))).status).toBe(403);
    expect((await s.app.fetch(request("/me/integrations/c/revoke", { method: "POST", headers: { Origin: "https://evil.invalid" } }))).status).toBe(403);
    expect(s.authenticate).not.toHaveBeenCalled();
    s.expire(); expect((await s.app.fetch(request("/missions"))).status).toBe(503);
    expect(s.authenticate).not.toHaveBeenCalled(); expect(s.dispatch).not.toHaveBeenCalled();
  });
  it("rechecks admission after async authentication and hides authentication errors", async () => {
    const s = await setup();
    s.authenticate.mockImplementationOnce(async () => { s.expire(); return { creatorId: "c1", workspaceId: "w1", subject: "s1" }; });
    expect((await s.app.fetch(request("/missions"))).status).toBe(503); expect(s.dispatch).not.toHaveBeenCalled();
    const other = await setup(); other.authenticate.mockRejectedValueOnce(new Error("private-user-details"));
    const result = await other.app.fetch(request("/missions")); expect(result.status).toBe(503); expect(await result.text()).not.toContain("private-user-details");
  });
  it("cannot substitute a host origin different from the approved runtime", async () => {
    const s = await setup();
    const app = createPilotApp({ ...s.deps, origin: "https://other.invalid" });
    expect((await app.fetch(new Request("https://other.invalid/api/missions"))).status).toBe(403);
    expect(s.authenticate).not.toHaveBeenCalled(); expect(s.dispatch).not.toHaveBeenCalled();
  });
  it("never invokes provider, cron, model, outbound messaging or redemption endpoints", async () => {
    const s = await setup();
    for (const path of ["/cron/daily", "/cron/social-refresh", "/social/scan", "/assistant/chat", "/copilot", "/redemption", "/me/integration-oauth/google_drive/start", "/integration-oauth/instagram/callback?code=canary&state=marker", "/integration-notices/instagram/delete"]) {
      const result = await s.app.fetch(request(path, { method: "POST" }));
      expect(result.status).toBe(503); expect(await result.text()).not.toMatch(/canary|marker/);
    }
    expect(s.dispatch).not.toHaveBeenCalled(); expect(s.authenticate).not.toHaveBeenCalled();
  });
  it.each([
    ["POST", "/admin/brand-invites"], ["GET", "/match"],
    ["POST", "/brand/login"], ["POST", "/future-outbound-operation"],
    ["POST", "/missions"], ["GET", "/missions/unreviewed-operation"],
    ["POST", "/me/integrations/c/revoke/extra"], ["GET", "/me/integrations/c/revoke"],
    ["POST", "/me/integrations/c%2frevoke/purge"],
  ])("rejects unreviewed %s %s before authentication or dispatch", async (method, path) => {
    const s = await setup();
    const result = await s.app.fetch(request(path, { method }));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: "D1_EXTERNAL_ACCESS_DISABLED" });
    expect(s.authenticate).not.toHaveBeenCalled(); expect(s.dispatch).not.toHaveBeenCalled();
  });
  it("permits only the reviewed read and local management operations after admission", async () => {
    const s = await setup();
    for (const path of ["/missions", "/missions/?category=food", "/me/integrations", "/me/integrations/"]) {
      expect((await s.app.fetch(request(path))).status).toBe(200);
    }
    expect(s.dispatch).toHaveBeenCalledTimes(4);
  });
  it("cannot reach the existing brand-invite email sender through an admitted pilot", async () => {
    mail.insert.mockClear(); mail.send.mockClear();
    const s = await setup(), delegate = new Hono<AdminEnv>();
    delegate.use("*", async (c, next) => { c.set("staff", { userId: "staff1" } as AdminEnv["Variables"]["staff"]); await next(); });
    delegate.route("/api/admin", adminBrandInviteRoutes);
    const app = createPilotApp({ ...s.deps, dispatch: request => delegate.fetch(request) });
    const result = await app.fetch(request("/admin/brand-invites", { method: "POST", headers: { "Content-Type": "application/json", Origin: record.origin }, body: JSON.stringify({ email: "fixture@example.invalid", workspace_id: "w1" }) }));
    expect(result.status).toBe(503);
    expect(mail.insert).not.toHaveBeenCalled(); expect(mail.send).not.toHaveBeenCalled();
  });
  it("keeps local revoke and purge reachable through an admitted fixture application without provider success claims", async () => {
    const s = await setup();
    expect((await s.app.fetch(request("/me/integrations/c/revoke", { method: "POST" }))).status).toBe(200);
    expect((await s.app.fetch(request("/me/integrations/c/purge", { method: "POST" }))).status).toBe(200);
    expect((await s.app.fetch(request("/me/integrations/c/sync", { method: "POST" }))).status).toBe(503);
    expect(s.dispatch).toHaveBeenCalledTimes(2);
  });
  it("returns only public disabled readiness, never approval IDs or allowlist identities", async () => {
    const s = await setup(); const result = await s.app.fetch(request("/integration-pilot/readiness"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ stage: "D1", externalAccess: false, providerStates: { instagram: "disabled", google_drive: "disabled" } });
    expect(result.headers.get("Cache-Control")).toContain("no-store"); expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(s.authenticate).not.toHaveBeenCalled(); expect(s.dispatch).not.toHaveBeenCalled();
  });
});
