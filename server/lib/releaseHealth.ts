import { serverSupabaseProjectRef } from "./supabase.js";

/** Public deployment identity; no keys, URLs, users, schema or database data. */
export function deploymentHealthMetadata(env: Partial<Pick<NodeJS.ProcessEnv, "VERCEL_GIT_COMMIT_SHA">> = process.env):
  { applicationCommit: string; apiProjectRef: string | null } | Record<string, never> {
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) return {};
  return { applicationCommit: commit, apiProjectRef: serverSupabaseProjectRef() };
}
