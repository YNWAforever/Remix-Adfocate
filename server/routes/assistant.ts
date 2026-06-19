import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat.js";
import type { ChatMessage } from "../lib/llm.js";

/** Provider is injectable so integration tests can stub the LLM (no live gateway in CI). */
export function assistantRoutes(testProvider?: AssistantProvider) {
  const r = new Hono<Env>();

  /** POST /api/assistant/chat — send a message, get an answer + persist the turn. */
  r.post("/chat", async (c) => {
    const body = await c.req.json<{ message: string; conversation_id?: string; locale?: string }>();
    if (!body.message?.trim()) {
      return c.json({ error: "message required", code: "bad_request" }, 400);
    }

    const supabase = makeUserClient(c.get("jwt"));
    const creatorId = c.get("userId");
    const workspaceId = c.get("workspaceId");
    const locale = body.locale ?? "zh-HK";

    // Resolve / create conversation (RLS guarantees ownership).
    let conversationId = body.conversation_id;
    if (!conversationId) {
      const { data, error } = await supabase
        .from("assistant_conversations")
        .insert({ creator_id: creatorId, workspace: workspaceId })
        .select("id")
        .single();
      if (error || !data) {
        return c.json({ error: "could not start conversation", code: "db_error" }, 500);
      }
      conversationId = data.id as string;
    } else {
      // Verify the supplied conversation belongs to this creator (RLS scopes the read);
      // 404 on miss avoids leaking the existence of another creator's conversation.
      const { data: owned } = await supabase
        .from("assistant_conversations")
        .select("id")
        .eq("id", conversationId)
        .maybeSingle();
      if (!owned) return c.json({ error: "conversation not found", code: "not_found" }, 404);
    }

    // Load the most recent turns as history (cap to bound the LLM context). Fetched
    // newest-first then reversed to chronological order. An empty history on a DB
    // error is acceptable degradation — the answer just lacks prior context.
    const { data: prior } = await supabase
      .from("assistant_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(20);

    const history: ChatMessage[] = (prior ?? [])
      .filter((m: { role: string; content: string }) => m.role === "user" || m.role === "assistant")
      .reverse()
      .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));

    let result;
    try {
      result = await runAssistant(
        supabase,
        { query: body.message, locale, workspace: workspaceId, history },
        testProvider ? { provider: testProvider } : {},
      );
    } catch {
      return c.json({ error: "assistant unavailable", code: "assistant_unavailable" }, 503);
    }

    await supabase.from("assistant_messages").insert([
      { conversation_id: conversationId, role: "user", content: body.message },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: result.answer,
        citations: result.citations,
      },
    ]);
    await supabase
      .from("assistant_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    return c.json({
      conversation_id: conversationId,
      answer: result.answer,
      citations: result.citations,
    });
  });

  /** GET /api/assistant/conversations — list this creator's conversations (newest first). */
  r.get("/conversations", async (c) => {
    const supabase = makeUserClient(c.get("jwt"));
    const { data } = await supabase
      .from("assistant_conversations")
      .select("id, started_at, last_message_at")
      .order("last_message_at", { ascending: false });
    return c.json({ conversations: data ?? [] });
  });

  return r;
}
