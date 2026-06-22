# B3a — Staff Authentication (design)

**Date:** 2026-06-22
**Slice:** B3a (brand/advertiser side — first auth slice; follows B2). Splits the roadmap's "B3 real auth" by trust level: **B3a = internal staff**, **B3b = external brands + RLS** (separate later spec).
**Status:** Approved design, pre-plan
**Author:** Willy Lai + Claude

---

## 1. Context & premise

B1/B2 shipped the brand-side admin console (`/admin`: mission authoring, applicant/submission review, operator CRM, redemption codes, the B2 workspace switcher). Authentication is still the **interim shared `ADMIN_SECRET`**: one middleware on `adminRoutes` checks an `x-admin-secret` header; every admin route then uses `serviceClient()` (bypasses RLS). There is no notion of an individual operator — `operator_audit_events.operator_id`/`actor_label` are populated from **client-supplied** `x-operator-id`/`x-operator-label` headers (spoofable).

B3a replaces the shared secret with **real per-staff-user login** for Fimmick agency staff:

- Staff sign in with **Google OAuth** (the existing Supabase Auth project + `/auth/callback` PKCE flow that creators already use).
- A new **`staff_users`** allowlist table marks which `auth.users` are staff. Being an `active` staff row = full admin access to **all** workspaces (staff are global/cross-workspace).
- Enforcement stays **app-layer** (verify JWT → confirm staff → keep using `serviceClient()`). This is adequate for *trusted internal staff*; untrusted external-brand multi-tenant isolation (which needs Postgres RLS) is deferred to **B3b**.
- The shared secret is kept as an **env-flagged break-glass fallback for one release** (removed in B3b) — this prevents prod lockout if Google OAuth misconfigures, **and** keeps the existing ~8 secret-based integration tests green without rewriting them now.

### Non-negotiable framing

