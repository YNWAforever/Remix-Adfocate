import { IntegrationError } from "./policy.js";

export type ProviderHttpRequest = {
  url: string; method: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>; body?: string; signal?: AbortSignal;
  operation: "read" | "oauth" | "refresh" | "revoke"; maxBytes?: number;
};
export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface ProviderHttpPort {
  readonly transportKind: "fixture" | "live";
  json<T>(request: ProviderHttpRequest): Promise<T>;
  bytes(request: ProviderHttpRequest): Promise<Uint8Array>;
}
export class ProviderHttpError extends IntegrationError {
  constructor(code: string, status = 502, public readonly retryAfterMs?: number) { super(code, status); }
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 2000;

/** Operation + method + endpoint are checked together: there is no generic HTTP tool. */
function endpoint(request: ProviderHttpRequest): URL {
  const denied = () => new ProviderHttpError("PROVIDER_ENDPOINT_DENIED", 400);
  let url: URL;
  try { url = new URL(request.url); } catch { throw denied(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || /[%\\]/.test(url.pathname)) throw denied();
  const { method, operation } = request;
  let allowed = false;
  if (url.hostname === "oauth2.googleapis.com") {
    allowed = method === "POST" && ((url.pathname === "/token" && (operation === "oauth" || operation === "refresh")) || (url.pathname === "/revoke" && operation === "revoke"));
  } else if (url.hostname === "www.googleapis.com") {
    allowed = method === "GET" && operation === "read" && (/^\/drive\/v3\/files\/[A-Za-z0-9_-]+(?:\/export)?$/.test(url.pathname) || url.pathname === "/oauth2/v3/certs");
  } else if (url.hostname === "api.instagram.com") {
    allowed = method === "POST" && operation === "oauth" && url.pathname === "/oauth/access_token";
  } else if (url.hostname === "graph.instagram.com") {
    allowed = (method === "GET" && operation === "oauth" && url.pathname === "/access_token")
      || (method === "GET" && operation === "refresh" && url.pathname === "/refresh_access_token")
      || (method === "GET" && operation === "read" && /^\/v\d+\.\d+\/(?:me|\d+)(?:\/(?:media|insights|permissions))?$/.test(url.pathname))
      || (method === "DELETE" && operation === "revoke" && /^\/v\d+\.\d+\/(?:me|\d+)\/permissions$/.test(url.pathname));
  }
  // Reject Graph method overrides / callback executable wrappers, even on permitted paths.
  if (!allowed || [...url.searchParams.keys()].some(key => ["method", "callback", "redirect_uri"].includes(key.toLowerCase())) || (method === "GET" && request.body !== undefined)) throw denied();
  return url;
}

function retryDelay(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

/** Explicit transport injection is the only egress path; no ambient fetch, cookies or logging. */
export class ProviderHttp implements ProviderHttpPort {
  readonly transportKind: "fixture" | "live";
  private readonly timeoutMs: number;
  private readonly maxReadRetries: number;
  private readonly circuits = new Map<string, { failures: number; until: number }>();
  constructor(private readonly fetchImpl: ProviderFetch, options: { transportKind?: "fixture" | "live"; timeoutMs?: number; maxReadRetries?: number } = {}) {
    if (typeof fetchImpl !== "function") throw new ProviderHttpError("PROVIDER_TRANSPORT_REQUIRED", 503);
    // An unclassified injected fetch may perform network I/O. D0 requires an explicit fixture.
    this.transportKind = options.transportKind ?? "live";
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxReadRetries = options.maxReadRetries ?? 2;
    if (!["fixture", "live"].includes(this.transportKind) || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000 || !Number.isInteger(this.maxReadRetries) || this.maxReadRetries < 0 || this.maxReadRetries > 2) throw new ProviderHttpError("PROVIDER_INVALID_CONFIG", 503);
  }
  async json<T>(request: ProviderHttpRequest): Promise<T> {
    const data = await this.bytes({ ...request, maxBytes: request.maxBytes ?? 256 * 1024 });
    // Google token revocation returns an empty successful body.
    if (!data.length && request.operation === "revoke") return {} as T;
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as T; }
    catch { throw new ProviderHttpError("PROVIDER_INVALID_RESPONSE"); }
  }
  async bytes(request: ProviderHttpRequest): Promise<Uint8Array> {
    const host = endpoint(request).hostname;
    const limit = request.maxBytes ?? MAX_BYTES;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BYTES || (request.body?.length ?? 0) > 32768) throw new ProviderHttpError("PROVIDER_INVALID_REQUEST", 400);
    if (request.signal?.aborted) throw new ProviderHttpError("PROVIDER_CANCELLED", 409);
    const read = request.operation === "read";
    const circuit = this.circuits.get(host);
    if (read && circuit && circuit.until > Date.now()) throw new ProviderHttpError("PROVIDER_CIRCUIT_OPEN", 503, circuit.until - Date.now());
    if (read && circuit?.until && circuit.until <= Date.now()) this.circuits.delete(host);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const abortError = () => new ProviderHttpError(timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_CANCELLED", timedOut ? 504 : 409);
    const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(abortError()); };
      const cleanup = () => controller.signal.removeEventListener("abort", onAbort);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (controller.signal.aborted) onAbort();
    });
    try {
      const retries = request.method === "GET" && request.operation === "read" ? this.maxReadRetries : 0;
      for (let attempt = 0; ; attempt++) {
        let response: Response | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          if (controller.signal.aborted) throw abortError();
          response = await bounded<Response>(this.fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body,
            signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }).then(value => {
              if (controller.signal.aborted) void value.body?.cancel().catch(() => {});
              return value;
            }));
          if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ProviderHttpError("PROVIDER_REDIRECT");
          if (!response.ok) {
            const code = response.status === 429 ? "PROVIDER_RATE_LIMITED" : response.status === 401 ? "PROVIDER_AUTH_REQUIRED" : [403, 404].includes(response.status) ? "SOURCE_UNAVAILABLE" : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_REJECTED";
            throw new ProviderHttpError(code, response.status, retryDelay(response.headers.get("retry-after")));
          }
          const declared = response.headers.get("content-length");
          if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ProviderHttpError("PROVIDER_BODY_TOO_LARGE", 413);
          if (!response.body) { if (read) this.circuits.delete(host); return new Uint8Array(); }
          reader = response.body.getReader();
          let size = 0;
          const parts: Uint8Array[] = [];
          while (true) {
            const { value, done } = await bounded(reader.read());
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new ProviderHttpError("PROVIDER_BODY_TOO_LARGE", 413);
            parts.push(value);
          }
          const result = new Uint8Array(size);
          let offset = 0;
          for (const part of parts) { result.set(part, offset); offset += part.length; }
          if (read) this.circuits.delete(host);
          return result;
        } catch (cause) {
          if (reader) void reader.cancel().catch(() => {});
          else if (response?.body) void response.body.cancel().catch(() => {});
          const error = controller.signal.aborted ? abortError() : cause instanceof ProviderHttpError ? cause : new ProviderHttpError("PROVIDER_UNAVAILABLE");
          const delay = error.retryAfterMs ?? 250 * 2 ** attempt;
          if (attempt >= retries || !["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED"].includes(error.code) || delay > MAX_RETRY_DELAY_MS) throw error;
          await bounded(new Promise<void>(resolve => {
            const retryTimer = setTimeout(() => { controller.signal.removeEventListener("abort", stop); resolve(); }, delay);
            const stop = () => { clearTimeout(retryTimer); resolve(); };
            controller.signal.addEventListener("abort", stop, { once: true });
          }));
        } finally {
          // Cancellation must not itself be able to hang the deadline.
          if (reader) { void reader.cancel().catch(() => {}); }
          else if (response?.body) { void response.body.cancel().catch(() => {}); }
        }
      }
    } catch (error) {
      if (read && error instanceof ProviderHttpError && ["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT"].includes(error.code)) {
        const failures = (this.circuits.get(host)?.failures ?? 0) + 1;
        this.circuits.set(host, { failures, until: failures >= 3 ? Date.now() + 30000 : 0 });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }
}
