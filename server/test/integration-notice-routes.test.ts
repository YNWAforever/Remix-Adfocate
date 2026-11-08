// @vitest-environment node
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type Env } from "../app.js";
import { integrationNoticeRoutes, type IntegrationNoticeFixture } from "../routes/integrationNotices.js";

const origin = "https://pilot.example", now = new Date("2026-10-31T00:00:00Z");
const secret = "offline-only-app-secret", receipt = "a".repeat(32);
async function signed(changes: Record<string, unknown> = {}, appSecret = secret) {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "123456", issued_at: now.getTime() / 1000, ...changes })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}.${payload}`;
}
function fixture() {
  // A transaction-shaped fixture, not a live mapping or a process replay cache in the route.
  const receipts = new Map<string, { confirmationCode: string; status: "pending" | "completed" }>();
  let effects = 0;
  const apply = vi.fn(async (input: { receiptHash: string }) => {
    if (!receipts.has(input.receiptHash)) {
      effects++;
      receipts.set(input.receiptHash, { confirmationCode: receipt, status: "pending" });
    }
    return receipts.get(input.receiptHash)!;
  });
  const resolveBinding = vi.fn(async () => ({ providerProjectId: "fixture-meta-app", subjectHash: "b".repeat(64) }));
  const readReceipt = vi.fn(async () => ({ status: "pending" as const, account: "PRIVATE_ACCOUNT", workspace: "PRIVATE_WORKSPACE", filename: "PRIVATE_FILE" }));
  const deps: IntegrationNoticeFixture = {
    origin, providerProjectId: "fixture-meta-app", notice: { appSecret: secret, resolveBinding, apply },
    receipts: { readReceipt }, now: () => now,
  };
  const app = new Hono<Env>();
  app.route("/api/integration-notices", integrationNoticeRoutes({ fixture: deps }));
  const post = (body: string, headers: Record<string, string> = {}, host = origin, path = "delete") => app.request(`${host}/api/integration-notices/instagram/${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body,
  });
  return { app, post, deps, apply, resolveBinding, readReceipt, effects: () => effects };
}
afterEach(() => vi.restoreAllMocks());

