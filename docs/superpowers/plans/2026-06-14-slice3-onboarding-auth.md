# Slice 3 — Onboarding & Auth (WhatsApp-primary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Hong-Kong-first signup + onboarding for the KOCmax member portal: WhatsApp phone-OTP as the primary login (email magic-link + Google as secondary), a resumable 5-step wizard, a 100-point welcome bonus, and a shareable referral code — gated so not-yet-onboarded creators land in the wizard.

**Architecture:** Supabase Auth (phone OTP via Twilio Verify, inline — no redirect; magic-link + Google via PKCE callback). A Hono API on Vercel (`server/`) adds a guarded `/api/onboarding/*` group and a null-email-tolerant `/api/me/bootstrap`. Postgres migrations add onboarding columns + a self-scoped UPDATE RLS policy + a `SECURITY DEFINER` welcome-bonus function, and fold in the integration-403 GRANTs fix. The React/TanStack front-end gets a WhatsApp-primary login, a shared post-auth branch, a cached onboarding gate in the layout `beforeLoad`, and the wizard route.

**Tech Stack:** TypeScript, React 19 + Vite + TanStack Start/Router/Query, Hono, `@supabase/supabase-js` 2.45 (server uses service + per-request user clients), Supabase Postgres + RLS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-adfocate-slice3-onboarding-auth-design.md` (commit `dad9f12`). **Branch:** `feat/slice3-onboarding-auth`. All paths below are relative to the `adfocate-2/` repo root.

**Conventions used throughout:**
- Run a single test file with `npx vitest run <path>`. Front-end and server tests share one Vitest project.
- Backend integration tests (`server/test/*.test.ts`) **skip cleanly** when `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`SUPABASE_ANON_KEY` are absent. To actually run them locally, start the local stack first: `supabase start`, then `supabase db reset` (applies migrations + `seed.sql`), then export the printed keys. In CI they run against the configured Supabase env.
- Commit after every task. Conventional-commit messages; end with the `Co-Authored-By` trailer the repo uses.

---

## File map (what each new/changed file is responsible for)

**Database**
- Create `supabase/migrations/0003_onboarding.sql` — onboarding columns on `creators`, `phone`, `referral_code` (+default/unique), `referred_by`, status CHECK, `creators_self_update` RLS policy, `public.award_welcome_bonus()` function.
- Create `supabase/migrations/0004_grants.sql` — `GRANT SELECT` on catalogue tables + `GRANT UPDATE(col-list)` on `creators` to `authenticated` (the integration-403 fix).
- Modify `supabase/config.toml` — uncomment `auto_expose_new_tables = false`.

**Backend (`server/`)**
- Modify `server/routes/me.ts` — extend `/bootstrap` (null-email-tolerant, `phone`, `ref`→`referred_by`, return `{ created }`); extend guarded `/me` SELECT.
- Create `server/routes/onboarding.ts` — `status`, `profile`, `social/connect`, `recommended-missions`, `complete`.
- Modify `server/app.ts` — register the onboarding routes in the guarded group.
- Modify `server/test/helpers.ts` — add `makeUser({email?,phone?})` (auth user only, no creator row) + phone-aware `cleanup`.
- Create `server/test/bootstrap.test.ts` — first-login bootstrap for email **and** phone identities.
- Create `server/test/onboarding.test.ts` — the onboarding endpoints incl. welcome-bonus idempotency.

**Frontend (`src/`)**
- Modify `src/lib/supabase.ts` — `flowType: 'pkce'`, `detectSessionInUrl: false`.
- Modify `src/lib/api.ts` — route-derived workspace slug (`setWorkspaceSlug`/`getWorkspaceSlug`), accept `ref` in bootstrap callers.
- Create `src/lib/auth-flow.ts` — `finishAuth(slug, navigate)` shared post-auth branch.
- Modify `src/lib/queries/kocmax.ts` — extend `Me`; add onboarding hooks/mutations + `useRecommendedMissions`.
- Modify `src/routes/kocmax.$slug.login.tsx` — WhatsApp-primary OTP + secondary email/Google.
- Modify `src/routes/kocmax.$slug.auth.callback.tsx` — PKCE `exchangeCodeForSession` + `finishAuth`.
- Modify `src/routes/kocmax.$slug.tsx` — onboarding gate in `beforeLoad`.
- Modify `src/components/FilterPills.tsx` — add a multi-select variant (`FilterPillsMulti`).
- Create `src/routes/kocmax.$slug.onboarding.tsx` — the wizard (steps 2–5).
- Tests: update `src/routes/-kocmax.$slug.login.test.tsx`, `src/routes/-kocmax.$slug.auth.callback.test.tsx`; create `src/routes/-kocmax.$slug.onboarding.test.tsx`.

---

## Task 1: Migration `0003_onboarding.sql` — columns, RLS, welcome-bonus function

**Files:**
- Create: `supabase/migrations/0003_onboarding.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_onboarding.sql`:

```sql
-- Slice 3: onboarding state, phone identity, referral, and the welcome-bonus award.

-- 1. Onboarding + phone + referral columns on creators ----------------------
alter table public.creators
  add column onboarding_step      integer not null default 1,
  add column onboarding_completed boolean not null default false,
  add column phone                text,                 -- E.164 ('+852…'); null for email/Google-only users
  add column referred_by          uuid references public.creators(id);

create index creators_phone_idx on public.creators (phone);

-- referral_code: backfill existing rows, then default + unique for new rows.
alter table public.creators add column referral_code text;
update public.creators
  set referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where referral_code is null;
alter table public.creators
  alter column referral_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
alter table public.creators
  add constraint creators_referral_code_key unique (referral_code);

-- 2. Constrain status (default stays 'active'; existing rows are 'active') ---
alter table public.creators
  add constraint creators_status_chk check (status in ('active','suspended','pending_review'));

-- 3. Self-scoped profile writes (points stay service-role) -------------------
create policy creators_self_update on public.creators
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 4. Welcome-bonus award: atomic + idempotent, service-role only ------------
-- Lives in public so PostgREST exposes it for the service client's .rpc(),
-- but execute is revoked from anon/authenticated so end-users can never mint points.
create or replace function public.award_welcome_bonus(p_creator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws   uuid;
  v_done boolean;
  v_bal  integer;
begin
  select workspace_id, onboarding_completed
    into v_ws, v_done
    from public.creators
    where id = p_creator
    for update;

  if v_ws is null then
    raise exception 'creator % not found', p_creator;
  end if;
  if v_done then
    return;  -- already onboarded → no double award
  end if;

  update public.point_balances
    set balance = balance + 100, updated_at = now()
    where creator_id = p_creator and workspace_id = v_ws
    returning balance into v_bal;

  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (p_creator, v_ws, 'bonus', 100, v_bal, 'welcome', '迎新獎賞 100 積分');

  update public.creators
    set onboarding_completed = true, onboarding_step = 5
    where id = p_creator;
end;
$$;

revoke all on function public.award_welcome_bonus(uuid) from public;
revoke all on function public.award_welcome_bonus(uuid) from anon;
revoke all on function public.award_welcome_bonus(uuid) from authenticated;
grant execute on function public.award_welcome_bonus(uuid) to service_role;
```

- [ ] **Step 2: Verify the migration applies cleanly (local stack)**

Run: `supabase db reset`
Expected: completes without error; output lists `0003_onboarding.sql` applied after `0002_harden_rls.sql`. (If you have no local stack running, skip this step — Task 5's integration tests verify the schema against the configured Supabase env instead.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_onboarding.sql
git commit -m "feat(db): slice3 onboarding columns, self-update RLS, welcome-bonus fn

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration `0004_grants.sql` + `config.toml` — the integration-403 fix

**Files:**
- Create: `supabase/migrations/0004_grants.sql`
- Modify: `supabase/config.toml:24`

- [ ] **Step 1: Write the grants migration**

Create `supabase/migrations/0004_grants.sql`:

```sql
-- Slice 3: restore the table-level GRANTs that the deprecated auto-expose default
-- used to provide. Without these, the `authenticated` role gets RLS-passes-but-
-- still-403 on fresh (post-2026-05-30) stacks. Cloud predates the flip, so prod
-- already works; this makes local + CI match and hardens against drift.

grant select on
  public.workspaces,
  public.missions,
  public.redemption_gifts,
  public.creators,
  public.point_balances,
  public.point_transactions
  to authenticated;

-- Profile self-edit columns (UPDATE is gated by the creators_self_update policy
-- from 0003; this grants the column privilege the policy needs to take effect).
grant update (display_name, avatar_url, categories, social_handles, onboarding_step, phone)
  on public.creators to authenticated;
```

- [ ] **Step 2: Pin the auto-expose default in `config.toml`**

In `supabase/config.toml`, line 24, change:

```toml
# auto_expose_new_tables = false
```

to (uncommented):

```toml
auto_expose_new_tables = false
```

- [ ] **Step 3: Verify it applies (local stack)**

Run: `supabase db reset`
Expected: completes; `0004_grants.sql` applied last. (Skip if no local stack — Task 5 covers it.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_grants.sql supabase/config.toml
git commit -m "fix(db): grant authenticated SELECT/UPDATE; pin auto_expose_new_tables=false

Fixes the pre-existing integration-CI 403 (missing table GRANTs after the
2026-05-30 auto-expose flip).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend `/api/me/bootstrap` (phone-primary, `{created}`) + `/me` SELECT

**Files:**
- Modify: `server/routes/me.ts`
- Test: `server/test/bootstrap.test.ts` (written in Task 5; this task makes it pass)

- [ ] **Step 1: Rewrite `server/routes/me.ts`**

Replace the whole file with:

```typescript
import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient, makeUserClient } from "../lib/supabase.js";

/** Supabase stores phone digits without a leading '+'. Re-add it for E.164 display. */
function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/** Unguarded: runs before a creator row exists. Resolves workspace from body slug. */
export const meBootstrap = new Hono<Env>();
meBootstrap.post("/bootstrap", async (c) => {
  const auth = c.req.header("Authorization");
  const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "Missing bearer token", code: "no_auth" }, 401);

  const { slug, ref } = await c.req.json<{ slug: string; ref?: string }>();
  if (!slug) return c.json({ error: "Missing slug", code: "no_workspace" }, 400);

  const user = makeUserClient(jwt);
  const { data: u } = await user.auth.getUser();
  if (!u.user) return c.json({ error: "Invalid token", code: "bad_token" }, 401);

  const svc = serviceClient();
  const { data: ws } = await svc.from("workspaces").select("id").eq("slug", slug).single();
  if (!ws) return c.json({ error: "Unknown workspace", code: "no_workspace" }, 404);

  // Identity may be phone-primary (no email) or email — derive a non-null display name.
  const e164 = toE164(u.user.phone);
  const displayName = u.user.email ?? e164 ?? "KOC";

  // Resolve an optional referral code from the signup link (reject self-referral).
  let referredBy: string | null = null;
  if (ref) {
    const { data: r } = await svc.from("creators").select("id").eq("referral_code", ref).maybeSingle();
    if (r && r.id !== u.user.id) referredBy = r.id;
  }

  // First-login detection: did a creator row already exist?
  const { data: existing } = await svc.from("creators").select("id").eq("id", u.user.id).maybeSingle();
  const created = !existing;

  // ignoreDuplicates → an existing row is never overwritten; only first insert sets these.
  await svc.from("creators").upsert(
    {
      id: u.user.id,
      workspace_id: ws.id,
      display_name: displayName,
      phone: e164,
      ...(referredBy ? { referred_by: referredBy } : {}),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  await svc.from("point_balances").upsert(
    { creator_id: u.user.id, workspace_id: ws.id, balance: 0 },
    { onConflict: "creator_id,workspace_id", ignoreDuplicates: true },
  );

  return c.json({ created });
});

