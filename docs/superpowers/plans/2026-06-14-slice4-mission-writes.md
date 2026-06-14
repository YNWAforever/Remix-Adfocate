# Slice 4 — Mission Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the KOC earn loop — join an open mission, submit content, an operator approves, and points + XP are awarded — on the live Supabase/Hono/React foundation.

**Architecture:** A new `mission_submissions` table holds the lifecycle (`joined → submitted → approved | rejected`). All state changes go through 4 `SECURITY DEFINER` RPCs (mirroring `award_welcome_bonus`) so quota and awards stay atomic and `xp`/points stay service-controlled. KOC writes land on the existing guarded `/api/missions` group; approval lands on a new shared-secret `/api/admin` group. Frontend gets join/submit on mission detail + a "My Missions" view.

**Tech Stack:** Supabase (Postgres + RLS + RPC), Hono on Vercel, supabase-js, React 19 + TanStack Router/Query + Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-adfocate-slice4-mission-writes-design.md` (commit `faa4d52`).

**Branch:** `feat/slice4-mission-writes` (already created off `main` @ `9d23fdf`).

**Prerequisite for integration tests:** a local Supabase stack (`colima start && supabase start -x vector -x logflare -x studio -x edge-runtime -x imgproxy -x inbucket`), then export keys (`eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY`). Without it the integration suites **skip** (guarded by `hasSupabaseEnv`); CI runs them for real. Unit/component tests (Vitest + Testing Library) run without a stack.

---

## File Structure

**Backend**
- Create `supabase/migrations/0005_mission_submissions.sql` — table + indexes + RLS + grants + `level_ordinal` helper + 4 RPCs + execute grants.
- Modify `server/routes/missions.ts` — add `GET /my`, `POST /:slug/join`, `PUT /:slug/submit`, `POST /:slug/apply` (stub), and `my_status`/`access_type` on `GET /`.
- Create `server/routes/admin.ts` — `x-admin-secret` middleware + `GET /submissions`, `POST /submissions/:id/approve`, `POST /submissions/:id/reject`.
- Modify `server/app.ts` — register the admin group (unguarded; its own secret middleware).
- Modify `server/test/helpers.ts` — `makeMission()` seeder + test-mission/submission cleanup.
- Create `server/test/missions.test.ts` — join/submit/my/apply integration tests.
- Create `server/test/admin.test.ts` — approve/reject/idempotency/guard integration tests.
- Modify `package.json` — add the two new suites to `test:integration`.
- Modify `.github/workflows/ci.yml` — set `ADMIN_SECRET` for the integration job.

**Frontend**
- Modify `src/lib/queries/kocmax.ts` — `Mission.access_type`/`my_status`, `MyMission` type, `useMyMissions`, `useJoinMission`, `useSubmitMission`.
- Modify `src/routes/kocmax.$slug.mission.$missionSlug.tsx` — Join CTA + submit form + status.
- Create `src/routes/kocmax.$slug.my.tsx` — My Missions view grouped by status.
- Create `src/routes/-kocmax.$slug.mission.$missionSlug.test.tsx` — component test.
- Create `src/routes/-kocmax.$slug.my.test.tsx` — component test.

---

## Task 1: Migration 0005 — table, RLS, grants, RPCs

**Files:**
- Create: `supabase/migrations/0005_mission_submissions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Slice 4: mission submissions (the KOC earn loop) + state-machine RPCs.

-- 1. Table ------------------------------------------------------------------
create table public.mission_submissions (
  id uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references public.missions(id)   on delete cascade,
  creator_id   uuid not null references public.creators(id)   on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'joined'
    check (status in ('joined','submitted','under_review','approved','rejected','expired')),
  content_urls    text[] not null default '{}',
  submission_data jsonb  not null default '{}',
  reviewer_notes  text,
  xp_awarded      integer not null default 0,
  points_awarded  integer not null default 0,
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  review_deadline timestamptz,
  created_at      timestamptz not null default now(),
  unique (mission_id, creator_id)
);

create index mission_submissions_creator_idx on public.mission_submissions (creator_id);
create index mission_submissions_mission_idx on public.mission_submissions (mission_id);
create index mission_submissions_status_idx  on public.mission_submissions (workspace_id, status);

