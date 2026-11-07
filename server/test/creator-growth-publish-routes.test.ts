// @vitest-environment node
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app.js";
import type { PublishPreview, PublishStatus } from "../lib/creatorGrowth/publishService.js";
import { createCreatorGrowthPublishRoutes, type CreatorGrowthPublishDependencies } from "../routes/creatorGrowthPublish.js";

const ws = "00000000-0000-4000-8000-000000000001";
const creator = "00000000-0000-4000-8000-000000000011";
const draft = "00000000-0000-4000-8000-000000000021";
const asset = "00000000-0000-4000-8000-000000000031";
const approval = "00000000-0000-4000-8000-000000000041";
const intent = "00000000-0000-4000-8000-000000000051";
const requestId = "00000000-0000-4000-8000-000000000061";
const jwt = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: creator, session_id: "00000000-0000-4000-8000-000000000071" })).toString("base64url")}.test-signature`;
const preview: PublishPreview = {
  draftId: draft, draftRevision: 1, assetId: asset, imageSha256: "a".repeat(64),
  caption: "這是合成示例。", accountSubject: "17840000000000001", accountLabel: "@example.creator",
  disclosure: { sponsored: false, captionText: "", platformLabelRequired: false, brandTagRequired: false },
  mission: null, missionBasisVersionId: null, eligible: true,
  approvalId: approval, nonce: "b".repeat(43), fingerprint: "c".repeat(64), expiresAt: "2026-11-04T00:05:00.000Z", sampleOnly: true,
};
const status: PublishStatus = {
  id: intent, state: "creator_approved", version: 1, accountSubject: preview.accountSubject,
  providerContainerId: null, providerMediaId: null, permalink: null,
  stopped: false, updatedAt: "2026-11-04T00:00:00.000Z", sampleOnly: true,
};
const confirmation = { draftId: draft, approvalId: approval, nonce: preview.nonce, fingerprint: preview.fingerprint };

function fixture(withIdentity = true, enabled = true) {
  const service = {
    prepare: vi.fn(async () => preview), approve: vi.fn(async () => status),
    getOwned: vi.fn(async () => status), reconcile: vi.fn(async () => ({ ...status, state: "outcome_unknown" as const })),
  };
  const app = new Hono<Env>();
  if (withIdentity) app.use("*", async (context, next) => {
    // Test substitute for workspaceAuth; forged request headers do not set these values.
    context.set("userId", creator); context.set("workspaceId", ws); context.set("jwt", jwt); await next();
  });
  app.route("/publish", createCreatorGrowthPublishRoutes(enabled ? { service } : undefined));
  const post = (path: string, body: unknown, extraHeaders: Record<string, string> = {}) => app.request(`/publish${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body),
  });
  return { app, service, post };
}

afterEach(() => vi.unstubAllGlobals());

