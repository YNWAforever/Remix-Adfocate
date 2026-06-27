# Brand Self-Serve Portal — Slice 1: Brand Access + Self-Serve Authoring

**Date:** 2026-06-27
**Umbrella:** B3b (Brand self-serve portal — "brands + RLS"), deferred since B3a.
**This slice:** Slice 1 of 2. Slice 2 (Brand Self-Review) is a separate, later spec.

## Goal

Let a Fimmick operator **invite a brand**, have that brand **log in** (email magic-link), land on a dedicated **`/brand` portal scoped to their one workspace**, and **author their own missions** (create / edit / publish / close / duplicate / delete-draft) — with **workspace isolation enforced at the database (RLS)**, not just in app code.

## Context

- `workspaces` is already the advertiser/brand tenant; `missions` are workspace-scoped (`missions.workspace_id`).
- Staff (B3a): any verified `@fimmick.com` user is auto-promoted; `staff_users` is RLS-closed and read only by the server (frontend learns staff status via `GET /admin/me`). The brand identity model mirrors this pattern.
- Mission authoring already exists for staff (B1/B2): the pure validators in `server/lib/missionAuthoring.ts` (`validateMission`, `validateEdit`) and the `MissionEditor` component. This slice **reuses** them; only the data-access + auth layer differs.
- No `/brand` portal exists yet (only the `_site.brands` marketing page).

## Locked decisions (from brainstorming)

1. **Portal surface:** a **separate `/brand` portal** (own route shell + nav), not a role-scoped reuse of `/admin`. No staff features in reach.
2. **Onboarding:** **operator-invited**. A staffer invites a brand email to a workspace + role; a `brand_users` row maps email→workspace+role.
3. **Capabilities (umbrella B3b):** author + **full self-review**. *Slice 1 delivers only the **author** half;* self-review (payout-affecting) is **Slice 2**.
4. **Isolation:** **real Postgres RLS**. The brand API calls Supabase with the **user's JWT**, not `service_role`.
5. **Auth method:** **email magic-link** (the invite is an email; matches the creator app's production default; brands aren't on `@fimmick.com`).
6. **Build approach:** thin vertical slices — each slice adds its tables + RLS + features together.

## Out of scope (this slice)

- Brand review of applications/submissions and any payout-affecting writes (**Slice 2**).
- RLS on `applications` / `mission_submissions` for brands (Slice 2 — those tables aren't exposed to brands yet).
- Multi-workspace membership for one brand user (v1 = **one workspace per brand user**).
- Brand-facing insights/radar, content, billing, team management beyond a single invited user.
- Sending a branded invite email template — we reuse Supabase's magic-link email as-is.

---

## Section 1 — Identity, Auth & RLS

### Data model (migration `0023_brand_access.sql`)

**`brand_invites`** — pending state, keyed by email before an auth user exists. RLS-closed (server-only via `service_role`):

```
brand_invites (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  role             text not null default 'member' check (role in ('owner','member')),
  token            text not null unique,
  invited_by_staff uuid references auth.users(id),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
)
-- index on lower(email) where accepted_at is null for the accept lookup
```

**`brand_users`** — active membership, keyed by `user_id`. RLS enabled; only `authenticated` policy is own-row read:

```
brand_users (
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'member' check (role in ('owner','member')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  primary key (user_id)            -- v1: one workspace per brand user
)
alter table brand_users enable row level security;
grant all on brand_users to service_role;
grant select on brand_users to authenticated;
create policy brand_users_self_read on brand_users
  for select to authenticated using (user_id = auth.uid());
```

### Auth resolution

- **`requireBrand`** Hono middleware (mirrors `requireStaff`): verify the Supabase JWT → look up the active `brand_users` row for `auth.uid()` → set `BrandIdentity { userId, email, workspaceId, role }` on context; `403` if no active row. No break-glass secret (brands are always real users).
- **`userClient(bearerToken)`** helper: builds a per-request Supabase client from the request's `Authorization` bearer token (anon key + the user's JWT). All brand data access goes through this client so **RLS applies**. (Contrast: the admin API uses `serviceClient()` + an app-layer workspace filter.)
- New Hono env `BrandEnv = { Variables: { brand: BrandIdentity } }`; brand routes mounted under `/brand` with `requireBrand` applied (except `login`/`callback`/`accept`).

### RLS (only the tables this slice touches)

