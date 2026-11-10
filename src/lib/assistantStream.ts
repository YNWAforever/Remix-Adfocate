import { apiFetch, ApiError, getWorkspaceSlug } from "./api";
import { supabase } from "./supabase";
import type { AssistantReply } from "./queries/kocmax";

export type AssistantStreamHandlers = {
  onDelta?: (text: string) => void;
  onProgress?: (step: string) => void;
  signal?: AbortSignal;
};

type StreamEvent = { event: string; data: string };

function parseBlock(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/**
 * Streams an assistant turn over SSE. Falls back to the JSON endpoint when streaming is
 * unavailable; callers treat a thrown ApiError exactly like `useAssistantChat` failures.
 */
export async function streamAssistantChat(
  body: { message: string; conversation_id?: string; locale?: string; client_request_id?: string },
  handlers: AssistantStreamHandlers = {},
): Promise<AssistantReply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch("/api/assistant/chat/stream", {
    method: "POST",
    signal: handlers.signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Workspace-Slug": getWorkspaceSlug(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
    throw new ApiError(response.status, payload.code ?? "error", payload.error ?? response.statusText, payload);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply: AssistantReply | null = null;
  const consume = (block: string): void => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    const payload = JSON.parse(parsed.data) as Record<string, unknown>;
    if (parsed.event === "delta") handlers.onDelta?.(String(payload.text ?? ""));
    else if (parsed.event === "progress") handlers.onProgress?.(String(payload.step ?? ""));
    else if (parsed.event === "done") reply = payload as AssistantReply;
    else if (parsed.event === "error") throw new ApiError(502, String(payload.code ?? "stream_failed"), "The answer stream failed.");
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) consume(buffer);
  if (!reply) throw new ApiError(502, "stream_incomplete", "The answer stream ended without a result.");
  return reply;
}

/** JSON fallback keeps turns working if the SSE endpoint is unavailable (older deployment or proxy). */
export async function assistantChatWithFallback(
  body: { message: string; conversation_id?: string; locale?: string; client_request_id?: string },
  handlers: AssistantStreamHandlers = {},
): Promise<AssistantReply> {
  try {
    return await streamAssistantChat(body, handlers);
  } catch (error) {
    // Only an absent endpoint falls back; assistant error codes must surface unchanged.
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return apiFetch<AssistantReply>("/assistant/chat", { method: "POST", body: JSON.stringify(body) });
    }
    throw error;
  }
}
