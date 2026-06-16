// Interim operator auth: a shared ADMIN_SECRET kept in sessionStorage (cleared on tab
// close). Single-operator internal tool only — real per-workspace role auth lands with
// the Brand Dashboard. Mirrors the x-admin-secret check in server/routes/admin.ts.
const KEY = "adfocate_admin_secret";

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(KEY);
}
export function setAdminSecret(secret: string) {
  sessionStorage.setItem(KEY, secret);
}
export function clearAdminSecret() {
  sessionStorage.removeItem(KEY);
}

export class AdminAuthError extends Error {}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = getAdminSecret();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-admin-secret": secret } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearAdminSecret();
    throw new AdminAuthError("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
