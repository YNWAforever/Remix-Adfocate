import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createOwnedFixtureFetch, fixtureOwnership, ownsFixtureId, captureFixtureRows } from "./ownedFixtureTransport.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
// @ts-expect-error Executable ESM identity verifier has no declaration file.
import { bootstrapVerifiedLocalStaffGrant, localSupabaseProjectId, verifyIntegrationIdentity } from "../../scripts/run-integration-tests.mjs";

const fixtureIds = { users: new Set<string>(), missions: new Set<string>(), gifts: new Set<string>(), workspaces: new Set<string>() };
let checkedIdentity: {runId:string} | null = null;

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
  checkedIdentity ??= verifyIntegrationIdentity(process.env);
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
  if (!_service) {
    const options=nextClientOptions();
    const authorizePristine=process.env.INTEGRATION_PRISTINE_TARGET_JSON
      ?(campaignIds:string[])=>{verifyIntegrationIdentity(process.env,undefined,campaignIds);}:undefined;
    _service=createClient(url,serviceKey,process.env.INTEGRATION_MUTATION_OWNERSHIP==="1"?{...options,global:{...options.global,fetch:createOwnedFixtureFetch(globalThis.fetch,authorizePristine)}}:options);
  }
  return _service;
}

export function serviceForTests(): SupabaseClient {
  return service();
}

export function userForJwt(jwt: string): SupabaseClient {
  return createClient(url, anonKey, nextClientOptions(jwt));
}

function resolveFixtureWorkspace(): {id:string;slug:string;name:string} {
  const raw=process.env.INTEGRATION_FRESH_WORKSPACE_JSON;
  if(!raw)return {id:"00000000-0000-0000-0000-0000000000aa",slug:"demo",name:"Demo Brand"};
  try {
    const fresh=JSON.parse(raw),scope=JSON.parse(process.env.INTEGRATION_FIXTURE_SCOPE_JSON??"{}"),identity=JSON.parse(process.env.INTEGRATION_TARGET_IDENTITY_JSON??"{}");
    const uuid=/^[a-f0-9-]{36}$/i;
    if(process.env.INTEGRATION_MUTATION_OWNERSHIP!=="1"||fresh?.createdThisRun!==true
      ||!uuid.test(fresh.workspaceId)||!uuid.test(fresh.namespace)||!uuid.test(identity.runId)
      ||fresh.namespace!==process.env.INTEGRATION_FIXTURE_NAMESPACE
      ||fresh.slug!==`d19-support-${fresh.namespace}`||scope.runId!==identity.runId
      ||!Array.isArray(scope.workspaceIds)||!scope.workspaceIds.includes(fresh.workspaceId))throw new Error("scope mismatch");
    return {id:fresh.workspaceId,slug:fresh.slug,name:"Owned fresh support fixture"};
  } catch {throw new Error("Invalid fresh integration fixture scope");}
}
const fixtureWorkspace=resolveFixtureWorkspace();
export const DEMO_WS = fixtureWorkspace.id;
export const FIXTURE_WORKSPACE_SLUG = fixtureWorkspace.slug;
export const FIXTURE_WORKSPACE_NAME = fixtureWorkspace.name;

/** Fresh names let repeated disposable runs preserve immutable historical fixtures. */
export function fixtureName(value: string): string {
  const namespace = process.env.INTEGRATION_FIXTURE_NAMESPACE;
  if (!namespace) return value;
  if (!/^[0-9a-f-]{36}$/.test(namespace)) throw new Error("invalid integration fixture namespace");
  if(process.env.INTEGRATION_FRESH_WORKSPACE_JSON&&['koc-trial-serum','ugc-cafe','clip-skincare','ugc-pet','koc-trial-mask','ugc-travel'].includes(value))return `${value}-${namespace}`;
  if(process.env.INTEGRATION_FRESH_WORKSPACE_JSON&&/\bc1-(pub|draft|brand-leak|related-creator)\b/.test(value))return value.replace(/\bc1-(pub|draft|brand-leak|related-creator)\b/g,slug=>`${slug}-${namespace}`);
  if (value.endsWith("@test.local")) return value.replace("@test.local", `-${namespace}@test.local`);
  return value.replace(/\btest-[a-z0-9-]+/g, (slug) => `${slug}-${namespace}`);
}

/** Create a confirmed user + creator (in DEMO_WS) + balance. Returns a signed-in JWT. */
export async function makeCreator(email: string, balance = 0) {
  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  fixtureIds.users.add(userId);

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

/** Create a confirmed staff actor; attach a workspace only when the test explicitly asks.
 *  Cleanup uses the exact newly-created ID, never an email suffix search. */
export async function makeStaff(email: string, workspaceId?: string) {
  if (!email.endsWith("@test.local")) {
    throw new Error('staff test emails must end in "@test.local" so cleanup() can remove them');
  }
  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  fixtureIds.users.add(userId);
  const staffInsert = await service().from("staff_users").insert({ user_id: userId, email }).select("user_id").single();
  if (staffInsert.error || staffInsert.data?.user_id !== userId) throw staffInsert.error ?? new Error("staff fixture was not created");
  // Capability grants accept only staff IDs created by this fixture process.
  captureFixtureRows("staff_users", { user_id: userId });
  if (workspaceId) {
    const membership = await service().from("brand_users").insert({ user_id: userId,
      workspace_id: workspaceId, email, active: true, role: "member" });
    if (membership.error) throw membership.error;
  }

  const anon = createClient(url, anonKey, nextClientOptions());
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email, password: "test-pw-123456",
  });
  if (signErr) throw signErr;
  return { userId, email, jwt: session.session!.access_token };
}

