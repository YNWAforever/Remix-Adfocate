// Review-only fixtures for the disposable LOCAL Supabase stack started by `supabase start`.
// Every helper refuses to run unless the API and DB URLs are loopback and the runner set
// REVIEW_DISPOSABLE_DB=1 (see tests/review/run-review-tests.mjs). Never point at a hosted project.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const DEMO_WORKSPACE = "00000000-0000-0000-0000-0000000000aa";
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

function assertDisposable(): { url: string; anon: string; service: string; db: string } {
  const url = process.env.SUPABASE_URL ?? "", db = process.env.REVIEW_DB_URL ?? "";
  if (process.env.REVIEW_DISPOSABLE_DB !== "1") throw new Error("REVIEW_DISPOSABLE_DB=1 is required (use run-review-tests.mjs)");
  if (!LOOPBACK.has(new URL(url).hostname) || !LOOPBACK.has(new URL(db).hostname)) throw new Error("review fixtures only run against a loopback Supabase stack");
  return { url, anon: process.env.SUPABASE_ANON_KEY!, service: process.env.SUPABASE_SERVICE_KEY!, db };
}

const target = assertDisposable();
const clientOpts = () => ({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `review-${randomUUID()}` } });
export const service: SupabaseClient = createClient(target.url, target.service, clientOpts());

/** Run SQL as the local `postgres` superuser (fixture setup only, never app paths). */
export function sql(query: string): string {
  return execFileSync("psql", [target.db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}
export const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

let appInstance: { request: (input: string, init?: RequestInit) => Response | Promise<Response> } | null = null;
async function app() {
  if (!appInstance) appInstance = (await import("../../../server/app.js")).createApp().app;
  return appInstance;
}

// Response bodies are inspected loosely by scenario tests; `any` keeps assertions terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
export type ApiResult<T = Loose> = { status: number; body: T };
/** Call the real Hono app in-process (same code Vercel mounts, minus the api/index.ts method exports). */
export async function api<T = Loose>(method: string, path: string, opts: { jwt?: string; body?: unknown; ws?: string | null; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  if (opts.ws !== null) headers["X-Workspace-Slug"] = opts.ws ?? "demo";
  const res = await (await app()).request(`http://local/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: Loose = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}

export type Actor = { id: string; email: string; password: string; jwt: string; client: SupabaseClient };

export async function newUser(prefix: string): Promise<Actor> {
  const email = `review-${prefix}-${randomUUID().slice(0, 8)}@review.test`;
  const password = `Review-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(target.url, target.anon, clientOpts());
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id: created.data.user!.id, email, password, jwt: signed.data.session!.access_token, client };
}

/** Bootstrap a creator through the real API; optionally finish onboarding (welcome bonus). */
export async function newCreator(opts: { onboard?: boolean; slug?: string; consent?: boolean } = {}): Promise<Actor> {
  const user = await newUser("creator");
  const res = await api("POST", "/me/bootstrap", { jwt: user.jwt, body: { slug: opts.slug ?? "demo" }, ws: null });
  if (res.status !== 200) throw new Error(`bootstrap ${res.status} ${JSON.stringify(res.body)}`);
  if (opts.consent !== false) {
    const { LEGAL_VERSIONS } = await import("../../../src/lib/legalVersions");
    const ok = await api("POST", "/me/consents", { jwt: user.jwt, body: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy } });
    if (ok.status !== 200) throw new Error(`consent ${ok.status} ${JSON.stringify(ok.body)}`);
  }
  if (opts.onboard !== false) {
    const done = await api("POST", "/onboarding/complete", { jwt: user.jwt });
    if (done.status !== 200) throw new Error(`onboarding/complete ${done.status} ${JSON.stringify(done.body)}`);
  }
  return user;
}

export type StaffRole = "workspace_admin" | "operator" | "reviewer" | "finance_viewer";
/** Staff user with one workspace membership and a role granted via the owner-only bootstrap RPC. */
export async function newStaff(role: StaffRole, workspaceId = DEMO_WORKSPACE): Promise<Actor> {
  const user = await newUser(role.replace("_", "-"));
  sql(`insert into public.staff_users(user_id,email,active) values (${q(user.id)},${q(user.email)},true);
       insert into public.brand_users(user_id,workspace_id,email,role,active) values (${q(user.id)},${q(workspaceId)},${q(user.email)},'member',true);`);
  sql(`select private.bootstrap_staff_access(${q(user.id)},${q(workspaceId)},${q(user.id)},${q(role)},true,0,${q(randomUUID())},'review fixture','review-local-disposable');`);
  return user;
}

/** Brand user (brand_users row only, no staff row). */
export async function newBrand(workspaceId = DEMO_WORKSPACE, role: "owner" | "member" = "owner"): Promise<Actor> {
  const user = await newUser("brand");
  sql(`insert into public.brand_users(user_id,workspace_id,email,role,active) values (${q(user.id)},${q(workspaceId)},${q(user.email)},${q(role)},true);`);
  return user;
}

export function newWorkspace(): { id: string; slug: string } {
  const slug = `review-${randomUUID().slice(0, 8)}`;
  const id = sql(`insert into public.workspaces(slug,name) values (${q(slug)},'Review fixture') returning id;`);
  return { id, slug };
}

export type MissionOpts = { workspaceId?: string; access?: "open" | "application"; points?: number; cash?: number | null; quota?: number; status?: string; mode?: "legacy" | "active_workspace" };
export function newMission(o: MissionOpts = {}): { id: string; slug: string } {
  const slug = `review-${randomUUID().slice(0, 8)}`;
  const id = sql(`insert into public.missions(workspace_id,slug,title,category,mission_type,access_type,required_level,points_reward,cash_reward,quota,filled,status,creator_workflow_mode)
    values (${q(o.workspaceId ?? DEMO_WORKSPACE)},${q(slug)},'Review mission','beauty','ugc',${q(o.access ?? "open")},'L0',${o.points ?? 120},${o.cash == null ? "null" : o.cash},${o.quota ?? 10},0,${q(o.status ?? "active")},${q(o.mode ?? "legacy")}) returning id;`);
  return { id, slug };
}

export const VALID_URLS = ["https://www.instagram.com/p/review123/"];

export async function joinAndSubmit(creator: Actor, slug: string): Promise<string> {
  const join = await api("POST", `/missions/${slug}/join`, { jwt: creator.jwt });
  if (join.status !== 200) throw new Error(`join ${join.status} ${JSON.stringify(join.body)}`);
  const sub = await api("PUT", `/missions/${slug}/submit`, { jwt: creator.jwt, body: { content_urls: VALID_URLS } });
  if (sub.status !== 200) throw new Error(`submit ${sub.status} ${JSON.stringify(sub.body)}`);
  return submissionId(creator.id, slug);
}

export function submissionId(creatorId: string, slug: string): string {
  return sql(`select s.id from public.mission_submissions s join public.missions m on m.id=s.mission_id where s.creator_id=${q(creatorId)} and m.slug=${q(slug)};`);
}

export const balances = (creatorId: string) => {
  const [points, cash, xp] = sql(`select coalesce((select balance from public.point_balances where creator_id=${q(creatorId)}),-1)||'|'||coalesce((select available from public.earnings_balances where creator_id=${q(creatorId)}),-1)||'|'||(select xp from public.creators where id=${q(creatorId)});`).split("|");
  return { points: Number(points), cash: Number(cash), xp: Number(xp) };
};

export const notificationTypes = (creatorId: string) =>
  sql(`select coalesce(string_agg(type, ',' order by created_at),'') from public.notifications where user_id=${q(creatorId)};`).split(",").filter(Boolean);
