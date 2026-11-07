import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, setWorkspaceSlug } from "../api";
import { createCreatorPublishClient } from "./publishQueries";
import type { CreatorGrowthTransport } from "./queries";

const id = "00000000-0000-4000-8000-000000000011";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: { auth: { getSession } } }));
const mockRequest = () => vi.fn(async <Result>(path: string, init: RequestInit) => { void path; void init; return {} as Result; });
afterEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  setWorkspaceSlug("demo");
});
describe("creator publication client", () => {
  it("preserves confirmation and idempotency through the existing authenticated application transport", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "offline-session-token" } } });
    setWorkspaceSlug("offline-creator-workspace");
    const fetchStub = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => {
      void _path; void _init;
      return Response.json({ id, state: "creator_approved", version: 1, accountSubject: "123", providerContainerId: null, providerMediaId: null, permalink: null, stopped: false, updatedAt: "2026-11-04T00:00:00.000Z", sampleOnly: true });
    });
    vi.stubGlobal("fetch", fetchStub);
    const client = createCreatorPublishClient({ request: apiFetch });
    await client.approve({ draftId: id, approvalId: id, nonce: "n".repeat(43), fingerprint: "a".repeat(64), requestId: id });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [path, init] = fetchStub.mock.calls[0];
    expect(path).toBe("/api/creator-growth/publish/approve");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe(id);
    expect(headers.get("X-Creator-Confirmation")).toBe("exact-preview-v1");
    expect(headers.get("Authorization")).toBe("Bearer offline-session-token");
    expect(headers.get("X-Workspace-Slug")).toBe("offline-creator-workspace");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ draftId: id, approvalId: id, nonce: "n".repeat(43), fingerprint: "a".repeat(64) });
  });

  it("sends only explicit preview/confirmation IDs and retains one caller request key", async () => {
    const request = mockRequest();
    const client = createCreatorPublishClient({ request } as CreatorGrowthTransport);
    await client.prepare(id);
    expect(request.mock.calls[0]).toEqual(["/creator-growth/publish/preview", expect.objectContaining({ method: "POST", body: JSON.stringify({ draftId: id }), cache: "no-store" })]);
    await client.approve({ draftId: id, approvalId: id, nonce: "n".repeat(43), fingerprint: "a".repeat(64), requestId: id });
    const [, init] = request.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(id);
    expect(new Headers(init.headers).get("X-Creator-Confirmation")).toBe("exact-preview-v1");
    expect(JSON.parse(init.body as string)).toEqual({ draftId: id, approvalId: id, nonce: "n".repeat(43), fingerprint: "a".repeat(64) });
    expect(client).not.toHaveProperty("execute");
  });

  it("has no automatic retry and reconciliation is a separate explicit call", async () => {
    const request = mockRequest();
    const client = createCreatorPublishClient({ request } as CreatorGrowthTransport);
    request.mockRejectedValueOnce(new Error("outcome unavailable"));
    await expect(client.approve({ draftId: id, approvalId: id, nonce: "n".repeat(43), fingerprint: "a".repeat(64), requestId: id })).rejects.toThrow("outcome unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    await client.reconcile(id);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([`/creator-growth/publish/${id}/reconcile`, expect.objectContaining({ method: "POST", body: "{}" })]);
    await client.getStatus(id);
    expect(request.mock.calls[2]).toEqual([`/creator-growth/publish/${id}`, expect.objectContaining({ method: "GET", cache: "no-store" })]);
  });

  it("does not allow IDs to become another path or query", async () => {
    const request = mockRequest();
    const client = createCreatorPublishClient({ request } as CreatorGrowthTransport);
    await expect(client.getStatus("../execute?enabled=true")).rejects.toThrow("Invalid publication identifier");
    await expect(client.reconcile("https://example.invalid")).rejects.toThrow("Invalid publication identifier");
    expect(request).not.toHaveBeenCalled();
  });
});
