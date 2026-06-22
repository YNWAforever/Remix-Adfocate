# B3a — Staff Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim shared `ADMIN_SECRET` gate on `/admin/*` with real per-staff-user Google login backed by a `staff_users` allowlist, keeping the secret as a one-release break-glass fallback.

**Architecture:** A single Hono middleware (`requireStaff`) on `adminRoutes` checks the break-glass secret first, then verifies the Supabase JWT (`makeUserClient(jwt).auth.getUser()`) and resolves the user against `staff_users` (auto-promoting allow-listed emails on first login). Staff are global (full cross-workspace access). The frontend swaps the secret-prompt `OperatorAuthGate` for a Google-SSO `StaffAuthGate`; `adminFetch` switches from `x-admin-secret` to `Authorization: Bearer`. Enforcement stays app-layer (RLS multi-tenant isolation is deferred to B3b).

**Tech Stack:** Hono + Supabase Auth (Google OAuth, PKCE) + `@supabase/supabase-js`, React 19 + TanStack Router/Query, Vitest + React Testing Library. Supabase migration `0020`.

**Spec:** `docs/superpowers/specs/2026-06-22-brand-b3a-staff-auth-design.md`

**Two refinements to the spec, decided during planning (both flagged to the user):**
1. **Spec §5.4 omitted the standalone `operator.*` drill-in routes.** `src/routes/operator.missions.$missionId.tsx` and `operator.creators.$creatorId.tsx` gate on `getAdminSecret()` via local `useState`, and `src/routes/operator.tsx` is a bare `<Outlet/>` with no `AdminAuthContext` provider. The cutover wraps `operator.tsx` in the same `StaffAuthGate` + provider as `/admin` and converts those two routes to `useAdminAuth().authed`, so the dashboard's drill-in links keep working. (Task 13.)
2. **Spec §4.4 ("stop trusting client headers") would break `operator-crm.test.ts` under break-glass.** That test sends `x-operator-id`/`x-operator-label` and asserts them in `operator_audit_events`. Resolution: on the **break-glass path only** (`staff.viaSecret === true`) keep honoring those headers; on the **JWT staff path** always use the authenticated `userId`/`email`. Break-glass is itself a trusted shared secret, so this loses no real security and keeps the existing test green. (Task 6.)

---

## File Structure

**Backend — create:**
- `supabase/migrations/0020_staff_auth.sql` — `staff_users` allowlist table (RLS closed, service-role only).
- `server/lib/staffAuth.ts` — `StaffIdentity`/`AdminEnv`/`StaffUser` types, pure `parseAllowlist`, DB-glue `resolveStaff`.
- `server/test/staffAuth.test.ts` — unit tests for `parseAllowlist` + `resolveStaff` (stub client).
- `server/test/admin-staff.test.ts` — integration tests for `requireStaff` + `GET /admin/me` + audit attribution.

**Backend — modify:**
- `server/routes/admin.ts` — replace the secret middleware with `requireStaff`; type `adminRoutes` as `Hono<AdminEnv>`; add `GET /admin/me`.
- `server/routes/adminOperatorCrm.ts` — build `OperatorContext` from `c.get("staff")` (break-glass header fallback).
- `server/test/helpers.ts` — add `makeStaff()` + extend `cleanup()` to remove test staff users.

**Frontend — create:**
- `src/components/admin/StaffAuthGate.tsx` — Google-SSO gate replacing `OperatorAuthGate` on the admin surfaces.
- `src/components/admin/StaffAuthGate.test.tsx` — gate behavior tests.
- `src/routes/-app.auth.callback.test.tsx` — asserts staff callback skips creator bootstrap.

**Frontend — modify:**
- `src/components/admin/AdminAuthContext.tsx` — `secret` → `authed` + `staff`.
- `src/lib/admin.ts` — `adminFetch` Bearer; remove `getAdminSecret`/`setAdminSecret`/`clearAdminSecret`.
- `src/lib/admin.test.ts` — rewrite `adminFetch` tests for Bearer + 401 behavior.
- `src/routes/admin.tsx` — mount `StaffAuthGate` + provide `{ authed, staff, reportAuthError }`.
- `src/routes/operator.tsx` — wrap in `StaffAuthGate` + `AdminAuthContext.Provider` + `AdminWorkspaceProvider`.
- `src/routes/_app.auth.callback.tsx` — branch on `?next` (skip `finishAuth` for `/admin`).
- All `enabled: !!secret` consumers → `enabled: authed` (Task 12 lists exact files).
- `src/lib/i18n.dict.ts` — staff sign-in / not-authorized / sign-out keys (en + zh-HK).
- Frontend shell tests mocking `{ secret: "s" }` or `getAdminSecret` → new shape (Task 14 lists exact files).

**No change:** `server/routes/adminMissions.ts`, `server/lib/operatorCrm/repo.ts`, all `/admin/*` handler logic, the B2 `WorkspaceSwitcher`/`MissionManage`/`MissionEditor`/`?workspace=` behavior (only their `enabled` gate flips). `server/test/admin.test.ts` + `operator-crm.test.ts` stay green via break-glass.

---

## Pre-flight (executor reads first)

