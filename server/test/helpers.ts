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
let clientSequence = 0;

function nextClientOptions(jwt?: string) {
  clientSequence += 1;
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `test-auth-${clientSequence}`,
    },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined,
  };
}

function service(): SupabaseClient {
  if (!_service) _service = createClient(url, serviceKey, nextClientOptions());
  return _service;
}

export function serviceForTests(): SupabaseClient {
  return service();
}

export function userForJwt(jwt: string): SupabaseClient {
  return createClient(url, anonKey, nextClientOptions(jwt));
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
  await service().from("earnings_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, available: 0 });

  const anon = createClient(url, anonKey, nextClientOptions());
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email, password: "test-pw-123456",
  });
  if (signErr) throw signErr;
  return { userId, jwt: session.session!.access_token };
}

/** Create a confirmed auth user (email or phone) with NO creator row yet.
 *  Returns a signed-in JWT — used to test first-login bootstrap. */
export async function makeUser(opts: { email?: string; phone?: string }) {
  const anon = createClient(url, anonKey, nextClientOptions());
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
  cash_reward?: number;
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
      cash_reward: opts.cash_reward ?? null,
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

/** Seed a redeemable gift in DEMO_WS. Name MUST start with "test-" so cleanup()
 *  removes it. Stock starts at 0; load codes with addCodes() (which bumps stock). */
export async function makeGift(opts: {
  name: string;
  points_cost?: number;
  status?: string;
  valid_from?: string | null;
  valid_to?: string | null;
}) {
  const { data, error } = await service()
    .from("redemption_gifts")
    .insert({
      workspace_id: DEMO_WS,
      name: opts.name,
      points_cost: opts.points_cost ?? 100,
      stock_qty: 0,
      stock_remaining: 0,
      gift_type: "voucher",
      status: opts.status ?? "available",
      valid_from: opts.valid_from ?? null,
      valid_to: opts.valid_to ?? null,
    })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as { id: string; name: string };
}

/** Load a code pool for a gift and bump its stock_remaining in lockstep. */
export async function addCodes(giftId: string, codes: string[]) {
  const rows = codes.map((code) => ({ gift_id: giftId, workspace_id: DEMO_WS, code }));
  const { error } = await service().from("redemption_codes").insert(rows);
  if (error) throw error;
  const { data: g } = await service().from("redemption_gifts").select("stock_remaining").eq("id", giftId).single();
  await service()
    .from("redemption_gifts")
    .update({ stock_remaining: (g?.stock_remaining ?? 0) + codes.length })
    .eq("id", giftId);
}

/** Service-role set of a creator's xp (the user grant intentionally forbids self-update of
 *  xp/level). Used by tests to drive the level trigger across thresholds. */
export async function setXp(userId: string, xp: number) {
  const { error } = await service().from("creators").update({ xp }).eq("id", userId);
  if (error) throw error;
}

/** Service-role patch of a creator's matcher inputs (categories bypass the user grant). */
export async function setCreatorProfile(userId: string, patch: { categories?: string[]; level?: string }) {
  const { error } = await service().from("creators").update(patch).eq("id", userId);
  if (error) throw error;
}

/** Insert a mission_submissions row in a terminal status (service-role, bypassing the
 *  join→submit→review RPC chain). Creates a throwaway "test-" mission per call so the
 *  (mission_id, creator_id) unique constraint never collides. An optional 1-5
 *  qualityRating seeds the Content-score source (only meaningful on approved rows). */
export async function seedSubmission(creatorId: string, status: string, slug: string, qualityRating?: number) {
  const m = await makeMission({ slug });
  const row: Record<string, unknown> = { mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status };
  if (qualityRating != null) row.quality_rating = qualityRating;
  const { error } = await service().from("mission_submissions").insert(row);
  if (error) throw error;
}

/** Point one creator's referred_by at another (service-role; set only at bootstrap in
 *  prod). Used to exercise the passport 'referrer' badge. */
export async function setReferredBy(childId: string, parentId: string) {
  const { error } = await service().from("creators").update({ referred_by: parentId }).eq("id", childId);
  if (error) throw error;
}

/** Read a creator's persisted passport-score snapshot (creators.scores) for assertions. */
export async function getCreatorScores(userId: string) {
  const { data, error } = await service().from("creators").select("scores").eq("id", userId).single();
  if (error) throw error;
  return data.scores as { influence: number | null; content: number | null; reliability: number | null; brandSafety: number | null };
}

export async function cleanup() {
  // Test creators (delete cascades their mission_submissions).
  const byEmail = await service().from("creators").select("id").like("display_name", "%@test.local");
  const byPhone = await service().from("creators").select("id").like("phone", "+1555%");
  const ids = [...new Set([...(byEmail.data ?? []), ...(byPhone.data ?? [])].map((r) => r.id))];
  if (ids.length) {
    await service().from("operator_audit_events").delete().in("creator_id", ids);
    await service().from("creator_review_notes").delete().in("creator_id", ids);
    await service().from("creator_review_statuses").delete().in("creator_id", ids);
    await service().from("mission_shortlists").delete().in("creator_id", ids);
    await service().from("creator_public_passports").delete().in("creator_id", ids);
    await service().from("creator_public_profile_snapshots").delete().in("creator_id", ids);
    await service().from("creator_portfolio_links").delete().in("creator_id", ids);
    await service().from("creator_social_accounts").delete().in("creator_id", ids);
    for (const id of ids) {
      const { data: objects } = await service().storage.from("creator-avatars").list(id, { limit: 100 });
      if (objects?.length) {
        await service()
          .storage
          .from("creator-avatars")
          .remove(objects.map((object) => `${id}/${object.name}`));
      }
    }
  }
  // Null any inbound referral inside the test set so deleting a referred creator never
  // trips the referred_by FK (creators.referred_by → creators.id, no ON DELETE clause).
  if (ids.length) await service().from("creators").update({ referred_by: null }).in("id", ids);
  for (const id of ids) {
    await service().from("redemptions").delete().eq("creator_id", id);
    await service().from("earnings_transactions").delete().eq("creator_id", id);
    await service().from("earnings_balances").delete().eq("creator_id", id);
    await service().from("point_transactions").delete().eq("creator_id", id);
    await service().from("point_balances").delete().eq("creator_id", id);
    await service().from("creators").delete().eq("id", id);
    await service().auth.admin.deleteUser(id);
  }
  // Test missions (slug "test-%") and any leftover submissions on them.
  const testMissions = await service().from("missions").select("id").like("slug", "test-%");
  for (const m of testMissions.data ?? []) {
    await service().from("operator_audit_events").delete().eq("mission_id", m.id);
    await service().from("mission_shortlists").delete().eq("mission_id", m.id);
    await service().from("mission_submissions").delete().eq("mission_id", m.id);
    await service().from("missions").delete().eq("id", m.id);
  }
  // Test gifts (name "test-%") with their codes + redemptions.
  const testGifts = await service().from("redemption_gifts").select("id").like("name", "test-%");
  for (const g of testGifts.data ?? []) {
    await service().from("redemptions").delete().eq("gift_id", g.id);
    await service().from("redemption_codes").delete().eq("gift_id", g.id);
    await service().from("redemption_gifts").delete().eq("id", g.id);
  }
}
