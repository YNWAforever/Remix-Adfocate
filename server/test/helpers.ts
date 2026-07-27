import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

type IntegrationEnv = Partial<Record<
  "RUN_INTEGRATION" | "SUPABASE_URL" | "SUPABASE_SERVICE_KEY" | "SUPABASE_ANON_KEY",
  string
>>;

export function activeMissionIntegrationSkipReason(env: IntegrationEnv = process.env): string | null {
  if (env.RUN_INTEGRATION !== "1") return "RUN_INTEGRATION=1 is required";
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SUPABASE_ANON_KEY) {
    return "SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_ANON_KEY are required";
  }
  try {
    const parsed = new URL(env.SUPABASE_URL);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "SUPABASE_URL must be an HTTP(S) URL";
    }
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "SUPABASE_URL must use localhost or 127.0.0.1";
    }
  } catch {
    return "SUPABASE_URL must be a valid URL";
  }
  return null;
}

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

/** Create a confirmed auth user + an active staff_users row. Returns a signed-in JWT.
 *  Email MUST end in @test.local so cleanup() removes it. */
export async function makeStaff(email: string) {
  if (!email.endsWith("@test.local")) {
    throw new Error('staff test emails must end in "@test.local" so cleanup() can remove them');
  }
  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  await service().from("staff_users").insert({ user_id: userId, email });

  const anon = createClient(url, anonKey, nextClientOptions());
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email, password: "test-pw-123456",
  });
  if (signErr) throw signErr;
  return { userId, jwt: session.session!.access_token };
}

let brandWsSeq = 0;
/** Create a confirmed brand auth user + an active brand_users row. When workspaceId is omitted,
 *  a throwaway workspace (slug "test-brand-ws-...") is created so two brands are isolated.
 *  Email MUST end in @test.local so cleanup() removes it. Returns a signed-in JWT, the workspace
 *  id, and deactivate() which flips brand_users.active=false (durable revocation). */
export async function makeBrand(email: string, workspaceId?: string, role: "owner" | "member" = "owner") {
  if (!email.endsWith("@test.local")) {
    throw new Error('brand test emails must end in "@test.local" so cleanup() can remove them');
  }
  let wsId = workspaceId;
  if (!wsId) {
    brandWsSeq += 1;
    const slug = `test-brand-ws-${Date.now()}-${brandWsSeq}`;
    const { data: ws, error: wErr } = await service()
      .from("workspaces").insert({ slug, name: `Test Brand WS ${brandWsSeq}` }).select("id").single();
    if (wErr) throw wErr;
    wsId = ws.id as string;
  }

  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  await service().from("brand_users").insert({ user_id: userId, workspace_id: wsId, email, role, active: true });

  const anon = createClient(url, anonKey, nextClientOptions());
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password: "test-pw-123456" });
  if (signErr) throw signErr;

  return {
    userId,
    jwt: session.session!.access_token,
    workspaceId: wsId,
    async deactivate() {
      const { error: dErr } = await service().from("brand_users").update({ active: false }).eq("user_id", userId);
      if (dErr) throw dErr;
    },
  };
}

/** Seed a mission in a given workspace (service-role). Slug MUST start with "test-" so cleanup()
 *  removes it. Used by the brand RLS isolation tests. */