- **Branch:** This plan must be implemented on a branch cut from `main` **after B2's PR #36 merges** (B3a edits B2 code: `admin.tsx`, `admin.ts`, `AdminAuthContext.tsx`, the tab routes). Create `feat/brand-b3a-staff-auth` off the freshly-merged `main`. Commit the design spec + this plan as the first commit on that branch.
- **Local Supabase** must be running (`supabase start`). Local DB (host side): `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; container name `supabase_db_adfocate-2`. There is no `psql` on PATH — run it inside the container (see Task 1).
- **Integration tests** read a gitignored `.env.test.local` (local stack creds). Run them with:
  `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/<file>`
  (They `describe.skip` when `hasSupabaseEnv` is false — a green-but-skipped run is not a pass; confirm the tests actually executed.)
- **ESM rule:** every new/edited **server** relative import must end in `.js` (CI guard `scripts/check-esm-extensions.mjs`).
- **Supabase MCP is wired to CLOUD prod (`mhkoayftiuojxlrkollf`)** — never use it for local DB work. Local schema changes go through the container psql command in Task 1.
- **Type-check** for new TanStack routes runs `tsr generate` — use `npm run type-check`, not bare `tsc`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Migration `0020_staff_auth.sql` + apply to local

**Files:**
- Create: `supabase/migrations/0020_staff_auth.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0020_staff_auth.sql
-- Slice B3a: staff identity allowlist. A row here (active) = Fimmick staff with full
-- cross-workspace admin access. Read only by the server via the service client, so RLS
-- is closed by default (no authenticated/anon policies); the frontend learns staff status
-- via GET /admin/me, never by querying this table directly.
create table public.staff_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;
-- service_role bypasses RLS; no policies for authenticated/anon = they cannot read it.
grant all on public.staff_users to service_role;
```

- [ ] **Step 2: Apply to the local stack**

Run:
```bash
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres < supabase/migrations/0020_staff_auth.sql
```
Expected: `CREATE TABLE`, `ALTER TABLE`, `GRANT`.

- [ ] **Step 3: Verify the table exists locally**

Run:
```bash
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres -c "\d public.staff_users"
```
Expected: columns `user_id` (uuid, PK), `email` (text, not null), `active` (bool, default true), `created_at` (timestamptz). `Row Level Security: enabled`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0020_staff_auth.sql
git commit -m "feat(b3a): staff_users allowlist table (migration 0020)"
```

---

## Task 2: `staffAuth.ts` — types + `parseAllowlist` (pure)

**Files:**
- Create: `server/lib/staffAuth.ts`
- Test: `server/test/staffAuth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../lib/staffAuth";

describe("parseAllowlist", () => {
  it("returns an empty set for undefined/empty/whitespace", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
    expect(parseAllowlist(" , ,").size).toBe(0);
  });

  it("splits on commas, trims, lowercases, drops blanks", () => {
    const set = parseAllowlist("  Alice@Fimmick.com , bob@fimmick.com ,, ");
    expect(set.has("alice@fimmick.com")).toBe(true);
    expect(set.has("bob@fimmick.com")).toBe(true);
    expect(set.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/staffAuth.test.ts`
Expected: FAIL — `parseAllowlist` is not exported / module not found.

- [ ] **Step 3: Write the types + `parseAllowlist`**

Create `server/lib/staffAuth.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

/** Authenticated admin identity set on the Hono context by requireStaff.
 *  viaSecret === true means the break-glass shared secret was used (no real user). */
export type StaffIdentity = { userId: string | null; email: string; viaSecret?: boolean };

/** Hono Env for the admin sub-apps (separate from the creator Env in server/app.ts). */
export type AdminEnv = { Variables: { staff: StaffIdentity } };

export type StaffUser = { user_id: string; email: string; active: boolean; created_at: string };

/** Parse STAFF_EMAIL_ALLOWLIST (comma-separated) into a lowercased Set. Pure. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/staffAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/staffAuth.ts server/test/staffAuth.test.ts
git commit -m "feat(b3a): staffAuth types + parseAllowlist"
```

---

## Task 3: `staffAuth.ts` — `resolveStaff` (DB glue, stub-client unit test)

**Files:**
- Modify: `server/lib/staffAuth.ts`
- Test: `server/test/staffAuth.test.ts:` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/test/staffAuth.test.ts`:
```typescript
import { resolveStaff, type StaffUser } from "../lib/staffAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

// Minimal chainable stub: one builder serves both
// .from().select().eq().eq().maybeSingle() and .from().upsert().select().single().
function stubClient(opts: {
  existing?: StaffUser | null;
  upsertResult?: StaffUser;
  calls?: { upserted?: unknown };
}): SupabaseClient {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: opts.existing ?? null, error: null }),
    upsert: (row: unknown) => {
      if (opts.calls) opts.calls.upserted = row;
      return builder;
    },
    single: () => Promise.resolve({ data: opts.upsertResult ?? null, error: null }),
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

const ROW: StaffUser = { user_id: "u1", email: "a@fimmick.com", active: true, created_at: "2026-01-01T00:00:00Z" };