-- 2. RLS: a creator sees only their own submissions. All WRITES go through the
--    SECURITY DEFINER RPCs below (quota + awards atomic; xp/points service-only).
alter table public.mission_submissions enable row level security;
create policy submissions_self on public.mission_submissions
  for select using (creator_id = auth.uid());

-- 3. Grants (auto_expose_new_tables=false → a fresh table gets none; Slice 3 lesson)
grant select on public.mission_submissions to authenticated;
grant all    on public.mission_submissions to service_role;

-- 4. Level ordinal helper (no level recompute this slice; every creator is L0,
--    so only required_level='L0' missions are joinable in practice — honest gate).
create or replace function public.level_ordinal(p_level text) returns int
language sql immutable set search_path = public as $$
  select coalesce(array_position(array['L0','L1','L2','L3','L4','L5','L6'], p_level), 0)
$$;

-- 5. join_mission: atomic quota + level gate + dedupe, +10 XP -----------------
create or replace function public.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_rows int;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level, quota, filled
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'open' then raise exception 'not_open'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;
  if public.level_ordinal(v_level) < public.level_ordinal(m.required_level)
    then raise exception 'level_locked'; end if;
  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  insert into public.mission_submissions
    (mission_id, creator_id, workspace_id, status, xp_awarded)
    values (p_mission, v_creator, v_ws, 'joined', 10)
    returning * into v_sub;
  update public.creators set xp = xp + 10 where id = v_creator;
  return v_sub;
end;
$$;

-- 6. submit_mission: joined → submitted, +25 XP ------------------------------
create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',   -- fixed SLA; per-mission column lands with the S9 cron
    xp_awarded = xp_awarded + 25
    where id = v_sub.id
    returning * into v_sub;
  update public.creators set xp = xp + 25 where id = v_creator;
  return v_sub;
end;
$$;

