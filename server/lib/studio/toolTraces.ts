import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Store = Pick<SupabaseClient, "from">;

/** Stable fingerprint of a saved answer, used to attach its tool trace. */
export function answerFingerprint(answer: string): string {
  return createHash("sha256").update(answer).digest("hex");
}

/**
 * Best-effort persistence for the read-only tool traces behind an answer.
 * The table only exists after the optional tool-trace migration is applied; until then the
 * chat keeps working with per-turn traces only and nothing is lost.
 */
export async function saveToolTrace(
  store: Store,
  conversationId: string | null | undefined,
  answer: string,
  tools: string[] | undefined,
  requestId: string,
): Promise<void> {
  if (!conversationId || !tools?.length) return;
  try {
    await store.from("assistant_tool_traces").upsert({
      request_id: requestId,
      conversation_id: conversationId,
      answer_hash: answerFingerprint(answer),
      tools,
      created_at: new Date().toISOString(),
    }, { onConflict: "request_id" });
  } catch {
    /* Migration not applied yet: traces stay per-turn. */
  }
}

/** Reads saved traces for one conversation, keyed by answer fingerprint. */
export async function readToolTraces(store: Store, conversationId: string): Promise<Map<string, string[]>> {
  const traces = new Map<string, string[]>();
  try {
    const { data, error } = await store
      .from("assistant_tool_traces")
      .select("tools,answer_hash")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return traces;
    for (const row of data ?? []) {
      const hash = (row as { answer_hash?: unknown }).answer_hash;
      const tools = (row as { tools?: unknown }).tools;
      if (typeof hash !== "string" || !Array.isArray(tools)) continue;
      traces.set(hash, tools.filter((tool): tool is string => typeof tool === "string"));
    }
  } catch {
    /* Migration not applied yet: no persisted traces to show. */
  }
  return traces;
}