describe("resolveStaff", () => {
  const ALLOW = "STAFF_EMAIL_ALLOWLIST";
  it("returns the existing active staff row", async () => {
    const out = await resolveStaff(stubClient({ existing: ROW }), "u1", "a@fimmick.com");
    expect(out).toEqual(ROW);
  });

  it("returns null when no row and email not allow-listed", async () => {
    delete process.env[ALLOW];
    const out = await resolveStaff(stubClient({ existing: null }), "u9", "stranger@gmail.com");
    expect(out).toBeNull();
  });

  it("auto-promotes an allow-listed email with no row (upsert)", async () => {
    process.env[ALLOW] = "new@fimmick.com";
    const calls: { upserted?: unknown } = {};
    const promoted: StaffUser = { user_id: "u2", email: "new@fimmick.com", active: true, created_at: "x" };
    const out = await resolveStaff(stubClient({ existing: null, upsertResult: promoted, calls }), "u2", "New@Fimmick.com");
    expect(out).toEqual(promoted);
    expect(calls.upserted).toMatchObject({ user_id: "u2", email: "new@fimmick.com", active: true });
    delete process.env[ALLOW];
  });

  it("returns null when email is null and no row", async () => {
    delete process.env[ALLOW];
    const out = await resolveStaff(stubClient({ existing: null }), "u3", null);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/staffAuth.test.ts`
Expected: FAIL — `resolveStaff` is not exported.

- [ ] **Step 3: Implement `resolveStaff`**

Append to `server/lib/staffAuth.ts`:
```typescript
/**
 * Resolve a Supabase user to a staff identity:
 *  1. active staff_users row → return it;
 *  2. else email ∈ STAFF_EMAIL_ALLOWLIST → upsert + return (first-login auto-promotion);
 *  3. else null.
 * Thin DB glue; throws on a DB error so the caller can surface 500.
 */
export async function resolveStaff(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
): Promise<StaffUser | null> {
  const { data: existing, error } = await svc
    .from("staff_users")
    .select("user_id, email, active, created_at")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing as StaffUser;

  const lower = email?.toLowerCase() ?? "";
  if (lower && parseAllowlist(process.env.STAFF_EMAIL_ALLOWLIST).has(lower)) {
    const { data: upserted, error: upErr } = await svc
      .from("staff_users")
      .upsert({ user_id: userId, email: lower, active: true }, { onConflict: "user_id" })
      .select("user_id, email, active, created_at")
      .single();
    if (upErr) throw upErr;
    return upserted as StaffUser;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/staffAuth.test.ts`
Expected: PASS (all `parseAllowlist` + `resolveStaff` cases).

- [ ] **Step 5: Commit**

```bash
git add server/lib/staffAuth.ts server/test/staffAuth.test.ts
git commit -m "feat(b3a): resolveStaff allowlist auto-promotion"
```

---

## Task 4: `makeStaff` test helper + `cleanup` extension

**Files:**
- Modify: `server/test/helpers.ts`

- [ ] **Step 1: Add `makeStaff` after `makeUser` (around line 90)**

```typescript
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
```

- [ ] **Step 2: Extend `cleanup()` to remove test staff users**

Add this block inside `cleanup()`, **before** the closing brace (after the test-gifts block, ~line 264):
```typescript
  // Test staff users (email "%@test.local") + their auth users.
  const staffRows = await service().from("staff_users").select("user_id").like("email", "%@test.local");
  for (const s of staffRows.data ?? []) {
    await service().from("operator_audit_events").delete().eq("operator_id", s.user_id);
    await service().from("staff_users").delete().eq("user_id", s.user_id);
    await service().auth.admin.deleteUser(s.user_id);
  }
```

- [ ] **Step 3: Type-check (no test yet — exercised in Task 5)**

Run: `npm run type-check`
Expected: PASS (no errors from helpers.ts).

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers.ts
git commit -m "test(b3a): makeStaff helper + staff_users cleanup"
```

---

## Task 5: `requireStaff` middleware + `GET /admin/me` (integration)

**Files:**
- Modify: `server/routes/admin.ts:1-21` (imports + middleware) and add `GET /admin/me`
- Test: `server/test/admin-staff.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `server/test/admin-staff.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeStaff, makeUser, serviceForTests } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function meReq(headers: Record<string, string>) {
  return app.request("/api/admin/me", { headers });
}

suite("requireStaff gate + GET /admin/me", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    delete process.env.STAFF_EMAIL_ALLOWLIST;
    await cleanup();
  });

  it("401 when no token and no secret", async () => {
    const res = await meReq({});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("200 for a valid staff JWT", async () => {
    const staff = await makeStaff("staff-gate@test.local");
    const res = await meReq({ Authorization: `Bearer ${staff.jwt}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staff.userId).toBe(staff.userId);
    expect(body.staff.email).toBe("staff-gate@test.local");
  });

  it("403 not_staff for a valid non-staff JWT", async () => {
    const user = await makeUser({ email: "not-staff@test.local" });
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("not_staff");
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("auto-promotes an allow-listed email on first login", async () => {
    const user = await makeUser({ email: "promote-me@test.local" });
    process.env.STAFF_EMAIL_ALLOWLIST = "promote-me@test.local";
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(200);
    const row = await serviceForTests()
      .from("staff_users").select("user_id, active").eq("user_id", user.userId).maybeSingle();
    expect(row.data?.active).toBe(true);
    delete process.env.STAFF_EMAIL_ALLOWLIST;
    await serviceForTests().from("staff_users").delete().eq("user_id", user.userId);
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("break-glass: x-admin-secret returns the shared-secret sentinel", async () => {
    const res = await meReq({ "x-admin-secret": ADMIN_SECRET });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staff).toEqual({ userId: null, email: "shared-secret" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/admin-staff.test.ts`
Expected: FAIL — `/api/admin/me` 404 (route missing) and the secret middleware returns 401 for valid JWTs. (Confirm the suite is NOT skipped — it must print the 5 test names.)

- [ ] **Step 3: Replace the middleware + type the app + add `/admin/me`**

In `server/routes/admin.ts`, change the imports (lines 1-8) to add staffAuth:
```typescript
import { Hono } from "hono";
import { adminOperatorCrmRoutes } from "./adminOperatorCrm.js";
import { adminMissionRoutes } from "./adminMissions.js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { persistScores } from "../lib/persistScores.js";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
import { markVerified } from "../lib/social/repo.js";
import { resolveStaff, type AdminEnv } from "../lib/staffAuth.js";
```

Replace the `export const adminRoutes = new Hono();` + middleware block (lines 12-21) with:
```typescript
/** Operator/brand admin endpoints. B3a: real per-staff Google login (staff_users),
 *  with the legacy shared secret kept as a one-release break-glass fallback (removed in B3b). */
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.use("*", async (c, next) => {
  // Break-glass (B3b removes this block): the shared secret still grants full access and
  // keeps the existing secret-based test suite + emergency curl working.
  const secret = process.env.ADMIN_SECRET;
  if (secret && c.req.header("x-admin-secret") === secret) {
    c.set("staff", { userId: null, email: "shared-secret", viaSecret: true });
    return next();
  }
  // Primary: Supabase JWT → staff_users (or allowlist auto-promote).
  const auth = c.req.header("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "forbidden", code: "no_admin" }, 401);
  const { data, error } = await makeUserClient(jwt).auth.getUser();
  if (error || !data.user) return c.json({ error: "invalid token", code: "bad_token" }, 401);
  let staff;
  try {
    staff = await resolveStaff(serviceClient(), data.user.id, data.user.email ?? null);
  } catch {
    return c.json({ error: "staff lookup failed", code: "db_error" }, 500);
  }
  if (!staff) return c.json({ error: "not staff", code: "not_staff" }, 403);
  c.set("staff", { userId: staff.user_id, email: staff.email });
  await next();
});

adminRoutes.get("/me", (c) => c.json({ staff: c.get("staff") }));
```

> Note: keep the `viaSecret` flag out of the `/admin/me` body for the JWT path — `c.get("staff")` for JWT staff is `{ userId, email }` (no `viaSecret`), so the break-glass test's `toEqual({ userId: null, email: "shared-secret" })` passes only because break-glass sets exactly those keys. The break-glass branch sets `viaSecret: true`, so `/admin/me` under break-glass returns `{ userId: null, email: "shared-secret", viaSecret: true }`. **Adjust:** strip `viaSecret` in the response so the test matches — change the route to:
> ```typescript
> adminRoutes.get("/me", (c) => {
>   const s = c.get("staff");
>   return c.json({ staff: { userId: s.userId, email: s.email } });
> });
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/admin-staff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm existing secret-based admin tests still pass (break-glass)**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/admin.test.ts`
Expected: PASS (unchanged — `adminreq` sends `x-admin-secret`).

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin.ts server/test/admin-staff.test.ts
git commit -m "feat(b3a): requireStaff gate + GET /admin/me (break-glass fallback)"
```

---

## Task 6: Audit attribution from staff identity

**Files:**
- Modify: `server/routes/adminOperatorCrm.ts:22-29`
- Test: `server/test/admin-staff.test.ts` (append a staff-attribution case)

- [ ] **Step 1: Write the failing test**

Append to the `suite(...)` in `server/test/admin-staff.test.ts` (reuse the existing imports; add `makeCreator` to the import line):
```typescript
  it("audit attribution uses the staff identity, not client headers", async () => {
    const staff = await makeStaff("staff-audit@test.local");
    const creator = await makeCreator("audit-target@test.local");
    // A CRM action (review) as the staff JWT — also send spoofed operator headers.
    const res = await app.request(`/api/admin/creators/${creator.userId}/review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staff.jwt}`,
        "x-operator-id": "SPOOFED",
        "x-operator-label": "Spoofed",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "approved", risk_level: "low" }),
    });
    expect(res.status).toBe(200);
    const audit = await serviceForTests()
      .from("operator_audit_events")
      .select("operator_id, actor_label")
      .eq("creator_id", creator.userId)
      .limit(1)
      .maybeSingle();
    expect(audit.data?.operator_id).toBe(staff.userId);
    expect(audit.data?.actor_label).toBe("staff-audit@test.local");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/admin-staff.test.ts`
Expected: FAIL — `operator_id` is `"SPOOFED"` (headers still trusted).

- [ ] **Step 3: Build `OperatorContext` from the staff identity**

In `server/routes/adminOperatorCrm.ts`, add the typed-context import at the top (after the existing imports):
```typescript
import type { Context } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
```
Replace `operatorContext` (lines 24-29) with:
```typescript
function operatorContext(c: Context<AdminEnv>) {
  const staff = c.get("staff");
  // Break-glass (shared secret) keeps honoring the legacy client headers so the existing
  // secret-based tests + emergency curl preserve their attribution. Real JWT staff always
  // get their unspoofable identity (B3b removes the break-glass branch entirely).
  if (staff.viaSecret) {
    return {
      operatorId: c.req.header("x-operator-id")?.trim() || "shared-secret",
      actorLabel: c.req.header("x-operator-label")?.trim() || "Admin operator",
    };
  }
  return { operatorId: staff.userId!, actorLabel: staff.email };
}
```
Then change the route declaration `export const adminOperatorCrmRoutes = new Hono();` to:
```typescript
export const adminOperatorCrmRoutes = new Hono<AdminEnv>();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/admin-staff.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Confirm `operator-crm.test.ts` is still green (break-glass header fallback)**

Run: `set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test/operator-crm.test.ts`
Expected: PASS — its `adminreq` uses `x-admin-secret` (viaSecret) + `x-operator-id: crm-test`, so `operator_id === "crm-test"` still holds.

- [ ] **Step 6: Commit**

```bash
git add server/routes/adminOperatorCrm.ts server/test/admin-staff.test.ts
git commit -m "feat(b3a): audit attribution from authenticated staff identity"
```

---

## Task 7: Frontend — `AdminAuthContext` shape (`secret` → `authed`/`staff`)

**Files:**
- Modify: `src/components/admin/AdminAuthContext.tsx`

- [ ] **Step 1: Replace the context type + default**

Replace the whole file with:
```typescript
import { createContext, useContext } from "react";

export type AdminStaff = { userId: string | null; email: string };

export type AdminAuth = {
  authed: boolean;
  staff: AdminStaff | null;
  reportAuthError: (error: unknown) => void;
};

export const AdminAuthContext = createContext<AdminAuth>({
  authed: false,
  staff: null,
  reportAuthError: () => {},
});

export function useAdminAuth(): AdminAuth {
  return useContext(AdminAuthContext);
}
```

- [ ] **Step 2: Type-check (consumers still reference `secret` — expected to break in Tasks 11-12; do not run full type-check yet)**

Skip a standalone check here; the consumer flips (Tasks 11-13) and tests (Task 14) restore green. Commit the context change on its own so the diff is reviewable.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminAuthContext.tsx
git commit -m "feat(b3a): AdminAuthContext authed/staff shape"
```

---

## Task 8: Frontend — `adminFetch` → Bearer; drop secret helpers

**Files:**
- Modify: `src/lib/admin.ts:1-4, 150-191`
- Test: `src/lib/admin.test.ts` (rewrite the `adminFetch`/secret cases)

- [ ] **Step 1: Rewrite the failing unit test**

In `src/lib/admin.test.ts`, replace the import of the secret helpers + their tests. The `adminFetch` tests must mock the supabase session and assert a Bearer header. Add at the top of the file (with the other imports):
```typescript
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));
```
Replace any `setAdminSecret(...)`/`getAdminSecret()`/`clearAdminSecret()` usage in the existing `adminFetch` tests with a session mock, e.g.:
```typescript
beforeEach(() => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: "jwt-123" } },
  } as never);
  vi.restoreAllMocks?.();
});

it("sends Authorization: Bearer and no x-admin-secret", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  await adminFetch("/admin/ping");
  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer jwt-123");
  expect(headers["x-admin-secret"]).toBeUndefined();
});

it("throws AdminAuthError on 401 (no secret-clear side effect)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(adminFetch("/admin/ping")).rejects.toBeInstanceOf(AdminAuthError);
});
```
Remove the old test that asserted `getAdminSecret()` is null after a 401, and the `setAdminSecret`/`getAdminSecret` import lines.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: FAIL — `adminFetch` still reads `getAdminSecret()` / sends `x-admin-secret`.

- [ ] **Step 3: Rewrite `adminFetch` + remove the secret helpers**

In `src/lib/admin.ts`:
- Change the file header comment (lines 1-4) to describe Bearer auth and drop the `KEY` constant:
```typescript
// Admin/operator API client. B3a: authenticates with the staff member's Supabase JWT
// (Authorization: Bearer), resolved server-side against staff_users. Staff are global, so
// no X-Workspace-Slug is sent (workspace scoping is the ?workspace/?ws query convenience).
import { supabase } from "@/lib/supabase";
```
- Delete `getAdminSecret`, `setAdminSecret`, `clearAdminSecret` (lines 150-158).
- Replace `adminFetch` (lines 172-191) with:
```typescript
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new AdminAuthError("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields);
  }
  return res.json() as Promise<T>;
}
```
(Keep `AdminAuthError` + `AdminRequestError` exactly as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat(b3a): adminFetch uses Bearer JWT; drop secret helpers"
```

