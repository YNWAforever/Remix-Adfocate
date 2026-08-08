import { supabase } from "@/lib/supabase";

export class AdminAuthError extends Error {}

export class AdminRequestError extends Error {
  code?: string;
  fields?: Record<string, string>;

  constructor(message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) throw new AdminAuthError("unauthorized");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new AdminRequestError(body.error ?? response.statusText, body.code, body.fields);
  }
  return response.json() as Promise<T>;
}
