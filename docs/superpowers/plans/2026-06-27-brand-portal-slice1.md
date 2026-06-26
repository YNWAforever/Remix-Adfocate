# Brand Portal Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator-invited brand logs in (email magic-link), lands on a dedicated `/brand` portal locked to their one workspace, and authors their own missions — with workspace isolation enforced by Postgres RLS (brand API runs as the user's JWT, not service_role).

**Architecture:** New `brand_invites` + `brand_users` tables (mirror the RLS-closed `staff_users` pattern). A `requireBrand` Hono middleware resolves the active `brand_users` row → `BrandIdentity`; brand routes query Supabase via the existing `makeUserClient(jwt)` so RLS applies. Mission CRUD reuses the pure `missionAuthoring.ts` validators and the `MissionEditor` component; only the data layer differs (user-JWT client + identity workspace, never a workspace param). A `/brand` TanStack route tree with a `BrandAuthGate` mirrors the `/admin` shell.

**Tech Stack:** Hono v4 (server), Supabase Postgres + RLS, `@supabase/supabase-js` (`makeUserClient`), React + TanStack Router/Query, Tailwind v4 + Acid Y2K CSS, Vitest (unit + `--no-file-parallelism` integration), i18n flat dict (en+zh parity enforced).

Spec: `docs/superpowers/specs/2026-06-27-brand-portal-slice1-design.md`.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/migrations/0023_brand_access.sql` | **Create** | `brand_invites` + `brand_users` tables, grants, RLS (brand_users own-read, missions brand policies) |
| `server/lib/brandAuth.ts` | **Create** | `BrandIdentity`, `BrandEnv`, `resolveBrand`, `requireBrand`, `acceptBrandInvite` |
| `server/lib/brandAuth.test.ts` | **Create** | Unit tests for `resolveBrand` / accept logic (pure-ish) |
| `server/routes/brand.ts` | **Create** | `GET /brand/me`, `POST /brand/accept`, brand mission CRUD (user-JWT client) |
| `server/routes/adminBrandInvites.ts` | **Create** | Staff-gated `POST /admin/brand-invites` (create invite + magic-link) |
| `server/app.ts` | **Modify** | Mount `/brand` (unguarded shell; `requireBrand` inside) + register `adminBrandInvites` |
| `server/test/brand.test.ts` | **Create** | Integration: RLS two-brand isolation, invite→accept, no-invite 403, revoked 403, creator-reads-unaffected |
| `package.json` | **Modify** | Append `server/test/brand.test.ts` to `test:integration` |
| `src/lib/brand.ts` | **Create** | `brandFetch` (user JWT), `brandKeys`, `fetchBrandMe`, brand mission fetchers + types |
| `src/components/brand/BrandAuthContext.tsx` | **Create** | `BrandAuthContext` + `useBrandAuth` |
| `src/components/brand/BrandAuthGate.tsx` | **Create** | Resolve `GET /brand/me`; loading / no-access / authed |
| `src/components/brand/BrandNav.tsx` | **Create** | Side/Bottom nav: 概覽 + 任務 |
| `src/routes/brand.tsx` | **Create** | Layout: gate + nav + `<Outlet/>` |
| `src/routes/brand.login.tsx` | **Create** | Email → magic-link |
| `src/routes/brand.auth.callback.tsx` | **Create** | Exchange code → `POST /brand/accept` → `/brand` |
| `src/routes/brand.index.tsx` | **Create** | Dashboard (workspace name, mission count, CTA) |
| `src/routes/brand.missions.index.tsx` | **Create** | Brand mission list + actions |
| `src/routes/brand.missions.new.tsx` | **Create** | `MissionEditor` (create) |
| `src/routes/brand.missions.$missionId.tsx` | **Create** | `MissionEditor` (edit) |
| `src/routes/-brand.test.tsx` | **Create** | Route-stub tests (gate states, mission list) |
| `src/lib/i18n.dict.ts` | **Modify** | `app.brand.*` keys (en + zh) |

**Pattern sources to mirror (read before implementing):** `server/lib/staffAuth.ts` (`resolveStaff`, `requireStaff`, identity-on-context), `server/routes/admin.ts` + the admin mission routes (CRUD shape), `src/components/admin/StaffAuthGate.tsx` + `AdminAuthContext.tsx`, `src/routes/admin.tsx` (layout), `src/routes/_app.login.tsx` + `_app.auth.callback.tsx` (magic-link), `src/lib/admin.ts` (fetch helpers), `server/test/helpers` (`makeStaff`, `makeCreator`, `cleanup`, `hasSupabaseEnv`).

---

## Task 1: Migration — brand tables + RLS

**Files:** Create `supabase/migrations/0023_brand_access.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0023_brand_access.sql
-- Slice B3b-1: brand identity + invite + RLS-enforced workspace isolation.

