import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { ProviderRehearsalFailure, requireProviderFact as check } from "./delta-provider-contracts";
import { providerLoopbackOrigin } from "./delta-provider-stack";

/** Dedicated rehearsal process only. Blocks DNS and non-owned sockets as well as fetch. */
export function installProviderNetworkGuard(originsInput: readonly string[]) {
  const origins = new Set(originsInput.map(providerLoopbackOrigin));
  const ports = new Set([...origins].map(origin => Number(new URL(origin).port)));
  const original = { fetch: globalThis.fetch, lookup: dns.lookup, promisesLookup: dnsPromises.lookup,
    request: http.request, get: http.get, httpsRequest: https.request, httpsGet: https.get, connect: net.Socket.prototype.connect };
  let blocked = 0;
  function deny(): never { blocked++; throw new ProviderRehearsalFailure("external-egress-disabled"); }
  function allowedUrl(input: unknown) {
    let url: URL;
    try { url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url); } catch { return deny(); }
    if (!origins.has(url.origin) || url.username || url.password) return deny();
    return url;
  }
  function allowedSocket(args: unknown[]) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options: { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown } = first && typeof first === "object" ? first as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown } : { port: first, host: args[1] };
    if (options.path || (options.host ?? options.hostname) !== "127.0.0.1" || !ports.has(Number(options.port))) return deny();
  }
  const guardedFetch: typeof fetch = async (input, init) => {
    allowedUrl(input); const response = await original.fetch(input, { ...init, redirect: "error" });
    if (response.redirected || response.url && !origins.has(new URL(response.url).origin)) return deny(); return response;
  };
  Reflect.set(globalThis, "fetch", guardedFetch);
  Reflect.set(net.Socket.prototype, "connect", function(this: net.Socket, ...args: unknown[]) { allowedSocket(args); return Reflect.apply(original.connect, this, args); });
  Reflect.set(dnsPromises, "lookup", async (hostname: string, ...args: unknown[]) => {
    if (hostname !== "127.0.0.1") return deny(); return Reflect.apply(original.promisesLookup, dnsPromises, [hostname, ...args]);
  });
  Reflect.set(dns, "lookup", (hostname: string, ...args: unknown[]) => {
    if (hostname !== "127.0.0.1") return deny(); return Reflect.apply(original.lookup, dns, [hostname, ...args]);
  });
  for (const [module, name, method] of [[http, "request", original.request], [http, "get", original.get], [https, "request", original.httpsRequest], [https, "get", original.httpsGet]] as const) {
    Reflect.set(module, name, (...args: unknown[]) => {
      if (typeof args[0] === "string" || args[0] instanceof URL) allowedUrl(args[0]);
      else {
        const value = args[0] as { protocol?: string; hostname?: string; host?: string; port?: string | number; path?: string };
        check(value && typeof value === "object", "external-egress-disabled");
        allowedUrl(`${value.protocol ?? (module === https ? "https:" : "http:")}//${value.hostname ?? value.host}:${value.port}${value.path ?? "/"}`);
      }
      return Reflect.apply(method, module, args);
    });
  }
  syncBuiltinESMExports();
  return { fetch: guardedFetch, blockedRequests: () => blocked, close() {
    Reflect.set(globalThis, "fetch", original.fetch); Reflect.set(dns, "lookup", original.lookup); Reflect.set(dnsPromises, "lookup", original.promisesLookup);
    Reflect.set(net.Socket.prototype, "connect", original.connect);
    Reflect.set(http, "request", original.request); Reflect.set(http, "get", original.get); Reflect.set(https, "request", original.httpsRequest); Reflect.set(https, "get", original.httpsGet);
    syncBuiltinESMExports();
  } };
}