/** Explicit fixture grants for approved disposable targets only.
 *  Shaped/empty keep the D19 owner path. The verified local Supabase project
 *  (CI `supabase start`) re-checks identity, then uses the same bootstrap function.
 *  Never applies to arbitrary staff or real memberships. */
export async function grantStaffFixture(userId:string,workspaceId:string|null,role:"workspace_admin"|"operator"|"reviewer"|"finance_viewer"|"content_editor") {
  if(process.env.INTEGRATION_CAPABILITY_FIXTURES!=="1")return;
  if(!ownsFixtureId("staff_users",userId))throw new Error("Staff subject is not an exact owned fixture ID");
  const identity=JSON.parse(process.env.INTEGRATION_TARGET_IDENTITY_JSON??"{}");
  const kind=identity.projectId==="adfocate-r1-shaped-20261023"?"shaped":identity.projectId==="adfocate-r1-empty-20261023"?"empty":null;
  if(kind){
    // @ts-expect-error Native ESM identity helper.
    const target=(await import("../../scripts/audit/local-targets.mjs")).verifiedTarget(kind);
    if(!isDeepStrictEqual(identity,target.identity))throw new Error("Fixture grant target drift");
    if(!/^[a-f0-9-]{36}$/i.test(userId)||workspaceId&&!/^[a-f0-9-]{36}$/i.test(workspaceId)||!["workspace_admin","operator","reviewer","finance_viewer","content_editor"].includes(role))throw new Error("Invalid exact fixture grant");
    const existing=target.sql(workspaceId?`select role from public.staff_workspace_roles where user_id='${userId}' and workspace_id='${workspaceId}' and active;`:`select role from public.staff_platform_roles where user_id='${userId}' and role='content_editor' and active;`);
    if(existing){if(existing!==role)throw new Error("Existing fixture grant differs; no implicit promotion");return;}
    target.sql(`select private.bootstrap_staff_access('${userId}',${workspaceId?`'${workspaceId}'`:'null'},'${userId}','${role}',true,0,'${randomUUID()}','Explicit D19 business integration actor','D19 owned disposable test attestation');`);
    captureFixtureRows(workspaceId?"staff_workspace_roles":"staff_platform_roles",{user_id:userId});
    return;
  }
  if(identity.projectId!==localSupabaseProjectId())throw new Error("Unapproved fixture project");
  if(bootstrapVerifiedLocalStaffGrant(process.env,{userId,workspaceId,role})==="granted"){
    captureFixtureRows(workspaceId?"staff_workspace_roles":"staff_platform_roles",{user_id:userId});
  }
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
    fixtureIds.workspaces.add(wsId);
  }

  const { data: created, error } = await service().auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  fixtureIds.users.add(userId);
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
  fixtureIds.missions.add(data.id as string);
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
    fixtureIds.users.add(created.user.id);
    return { userId: created.user.id, jwt: session.session!.access_token };
  }
  // Bootstrap tests need a real phone-primary Auth identity, not an SMS delivery test.
  // Create a confirmed actor and use password transport: no provider or external SMS.
  const phone = opts.phone!;
  const password = "test-pw-123456";
  const { data: created, error } = await service().auth.admin.createUser({ phone, password, phone_confirm: true });
  if (error) throw error;
  fixtureIds.users.add(created.user.id);
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ phone, password });
  if (signErr) throw signErr;
  return { userId: created.user.id, jwt: session.session!.access_token };
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
  fixtureIds.missions.add(data.id as string);
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
  fixtureIds.gifts.add(data.id as string);
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
  if (["submitted", "under_review", "approved"].includes(status)) row.content_urls = ["https://example.test/synthetic-evidence"];
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
  if(process.env.INTEGRATION_RETAIN_FIXTURES==="1")return {retainedIds:fixtureOwnership()};
  // Never discover ownership from an email/phone/slug prefix. Only IDs captured on creation.
  if (!fixtureIds.users.size && !fixtureIds.missions.size && !fixtureIds.gifts.size && !fixtureIds.workspaces.size) return;
  const svc = service();
  const retained: string[] = [];
  const missionIds = [...fixtureIds.missions];
  const anchors = missionIds.length ? await svc.from("mission_submissions")
    .select("mission_id, creator_id, mission_workflows(id)").in("mission_id", missionIds) : {data:[],error:null};
  if (anchors.error) throw anchors.error;
  const protectedMissions = new Set((anchors.data ?? []).filter((row) => {
    const workflows=row.mission_workflows;
    return Array.isArray(workflows) ? workflows.length>0 : Boolean(workflows);
  }).map((row)=>row.mission_id as string));
  const remove = async (table:string, key:string, ids:string[]) => {
    if (!ids.length) return true;
    const result=await svc.from(table).delete().in(key,ids);
    if(result.error){retained.push(...ids);return false;}return true;
  };
  const removableMissions=missionIds.filter((id)=>!protectedMissions.has(id));
  for(const table of ["operator_audit_events","mission_shortlists","mission_submissions"]) await remove(table,"mission_id",removableMissions);
  if(await remove("missions","id",removableMissions)) for(const id of removableMissions)fixtureIds.missions.delete(id);
  // Active histories are append-only. Keep their actors/data for inspection instead of disabling guards.
  const owned=fixtureOwnership();
  const grantedStaff=new Set([...(owned.staff_workspace_roles?.ids??[]),...(owned.staff_platform_roles?.ids??[])]);
  // Access audits keep their exact new actors and memberships; never remove audit/FK guards.
  const users=protectedMissions.size ? [] : [...fixtureIds.users].filter(id=>!grantedStaff.has(id));
  for(const table of ["operator_audit_events","creator_review_notes","creator_review_statuses","mission_shortlists",
    "creator_public_passports","creator_public_profile_snapshots","creator_portfolio_links","creator_social_accounts",
    "redemptions","earnings_transactions","earnings_balances","point_transactions","point_balances"]){
    await remove(table,"creator_id",users);
  }
  if(users.length){
    await svc.from("creators").update({referred_by:null}).in("id",users);
    for(const id of users){
      const objects=await svc.storage.from("creator-avatars").list(id,{limit:100});
      if(objects.error)throw objects.error;
      if(objects.data?.length)await svc.storage.from("creator-avatars").remove(objects.data.map((object)=>id+"/"+object.name));
    }
  }
  await remove("creators","id",users);
  await remove("operator_audit_events","operator_id",users);
  await remove("brand_users","user_id",users);
  await remove("staff_users","user_id",users);
  for(const id of users){const result=await svc.auth.admin.deleteUser(id);if(result.error)retained.push(id);else fixtureIds.users.delete(id);}
  const gifts=[...fixtureIds.gifts];
  await remove("redemptions","gift_id",gifts);await remove("redemption_codes","gift_id",gifts);
  if(await remove("redemption_gifts","id",gifts))fixtureIds.gifts.clear();
  const workspaces=[...fixtureIds.workspaces];
  if(await remove("workspaces","id",workspaces))fixtureIds.workspaces.clear();
  let scope:{runId?:string;workspaceIds?:string[]}={};
  try{scope=JSON.parse(process.env.INTEGRATION_FIXTURE_SCOPE_JSON ?? "{}");}catch{throw new Error("invalid exact fixture scope");}
  if(scope.runId===checkedIdentity?.runId && scope.workspaceIds?.includes(DEMO_WS)){
    // This baseline ID was explicitly created by the guarded launcher for this run.
    const reset=await svc.rpc("set_workspace_budget_enforcement",{p_workspace:DEMO_WS,p_enforced:false});
    if(reset.error)throw reset.error;
  }
  return {retainedIds:[...new Set([...retained,...grantedStaff,...protectedMissions,...(protectedMissions.size?fixtureIds.users:[])])]};
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
  fixtureIds.missions.add(mission.id as string);

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
  const [
    creator,
    points,
    earnings,
    pointTx,
    earningsTx,
    redemptions,
    rewardCatalog,
    budget,
    budgetTx,
  ] = await Promise.all([
    service().from("creators").select("xp").eq("id", creatorId).single(),
    service().from("point_balances").select("balance").eq("creator_id", creatorId).single(),
    service().from("earnings_balances").select("available").eq("creator_id", creatorId).single(),
    service().from("point_transactions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId),
    service().from("earnings_transactions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId),
    service().from("redemptions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId),
    service().from("redemption_gifts").select("stock_qty, stock_remaining").eq("workspace_id", DEMO_WS),
    service().from("workspace_budgets").select("balance").eq("workspace_id", DEMO_WS).maybeSingle(),
    service().from("workspace_budget_transactions").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WS),
  ]);
  for (const result of [
    creator,
    points,
    earnings,
    pointTx,
    earningsTx,
    redemptions,
    rewardCatalog,
    budget,
    budgetTx,
  ]) {
    if (result.error) throw result.error;
  }
  const catalog = rewardCatalog.data ?? [];
  return {
    xp: creator.data!.xp,
    points: points.data!.balance,
    earnings: earnings.data!.available,
    pointTransactions: pointTx.count ?? 0,
    earningsTransactions: earningsTx.count ?? 0,
    redemptions: redemptions.count ?? 0,
    rewardCatalogCount: catalog.length,
    rewardCatalogInventory: {
      total: catalog.reduce((sum, gift) => sum + gift.stock_qty, 0),
      remaining: catalog.reduce((sum, gift) => sum + gift.stock_remaining, 0),
    },
    budget: budget.data?.balance ?? null,
    budgetTransactions: budgetTx.count ?? 0,
  };
}
