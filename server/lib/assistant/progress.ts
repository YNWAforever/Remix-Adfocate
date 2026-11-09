import type { SupabaseClient } from "@supabase/supabase-js";

type Store = Pick<SupabaseClient, "from">;

export type AssistantProgressStep = { step: string; created_at: string };

/** Coarse, best-effort progress for the pending bubble; never fails a chat turn. */
export async function recordAssistantProgress(
  store: Store,
  input: { requestId: string; creatorId: string; workspaceId: string; step: string },
): Promise<void> {
  try {
    await store.from("assistant_progress").insert({
      request_id: input.requestId.slice(0, 120),
      creator_id: input.creatorId,
      workspace_id: input.workspaceId,
      step: input.step.slice(0, 160),
    });
  } catch {
    /* Optional operational table: progress is advisory only. */
  }
}

export async function loadAssistantProgress(
  store: Store,
  requestId: string,
  creatorId: string,
  workspaceId: string,
): Promise<AssistantProgressStep[]> {
  const result = await store.from("assistant_progress")
    .select("step,created_at")
    .eq("request_id", requestId)
    .eq("creator_id", creatorId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(30);
  if (result.error) return [];
  return (result.data ?? []) as AssistantProgressStep[];
}
