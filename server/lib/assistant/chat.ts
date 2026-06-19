import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, chatComplete, type ChatMessage, type ToolCall } from "../llm.js";
import { retrieveContext } from "./retrieve.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_DEFS, runTool } from "./tools.js";

export interface AssistantProvider {
  embed: (texts: string[]) => Promise<number[][]>;
  chat: (opts: { messages: ChatMessage[]; tools?: typeof TOOL_DEFS }) => Promise<{ content: string | null; toolCalls: ToolCall[] }>;
}
export const liveProvider: AssistantProvider = {
  embed: embedTexts,
  chat: (opts) => chatComplete(opts),
};

export interface Citation { title: string; sourceType: string; sourceRef: string; }
export interface AssistantResult { answer: string; citations: Citation[]; }

interface Deps {
  provider?: AssistantProvider;
  runToolFn?: (name: string, args: string, client: any) => Promise<string>;
  maxIterations?: number;
}

export async function runAssistant(
  client: Pick<SupabaseClient, "rpc" | "from">,
  input: { query: string; locale: string; workspace: string | null; history: ChatMessage[] },
  deps: Deps = {},
): Promise<AssistantResult> {
  const provider = deps.provider ?? liveProvider;
  const runToolFn = deps.runToolFn ?? runTool;
  const maxIterations = deps.maxIterations ?? 4;

  const context = await retrieveContext(client, input, { embed: provider.embed });
  const citations: Citation[] = context.map((c) => ({ title: c.title, sourceType: c.sourceType, sourceRef: c.sourceRef }));

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ locale: input.locale, context }) },
    ...input.history,
    { role: "user", content: input.query },
  ];

  let last = await provider.chat({ messages, tools: TOOL_DEFS });
  let iter = 0;
  while (last.toolCalls.length && iter < maxIterations) {
    iter++;
    messages.push({
      role: "assistant",
      content: last.content ?? "",
      tool_calls: last.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
    });
    for (const call of last.toolCalls) {
      const result = await runToolFn(call.name, call.arguments, client);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    last = await provider.chat({ messages, tools: TOOL_DEFS });
  }

  return { answer: last.content ?? "抱歉，我暫時無法回答這個問題。", citations };
}