- **B3a is staff-only.** External brand logins, `workspace_members`, staff-provisioning of brand users, and RLS multi-tenant isolation are **B3b**. Do not build them here.
- **Staff are global.** No per-workspace membership or per-route roles in B3a — any active staff user can do everything in every workspace (exactly today's secret-holder capability, now per-identity + audited). The B2 `?workspace=` switcher remains *convenience* filtering.
- **One gate to replace.** The entire `/admin/*` surface sits behind a single middleware in `server/routes/admin.ts`. B3a swaps that one middleware; route handlers are otherwise untouched.
- `missions.created_by` stays **null** (still no per-mission attribution in B3a; B3b/brand authoring may revisit).

### Roadmap position

| Slice | Scope | Status |
|-------|-------|--------|
| B1 | Mission authoring | DONE |
| B2 | Richer authoring + workspace-scoped review | DONE (PR #36) |
| **B3a** | **Staff Google-SSO login + `staff_users` + replace shared secret (app-layer)** | **this spec** |
| B3b | External brand magic-link login + `workspace_members` + RLS isolation; remove break-glass secret | next |
| B4 | Brand dashboard home + analytics | later |

---

## 2. Goals / non-goals

**Goals**
- Fimmick staff authenticate to `/admin` with their Google account; no shared secret in the UI.
- A `staff_users` allowlist is the source of truth for "who is staff" (with an `active` flag to revoke without redeploy).
- First-login bootstrap with no chicken-and-egg: a `STAFF_EMAIL_ALLOWLIST` env auto-promotes known emails into `staff_users`.
- Real, unspoofable audit attribution: `operator_audit_events.operator_id`/`actor_label` come from the authenticated staff identity, not client headers.
- Zero-rewrite continuity: existing admin routes + the B2 `?workspace=` behavior keep working; existing secret-based tests stay green via the break-glass fallback.

**Non-goals (deferred)**
- External brand logins, `workspace_members`, brand self-serve → **B3b**.
- Postgres RLS multi-tenant enforcement → **B3b** (B3a is app-layer; staff are trusted).
- Per-route roles / granular permissions (staff are all-powerful in B3a).
- A staff-management UI (add/deactivate staff). B3a manages staff via the allowlist env + direct `staff_users` rows; a UI can come later.
- Removing `ADMIN_SECRET` entirely → **B3b** (kept as break-glass for one release).

---

## 3. Data model — migration `0020_staff_auth.sql`

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

- **`STAFF_EMAIL_ALLOWLIST`** (new env, comma-separated emails, lowercased) is the bootstrap source. On a staff's first Google login, if their verified email is in the allowlist and no `staff_users` row exists, the middleware **auto-creates** the row (`active=true`). Subsequent logins read the existing row. Removing someone = set `active=false` (or delete the row) and remove from the allowlist.
- **Production apply (required):** apply `0020` to prod **before** deploying the code that reads `staff_users`, then run `notify pgrst, 'reload schema';` (the documented pattern; a past slice had a brief outage from skipping it). `staff_users` is service-role-only, but the reload keeps PostgREST's cache consistent.

---

## 4. Backend

### 4.1 Replace the gate — `requireStaff` middleware (`server/routes/admin.ts`)

Replace the existing `adminRoutes.use("*", …secret check…)` (lines 14–21) with a staff-auth middleware. Order: **break-glass secret first** (so tests + emergency curl keep working), then the Supabase-JWT staff path.

```typescript
// pseudocode — exact code in the plan
adminRoutes.use("*", async (c, next) => {
  // Break-glass (B3b removes this block): the shared secret still grants full access.
  const secret = process.env.ADMIN_SECRET;
  if (secret && c.req.header("x-admin-secret") === secret) {
    c.set("staff", { userId: null, email: "shared-secret", viaSecret: true });
    return next();
  }
  // Primary: Supabase JWT → staff_users (or allowlist auto-promote).
  const jwt = (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
  if (!jwt) return c.json({ error: "forbidden", code: "no_admin" }, 401);
  const { data, error } = await makeUserClient(jwt).auth.getUser();
  if (error || !data.user) return c.json({ error: "invalid token", code: "bad_token" }, 401);
  const staff = await resolveStaff(serviceClient(), data.user.id, data.user.email ?? null);
  if (!staff) return c.json({ error: "not staff", code: "not_staff" }, 403);
  c.set("staff", { userId: staff.user_id, email: staff.email });
  await next();
});
```

- Reuses `makeUserClient(jwt).auth.getUser()` — the **exact** verification `workspaceAuth` (creator middleware) already uses. No new JWT library.
- `c.set("staff", …)` mirrors how `workspaceAuth` sets context; the Hono `Env` type gains a `staff` variable.
- `401` = no/invalid token; `403 { code: "not_staff" }` = a valid Google user who isn't staff. (Kept `no_admin`/401 for the missing-credential case to match today's behavior + existing test assertions.)

### 4.2 `resolveStaff(svc, userId, email)` — pure-ish helper (`server/lib/staffAuth.ts`, new)

1. `select * from staff_users where user_id = userId and active` → if found, return it.
2. Else if `email` (lowercased) ∈ `STAFF_EMAIL_ALLOWLIST` → `upsert staff_users { user_id, email, active: true }` → return it (first-login auto-promotion).
3. Else return `null`.

The allowlist parsing (`parseAllowlist(env): Set<string>`) is a pure function (unit-tested). `resolveStaff` itself is thin DB glue; keep it small and isolated. New server file → `.js` ESM import extension.

### 4.3 `GET /admin/me` (new, behind `requireStaff`)

Returns `{ staff: { userId: string | null, email: string } }` for the authenticated staff user (the frontend gate uses this to decide "am I staff"). Under break-glass it returns `{ staff: { userId: null, email: "shared-secret" } }`. Mounted in `adminRoutes` (so it inherits the gate).

### 4.4 Audit attribution (`server/routes/adminOperatorCrm.ts`, `server/lib/operatorCrm/repo.ts`)

Today `OperatorContext` (`operatorId`, `actorLabel`) is read from client headers `x-operator-id`/`x-operator-label`. Change the operator-CRM routes to build `OperatorContext` from the authenticated staff identity:
- `operatorId = c.get("staff").userId ?? "shared-secret"`, `actorLabel = c.get("staff").email`.
- Stop trusting the client headers for identity (they may remain as optional metadata but must not set `operator_id`).
`operator_audit_events` schema is unchanged (`operator_id text` already holds a uuid-or-sentinel; no migration).

### 4.5 What does NOT change

All `/admin/*` handlers (authoring, applications/engaged/submissions, redemption codes, the B2 `?workspace=` filters) keep `serviceClient()` and their logic unchanged — only the gate + audit-context source change. Staff are global, so no per-workspace restriction is applied.

---

## 5. Frontend

### 5.1 `StaffAuthGate` replaces `OperatorAuthGate` (`src/routes/admin.tsx`, new `src/components/admin/StaffAuthGate.tsx`)

- Reads the Supabase session (`supabase.auth.getSession()` / `onAuthStateChange`).
- **No session** → render a "Sign in with Google" screen:
  ```ts
  supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback?next=/admin` } });
  ```
- **Session present** → call `GET /admin/me`:
  - `200` → render the admin shell; provide `{ authed: true, staff }` via context.
  - `403 not_staff` → "This Google account isn't authorized for the operator console" + a sign-out button (`supabase.auth.signOut()`).
  - `401` → treat as no session (prompt sign-in).

### 5.2 `/auth/callback` must NOT run creator bootstrap for staff (`src/routes/_app.auth.callback.tsx`, `src/lib/auth-flow.ts`)

The callback currently always calls `finishAuth`, which runs `/me/bootstrap` (creates a **creator** row) + resolves a creator workspace. For staff that would wrongly create a creator row. Branch on the `next` param:
- If `next` starts with `/admin` → `exchangeCodeForSession(code)` then `navigate({ to: next })` — **skip** `finishAuth`/creator bootstrap.
- Else → existing creator flow (`finishAuth`).

### 5.3 `adminFetch` → Bearer (`src/lib/admin.ts`)

- Replace the `x-admin-secret` header with `Authorization: Bearer <access_token>` read from `supabase.auth.getSession()` (the exact pattern `apiFetch` uses). Do **not** send `X-Workspace-Slug` (staff are cross-workspace).
- `401` → `AdminAuthError` → the gate prompts re-login (instead of `clearAdminSecret`). `403 not_staff` surfaces the not-authorized state.
- Remove `getAdminSecret`/`setAdminSecret`/`clearAdminSecret` usage from the admin UI path. (Keep the functions only if still referenced by break-glass tooling; otherwise delete — see cutover.)

### 5.4 `AdminAuthContext` shape change + consumers (`src/components/admin/AdminAuthContext.tsx`)

B2 consumers gate queries with `enabled: !!secret`. Replace the `secret` field with an `authed` boolean (+ optional `staff`):
```ts
export type AdminAuth = { authed: boolean; staff: { userId: string | null; email: string } | null; reportAuthError: (e: unknown) => void };
```
Update every consumer that reads `secret`/`!!secret` to use `authed`:
- `AdminTabs.tsx`, `src/routes/admin.applications.tsx`, `admin.engaged.tsx`, `admin.submissions.tsx`, `admin.creators.tsx`, `admin.missions.index.tsx`, `admin.missions.new.tsx`, `admin.missions.$missionId.tsx`, `MissionManage.tsx`, `WorkspaceSwitcher.tsx` (any `enabled: !!secret` → `enabled: authed`).
- Frontend admin tests that mock `useAdminAuth(() => ({ secret: "s", … }))` → `({ authed: true, staff: {…}, … })`, and mock the Supabase session where the gate reads it.

### 5.5 What does NOT change

The B2 `WorkspaceSwitcher`, Manage tab, editor, and all admin tab UI stay as-is (only their `enabled` gate flips from `secret` to `authed`).

---

## 6. Data flow

```
Staff browser
  → "Sign in with Google" → supabase.auth.signInWithOAuth(redirectTo=/auth/callback?next=/admin)
  → /auth/callback exchanges code → Supabase session (JWT)   [no creator bootstrap]
  → StaffAuthGate calls GET /admin/me with Bearer JWT