---

## Task 9: Frontend — `StaffAuthGate` component

**Files:**
- Create: `src/components/admin/StaffAuthGate.tsx`
- Test: `src/components/admin/StaffAuthGate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/StaffAuthGate.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  meStatus: 200,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: hoisted.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { StaffAuthGate } from "./StaffAuthGate";
import { supabase } from "@/lib/supabase";

beforeEach(() => {
  hoisted.session = null;
  hoisted.meStatus = 200;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ staff: { userId: "u1", email: "a@fimmick.com" } }), { status: hoisted.meStatus }),
  );
});

describe("StaffAuthGate", () => {
  it("shows the Google sign-in button when there is no session", async () => {
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("app.admin.signInGoogle")).toBeInTheDocument());
    expect(screen.queryByText("shell")).not.toBeInTheDocument();
  });

  it("renders children when session + /admin/me 200", async () => {
    hoisted.session = { access_token: "jwt" };
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
  });

  it("shows not-authorized + sign-out on 403", async () => {
    hoisted.session = { access_token: "jwt" };
    hoisted.meStatus = 403;
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("app.admin.notStaff")).toBeInTheDocument());
    expect(screen.getByText("app.admin.signOut")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/StaffAuthGate.test.tsx`
Expected: FAIL — module `./StaffAuthGate` not found.

