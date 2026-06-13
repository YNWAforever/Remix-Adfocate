import { supabase } from "./supabase";

export const WORKSPACE_SLUG = "demo"; // slice 1: single demo workspace

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": WORKSPACE_SLUG,
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
