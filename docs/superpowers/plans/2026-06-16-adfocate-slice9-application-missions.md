# Application-Gated Missions (申請制) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let creators apply (one-tap) to `access_type='application'` missions, let an operator accept/decline applicants via an admin API + a minimal `/operator` page, and route accepted applicants into the existing submit flow.

**Architecture:** Reuse `mission_submissions` with two new states (`applied`, `declined`). A creator RPC `apply_mission` inserts `applied` (0 XP, no quota); service-only RPCs `accept_application` (→ `joined`, `filled++` under quota, +10 XP) and `decline_application` (→ `declined`) gate it. Accepted = `joined`, so `submit_mission` and the whole downstream earn loop are untouched. Thin Hono routes mirror the existing `/join` + admin approve/reject patterns; the operator page is the first ungated internal UI (admin-secret auth in `sessionStorage`).

**Tech Stack:** Postgres/Supabase (SECURITY DEFINER RPCs + RLS), Hono, React 19 + TanStack Router/Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-adfocate-slice9-application-missions-design.md`

**Branch:** `feat/slice9-application-missions` (already created off `main` @ `1544b1b`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/0010_applications.sql` | status enum + 3 RPCs + grants | Create |
| `server/routes/missions.ts` | replace `/apply` 409 stub; extend `RPC_409` | Modify |
| `server/routes/admin.ts` | list/accept/decline application endpoints | Modify |
| `server/test/applications.test.ts` | integration tests for the whole flow | Create |
| `package.json` | append the new test file to `test:integration` | Modify |
| `src/lib/queries/kocmax.ts` | `useApplyMission` + `STATUS_LABEL` entries | Modify |
| `src/routes/_app.mission.$missionSlug.tsx` | apply CTA + states (replace disabled stub) | Modify |
| `src/routes/-_app.mission.$missionSlug.test.tsx` | apply/applied/declined component tests | Modify |
| `src/lib/admin.ts` | `adminFetch` + secret helpers (`sessionStorage`) | Create |
| `src/routes/operator.tsx` | ungated `/operator` review page | Create |
| `src/routes/-operator.test.tsx` | operator page component test | Create |

**Note on `STATUS_LABEL`:** it currently lives at the top of `src/routes/_app.mission.$missionSlug.tsx`. Keep it there (single consumer this slice).

---

## Task 1: Migration — status enum + RPCs

**Files:**
- Create: `supabase/migrations/0010_applications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Slice 9: application-gated missions. Reuses mission_submissions with two new
-- states (applied, declined). Accepted applicant becomes 'joined' → flows into the
-- existing submit_mission unchanged. apply = creator (0 XP, no quota); accept/decline
-- = service-only (accept mirrors join_mission: filled++ under quota + 10 XP).

-- 1. Status check: add 'applied' and 'declined' ------------------------------
alter table public.mission_submissions drop constraint mission_submissions_status_check;
alter table public.mission_submissions add constraint mission_submissions_status_check
  check (status in ('applied','joined','submitted','under_review','approved','rejected','expired','declined'));

-- 2. apply_mission: → 'applied' for an application mission, 0 XP, no filled++ --
create or replace function public.apply_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  m record;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id into v_ws from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'application' then raise exception 'not_application'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- unique(mission_id, creator_id) is the real dedupe guard (handles a double-tap race).
  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'applied', 0)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_applied';
  end;
  return v_sub;
end;
$$;

-- 3. accept_application: 'applied' → 'joined', filled++ under quota, +10 XP ----
create or replace function public.accept_application(p_submission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
  v_rows int;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'joined' then return v_sub; end if;                       -- idempotent
  if v_sub.status <> 'applied' then raise exception 'wrong_state'; end if;

  update public.missions set filled = filled + 1
    where id = v_sub.mission_id and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  update public.mission_submissions set
    status = 'joined', xp_awarded = xp_awarded + 10
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 10 where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- 4. decline_application: 'applied' → 'declined', no XP, no quota -------------
create or replace function public.decline_application(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'declined' then return v_sub; end if;                     -- idempotent
  if v_sub.status <> 'applied' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'declined', reviewer_notes = p_notes, reviewed_at = now()
    where id = p_submission
    returning * into v_sub;
  return v_sub;
end;
$$;

-- 5. Grants: apply = creator; accept/decline = service-only ------------------
revoke all on function public.apply_mission(uuid)             from public, anon;
revoke all on function public.accept_application(uuid)        from public, anon, authenticated;
revoke all on function public.decline_application(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_mission(uuid)             to authenticated, service_role;
grant execute on function public.accept_application(uuid)        to service_role;
grant execute on function public.decline_application(uuid, text) to service_role;
```