export async function seedMission(workspaceId: string, opts: {
  slug: string; title?: string; status?: string; mission_type?: string;
  points_reward?: number; cash_reward?: number | null; quota?: number; filled?: number;
}) {
  if (!opts.slug.startsWith("test-")) {
    throw new Error('seedMission slug must start with "test-" so cleanup() can remove it');
  }
  const { data, error } = await service().from("missions").insert({
    workspace_id: workspaceId,
    slug: opts.slug,
    title: opts.title ?? opts.slug,
    mission_type: opts.mission_type ?? "ugc",
    access_type: "open",
    points_reward: opts.points_reward ?? 100,
    cash_reward: opts.cash_reward ?? null,
    quota: opts.quota ?? 10,
    filled: opts.filled ?? 0,
    status: opts.status ?? "draft",
    required_level: "L0",
    category: "美容",
    deadline: null,
  }).select("id, slug").single();
  if (error) throw error;
  return data as { id: string; slug: string };
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
  if (!opts.slug.startsWith("test-")) {
    throw new Error('test missions must use a slug starting with "test-" so cleanup() can remove them');
  }

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
  const releaseCreatorEmail = "publication-proof-release-creator@test.local";
  const releaseOperatorEmail = "publication-proof-release-operator@test.local";
  const releaseMissionSlug = "test-publication-proof-release";
  // Campaigns G1: delete test campaigns (slug "test-%") — cascades campaign_missions +
  // campaign_participants — then the throwaway workspaces ("test-camp-%") created by the
  // cross-workspace settlement tests (cascades their campaigns + budget rows). Done first so
  // the per-(workspace_id, slug) unique on campaigns never trips a re-run.
  await service().from("campaigns").delete().like("slug", "test-%");
  await service().from("workspaces").delete().like("slug", "test-camp-%");
  // A campaign settlement test may have left the shared DEMO_WS budget enforced; 0024's
  // budget-aware approve_submission would then 400 every unrelated cash-mission approval
  // (wallet/insights/etc.). Reset DEMO_WS to unenforced (RPC — workspace_budgets has no
  // service_role table grant). Harmless when no budget row / already unenforced.
  await service().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: false });

  // Test creators (delete cascades their mission_submissions).
  const byEmail = await service().from("creators").select("id")
    .like("display_name", "%@test.local")
    .neq("display_name", releaseCreatorEmail);
  const byPhone = await service().from("creators").select("id")
    .like("phone", "+1555%")
    .neq("display_name", releaseCreatorEmail);
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
  const testMissions = await service().from("missions").select("id")
    .like("slug", "test-%")
    .neq("slug", releaseMissionSlug);
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
  // Test staff users (email "%@test.local") + their auth users.
  const staffRows = await service().from("staff_users").select("user_id")
    .like("email", "%@test.local")
    .neq("email", releaseOperatorEmail);
  for (const s of staffRows.data ?? []) {
    await service().from("operator_audit_events").delete().eq("operator_id", s.user_id);
    await service().from("staff_users").delete().eq("user_id", s.user_id);
    await service().auth.admin.deleteUser(s.user_id);
  }

  // Brand test data: memberships/invites for %@test.local, the throwaway workspaces makeBrand
  // created (slug "test-brand-ws-%"), any missions still in them, and the brand auth users.
  const brandUsers = await service().from("brand_users").select("user_id")
    .like("email", "%@test.local")
    .neq("email", releaseOperatorEmail);
  const brandUserIds = (brandUsers.data ?? []).map((r) => r.user_id as string);
  await service().from("brand_invites").delete()
    .like("email", "%@test.local")
    .neq("email", releaseOperatorEmail);
  await service().from("brand_users").delete()
    .like("email", "%@test.local")
    .neq("email", releaseOperatorEmail);
  for (const id of brandUserIds) await service().auth.admin.deleteUser(id);

  const brandWs = await service().from("workspaces").select("id").like("slug", "test-brand-ws-%");
  const brandWsIds = (brandWs.data ?? []).map((r) => r.id as string);
  if (brandWsIds.length) {
    const leftover = await service().from("missions").select("id").in("workspace_id", brandWsIds);
    for (const m of leftover.data ?? []) {
      await service().from("mission_submissions").delete().eq("mission_id", m.id);
      await service().from("missions").delete().eq("id", m.id);
    }
    await service().from("workspaces").delete().in("id", brandWsIds);
  }
}


export type ActiveMissionDeliverable = {
  title: string;
  platform: string;
  required?: boolean;
  draftDueOffsetHours?: number | null;
  publicationInstructions?: string;
  publicationWindowHours?: number;
  requiredDisclosures?: string[];
  expectedAccount?: string | null;
  proofEvidencePolicy?: Record<string, unknown>;
  requirements?: Array<{
    category: "format" | "key_message" | "compliance" | "quality" | "other";
    text: string;
    required?: boolean;
  }>;
};