describe("fixture-only public notice HTTP boundary", () => {
  it("mounts disabled notices before workspace auth in the original app", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const { app } = createApp();
    for (const [path, method] of [["instagram/delete", "POST"], ["instagram/deauthorize", "POST"], [`deletion/${receipt}`, "GET"]]) {
      const result = await app.request(`${origin}/api/integration-notices/${path}`, { method });
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ code: "INTEGRATION_NOTICES_DISABLED" });
      expect(result.headers.get("cache-control")).toContain("no-store");
      expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["delete", "deauthorize"])("accepts only verified mapped %s forms and repeats the opaque receipt on concurrent replay", async path => {
    const f = fixture(), body = new URLSearchParams({ signed_request: await signed() }).toString();
    const results = await Promise.all([f.post(body, {}, origin, path), f.post(body, {}, origin, path)]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ url: `${origin}/integration-deletion/${receipt}`, confirmation_code: receipt });
      expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
    expect(f.effects()).toBe(1);
    expect(f.apply.mock.calls[0]).toEqual(f.apply.mock.calls[1]);
    expect(f.apply.mock.calls[0][0]).toMatchObject({ kind: path === "delete" ? "deletion" : "deauthorization", providerProjectId: "fixture-meta-app", subjectHash: "b".repeat(64), receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(f.apply.mock.calls)).not.toContain("123456");
  });

  it.each([
    ["empty", "", 400], ["missing", "other=x", 400], ["duplicate", "signed_request=x&signed_request=y", 400],
    ["encoded duplicate", "signed_request=x&signed%5Frequest=y", 400], ["extra", "signed_request=x&app_id=other", 400],
    ["malformed escape", "signed_request=%GG", 400], ["malformed UTF8", "signed_request=%FF", 400],
    ["oversized", `signed_request=${"x".repeat(16385)}`, 413], ["malformed signature", "signed_request=bad.payload", 403],
  ])("rejects %s form before any binding or receipt operation", async (_label, body, status) => {
    const f = fixture(), result = await f.post(String(body));
    expect(result.status).toBe(status);
    expect(f.resolveBinding).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it.each(["application/json", "multipart/form-data; boundary=fixture", "text/plain"])("rejects unsupported media type %s", async contentType => {
    const f = fixture();
    expect((await f.post("signed_request=x", { "Content-Type": contentType })).status).toBe(415);
    expect(f.resolveBinding).not.toHaveBeenCalled();
  });

  it("counts streamed bytes even without Content-Length and cancels overflow", async () => {
    const f = fixture(); let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4096).fill(120)); }, cancel() { cancelled = true; } });
    const request = new Request(`${origin}/api/integration-notices/instagram/delete`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, duplex: "half",
    } as RequestInit);
    expect((await f.app.request(request)).status).toBe(413);
    expect(cancelled).toBe(true); expect(f.resolveBinding).not.toHaveBeenCalled();
  });

  it.each([
    [{ Origin: "https://evil.example" }, origin], [{ Origin: "null" }, origin], [{ "Sec-Fetch-Site": "cross-site" }, origin],
    [{ Origin: "https://evil.example", "X-Forwarded-Host": "pilot.example" }, "https://evil.example"],
    [{ "Forwarded": "host=pilot.example;proto=https" }, "https://evil.example"],
  ])("rejects untrusted origin/host before signature resolution %j", async (headers, host) => {
    const f = fixture();
    expect((await f.post(new URLSearchParams({ signed_request: await signed() }).toString(), headers, host)).status).toBe(403);
    expect(f.resolveBinding).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it.each([{ issued_at: now.getTime() / 1000 - 86401 }, { issued_at: now.getTime() / 1000 + 61 }, { expires: now.getTime() / 1000 }, { algorithm: "none" }])("enforces D0 fixture freshness/signature policy %j without mutating bindings", async changes => {
    const f = fixture();
    expect((await f.post(new URLSearchParams({ signed_request: await signed(changes) }).toString())).status).toBe(403);
    expect(f.resolveBinding).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  it("rejects another app's signature, unresolved mapping and a resolver's wrong project without applying", async () => {
    const f = fixture();
    expect((await f.post(new URLSearchParams({ signed_request: await signed({}, "another-app-secret") }).toString())).status).toBe(403);
    f.resolveBinding.mockResolvedValueOnce(null as never);
    const body = new URLSearchParams({ signed_request: await signed() }).toString();
    for (const result of [await f.post(body), await (async () => {
      f.resolveBinding.mockResolvedValueOnce({ providerProjectId: "another-app", subjectHash: "b".repeat(64) }); return f.post(body);
    })()]) {
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ code: "PROVIDER_IDENTITY_MAPPING_REQUIRED" });
    }
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("never returns a URL for a malformed repository receipt or exposes repository errors", async () => {
    const f = fixture(), body = new URLSearchParams({ signed_request: await signed() }).toString();
    f.apply.mockResolvedValueOnce({ confirmationCode: "../../PRIVATE_WORKSPACE", status: "completed" });
    f.apply.mockRejectedValueOnce(new Error("PRIVATE_ACCOUNT PRIVATE_FILE"));
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let n = 0; n < 2; n++) {
      const result = await f.post(body);
      expect(result.status).toBe(503);
      expect(await result.text()).not.toMatch(/PRIVATE_|completed|confirmation_code/);
    }
    expect(logs).not.toHaveBeenCalled();
  });

  it("reads only an opaque receipt and strips all metadata for anonymous or authenticated callers", async () => {
    const f = fixture();
    const callers: Record<string, string>[] = [{}, { Authorization: "Bearer other-role", Cookie: "session=other" }];
    for (const headers of callers) {
      const result = await f.app.request(`${origin}/api/integration-notices/deletion/${receipt}`, { headers });
      expect(result.status).toBe(200); expect(await result.json()).toEqual({ status: "pending" });
      expect(result.headers.get("cache-control")).toContain("no-store");
    }
    expect(f.readReceipt).toHaveBeenCalledWith(receipt);
    f.readReceipt.mockResolvedValueOnce({ status: "completed" } as never);
    expect(await (await f.app.request(`${origin}/api/integration-notices/deletion/${receipt}`)).json()).toEqual({ status: "completed" });
  });

  it("distinguishes unknown receipts, malformed receipts and a missing status port without guessing completed", async () => {
    const f = fixture();
    f.readReceipt.mockResolvedValueOnce(null as never);
    const unknown = await f.app.request(`${origin}/api/integration-notices/deletion/${receipt}`);
    expect(unknown.status).toBe(404); expect(await unknown.json()).toEqual({ code: "RECEIPT_NOT_FOUND" });
    f.readReceipt.mockClear();
    expect((await f.app.request(`${origin}/api/integration-notices/deletion/not-a-receipt`)).status).toBe(400);
    expect(f.readReceipt).not.toHaveBeenCalled();
    delete f.deps.receipts;
    const noPort = await f.app.request(`${origin}/api/integration-notices/deletion/${receipt}`);
    expect(noPort.status).toBe(503); expect(await noPort.json()).toEqual({ code: "RECEIPT_STATUS_UNAVAILABLE" });
  });

  it("fails closed for invalid fixture origins and invalid status values", async () => {
    const f = fixture();
    f.readReceipt.mockResolvedValueOnce({ status: "PRIVATE_ACCOUNT" } as never);
    const result = await f.app.request(`${origin}/api/integration-notices/deletion/${receipt}`);
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("PRIVATE_ACCOUNT");
    const app = new Hono<Env>();
    app.route("/api/integration-notices", integrationNoticeRoutes({ fixture: { ...f.deps, origin: "https://evil.example/path" } }));
    expect((await app.request(`${origin}/api/integration-notices/deletion/${receipt}`)).status).toBe(503);
  });
});
