import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

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