- [ ] **Step 3: Implement the gate**

Create `src/components/admin/StaffAuthGate.tsx`. It renders children as a function once authed, passing the resolved `staff` (so `admin.tsx`/`operator.tsx` can build the context value):
```typescript
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AdminStaff } from "./AdminAuthContext";

type Phase = "loading" | "signed_out" | "not_staff" | "authed";

export function StaffAuthGate({ children }: { children: (staff: AdminStaff) => ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [staff, setStaff] = useState<AdminStaff | null>(null);

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setPhase("signed_out"); return; }
    const res = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 200) {
      const body = (await res.json()) as { staff: AdminStaff };
      setStaff(body.staff);
      setPhase("authed");
    } else if (res.status === 403) {
      setPhase("not_staff");
    } else {
      setPhase("signed_out");
    }
  }, []);

  useEffect(() => {
    void check();
    const { data } = supabase.auth.onAuthStateChange(() => void check());
    return () => data.subscription.unsubscribe();
  }, [check]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    });

  if (phase === "authed" && staff) return <>{children(staff)}</>;

  if (phase === "not_staff") {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
        <p className="text-sm text-[var(--color-magenta)]">{t("app.admin.notStaff")}</p>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="rounded-full border-2 border-[var(--color-ink)] px-6 py-2 font-heading font-bold"
        >
          {t("app.admin.signOut")}
        </button>
      </div>
    );
  }

  if (phase === "signed_out") {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.authPromptAdmin")}</p>
        <button
          type="button"
          onClick={signIn}
          className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold"
        >
          {t("app.admin.signInGoogle")}
        </button>
      </div>
    );
  }

  return <div className="p-8 text-sm text-[var(--color-soft-ink)]">{t("common.signingIn")}</div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/StaffAuthGate.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/StaffAuthGate.tsx src/components/admin/StaffAuthGate.test.tsx
git commit -m "feat(b3a): StaffAuthGate Google-SSO component"
```

