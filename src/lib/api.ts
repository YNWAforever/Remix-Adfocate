import { supabase } from "./supabase";

// The active workspace slug, derived from the route (kocmax/$slug) at runtime
// instead of hardcoded. Defaults to "demo" until a route sets it.
let workspaceSlug = "demo";
export function setWorkspaceSlug(slug: string) {
  workspaceSlug = slug;
}
export function getWorkspaceSlug() {
  return workspaceSlug;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspaceSlug,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? "error", body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
