import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { StudioDetail, StudioThread } from "./types";
export const studioKeys = { threads: ["studio", "threads"] as const, detail: (id: string) => ["studio", "thread", id] as const };
export function useStudioThreads(page = 0, enabled = true) { return useQuery({ queryKey: [...studioKeys.threads, page], queryFn: () => apiFetch<{ threads: StudioThread[]; nextPage: number | null }>(`/studio/threads?page=${page}`), enabled }); }
export function useStudioThread(id: string) { return useQuery({ queryKey: studioKeys.detail(id), queryFn: () => apiFetch<StudioDetail>(`/studio/threads/${id}`), enabled: Boolean(id) }); }
export type StudioCommand = { action: "create_thread" | "add_source" | "revoke_source" | "save_brief" | "share_brief"; requestId: string; payload: Record<string, unknown> };
export function useStudioCommand<T>() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: StudioCommand) => apiFetch<{ result: T }>("/studio/commands", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: async (_, input) => {
      await client.invalidateQueries({ queryKey: ["studio"] });
      if (typeof input.payload.submissionId === "string") await client.invalidateQueries({ queryKey: ["active-mission", input.payload.submissionId] });
    }, retry: false });
}
