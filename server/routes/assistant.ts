import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat.js";
import { UUID, validateAssistantRequest, withProviderDeadline } from "../lib/assistant/requestPolicy.js";
import type { ChatMessage } from "../lib/llm.js";
import { AssistError, parseAssistContext, type AssistPrincipal } from "../lib/assistant/contextPolicy.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { requireCapability } from "../lib/staffCapabilities.js";
import { authorizeIntegrationSources } from "../lib/integrations/evidence.js";
import { saveToolTrace } from "../lib/studio/toolTraces.js";
import { createMcpRuntime } from "../lib/mcp/client.js";
import { loadMcpRegistry, parseMcpToolName } from "../lib/mcp/policy.js";
import { loadWorkspaceMcpServers, recordMcpCall, runFencedMcpTool } from "../lib/mcp/registry.js";
import { PROPOSAL_TOOL_DEFS } from "../lib/assistant/tools.js";
import { proposalRequestId, signProposalToken } from "../lib/assistant/proposalToken.js";
import { PROVIDER_TIMEOUT_MS } from "../lib/assistant/requestPolicy.js";
import { loadAssistantProgress, recordAssistantProgress } from "../lib/assistant/progress.js";

/** D20 is offline only. No request flag, env variable or configured gateway key enables this provider. */
async function missionAssist(body: unknown, principal: AssistPrincipal, getClient: typeof serviceClient, provider?: AssistantProvider) {
  let requestId: string | undefined;
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AssistError("bad_request", 400);
    const value = body as Record<string, unknown>;
    let input: ReturnType<typeof validateAssistantRequest>;
    try { input = validateAssistantRequest(value); } catch { throw new AssistError("bad_request", 400); }
    requestId = input.requestId;
    if (input.conversationId) throw new AssistError("bad_request", 400);
    const context = parseAssistContext(value.assist_context);
    if (!provider) return { status: 503 as const, body: { code: "assist_disabled", error: "Mission AI is disabled pending provider evaluation. The source checklist remains available.", request_id: requestId, persistence: "not_saved", generation: "not_started" } };
    const result = await withProviderDeadline(signal => runAssistant(getClient(), {
      query: input.message, locale: input.locale, workspace: principal.workspaceId, history: [], assistContext: context,
    }, { provider, principal, signal }));
    return { status: 200 as const, body: { ...result, request_id: requestId, persistence: "not_saved", generation: "completed", provider: "mock" } };
  } catch (error) {
    const known = error instanceof AssistError ? error : new AssistError("provider_outcome_unknown", 503);
    return { status: known.status, body: { code: known.code, error: known.code === "not_found" ? "Context not found for this role. Your input is retained."
      : known.code === "bad_request" ? "Check the context IDs and message. Your input is retained."
        : "Assistance unavailable or outcome unknown. Your input is retained. Do not retry automatically.",
      request_id: requestId, persistence: "not_saved", generation: known.code === "provider_outcome_unknown" ? "unknown" : "not_started" } };
  }
}

function envMcpServers() {
  const registry = loadMcpRegistry();
  if (registry.errors.length) console.info(`[mcp] config: ${registry.errors.slice(0, 3).join("; ").slice(0, 300)}`);
  return registry.servers;
}

/**
 * D0 MCP skills are dark by default and only reachable from studio threads.
 * With STUDIO_MCP_REGISTRY=true the workspace registry is authoritative and only servers the
 * creator has consented to are exposed; when the optional tables are absent we fall back to the
 * env allowlist so phase 1 keeps working.
 */
async function studioMcpRuntime(input: {
  store: ReturnType<typeof serviceClient>;
  creatorId: string;
  workspaceId: string;
  requestId: string;
  signal?: AbortSignal;
}) {
  if (process.env.STUDIO_MCP_ENABLED !== "true") return null;
  let servers = envMcpServers();
  let serverIds: ReadonlyMap<string, string> = new Map();
  if (process.env.STUDIO_MCP_REGISTRY === "true") {
    const registry = await loadWorkspaceMcpServers(input.store, input.workspaceId, input.creatorId);
    if (registry.available) {
      servers = [...registry.servers];
      serverIds = registry.serverIds;
    } else {
      console.info("[mcp] workspace registry unavailable; using the env allowlist");
    }
  }
  if (!servers.length) return null;
  const runtime = createMcpRuntime(servers);
  const defs = await runtime.prepare(input.signal);
  if (!defs.length) return null;
  return {
    defs,
    run: async (name: string, args: string, abort?: AbortSignal) => {
      const started = Date.now();
      const parsed = parseMcpToolName(name);
      const fenced = await runFencedMcpTool(input.store, {
        serverId: parsed ? serverIds.get(parsed.server) : undefined,
        creatorId: input.creatorId,
        workspaceId: input.workspaceId,
      }, () => runtime.run(name, args, abort));
      if (parsed) {
        void recordMcpCall(input.store, {
          requestId: input.requestId,
          serverName: parsed.server,
          toolName: parsed.tool,
          creatorId: input.creatorId,
          workspaceId: input.workspaceId,
          outcome: fenced.outcome,
          durationMs: Date.now() - started,
        });
      }
      return fenced.result;
    },
  };
}

