import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { normalizeProposalSections, proposalContentHash, verifyProposalToken } from "../lib/assistant/proposalToken.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function executionEnabled() {
  return process.env.STUDIO_ASSISTANT_PROPOSAL_EXECUTION === "true";
}

function sameOrigin(c: Context<Env>): boolean {
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return false;
  return c.req.header("Sec-Fetch-Site") !== "cross-site";
}

/** Audited, best-effort: a failed audit insert must never surface to the caller. */
async function recordProposal(
  input: { requestId: string; creatorId: string; workspaceId: string; threadId: string; kind: string; outcome: string; durationMs: number },
) {
  try {
    await serviceClient().from("assistant_proposal_audit").insert({
      request_id: input.requestId.slice(0, 200),
      creator_id: input.creatorId,
      workspace_id: input.workspaceId,
      thread_id: input.threadId,
      kind: input.kind,
      outcome: input.outcome,
      duration_ms: Math.max(0, Math.min(120000, Math.round(input.durationMs))),
    });
  } catch {
    /* audit table optional / duplicate request id: execution result still stands */
  }
}

/**
 * A3.2: execute a proposal only when the caller presents the signed token bound to this content.
 * The write goes through the existing studio_command RPC (service-role, like the normal save path),
 * after the signed token and thread ownership are verified with the caller's user-scoped client.
 */
export function studioProposalRoutes() {
  const routes = new Hono<Env>();

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!executionEnabled()) return c.json({ code: "proposal_execution_disabled" }, 404);
    if (c.req.method !== "GET" && !sameOrigin(c)) return c.json({ code: "ORIGIN_DENIED" }, 403);
    await next();
  });

  routes.post("/proposals/execute", async c => {
    const body = await c.req.json().catch(() => null) as { token?: unknown; sections?: unknown } | null;
    if (!body || typeof body.token !== "string") return c.json({ code: "INVALID_PROPOSAL" }, 400);
    const payload = verifyProposalToken(body.token);
    if (!payload) return c.json({ code: "INVALID_PROPOSAL" }, 403);

    const userId = c.get("userId"), workspaceId = c.get("workspaceId");
    if (payload.creatorId !== userId || payload.workspaceId !== workspaceId) return c.json({ code: "PROPOSAL_INVALID" }, 403);
    const sections = normalizeProposalSections(body.sections);
    if (!sections || proposalContentHash(sections) !== payload.contentHash) return c.json({ code: "PROPOSAL_CONTENT_MISMATCH" }, 400);
    if (payload.kind !== "brief" || !payload.threadId || !UUID.test(payload.threadId)) return c.json({ code: "INVALID_PROPOSAL" }, 400);

    const started = Date.now();
    const userClient = makeUserClient(c.get("jwt"));
    const thread = await userClient.from("studio_threads").select("id,revision")
      .eq("id", payload.threadId).eq("creator_id", userId).eq("workspace_id", workspaceId).maybeSingle();
    if (thread.error) return dbError(c, thread.error, "studio_unavailable", 503);
    if (!thread.data) return c.json({ code: "not_found" }, 404);
    const revision = Number((thread.data as { revision?: number }).revision ?? 0);

    const command = await serviceClient().rpc("studio_command", {
      p_workspace: workspaceId,
      p_creator: userId,
      p_request: payload.requestId,
      p_action: "save_brief",
      p_payload: { threadId: payload.threadId, revision, sections },
    });
    const duration = Date.now() - started;

    if (command.error) {
      const code = String(command.error.message);
      const conflict = ["IDEMPOTENCY_CONFLICT", "STALE_BRIEF", "WRONG_STATE", "STALE_THREAD"].includes(code);
      void recordProposal({ requestId: payload.requestId, creatorId: userId, workspaceId, threadId: payload.threadId, kind: payload.kind, outcome: conflict ? "rejected" : "failed", durationMs: duration });
      if (conflict) return c.json({ code }, 409);
      return dbError(c, command.error, "proposal_execution_failed", 503);
    }

    void recordProposal({ requestId: payload.requestId, creatorId: userId, workspaceId, threadId: payload.threadId, kind: payload.kind, outcome: "executed", durationMs: duration });
    return c.json({ ok: true, kind: payload.kind, result: command.data ?? null });
  });

  return routes;
}