- `brand_users` — own-row read (above).
- `missions` — add **additive** `authenticated` policies scoped by membership:
  ```
  grant select, insert, update, delete on missions to authenticated;
  -- SELECT / UPDATE / DELETE / INSERT(with check):
  using (workspace_id in (select workspace_id from brand_users
                          where user_id = auth.uid() and active))
  -- destructive (delete) additionally requires the membership row's role = 'owner'
  ```
  These are additive: existing creator/staff mission paths (service_role / existing policies) are **untouched**. **Verification required:** confirm creator mission reads (`/api/missions`) still succeed after adding brand policies (RLS policies are OR-combined, so additive policies shouldn't restrict existing access — but assert it in an integration test).

---

## Section 2 — Invite flow

**Operator invites** (in the existing `/admin` console — a small Brands/Invites surface, staff-gated):
`POST /admin/brand-invites { email, workspace_id, role }` →
1. upsert a `brand_invites` row (`token`, `expires_at` = now + 7d, `invited_by_staff`);
2. trigger `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/brand/auth/callback } })` — sends the magic-link via Supabase's already-configured email (no new email provider).

**Brand accepts:** magic-link → `/brand/auth/callback` exchanges the code into a session → `POST /brand/accept`:
- find an active (`accepted_at is null`, not expired) invite matching the **verified** email;
- if found → create the `brand_users` row (`user_id`, `workspace_id`, `role` from the invite), stamp `accepted_at`;
- if a `brand_users` row already exists → proceed (returning brand). A user already linked to a workspace **keeps that membership**; an invite to a *different* workspace for an already-linked user is ignored in v1 (cross-workspace re-assignment is out of scope — see "one workspace per brand user");
- if neither → `403` "no brand access — contact your Fimmick representative" (logging in without an invite is harmless; they see nothing).

**Lifecycle:**
- Invites expire in 7 days; re-issuable (operator re-invites → new/refreshed row + new magic-link).
- **Revoke** = set `brand_users.active = false` (durable: a revoked brand fails `requireBrand` even with a live session — mirrors B3a).

---

## Section 3 — `/brand` portal shell, scoped authoring, reuse

### Routes (TanStack file routes, like `/_app`, `/admin`)

- `brand.tsx` — layout + **`BrandAuthGate`** (mirrors `StaffAuthGate`): calls `GET /brand/me`, resolves identity or renders loading / no-access / sign-out; provides `BrandAuthContext { email, workspaceId, workspaceName, role }`.
- `brand.login.tsx` — email → magic-link (`signInWithOtp`). Brand-tailored copy.
- `brand.auth.callback.tsx` — exchange code → `POST /brand/accept` → redirect `/brand`.
- `brand.index.tsx` — minimal dashboard: workspace name, mission count, "新任務" CTA.
- `brand.missions.index.tsx` — the brand's mission list (their workspace only): status filter + rows + publish/close/duplicate/delete actions.
- `brand.missions.new.tsx` + `brand.missions.$missionId.tsx` — the mission editor.

### Nav

A simple Side/Bottom nav with just **概覽** (dashboard) + **任務** (missions). **No** workspace switcher (locked to one workspace), no staff features.

### Server endpoints (brand-scoped; user-JWT client; workspace from identity, never a param)

- `GET /brand/me` → `{ brand: { email, workspaceId, workspaceName, role } }`
- `GET /brand/missions` (+ optional status filter) → the workspace's missions (RLS-enforced)
- `POST /brand/missions` (create draft) · `PUT /brand/missions/:id` (edit)
- `POST /brand/missions/:id/publish` · `…/close` · `…/duplicate`
- `DELETE /brand/missions/:id` (draft only; requires `role = 'owner'`)

### Reuse strategy

The authoring **form + validation are shared**: brand routes reuse the B2 `MissionEditor` component and the pure `missionAuthoring.ts` (`validateMission` / `validateEdit`). Only the data-access layer differs (user-JWT client + identity workspace vs. `service_role` + workspace param). Brand and staff authoring stay in sync — no forked editor.

---

## Error handling

- `requireBrand` 403 → `BrandAuthGate` renders the no-access screen + sign-out.
- Cross-workspace access (editing a mission not in your workspace) → user-JWT query returns no rows / RLS denial → API `404`/`403` → UI error toast.
- Magic-link / accept failures → callback renders a retry → `/brand/login`.
- Expired / already-used invite → `accept` returns `403` with a clear message.

## Testing

- **Unit:** reuse existing `missionAuthoring` validator tests; add `requireBrand` resolution tests (no row / inactive → 403; valid → identity) mirroring `staffAuth` tests; pure invite-acceptance logic (match by verified email, expiry) if extracted.
- **Integration (RLS proof — centerpiece):** seed **two brands in two workspaces**; assert brand A can list/create/edit **only** workspace-A missions and a cross-workspace read/edit is **denied at the DB**. Plus: invite→accept→linked; accept-without-invite → 403; revoked brand (active=false) → 403; **creator mission reads still succeed** after adding brand RLS policies.
- **Frontend:** `BrandAuthGate` states (loading / no-access / authed); mission list + editor route-stub tests (mirror the admin route tests).

## Migration & ops

- One migration: `0023_brand_access.sql` (tables, grants, policies). Apply to prod **before** deploy (per the project's migration-before-deploy rule), then `notify pgrst, 'reload schema'`.
- No new env vars (reuses Supabase email + anon key). Operator invite endpoint is staff-gated via the existing `requireStaff`.

## Risks / open questions

- **Additive RLS on `missions`** must not restrict existing creator/staff reads — verified by an explicit integration test.
- Brand API must consistently use the **user-JWT client**; a single route accidentally using `serviceClient()` would bypass RLS. Mitigation: a dedicated `brandClient(c)` helper + review/lint that brand routes never import `serviceClient`.
- Magic-link deliverability for arbitrary brand domains depends on Supabase's email config (already used in prod for creators).
