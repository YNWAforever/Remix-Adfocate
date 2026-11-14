// @vitest-environment node
import { createServer } from "node:http";
import { get } from "node:https";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { providerCaseReceipt } from "./delta-provider-runtime";
import { installProviderNetworkGuard } from "./delta-provider-network";

const binding = { runId: "00000000-0000-4000-8000-000000000001", sourceCommit: "a".repeat(40), targetBindingHash: "b".repeat(64) };
describe("provider receipt prerequisites", () => {
  it("refuses a case without a new actual HTTP response", () => { expect(() => providerCaseReceipt("synthetic-case", {}, 5, 5, binding)).toThrow(); });
  it("hashes private facts without returning them", () => {
    const result = providerCaseReceipt("synthetic-case", { privateObjectContents: "fixture-only" }, 5, 7, binding);
    expect(result).toMatchObject({ status: "passed", actualHttpRequests: 2 }); expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result)).not.toContain("fixture-only");
  });
});
describe("actual loopback HTTP and process egress guard", () => {
  it("delivers local HTTP and blocks external fetch DNS HTTPS and sockets before egress", async () => {
    const server = createServer((request, response) => { if (request.url === "/redirect") { response.writeHead(302, { Location: "https://provider-egress.invalid/forbidden" }); response.end(); } else response.end("owned-http"); });
    await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok)); const address = server.address(); if (!address || typeof address === "string") throw new Error("listener missing");
    const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
    const origin = `http://127.0.0.1:${address.port}`, guard = installProviderNetworkGuard([origin]);
    try {
      expect(await (await fetch(origin)).text()).toBe("owned-http");
      await expect(fetch("https://provider-egress.invalid/")).rejects.toThrow("Provider rehearsal held");
      await expect(lookup("provider-egress.invalid")).rejects.toThrow("Provider rehearsal held");
      expect(() => get("https://provider-egress.invalid/")).toThrow("Provider rehearsal held");
      expect(() => net.connect({ host: "127.0.0.1", port: address.port === 65535 ? 65534 : address.port + 1 })).toThrow("Provider rehearsal held");
      await expect(fetch(`${origin}/redirect`)).rejects.toThrow(); expect(guard.blockedRequests()).toBeGreaterThanOrEqual(4);
    } finally {
      guard.close(); server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok()));
    }
    expect(globalThis.fetch).toBe(originalFetch); expect(net.Socket.prototype.connect).toBe(originalConnect);
  });
});