---

## Task 10: Frontend — i18n keys (sign-in / not-staff / sign-out)

**Files:**
- Modify: `src/lib/i18n.dict.ts` (en block ~line 547-551; zh-HK block ~line 1157-1161)

- [ ] **Step 1: Add keys to the en block** (after `"app.admin.enter": "Enter",`)

```typescript
    "app.admin.signInGoogle": "Sign in with Google",
    "app.admin.notStaff": "This Google account isn't authorized for the operator console.",
    "app.admin.signOut": "Sign out",
```

- [ ] **Step 2: Add the same keys to the zh-HK block** (after `"app.admin.enter": "進入",`)

```typescript
    "app.admin.signInGoogle": "以 Google 登入",
    "app.admin.notStaff": "此 Google 帳戶未獲授權使用營運後台。",
    "app.admin.signOut": "登出",
```

- [ ] **Step 3: Verify both locales have the keys (no missing-key drift)**

Run: `npm run test -- src/lib/i18n.test.tsx`
Expected: PASS (the dict parity test, if present, stays green).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "feat(b3a): i18n keys for staff Google sign-in"
```

---

## Task 11: Frontend — `admin.tsx` wires `StaffAuthGate` + new context value

**Files:**
- Modify: `src/routes/admin.tsx`

- [ ] **Step 1: Replace the component**

Replace the whole file with:
```typescript
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";
import { WorkspaceSwitcher } from "@/components/admin/WorkspaceSwitcher";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const { t } = useI18n();
  const [, setAuthError] = useState<unknown>(null);
  return (
    <StaffAuthGate>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError: setAuthError }}>
          <AdminWorkspaceProvider>
            <div className="mx-auto max-w-5xl space-y-4 p-4">
              <header className="flex items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                <div>
                  <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
                  <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.subtitle")}</p>
                </div>
                <WorkspaceSwitcher />
              </header>
              <AdminTabs />
              <Outlet />
            </div>
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
```
> `reportAuthError` keeps the existing `useAdminAuth().reportAuthError` consumers working. A 401 from `adminFetch` throws `AdminAuthError`; consumers call `reportAuthError`, and on the next `StaffAuthGate` `check()` (triggered by re-render / `onAuthStateChange`) the gate re-prompts. For B3a the simplest correct behavior is: `reportAuthError` is a no-op sink (state setter) — the gate already re-verifies via `/admin/me` on mount and auth changes. Wiring it to force a re-check is optional polish, not required for green.

- [ ] **Step 2: Commit (type-check deferred to Task 13 when all consumers are flipped)**

```bash
git add src/routes/admin.tsx
git commit -m "feat(b3a): admin layout uses StaffAuthGate"
```

---

## Task 12: Frontend — `operator.tsx` gated + drill-in routes use `authed`

**Files:**
- Modify: `src/routes/operator.tsx`
- Modify: `src/routes/operator.missions.$missionId.tsx`
- Modify: `src/routes/operator.creators.$creatorId.tsx`

- [ ] **Step 1: Gate `operator.tsx` with `StaffAuthGate` + providers**

Replace `src/routes/operator.tsx` with:
```typescript
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";

// Layout for /operator/* detail pages (creator detail, mission selection). Shares the
// staff-auth gate + admin context with /admin so drill-in links work. The /operator index
// redirects to the unified /admin dashboard (see operator.index.tsx).
export const Route = createFileRoute("/operator")({ component: OperatorLayout });

function OperatorLayout() {
  const [, setAuthError] = useState<unknown>(null);
  return (
    <StaffAuthGate>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError: setAuthError }}>
          <AdminWorkspaceProvider>
            <Outlet />
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
```

- [ ] **Step 2: Convert `operator.missions.$missionId.tsx` to context auth**

In `src/routes/operator.missions.$missionId.tsx`:
- Remove the `getAdminSecret` import and the local `const [secret, setSecret] = useState<string | null>(getAdminSecret());`.
- Add `import { useAdminAuth } from "@/components/admin/AdminAuthContext";` and `const { authed, reportAuthError } = useAdminAuth();`.
- Replace both `enabled: !!secret` with `enabled: authed`.
- Remove any inline secret-prompt UI block that rendered when `!secret` (the gate now handles auth). If the file routed `onError`/auth handling through local `setSecret`, route it through `reportAuthError` instead.

- [ ] **Step 3: Convert `operator.creators.$creatorId.tsx` to context auth**

Apply the identical change in `src/routes/operator.creators.$creatorId.tsx` (remove `getAdminSecret` + local `secret` state at line ~70, use `useAdminAuth().authed`, flip `enabled: !!secret` at line ~75 to `enabled: authed`, drop the inline secret prompt).

- [ ] **Step 4: Commit**

```bash
git add src/routes/operator.tsx src/routes/operator.missions.$missionId.tsx src/routes/operator.creators.$creatorId.tsx
git commit -m "feat(b3a): operator drill-in routes share StaffAuthGate"
```

---

## Task 13: Frontend — flip every `enabled: !!secret` → `enabled: authed`

These consumers read `const { secret, reportAuthError } = useAdminAuth();` and gate queries on `!!secret`. Change each to `const { authed, reportAuthError } = useAdminAuth();` and `enabled: authed`. (`reportAuthError` is unchanged.)

**Files (exact lines from grep):**
- `src/components/admin/AdminTabs.tsx:13` (`const { secret } = useAdminAuth();` → `const { authed } = useAdminAuth();`), `:31` + `:37` (`enabled: !!secret` → `enabled: authed`).
- `src/components/admin/WorkspaceSwitcher.tsx:8` + `:13`.
- `src/components/admin/MissionManage.tsx:11` + `:18`.
- `src/routes/admin.applications.tsx:21` + `:27`.
- `src/routes/admin.engaged.tsx:13` + `:18`.
- `src/routes/admin.submissions.tsx:20` + `:26`.
- `src/routes/admin.creators.tsx:25` + `:35`.
- `src/routes/admin.missions.index.tsx:18` + `:27`.
- `src/routes/admin.missions.new.tsx:12` + `:14`.
- `src/routes/admin.missions.$missionId.tsx:14` + `:19`.

- [ ] **Step 1: Apply the flip to all ten files**

For each: replace the destructure and every `enabled: !!secret` occurrence. Example (`admin.applications.tsx`):
```typescript
// before
const { secret, reportAuthError } = useAdminAuth();
// ...
enabled: !!secret,
// after
const { authed, reportAuthError } = useAdminAuth();
// ...
enabled: authed,
```
For `AdminTabs.tsx` the destructure has no `reportAuthError` (`const { secret } = useAdminAuth();` → `const { authed } = useAdminAuth();`).

- [ ] **Step 2: Type-check (now that context + all consumers agree)**

Run: `npm run type-check`
Expected: PASS — no remaining references to `.secret` on `AdminAuth`, no `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` imports outside tests.

> If type-check flags a leftover `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` import (e.g. `OperatorAuthGate.tsx`), that file is now dead (replaced by `StaffAuthGate`). Delete `src/components/operator/OperatorAuthGate.tsx` and its test `src/components/operator/OperatorAuthGate.test.tsx` if present, and remove any remaining import of it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(b3a): flip admin query gates from secret to authed"
```