-- 7. approve_submission: award points_reward + 100 XP, idempotent (service-only)
create or replace function public.approve_submission(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
  v_points int;
  v_title text;
  v_bal int;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'approved' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  select points_reward, title into v_points, v_title
    from public.missions where id = v_sub.mission_id;

  update public.point_balances set balance = balance + v_points, updated_at = now()
    where creator_id = v_sub.creator_id and workspace_id = v_sub.workspace_id
    returning balance into v_bal;
  if v_bal is null then
    raise exception 'point_balances row missing for creator %', v_sub.creator_id;
  end if;

  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (v_sub.creator_id, v_sub.workspace_id, 'earn', v_points, v_bal,
            'mission_submission:' || p_submission, v_title);

  update public.mission_submissions set
    status = 'approved', reviewed_at = now(), reviewer_notes = p_notes,
    points_awarded = v_points, xp_awarded = xp_awarded + 100
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 100 where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- 8. reject_submission: → rejected, no award, idempotent (service-only) -------
create or replace function public.reject_submission(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'rejected' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'rejected', reviewed_at = now(), reviewer_notes = p_notes
    where id = p_submission
    returning * into v_sub;
  return v_sub;
end;
$$;

-- 9. Execute grants: KOCs may join/submit (auth.uid); only the service role
--    (operator) may approve/reject.
revoke all on function public.join_mission(uuid)                  from public, anon;
revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
revoke all on function public.approve_submission(uuid, text)      from public, anon, authenticated;
revoke all on function public.reject_submission(uuid, text)       from public, anon, authenticated;
grant execute on function public.join_mission(uuid)                  to authenticated, service_role;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;
grant execute on function public.approve_submission(uuid, text)      to service_role;
grant execute on function public.reject_submission(uuid, text)       to service_role;
```

- [ ] **Step 2: Apply the migration to the local stack**

Run: `supabase db reset`
Expected: applies `0001`–`0005` with no error; ends "Finished supabase db reset".

- [ ] **Step 3: Smoke-check the functions exist**

Run:
```bash
psql "$(supabase status -o env | grep DB_URL | cut -d'"' -f2)" -c \
  "select proname from pg_proc where proname in ('join_mission','submit_mission','approve_submission','reject_submission','level_ordinal') order by 1;"
```
Expected: 5 rows — `approve_submission`, `join_mission`, `level_ordinal`, `reject_submission`, `submit_mission`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_mission_submissions.sql
git commit -m "feat(slice4): mission_submissions table + state-machine RPCs"
```

---

## Task 2: Test helper — makeMission + cleanup

**Files:**
- Modify: `server/test/helpers.ts`

- [ ] **Step 1: Add the `makeMission` seeder**

Add after `makeUser` (before `cleanup`) in `server/test/helpers.ts`:

```ts
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
```

- [ ] **Step 2: Extend `cleanup()` to remove test missions + their submissions**

Replace the body of `cleanup()` in `server/test/helpers.ts` with:

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers.ts
git commit -m "test(slice4): makeMission seeder + test-mission cleanup"
```

---

## Task 3: POST /missions/:slug/join

**Files:**
- Modify: `server/routes/missions.ts`
- Test: `server/test/missions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/missions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

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

suite("mission join", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("join@test.local", 0);
  });
  afterAll(cleanup);

  it("joins an open mission: row created, status joined, +10 XP", async () => {
    await makeMission({ slug: "test-join-ok", points_reward: 100, quota: 5 });
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("joined");
    expect(body.xp_awarded).toBe(10);

    const me = await req("/me", koc.jwt);
    expect((await me.json()).xp).toBe(10);
  });

  it("rejects a second join with already_joined", async () => {
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_joined");
  });

  it("rejects join when the mission is full", async () => {
    await makeMission({ slug: "test-join-full", quota: 1, filled: 1 });
    const res = await req("/missions/test-join-full/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("mission_full");
  });

  it("rejects join on a non-open (application) mission", async () => {
    await makeMission({ slug: "test-join-gated", access_type: "application" });
    const res = await req("/missions/test-join-gated/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_open");
  });

  it("rejects join on a closed mission", async () => {
    await makeMission({ slug: "test-join-closed", status: "closed" });
    const res = await req("/missions/test-join-closed/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("closed");
  });

  it("404s an unknown mission slug", async () => {
    const res = await req("/missions/test-does-not-exist/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- server/test/missions.test.ts` (with the local stack up)
Expected: FAIL — `POST /missions/:slug/join` returns 404 (route not defined) instead of 200/409.

- [ ] **Step 3: Implement the route + shared RPC-error mapper**

Rewrite `server/routes/missions.ts` to add the import, the `rpcError` helper, and the join route. The full file after this task:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import type { PostgrestError } from "@supabase/supabase-js";

export const missionRoutes = new Hono<Env>();

// RPC raise-messages double as stable codes. Map them to HTTP; anything else is a 500.
const RPC_409 = new Set([
  "mission_full", "already_joined", "not_open", "closed",
  "level_locked", "wrong_state", "empty_urls", "not_authenticated",
]);
function rpcError(c: Context<Env>, error: PostgrestError) {
  const msg = error.message ?? "";
  if (msg === "not_found") return c.json({ error: msg, code: msg }, 404);
  if (RPC_409.has(msg)) return c.json({ error: msg, code: msg }, 409);
  return c.json({ error: msg || "rpc error", code: "db_error" }, 500);
}

missionRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("missions")
    .select("id, slug, title, description, category, mission_type, access_type, points_reward, deadline, quota, filled, status")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  // Annotate each mission with the caller's submission status (or null).
  const { data: subs } = await supabase
    .from("mission_submissions")
    .select("mission_id, status")
    .eq("creator_id", c.get("userId"));
  const byId = new Map((subs ?? []).map((s) => [s.mission_id, s.status]));
  const missions = (data ?? []).map((m) => ({ ...m, my_status: byId.get(m.id) ?? null }));
  return c.json({ missions });
});

/** Caller's own submissions (joined to their missions). Registered before /:slug. */
missionRoutes.get("/my", async (c) => {
  const status = c.req.query("status");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("mission_submissions")
    .select(
      "id, status, content_urls, points_awarded, submitted_at, reviewed_at, created_at, missions!inner(slug, title, category, points_reward, mission_type)",
    )
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ submissions: data ?? [] });
});

missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(data);
});

/** Join an open mission. */
missionRoutes.post("/:slug/join", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("join_mission", { p_mission: m.id });
  if (error) return rpcError(c, error);
  return c.json(data);
});

