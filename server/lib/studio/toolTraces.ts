import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Store = Pick<SupabaseClient, "from">;

/** Stable fingerprint of a saved answer, used to attach its tool trace. */
export function answerFingerprint(answer: string): string {
  return createHash("sha256").update(answer).digest("hex");
}

/**
 * Best-effort persistence for the read-only tool traces behind an answer.
 * The table only exists after the optional SQL in docs/operations/assistant-tool-traces.sql is
 * applied; until then the chat keeps working with per-turn traces only and nothing is lost.
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

export type ToolTraceDetail = { tool: string; server: string | null; outcome: string | null; duration_ms: number | null };
export type ToolTrace = { tools: string[]; details: ToolTraceDetail[] };

type AuditRow = { request_id?: unknown; tool_name?: unknown; server_name?: unknown; outcome?: unknown; duration_ms?: unknown };
type TraceRow = { answer_hash?: unknown; tools?: unknown; request_id?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Maps tool names to their audit rows without exposing payloads or account data. */
export function describeTools(tools: string[], audits: AuditRow[]): ToolTraceDetail[] {
  return tools.map(tool => {
    const parts = tool.split("__");
    const namespaced = tool.startsWith("mcp__") && parts.length >= 3;
    const server = namespaced ? parts[1] : null;
    const bare = namespaced ? parts.slice(2).join("__") : tool;
    const audit = [...audits].reverse().find(item => typeof item.tool_name === "string"
      && (namespaced ? item.server_name === server && item.tool_name === bare : item.tool_name === bare));
    return {
      tool,
      server,
      outcome: typeof audit?.outcome === "string" ? audit.outcome : null,
      duration_ms: typeof audit?.duration_ms === "number" ? audit.duration_ms : null,
    };
  });
}

/** The current request's tool outcomes, for the unsaved live reply. */
export async function readRequestToolDetails(store: Store, requestId: string, tools: string[]): Promise<ToolTraceDetail[]> {
  if (!tools.length) return [];
  try {
    const { data, error } = await store.from("mcp_call_audit")
      .select("request_id,tool_name,server_name,outcome,duration_ms")
      .eq("request_id", requestId);
    return describeTools(tools, error ? [] : (data ?? []) as AuditRow[]);
  } catch {
    return describeTools(tools, []);
  }
}

/**
 * Reads saved traces for one conversation, keyed by answer fingerprint. Each tool is annotated
 * with the MCP server and audit outcome from mcp_call_audit (never payloads or account data).
 */
export async function readToolTraces(store: Store, conversationId: string): Promise<Map<string, ToolTrace>> {
  const traces = new Map<string, ToolTrace>();
  try {
    const { data, error } = await store
      .from("assistant_tool_traces")
      .select("tools,answer_hash,request_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return traces;
    const rows = (data ?? []) as TraceRow[];
    const requestIds = [...new Set(rows.map(row => row.request_id).filter((id): id is string => typeof id === "string" && UUID.test(id)))];
    const auditsByRequest = new Map<string, AuditRow[]>();
    if (requestIds.length) {
      const audit = await store.from("mcp_call_audit")
        .select("request_id,tool_name,server_name,outcome,duration_ms")
        .in("request_id", requestIds);
      if (!audit.error) {
        for (const row of (audit.data ?? []) as AuditRow[]) {
          if (typeof row.request_id !== "string") continue;
          const list = auditsByRequest.get(row.request_id) ?? [];
          list.push(row);
          auditsByRequest.set(row.request_id, list);
        }
      }
    }
    for (const row of rows) {
      const hash = row.answer_hash;
      if (typeof hash !== "string" || !Array.isArray(row.tools)) continue;
      const tools = row.tools.filter((tool): tool is string => typeof tool === "string");
      if (!tools.length) continue;
      const audits = typeof row.request_id === "string" ? auditsByRequest.get(row.request_id) ?? [] : [];
      const details = describeTools(tools, audits);
      traces.set(hash, { tools, details });
    }
  } catch {
    /* Migration not applied yet: no persisted traces to show. */
  }
  return traces;
}
