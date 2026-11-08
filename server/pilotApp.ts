import { Hono } from "hono";
import type { createPilotRuntime, PilotActor } from "./lib/integrations/pilotRuntime.js";

export type PilotAppDependencies = {
  origin?: string;
  getRuntime?: () => ReturnType<typeof createPilotRuntime> | null;
  /** Trusted host composition: verify JWT, current session and current membership after target admission. */
  authenticate?: (request: Request) => Promise<PilotActor | null>;
  /** Host must bind this to the same admitted isolated DB; no ambient production client. */
  dispatch?: (request: Request) => Response | Promise<Response>;
};
const publicReadiness = () => ({ stage: "D1", externalAccess: false, providerStates: { instagram: "disabled", google_drive: "disabled" } });
// Exact reviewed operations only. New routes stay closed until separately reviewed.
// Management must be composed with the outbound-disabled implementation on the
// admitted isolated DB; this module installs no dispatcher or ambient client.
const permitted = (method: string, path: string) =>
  (method === "GET" && /^\/api\/(?:missions|me\/integrations)\/?$/.test(path))
  || (method === "POST" && /^\/api\/me\/integrations\/[A-Za-z0-9_-]+\/(?:revoke|purge)$/.test(path));

/** Separate pilot surface. No default DB, Auth, OAuth, model or application client is constructed. */
export function createPilotApp(deps: PilotAppDependencies = {}) {
  const app = new Hono().basePath("/api");
  app.onError((_error, c) => c.json({ code: "PILOT_UNAVAILABLE", error: "試點暫未就緒，原有草稿仍保留。" }, 503));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store"); c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff"); c.header("X-Robots-Tag", "noindex, nofollow");
    await next();
  });
  app.get("/health", c => c.json({ ok: true, ...publicReadiness() }));
  app.get("/integration-pilot/readiness", c => c.json(publicReadiness()));
  app.all("*", async c => {
    // D1 has no callback exchange or provider operation, even when a host passes a runtime.
    if (!permitted(c.req.method, c.req.path)) {
      return c.json({ code: "D1_EXTERNAL_ACCESS_DISABLED", ...publicReadiness() }, 503);
    }
    const runtime = deps.getRuntime?.();
    if (!runtime?.admission().admitted || !deps.origin || !deps.authenticate || !deps.dispatch) return c.json({ code: "PILOT_TARGET_NOT_VERIFIED" }, 503);
    if (deps.origin !== runtime.approvedOrigin || new URL(c.req.url).origin !== runtime.approvedOrigin) return c.json({ code: "ORIGIN_DENIED" }, 403);
    if (!["GET", "HEAD"].includes(c.req.method)
      && ((c.req.header("Origin") && c.req.header("Origin") !== deps.origin) || c.req.header("Sec-Fetch-Site") === "cross-site")) return c.json({ code: "ORIGIN_DENIED" }, 403);
    const identity = await deps.authenticate(c.req.raw);
    if (!runtime.admission().admitted) return c.json({ code: "PILOT_TARGET_NOT_VERIFIED" }, 503);
    if (!identity) return c.json({ code: "no_auth" }, 401);
    try { runtime.authorizeActor({ creatorId: identity.creatorId, workspaceId: identity.workspaceId }, identity.subject); }
    catch { return c.json({ code: "PILOT_ACTOR_DENIED" }, 403); }
    return deps.dispatch(c.req.raw);
  });
  return app;
}