---

## Task 14: Frontend — `_app.auth.callback.tsx` skips creator bootstrap for `/admin`

**Files:**
- Modify: `src/routes/_app.auth.callback.tsx`
- Test: `src/routes/-app.auth.callback.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/routes/-app.auth.callback.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ navigate: vi.fn(), finishAuth: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => hoisted.navigate,
    Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
    createFileRoute: () => (opts: unknown) => opts,
  };
});
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn(async () => ({ error: null })) } },
}));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: hoisted.finishAuth }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { Route } from "./_app.auth.callback";

function renderCallback(search: string) {
  window.history.replaceState({}, "", `/auth/callback${search}`);
  const C = Route.component as React.ComponentType;
  return render(<C />);
}

beforeEach(() => { hoisted.navigate.mockReset(); hoisted.finishAuth.mockReset(); });

describe("auth callback", () => {
  it("skips creator bootstrap and navigates to next for staff (next=/admin)", async () => {
    renderCallback("?next=/admin&code=abc");
    await waitFor(() => expect(hoisted.navigate).toHaveBeenCalledWith({ to: "/admin" }));
    expect(hoisted.finishAuth).not.toHaveBeenCalled();
  });

  it("runs creator finishAuth when there is no admin next", async () => {
    renderCallback("?code=abc");
    await waitFor(() => expect(hoisted.finishAuth).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/-app.auth.callback.test.tsx`
Expected: FAIL — `finishAuth` is called even when `next=/admin`.

- [ ] **Step 3: Branch on `next` in the callback**

In `src/routes/_app.auth.callback.tsx`, replace the effect body (lines 13-26) with:
```typescript
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) throw new Error("no auth code in callback URL");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        const next = params.get("next");
        if (next && next.startsWith("/admin")) {
          // Staff Google login — do NOT run creator bootstrap (which would create a creator row).
          navigate({ to: next });
          return;
        }
        await finishAuth(navigate);
      } catch {
        setFailed(true);
      }
    })();
  }, [navigate]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routes/-app.auth.callback.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.auth.callback.tsx src/routes/-app.auth.callback.test.tsx
git commit -m "feat(b3a): auth callback skips creator bootstrap for staff"
```

---

## Task 15: Frontend — update admin/operator shell tests to new auth shape

These tests mock `useAdminAuth` returning `{ secret: "s", … }` or mock the `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` helpers. Update them to the `authed`/`staff` shape and mock the Supabase session where the gate reads it.

**Files (exact, from grep):**
- `src/components/admin/WorkspaceSwitcher.test.tsx:11` — `useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() })` → `({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() })`.
- `src/routes/-admin.creators.test.tsx:6`, `-admin.submissions.test.tsx:6`, `-admin.engaged.test.tsx:6`, `-admin.applications.test.tsx:6`, `-admin.missions.index.test.tsx:16`, `-admin.missions.manage.test.tsx:23` — same `useAdminAuth` mock replacement.
- `src/routes/-admin.test.tsx` — the layout shell test. It currently mocks `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` and asserts the `ADMIN_SECRET` password prompt. Rewrite it to mock `@/components/admin/StaffAuthGate` (render children with a fake staff) + mock `@/lib/supabase`'s `auth.getSession`. The two assertions become: (a) the tab bar + outlet render when the gate yields children; (b) drop the "prompts for the admin secret" test (replaced by `StaffAuthGate.test.tsx`). Remove the `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` keys from the `@/lib/admin` mock; keep `adminKeys`/`adminMissionKeys`/`fetchApplications`/`fetchSubmissions`/`fetchWorkspaces`.
- `src/routes/-operator.missions.$missionId.test.tsx`, `-operator.creators.$creatorId.test.tsx` — these mock `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` + a `hoisted.secret`. Since the routes now use `useAdminAuth().authed`, replace the `@/lib/admin` secret-helper mock with a `useAdminAuth` mock (`() => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() })`) and remove the secret-prompt assertions.

Example replacement (one shell test):
```typescript
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }),
}));
```
Example `-admin.test.tsx` gate mock:
```typescript
vi.mock("@/components/admin/StaffAuthGate", () => ({
  StaffAuthGate: ({ children }: { children: (s: unknown) => React.ReactNode }) =>
    <>{children({ userId: "u1", email: "a@x" })}</>,
}));
```