/** Seed the accepted anchor and authoring templates for an active mission workflow. */
export async function seedActiveMission(opts: {
  email: string;
  slug: string;
  fulfillmentRequired?: boolean;
  deliverables: ActiveMissionDeliverable[];
}) {
  const creator = await makeCreator(opts.email, 250);
  if (!opts.slug.startsWith("test-")) {
    throw new Error('active mission slugs must start with "test-"');
  }
  const { data: mission, error: createMissionError } = await service()
    .from("missions")
    .insert({
      workspace_id: DEMO_WS,
      slug: opts.slug,
      title: opts.slug,
      mission_type: "ugc",
      access_type: "open",
      points_reward: 500,
      cash_reward: 125,
      quota: 10,
      filled: 0,
      status: "active",
      required_level: "L0",
      category: "test",
    })
    .select("id, slug")
    .single();
  if (createMissionError) throw createMissionError;

  const { data: configuredMission, error: missionError } = await service()
    .from("missions")
    .update({
      creator_workflow_mode: "active_workspace",
      fulfillment_required: opts.fulfillmentRequired ?? false,
    })
    .eq("id", mission.id)
    .select("id, slug, creator_workflow_mode, fulfillment_required")
    .single();
  if (missionError) throw missionError;

  const { data: templates, error: templateError } = await service()
    .from("mission_deliverable_templates")
    .insert(opts.deliverables.map((deliverable, position) => ({
      workspace_id: DEMO_WS,
      mission_id: mission.id,
      title: deliverable.title,
      platform: deliverable.platform,
      position,
      required: deliverable.required ?? true,
      draft_due_offset_hours: deliverable.draftDueOffsetHours ?? null,
      publication_instructions: deliverable.publicationInstructions ?? "Publish the approved content",
      publication_window_hours: deliverable.publicationWindowHours ?? 72,
      required_disclosures: deliverable.requiredDisclosures ?? [],
      expected_account: deliverable.expectedAccount ?? null,
      proof_evidence_policy: deliverable.proofEvidencePolicy ?? {},
    })))
    .select("id, position");
  if (templateError) throw templateError;

  for (const template of templates ?? []) {
    const deliverable = opts.deliverables[template.position];
    if (!deliverable.requirements?.length) continue;
    const { error } = await service().from("mission_deliverable_requirements").insert(
      deliverable.requirements.map((requirement, position) => ({
        workspace_id: DEMO_WS,
        mission_deliverable_template_id: template.id,
        category: requirement.category,
        requirement_text: requirement.text,
        required: requirement.required ?? true,
        position,
      })),
    );
    if (error) throw error;
  }

  const { data: submission, error: submissionError } = await service()
    .from("mission_submissions")
    .insert({
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "joined",
    })
    .select("id, status")
    .single();
  if (submissionError) throw submissionError;

  return {
    mission: configuredMission,
    creator: { id: creator.userId, jwt: creator.jwt },
    submission,
  };
}

export async function creatorRewardSnapshot(creatorId: string) {
  const [creator, points, earnings, pointTx, earningsTx, budget, budgetTx] = await Promise.all([
    service().from("creators").select("xp").eq("id", creatorId).single(),
    service().from("point_balances").select("balance").eq("creator_id", creatorId).single(),
    service().from("earnings_balances").select("available").eq("creator_id", creatorId).single(),
    service().from("point_transactions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId),
    service().from("earnings_transactions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId),
    service().from("workspace_budgets").select("balance").eq("workspace_id", DEMO_WS).maybeSingle(),
    service().from("workspace_budget_transactions").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WS),
  ]);
  for (const result of [creator, points, earnings, pointTx, earningsTx, budget, budgetTx]) {
    if (result.error) throw result.error;
  }
  return {
    xp: creator.data!.xp,
    points: points.data!.balance,
    earnings: earnings.data!.available,
    pointTransactions: pointTx.count,
    earningsTransactions: earningsTx.count,
    budget: budget.data?.balance ?? null,
    budgetTransactions: budgetTx.count,
  };
}