/** Decorates proposals with a signed execution token when the execution flag/key are present. */
export function proposalEnvelope(
  result: { proposals?: Array<{ kind: "brief"; sections: string[] }> },
  input: { threadId: string | null; requestId: string },
  creatorId: string,
  workspaceId: string,
) {
  if (!result.proposals?.length) return {};
  const execution = process.env.STUDIO_ASSISTANT_PROPOSAL_EXECUTION === "true";
  const proposals = result.proposals.map((proposal, index) => {
    const token = execution
      ? signProposalToken({
        kind: "brief",
        threadId: input.threadId,
        creatorId,
        workspaceId,
        requestId: proposalRequestId(input.requestId, index),
        content: proposal.sections,
      })
      : null;
    return token ? { ...proposal, token } : proposal;
  });
  return { proposals };
}

/** Workspace skills the current creator has not consented/connected yet (prompt hint only, best-effort). */
async function loadUnconnectedSkills(store: ReturnType<typeof serviceClient>, workspaceId: string, creatorId: string): Promise<string[]> {
  try {
    const servers = await store.from("mcp_servers").select("id,name,auth_mode").eq("workspace_id", workspaceId).eq("enabled", true).eq("read_only", true);
    if (servers.error) return [];
    const rows = (servers.data ?? []) as Array<{ id: string; name: string; auth_mode?: string | null }>;
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [consents, connections] = await Promise.all([
      store.from("mcp_consents").select("server_id").in("server_id", ids).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null),
      store.from("mcp_oauth_connections").select("server_id").in("server_id", ids).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null),
    ]);
    if (consents.error || connections.error) return [];
    const consented = new Set(((consents.data ?? []) as Array<{ server_id: string }>).map(row => row.server_id));
    const connected = new Set(((connections.data ?? []) as Array<{ server_id: string }>).map(row => row.server_id));
    return rows.filter(row => !consented.has(row.id) || (row.auth_mode === "oauth" && !connected.has(row.id))).map(row => row.name).slice(0, 5);
  } catch {
    return [];
  }
}

/** Mounted behind the existing staff identity, single membership and submission.review gates. */
export function staffMissionAssistRoutes(testProvider?: AssistantProvider) {
  const r = new Hono<AdminEnv>();
  r.post("/assistant/mission-assist", async c => {
    const scope = c.get("authorizedWorkspace");
    const access = await requireCapability(serviceClient(), scope, "submission.review");
    const result = await missionAssist(await c.req.json().catch(() => null), { workspaceId: scope.workspaceId, userId: scope.userId, role: access.role }, serviceClient, testProvider);
    return c.json(result.body, result.status);
  });
  return r;
}

