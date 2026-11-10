import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { parseServerUrl, parseToolNames, validServerName } from "../lib/mcp/registry.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mcpRegistryEnabled() {
  return process.env.STUDIO_MCP_ENABLED === "true" && process.env.STUDIO_MCP_REGISTRY === "true";
}

type ServerRow = { id: string; name: string; url: string; enabled?: boolean; read_only?: boolean };

/**
 * Workspace-admin MCP registry management, mounted under /admin. The admin middleware in
 * routes/admin.ts enforces staff identity, workspace membership and the access.manage capability
 * (workspace_admin) via staffRouteRequirement before these handlers run.
 */
export const adminMcpRoutes = new Hono<AdminEnv>();

adminMcpRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!mcpRegistryEnabled()) return c.json({ code: "mcp_disabled", servers: [] }, 404);
  await next();
});

adminMcpRoutes.get("/registry", async c => {
  const scope = c.get("authorizedWorkspace");
  const store = serviceClient();
  const servers = await store.from("mcp_servers").select("id,name,url,enabled,read_only").eq("workspace_id", scope.workspaceId).order("name");
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

adminMcpRoutes.post("/registry", async c => {
  const scope = c.get("authorizedWorkspace");
  const staff = c.get("staff");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ code: "INVALID_INPUT", error: "Invalid payload" }, 400);
  const name = typeof body.name === "string" ? body.name : "";
  const url = parseServerUrl(body.url);
  const tools = parseToolNames(body.tools);
  const enabled = body.enabled === true;
  if (!validServerName(name) || !url || !tools) {
    return c.json({ code: "INVALID_INPUT", error: "A lowercase name, an https url and 1-10 tools are required" }, 400);
  }
  const store = serviceClient();
  const created = await store.from("mcp_servers")
    .insert({ workspace_id: scope.workspaceId, name, url, enabled, read_only: true, created_by: staff.userId })
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

adminMcpRoutes.patch("/registry/:id", async c => {
  const scope = c.get("authorizedWorkspace");
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ code: "INVALID_INPUT", error: "Invalid payload" }, 400);
  const store = serviceClient();
  const current = await store.from("mcp_servers").select("id").eq("id", id).eq("workspace_id", scope.workspaceId).maybeSingle();
  if (current.error) return dbError(c, current.error, "mcp_registry_unavailable", 503);
  if (!current.data) return c.json({ code: "not_found" }, 404);

  const patch: Record<string, unknown> = {};
  if (body.url !== undefined) {
    const url = parseServerUrl(body.url);
    if (!url) return c.json({ code: "INVALID_INPUT", error: "The url must be https (localhost http allowed)" }, 400);
    patch.url = url;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return c.json({ code: "INVALID_INPUT", error: "enabled must be a boolean" }, 400);
    patch.enabled = body.enabled;
  }
  const tools = body.tools === undefined ? undefined : parseToolNames(body.tools);
  if (body.tools !== undefined && !tools) return c.json({ code: "INVALID_INPUT", error: "Tools must be 1-10 unique lowercase names" }, 400);
  if (!Object.keys(patch).length && tools === undefined) return c.json({ code: "INVALID_INPUT", error: "Nothing to update" }, 400);

  if (patch.enabled === true && tools === undefined) {
    const existing = await store.from("mcp_server_tools").select("tool_name").eq("server_id", id).limit(1);
    if (existing.error) return dbError(c, existing.error, "mcp_registry_unavailable", 503);
    if (!(existing.data ?? []).length) return c.json({ code: "INVALID_INPUT", error: "Add at least one tool before enabling" }, 400);
  }
  if (Object.keys(patch).length) {
    const updated = await store.from("mcp_servers").update(patch).eq("id", id).eq("workspace_id", scope.workspaceId);
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

adminMcpRoutes.get("/audit", async c => {
  const scope = c.get("authorizedWorkspace");
  const store = serviceClient();
  const rows = await store.from("mcp_call_audit")
    .select("server_name,tool_name,outcome,duration_ms,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false }).limit(200);
  if (rows.error) return c.json({ code: "mcp_registry_unavailable", calls: [], summary: { total: 0, ok: 0, errors: 0, avg_duration_ms: null }, health: [] });
  type AuditRow = { server_name?: string | null; outcome?: string | null; duration_ms?: number | null; created_at?: string | null };
  const recent = (rows.data ?? []) as AuditRow[];
  const calls = recent.slice(0, 50);
  const durations = calls.map(call => Number(call.duration_ms)).filter(duration => Number.isFinite(duration));
  const summary = {
    total: calls.length,
    ok: calls.filter(call => call.outcome === "ok").length,
    errors: calls.filter(call => call.outcome !== "ok").length,
    avg_duration_ms: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
  };
  const byServer = new Map<string, { server_name: string; calls: number; ok: number; errors: number; total_ms: number; timed: number; last_ok_at: string | null; last_error_at: string | null }>();
  for (const row of recent) {
    const name = typeof row.server_name === "string" && row.server_name ? row.server_name : "unknown";
    const entry = byServer.get(name) ?? { server_name: name, calls: 0, ok: 0, errors: 0, total_ms: 0, timed: 0, last_ok_at: null, last_error_at: null };
    entry.calls += 1;
    if (row.outcome === "ok") { entry.ok += 1; entry.last_ok_at = entry.last_ok_at ?? row.created_at ?? null; }
    else { entry.errors += 1; entry.last_error_at = entry.last_error_at ?? row.created_at ?? null; }
    const ms = Number(row.duration_ms);
    if (Number.isFinite(ms)) { entry.total_ms += ms; entry.timed += 1; }
    byServer.set(name, entry);
  }
  const health = [...byServer.values()].map(entry => ({
    server_name: entry.server_name,
    calls: entry.calls,
    ok: entry.ok,
    errors: entry.errors,
    avg_duration_ms: entry.timed ? Math.round(entry.total_ms / entry.timed) : null,
    last_ok_at: entry.last_ok_at,
    last_error_at: entry.last_error_at,
  })).sort((a, b) => b.calls - a.calls);
  return c.json({ calls: recent.slice(0, 50), summary, health });
});

adminMcpRoutes.delete("/registry/:id", async c => {
  const scope = c.get("authorizedWorkspace");
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ code: "not_found" }, 404);
  const store = serviceClient();
  const removed = await store.from("mcp_servers").delete().eq("id", id).eq("workspace_id", scope.workspaceId);
  if (removed.error) return dbError(c, removed.error, "mcp_registry_unavailable", 503);
  return c.json({ id, ok: true });
});
