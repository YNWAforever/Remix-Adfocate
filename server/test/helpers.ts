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
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  if (opts.email) {
    const password = "test-pw-123456";
    const { data: created, error } = await service().auth.admin.createUser({
      email: opts.email, password, email_confirm: true,
    });
    if (error) throw error;
    const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email: opts.email, password });
    if (signErr) throw signErr;
    return { userId: created.user.id, jwt: session.session!.access_token };
  }
  // Phone-primary: sign in via the test OTP (config.toml [auth.sms.test_otp]) — no SMS
  // provider needed. Creates the user if absent, or signs into an existing one, so a
  // leftover auth user from a prior failed run never collides.
  const phone = opts.phone!;
  const { error: otpErr } = await anon.auth.signInWithOtp({ phone });
  if (otpErr) throw otpErr;
  const { data: session, error: vErr } = await anon.auth.verifyOtp({ phone, token: "654321", type: "sms" });
  if (vErr) throw vErr;
  return { userId: session.user!.id, jwt: session.session!.access_token };
}

/** Seed a mission in DEMO_WS. Use slug prefix "test-" so cleanup() removes it
 *  (and never mutate seed missions — join/submit increment filled permanently). */
export async function makeMission(opts: {
  slug: string;
  title?: string;
  mission_type?: string;
  access_type?: "open" | "application";
  points_reward?: number;
  quota?: number;
  filled?: number;
  status?: string;
  required_level?: string;
  deadline?: string | null;
  category?: string;
}) {
  const { data, error } = await service()
    .from("missions")
    .insert({
      workspace_id: DEMO_WS,
      slug: opts.slug,
      title: opts.title ?? opts.slug,
      mission_type: opts.mission_type ?? "ugc",
      access_type: opts.access_type ?? "open",
      points_reward: opts.points_reward ?? 100,
      quota: opts.quota ?? 10,
      filled: opts.filled ?? 0,
      status: opts.status ?? "active",
      required_level: opts.required_level ?? "L0",
      deadline: opts.deadline ?? null,
      category: opts.category ?? "美容",
    })
    .select("id, slug")
    .single();
  if (error) throw error;
  return data as { id: string; slug: string };
}

export async function cleanup() {
  // Test creators (delete cascades their mission_submissions).
  const byEmail = await service().from("creators").select("id").like("display_name", "%@test.local");
  const byPhone = await service().from("creators").select("id").like("phone", "+1555%");
  const ids = [...new Set([...(byEmail.data ?? []), ...(byPhone.data ?? [])].map((r) => r.id))];
  for (const id of ids) {
    await service().from("point_transactions").delete().eq("creator_id", id);
    await service().from("point_balances").delete().eq("creator_id", id);
    await service().from("creators").delete().eq("id", id);
    await service().auth.admin.deleteUser(id);
  }
  // Test missions (slug "test-%") and any leftover submissions on them.
  const testMissions = await service().from("missions").select("id").like("slug", "test-%");
  for (const m of testMissions.data ?? []) {
    await service().from("mission_submissions").delete().eq("mission_id", m.id);
    await service().from("missions").delete().eq("id", m.id);
  }
}
