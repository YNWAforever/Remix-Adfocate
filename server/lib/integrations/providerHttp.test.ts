// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderHttp } from "./providerHttp.js";

const read = { url: "https://www.googleapis.com/drive/v3/files/selected?alt=media", method: "GET", operation: "read" } as const;
afterEach(() => vi.useRealTimers());

describe("bounded provider HTTP", () => {
  it("defaults unknown transports to live and never supplies an ambient transport", async () => {
    const http = new ProviderHttp(async () => Response.json({ value: 0 }));
    expect(http.transportKind).toBe("live");
    expect(new ProviderHttp(async()=>Response.json({}),{transportKind:"fixture"}).transportKind).toBe("fixture");
    expect(await http.json(read)).toEqual({ value: 0 });
    expect(() => new ProviderHttp(undefined as never)).toThrow("PROVIDER_TRANSPORT_REQUIRED");
  });
  it.each([
    "https://evil.test/drive/v3/files/a", "http://www.googleapis.com/drive/v3/files/a",
    "https://www.googleapis.com.evil.test/drive/v3/files/a", "https://name:ignored@www.googleapis.com/drive/v3/files/a",
    "https://www.googleapis.com:444/drive/v3/files/a", "https://www.googleapis.com/drive/v3/files",
    "https://www.googleapis.com/drive/v3/files/a/permissions", "https://graph.instagram.com/v25.0/me/messages",
  ])("rejects a non-allowlisted endpoint before sending credentials: %s", async url => {
    let sent = false;
    const http = new ProviderHttp(async () => { sent = true; return Response.json({}); });
    await expect(http.json({ ...read, url })).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_DENIED" });
    expect(sent).toBe(false);
  });
  it("forbids content mutations and lifecycle requests disguised as reads", async () => {
    const http = new ProviderHttp(async () => Response.json({}));
    await expect(http.json({ ...read, method: "DELETE" })).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_DENIED" });
    await expect(http.json({ ...read, url: "https://graph.instagram.com/refresh_access_token" })).rejects.toMatchObject({ code: "PROVIDER_ENDPOINT_DENIED" });
  });
  it("forces redirect failure, no ambient cookies, and does not expose upstream secrets", async () => {
    let options: RequestInit | undefined;
    const http = new ProviderHttp(async (_url, init) => { options = init; return new Response("secret-token", { status: 302, headers: { Location: "https://evil.test" } }); });
    await expect(http.json(read)).rejects.toMatchObject({ code: "PROVIDER_REDIRECT" });
    expect(options).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
  });
  it("enforces the actual streaming limit even without content-length", async () => {
    let cancelled = false;
    const http = new ProviderHttp(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(5)); c.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; },
    })));
    await expect(http.bytes({ ...read, maxBytes: 8 })).rejects.toMatchObject({ code: "PROVIDER_BODY_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });
  it("times out a stalled response body and an abort-ignoring transport", async () => {
    vi.useFakeTimers();
    for (const fetchImpl of [async () => new Response(new ReadableStream({})), () => new Promise<Response>(() => {})]) {
      const pending = new ProviderHttp(fetchImpl, { timeoutMs: 30, maxReadRetries: 0 }).bytes(read);
      const checked = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(31);
      await checked;
    }
  });
  it("cancels before transport and during a pending read", async () => {
    const c = new AbortController(); c.abort();
    const fetchImpl = vi.fn(async () => Response.json({}));
    await expect(new ProviderHttp(fetchImpl).json({ ...read, signal: c.signal })).rejects.toMatchObject({ code: "PROVIDER_CANCELLED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const c2 = new AbortController();
    const pending = new ProviderHttp(async () => new Response(new ReadableStream({}))).bytes({ ...read, signal: c2.signal });
    const checked = expect(pending).rejects.toMatchObject({ code: "PROVIDER_CANCELLED" });
    c2.abort(); await checked;
  });
  it("retries only idempotent reads and honors bounded Retry-After", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const http = new ProviderHttp(async () => ++attempts === 1 ? new Response("private", { status: 429, headers: { "Retry-After": "1" } }) : Response.json({ ok: true }));
    const pending = http.json(read);
    await vi.advanceTimersByTimeAsync(999); expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toEqual({ ok: true });
    expect(attempts).toBe(2);
    attempts = 0;
    const lifecycle = new ProviderHttp(async () => { attempts++; return new Response("token=private", { status: 503 }); });
    await expect(lifecycle.json({ url: "https://oauth2.googleapis.com/token", method: "POST", operation: "refresh" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(attempts).toBe(1);
  });
  it("does not retry earlier than a long Retry-After or leak error bodies", async () => {
    let calls = 0;
    const http = new ProviderHttp(async () => { calls++; return new Response("my-token-and-file", { status: 429, headers: { "Retry-After": "3600" } }); });
    await expect(http.json(read)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryAfterMs: 3600000, message: "PROVIDER_RATE_LIMITED" });
    expect(calls).toBe(1);
  });
  it("rejects malformed JSON and sanitizes thrown transport failures", async () => {
    await expect(new ProviderHttp(async () => new Response("{secret")).json(read)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    await expect(new ProviderHttp(async () => { throw new Error("access_token=secret"); }, { maxReadRetries: 0 }).json(read)).rejects.toMatchObject({ message: "PROVIDER_UNAVAILABLE" });
  });
  it("opens a short read circuit after consecutive failures but still permits revocation", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const http = new ProviderHttp(async (_url, init) => { calls++; return init.method === "DELETE" ? Response.json({ success: true }) : new Response("private", { status: 503 }); }, { maxReadRetries: 0 });
    const request = { ...read, url: "https://graph.instagram.com/v26.0/123/media" };
    for (let i = 0; i < 3; i++) await expect(http.json(request)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(http.json(request)).rejects.toMatchObject({ code: "PROVIDER_CIRCUIT_OPEN" });
    expect(calls).toBe(3);
    expect(await http.json({ url: "https://graph.instagram.com/v26.0/123/permissions", method: "DELETE", operation: "revoke" })).toEqual({ success: true });
    await vi.advanceTimersByTimeAsync(30001);
    await expect(http.json(request)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(calls).toBe(5);
  });
  it("enforces declared body limits and a hard retry count", async () => {
    const large = new ProviderHttp(async () => new Response("small", { headers: { "Content-Length": "5242881" } }));
    await expect(large.bytes(read)).rejects.toMatchObject({ code: "PROVIDER_BODY_TOO_LARGE" });
    vi.useFakeTimers();
    let calls = 0;
    const http = new ProviderHttp(async () => { calls++; return new Response("private", { status: 503 }); });
    const checked = expect(http.json(read)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(1000); await checked;
    expect(calls).toBe(3);
  });
  it("never replays Instagram GET exchange/refresh lifecycle calls", async () => {
    let calls = 0;
    const http = new ProviderHttp(async () => { calls++; return new Response("private", { status: 503 }); });
    await expect(http.json({ url: "https://graph.instagram.com/access_token", method: "GET", operation: "oauth" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(http.json({ url: "https://graph.instagram.com/refresh_access_token", method: "GET", operation: "refresh" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(calls).toBe(2);
  });
  it("cancels an untrusted error body immediately before waiting for retry", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const http = new ProviderHttp(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }));
    const checked = expect(http.json(read)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(0); expect(cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); await checked;
  });
});