/** Guarded: current creator profile (includes onboarding state for the gate). */
export const meRoutes = new Hono<Env>();
meRoutes.get("/me", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select(
      "id, display_name, avatar_url, level, xp, categories, scores, phone, onboarding_step, onboarding_completed, referral_code",
    )
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/me.ts
git commit -m "feat(api): phone-primary bootstrap returns {created}; /me surfaces onboarding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: New `/api/onboarding` route group

**Files:**
- Create: `server/routes/onboarding.ts`
- Modify: `server/app.ts`
- Test: `server/test/onboarding.test.ts` (Task 5)

- [ ] **Step 1: Write `server/routes/onboarding.ts`**

```typescript
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";

export const onboardingRoutes = new Hono<Env>();

/** GET /api/onboarding/status — step pointer + completion. */
onboardingRoutes.get("/status", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select("onboarding_step, onboarding_completed")
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const completion_pct = data.onboarding_completed
    ? 100
    : Math.round(((data.onboarding_step - 1) / 4) * 100);
  return c.json({ ...data, completion_pct });
});

/** PUT /api/onboarding/profile — save partial profile + advance the step pointer. */
onboardingRoutes.put("/profile", async (c) => {
  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string;
    categories?: string[];
    step?: number;
  }>();
  const supabase = makeUserClient(c.get("jwt"));

  const { data: cur, error: readErr } = await supabase
    .from("creators")
    .select("onboarding_step")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);

  const nextStep = Math.max(cur.onboarding_step, body.step ?? cur.onboarding_step);
  const patch: Record<string, unknown> = { onboarding_step: nextStep };
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.avatar_url !== undefined) patch.avatar_url = body.avatar_url;
  if (body.categories !== undefined) patch.categories = body.categories;

  const { error } = await supabase.from("creators").update(patch).eq("id", c.get("userId"));
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ onboarding_step: nextStep });
});

/** POST /api/onboarding/social/connect — append a self-reported handle. */
onboardingRoutes.post("/social/connect", async (c) => {
  const { platform, handle, followers } = await c.req.json<{
    platform: string;
    handle: string;
    followers?: number;
  }>();
  if (!platform || !handle) {
    return c.json({ error: "platform and handle required", code: "bad_input" }, 400);
  }
  const supabase = makeUserClient(c.get("jwt"));
  const { data: cur, error: readErr } = await supabase
    .from("creators")
    .select("social_handles")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);

  const handles = Array.isArray(cur.social_handles) ? cur.social_handles : [];
  handles.push({ platform, handle, followers: followers ?? null, verified: false });

  const { error } = await supabase
    .from("creators")
    .update({ social_handles: handles })
    .eq("id", c.get("userId"));
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ social_handles: handles });
});

/** GET /api/onboarding/recommended-missions — up to 3 open missions matching categories. */
onboardingRoutes.get("/recommended-missions", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: me } = await supabase
    .from("creators")
    .select("categories")
    .eq("id", c.get("userId"))
    .single();

  let q = supabase
    .from("missions")
    .select("id, slug, title, category, points_reward, deadline")
    .eq("status", "active")
    .eq("access_type", "open")
    .limit(3);
  if (me?.categories?.length) q = q.in("category", me.categories);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ missions: data ?? [] });
});

/** POST /api/onboarding/complete — award the welcome bonus (idempotent) + finish. */
onboardingRoutes.post("/complete", async (c) => {
  const svc = serviceClient();
  const { error } = await svc.rpc("award_welcome_bonus", { p_creator: c.get("userId") });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  const { data, error: readErr } = await svc
    .from("creators")
    .select("referral_code, onboarding_completed, onboarding_step")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);
  return c.json(data);
});
```

- [ ] **Step 2: Register the routes in `server/app.ts`**

Add the import after the `me` import (line 4):

```typescript
import { onboardingRoutes } from "./routes/onboarding.js";
```

Add the route inside the guarded group, after the `/me` line (currently line 22):

```typescript
  guarded.route("/onboarding", onboardingRoutes);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/onboarding.ts server/app.ts
git commit -m "feat(api): onboarding endpoints (status/profile/social/recommend/complete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Backend integration tests (bootstrap + onboarding)

**Files:**
- Modify: `server/test/helpers.ts`
- Create: `server/test/bootstrap.test.ts`
- Create: `server/test/onboarding.test.ts`

- [ ] **Step 1: Extend `server/test/helpers.ts`**

Add a `makeUser` helper (auth user only, **no** creator row — bootstrap creates it) and make `cleanup` phone-aware. Append `makeUser` after `makeCreator` and replace `cleanup`:

```typescript
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
```

(Phone test users use the reserved `+1555…` range so `cleanup` can find their `creators.phone`.)

- [ ] **Step 2: Write `server/test/bootstrap.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeUser, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function bootstrap(jwt: string) {
  return app.request("/api/me/bootstrap", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "demo" }),
  });
}
function getMe(jwt: string) {
  return app.request("/api/me", {
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" },
  });
}

