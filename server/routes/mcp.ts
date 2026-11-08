import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { requireCapability } from "../lib/staffCapabilities.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVER_NAME = /^[a-z0-9_]{1,32}$/;
const TOOL_NAME = /^[a-z0-9_]{1,64}$/;

function mcpRegistryEnabled() {
  return process.env.STUDIO_MCP_ENABLED === "true" && process.env.STUDIO_MCP_REGISTRY === "true";
}

function allowedUrl(raw: unknown): string | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.username || url.password) return null;
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.toString();
}

function readTools(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return null;
  const tools: string[] = [];
  for (const tool of value) {
    if (typeof tool !== "string" || !TOOL_NAME.test(tool) || tools.includes(tool)) return null;
    tools.push(tool);
  }
  return tools;
}

type ServerRow = { id: string; name: string; url: string; enabled?: boolean; read_only?: boolean };

/** Owner-facing mutations require the workspace-admin role; creators only ever consent. */
async function requireOwner(c: Context<Env>): Promise<boolean> {
  try {
    await requireCapability(serviceClient(), { userId: c.get("userId"), workspaceId: c.get("workspaceId"), workspaceSlug: "" }, "access.manage");
    return true;
  } catch {
    return false;
  }
}

/**
 * Creator-facing MCP skill consent. Everything is dark unless both the MCP flag and the workspace
 * registry flag are on; the optional tables are applied out of band (docs/operations/mcp-registry.sql).
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
      .select("id,name,enabled,read_only").eq("workspace_id", workspaceId).eq("enabled", true).eq("read_only", true).order("name");
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
    return c.json({
      available: true,
      skills: rows.map(row => ({ id: row.id, name: row.name, tools: toolsByServer.get(row.id) ?? [], consented: consented.has(row.id) })),
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

  // ---- Workspace-admin registry management (owner enables servers/tools) ----

  routes.get("/registry", async c => {
    if (!(await requireOwner(c))) return c.json({ code: "OWNER_REQUIRED", error: "Workspace admin only" }, 403);
    const store = serviceClient(), workspaceId = c.get("workspaceId");
    const servers = await store.from("mcp_servers").select("id,name,url,enabled,read_only").eq("workspace_id", workspaceId).order("name");
    if (servers.error) return c.json({ code: "mcp_registry_unavailable", servers: [] });
    const rows = (servers.data ?? []) as ServerRow[];
    const toolsByServer = new Map<string, string[]>();
    if (rows.length) {
      const tools = await store.from("mcp_server_tools").select("server_id,tool_name").in("server_id", rows.map(row => row.id));
      if (tools.error) return c.json({ code: "mcp_registry_unavailable", servers: [] });
      for (const tool of (tools.data ?? []) as Array<{ server_id: string; tool_name: string }>) {
        const list = toolsByServer.get(tool.server_id) ?? [];
        list.push(tool.tool_name);
        toolsByServer.set(tool.server_id, list);
      }
    }
    return c.json({ servers: rows.map(row => ({ id: row.id, name: row.name, url: row.url, enabled: row.enabled === true, tools: toolsByServer.get(row.id) ?? [] })) });
  });

  routes.post("/registry", async c => {
    if (!(await requireOwner(c))) return c.json({ code: "OWNER_REQUIRED", error: "Workspace admin only" }, 403);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ code: "INVALID_INPUT", error: "Invalid payload" }, 400);
    const name = typeof body.name === "string" ? body.name : "";
    const url = allowedUrl(body.url);
    const tools = readTools(body.tools);
    const enabled = body.enabled === true;
    if (!SERVER_NAME.test(name) || !url || !tools) {
      return c.json({ code: "INVALID_INPUT", error: "A lowercase name, an https url and 1-10 tools are required" }, 400);
    }
    const store = serviceClient(), workspaceId = c.get("workspaceId");
    const created = await store.from("mcp_servers")
      .insert({ workspace_id: workspaceId, name, url, enabled, read_only: true, created_by: c.get("userId") })
      .select("id").single();
    if (created.error) {
      if (created.error.code === "23505") return c.json({ code: "ALREADY_EXISTS", error: "A server with this name already exists" }, 409);
      return dbError(c, created.error, "mcp_registry_unavailable", 503);
    }
    const serverId = (created.data as { id?: string } | null)?.id;
    if (!serverId) return c.json({ code: "mcp_registry_unavailable" }, 503);
    const inserted = await store.from("mcp_server_tools").insert(tools.map(tool => ({ server_id: serverId, tool_name: tool })));
    if (inserted.error) return dbError(c, inserted.error, "mcp_registry_unavailable", 503);
    return c.json({ server: { id: serverId, name, url, enabled, tools } }, 201);
  });

  routes.patch("/registry/:id", async c => {
    if (!(await requireOwner(c))) return c.json({ code: "OWNER_REQUIRED", error: "Workspace admin only" }, 403);
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ code: "INVALID_INPUT", error: "Invalid payload" }, 400);
    const store = serviceClient(), workspaceId = c.get("workspaceId");
    const current = await store.from("mcp_servers").select("id,enabled").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (current.error) return dbError(c, current.error, "mcp_registry_unavailable", 503);
    if (!current.data) return c.json({ code: "not_found" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.url !== undefined) {
      const url = allowedUrl(body.url);
      if (!url) return c.json({ code: "INVALID_INPUT", error: "The url must be https (localhost http allowed)" }, 400);
      patch.url = url;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return c.json({ code: "INVALID_INPUT", error: "enabled must be a boolean" }, 400);
      patch.enabled = body.enabled;
    }
    const tools = body.tools === undefined ? undefined : readTools(body.tools);
    if (body.tools !== undefined && !tools) return c.json({ code: "INVALID_INPUT", error: "Tools must be 1-10 unique lowercase names" }, 400);
    if (!Object.keys(patch).length && tools === undefined) return c.json({ code: "INVALID_INPUT", error: "Nothing to update" }, 400);

    if (patch.enabled === true && tools === undefined) {
      const existing = await store.from("mcp_server_tools").select("tool_name").eq("server_id", id).limit(1);
      if (existing.error) return dbError(c, existing.error, "mcp_registry_unavailable", 503);
      if (!(existing.data ?? []).length) return c.json({ code: "INVALID_INPUT", error: "Add at least one tool before enabling" }, 400);
    }
    if (Object.keys(patch).length) {
      const updated = await store.from("mcp_servers").update(patch).eq("id", id).eq("workspace_id", workspaceId);
      if (updated.error) return dbError(c, updated.error, "mcp_registry_unavailable", 503);
    }
    if (tools) {
      const removed = await store.from("mcp_server_tools").delete().eq("server_id", id);
      if (removed.error) return dbError(c, removed.error, "mcp_registry_unavailable", 503);
      const inserted = await store.from("mcp_server_tools").insert(tools.map(tool => ({ server_id: id, tool_name: tool })));
      if (inserted.error) return dbError(c, inserted.error, "mcp_registry_unavailable", 503);
    }
    return c.json({ id, ok: true });
  });

  routes.delete("/registry/:id", async c => {
    if (!(await requireOwner(c))) return c.json({ code: "OWNER_REQUIRED", error: "Workspace admin only" }, 403);
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
    const store = serviceClient(), workspaceId = c.get("workspaceId");
    const removed = await store.from("mcp_servers").delete().eq("id", id).eq("workspace_id", workspaceId);
    if (removed.error) return dbError(c, removed.error, "mcp_registry_unavailable", 503);
    return c.json({ id, ok: true });
  });

  return routes;
}
