import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, chatComplete, type ChatMessage, type ToolCall } from "../llm.js";
import { retrieveContext, retrieveAssistContext } from "./retrieve.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_DEFS, runTool } from "./tools.js";
import { AssistError, authorizeAssistContext, type AssistPrincipal } from "./contextPolicy.js";
import type { AssistBasisVersion } from "../../../src/lib/missionAssist.js";

export interface AssistantProvider {
  embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  chat: (opts: { messages: ChatMessage[]; tools?: typeof TOOL_DEFS; signal?: AbortSignal }) => Promise<{ content: string | null; toolCalls: ToolCall[] }>;
}
export const liveProvider: AssistantProvider = {
  embed: embedTexts,
  chat: (opts) => chatComplete(opts),
};

export interface Citation { title: string; sourceType: string; sourceRef: string; }
export interface AssistantResult { answer: string; citations: Citation[]; basisVersion?: AssistBasisVersion; limitations?: string[]; }

interface Deps {
  signal?: AbortSignal;
  provider?: AssistantProvider;
  runToolFn?: (name: string, args: string, client: Pick<SupabaseClient, "rpc" | "from">) => Promise<string>;
  maxIterations?: number;
  principal?: AssistPrincipal;
}

export async function runAssistant(
  client: Pick<SupabaseClient, "rpc" | "from">,
  input: { query: string; locale: string; workspace: string | null; history: ChatMessage[]; assistContext?: unknown },
  deps: Deps = {},
): Promise<AssistantResult> {
  if (input.assistContext !== undefined) {
    // No live-provider path for D20, including when a gateway key exists.
    // Only server dependency injection can supply the offline evaluation provider.
    if (!deps.provider || deps.provider === liveProvider) throw new AssistError("assist_disabled", 503);
    if (!deps.principal || input.workspace !== deps.principal.workspaceId) throw new AssistError("not_found", 404);
    const scoped = await authorizeAssistContext(client, input.assistContext, deps.principal);
    const context = retrieveAssistContext(scoped);
    const fallback = (reason: string): AssistantResult => ({
      answer: input.locale === "en" ? "I do not have that information. Check the source requirements and ask the reviewer."
        : "我不知道這項資料。請核對原有要求，並向審稿人確認。",
      citations: [], basisVersion: scoped.basisVersion, limitations: [...scoped.limitations, reason],
    });
    if (!scoped.hasContent) return fallback("insufficient_context");
    deps.signal?.throwIfAborted();
    let reply;
    try {
      reply = await deps.provider.chat({ tools: [], signal: deps.signal, messages: [
        { role: "system", content: buildSystemPrompt({ locale: input.locale, context, assist: { mode: scoped.context.mode, basisVersion: scoped.basisVersion } }) },
        // Never mix general-chat history or another mission's answer into this context.
        { role: "user", content: input.query },
      ] });
      deps.signal?.throwIfAborted();
    } catch { throw new AssistError("provider_outcome_unknown", 503); }
    if (!reply || !Array.isArray(reply.toolCalls)) return fallback("invalid_provider_result");
    if (reply.toolCalls.length) return fallback("tool_request_denied");
    let data;
    try { data = JSON.parse(reply.content ?? ""); } catch { return fallback("invalid_provider_result"); }
    if (data?.answerability === "unknown") return fallback("unknown_answer");
    if (data?.answerability !== "supported" || typeof data.answer !== "string" || !data.answer.trim()
      || data.answer.length > 6000 || !Array.isArray(data.sourceRefs) || !data.sourceRefs.length
      || data.sourceRefs.some((ref: unknown) => typeof ref !== "string" || !context.some(c => c.sourceRef === ref))) return fallback("invalid_provider_result");
    const citations = context.filter(c => data.sourceRefs.includes(c.sourceRef)).map(c => ({ title: c.title, sourceType: c.sourceType, sourceRef: c.sourceRef }));
    return { answer: data.answer, citations, basisVersion: scoped.basisVersion, limitations: scoped.limitations };
  }
  const provider = deps.provider ?? liveProvider;
  const runToolFn = deps.runToolFn ?? runTool;
  const maxIterations = deps.maxIterations ?? 4;

  deps.signal?.throwIfAborted();
  const context = await retrieveContext(client, input, { embed: (texts) => provider.embed(texts, deps.signal) });
  deps.signal?.throwIfAborted();
  const citations: Citation[] = context.map((c) => ({ title: c.title, sourceType: c.sourceType, sourceRef: c.sourceRef }));

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ locale: input.locale, context }) },
    ...input.history,
    { role: "user", content: input.query },
  ];

  let last = await provider.chat({ messages, tools: TOOL_DEFS, signal: deps.signal });
  deps.signal?.throwIfAborted();
  let iter = 0;
  while (last.toolCalls.length && iter < maxIterations) {
    iter++;
    messages.push({
      role: "assistant",
      content: last.content ?? "",
      tool_calls: last.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
    });
    for (const call of last.toolCalls) {
      deps.signal?.throwIfAborted();
      const result = await runToolFn(call.name, call.arguments, client);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    deps.signal?.throwIfAborted();
    last = await provider.chat({ messages, tools: TOOL_DEFS, signal: deps.signal });
    deps.signal?.throwIfAborted();
  }

  return { answer: last.content ?? "抱歉，我暫時無法回答這個問題。", citations };
}
