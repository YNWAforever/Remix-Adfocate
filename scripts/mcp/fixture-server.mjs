#!/usr/bin/env node
/**
 * Local read-only MCP fixture for the studio chat (D0).
 *
 *   npm run mcp:fixture
 *
 * Then, in a second shell:
 *   STUDIO_MCP_ENABLED=true
 *   STUDIO_MCP_SERVERS=[{"name":"fixture","url":"http://127.0.0.1:8787/mcp","enabled":true,"readOnly":true,"tools":["lookup_note","get_trend_brief"]}]
 *
 * This server is a fixture only: no real account data, no writes, no external calls.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MCP_FIXTURE_PORT ?? 8787);
const TOOLS = [
  {
    name: "lookup_note",
    description: "Read one published creator note by id (fixture data).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_trend_brief",
    description: "Return one short fixture trend brief for a topic.",
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  },
];

function callTool(name, args) {
  if (name === "lookup_note") {
    return { content: [{ type: "text", text: `Fixture note ${String(args.id ?? "unknown")}: review the hook before the caption.` }] };
  }
  if (name === "get_trend_brief") {
    return { content: [{ type: "text", text: `Fixture brief for ${String(args.topic ?? "general")}: one honest angle, one disclosure line, no invented metrics.` }] };
  }
  return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let message = {};
  try { message = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* handled below */ }
  const method = typeof message.method === "string" ? message.method : "";
  const id = message.id ?? null;

  const send = (payload, headers = {}) => {
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fixture-session", ...headers });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, ...payload }));
  };

  if (method === "initialize") return send({ result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "kocmax-mcp-fixture", version: "0.1.0" } } });
  if (method === "notifications/initialized") { res.writeHead(202); return res.end(); }
  if (method === "tools/list") return send({ result: { tools: TOOLS } });
  if (method === "tools/call") {
    const params = message.params ?? {};
    const result = callTool(String(params.name ?? ""), params.arguments ?? {});
    return send({ result });
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`KOCmax MCP fixture on http://127.0.0.1:${PORT}/mcp (read-only, no real data)`);
  console.log("Tools:", TOOLS.map(tool => tool.name).join(", "));
});