-- Pending invites (by email, before an auth user exists). Server-only (service_role).
create table public.brand_invites (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  role             text not null default 'member' check (role in ('owner','member')),
  token            text not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by_staff uuid references auth.users(id),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index brand_invites_pending_email on public.brand_invites (lower(email)) where accepted_at is null;
alter table public.brand_invites enable row level security;
grant all on public.brand_invites to service_role;  -- no authenticated/anon policies

-- Active membership (by user_id). v1: one workspace per brand user.
create table public.brand_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'member' check (role in ('owner','member')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.brand_users enable row level security;
grant all on public.brand_users to service_role;
grant select on public.brand_users to authenticated;
create policy brand_users_self_read on public.brand_users
  for select to authenticated using (user_id = auth.uid());

-- Brand access to missions, scoped by membership (ADDITIVE to existing creator/staff paths).
grant select, insert, update, delete on public.missions to authenticated;
create policy missions_brand_select on public.missions
  for select to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_insert on public.missions
  for insert to authenticated
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_update on public.missions
  for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_delete on public.missions
  for delete to authenticated
  using (workspace_id in (select workspace_id from public.brand_users bu where bu.user_id = auth.uid() and bu.active and bu.role = 'owner'));
```

- [ ] **Step 2: Apply to the local stack and verify**

Run:
```bash
supabase db reset   # or: psql "$DATABASE_URL" -f supabase/migrations/0023_brand_access.sql
psql "$DATABASE_URL" -c "\dt public.brand_*"
```
Expected: `brand_invites` and `brand_users` listed; no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0023_brand_access.sql
git commit -m "feat(brand): add brand_invites + brand_users tables and missions RLS (0023)"
```

---

## Task 2: `resolveBrand` + types (TDD)

**Files:** Create `server/lib/brandAuth.ts`, `server/lib/brandAuth.test.ts`

- [ ] **Step 1: Write the failing test** (`server/lib/brandAuth.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { resolveBrand, type BrandRow } from "./brandAuth";

// Minimal fake of the supabase query builder used by resolveBrand.
function fakeClient(row: BrandRow | null, error: unknown = null) {
  return {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: row, error }); },
  } as any;
}

describe("resolveBrand", () => {
  it("returns the active brand membership row", async () => {
    const row: BrandRow = { user_id: "u1", workspace_id: "w1", email: "a@b.co", role: "owner", active: true };
    expect(await resolveBrand(fakeClient(row), "u1")).toEqual(row);
  });
  it("returns null for a deactivated membership (durable revocation)", async () => {
    const row: BrandRow = { user_id: "u1", workspace_id: "w1", email: "a@b.co", role: "member", active: false };
    expect(await resolveBrand(fakeClient(row), "u1")).toBeNull();
  });
  it("returns null when there is no membership row (no auto-promotion)", async () => {
    expect(await resolveBrand(fakeClient(null), "u1")).toBeNull();
  });
  it("throws on a DB error so the caller can surface 500", async () => {
    await expect(resolveBrand(fakeClient(null, { message: "boom" }), "u1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run server/lib/brandAuth.test.ts`
Expected: FAIL ("resolveBrand is not a function" / cannot import).

- [ ] **Step 3: Implement `server/lib/brandAuth.ts` (types + `resolveBrand`)**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export type BrandRole = "owner" | "member";
export type BrandRow = { user_id: string; workspace_id: string; email: string; role: BrandRole; active: boolean };

/** Authenticated brand identity set on the Hono context by requireBrand. */
export type BrandIdentity = { userId: string; email: string; workspaceId: string; role: BrandRole };

/** Hono Env for the brand sub-app (separate from creator + admin). */
export type BrandEnv = { Variables: { brand: BrandIdentity } };

/** Resolve a Supabase user to an ACTIVE brand membership. Unlike resolveStaff there is NO
 *  auto-promotion — a brand exists only if invited (a brand_users row was created on accept).
 *  A deactivated (active=false) row is a durable revocation → null. Throws on DB error. */
export async function resolveBrand(svc: SupabaseClient, userId: string): Promise<BrandRow | null> {
  const { data, error } = await svc
    .from("brand_users")
    .select("user_id, workspace_id, email, role, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as BrandRow | null;
  return row && row.active ? row : null;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run server/lib/brandAuth.test.ts`
Expected: `Tests 4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/brandAuth.ts server/lib/brandAuth.test.ts
git commit -m "feat(brand): add BrandIdentity types + resolveBrand (unit-tested)"
```

---

## Task 3: `requireBrand` middleware + `acceptBrandInvite`

**Files:** Modify `server/lib/brandAuth.ts`; add tests to `server/lib/brandAuth.test.ts`

Read `server/lib/staffAuth.ts` `requireStaff` first to mirror JWT extraction + how the user is read (`supabase.auth.getUser(jwt)` via the service client) and how the identity is set with `c.set(...)`.

- [ ] **Step 1: Add failing tests for `acceptBrandInvite`** (append to `brandAuth.test.ts`)

```typescript
import { acceptBrandInvite } from "./brandAuth";

// Fake builder capturing brand_invites lookup + brand_users upsert + invite update.
function acceptFakes(opts: { invite: any | null; existing: any | null }) {
  const calls: any = { upserted: null, accepted: null };
  const client = {
    from(table: string) { this._t = table; return this; },
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    gt() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() {
      if (this._t === "brand_users") return Promise.resolve({ data: opts.existing, error: null });
      return Promise.resolve({ data: opts.invite, error: null }); // brand_invites
    },
    upsert(v: any) { calls.upserted = v; return { select() { return { single: () => Promise.resolve({ data: v, error: null }) }; } }; },
    update(v: any) { calls.accepted = v; return { eq: () => Promise.resolve({ error: null }) }; },
  } as any;
  return { client, calls };
}

describe("acceptBrandInvite", () => {
  const NOW = "2026-06-27T00:00:00.000Z";
  it("links a new brand from a valid invite and stamps accepted_at", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner" };
    const { client, calls } = acceptFakes({ invite, existing: null });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w1", role: "owner" });
    expect(calls.upserted).toMatchObject({ user_id: "u1", workspace_id: "w1", role: "owner", active: true });
    expect(calls.accepted).toMatchObject({ accepted_at: NOW });
  });
  it("returns the existing membership for a returning brand (no invite needed)", async () => {
    const existing = { user_id: "u1", workspace_id: "w9", email: "brand@x.co", role: "member", active: true };
    const { client } = acceptFakes({ invite: null, existing });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w9", role: "member" });
  });
  it("returns null when there is neither an invite nor a membership", async () => {
    const { client } = acceptFakes({ invite: null, existing: null });
    expect(await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure** (`acceptBrandInvite is not a function`)

Run: `npx vitest run server/lib/brandAuth.test.ts`

- [ ] **Step 3: Implement `acceptBrandInvite` + `requireBrand`** (append to `brandAuth.ts`)

```typescript
import type { Context, MiddlewareHandler } from "hono";
import { serviceClient } from "./supabase.js";

/** Accept-or-resolve: if a brand_users row exists → return its identity (returning brand,
 *  keeps existing workspace). Else consume a valid pending invite for the *verified* email →
 *  create the membership, stamp accepted_at. Else null (no access). `svc` MUST be the service
 *  client (writes brand_users / brand_invites, which are RLS-closed). */
export async function acceptBrandInvite(
  svc: SupabaseClient,
  { userId, email, now }: { userId: string; email: string; now: string },
): Promise<BrandIdentity | null> {
  const existing = await resolveBrand(svc, userId);
  if (existing) return { userId, email: existing.email, workspaceId: existing.workspace_id, role: existing.role };

  const lower = email.toLowerCase();
  const { data: invite, error } = await svc
    .from("brand_invites")
    .select("id, email, workspace_id, role")
    .eq("email", lower)
    .is("accepted_at", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!invite) return null;

  const { data: row, error: upErr } = await svc
    .from("brand_users")
    .upsert({ user_id: userId, workspace_id: invite.workspace_id, email: lower, role: invite.role, active: true }, { onConflict: "user_id" })
    .select("user_id, workspace_id, email, role, active")
    .single();
  if (upErr) throw upErr;
  await svc.from("brand_invites").update({ accepted_at: now }).eq("id", invite.id);
  const r = row as BrandRow;
  return { userId, email: r.email, workspaceId: r.workspace_id, role: r.role };
}

/** Hono middleware: verify the bearer JWT (via the service client's auth.getUser), resolve an
 *  ACTIVE brand membership, set it on the context. 401 (no/invalid token) / 403 (not a brand).
 *  Mirror server/lib/staffAuth.ts requireStaff for the exact token-extraction idiom. */
export function requireBrand(): MiddlewareHandler<BrandEnv> {
  return async (c: Context<BrandEnv>, next) => {
    const auth = c.req.header("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return c.json({ error: "unauthorized", code: "no_token" }, 401);
    const svc = serviceClient();
    const { data: userData, error } = await svc.auth.getUser(jwt);
    if (error || !userData.user) return c.json({ error: "unauthorized", code: "bad_token" }, 401);
    const row = await resolveBrand(svc, userData.user.id);
    if (!row) return c.json({ error: "not a brand", code: "not_brand" }, 403);
    c.set("brand", { userId: row.user_id, email: row.email, workspaceId: row.workspace_id, role: row.role });
    await next();
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run server/lib/brandAuth.test.ts`
Expected: all pass (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/brandAuth.ts server/lib/brandAuth.test.ts
git commit -m "feat(brand): add requireBrand middleware + acceptBrandInvite (unit-tested)"
```

---

## Task 4: Brand routes — `/brand/me`, `/brand/accept`, mission CRUD

**Files:** Create `server/routes/brand.ts`; Modify `server/app.ts`

Read `server/routes/admin.ts` and the admin mission route file to mirror the CRUD shape and confirm `missionAuthoring.ts` validator signatures (`validateMission`, `validateEdit`). Mission writes go through `makeUserClient(jwt)` so RLS scopes them; `workspace_id` is taken from `c.var.brand.workspaceId`, never the request body.

- [ ] **Step 1: Create `server/routes/brand.ts`**

```typescript
import { Hono } from "hono";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { requireBrand, acceptBrandInvite, type BrandEnv } from "../lib/brandAuth.js";
import { validateMission, validateEdit } from "../lib/missionAuthoring.js";

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

export const brandRoutes = new Hono();

// --- Unguarded: accept (creates membership) ----------------------------------
brandRoutes.post("/accept", async (c) => {
  const jwt = bearer(c);
  if (!jwt) return c.json({ error: "unauthorized", code: "no_token" }, 401);
  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(jwt);
  if (error || !data.user?.email) return c.json({ error: "unauthorized", code: "bad_token" }, 401);
  const now = new Date().toISOString();
  const identity = await acceptBrandInvite(svc, { userId: data.user.id, email: data.user.email, now });
  if (!identity) return c.json({ error: "no brand access", code: "not_brand" }, 403);
  return c.json({ brand: identity });
});

// --- Guarded brand API -------------------------------------------------------
const guarded = new Hono<BrandEnv>();
guarded.use("*", requireBrand());

guarded.get("/me", async (c) => {
  const b = c.var.brand;
  const svc = serviceClient();
  const { data } = await svc.from("workspaces").select("name").eq("id", b.workspaceId).maybeSingle();
  return c.json({ brand: { email: b.email, workspaceId: b.workspaceId, workspaceName: data?.name ?? "", role: b.role } });
});

guarded.get("/missions", async (c) => {
  const b = c.var.brand;
  const status = c.req.query("status") || "";
  let q = makeUserClient(bearer(c)).from("missions")
    .select("id, slug, title, status, mission_type, points_reward, cash_reward, filled, quota, deadline")
    .eq("workspace_id", b.workspaceId).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ missions: data ?? [] });
});

guarded.post("/missions", async (c) => {
  const b = c.var.brand;
  const body = await c.req.json();
  const result = validateMission(body); // pure: returns { ok, value } | { ok:false, errors }
  if (!result.ok) return c.json({ error: "validation", code: "validation", details: result.errors }, 422);
  const { data, error } = await makeUserClient(bearer(c)).from("missions")
    .insert({ ...result.value, workspace_id: b.workspaceId, status: "draft" })
    .select("id").single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ mission: { id: data.id } }, 201);
});

guarded.put("/missions/:id", async (c) => {
  const body = await c.req.json();
  const result = validateEdit(body);
  if (!result.ok) return c.json({ error: "validation", code: "validation", details: result.errors }, 422);
  const { data, error } = await makeUserClient(bearer(c)).from("missions")
    .update(result.value).eq("id", c.req.param("id")).select("id").maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not found", code: "not_found" }, 404); // RLS hid a cross-workspace row
  return c.json({ mission: { id: data.id } });
});

function statusMutation(next: "active" | "closed") {
  return async (c: any) => {
    const { data, error } = await makeUserClient(bearer(c)).from("missions")
      .update({ status: next }).eq("id", c.req.param("id")).select("id").maybeSingle();
    if (error) return c.json({ error: error.message, code: "db_error" }, 500);
    if (!data) return c.json({ error: "not found", code: "not_found" }, 404);
    return c.json({ mission: { id: data.id, status: next } });
  };
}
guarded.post("/missions/:id/publish", statusMutation("active"));
guarded.post("/missions/:id/close", statusMutation("closed"));

guarded.delete("/missions/:id", async (c) => {
  // Draft-only + owner-only (owner enforced by RLS delete policy).
  const uc = makeUserClient(bearer(c));
  const { data: m } = await uc.from("missions").select("id, status").eq("id", c.req.param("id")).maybeSingle();
  if (!m) return c.json({ error: "not found", code: "not_found" }, 404);
  if (m.status !== "draft") return c.json({ error: "only drafts can be deleted", code: "not_draft" }, 422);
  const { error } = await uc.from("missions").delete().eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

brandRoutes.route("/", guarded);
```

> Note: if `validateMission`/`validateEdit` return a different shape than `{ ok, value, errors }` (confirm by reading `server/lib/missionAuthoring.ts`), adapt the three call sites accordingly — keep the rest identical. Duplicate-mission (`/duplicate`) is omitted from Slice 1 to avoid re-deriving the staff duplicate logic; add it in a follow-up if brands need it.

- [ ] **Step 2: Mount in `server/app.ts`**

Add the import near the other route imports:
```typescript
import { brandRoutes } from "./routes/brand.js";
```
Mount it alongside the existing app mounts (mirror how `/admin` is mounted — `/brand` is unguarded at the mount; guarding is inside `brandRoutes`):
```typescript
app.route("/api/brand", brandRoutes);
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check 2>&1 | grep -iE "error|brand" | head`
Expected: no errors. Fix validator-shape mismatches if any.

- [ ] **Step 4: Commit**

```bash
git add server/routes/brand.ts server/app.ts
git commit -m "feat(brand): add /brand mission CRUD + accept + me (user-JWT, RLS-scoped)"
```

---

## Task 5: Operator invite endpoint

**Files:** Create `server/routes/adminBrandInvites.ts`; Modify `server/app.ts`

Mirror an existing staff-gated admin route to inherit `requireStaff` (the `/admin` sub-app already applies it).

- [ ] **Step 1: Create `server/routes/adminBrandInvites.ts`**

```typescript
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY_MS = 86_400_000;

export const adminBrandInviteRoutes = new Hono<AdminEnv>();

// POST /admin/brand-invites { email, workspace_id, role }
adminBrandInviteRoutes.post("/brand-invites", async (c) => {
  const { email, workspace_id, role } = await c.req.json().catch(() => ({}));
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(e)) return c.json({ error: "invalid email", code: "validation" }, 422);
  if (typeof workspace_id !== "string" || !workspace_id) return c.json({ error: "workspace_id required", code: "validation" }, 422);
  const r = role === "owner" ? "owner" : "member";

  const svc = serviceClient();
  const { error: insErr } = await svc.from("brand_invites").insert({
    email: e, workspace_id, role: r,
    invited_by_staff: c.var.staff.userId,
    expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  });
  if (insErr) return c.json({ error: insErr.message, code: "db_error" }, 500);

  // Send the magic-link (Supabase's configured email). Best-effort: the invite row is the
  // authorization; if email send fails the brand can still request a link at /brand/login.
  const origin = c.req.header("Origin") ?? "";
  const { error: otpErr } = await svc.auth.signInWithOtp({
    email: e,
    options: { emailRedirectTo: `${origin}/brand/auth/callback` },
  });
  return c.json({ ok: true, emailed: !otpErr });
});
```

- [ ] **Step 2: Register under `/admin` in `server/app.ts`** (so it inherits `requireStaff`)

Add the import and register alongside the other admin sub-routes (mirror `adminRoutes.route("/", adminRadarRoutes)`):
```typescript
import { adminBrandInviteRoutes } from "./routes/adminBrandInvites.js";
// ...
adminRoutes.route("/", adminBrandInviteRoutes);
```

- [ ] **Step 3: Type-check + commit**

```bash
npm run type-check 2>&1 | grep -iE "error" | head
git add server/routes/adminBrandInvites.ts server/app.ts
git commit -m "feat(brand): staff-gated POST /admin/brand-invites + magic-link"
```

---

## Task 6: Integration tests — the RLS isolation proof

**Files:** Create `server/test/brand.test.ts`; Modify `package.json`

Read `server/test/helpers` for `makeStaff`, `makeCreator`, `cleanup`, `hasSupabaseEnv`, and how a JWT is obtained for a seeded user. Add brand helpers as needed (a `makeBrand(email, workspaceId, role)` that creates an auth user + `brand_users` row + returns `{ userId, jwt, workspaceId }`, and `seedMission(workspaceId, fields)`).

- [ ] **Step 1: Create `server/test/brand.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeBrand, seedMission, makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;
const req = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, { ...init, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

suite("brand portal", () => {
  let A: any, B: any, missionA: any;
  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("brandA@test.local", undefined, "owner"); // helper creates workspace if not given
    B = await makeBrand("brandB@test.local", undefined, "owner");
    missionA = await seedMission(A.workspaceId, { slug: "a-mission", title: "A Mission", status: "draft" });
  });
  afterAll(cleanup);

  it("401 without a token", async () => {
    expect((await app.request("/api/brand/me")).status).toBe(401);
  });

  it("a brand sees only its own workspace missions", async () => {
    const res = await req("/brand/missions", A.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    expect(missions.every((m: any) => m.id !== undefined)).toBe(true);
    expect(missions.some((m: any) => m.slug === "a-mission")).toBe(true);
    // Brand B must NOT see A's mission.
    const resB = await req("/brand/missions", B.jwt);
    const bodyB = await resB.json();
    expect(bodyB.missions.some((m: any) => m.slug === "a-mission")).toBe(false);
  });

  it("a brand cannot edit another workspace's mission (RLS → 404)", async () => {
    const res = await req(`/brand/missions/${missionA.id}`, B.jwt, { method: "PUT", body: JSON.stringify({ title: "hacked" }) });
    expect(res.status).toBe(404);
  });

  it("accept without an invite returns 403", async () => {
    const stranger = await makeCreator("stranger@test.local", 0); // an auth user, no brand invite
    const res = await app.request("/api/brand/accept", { method: "POST", headers: { Authorization: `Bearer ${stranger.jwt}` } });
    expect(res.status).toBe(403);
  });

  it("a revoked brand (active=false) is denied", async () => {
    await A.deactivate(); // helper sets brand_users.active=false
    expect((await req("/brand/me", A.jwt)).status).toBe(403);
  });

  it("creator mission reads still work after adding brand RLS policies", async () => {
    const koc = await makeCreator("koc@test.local", 0);
    const res = await req("/missions", koc.jwt); // existing creator endpoint
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Append to `package.json` `test:integration` file list**

Append ` server/test/brand.test.ts` before the closing quote of the `test:integration` script's file list.

- [ ] **Step 3: Run (skips without local stack) / run against `.env.test.local`**

Run: `npx vitest run server/test/brand.test.ts 2>&1 | tail -5`
Expected: skipped without `hasSupabaseEnv`; with the local stack + `0023` applied, all pass.

- [ ] **Step 4: Commit**

```bash
git add server/test/brand.test.ts package.json server/test/helpers*
git commit -m "test(brand): RLS two-workspace isolation + invite/accept/revoke integration"
```

---

## Task 7: Client lib — `brandFetch` + types

**Files:** Create `src/lib/brand.ts`

Mirror `src/lib/admin.ts` but: (a) base path `/api/brand`; (b) attach the **user's** Supabase JWT (read the session via `supabase.auth.getSession()` like `src/lib/api.ts` `apiFetch` does) — brands authenticate as real users, so there is no admin-secret path; (c) a `BrandAuthError` for 401/403.

- [ ] **Step 1: Create `src/lib/brand.ts`**

```typescript
import { supabase } from "@/lib/supabase";

export class BrandAuthError extends Error {}
export type BrandMe = { email: string; workspaceId: string; workspaceName: string; role: "owner" | "member" };
export type BrandMission = { id: string; slug: string; title: string; status: string; mission_type: string; points_reward: number; cash_reward: number | null; filled: number; quota: number; deadline: string | null };

export const brandKeys = {
  me: () => ["brand-me"] as const,
  missions: (status: string) => ["brand-missions", status] as const,
};

async function brandFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/brand${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 401 || res.status === 403) throw new BrandAuthError(String(res.status));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const fetchBrandMe = () => brandFetch<{ brand: BrandMe }>("/me");
export const acceptBrand = () => brandFetch<{ brand: BrandMe }>("/accept", { method: "POST" });
export const fetchBrandMissions = (status = "") =>
  brandFetch<{ missions: BrandMission[] }>(`/missions${status ? `?status=${status}` : ""}`);
export const publishBrandMission = (id: string) => brandFetch(`/missions/${id}/publish`, { method: "POST" });
export const closeBrandMission = (id: string) => brandFetch(`/missions/${id}/close`, { method: "POST" });
export const deleteBrandMission = (id: string) => brandFetch(`/missions/${id}`, { method: "DELETE" });
```

- [ ] **Step 2: Type-check + commit**

```bash
npm run type-check 2>&1 | grep -iE "error" | head
git add src/lib/brand.ts
git commit -m "feat(brand): client brandFetch + keys + types"
```

---

## Task 8: BrandAuthContext + BrandAuthGate

**Files:** Create `src/components/brand/BrandAuthContext.tsx`, `src/components/brand/BrandAuthGate.tsx`

Mirror `src/components/admin/AdminAuthContext.tsx` and `StaffAuthGate.tsx`. The gate resolves `GET /brand/me`; on `BrandAuthError` it shows the no-access screen with a sign-out + link to `/brand/login`.

- [ ] **Step 1: Create `BrandAuthContext.tsx`**

```typescript
import { createContext, useContext } from "react";
import type { BrandMe } from "@/lib/brand";

export type BrandAuth = { brand: BrandMe; reportAuthError: (e: unknown) => void };
export const BrandAuthContext = createContext<BrandAuth | null>(null);
export function useBrandAuth(): BrandAuth {
  const ctx = useContext(BrandAuthContext);
  if (!ctx) throw new Error("useBrandAuth must be used within BrandAuthGate");
  return ctx;
}
```

- [ ] **Step 2: Create `BrandAuthGate.tsx`** (mirror `StaffAuthGate` structure: `useQuery(brandKeys.me(), fetchBrandMe)`; phases loading / no-access / authed; render-prop `children(brand)`). Use `useI18n` for copy keys `app.brand.authPrompt`, `app.brand.noAccess`, `app.brand.signOut`. On a `BrandAuthError` show the no-access card with a "go to login" link (`/brand/login`) and a `supabase.auth.signOut()` button.

```typescript
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { brandKeys, fetchBrandMe, BrandAuthError, type BrandMe } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export function BrandAuthGate({ children }: { children: (brand: BrandMe) => ReactNode }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: brandKeys.me(), queryFn: fetchBrandMe, retry: false });
  if (q.isLoading) return <div className="p-8 text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</div>;
  if (q.error) {
    const denied = q.error instanceof BrandAuthError;
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.brand.title")}</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">{t(denied ? "app.brand.noAccess" : "app.brand.loadError")}</p>
        <a href="/brand/login" className="block rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold">{t("app.brand.toLogin")}</a>
        <button type="button" onClick={() => supabase.auth.signOut()} className="text-xs underline">{t("app.brand.signOut")}</button>
      </div>
    );
  }
  return <>{children(q.data!.brand)}</>;
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npm run type-check 2>&1 | grep -iE "error" | head
git add src/components/brand/BrandAuthContext.tsx src/components/brand/BrandAuthGate.tsx
git commit -m "feat(brand): BrandAuthContext + BrandAuthGate"
```

---

## Task 9: `/brand` layout + nav

**Files:** Create `src/components/brand/BrandNav.tsx`, `src/routes/brand.tsx`

Mirror `src/routes/admin.tsx` (gate → context provider → nav + `<Outlet/>`). Nav is a minimal `BrandNav` (reuse the responsive Side/Bottom pattern from `src/components/SideNav.tsx`/`BottomNav.tsx`) with two items: `{ to: "/brand", label 概覽 }`, `{ to: "/brand/missions", label 任務 }`. No workspace switcher.

- [ ] **Step 1: Create `BrandNav.tsx`** — two-item nav (icons `LayoutDashboard`, `Target` from lucide), active styling matching the admin nav idiom (`border-2`, acid active).

- [ ] **Step 2: Create `src/routes/brand.tsx`**

```typescript
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { BrandAuthGate } from "@/components/brand/BrandAuthGate";
import { BrandAuthContext } from "@/components/brand/BrandAuthContext";
import { BrandNav } from "@/components/brand/BrandNav";

export const Route = createFileRoute("/brand")({ component: BrandLayout });

function BrandLayout() {
  const [, setAuthError] = useState<unknown>(null);
  return (
    <BrandAuthGate>
      {(brand) => (
        <BrandAuthContext.Provider value={{ brand, reportAuthError: setAuthError }}>
          <div className="min-h-screen bg-[var(--color-paper)] lg:pl-60">
            <BrandNav />
            <main className="mx-auto max-w-5xl space-y-4 p-4"><Outlet /></main>
          </div>
        </BrandAuthContext.Provider>
      )}
    </BrandAuthGate>
  );
}
```

- [ ] **Step 3: Type-check (runs tsr generate) + commit**

```bash
npm run type-check 2>&1 | grep -iE "error|brand" | head
git add src/components/brand/BrandNav.tsx src/routes/brand.tsx
git commit -m "feat(brand): /brand layout + nav shell"
```

---

## Task 10: Login + auth callback (magic-link)

**Files:** Create `src/routes/brand.login.tsx`, `src/routes/brand.auth.callback.tsx`

Mirror `src/routes/_app.login.tsx` (email magic-link branch) and `_app.auth.callback.tsx`. The brand login is NOT under the `/brand` gate (it's a sibling route the gate links to) — but TanStack nests it under `brand.tsx`; render login/callback WITHOUT requiring the gate by giving them their own minimal component that doesn't depend on `BrandAuthContext`. Since `brand.tsx` wraps everything in `BrandAuthGate`, instead make login/callback **top-level** routes outside the `/brand` gate: name them `brand_.login.tsx` and `brand_.auth.callback.tsx` (the `brand_` trailing-underscore escapes nesting in TanStack), or place the gate logic in `brand.index`/`brand.missions` routes individually. **Chosen approach:** use `brand_.login.tsx` + `brand_.auth.callback.tsx` so they render outside the gate.

- [ ] **Step 1: Create `src/routes/brand_.login.tsx`** — email input → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/brand/auth/callback" } })`; show "check your email" state. Mirror the magic-link branch of `_app.login.tsx`.

- [ ] **Step 2: Create `src/routes/brand_.auth.callback.tsx`** — on mount: `supabase.auth.exchangeCodeForSession(window.location.href)` (mirror `_app.auth.callback.tsx`), then call `acceptBrand()` from `@/lib/brand`, then `router.navigate({ to: "/brand" })`; on `BrandAuthError` redirect to `/brand/login` with a message.

- [ ] **Step 3: Type-check + commit**

```bash
npm run type-check 2>&1 | grep -iE "error|brand" | head
git add src/routes/brand_.login.tsx src/routes/brand_.auth.callback.tsx
git commit -m "feat(brand): magic-link login + accept callback"
```

---

## Task 11: Dashboard + mission list + editor

**Files:** Create `src/routes/brand.index.tsx`, `src/routes/brand.missions.index.tsx`, `src/routes/brand.missions.new.tsx`, `src/routes/brand.missions.$missionId.tsx`

- [ ] **Step 1: `brand.index.tsx`** — `useBrandAuth()` for `workspaceName`; `useQuery(brandKeys.missions(""), () => fetchBrandMissions())` for a count; render a heading, the mission count, and a `<Link to="/brand/missions">` + a "新任務" `<Link to="/brand/missions/new">`. Acid Y2K cards.

- [ ] **Step 2: `brand.missions.index.tsx`** — mirror `src/routes/admin.missions.index.tsx`: status filter, list rows (title, status chip, slug · points · filled/quota · deadline), action buttons wired to `publishBrandMission`/`closeBrandMission`/`deleteBrandMission` (+ `<Link>` edit to `/brand/missions/$missionId`, `<Link>` new). Use `brandKeys.missions(status)` + `fetchBrandMissions(status)`. On `BrandAuthError` call `reportAuthError`.

- [ ] **Step 3: `brand.missions.new.tsx` + `brand.missions.$missionId.tsx`** — render the reused `MissionEditor` component (from `src/components/admin/MissionEditor.tsx`); for create, submit via `brandFetch` `POST /missions`; for edit, load the mission (add `fetchBrandMission(id)` to `src/lib/brand.ts` → `GET /missions` filtered, or a new `GET /brand/missions/:id` — **add that read endpoint to `server/routes/brand.ts` if MissionEditor needs the full row**) and submit via `PUT /missions/:id`. Confirm `MissionEditor`'s props by reading the component; pass brand submit handlers.

  > If `MissionEditor` is tightly coupled to admin fetchers, extract its presentational form into a shared component in this step (note the split in the commit). Keep the validation pure (`missionAuthoring.ts`) shared.

- [ ] **Step 4: Type-check + commit**

```bash
npm run type-check 2>&1 | grep -iE "error|brand" | head
git add src/routes/brand.index.tsx src/routes/brand.missions.*.tsx server/routes/brand.ts src/lib/brand.ts
git commit -m "feat(brand): dashboard + mission list + authoring (reuse MissionEditor)"
```

---

## Task 12: i18n keys (en + zh)

**Files:** Modify `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add `app.brand.*` keys to BOTH the `en` and `zh` sections** (parity is build-enforced). Keys: `app.brand.title`, `app.brand.authPrompt`, `app.brand.noAccess`, `app.brand.loadError`, `app.brand.toLogin`, `app.brand.signOut`, `app.brand.navDashboard`, `app.brand.navMissions`, `app.brand.dashboardHeading`, `app.brand.missionCount`, `app.brand.newMission`, `app.brand.loginHeading`, `app.brand.loginEmailLabel`, `app.brand.loginSend`, `app.brand.loginCheckEmail`, `app.brand.callbackWorking`, `app.brand.callbackFailed`.

en values (examples): `"app.brand.title": "Brand Portal"`, `"app.brand.noAccess": "No brand access — contact your Fimmick representative."`, `"app.brand.navMissions": "Missions"`, `"app.brand.newMission": "New mission"`, …
zh values: `"app.brand.title": "品牌平台"`, `"app.brand.noAccess": "沒有品牌存取權 — 請聯絡你的 Fimmick 對接人。"`, `"app.brand.navMissions": "任務"`, `"app.brand.newMission": "新任務"`, …

- [ ] **Step 2: Verify parity + commit**

Run: `npx vitest run src/lib/i18n.test.tsx 2>&1 | tail -3`
Expected: pass (no parity failure).
```bash
git add src/lib/i18n.dict.ts
git commit -m "feat(brand): add app.brand.* i18n keys (en + zh)"
```

---

## Task 13: Route-stub tests

**Files:** Create `src/routes/-brand.test.tsx`

Mirror `src/routes/-admin.radar.test.tsx`: mock `@/lib/brand` (`fetchBrandMe`, `fetchBrandMissions`, `brandKeys`, `BrandAuthError`) and render the gate + mission list components.

- [ ] **Step 1: Write tests** — (a) `BrandAuthGate` shows loading then renders children when `fetchBrandMe` resolves; (b) on `BrandAuthError` shows the no-access copy + login link; (c) mission list renders a seeded mission title and the status chip.

- [ ] **Step 2: Run — expect pass**

Run: `npx vitest run src/routes/-brand.test.tsx`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/routes/-brand.test.tsx
git commit -m "test(brand): gate + mission-list route stubs"
```

---

## Task 14: Full gate pass + PR

- [ ] **Step 1: Full suite + gates**

```bash
npm test 2>&1 | tail -6
npm run type-check && npm run lint && npm run build 2>&1 | tail -8
```
Expected: all green. `build` runs `check:esm` — ensure every relative import in `server/**` (incl. `brand.ts`, `brandAuth.ts`, `adminBrandInvites.ts`) ends in `.js`.

- [ ] **Step 2: (If `.env.test.local`) integration**

```bash
export $(cat .env.test.local | xargs)
npm run test:integration 2>&1 | tail -12
```
Expected: brand suite passes (or auto-skips without a local stack).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/brand-portal-slice1
gh pr create --base main --title "feat: Brand Portal Slice 1 — brand access + self-serve authoring" --body "$(cat <<'EOF'
## Summary
- Operator-invited brands log in via magic-link and land on a dedicated /brand portal locked to their workspace
- New brand_invites + brand_users tables; missions RLS scoped by membership (migration 0023)
- requireBrand middleware + acceptBrandInvite; brand mission CRUD runs as the user JWT (makeUserClient) so RLS enforces isolation
- /brand route shell (BrandAuthGate, nav, dashboard, mission list + reused MissionEditor)
- Staff-gated POST /admin/brand-invites
- NO Slice-2 review/approval (payout writes) — separate spec

## Test plan
- [ ] npm test / type-check / lint / build green
- [ ] Integration: two-brand RLS isolation, invite→accept, no-invite 403, revoked 403, creator reads unaffected
- [ ] Apply 0023 to prod BEFORE deploy + `notify pgrst,'reload schema'`
- [ ] Set nothing new in Vercel (reuses Supabase email/keys)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** ✅ tables + RLS (Task 1) · resolveBrand/requireBrand/accept (Tasks 2-3) · user-JWT mission CRUD (Task 4) · invite + magic-link (Task 5) · RLS isolation + creator-unaffected + revoke + no-invite (Task 6) · `/brand` shell, gate, nav, login/callback, dashboard, list, editor (Tasks 8-11) · i18n (12) · tests (6, 13) · migration-before-deploy + no new env (Task 1/14). One-workspace-per-user enforced by `brand_users` PK (Task 1).

**Known confirm-on-implement points (read the file, then match):** (a) `missionAuthoring.ts` validator return shape (Task 4 note); (b) `MissionEditor` props / whether to extract its form (Task 11 note); (c) `requireStaff` token-extraction idiom (Task 3); (d) test-helper JWT minting + add `makeBrand`/`seedMission` (Task 6); (e) `/admin` mount idiom in `server/app.ts` (Tasks 4-5).

**Type consistency:** `BrandIdentity { userId, email, workspaceId, role }` used in `requireBrand`, `acceptBrandInvite`, `/brand/me`. `BrandMe { email, workspaceId, workspaceName, role }` (adds `workspaceName`, drops `userId`) is the client/wire shape from `GET /brand/me` — intentionally distinct from the server `BrandIdentity`. `brandKeys.me()`/`.missions(status)` consistent between `src/lib/brand.ts` and consumers.