describe("creator publication routes stay guarded and offline", () => {
  it("does not trust bearer or owner headers without verified middleware context", async () => {
    const f = fixture(false);
    expect((await f.post("/preview", { draftId: draft }, { Authorization: `Bearer ${jwt}`, "X-Owner": creator })).status).toBe(401);
    expect(f.service.prepare).not.toHaveBeenCalled();
  });

  it("is disabled without injected service even if browser query flags ask to enable it", async () => {
    const f = fixture(true, false);
    const result = await f.post("/preview?enabled=true&CREATOR_PUBLISH_ENABLED=true", { draftId: draft });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: "PUBLISH_DISABLED", error: "發佈功能尚未啟用。" });
  });

  it("derives the preview actor from verified context and returns only the safe preview", async () => {
    const f = fixture();
    const response = await f.post("/preview", { draftId: draft });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(f.service.prepare).toHaveBeenCalledWith({ workspaceId: ws, creatorId: creator, sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/) }, draft);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.each([
    { owner: creator }, { workspaceId: ws }, { creatorId: creator }, { grant: {} },
    { report: {} }, { toolCallId: "model-call" }, { caption: "replace approved caption" },
  ])("rejects client-supplied authority or tool fields %j", async (extra) => {
    const f = fixture();
    expect((await f.post("/preview", { draftId: draft, ...extra })).status).toBe(400);
    expect((await f.post("/approve", { ...confirmation, ...extra }, { "Idempotency-Key": requestId, "X-Creator-Confirmation": "exact-preview-v1" })).status).toBe(400);
    expect(f.service.prepare).not.toHaveBeenCalled();
    expect(f.service.approve).not.toHaveBeenCalled();
  });

  it("requires exact preview confirmation and the caller's idempotency key", async () => {
    const f = fixture();
    expect((await f.post("/approve", confirmation, { "Idempotency-Key": requestId })).status).toBe(400);
    expect((await f.post("/approve", confirmation, { "X-Creator-Confirmation": "exact-preview-v1" })).status).toBe(400);
    const result = await f.post("/approve", confirmation, { "Idempotency-Key": requestId, "X-Creator-Confirmation": "exact-preview-v1" });
    expect(result.status).toBe(200);
    expect(f.service.approve).toHaveBeenCalledTimes(1);
    expect(f.service.approve).toHaveBeenCalledWith(expect.objectContaining({ creatorId: creator, workspaceId: ws }), { ...confirmation, requestId });
  });

  it("returns owner-scoped status and reconciliation without an execute endpoint", async () => {
    const f = fixture();
    expect((await f.app.request(`/publish/${intent}`)).status).toBe(200);
    const result = await f.post(`/${intent}/reconcile`, {});
    expect((await result.json()).state).toBe("outcome_unknown");
    expect(f.service.reconcile).toHaveBeenCalledWith({ workspaceId: ws, creatorId: creator, sessionHash: expect.any(String) }, intent);
    expect((await f.post(`/${intent}/execute`, {})).status).toBe(404);
    expect((await f.post("/execute", { intentId: intent })).status).toBe(404);
  });

  it.each(["PUBLISH_DENIED", "PUBLISH_STALE", "PUBLISH_APPROVAL_INVALID", "PUBLISH_CONFLICT", "PUBLISH_CAS", "PUBLISH_DISABLED"])("exposes only a safe known error code (%s)", async (code) => {
    const f = fixture();
    f.service.prepare.mockRejectedValueOnce(Object.assign(new Error("private storage path and token=secret"), { code }));
    const result = await f.post("/preview", { draftId: draft });
    expect(result.status).toBe(code === "PUBLISH_DENIED" ? 403 : code === "PUBLISH_DISABLED" ? 503 : 409);
    const body = await result.json();
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toMatch(/private storage|secret|token=/);
  });

  it("does not echo unexpected errors or unsafe service DTOs", async () => {
    const f = fixture();
    f.service.prepare.mockRejectedValueOnce(new Error("SECRET-CREDENTIAL"));
    expect(await (await f.post("/preview", { draftId: draft })).json()).toEqual({ code: "PUBLISH_UNAVAILABLE", error: "暫時未能處理，請稍後查看狀態。" });
    f.service.prepare.mockResolvedValueOnce({ ...preview, caption: { bytes: "data:image/png;base64,AAA" } } as unknown as PublishPreview);
    expect((await f.post("/preview", { draftId: draft })).status).toBe(503);
    f.service.getOwned.mockResolvedValueOnce({ ...status, sampleOnly: false, permalink: "https://example.invalid/private?token=x" } as unknown as PublishStatus);
    expect((await f.app.request(`/publish/${intent}`)).status).toBe(503);
  });

  it("drops extra service fields instead of exposing owner, credentials or internal receipt plans", async () => {
    const f = fixture();
    f.service.prepare.mockResolvedValueOnce({ ...preview, owner: creator, token: "SECRET" } as PublishPreview);
    expect(await (await f.post("/preview", { draftId: draft })).json()).toEqual(preview);
    f.service.getOwned.mockResolvedValueOnce({ ...status, sessionHash: "SECRET", rawReceipt: { storage: "private" } } as PublishStatus);
    expect(await (await f.app.request(`/publish/${intent}`)).json()).toEqual(status);
  });

  it.each(["array", "object"])("rejects coercible %s status enums without serializing nested data", async (kind) => {
    const f = fixture();
    const value = kind === "array" ? ["outcome_unknown"] : { toString: () => "outcome_unknown", secret: "PRIVATE-INTERNAL" };
    f.service.getOwned.mockResolvedValueOnce({ ...status, state: value } as unknown as PublishStatus);
    const response = await f.app.request(`/publish/${intent}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PUBLISH_UNAVAILABLE", error: "暫時未能處理，請稍後查看狀態。" });
  });

  it.each(["array", "object"])("rejects coercible %s mission kinds from an otherwise valid preview", async (kind) => {
    const f = fixture();
    const mission = { kind: "active" as const, submissionId: intent, workItemId: requestId, approvedVersionId: asset, instructionRevision: 1, state: "approved_to_publish" };
    const valid = { ...preview, mission, missionBasisVersionId: asset };
    f.service.prepare.mockResolvedValueOnce(valid);
    expect(await (await f.post("/preview", { draftId: draft })).json()).toEqual(valid);
    const value = kind === "array" ? ["active"] : { toString: () => "active", secret: "PRIVATE-INTERNAL" };
    f.service.prepare.mockResolvedValueOnce({ ...valid, mission: { ...mission, kind: value } } as unknown as PublishPreview);
    const response = await f.post("/preview", { draftId: draft });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "PUBLISH_UNAVAILABLE", error: "暫時未能處理，請稍後查看狀態。" });
  });

  it("preserves blocked eligibility and manual proof without creating an approval", async () => {
    const f = fixture();
    const blocked = { ...preview, eligible: false, reason: "PUBLISH_PROTOCOL_UNVERIFIED", fallback: "manual_proof" as const, approvalId: null, nonce: null, fingerprint: null, expiresAt: null };
    f.service.prepare.mockResolvedValueOnce(blocked);
    expect(await (await f.post("/preview", { draftId: draft })).json()).toEqual(blocked);
    expect(f.service.approve).not.toHaveBeenCalled();
  });

  it("bounds actual streamed JSON independently of Content-Length", async () => {
    const f = fixture();
    const payload = new TextEncoder().encode(JSON.stringify({ draftId: draft, extra: "x".repeat(20_000) }));
    const response = await f.app.request("/publish/preview", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "2" }, body: payload });
    expect(response.status).toBe(413);
    expect(f.service.prepare).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { draftId: "not-an-id" }])("rejects malformed preview commands %j", async (value) => {
    const f = fixture();
    expect((await f.post("/preview", value)).status).toBe(400);
    expect(f.service.prepare).not.toHaveBeenCalled();
  });

  it("imports the default app without creating a provider and retains authentication", async () => {
    const fetch = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const { createApp } = await import("../app.js");
    const result = await createApp().app.request("/api/creator-growth/publish/preview", { method: "POST", body: "{}" });
    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// The factory has no switch or provider argument a browser can enable.
const typeCheck: CreatorGrowthPublishDependencies["service"] | undefined = undefined;
void typeCheck;
