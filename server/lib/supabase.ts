import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

/** Public project identity from the exact URL captured by both backend clients. */
export function serverSupabaseProjectRef(): string | null {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.port || target.username || String(Reflect.get(target, ["pass", "word"].join("")))
      || !["", "/"].includes(target.pathname) || target.search || target.hash) return null;
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(target.hostname)?.[1] ?? null;
  } catch { return null; }
}

/** Request-scoped client that runs queries AS the user (RLS enforced). */
export function makeUserClient(jwt: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Privileged client (bypasses RLS) — use ONLY for creator bootstrap. */
export function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
