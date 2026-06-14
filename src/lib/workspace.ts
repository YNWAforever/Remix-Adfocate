/** The configured launch-brand workspace. Override per-deploy with VITE_DEFAULT_WORKSPACE. */
const DEFAULT_WORKSPACE = (import.meta.env.VITE_DEFAULT_WORKSPACE as string | undefined) ?? "demo";

/**
 * The active workspace slug. Today this is a single configured default and is NOT
 * shown in the URL (slugless apex). Later it can additionally resolve from a
 * custom-domain map or a path/subdomain for multi-tenant — callers (the
 * X-Workspace-Slug header in src/lib/api.ts) do not change.
 */
export function resolveWorkspace(): string {
  return DEFAULT_WORKSPACE;
}
