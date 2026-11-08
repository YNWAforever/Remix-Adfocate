import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat.js";
import { UUID, validateAssistantRequest, withProviderDeadline } from "../lib/assistant/requestPolicy.js";
import type { ChatMessage } from "../lib/llm.js";
import { AssistError, parseAssistContext, type AssistPrincipal } from "../lib/assistant/contextPolicy.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { requireCapability } from "../lib/staffCapabilities.js";
import { authorizeIntegrationSources } from "../lib/integrations/evidence.js";

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
  r.post("/chat", async (c) => {
    let input: ReturnType<typeof validateAssistantRequest>;
    try { input = validateAssistantRequest(await c.req.json()); }
    catch { return c.json({ error: "Use a request UUID and a message of at most 4000 Unicode characters", code: "bad_request" }, 400); }
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
          if (thread.data) return c.json({ code:"studio_disabled", error:"Studio assistance is disabled. Your input is retained.",
            request_id:input.requestId, persistence:"not_saved", generation:"not_started" },503);
        }
      }
      catch { return c.json({code:"studio_unavailable",error:"Studio context or history unavailable"},503); }
    }
    const identity = { p_workspace: workspaceId, p_creator: c.get("userId"), p_request: input.requestId };
    const reserved = await store.rpc("reserve_assistant_request", { ...identity, p_message: input.message,
      p_locale: input.locale, p_conversation: input.conversationId ?? null, p_context_version: studio?.contextVersion ?? "r1" });
    if (reserved.error) {
      const code = reserved.error.message;
      if(studio && code === "IDEMPOTENCY_CONFLICT") {
        const recovered=await store.rpc("resolve_studio_request_context",{...identity,p_message:input.message,p_locale:input.locale,p_conversation:input.conversationId,p_context_version:studio.contextVersion});
        if(!recovered.error && recovered.data) return c.json(recovered.data);
      }
      if (["RATE_LIMITED", "REQUEST_INFLIGHT"].includes(code)) return c.json({ error: "Please wait before retrying this request", code }, 429);
      if (code === "IDEMPOTENCY_CONFLICT") return c.json({ error: "Request payload changed; compare the existing request", code }, 409);
      if (code === "not_found" || code === "FORBIDDEN") return c.json({ error: "Conversation not found", code: "not_found" }, 404);
      return c.json({ error: "Assistant request storage unavailable", code: "request_store_unavailable", request_id: input.requestId, persistence: "unknown" }, 503);
    }
    if (reserved.data?.action === "replay") return c.json(reserved.data.result);
    if (reserved.data?.action !== "reserved") return c.json({ request_id: input.requestId, persistence: "unknown", code: "request_pending" }, 202);

    let history: ChatMessage[] = studio?.history ?? [];
    if (input.conversationId && !studio) {
      const prior = await client.from("assistant_messages").select("role, content")
        .eq("conversation_id", input.conversationId).order("created_at", { ascending: false })
        .order("turn_order", { ascending: false }).limit(20);
      if (prior.error) return c.json({ error: "Conversation history unavailable; your input is retained", code: "history_unavailable", request_id: input.requestId, persistence: "failed" }, 503);
      history = (prior.data ?? []).filter((m) => m.role === "user" || m.role === "assistant").reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    }
    const claimed = await store.rpc("claim_assistant_request", identity);
    if (claimed.error || claimed.data !== true) return c.json({ request_id: input.requestId, persistence: "unknown", code: "request_pending" }, 202);
    const markUnknown = async () => { try { await store.rpc("mark_assistant_request_unknown", identity); } catch { /* Outcome remains unknown; never regenerate automatically. */ } };
    let result;
    try {
      if(studio?.integrationSources?.length) await authorizeIntegrationSources({creatorId:c.get("userId"),workspaceId},studio.integrationSources,"model",{requestId:input.requestId});
      result = await withProviderDeadline((signal) => runAssistant(client,
        { query: input.message, locale: input.locale, workspace: workspaceId, history, studioContext:studio?.context },
        { ...(testProvider ? { provider: testProvider } : {}), signal }));
    } catch {
      await markUnknown();
      return c.json({ error: "Generation outcome is unknown. Check this request before starting another", code: "provider_outcome_unknown", request_id: input.requestId, persistence: "unknown" }, 503);
    }
    try {
      if(studio?.integrationSources?.length) {
        await authorizeIntegrationSources({creatorId:c.get("userId"),workspaceId},studio.integrationSources,"read");
        const current = await (await import("../lib/studio/assistantContext.js")).loadStudioContext(store,client,c.get("userId"),workspaceId,input.conversationId!);
        if(current?.contextVersion !== studio.contextVersion) {
          await markUnknown();return c.json({code:"studio_context_changed",persistence:"failed",generation:"completed_discarded",request_id:input.requestId,error:"來源已變更，已停止保存回覆。輸入仍保留。"},409);
        }
      }
      const saved = await store.rpc("save_assistant_turn", { ...identity, p_answer: result.answer, p_citations: result.citations });
      if (!saved.error && saved.data?.persistence === "saved") return c.json(saved.data);
      await markUnknown();
      if(studio?.integrationSources?.length) return c.json({code:"studio_context_changed",persistence:"failed",request_id:input.requestId,error:"來源或儲存權限已變更，已停止返回衍生回覆。"},409);
      return c.json({ ...result, conversation_id: input.conversationId ?? null, request_id: input.requestId,
        persistence: saved.error?.code && /^(22|23|P0)/.test(saved.error.code) ? "failed" : "unknown" });
    } catch {
      await markUnknown();
      if(studio?.integrationSources?.length) return c.json({code:"studio_context_changed",persistence:"failed",request_id:input.requestId,error:"來源權限尚未確認；沒有保存或返回衍生回覆。"},409);
      return c.json({ ...result, conversation_id: input.conversationId ?? null, request_id: input.requestId, persistence: "unknown" });
    }
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
