import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";

const PROTOCOL_VERSION = "2025-03-26";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL = "list_open_missions";
const MAX_MISSIONS = 20;

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };

function tokenMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

/**
 * Deployed read-only MCP pilot server (`/api/mcp-pilot?ws=<workspace>&token=<secret>`).
 * It exposes only the workspace's open missions; no creator identity is involved, no writes.
 * Registered per workspace in mcp_servers so the studio chat reaches it through the MCP client.
 */
export function mcpPilotRoutes() {
  const routes = new Hono();

  routes.post("/", async c => {
    const workspaceId = c.req.query("ws") ?? "";
    if (!tokenMatches(process.env.MCP_PILOT_TOKEN, c.req.query("token")) || !UUID.test(workspaceId)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => null) as Rpc | null;
    const id = body?.id ?? null;
    if (!body || body.jsonrpc !== "2.0") return c.json({ jsonrpc: "2.0", id, error: { code: -32700, message: "parse error" } });

    if (body.method === "initialize") {
      return c.json({ jsonrpc: "2.0", id, result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "kocmax-workspace-pilot", version: "0.1.0" },
      } });
    }
    if (body.method === "notifications/initialized") {
      c.status(202);
      return c.body(null);
    }
    if (body.method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools: [{
        name: TOOL,
        description: "List open missions in this workspace with reward and deadline.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }] } });
    }
    if (body.method === "tools/call") {
      const name = typeof body.params?.name === "string" ? body.params.name : "";
      if (name !== TOOL) return c.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "unknown tool" }] } });
      const missions = await serviceClient().from("missions")
        .select("slug,title,points_reward,cash_reward,deadline,platforms")
        .eq("workspace_id", workspaceId).eq("status", "active")
        .order("deadline", { ascending: true, nullsFirst: false }).limit(MAX_MISSIONS);
      if (missions.error) return c.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "missions unavailable" }] } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ missions: missions.data ?? [] }) }] } });
    }
    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  });

  return routes;
}
