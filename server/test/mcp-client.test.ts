// @vitest-environment node
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { callMcpTool } from "../lib/mcp/client";
import type { McpServerConfig } from "../lib/mcp/policy";

const tool = { name: "lookup_note", description: "Read one note", inputSchema: { type: "object" } };
function config(url: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name: "fixture", url, timeoutMs: 1000, headers: {}, tools: [tool], ...overrides };
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
const open: Array<() => Promise<void>> = [];
afterEach(async () => { while (open.length) await open.pop()?.(); });

async function fixture(handler: (body: Record<string, unknown>, res: ServerResponse) => void) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = JSON.parse(await readBody(req) || "{}") as Record<string, unknown>;
    handler(body, res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/mcp`;
  open.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return url;
}

function jsonrpc(res: ServerResponse, result: unknown, session = true) {
  if (res.destroyed) return;
  res.writeHead(200, { "content-type": "application/json", ...(session ? { "mcp-session-id": "session-1" } : {}) });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
}

describe("mcp client", () => {
  it("initializes, notifies and calls an allowlisted tool", async () => {
    const methods: string[] = [];
    const url = await fixture((body, res) => {
      methods.push(String(body.method));
      if (body.method === "initialize") return jsonrpc(res, { protocolVersion: "2025-03-26", capabilities: {} });
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (body.method === "tools/call") return jsonrpc(res, { content: [{ type: "text", text: "NOTE-42" }] });
      res.writeHead(400); res.end();
    });
    expect(await callMcpTool(config(url), "lookup_note", JSON.stringify({ id: "42" }))).toBe("NOTE-42");
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  });

  it("accepts an SSE-framed JSON-RPC response", async () => {
    const url = await fixture((body, res) => {
      if (body.method === "initialize") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n\n`);
      }
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "SSE-OK" }] } })}\n\n`);
    });
    expect(await callMcpTool(config(url), "lookup_note", "{}")).toBe("SSE-OK");
  });

  it("marks tool error payloads without trusting them", async () => {
    const url = await fixture((body, res) => {
      if (body.method === "initialize") return jsonrpc(res, {});
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      return jsonrpc(res, { isError: true, content: [{ type: "text", text: "boom" }] });
    });
    expect(await callMcpTool(config(url), "lookup_note", "{}")).toBe("tool_error: boom");
  });

  it("returns bounded errors for HTTP, timeout and oversized responses", async () => {
    const http500 = await fixture((_body, res) => { res.writeHead(500); res.end("no"); });
    expect(await callMcpTool(config(http500), "lookup_note", "{}")).toBe("error: mcp_unavailable");

    const slow = await fixture((body, res) => {
      if (body.method === "initialize") { setTimeout(() => jsonrpc(res, {}), 300); return; }
      jsonrpc(res, {});
    });
    expect(await callMcpTool(config(slow, { timeoutMs: 50 }), "lookup_note", "{}")).toBe("error: mcp_timeout");

    const huge = await fixture((body, res) => {
      if (body.method === "initialize") return jsonrpc(res, {});
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      return jsonrpc(res, { content: [{ type: "text", text: "x".repeat(70000) }] });
    });
    expect(await callMcpTool(config(huge), "lookup_note", "{}")).toBe("error: mcp_invalid_response");
  });
});
