import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

/**
 * Integration tests need a reachable Supabase (local `supabase start` stack or cloud)
 * plus a valid URL + keys. When absent (e.g. CI without the local stack), the suite
 * skips instead of crashing at import — see the guard in rls.test.ts.
 */
export const hasSupabaseEnv =
  /^https?:\/\//.test(url) && Boolean(serviceKey) && Boolean(anonKey);

// Lazy so merely importing this module never constructs a client with an invalid URL.
let _service: SupabaseClient | null = null;
function service(): SupabaseClient {
  if (!_service) _service = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _service;
}

export const DEMO_WS = "00000000-0000-0000-0000-0000000000aa";

/** Create a confirmed user + creator (in DEMO_WS) + balance. Returns a signed-in JWT. */
export async function makeCreator(email: string, balance = 0) {
  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  await service().from("creators").insert({ id: userId, workspace_id: DEMO_WS, display_name: email });
  await service().from("point_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, balance });

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email, password: "test-pw-123456",
  });
  if (signErr) throw signErr;
  return { userId, jwt: session.session!.access_token };
}

/** Create a confirmed auth user (email or phone) with NO creator row yet.
 *  Returns a signed-in JWT — used to test first-login bootstrap. */
export async function makeUser(opts: { email?: string; phone?: string }) {
  const password = "test-pw-123456";
  const { data: created, error } = await service().auth.admin.createUser(
    opts.email
      ? { email: opts.email, password, email_confirm: true }
      : { phone: opts.phone, password, phone_confirm: true },
  );
  if (error) throw error;

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword(
    opts.email ? { email: opts.email, password } : { phone: opts.phone!, password },
  );
  if (signErr) throw signErr;
  return { userId: created.user.id, jwt: session.session!.access_token };
}

export async function cleanup() {
  const byEmail = await service().from("creators").select("id").like("display_name", "%@test.local");
  const byPhone = await service().from("creators").select("id").like("phone", "+1555%");
  const ids = [...new Set([...(byEmail.data ?? []), ...(byPhone.data ?? [])].map((r) => r.id))];
  for (const id of ids) {
    await service().from("point_transactions").delete().eq("creator_id", id);
    await service().from("point_balances").delete().eq("creator_id", id);
    await service().from("creators").delete().eq("id", id);
    await service().auth.admin.deleteUser(id);
  }
}