/** Gated 'application' missions: vetting arrives with the Brand Dashboard (Slice 8). */
missionRoutes.post("/:slug/apply", (c) => c.json({ error: "not_available", code: "not_available" }, 409));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- server/test/missions.test.ts`
Expected: PASS (the "mission join" describe block — 6 tests green).

- [ ] **Step 5: Commit**

```bash
git add server/routes/missions.ts server/test/missions.test.ts
git commit -m "feat(slice4): POST /missions/:slug/join + my_status, /my, apply stub"
```

---

## Task 4: PUT /missions/:slug/submit

**Files:**
- Modify: `server/routes/missions.ts`
- Test: `server/test/missions.test.ts`

- [ ] **Step 1: Write the failing test**

Append this describe block to `server/test/missions.test.ts`:

```ts
suite("mission submit", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("submit@test.local", 0);
    await makeMission({ slug: "test-submit-ok", points_reward: 100, quota: 5 });
    await req("/missions/test-submit-ok/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("submits content: status submitted, +25 XP (total 35)", async () => {
    const res = await req("/missions/test-submit-ok/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/abc"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("submitted");
    expect(body.content_urls).toEqual(["https://ig.com/p/abc"]);
    expect(body.submitted_at).toBeTruthy();
    expect(body.xp_awarded).toBe(35);
  });

  it("rejects an empty content_urls array", async () => {
    await makeMission({ slug: "test-submit-empty", quota: 5 });
    await req("/missions/test-submit-empty/join", koc.jwt, { method: "POST" });
    const res = await req("/missions/test-submit-empty/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: [] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("empty_urls");
  });

  it("rejects submit before join (wrong_state)", async () => {
    await makeMission({ slug: "test-submit-nojoin", quota: 5 });
    const res = await req("/missions/test-submit-nojoin/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://x"] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("wrong_state");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- server/test/missions.test.ts`
Expected: FAIL — the "mission submit" block fails (submit route 404).

- [ ] **Step 3: Implement the submit route**

Add to `server/routes/missions.ts` (after the `/:slug/join` route, before `/:slug/apply`):

```ts
/** Submit content for a joined mission. */
missionRoutes.put("/:slug/submit", async (c) => {
  const body = await c.req.json<{ content_urls: string[]; submission_data?: Record<string, unknown> }>();
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("submit_mission", {
    p_mission: m.id,
    p_urls: body.content_urls ?? [],
    p_data: body.submission_data ?? {},
  });
  if (error) return rpcError(c, error);
  return c.json(data);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- server/test/missions.test.ts`
Expected: PASS (both "mission join" and "mission submit" blocks green).

- [ ] **Step 5: Commit**

```bash
git add server/routes/missions.ts server/test/missions.test.ts
git commit -m "feat(slice4): PUT /missions/:slug/submit"
```

---

## Task 5: GET /missions/my + my_status + apply stub tests

**Files:**
- Test: `server/test/missions.test.ts`

(The routes were implemented in Task 3; this task locks their behavior with tests.)

- [ ] **Step 1: Write the failing tests**

Append to `server/test/missions.test.ts`:

```ts
suite("mission list + my + apply", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("list@test.local", 0);
    await makeMission({ slug: "test-list-joined", quota: 5 });
    await req("/missions/test-list-joined/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("GET / annotates joined missions with my_status", async () => {
    const res = await req("/missions", koc.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    const joined = missions.find((m: { slug: string }) => m.slug === "test-list-joined");
    expect(joined.my_status).toBe("joined");
    // a seed mission the koc never joined stays null
    const other = missions.find((m: { slug: string }) => m.slug === "ugc-cafe");
    expect(other.my_status).toBeNull();
  });

  it("GET /my returns the caller's submissions", async () => {
    const res = await req("/missions/my", koc.jwt);
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].status).toBe("joined");
    expect(submissions[0].missions.slug).toBe("test-list-joined");
  });

  it("GET /my?status=approved filters to none here", async () => {
    const res = await req("/missions/my?status=approved", koc.jwt);
    expect((await res.json()).submissions).toHaveLength(0);
  });

  it("POST /:slug/apply is a not_available stub", async () => {
    await makeMission({ slug: "test-apply-gated", access_type: "application" });
    const res = await req("/missions/test-apply-gated/apply", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_available");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration -- server/test/missions.test.ts`
Expected: PASS (all three blocks green — the routes already exist from Task 3).

> If `GET /my` is shadowed by `/:slug` (returns a mission instead of submissions), confirm `/my` is registered **before** `/:slug` in `server/routes/missions.ts`. It is in the Task 3 file layout.

- [ ] **Step 3: Commit**

```bash
git add server/test/missions.test.ts
git commit -m "test(slice4): mission list my_status, /my, apply stub"
```

---

## Task 6: Admin approve/reject endpoints

**Files:**
- Create: `server/routes/admin.ts`
- Modify: `server/app.ts`
- Test: `server/test/admin.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/admin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

// Make the in-process admin middleware and the test agree on the secret.
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string, init: RequestInit = {}) {
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
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("admin submission review", () => {
  let koc: { userId: string; jwt: string };
  let submissionId: string;
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("admin@test.local", 0);
    await makeMission({ slug: "test-admin-mission", points_reward: 250, quota: 5 });
    await koreq("/missions/test-admin-mission/join", koc.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-mission/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/admin"] }),
    });
    submissionId = (await sub.json()).id;
  });
  afterAll(cleanup);

  it("rejects admin calls without the secret header", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" }, "");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists pending submissions", async () => {
    const res = await adminreq("/admin/submissions?status=submitted");
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions.some((s: { id: string }) => s.id === submissionId)).toBe(true);
  });

  it("approves once: awards 250 points + 100 XP, and is idempotent", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "looks good" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.points_awarded).toBe(250);

    const bal1 = await koreq("/wallet/points", koc.jwt);
    expect((await bal1.json()).balance).toBe(250);
    const me1 = await koreq("/me", koc.jwt);
    expect((await me1.json()).xp).toBe(135); // 10 join + 25 submit + 100 approve

    // Second approve must not double-award.
    await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" });
    const bal2 = await koreq("/wallet/points", koc.jwt);
    expect((await bal2.json()).balance).toBe(250);
  });

  it("rejects a submitted submission (no award)", async () => {
    const koc2 = await makeCreator("admin2@test.local", 0);
    await makeMission({ slug: "test-admin-reject", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-reject/join", koc2.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-reject/submit", koc2.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
    const bal = await koreq("/wallet/points", koc2.jwt);
    expect((await bal.json()).balance).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: FAIL — `/api/admin/...` routes 404 (not registered).

- [ ] **Step 3: Implement the admin routes**

Create `server/routes/admin.ts`:

```ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";

/** Operator-only review endpoints. Interim shared-secret auth (replaced by real
 *  admin-auth / the Brand Dashboard in Slice 8). Uses the service client. */
export const adminRoutes = new Hono();

adminRoutes.use("*", async (c, next) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = c.req.header("x-admin-secret");
  if (!secret || provided !== secret) {
    return c.json({ error: "forbidden", code: "no_admin" }, 401);
  }
  await next();
});

adminRoutes.get("/submissions", async (c) => {
  const status = c.req.query("status") ?? "submitted";
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select("id, status, content_urls, submitted_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", status)
    .order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ submissions: data ?? [] });
});

adminRoutes.post("/submissions/:id/approve", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}))).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("approve_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

adminRoutes.post("/submissions/:id/reject", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}))).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("reject_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});
```

- [ ] **Step 4: Register the admin group in `server/app.ts`**

Add the import after the other route imports:

```ts
import { adminRoutes } from "./routes/admin.js";
```

Add this line inside `createApp()`, right after `app.route("/me", meBootstrap);` (admin is unguarded — it has its own secret middleware, not workspaceAuth):

```ts
  // Unguarded operator endpoints (own shared-secret middleware).
  app.route("/admin", adminRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -- server/test/admin.test.ts`
Expected: PASS (4 tests green).

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin.ts server/app.ts server/test/admin.test.ts
git commit -m "feat(slice4): operator admin approve/reject endpoints"
```

---

## Task 7: Wire new suites into CI

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the new suites to `test:integration`**

In `package.json`, change the `test:integration` script to append the two new files:

```json
"test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts",
```

- [ ] **Step 2: Provide `ADMIN_SECRET` to the integration job**

In `.github/workflows/ci.yml`, in the `integration` job's final step (`- run: npm run test:integration`), add an `env` block so the in-process admin middleware has a secret in CI:

```yaml
      - run: npm run test:integration
        env:
          ADMIN_SECRET: test-admin-secret
```

- [ ] **Step 3: Verify the script locally (skips without a stack)**

Run: `npm run test:integration`
Expected: with no local stack, all integration suites **skip** (0 failures); with a stack up, all PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "test(slice4): run mission + admin suites in CI integration job"
```

---

## Task 8: Frontend query hooks

**Files:**
- Modify: `src/lib/queries/kocmax.ts`

- [ ] **Step 1: Add types + hooks**

In `src/lib/queries/kocmax.ts`:

(a) Change the import line at the top to also pull `useQueryClient`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
```

(b) Replace the existing `Mission` type with this (adds `access_type`, `my_status`, and the `SubmissionStatus` union):

```ts
export type SubmissionStatus = "joined" | "submitted" | "under_review" | "approved" | "rejected" | "expired";
export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; access_type?: string; points_reward: number;
  deadline?: string; quota: number; filled: number; status: string;
  my_status?: SubmissionStatus | null;
};
```

(c) Add the `MyMission` type and the three hooks at the end of the file:

```ts
export type MyMission = {
  id: string;
  status: SubmissionStatus;
  content_urls: string[];
  points_awarded: number;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  missions: { slug: string; title: string; category?: string; points_reward: number; mission_type: string };
};

export function useMyMissions(status?: SubmissionStatus) {
  const qs = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["my-missions", status ?? "all"],
    queryFn: async () => (await apiFetch<{ submissions: MyMission[] }>(`/missions/my${qs}`)).submissions,
  });
}

export function useJoinMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<MyMission>(`/missions/${slug}/join`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["missions"] });
      qc.invalidateQueries({ queryKey: ["my-missions"] });
    },
  });
}

export function useSubmitMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content_urls: string[]; submission_data?: Record<string, unknown> }) =>
      apiFetch<MyMission>(`/missions/${slug}/submit`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["my-missions"] });
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/kocmax.ts
git commit -m "feat(slice4): mission-write query hooks (join/submit/my)"
```

---

## Task 9: Mission detail — join + submit UI

**Files:**
- Modify: `src/routes/kocmax.$slug.mission.$missionSlug.tsx`
- Test: `src/routes/-kocmax.$slug.mission.$missionSlug.test.tsx` (create)

- [ ] **Step 1: Write the failing component test**

Create `src/routes/-kocmax.$slug.mission.$missionSlug.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> };
});

const hoisted = vi.hoisted(() => ({
  mission: { data: { slug: "m1", title: "美容試用", description: "d", category: "美容", access_type: "open", points_reward: 300, mission_type: "ugc", quota: 5, filled: 1, status: "active" }, isLoading: false, isError: false },
  my: { data: [] as unknown[], isLoading: false },
  join: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMission: () => hoisted.mission,
  useMyMissions: () => hoisted.my,
  useJoinMission: () => ({ mutateAsync: hoisted.join, isPending: false }),
  useSubmitMission: () => ({ mutateAsync: hoisted.submit, isPending: false }),
}));

import { Route } from "./kocmax.$slug.mission.$missionSlug";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo", missionSlug: "m1" } as never);

function renderDetail() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Mission detail writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.my.data = [];
    hoisted.mission.data.access_type = "open";
    hoisted.join.mockResolvedValue({ id: "s1", status: "joined" });
    hoisted.submit.mockResolvedValue({ id: "s1", status: "submitted" });
  });

  it("shows the Join CTA for an open, un-joined mission", () => {
    renderDetail();
    expect(screen.getByText("加入任務")).toBeInTheDocument();
  });

  it("calls join when the CTA is clicked", async () => {
    renderDetail();
    fireEvent.click(screen.getByText("加入任務"));
    await waitFor(() => expect(hoisted.join).toHaveBeenCalled());
  });

  it("shows the submit form once joined", () => {
    hoisted.my.data = [{ id: "s1", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByPlaceholderText(/貼上你的內容連結/)).toBeInTheDocument();
  });

  it("submits the entered URLs", async () => {
    hoisted.my.data = [{ id: "s1", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    fireEvent.change(screen.getByPlaceholderText(/貼上你的內容連結/), { target: { value: "https://ig.com/p/a" } });
    fireEvent.click(screen.getByText("提交內容"));
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledWith({ content_urls: ["https://ig.com/p/a"] }));
  });

  it("disables the CTA for an application mission", () => {
    hoisted.mission.data.access_type = "application";
    renderDetail();
    expect(screen.getByText(/需要申請/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-kocmax.$slug.mission.$missionSlug.test.tsx`
Expected: FAIL — no "加入任務" element (current screen renders the placeholder "開始任務" link).

- [ ] **Step 3: Implement the UI**

Rewrite `src/routes/kocmax.$slug.mission.$missionSlug.tsx`:

```tsx
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Star, Clock } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/kocmax/$slug/mission/$missionSlug")({ component: MissionDetail });

const STATUS_LABEL: Record<string, string> = {
  joined: "進行中", submitted: "審批中", under_review: "審批中",
  approved: "已通過", rejected: "未通過", expired: "已過期",
};

function MissionDetail() {
  const { slug, missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  const mine = useMyMissions();
  const join = useJoinMission(missionSlug);
  const submit = useSubmitMission(missionSlug);
  const [urls, setUrls] = useState("");

  if (m.isLoading) return <div className="p-4"><SkeletonCard className="h-96" /></div>;
  if (m.isError || !m.data) return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-sm text-[var(--color-magenta)]">無法載入任務</p>
      <Link to="/kocmax/$slug/mission" params={{ slug }} className="text-sm underline">返回列表</Link>
    </div>
  );

  const sub = mine.data?.find((s) => s.missions.slug === missionSlug);
  const isApplication = m.data.access_type === "application";

  async function onSubmit() {
    const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    await submit.mutateAsync({ content_urls: list });
    setUrls("");
  }

  return (
    <div className="mx-auto max-w-lg pb-6">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/kocmax/$slug/mission" params={{ slug }} aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data.title}</h1>
      </header>
      <div className="space-y-4 p-4">
        {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
        <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="mb-1 font-heading font-bold">任務詳情</h3>
          <p className="text-sm text-[var(--color-soft-ink)]">{m.data.description}</p>
        </section>
        <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <Star className="text-[var(--color-magenta)]" aria-hidden />
          <div><p className="font-heading font-bold">獎勵積分</p><p className="font-display text-lg">{m.data.points_reward} 積分</p></div>
        </section>
        {m.data.deadline && (
          <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <Clock aria-hidden />
            <div><p className="font-heading font-bold">截止日期</p><p>{m.data.deadline.slice(0, 10)}</p></div>
          </section>
        )}

        {/* Action zone */}
        {isApplication ? (
          <button disabled className="block w-full cursor-not-allowed rounded-full border-2 border-[var(--color-ink)] bg-gray-200 py-3 text-center font-heading font-bold text-[var(--color-soft-ink)]">需要申請 · 即將推出</button>
        ) : !sub ? (
          <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? "處理中…" : "加入任務"}</button>
        ) : sub.status === "joined" ? (
          <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <h3 className="font-heading font-bold">提交內容</h3>
            <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder="貼上你的內容連結（每行一條）" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
            <button onClick={onSubmit} disabled={submit.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{submit.isPending ? "提交中…" : "提交內容"}</button>
          </section>
        ) : (
          <section className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <span className="font-heading font-bold">狀態</span>
            <span className="font-display">{STATUS_LABEL[sub.status] ?? sub.status}{sub.status === "approved" ? ` · +${sub.points_awarded} 積分` : ""}</span>
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-kocmax.$slug.mission.$missionSlug.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/kocmax.\$slug.mission.\$missionSlug.tsx" "src/routes/-kocmax.\$slug.mission.\$missionSlug.test.tsx"
git commit -m "feat(slice4): mission detail join + submit UI"
```

---

## Task 10: My Missions view

**Files:**
- Create: `src/routes/kocmax.$slug.my.tsx`
- Test: `src/routes/-kocmax.$slug.my.test.tsx` (create)

- [ ] **Step 1: Write the failing component test**

Create `src/routes/-kocmax.$slug.my.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> };
});

const hoisted = vi.hoisted(() => ({
  my: {
    data: [
      { id: "a", status: "joined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "進行任務", points_reward: 100, mission_type: "ugc" } },
      { id: "b", status: "submitted", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m2", title: "審批任務", points_reward: 200, mission_type: "ugc" } },
      { id: "c", status: "approved", content_urls: [], points_awarded: 300, created_at: "", missions: { slug: "m3", title: "完成任務", points_reward: 300, mission_type: "ugc" } },
    ],
    isLoading: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMyMissions: () => hoisted.my }));

import { Route } from "./kocmax.$slug.my";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderMy() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("My Missions", () => {
  it("groups submissions under status headings", () => {
    renderMy();
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("審批中")).toBeInTheDocument();
    expect(screen.getByText("已通過")).toBeInTheDocument();
    expect(screen.getByText("進行任務")).toBeInTheDocument();
    expect(screen.getByText("完成任務")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-kocmax.$slug.my.test.tsx`
Expected: FAIL — module `./kocmax.$slug.my` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/routes/kocmax.$slug.my.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMyMissions, type MyMission, type SubmissionStatus } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/kocmax/$slug/my")({ component: MyMissions });

const GROUPS: { label: string; statuses: SubmissionStatus[] }[] = [
  { label: "進行中", statuses: ["joined"] },
  { label: "審批中", statuses: ["submitted", "under_review"] },
  { label: "已通過", statuses: ["approved"] },
  { label: "未通過", statuses: ["rejected", "expired"] },
];

function MyMissions() {
  const { slug } = Route.useParams();
  const mine = useMyMissions();
  if (mine.isLoading) return <div className="p-4"><SkeletonCard className="h-40" /></div>;
  const subs: MyMission[] = mine.data ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 pb-6">
      <h1 className="font-display text-xl font-bold">我的任務</h1>
      {subs.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">尚未加入任何任務。</p>}
      {GROUPS.map((g) => {
        const items = subs.filter((s) => g.statuses.includes(s.status));
        if (items.length === 0) return null;
        return (
          <section key={g.label} className="space-y-2">
            <h2 className="font-heading font-bold">{g.label}</h2>
            {items.map((s) => (
              <Link
                key={s.id}
                to="/kocmax/$slug/mission/$missionSlug"
                params={{ slug, missionSlug: s.missions.slug }}
                className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"
              >
                <span className="font-heading">{s.missions.title}</span>
                <span className="font-display text-sm">
                  {s.status === "approved" ? `+${s.points_awarded} 積分` : `${s.missions.points_reward} 積分`}
                </span>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-kocmax.$slug.my.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/kocmax.\$slug.my.tsx" "src/routes/-kocmax.\$slug.my.test.tsx"
git commit -m "feat(slice4): My Missions view grouped by status"
```

---

## Task 11: Full gate green

**Files:** none (verification + any fixups)

- [ ] **Step 1: Type-check**

Run: `npm run type-check`
Expected: PASS. (TanStack route-tree types regenerate on `npm run dev`/build; if the editor flags the new `/kocmax/$slug/my` route, run `npm run build` once to regenerate `routeTree.gen.ts`.)

- [ ] **Step 2: Unit + component tests (no stack needed)**

Run: `npx vitest run`
Expected: PASS — previous suites + the 2 new component suites green; integration suites SKIP.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS. (If `.vercel/output` stale artifacts trip eslint, `rm -rf .vercel/output` — do not edit `eslint.config.js`, it is hook-protected.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (regenerates `routeTree.gen.ts` with the `my` route; Vite + server bundle succeed).

- [ ] **Step 5: Commit any regenerated route tree**

```bash
git add -A
git commit -m "chore(slice4): regenerate route tree + gate green" || echo "nothing to commit"
```

---

## Done criteria

- All 11 tasks committed on `feat/slice4-mission-writes`.
- `npm run type-check`, `npx vitest run`, `npm run lint`, `npm run build` all green.
- With a local stack (or in CI): `npm run test:integration` green — join/submit/my/apply + admin approve/reject/idempotency/guard.
- Open the PR against `main` only when the user asks (per workflow). Set `ADMIN_SECRET` in Vercel before the operator endpoints are usable in production (user-gated).
