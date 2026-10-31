import { Hono } from "hono";
import type { Env } from "../app.js";
import { boundedText, integrationMode, IntegrationError, requireRequestId, validateProvider, validateSelection } from "../lib/integrations/policy.js";
import { getIntegrationService, manageDisabledConnection } from "../lib/integrations/runtime.js";
import type { IntegrationService } from "../lib/integrations/service.js";
import type { Actor } from "../lib/integrations/types.js";
import type { IntegrationImport } from "../../src/lib/integrations/types.js";
import { listManagedConnections } from "../lib/integrations/lifecycle.js";
import { serviceClient } from "../lib/supabase.js";

export type IntegrationRouteDeps = { getService?: () => IntegrationService | null; environment?: Record<string, string | undefined>; disabledManagement?: typeof manageDisabledConnection };
export function integrationRoutes(deps: IntegrationRouteDeps = {}) {
  const routes = new Hono<Env>(), env = deps.environment ?? process.env, getService = deps.getService ?? getIntegrationService;
  const mode = () => integrationMode(env);
  const actor = (c: { get: (key: "userId" | "workspaceId") => string }): Actor => ({ creatorId: c.get("userId"), workspaceId: c.get("workspaceId") });
  const service = () => { const value = getService(); if (!value) throw new IntegrationError("INTEGRATIONS_DISABLED", 404); return value; };
  const requireProvider = (provider: unknown) => { const value = validateProvider(provider); if (env[value === "instagram" ? "INSTAGRAM_CONNECTIONS_ENABLED" : "DRIVE_CONNECTIONS_ENABLED"] !== "true") throw new IntegrationError("INTEGRATIONS_DISABLED", 404); return value; };
  const requireConnectionProvider = async (who: Actor, id: string) => {
    const connection = (await service().list(who)).find(value => value.id === id);
    if (!connection) throw new IntegrationError("NOT_FOUND", 404);
    requireProvider(connection.provider);
  };
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!c.get("userId") || !c.get("workspaceId") || !c.get("jwt")) return c.json({ code: "no_auth", error: "請先登入" }, 401);
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header("Sec-Fetch-Site") === "cross-site") return c.json({ code: "ORIGIN_DENIED", error: "請由工作室重試" }, 403);
      const raw = await c.req.text(); if (raw.length > 64000) return c.json({ code: "INVALID_INPUT", error: "內容太長" }, 413);
      try { const parsed = JSON.parse(raw || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); } catch { return c.json({ code: "INVALID_INPUT", error: "請檢查資料" }, 400); }
    }
    const management = c.req.method === "POST" && /\/(revoke|purge)$/.test(c.req.path);
    if (mode() !== "mock" && !management) {
      if (c.req.method === "GET" && /\/integrations\/?$/.test(c.req.path)) {
        const available = getService();
        return c.json({ mode: "disabled", connections: available ? await available.list(actor(c)) : await listManagedConnections(serviceClient(), actor(c)) });
      }
      return c.json({ code: "INTEGRATIONS_DISABLED", error: "資料技能尚未開放，基本任務仍可使用" }, 404);
    }
    await next();
  });
  routes.onError((error, c) => {
    const known = error instanceof IntegrationError ? error : new IntegrationError("INTEGRATIONS_UNAVAILABLE", 503);
    return c.json({ code: known.code, error: "暫未完成。請檢查授權或來源，原有草稿仍保留。" }, known.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503);
  });
  routes.get("/", async c => c.json({ mode: "mock", connections: await service().list(actor(c)) }));
  routes.post("/:provider/start", async c => {
    const p = await c.req.json(); return c.json(await service().beginConnection(actor(c), requireProvider(c.req.param("provider")), c.get("jwt"), String(p.returnPath ?? "/connections")));
  });
  routes.post("/:provider/complete", async c => {
    const p = await c.req.json(); return c.json({ connection: await service().completeConnection(actor(c), requireProvider(c.req.param("provider")), c.get("jwt"), boundedText(p.code, 20), boundedText(p.state, 200)) });
  });
  routes.post("/:id/sync", async c => { const p = await c.req.json(); const id = requireRequestId(c.req.param("id")); const connection = (await service().list(actor(c))).find(value => value.id === id); if (!connection) throw new IntegrationError("NOT_FOUND", 404); requireProvider(connection.provider); return c.json(await service().syncConnection(actor(c), id, requireRequestId(p.requestId))); });
  routes.get("/:id/resources", async c => { const id = requireRequestId(c.req.param("id")); await requireConnectionProvider(actor(c), id); return c.json({ resources: await service().resources(actor(c), id) }); });
  routes.get("/:id/picker", async c => { requireProvider("google_drive"); return c.json(await service().picker(actor(c), requireRequestId(c.req.param("id")))); });
  routes.post("/:id/resources", async c => { requireProvider("google_drive"); const p = await c.req.json(); return c.json(await service().registerSelectedFiles(actor(c), requireRequestId(c.req.param("id")), validateSelection(p.fileIds), requireRequestId(p.requestId))); });
  routes.post("/:id/import", async c => {
    await requireConnectionProvider(actor(c), requireRequestId(c.req.param("id")));
    const p = await c.req.json(); const input: IntegrationImport = { threadId: requireRequestId(p.threadId), revision: p.revision, resourceIds: validateSelection(p.resourceIds), question: boundedText(p.question, 500), modelConsent: p.modelConsent === true, processingRights: p.processingRights === true, shareRights: p.shareRights === true, requestId: requireRequestId(p.requestId) };
    return c.json(await service().importSources(actor(c), requireRequestId(c.req.param("id")), input));
  });
  for (const action of ["revoke", "purge"] as const) routes.post(`/:id/${action}`, async c => {
    const p = await c.req.json(), id = requireRequestId(c.req.param("id")), requestId = requireRequestId(p.requestId), available = getService();
    if (!available) return c.json(await (deps.disabledManagement ?? manageDisabledConnection)(actor(c), id, action, requestId));
    return c.json(action === "revoke" ? await available.revokeConnection(actor(c), id, requestId) : await available.purgeConnection(actor(c), id, requestId));
  });
  return routes;
}
