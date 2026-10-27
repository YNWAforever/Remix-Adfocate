import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "../llm.js";
import type { ContextChunk } from "./prompt.js";

export interface RetrievedChunk extends ContextChunk {
  chunkId: string; documentId: string; sourceType: string; sourceRef: string; similarity: number;
}
interface Deps { embed?: (texts: string[]) => Promise<number[][]>; k?: number; minSimilarity?: number; }

/** Embedded assistance uses an already authorized, bounded projection; never global KB/embeddings. */
export function retrieveAssistContext(context: import("./contextPolicy.js").AuthorizedAssistContext): RetrievedChunk[] {
  return context.chunks;
}

export async function retrieveContext(
  client: Pick<SupabaseClient, "rpc">,
  input: { query: string; locale: string; workspace: string | null },
  deps: Deps = {},
): Promise<RetrievedChunk[]> {
  const embed = deps.embed ?? embedTexts;
  const k = deps.k ?? 5;
  const minSimilarity = deps.minSimilarity ?? 0.2;
  let queryEmbedding: number[];
  try {
    [queryEmbedding] = await embed([input.query]);
  } catch {
    return []; // gateway down → no context; the model is told it lacks info
  }
  const { data, error } = await client.rpc("match_kb_chunks", {
    query_embedding: queryEmbedding,
    match_count: k,
    filter_locale: input.locale,
    filter_workspace: input.workspace,
  });
  if (error || !data) return [];
  return (data as Array<{ chunk_id: string; document_id: string; title: string; source_type: string; source_ref: string; content: string; similarity: number }>)
    .map((r) => ({
      chunkId: r.chunk_id, documentId: r.document_id, title: r.title,
      sourceType: r.source_type, sourceRef: r.source_ref, content: r.content,
      similarity: r.similarity,
    }))
    .filter((r) => r.similarity >= minSimilarity);
}