- [ ] **Step 2: Apply to the local stack**

Run: `supabase db reset`
Expected: it re-applies all migrations including `Applying migration 0010_applications.sql...` with no SQL error, then runs the seed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_applications.sql
git commit -m "feat(slice9): migration — apply/accept/decline application RPCs"
```

---

## Task 2: Backend — creator `apply` route

**Files:**
- Modify: `server/routes/missions.ts` (the `RPC_409` set near line 10; the `/:slug/apply` stub at line 113)
- Create: `server/test/applications.test.ts`
- Modify: `package.json` (the `test:integration` script)

- [ ] **Step 1: Write the failing integration test**

Create `server/test/applications.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminReq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "test-admin-secret", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("application-gated missions", () => {
  let koc: { userId: string; jwt: string };
  let koc2: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("applicant@test.local", 0);
    koc2 = await makeCreator("applicant2@test.local", 0);
  });
  afterAll(cleanup);

  it("applies to an application mission (→ applied), and a duplicate apply is rejected", async () => {
    await makeMission({ slug: "test-app-apply", title: "申請制任務", access_type: "application", quota: 5 });

    const res = await req("/missions/test-app-apply/apply", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");

    const dup = await req("/missions/test-app-apply/apply", koc.jwt, { method: "POST" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("already_applied");
  });

  it("rejects applying to an open mission (not_application)", async () => {
    await makeMission({ slug: "test-open-apply", title: "公開任務", access_type: "open" });
    const res = await req("/missions/test-open-apply/apply", koc2.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_application");
  });

  it("requires authentication to apply", async () => {
    const res = await app.request("/api/missions/test-app-apply/apply", {
      method: "POST", headers: { "X-Workspace-Slug": "demo", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Register the test file in the integration script**

In `package.json`, append ` server/test/applications.test.ts` to the END of the `test:integration` command string (after `server/test/copilot.test.ts`):

```json
    "test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/redemption.test.ts server/test/wallet.test.ts server/test/me.test.ts server/test/leveling.test.ts server/test/passport.test.ts server/test/match.test.ts server/test/copilot.test.ts server/test/applications.test.ts",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/applications.test.ts`
Expected: FAIL — the `/apply` route returns 409 `not_available` (the current stub), so the first test's `200` assertion fails.

- [ ] **Step 4: Replace the stub + extend the error set**

In `server/routes/missions.ts`, add the two new codes to the `RPC_409` set:

```ts
const RPC_409 = new Set([
  "mission_full", "already_joined", "not_open", "closed",
  "level_locked", "wrong_state", "empty_urls", "not_authenticated",
  "not_application", "already_applied",
]);
```

Replace the stub line (`missionRoutes.post("/:slug/apply", (c) => c.json(...409))`) with:

```ts
/** Apply to an application-gated mission (one-tap). Operator vets via /admin/applications. */
missionRoutes.post("/:slug/apply", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: m, error: mErr } = await supabase
    .from("missions")
    .select("id")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data, error } = await supabase.rpc("apply_mission", { p_mission: m.id });
  if (error) return rpcError(c, error);
  return c.json(data);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/applications.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/routes/missions.ts server/test/applications.test.ts package.json
git commit -m "feat(slice9): creator apply route + integration tests"
```

---

## Task 3: Backend — operator accept/decline endpoints

**Files:**
- Modify: `server/routes/admin.ts`
- Modify: `server/test/applications.test.ts` (append tests inside the `suite`)

- [ ] **Step 1: Write the failing tests**

Append these `it` blocks inside the `suite("application-gated missions", …)` in `server/test/applications.test.ts` (after the existing tests, before the closing `});`):

```ts
  it("operator accept → joined (+10 xp, filled++), then the creator can submit", async () => {
    await makeMission({ slug: "test-app-accept", title: "申請接受", access_type: "application", quota: 1 });
    const applied = await (await req("/missions/test-app-accept/apply", koc.jwt, { method: "POST" })).json();

    const meBefore = await (await req("/me", koc.jwt)).json();

    const list = await (await adminReq("/admin/applications")).json();
    expect(list.applications.some((a: { id: string }) => a.id === applied.id)).toBe(true);

    const acc = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    expect((await acc.json()).status).toBe("joined");

    const meAfter = await (await req("/me", koc.jwt)).json();
    expect(meAfter.xp - meBefore.xp).toBe(10);

    const mission = await (await req("/missions/test-app-accept", koc.jwt)).json();
    expect(mission.filled).toBe(1);

    const sub = await req("/missions/test-app-accept/submit", koc.jwt, {
      method: "PUT", body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    expect(sub.status).toBe(200);
    expect((await sub.json()).status).toBe("submitted");
  });

  it("accept fails with mission_full when the quota is reached", async () => {
    // test-app-accept (quota 1) is already filled by koc above; koc2 applies then accept fails.
    const applied = await (await req("/missions/test-app-accept/apply", koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mission_full");
  });

  it("operator can decline an application", async () => {
    await makeMission({ slug: "test-app-decline", title: "申請拒絕", access_type: "application", quota: 5 });
    const applied = await (await req("/missions/test-app-decline/apply", koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/decline`, {
      method: "POST", body: JSON.stringify({ notes: "唔啱" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("declined");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/applications.test.ts`
Expected: FAIL — `GET /admin/applications` and the accept/decline routes 404 (not yet defined).

- [ ] **Step 3: Add the admin endpoints**

In `server/routes/admin.ts`, add these three routes (after the existing `adminRoutes.post("/submissions/:id/reject", …)` block, before `adminRoutes.post("/gifts/:id/codes", …)`):

```ts
// Pending applications (status='applied') across workspaces — interim single-operator
// scope, same caveat as /submissions above (Brand Dashboard replaces with role-scoped review).
adminRoutes.get("/applications", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select("id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", "applied")
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ applications: data ?? [] });
});

adminRoutes.post("/applications/:id/accept", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("accept_application", { p_submission: c.req.param("id") });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

adminRoutes.post("/applications/:id/decline", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("decline_application", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/applications.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/admin.ts server/test/applications.test.ts
git commit -m "feat(slice9): operator accept/decline application endpoints"
```

---

## Task 4: Frontend — creator apply CTA + states

**Files:**
- Modify: `src/lib/queries/kocmax.ts` (after `useSubmitMission`, ~line 192)
- Modify: `src/routes/_app.mission.$missionSlug.tsx` (`STATUS_LABEL` ~line 11; the action ternary ~lines 68-83; hook + import)
- Modify: `src/routes/-_app.mission.$missionSlug.test.tsx`

- [ ] **Step 1: Write the failing component tests**

In `src/routes/-_app.mission.$missionSlug.test.tsx`:

(a) add `apply: vi.fn(),` to the `hoisted` object;
(b) add `useApplyMission: () => ({ mutateAsync: hoisted.apply, isPending: false }),` to the `vi.mock("@/lib/queries/kocmax", …)` factory;
(c) add `hoisted.apply.mockResolvedValue({ id: "s1", status: "applied" });` in `beforeEach`;
(d) **replace** the existing `it("disables the CTA for an application mission", …)` test with:

```tsx
  it("shows the apply CTA for an application mission and applies", async () => {
    hoisted.mission.data.access_type = "application";
    renderDetail();
    fireEvent.click(screen.getByText("申請任務"));
    await waitFor(() => expect(hoisted.apply).toHaveBeenCalled());
  });

  it("shows 審批中 once an application is pending", () => {
    hoisted.mission.data.access_type = "application";
    hoisted.my.data = [{ id: "s1", status: "applied", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByText("審批中")).toBeInTheDocument();
  });

  it("shows 未獲接受 for a declined application", () => {
    hoisted.mission.data.access_type = "application";
    hoisted.my.data = [{ id: "s1", status: "declined", content_urls: [], points_awarded: 0, created_at: "", missions: { slug: "m1", title: "美容試用", points_reward: 300, mission_type: "ugc" } }];
    renderDetail();
    expect(screen.getByText("未獲接受")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/routes/-_app.mission.\$missionSlug.test.tsx`
Expected: FAIL — `useApplyMission` is not exported, and `申請任務` is not rendered (the disabled stub still shows `需要申請`).

- [ ] **Step 3: Add the mutation**

In `src/lib/queries/kocmax.ts`, after `useSubmitMission` (line ~192):

```ts
export function useApplyMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<MyMission>(`/missions/${slug}/apply`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["missions"] }); // my_status badge → 審批中
      qc.invalidateQueries({ queryKey: ["my-missions"] });
    },
  });
}
```

- [ ] **Step 4: Wire the mission page**

In `src/routes/_app.mission.$missionSlug.tsx`:

(a) add the two status labels to `STATUS_LABEL`:

```tsx
const STATUS_LABEL: Record<string, string> = {
  applied: "審批中",
  joined: "進行中", submitted: "審批中", under_review: "審批中",
  approved: "已通過", rejected: "未通過", expired: "已過期", declined: "未獲接受",
};
```

(b) add `useApplyMission` to the import from `@/lib/queries/kocmax`:

```tsx
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission } from "@/lib/queries/kocmax";
```

(c) add the hook beside the others (after `const submit = useSubmitMission(missionSlug);`):

```tsx
  const apply = useApplyMission(missionSlug);
```

(d) **replace** the action-zone ternary (the block starting `{/* Action zone */}` through its closing `)}`) with — note the `!sub` case now branches on `isApplication`, the disabled stub is gone, and `joined`/status-card branches are unchanged:

```tsx
        {/* Action zone */}
        {!sub ? (
          isApplication ? (
            <button onClick={() => apply.mutateAsync()} disabled={apply.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{apply.isPending ? "處理中…" : "申請任務"}</button>
          ) : (
            <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? "處理中…" : "加入任務"}</button>
          )
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
```

(The `{!isApplication && ( … HookPanel … )}` block that follows stays exactly as-is.)

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/routes/-_app.mission.\$missionSlug.test.tsx`
Expected: PASS (8 tests — the 5 original survivors + 3 new; the replaced application test is one of the 8).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kocmax.ts src/routes/_app.mission.\$missionSlug.tsx src/routes/-_app.mission.\$missionSlug.test.tsx
git commit -m "feat(slice9): mission-page apply CTA + applied/declined states"
```

---

## Task 5: Frontend — operator review page

**Files:**
- Create: `src/lib/admin.ts`
- Create: `src/routes/operator.tsx`
- Create: `src/routes/-operator.test.tsx`

- [ ] **Step 1: Write the admin fetch helper**

Create `src/lib/admin.ts`:

```ts
// Interim operator auth: a shared ADMIN_SECRET kept in sessionStorage (cleared on tab
// close). Single-operator internal tool only — real per-workspace role auth lands with
// the Brand Dashboard. Mirrors the x-admin-secret check in server/routes/admin.ts.
const KEY = "adfocate_admin_secret";

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(KEY);
}
export function setAdminSecret(secret: string) {
  sessionStorage.setItem(KEY, secret);
}
export function clearAdminSecret() {
  sessionStorage.removeItem(KEY);
}

export class AdminAuthError extends Error {}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = getAdminSecret();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-admin-secret": secret } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearAdminSecret();
    throw new AdminAuthError("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 2: Write the failing component test**

Create `src/routes/-operator.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hoisted = vi.hoisted(() => ({
  secret: null as string | null,
  adminFetch: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({
  adminFetch: hoisted.adminFetch,
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator";

function renderOp() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator applications page", () => {
  beforeEach(() => { vi.clearAllMocks(); hoisted.secret = null; });

  it("prompts for the admin secret when none is stored", () => {
    renderOp();
    expect(screen.getByPlaceholderText("ADMIN_SECRET")).toBeInTheDocument();
  });

  it("lists pending applications and accepts one", async () => {
    hoisted.secret = "s";
    hoisted.adminFetch.mockResolvedValueOnce({ applications: [
      { id: "a1", creators: { display_name: "Amy" }, missions: { slug: "m1", title: "夏日面膜", points_reward: 100 } },
    ] });
    renderOp();
    await screen.findByText("Amy");
    hoisted.adminFetch.mockResolvedValueOnce({});
    fireEvent.click(screen.getByLabelText("接受"));
    await waitFor(() => expect(hoisted.adminFetch).toHaveBeenCalledWith("/admin/applications/a1/accept", expect.objectContaining({ method: "POST" })));
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/routes/-operator.test.tsx`
Expected: FAIL — `./operator` does not exist yet (module resolution error).

- [ ] **Step 4: Write the operator route**

Create `src/routes/operator.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, getAdminSecret, setAdminSecret, clearAdminSecret, AdminAuthError } from "@/lib/admin";

export const Route = createFileRoute("/operator")({ component: OperatorApplications });

type Application = {
  id: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

function OperatorApplications() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [input, setInput] = useState("");
  const qc = useQueryClient();

  const apps = useQuery({
    queryKey: ["admin-applications"],
    enabled: !!secret,
    retry: false,
    queryFn: () => adminFetch<{ applications: Application[] }>("/admin/applications"),
  });

  // A bad/stale secret → 401 → AdminAuthError. Drop back to the prompt.
  useEffect(() => {
    if (apps.error instanceof AdminAuthError) { clearAdminSecret(); setSecret(null); }
  }, [apps.error]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      adminFetch(`/admin/applications/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-applications"] }),
  });

  if (!secret) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <h1 className="font-display text-xl font-bold">營運後台</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">輸入管理密碼以檢視申請</p>
        <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="ADMIN_SECRET" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2" />
        <button onClick={() => { setAdminSecret(input); setSecret(input); }} className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold">進入</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-xl font-bold">待審批申請</h1>
      {apps.isLoading && <p className="text-sm">載入中…</p>}
      {apps.data?.applications.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批申請</p>}
      {apps.data?.applications.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div>
            <p className="font-heading font-bold">{a.creators.display_name}</p>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
          </div>
          <div className="flex gap-2">
            <button aria-label="接受" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">接受</button>
            <button aria-label="拒絕" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Regenerate the route tree, then run the test**

Run: `npm run type-check`
Expected: `tsr generate` adds `/operator` to `routeTree.gen.ts`; `tsc --noEmit` passes with no errors.

Run: `npx vitest run src/routes/-operator.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin.ts src/routes/operator.tsx src/routes/-operator.test.tsx src/routeTree.gen.ts
git commit -m "feat(slice9): operator application review page (/operator)"
```

---

## Task 6: Final verification gates

**Files:** none (verification only).

- [ ] **Step 1: Full unit/component suite**

Run: `npm test`
Expected: all pass; integration suites SKIP (no Supabase env in jsdom). New component tests (mission apply region, operator ×2) included.

- [ ] **Step 2: Full integration suite**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`
Expected: all pass, including the new `application-gated missions` file (6 tests).

- [ ] **Step 3: type-check, lint, build**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all clean (a pre-existing chunk-size >500 kB warning from `vite build` is benign).

- [ ] **Step 4: Confirm nothing else regressed**

Run: `git status` and review the diff is scoped to the files in this plan.

---

## After all tasks

Use **superpowers:finishing-a-development-branch** → push + open PR (the user merges). The migration `0010_applications.sql` is then applied to **production** manually by the user via the Supabase SQL editor, followed by `notify pgrst, 'reload schema';` — deploy only after the migration is applied (else `/apply` 500s on the missing RPC). Record status in memory.