suite("bootstrap (first login)", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates an email creator and returns created:true, then false on repeat", async () => {
    const user = await makeUser({ email: "boot@test.local" });
    const first = await bootstrap(user.jwt);
    expect(first.status).toBe(200);
    expect((await first.json()).created).toBe(true);

    const second = await bootstrap(user.jwt);
    expect((await second.json()).created).toBe(false);

    const me = await getMe(user.jwt);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.display_name).toBe("boot@test.local");
    expect(body.onboarding_completed).toBe(false);
    expect(body.referral_code).toMatch(/^[0-9A-F]{8}$/);
  });

  it("creates a PHONE-primary creator with no email (display_name = E.164)", async () => {
    const user = await makeUser({ phone: "+15555550100" });
    const res = await bootstrap(user.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(true);

    const me = await getMe(user.jwt);
    const body = await me.json();
    expect(body.phone).toBe("+15555550100");
    expect(body.display_name).toBe("+15555550100");
    expect(body.onboarding_completed).toBe(false);
  });
});
```

- [ ] **Step 3: Write `server/test/onboarding.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("onboarding endpoints", () => {
  let creator: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    creator = await makeCreator("onb@test.local", 0);
  });
  afterAll(cleanup);

  it("status starts at step 1, 0% complete", async () => {
    const res = await req("/onboarding/status", creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboarding_step).toBe(1);
    expect(body.onboarding_completed).toBe(false);
    expect(body.completion_pct).toBe(0);
  });

  it("profile saves categories (self-RLS) and advances the step", async () => {
    const res = await req("/onboarding/profile", creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ categories: ["美容", "餐飲"], step: 3 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).onboarding_step).toBe(3);
  });

  it("profile never regresses the step pointer", async () => {
    const res = await req("/onboarding/profile", creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ step: 2 }),
    });
    expect((await res.json()).onboarding_step).toBe(3);
  });

  it("social/connect appends a handle", async () => {
    const res = await req("/onboarding/social/connect", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "ig", handle: "@me", followers: 1200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.social_handles).toHaveLength(1);
    expect(body.social_handles[0]).toMatchObject({ platform: "ig", handle: "@me", verified: false });
  });

  it("recommended-missions returns matching open missions (<=3)", async () => {
    const res = await req("/onboarding/recommended-missions", creator.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    expect(missions.length).toBeGreaterThan(0);
    expect(missions.length).toBeLessThanOrEqual(3);
    // categories were set to 美容/餐飲 above → every result is in that set.
    for (const m of missions) expect(["美容", "餐飲"]).toContain(m.category);
  });

  it("complete awards 100 points once and is idempotent", async () => {
    const first = await req("/onboarding/complete", creator.jwt, { method: "POST" });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.onboarding_completed).toBe(true);
    expect(body.referral_code).toMatch(/^[0-9A-F]{8}$/);

    const bal1 = await req("/wallet/points", creator.jwt);
    expect((await bal1.json()).balance).toBe(100);

    // Second call must not double-award.
    await req("/onboarding/complete", creator.jwt, { method: "POST" });
    const bal2 = await req("/wallet/points", creator.jwt);
    expect((await bal2.json()).balance).toBe(100);
  });
});
```

- [ ] **Step 4: Run the new tests**

Run (local stack up + env exported): `npx vitest run server/test/bootstrap.test.ts server/test/onboarding.test.ts`
Expected: PASS. Without the env they report as **skipped** (not failed) — that is acceptable for the commit; they must pass in CI.

- [ ] **Step 5: Confirm the previously-red RLS test is green**

Run: `npx vitest run server/test/rls.test.ts`
Expected: PASS (the `0004` grants fix the prior 403 on `/api/missions` + `/api/wallet/points/history`). Skipped without env.

- [ ] **Step 6: Commit**

```bash
git add server/test/helpers.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts
git commit -m "test(api): bootstrap (email+phone) and onboarding endpoint integration tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Supabase client → PKCE, manual URL handling

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Update the client options**