- [ ] **Step 1: Apply the mock updates to all listed test files**

- [ ] **Step 2: Run the full frontend unit suite**

Run: `npm run test`
Expected: PASS — no `secret`/`getAdminSecret` references remain; all admin/operator shell + component tests green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(b3a): update admin/operator shell tests to authed/staff shape"
```

---

## Task 16: Final gates, review, finish branch

- [ ] **Step 1: Run all gates**

```bash
npm run lint
npm run type-check
npm run build
npm run test
set -a; . ./.env.test.local; set +a; RUN_INTEGRATION=1 npx vitest run server/test
```
Expected: lint 0 errors; type-check clean; build succeeds (ESM-extension guard passes — `server/lib/staffAuth.ts` is imported with `.js`); all unit tests pass; integration suite passes **and actually executes** (not skipped — confirm `admin-staff.test.ts` ran its 6 tests; `operator-crm.test.ts` + `admin.test.ts` still green via break-glass).

- [ ] **Step 2: Senior review**

Dispatch a senior code-review pass over the branch diff. Focus: the gate ordering (break-glass before JWT), `resolveStaff` upsert race/idempotency, that no admin handler other than the gate + audit context changed, the callback `next` branch can't be abused to skip bootstrap for a *creator* flow (only `/admin*` skips), and that no `staff_users` read path is exposed to the client. Fix any Critical/Important findings; re-run gates.

- [ ] **Step 3: Verify the secret no longer appears in the UI path**

Run: `grep -rn "x-admin-secret\|getAdminSecret\|ADMIN_SECRET" src/`
Expected: no matches in `src/` (the secret lives only in server break-glass + tests + `.env.test.local`).

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/brand-b3a-staff-auth
gh pr create --base main --title "B3a: staff Google-SSO auth (replace shared secret)" --body "$(cat <<'EOF'
## Summary
Replaces the interim shared `ADMIN_SECRET` gate on `/admin/*` with real per-staff-user Google login backed by a `staff_users` allowlist. The secret is kept as a one-release break-glass fallback (removed in B3b).

- Migration `0020_staff_auth.sql`: `staff_users` allowlist (RLS closed, service-role only).
- `requireStaff` middleware: break-glass secret → else Supabase JWT → `staff_users` (allowlist auto-promote). `GET /admin/me`.
- Audit attribution now from the authenticated staff identity (unspoofable); break-glass preserves legacy header attribution.
- Frontend: `StaffAuthGate` (Google SSO) replaces the secret prompt on `/admin` + `/operator`; `adminFetch` → Bearer; callback skips creator bootstrap for `?next=/admin`.

## Deferred to B3b
External brand magic-link login, `workspace_members` + roles, Postgres RLS multi-tenant isolation, removal of the break-glass secret + migration of secret-based tests.

## Prod cutover (do NOT skip ordering)
1. Apply `0020_staff_auth.sql` to prod **before** deploy, then `notify pgrst, 'reload schema';`.
2. Set `STAFF_EMAIL_ALLOWLIST` (operators' Google emails) in Vercel; **keep `ADMIN_SECRET`** set (break-glass).
3. Confirm the prod `/auth/callback` redirect is allow-listed in Supabase (already is, for creators).
4. Deploy via Git. Smoke: staff Google sign-in loads `/admin`; non-allow-listed Google account → "not authorized"; emergency `x-admin-secret` curl still works; a CRM action records the staff uuid in `operator_audit_events`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Record status in memory** (update the B3 status memory: PR opened, prod migration `0020` + `STAFF_EMAIL_ALLOWLIST` pending).

---

## Self-Review (against the spec)

**Spec coverage:**
- §3 migration `0020` → Task 1. ✓
- §4.1 `requireStaff` (break-glass first, JWT path, codes 401/403/500) → Task 5. ✓
- §4.2 `resolveStaff` + `parseAllowlist` → Tasks 2-3. ✓
- §4.3 `GET /admin/me` → Task 5. ✓
- §4.4 audit attribution from staff identity → Task 6 (with the break-glass header-fallback refinement). ✓
- §4.5 no other handler changes → enforced (only `adminRoutes` decl + middleware + `operatorContext` touched). ✓
- §5.1 `StaffAuthGate` → Task 9; wired in `admin.tsx` Task 11 (+ `operator.tsx` Task 12). ✓
- §5.2 callback skips bootstrap for `/admin` → Task 14. ✓
- §5.3 `adminFetch` Bearer, no `X-Workspace-Slug`, 401 → re-login → Task 8. ✓
- §5.4 `AdminAuthContext` `authed`/`staff` + all consumers → Tasks 7, 13; tests Task 15. ✓ (plus the `operator.*` routes the spec omitted — Task 12.)
- §8 unit (`parseAllowlist`, `resolveStaff`) + integration (gate matrix, auto-promote, break-glass, audit) + frontend (`StaffAuthGate`, `adminFetch`, updated shells) → Tasks 2-3, 5-6, 8-9, 14-15. ✓
- §9 cutover → PR body Task 16. ✓

**Placeholder scan:** none — every code step shows complete code; mechanical flips list exact files + lines.

**Type consistency:** `StaffIdentity { userId, email, viaSecret? }` (server) and `AdminStaff { userId, email }` (client `AdminAuthContext`) are deliberately distinct (the client never sees `viaSecret`; `/admin/me` strips it). `AdminEnv` is the single server admin Env type used by `admin.ts` + `adminOperatorCrm.ts`. `resolveStaff(svc, userId, email)` signature is identical across its definition (Task 3), the middleware call (Task 5), and the unit test (Task 3). `parseAllowlist(raw)` likewise. ✓