adminFetch(path)  [Authorization: Bearer <access_token>, ?workspace / ?ws as in B2]
  → Hono /admin/* routes  [requireStaff: getUser → resolveStaff → c.set("staff")]
  → serviceClient() (cross-workspace) → Supabase
```

Break-glass: a request carrying a valid `x-admin-secret` bypasses the JWT path (sets a sentinel staff identity). Used by the existing test suite + emergency access; not surfaced in the UI.

---

## 7. Error handling

- No / malformed token, no secret → `401 { code: "no_admin" | "bad_token" }`.
- Valid Google user, not staff → `403 { code: "not_staff" }` → gate shows "not authorized" + sign-out.
- Frontend `AdminRequestError`/`AdminAuthError` reused; `401` → re-login, not secret-clear.
- `resolveStaff` DB error → surface as `500 { code: "db_error" }` (don't silently allow).

---

## 8. Testing

**Unit (Vitest):**
- `parseAllowlist` — empty/whitespace/case-folding/comma-split.
- `resolveStaff` against a stub client — existing active row → returns it; inactive row → null; email in allowlist + no row → upserts + returns; not staff → null.

**Integration (`server/test`, local stack):**
- `requireStaff` over a representative admin route + `GET /admin/me`:
  - Valid **staff** JWT (seeded `staff_users`) → `200`.
  - Valid **non-staff** JWT → `403 not_staff`.
  - No token, no secret → `401`.
  - Allowlist auto-promotion: a JWT whose email ∈ `STAFF_EMAIL_ALLOWLIST` with no row → `200` and a `staff_users` row now exists.
  - **Break-glass:** `x-admin-secret` → `200` (proves existing tests stay green).
- Audit attribution: an operator-CRM action as a staff JWT writes `operator_audit_events.operator_id = <staff uuid>`, `actor_label = <staff email>` (not client headers).
- A new test helper `makeStaff(email)` (mirrors `makeCreator`): creates an `auth.users` user, inserts a `staff_users` row, returns `{ userId, jwt }`. **Existing** secret-based helpers/tests are left unchanged (break-glass keeps them green).

**Frontend (`src/**/*.test.tsx`):**
- `StaffAuthGate`: no session → Google button; session + `/admin/me` 200 → renders children; 403 → not-authorized + sign-out.
- `adminFetch` sends `Authorization: Bearer …` (and no `x-admin-secret`).
- Updated admin route/tab tests under the new `authed`/`staff` context shape.

**Gates:** `npm run lint`, `npm run type-check` (runs `tsr generate`), `npm run build` (ESM-extension guard), `npm run test`, `npm run test:integration`.

---

## 9. Cutover & bootstrap

1. **Migration:** apply `0020_staff_auth.sql` to prod **before** deploy; `notify pgrst, 'reload schema';`.
2. **Env (prod, Vercel):** set `STAFF_EMAIL_ALLOWLIST` to the operators' Google emails; **keep `ADMIN_SECRET`** set (break-glass). Supabase Google OAuth + the `/auth/callback` redirect allow-list already cover creators — confirm the prod domain's `/auth/callback` is allow-listed (it is, for creators).
3. **First login:** an allow-listed operator signs in with Google at `/admin` → middleware auto-creates their `staff_users` row → access granted. No manual seeding needed.
4. **Deploy via Git** (never `vercel --prod` from local — mis-bundles the API).
5. **Smoke:** staff Google sign-in → `/admin` loads; a non-allow-listed Google account → "not authorized"; emergency `x-admin-secret` curl still works; an operator-CRM action records the staff uuid in `operator_audit_events`.

If Google OAuth misconfigures on prod, the break-glass secret keeps the console reachable until fixed.

---

## 10. Forward hooks for B3b

- `staff_users` stays (staff remain global). B3b adds **`workspace_members`** (user ↔ workspace ↔ role) for external **brand** users (single brand role per B3 decisions), with staff-provisioning.
- B3b adds external **magic-link** brand login (same Supabase Auth project) + a brand-scoped gate, and turns the B2 `?workspace=` convenience filter into an **enforced** boundary for brand users (staff stay cross-workspace).
- B3b adds **Postgres RLS** defense-in-depth on the brand-facing tables for untrusted multi-tenant isolation, and **removes the break-glass `ADMIN_SECRET`** + migrates the remaining secret-based tests to staff/brand JWTs.
- A staff-management UI (add/deactivate `staff_users`) can land in B3b or B4.
