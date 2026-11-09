import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mcpRegistryEnabled() {
  return process.env.STUDIO_MCP_ENABLED === "true" && process.env.STUDIO_MCP_REGISTRY === "true";
}

type ServerRow = { id: string; name: string; enabled?: boolean; read_only?: boolean; auth_mode?: string | null };

/**
 * Creator-facing MCP consent. Everything is dark unless both the MCP flag and the workspace
 * registry flag are on; owner registry writes live under /admin/mcp (staff workspace admin).
 */
export function mcpSkillRoutes() {
  const routes = new Hono<Env>();

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!mcpRegistryEnabled()) return c.json({ code: "mcp_disabled", available: false, skills: [] }, 404);
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header("Sec-Fetch-Site") === "cross-site") {
        return c.json({ code: "ORIGIN_DENIED", error: "Same-origin only" }, 403);
      }
    }
    await next();
  });

  routes.get("/skills", async c => {
    const store = serviceClient(), workspaceId = c.get("workspaceId"), creatorId = c.get("userId");
    const servers = await store.from("mcp_servers")
      .select("id,name,enabled,read_only,auth_mode").eq("workspace_id", workspaceId).eq("enabled", true).eq("read_only", true).order("name");
    if (servers.error) return c.json({ available: false, skills: [] });
    const rows = (servers.data ?? []) as ServerRow[];
    if (!rows.length) return c.json({ available: true, skills: [] });

    const ids = rows.map(row => row.id);
    const [tools, consents] = await Promise.all([
      store.from("mcp_server_tools").select("server_id,tool_name").in("server_id", ids).eq("enabled", true),
      store.from("mcp_consents").select("server_id").in("server_id", ids)
        .eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null),
    ]);
    if (tools.error || consents.error) return c.json({ available: false, skills: [] });

    const toolsByServer = new Map<string, string[]>();
    for (const tool of (tools.data ?? []) as Array<{ server_id: string; tool_name: string }>) {
      const list = toolsByServer.get(tool.server_id) ?? [];
      if (typeof tool.tool_name === "string" && tool.tool_name.length <= 64 && !list.includes(tool.tool_name)) list.push(tool.tool_name);
      toolsByServer.set(tool.server_id, list);
    }
    const consented = new Set(((consents.data ?? []) as Array<{ server_id: string }>).map(row => row.server_id));
    const oauthIds = rows.filter(row => row.auth_mode === "oauth").map(row => row.id);
    const connections = oauthIds.length
      ? await store.from("mcp_oauth_connections").select("server_id,expires_at").in("server_id", oauthIds)
          .eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null)
      : { data: [] as Array<{ server_id: string }>, error: null };
    if (connections.error) return c.json({ available: false, skills: [] });
    const connectionRows = (connections.data ?? []) as Array<{ server_id: string; expires_at?: string | null }>;
    const liveConnections = new Set(connectionRows.filter(row => !row.expires_at || Date.parse(row.expires_at) > Date.now()).map(row => row.server_id));
    const expiredConnections = new Set(connectionRows.filter(row => row.expires_at && Date.parse(row.expires_at) <= Date.now()).map(row => row.server_id));
    return c.json({
      available: true,
      skills: rows.map(row => ({
        id: row.id,
        name: row.name,
        tools: toolsByServer.get(row.id) ?? [],
        consented: consented.has(row.id),
        auth_mode: row.auth_mode ?? "none",
        connected: liveConnections.has(row.id),
        expired: expiredConnections.has(row.id),
      })),
    });
  });

  routes.post("/skills/:id/consent", async c => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
    const store = serviceClient(), workspaceId = c.get("workspaceId"), creatorId = c.get("userId");
    const server = await store.from("mcp_servers").select("id,enabled,read_only")
      .eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (server.error) return dbError(c, server.error, "mcp_registry_unavailable", 503);
    const row = server.data as ServerRow | null;
    if (!row || row.enabled !== true || row.read_only !== true) return c.json({ code: "not_found" }, 404);

    const existing = await store.from("mcp_consents").select("id").eq("server_id", id)
      .eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null).maybeSingle();
    if (existing.error) return dbError(c, existing.error, "mcp_registry_unavailable", 503);
    if (existing.data) return c.json({ id, consented: true, reused: true });

    const inserted = await store.from("mcp_consents")
      .insert({ server_id: id, creator_id: creatorId, workspace_id: workspaceId, scopes: {} })
      .select("id").single();
    if (inserted.error) return dbError(c, inserted.error, "mcp_registry_unavailable", 503);
    return c.json({ id, consented: true }, 201);
  });

  routes.delete("/skills/:id/consent", async c => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
    const store = serviceClient(), workspaceId = c.get("workspaceId"), creatorId = c.get("userId");
    const server = await store.from("mcp_servers").select("id")
      .eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (server.error) return dbError(c, server.error, "mcp_registry_unavailable", 503);
    if (!server.data) return c.json({ code: "not_found" }, 404);

    const revoked = await store.from("mcp_consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("server_id", id).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null);
    if (revoked.error) return dbError(c, revoked.error, "mcp_registry_unavailable", 503);
    return c.json({ id, consented: false });
  });

  return routes;
}