Replace `src/lib/supabase.ts` with:

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      // Google + magic-link arrive as `?code=` (PKCE). The callback exchanges it
      // explicitly, so disable auto-detect to avoid a double-exchange race.
      // The inline WhatsApp OTP path doesn't use redirects and is unaffected.
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(auth): switch supabase client to PKCE with manual URL handling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Route-derived workspace slug in `api.ts`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Replace the hardcoded constant with a settable slug**

Replace `src/lib/api.ts` with:

```typescript
import { supabase } from "./supabase";

// The active workspace slug, derived from the route (kocmax/$slug) at runtime
// instead of hardcoded. Defaults to "demo" until a route sets it.
let workspaceSlug = "demo";
export function setWorkspaceSlug(slug: string) {
  workspaceSlug = slug;
}
export function getWorkspaceSlug() {
  return workspaceSlug;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspaceSlug,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.code ?? "error", body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 2: Find every `WORKSPACE_SLUG` importer**

Run: `grep -rn "WORKSPACE_SLUG" src`
Expected: matches in `src/routes/kocmax.$slug.auth.callback.tsx` and its test. (Both are rewritten in Task 9 — no action here beyond noting them.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `kocmax.$slug.auth.callback.tsx` (still importing `WORKSPACE_SLUG`) — fixed in Task 9. If any *other* file errors, update it to use `getWorkspaceSlug()`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "refactor(api): route-derived workspace slug (setWorkspaceSlug/getWorkspaceSlug)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Extend `Me` type + onboarding query hooks

**Files:**
- Modify: `src/lib/queries/kocmax.ts`

- [ ] **Step 1: Extend `Me` and add onboarding hooks**

In `src/lib/queries/kocmax.ts`, replace the `Me` type (line 15) with:

```typescript
export type Me = {
  id: string;
  display_name?: string;
  level: string;
  xp: number;
  phone?: string | null;
  categories?: string[];
  onboarding_step: number;
  onboarding_completed: boolean;
  referral_code?: string;
};
export type OnboardingStatus = { onboarding_step: number; onboarding_completed: boolean; completion_pct: number };
export type RecommendedMission = { id: string; slug: string; title: string; category?: string; points_reward: number; deadline?: string };
export type CompleteResult = { referral_code: string; onboarding_completed: boolean; onboarding_step: number };
```

Change the import on line 1 from:

```typescript
import { useQuery } from "@tanstack/react-query";
```

to:

```typescript
import { useQuery, useMutation } from "@tanstack/react-query";
```

Then append these hooks/mutations at the end of the file:

```typescript
export function useOnboardingStatus() {
  return useQuery({ queryKey: ["onboarding-status"], queryFn: () => apiFetch<OnboardingStatus>("/onboarding/status") });
}
export function useRecommendedMissions() {
  return useQuery({
    queryKey: ["recommended-missions"],
    queryFn: async () => (await apiFetch<{ missions: RecommendedMission[] }>("/onboarding/recommended-missions")).missions,
  });
}
export function useSaveProfile() {
  return useMutation({
    mutationFn: (body: { display_name?: string; categories?: string[]; step?: number }) =>
      apiFetch<{ onboarding_step: number }>("/onboarding/profile", { method: "PUT", body: JSON.stringify(body) }),
  });
}
export function useConnectSocial() {
  return useMutation({
    mutationFn: (body: { platform: string; handle: string; followers?: number }) =>
      apiFetch<{ social_handles: unknown[] }>("/onboarding/social/connect", { method: "POST", body: JSON.stringify(body) }),
  });
}
export function useCompleteOnboarding() {
  return useMutation({
    mutationFn: () => apiFetch<CompleteResult>("/onboarding/complete", { method: "POST" }),
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file. (`Me` now requires `onboarding_*`; no app code constructs a `Me` literal, so nothing else breaks.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/kocmax.ts
git commit -m "feat(queries): onboarding status/profile/social/complete hooks; extend Me

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Shared post-auth branch + callback rewrite

**Files:**
- Create: `src/lib/auth-flow.ts`
- Modify: `src/routes/kocmax.$slug.auth.callback.tsx`
- Test: `src/routes/-kocmax.$slug.auth.callback.test.tsx`

- [ ] **Step 1: Write the failing callback test**

Replace `src/routes/-kocmax.$slug.auth.callback.test.tsx` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate, Link: ({ children }: { children: React.ReactNode }) => children };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn() } },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { Route } from "./kocmax.$slug.auth.callback";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(<Callback />);
}