/** Provider remains injectable. The shared DB request record is claimed before any provider call. */
export function assistantRoutes(testProvider?: AssistantProvider) {
  const r = new Hono<Env>();
  r.post("/mission-assist", async c => {
    const result = await missionAssist(await c.req.json().catch(() => null), { workspaceId: c.get("workspaceId"), userId: c.get("userId"), role: "creator" }, () => makeUserClient(c.get("jwt")), testProvider);
    return c.json(result.body, result.status);
  });
  type ChatOutcome = { status: number; body: unknown };
  type ChatEmit = (event: { type: "delta"; text: string } | { type: "progress"; step: string }) => void | Promise<void>;

  async function handleAssistantChat(c: Context<Env>, emit?: ChatEmit): Promise<ChatOutcome> {
    const done = (body: unknown, status = 200): ChatOutcome => ({ status, body });
    // A disconnected SSE client must not abort generation or persistence.
    const sendEvent: ChatEmit | undefined = emit ? async (event) => { try { await emit(event); } catch { /* client gone */ } } : undefined;
    let input: ReturnType<typeof validateAssistantRequest>;
    try { input = validateAssistantRequest(await c.req.json()); }
    catch { return done({ error: "Use a request UUID and a message of at most 4000 Unicode characters", code: "bad_request" }, 400); }
    const client = makeUserClient(c.get("jwt"));
    const store = serviceClient();
    const workspaceId = c.get("workspaceId");
    let studio: Awaited<ReturnType<typeof import("../lib/studio/assistantContext.js").loadStudioContext>>;
    if (input.conversationId) {
      try {
        if (process.env.STUDIO_THREADS === "true") {
          studio = await (await import("../lib/studio/assistantContext.js")).loadStudioContext(store,client,c.get("userId"),workspaceId,input.conversationId);
        } else {
          // Disabling Studio must not reclassify its retained private history as general chat.
          // Classify before reading history, reserving a request or calling any model.
          const thread = await store.from("studio_threads").select("id").eq("conversation_id",input.conversationId)
            .eq("creator_id",c.get("userId")).eq("workspace_id",workspaceId).maybeSingle();
          if (thread.error) throw new Error("studio_unavailable");
          if (thread.data) return done({ code:"studio_disabled", error:"Studio assistance is disabled. Your input is retained.",
            request_id:input.requestId, persistence:"not_saved", generation:"not_started" },503);
        }
      }
      catch { return done({code:"studio_unavailable",error:"Studio context or history unavailable"},503); }
    }
    const identity = { p_workspace: workspaceId, p_creator: c.get("userId"), p_request: input.requestId };
    const reportProgress = (step: string) => {
      void recordAssistantProgress(store, { requestId: input.requestId, creatorId: c.get("userId"), workspaceId, step });
      if (sendEvent) void sendEvent({ type: "progress", step });
    };
    const reserved = await store.rpc("reserve_assistant_request", { ...identity, p_message: input.message,
      p_locale: input.locale, p_conversation: input.conversationId ?? null, p_context_version: studio?.contextVersion ?? "r1" });
    if (reserved.error) {
      const code = reserved.error.message;
      if(studio && code === "IDEMPOTENCY_CONFLICT") {
        const recovered=await store.rpc("resolve_studio_request_context",{...identity,p_message:input.message,p_locale:input.locale,p_conversation:input.conversationId,p_context_version:studio.contextVersion});
        if(!recovered.error && recovered.data) return done(recovered.data);
      }
      if (["RATE_LIMITED", "REQUEST_INFLIGHT"].includes(code)) return done({ error: "Please wait before retrying this request", code }, 429);
      if (code === "IDEMPOTENCY_CONFLICT") return done({ error: "Request payload changed; compare the existing request", code }, 409);
      if (code === "not_found" || code === "FORBIDDEN") return done({ error: "Conversation not found", code: "not_found" }, 404);
      return done({ error: "Assistant request storage unavailable", code: "request_store_unavailable", request_id: input.requestId, persistence: "unknown" }, 503);
    }
    if (reserved.data?.action === "replay") return done(reserved.data.result);
    if (reserved.data?.action !== "reserved") return done({ request_id: input.requestId, persistence: "unknown", code: "request_pending" }, 202);

    let history: ChatMessage[] = studio?.history ?? [];
    if (input.conversationId && !studio) {
      const prior = await client.from("assistant_messages").select("role, content")
        .eq("conversation_id", input.conversationId).order("created_at", { ascending: false })
        .order("turn_order", { ascending: false }).limit(20);
      if (prior.error) return done({ error: "Conversation history unavailable; your input is retained", code: "history_unavailable", request_id: input.requestId, persistence: "failed" }, 503);
      history = (prior.data ?? []).filter((m) => m.role === "user" || m.role === "assistant").reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    }
    const claimed = await store.rpc("claim_assistant_request", identity);
    if (claimed.error || claimed.data !== true) return done({ request_id: input.requestId, persistence: "unknown", code: "request_pending" }, 202);
    const markUnknown = async () => { try { await store.rpc("mark_assistant_request_unknown", identity); } catch { /* Outcome remains unknown; never regenerate automatically. */ } };
    let result;
    try {
      if(studio?.integrationSources?.length) await authorizeIntegrationSources({creatorId:c.get("userId"),workspaceId},studio.integrationSources,"model",{requestId:input.requestId});
      const unconnectedSkills = studio ? await loadUnconnectedSkills(store, workspaceId, c.get("userId")) : [];
      result = await withProviderDeadline(async (signal) => {
        if (studio) reportProgress("skills");
        const mcp = studio ? await studioMcpRuntime({ store, creatorId: c.get("userId"), workspaceId, requestId: input.requestId, signal }) : null;
        const proposalDefs = studio && process.env.STUDIO_ASSISTANT_PROPOSALS === "true" ? PROPOSAL_TOOL_DEFS : [];
        return runAssistant(client,
          { query: input.message, locale: input.locale, workspace: workspaceId, history, studioContext:studio?.context, historyChanged: studio?.contextChanged, unconnectedSkills },
          {
            ...(testProvider ? { provider: testProvider } : {}),
            signal,
            onProgress: reportProgress,
            ...(sendEvent ? { onDelta: (text: string) => sendEvent({ type: "delta", text }) } : {}),
            softStopAt: Date.now() + PROVIDER_TIMEOUT_MS - 15000,
            ...(mcp || proposalDefs.length ? { studioToolDefs: [...(mcp?.defs ?? []), ...proposalDefs], ...(mcp ? { runStudioTool: (name: string, args: string, abort?: AbortSignal) => mcp.run(name, args, abort) } : {}) } : {}),
          });
      });
    } catch {
      await markUnknown();
      return done({ error: "Generation outcome is unknown. Check this request before starting another", code: "provider_outcome_unknown", request_id: input.requestId, persistence: "unknown" }, 503);
    }
    try {
      if(studio?.integrationSources?.length) {
        await authorizeIntegrationSources({creatorId:c.get("userId"),workspaceId},studio.integrationSources,"read");
        const current = await (await import("../lib/studio/assistantContext.js")).loadStudioContext(store,client,c.get("userId"),workspaceId,input.conversationId!);
        if(current?.contextVersion !== studio.contextVersion) {
          await markUnknown();return done({code:"studio_context_changed",persistence:"failed",generation:"completed_discarded",request_id:input.requestId,error:"來源已變更，已停止保存回覆。輸入仍保留。"},409);
        }
      }
      const saved = await store.rpc("save_assistant_turn", { ...identity, p_answer: result.answer, p_citations: result.citations });
      if (!saved.error && saved.data?.persistence === "saved") {
        await saveToolTrace(store, saved.data.conversation_id ?? input.conversationId, result.answer, result.toolsUsed, input.requestId);
        return done({ ...saved.data, ...(result.toolsUsed?.length ? { tools_used: result.toolsUsed } : {}), ...(result.limitations?.length ? { limitations: result.limitations } : {}), ...proposalEnvelope(result, { threadId: studio?.threadId ?? null, requestId: input.requestId }, c.get("userId"), workspaceId) });
      }
      await markUnknown();
      if(studio?.integrationSources?.length) return done({code:"studio_context_changed",persistence:"failed",request_id:input.requestId,error:"來源或儲存權限已變更，已停止返回衍生回覆。"},409);
      return done({ ...result, conversation_id: input.conversationId ?? null, request_id: input.requestId,
        ...(result.toolsUsed?.length ? { tools_used: result.toolsUsed } : {}),
        ...proposalEnvelope(result, { threadId: studio?.threadId ?? null, requestId: input.requestId }, c.get("userId"), workspaceId),
        persistence: saved.error?.code && /^(22|23|P0)/.test(saved.error.code) ? "failed" : "unknown" });
    } catch {
      await markUnknown();
      if(studio?.integrationSources?.length) return done({code:"studio_context_changed",persistence:"failed",request_id:input.requestId,error:"來源權限尚未確認；沒有保存或返回衍生回覆。"},409);
      return done({ ...result, conversation_id: input.conversationId ?? null, request_id: input.requestId, ...(result.toolsUsed?.length ? { tools_used: result.toolsUsed } : {}), ...proposalEnvelope(result, { threadId: studio?.threadId ?? null, requestId: input.requestId }, c.get("userId"), workspaceId), persistence: "unknown" });
    }
  }


  r.post("/chat", async (c) => {
    const out = await handleAssistantChat(c);
    return c.json(out.body as never, out.status as never);
  });

  // SSE: progress events and answer deltas while generating; the final event is the same payload as /chat.
  r.post("/chat/stream", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      try {
        const out = await handleAssistantChat(c, async (event) => {
          if (event.type === "delta") await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
          else await stream.writeSSE({ event: "progress", data: JSON.stringify({ step: event.step }) });
        });
        await stream.writeSSE({ event: "done", data: JSON.stringify(out.body) });
      } catch {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ code: "stream_failed" }) });
      }
    });
  });

  r.get("/progress/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "Invalid request", code: "bad_request" }, 400);
    const steps = await loadAssistantProgress(serviceClient(), id, c.get("userId"), c.get("workspaceId"));
    return c.json({ steps });
  });
  r.get("/requests/:id", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.json({ error: "Invalid request", code: "bad_request" }, 400);
    const result = await makeUserClient(c.get("jwt")).rpc("get_assistant_request", { p_workspace: c.get("workspaceId"), p_request: c.req.param("id") });
    if (result.error) return c.json({ error: "Request status unavailable", code: "request_store_unavailable" }, 503);
    if (!result.data) return c.json({ error: "Not found", code: "not_found" }, 404);
    return c.json(result.data);
  });
  r.get("/conversations", async (c) => {
    const { data, error } = await makeUserClient(c.get("jwt")).from("assistant_conversations")
      .select("id, started_at, last_message_at").eq("creator_id", c.get("userId")).eq("workspace", c.get("workspaceId"))
      .order("last_message_at", { ascending: false });
    if (error) return c.json({ error: "Conversation history unavailable", code: "history_unavailable" }, 503);
    return c.json({ conversations: data ?? [] });
  });
  return r;
}