describe("Auth callback (PKCE landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?code=abc123");
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: null } as never);
    mockFinishAuth.mockResolvedValue(undefined);
  });

  it("exchanges the code then delegates to finishAuth", async () => {
    renderCallback();
    await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123"));
    expect(mockFinishAuth).toHaveBeenCalledWith("demo", mockNavigate);
  });

  it("shows the recovery state when no code is present", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback");
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when the exchange fails", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: { message: "bad code" } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when finishAuth throws", async () => {
    mockFinishAuth.mockRejectedValue(new Error("boom"));
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/routes/-kocmax.$slug.auth.callback.test.tsx`
Expected: FAIL — `@/lib/auth-flow` does not exist yet / callback still uses the old flow.

- [ ] **Step 3: Write `src/lib/auth-flow.ts`**

```typescript
import type { useNavigate } from "@tanstack/react-router";
import { supabase } from "./supabase";
import { apiFetch, setWorkspaceSlug } from "./api";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Shared post-auth branch, invoked from BOTH the inline WhatsApp verify handler
 * and the redirect callback. Bootstraps the creator, refreshes the session, then
 * routes to the wizard (onboarding incomplete) or home. Throws on any failure so
 * callers can surface a recoverable error state.
 */
export async function finishAuth(slug: string, navigate: Navigate) {
  setWorkspaceSlug(slug);
  const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
  await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug, ref }) });

  const { error } = await supabase.auth.refreshSession();
  if (error) throw error;

  const status = await apiFetch<{ onboarding_completed: boolean }>("/onboarding/status");
  if (status.onboarding_completed) {
    navigate({ to: "/kocmax/$slug", params: { slug } });
  } else {
    navigate({ to: "/kocmax/$slug/onboarding", params: { slug } });
  }
}
```

- [ ] **Step 4: Rewrite `src/routes/kocmax.$slug.auth.callback.tsx`**

```typescript
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";

export const Route = createFileRoute("/kocmax/$slug/auth/callback")({ component: Callback });

function Callback() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // PKCE landing for Google / magic-link: exchange the `?code=` for a session.
        const code = new URLSearchParams(window.location.search).get("code");
        if (!code) throw new Error("no auth code in callback URL");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        await finishAuth(slug, navigate);
      } catch {
        setFailed(true);
      }
    })();
  }, [slug, navigate]);
  if (failed) {
    return (
      <div className="mx-auto max-w-sm space-y-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">登入未能完成，請重新登入</p>
        <Link
          to="/kocmax/$slug/login"
          params={{ slug }}
          className="btn-primary inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-6 py-2 font-heading font-bold text-[var(--color-ink)]"
        >
          返回登入
        </Link>
      </div>
    );
  }
  return <div className="p-8">登入中…</div>;
}
```

- [ ] **Step 5: Run the callback test to confirm it passes**

Run: `npx vitest run src/routes/-kocmax.$slug.auth.callback.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the `finishAuth` branch test**

This is the spec §9 "gate" test — it pins the wizard-vs-home decision that both the inline WhatsApp path and the callback rely on. Create `src/lib/auth-flow.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({ supabase: { auth: { refreshSession: vi.fn() } } }));
const { apiFetch, setWorkspaceSlug } = vi.hoisted(() => ({ apiFetch: vi.fn(), setWorkspaceSlug: vi.fn() }));
vi.mock("./api", () => ({ apiFetch, setWorkspaceSlug }));

import { supabase } from "./supabase";
import { finishAuth } from "./auth-flow";

const navigate = vi.fn();

describe("finishAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
  });

  it("bootstraps, sets the slug, and routes incomplete users to the wizard", async () => {
    apiFetch.mockResolvedValueOnce({ created: true }); // /me/bootstrap
    apiFetch.mockResolvedValueOnce({ onboarding_completed: false }); // /onboarding/status
    await finishAuth("demo", navigate as never);
    expect(setWorkspaceSlug).toHaveBeenCalledWith("demo");
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/kocmax/$slug/onboarding", params: { slug: "demo" } });
  });

  it("routes already-onboarded users home", async () => {
    apiFetch.mockResolvedValueOnce({ created: false });
    apiFetch.mockResolvedValueOnce({ onboarding_completed: true });
    await finishAuth("demo", navigate as never);
    expect(navigate).toHaveBeenCalledWith({ to: "/kocmax/$slug", params: { slug: "demo" } });
  });

  it("throws (and does not navigate) when the session refresh fails", async () => {
    apiFetch.mockResolvedValueOnce({ created: true });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: { message: "refresh failed" } } as never);
    await expect(finishAuth("demo", navigate as never)).rejects.toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the `finishAuth` test**

Run: `npx vitest run src/lib/auth-flow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth-flow.ts src/lib/auth-flow.test.ts src/routes/kocmax.$slug.auth.callback.tsx src/routes/-kocmax.$slug.auth.callback.test.tsx
git commit -m "feat(auth): PKCE code exchange + shared finishAuth post-auth branch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: WhatsApp-primary login screen

**Files:**
- Modify: `src/routes/kocmax.$slug.login.tsx`
- Test: `src/routes/-kocmax.$slug.login.test.tsx`

- [ ] **Step 1: Write the failing login test**

Replace `src/routes/-kocmax.$slug.login.test.tsx` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signInWithOAuth: vi.fn() } },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { Route } from "./kocmax.$slug.login";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderLogin() {
  const LoginComponent = Route.options.component as React.ComponentType;
  return render(<LoginComponent />);
}

describe("Login (WhatsApp primary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: { access_token: "t" } }, error: null } as never);
    mockFinishAuth.mockResolvedValue(undefined);
  });

  it("shows the WhatsApp phone field by default", () => {
    renderLogin();
    expect(screen.getByLabelText("WhatsApp 電話號碼")).toBeInTheDocument();
  });

  it("sends a WhatsApp OTP then verifies and calls finishAuth", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("WhatsApp 電話號碼"), { target: { value: "91234567" } });
    fireEvent.submit(screen.getByLabelText("WhatsApp 電話號碼").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        phone: "+85291234567",
        options: { channel: "whatsapp" },
      }),
    );
    // Code stage appears.
    fireEvent.change(await screen.findByLabelText("驗證碼"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByLabelText("驗證碼").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ phone: "+85291234567", token: "123456", type: "sms" }),
    );
    expect(mockFinishAuth).toHaveBeenCalledWith("demo", mockNavigate);
  });

  it("shows an error when sending the OTP fails", async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: { message: "rate limited" } } as never);
    renderLogin();
    fireEvent.change(screen.getByLabelText("WhatsApp 電話號碼"), { target: { value: "91234567" } });
    fireEvent.submit(screen.getByLabelText("WhatsApp 電話號碼").closest("form")!);
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
    expect(screen.queryByLabelText("驗證碼")).not.toBeInTheDocument();
  });

  it("reveals secondary methods (email magic-link + Google)", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
    expect(screen.getByText("用 Google 登入")).toBeInTheDocument();
  });

  it("sends a magic link via the secondary email form", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: expect.stringContaining("/kocmax/demo/auth/callback") },
      }),
    );
    expect(await screen.findByText(/登入連結已傳送/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/routes/-kocmax.$slug.login.test.tsx`
Expected: FAIL — the component still renders the email-only magic-link form.

- [ ] **Step 3: Rewrite `src/routes/kocmax.$slug.login.tsx`**

```typescript
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";

export const Route = createFileRoute("/kocmax/$slug/login")({ component: Login });

/** Normalise a HK number to E.164. Accepts "9123 4567", "+85291234567", etc. */
function toHkE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+852${digits}`;
}

function Login() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();

  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: toHkE164(phone),
      options: { channel: "whatsapp" },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone: toHkE164(phone), token: code.trim(), type: "sms" });
    if (error) { setBusy(false); setError(error.message); return; }
    try {
      await finishAuth(slug, navigate);
    } catch {
      setBusy(false);
      setError("登入未能完成，請重試");
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-bold">登入 KOCmax</h1>
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">輸入你的 WhatsApp 電話號碼以接收驗證碼登入或註冊</p>
          <div className="flex items-center gap-2">
            <span className="rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-3 font-mono text-sm">+852</span>
            <input
              type="tel"
              required
              autoComplete="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9123 4567"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              aria-label="WhatsApp 電話號碼"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "傳送中…" : "用 WhatsApp 收驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">
            驗證碼已透過 WhatsApp 傳送至 <span className="font-bold text-[var(--color-ink)]">{toHkE164(phone)}</span>
          </p>
          <input
            type="text"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6 位數驗證碼"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 text-center font-mono text-lg tracking-widest"
            aria-label="驗證碼"
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "登入中…" : "驗證並登入"}
          </button>
          <button
            type="button"
            onClick={() => { setStage("phone"); setCode(""); setError(null); }}
            className="w-full text-center text-sm text-[var(--color-soft-ink)]"
          >
            更改電話號碼
          </button>
        </form>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowSecondary((s) => !s)}
          className="w-full text-center text-sm text-[var(--color-soft-ink)] underline"
        >
          其他登入方式
        </button>
        {showSecondary && <SecondaryMethods slug={slug} />}
      </div>
    </div>
  );
}

function SecondaryMethods({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/kocmax/${slug}/auth/callback` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/kocmax/${slug}/auth/callback` },
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4">
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
      {sent ? (
        <p className="text-sm text-[var(--color-soft-ink)]">
          登入連結已傳送至 <span className="font-bold text-[var(--color-ink)]">{email.trim()}</span>，請查看電郵。
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-2">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            aria-label="電郵地址"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "傳送中…" : "用電郵連結登入"}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={google}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold text-[var(--color-ink)]"
      >
        用 Google 登入
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/routes/-kocmax.$slug.login.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/kocmax.$slug.login.tsx src/routes/-kocmax.$slug.login.test.tsx
git commit -m "feat(auth): WhatsApp-primary OTP login with secondary email/Google

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `FilterPillsMulti` (multi-select chips for categories)

**Files:**
- Modify: `src/components/FilterPills.tsx`
- Test: `src/components/components.test.tsx`

- [ ] **Step 1: Add a failing test**

In `src/components/components.test.tsx`, ensure the imports include `FilterPillsMulti` (add it to the existing `./FilterPills` import, or add a new import line), and that `render`, `screen`, `fireEvent` are imported from `@testing-library/react`. Append a new `describe` block:

```typescript
describe("FilterPillsMulti", () => {
  it("toggles a value in and out of the selection", () => {
    const seen: string[][] = [];
    const onChange = (v: string[]) => seen.push(v);
    const { rerender } = render(
      <FilterPillsMulti options={["美容", "餐飲", "寵物"]} value={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("美容"));
    expect(seen.at(-1)).toEqual(["美容"]);

    rerender(<FilterPillsMulti options={["美容", "餐飲", "寵物"]} value={["美容"]} onChange={onChange} />);
    expect(screen.getByText("美容")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("美容"));
    expect(seen.at(-1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/components/components.test.tsx`
Expected: FAIL — `FilterPillsMulti` is not exported.

- [ ] **Step 3: Add `FilterPillsMulti` to `src/components/FilterPills.tsx`**

Append to the file (keep the existing single-select `FilterPills` export unchanged):

```typescript
export function FilterPillsMulti({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(opt)}
            className={`filter-pill shrink-0 rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm ${active ? "bg-[var(--color-acid)] font-bold" : "bg-white"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/components/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterPills.tsx src/components/components.test.tsx
git commit -m "feat(ui): FilterPillsMulti multi-select chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Onboarding gate in the layout `beforeLoad`

**Files:**
- Modify: `src/routes/kocmax.$slug.tsx`

- [ ] **Step 1: Update `beforeLoad`**

Replace `src/routes/kocmax.$slug.tsx` with:

```typescript
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { apiFetch, setWorkspaceSlug } from "@/lib/api";
import { useWorkspace, type Me } from "@/lib/queries/kocmax";
import { applyTheme } from "@/lib/theme";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/kocmax/$slug")({
  beforeLoad: async ({ params, location, context }) => {
    setWorkspaceSlug(params.slug);
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname.endsWith("/login") || location.pathname.includes("/auth/");
    const isOnboardingRoute = location.pathname.includes("/onboarding");

    if (!data.session && !isAuthRoute && !isOnboardingRoute) {
      throw redirect({ to: "/kocmax/$slug/login", params: { slug: params.slug } });
    }

    // Onboarding gate (defence in depth). Cached read → no per-navigation round-trip.
    if (data.session && !isAuthRoute && !isOnboardingRoute) {
      const me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: () => apiFetch<Me>("/me"),
      });
      if (me && me.onboarding_completed === false) {
        throw redirect({ to: "/kocmax/$slug/onboarding", params: { slug: params.slug } });
      }
    }
  },
  component: Layout,
});

function Layout() {
  const { slug } = Route.useParams();
  const ws = useWorkspace();
  useEffect(() => { if (ws.data?.theme) applyTheme(ws.data.theme); }, [ws.data]);
  return (
    <div className="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)] pb-20">
      <main><Outlet /></main>
      <BottomNav slug={slug} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`context.queryClient` is typed via `createRootRouteWithContext<{ queryClient: QueryClient }>` in `__root.tsx`.)

- [ ] **Step 3: Build to confirm the route graph is valid**

Run: `npm run build`
Expected: build succeeds (TanStack route generation + Vite bundle).

- [ ] **Step 4: Commit**

```bash
git add src/routes/kocmax.$slug.tsx
git commit -m "feat(auth): cached onboarding gate in the kocmax layout beforeLoad

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: The onboarding wizard route (Steps 2–5)

**Files:**
- Create: `src/routes/kocmax.$slug.onboarding.tsx`
- Test: `src/routes/-kocmax.$slug.onboarding.test.tsx`

- [ ] **Step 1: Write the failing wizard test**

Create `src/routes/-kocmax.$slug.onboarding.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const hoisted = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  connectSocial: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useOnboardingStatus: () => ({ data: { onboarding_step: 2, onboarding_completed: false, completion_pct: 25 }, isLoading: false }),
  useRecommendedMissions: () => ({ data: [{ id: "1", slug: "m1", title: "美容試用", category: "美容", points_reward: 300 }], isLoading: false }),
  useSaveProfile: () => ({ mutateAsync: hoisted.saveProfile, isPending: false }),
  useConnectSocial: () => ({ mutateAsync: hoisted.connectSocial, isPending: false }),
  useCompleteOnboarding: () => ({ mutateAsync: hoisted.complete, isPending: false }),
}));

import { Route } from "./kocmax.$slug.onboarding";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderWizard() {
  const Wizard = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Wizard />
    </QueryClientProvider>,
  );
}

describe("Onboarding wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.saveProfile.mockResolvedValue({ onboarding_step: 3 });
    hoisted.connectSocial.mockResolvedValue({ social_handles: [] });
    hoisted.complete.mockResolvedValue({ referral_code: "ABCD1234", onboarding_completed: true, onboarding_step: 5 });
  });

  it("starts at the categories step (step 2)", () => {
    renderWizard();
    expect(screen.getByText("你的範疇")).toBeInTheDocument();
  });

  it("saves selected categories and advances to platforms", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("美容"));
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ categories: ["美容"], step: 3 }));
    expect(screen.getByText("你的平台")).toBeInTheDocument();
  });

  it("can skip categories and still advance", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("略過"));
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ categories: [], step: 3 }));
    expect(screen.getByText("你的平台")).toBeInTheDocument();
  });

  it("reaches the welcome step and completes, revealing the referral code", async () => {
    renderWizard();
    // step 2 → 3
    fireEvent.click(screen.getByText("略過"));
    await screen.findByText("你的平台");
    // step 3 → 4
    fireEvent.click(screen.getByText("略過"));
    await screen.findByText("你的第一個任務");
    // step 4 → 5
    fireEvent.click(screen.getByText("下一步"));
    await screen.findByText("迎新獎賞");
    // claim
    fireEvent.click(screen.getByText("領取 100 積分"));
    await waitFor(() => expect(hoisted.complete).toHaveBeenCalled());
    expect(await screen.findByText(/ABCD1234/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/routes/-kocmax.$slug.onboarding.test.tsx`
Expected: FAIL — the route file does not exist.

- [ ] **Step 3: Write `src/routes/kocmax.$slug.onboarding.tsx`**

```typescript
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ProgressBar } from "@/components/ProgressBar";
import { FilterPillsMulti } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import {
  useOnboardingStatus,
  useRecommendedMissions,
  useSaveProfile,
  useConnectSocial,
  useCompleteOnboarding,
} from "@/lib/queries/kocmax";

export const Route = createFileRoute("/kocmax/$slug/onboarding")({ component: Wizard });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Wizard() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useOnboardingStatus();
  const recommended = useRecommendedMissions();
  const saveProfile = useSaveProfile();
  const connectSocial = useConnectSocial();
  const complete = useCompleteOnboarding();

  // Resume at the persisted step; the wizard renders screens for steps 2–5.
  const [step, setStep] = useState<number>(() => Math.max(2, status.data?.onboarding_step ?? 2));
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [reward, setReward] = useState<{ referral_code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function categoriesNext(selected: string[]) {
    setError(null);
    try {
      await saveProfile.mutateAsync({ categories: selected, step: 3 });
      setStep(3);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function platformsNext() {
    setError(null);
    try {
      for (const [platform, handle] of Object.entries(handles)) {
        if (handle.trim()) await connectSocial.mutateAsync({ platform, handle: handle.trim() });
      }
      await saveProfile.mutateAsync({ step: 4 });
      setStep(4);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function missionNext() {
    setError(null);
    try {
      await saveProfile.mutateAsync({ step: 5 });
      setStep(5);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function claim() {
    setError(null);
    try {
      const res = await complete.mutateAsync();
      setReward({ referral_code: res.referral_code });
      // Refresh the gate's cached /me + the balance so home reflects the bonus.
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch { setError("領取失敗，請重試"); }
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 p-6">
      <ProgressBar value={step - 1} max={5} />
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {step === 2 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的範疇</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">選擇你的內容範疇（可選 1–3 個），方便我們推薦任務。</p>
          <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => categoriesNext([])}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              略過
            </button>
            <button
              type="button"
              onClick={() => categoriesNext(categories)}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
            >
              下一步
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的平台</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">填寫你的社交帳號（可選），稍後可驗證。</p>
          <div className="space-y-2">
            {PLATFORMS.map((p) => (
              <input
                key={p}
                value={handles[p] ?? ""}
                onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                placeholder={`${p} 帳號`}
                aria-label={`${p} 帳號`}
                className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={platformsNext} className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold">略過</button>
            <button type="button" onClick={platformsNext} className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">下一步</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的第一個任務</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">這些是為你推薦的任務。完成註冊後即可在任務頁面參加。</p>
          <div className="space-y-3">
            {(recommended.data ?? []).map((m) => (
              <MissionCard key={m.id} title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            ))}
          </div>
          <button type="button" onClick={missionNext} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">下一步</button>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold">迎新獎賞</h1>
          {reward ? (
            <div className="space-y-3">
              <p className="font-display text-4xl font-bold text-[var(--color-acid)]">+100 積分</p>
              <p className="text-sm text-[var(--color-soft-ink)]">你的邀請碼：</p>
              <p className="font-mono text-xl font-bold tracking-widest">{reward.referral_code}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">邀請朋友，各得 200 分</p>
              <button
                type="button"
                onClick={() => navigate({ to: "/kocmax/$slug", params: { slug } })}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
              >
                開始賺取積分
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-soft-ink)]">完成註冊，領取你的迎新積分！</p>
              <button
                type="button"
                onClick={claim}
                disabled={complete.isPending}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
              >
                {complete.isPending ? "處理中…" : "領取 100 積分"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/routes/-kocmax.$slug.onboarding.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/kocmax.$slug.onboarding.tsx src/routes/-kocmax.$slug.onboarding.test.tsx
git commit -m "feat(onboarding): 5-step wizard (categories/platforms/mission/welcome)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Full gate green + final verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the full unit test suite (front-end + server units; integration skips without env)**

Run: `npx vitest run`
Expected: all PASS; integration suites (`rls`, `bootstrap`, `onboarding`) either PASS (env present) or report **skipped**. Zero failures.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Final commit (if lint/format touched anything)**

```bash
git add -A
git commit -m "chore(slice3): final lint/build pass" || echo "nothing to commit"
```

---

## User-gated setup (must happen before WhatsApp login works in any environment)

These are external and cannot be done by the implementer. Restated from spec §10 so they aren't forgotten:

**A. WhatsApp OTP (primary):**
1. Meta WhatsApp Business Account + a verified `+852` sender + an approved **Authentication** message template (template approval has lead time — start now).
2. Twilio: a **Verify Service** with the **WhatsApp channel** enabled, connected to the WABA sender; keep this OTP sender separate from any messaging sender.
3. Supabase → Auth → Providers → **Phone**: enable, provider = **Twilio Verify**, paste Account SID / Auth Token / Verify Service SID, enable the **WhatsApp** channel.

**B. Secondary providers:**
1. Google Cloud OAuth 2.0 Web client → Supabase → Auth → Providers → **Google** (client id/secret).
2. Supabase → Auth → URL Configuration: add `<origin>/kocmax/*/auth/callback` to the redirect allow-list + set Site URL (this also unblocks the secondary magic-link path).
3. Add `SUPABASE_SERVICE_KEY` to the server env if not already set (the bootstrap path needs the service client).

**Local testing of the OTP UI:** the front-end tests mock Supabase, so they need none of the above. For a manual local OTP round-trip without Twilio, use Supabase's `[auth.sms.test_otp]` map in `config.toml` (fixed phone→code) — out of scope for this plan's automated tests.

---

## Deferred to Slice 3.5 — Messaging (not in this plan)

Two-way/conversational WhatsApp (inbound webhooks, `whatsapp_conversations`/`messages`, dispatch, outbound session/template sends) via hybrid reuse of the live Laravel `fimmick-crm` kocmax pipeline; plus the in-app identity-linking UI (`linkIdentity`). See spec §11.
