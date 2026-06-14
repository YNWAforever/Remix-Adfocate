# Profile / Account Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in KOC an editable profile page (`/profile`) showing account at a glance, with edit of name / categories / social handles and a sign-out — filling the gap that the app currently has no profile page and no logout.

**Architecture:** One new guarded backend endpoint `PUT /api/me/profile` with *replace* semantics (distinct from the onboarding append/step routes), plus `social_handles` added to the existing `GET /api/me` projection. Frontend adds a `useUpdateProfile` mutation, a new `/_app/profile` route (read + edit + sign-out), and a circular avatar button on Home that links to it.

**Tech Stack:** Hono (backend routes, `server/`), Supabase (Postgres + RLS via the per-request user client), React 19 + TanStack Router (file-based routes) + TanStack Query, Vitest + Testing Library (jsdom for component/hook tests; node + live local Supabase for integration tests).

---

## Context the implementer must know (read once)

- **`apiFetch` does NOT auto-serialize.** It is a thin `fetch` wrapper (`src/lib/api.ts`); the body must be passed pre-stringified: `apiFetch(path, { method, body: JSON.stringify(obj) })`. (The design doc's hook snippet omitted this — follow this plan, not the doc.)
- **Route file naming.** App routes live in `src/routes/_app.<name>.tsx` and call `createFileRoute("/_app/<name>")`. A leading `-` (e.g. `-_app.home.test.tsx`) marks a NON-route file, so test files sit beside routes without entering the route tree.
- **Route tree is generated.** `routeTree.gen.ts` is produced by `tsr generate`, which runs automatically inside both `npm run type-check` and `npm run build`. After adding `_app.profile.tsx`, running either regenerates the tree so `<Link to="/profile">` type-checks. Commit the regenerated `src/routeTree.gen.ts` with the route.
- **Component tests mock `Link`.** TanStack `<Link>` needs a router context, so route tests mock `@tanstack/react-router` and replace `Link`. The existing simple mock (`Link: (p) => <a>{p.children}</a>`) drops props; this plan uses a richer mock that forwards `to`→`href` and passes through `aria-label`, because we assert link targets.
- **Integration tests need the local Supabase stack.** They are gated by `hasSupabaseEnv` (`server/test/helpers.ts`) and skip silently when env is absent. To actually run them (and see TDD red→green), the local stack must be up and `.env.test.local` present:
  ```bash
  supabase start                 # brings up http://127.0.0.1:54321
  # .env.test.local already holds the local SUPABASE_URL / ANON / SERVICE keys
  ```
  Vitest loads `.env.test.local` into `process.env` automatically. CI runs the same suite via `npm run test:integration`.
- **`cleanup()` matches test rows by `display_name like '%@test.local'` (or phone `+1555%`).** Because this feature *edits* `display_name`, the integration test deliberately keeps an `@test.local` suffix on edited names so the shared `cleanup()` still removes the rows. (Don't "fix" the names to read more naturally — that leaks rows on local re-runs.)
- **Visual style is neobrutalist** and uses CSS variables: `border-2 border-[var(--color-ink)]`, `rounded-[var(--radius)]` / `rounded-full`, `bg-[var(--color-acid)]`, `bg-white`, `text-[var(--color-magenta)]` for errors/destructive, `text-[var(--color-soft-ink)]` for muted, `font-display` / `font-heading` / `font-mono`, and `shadow-[4px_4px_0_0_var(--color-ink)]`. Copy is hardcoded zh-Hant-HK.

## File Structure

**Backend**
- Modify `server/routes/me.ts` — add a shared `ME_PROJECTION` const, include `social_handles` in `GET /me`, add `PUT /me/profile` (replace semantics, RLS self-scoped via the user client).
- Create `server/test/me.test.ts` — integration tests for `PUT /me/profile` + `GET /me` social_handles + self-scope.
- Modify `package.json` — register `server/test/me.test.ts` in the `test:integration` script.

**Frontend**
- Modify `src/lib/queries/kocmax.ts` — add `SocialHandle` type, add `social_handles` to `Me`, add `useUpdateProfile()`.
- Modify `src/lib/queries/kocmax.test.tsx` — unit test that `useUpdateProfile` PUTs a stringified body to `/me/profile`.
- Create `src/routes/_app.profile.tsx` — the profile page (read view, edit mode, referral copy, quick links, sign-out).
- Create `src/routes/-_app.profile.test.tsx` — component test (render data, edit toggle, save, sign-out).
- Modify `src/routes/_app.home.tsx` — add the top-right circular avatar button → `/profile`.
- Create `src/routes/-_app.home.test.tsx` — test that the avatar button links to `/profile`.

---

## Task 1: Backend — `social_handles` on `GET /me` + new `PUT /me/profile`

**Files:**
- Create: `server/test/me.test.ts`
- Modify: `package.json:13` (the `test:integration` script)
- Modify: `server/routes/me.ts`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/me.test.ts`:

```ts
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

suite("me/profile endpoint", () => {
  let c1: { userId: string; jwt: string };
  let c2: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    c1 = await makeCreator("meprofile1@test.local", 0);
    c2 = await makeCreator("meprofile2@test.local", 0);
  });
  afterAll(cleanup);

  it("updates display_name, categories and social_handles; GET /me reflects it", async () => {
    // Keep the '@test.local' suffix so the shared cleanup() still matches this row after the rename.
    const res = await req("/me/profile", c1.jwt, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "updated.meprofile1@test.local",
        categories: ["美容", "科技"],
        social_handles: [{ platform: "Instagram", handle: "@me", followers: 1000, verified: false }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("updated.meprofile1@test.local");
    expect(body.categories).toEqual(["美容", "科技"]);
    expect(body.social_handles).toHaveLength(1);
    expect(body.social_handles[0]).toMatchObject({ platform: "Instagram", handle: "@me" });

    const me = await (await req("/me", c1.jwt)).json();
    expect(me.display_name).toBe("updated.meprofile1@test.local");
    expect(me.social_handles).toHaveLength(1);
  });

  it("replaces social_handles wholesale (not append)", async () => {
    await req("/me/profile", c1.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "TikTok", handle: "@tt" }] }),
    });
    const me = await (await req("/me", c1.jwt)).json();
    expect(me.social_handles).toHaveLength(1);
    expect(me.social_handles[0].platform).toBe("TikTok");
  });

  it("a creator's edit never touches another creator's row (self-scope)", async () => {
    const before = await (await req("/me", c1.jwt)).json();
    // Keep the '@test.local' suffix so cleanup() still matches c2 after the rename.
    await req("/me/profile", c2.jwt, {
      method: "PUT",
      body: JSON.stringify({ display_name: "selfonly.meprofile2@test.local" }),
    });
    const after = await (await req("/me", c1.jwt)).json();
    expect(after.display_name).toBe(before.display_name);
    const me2 = await (await req("/me", c2.jwt)).json();
    expect(me2.display_name).toBe("selfonly.meprofile2@test.local");
  });
});
```

- [ ] **Step 2: Register the new test file in the integration script**

In `package.json`, append `server/test/me.test.ts` to the `test:integration` script (line 13). The full line becomes:

```json
    "test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/me.test.ts"
```

- [ ] **Step 3: Run the test to verify it fails**

Ensure the local stack is up first (`supabase start`), then:

Run: `RUN_INTEGRATION=1 npx vitest run server/test/me.test.ts`
Expected: FAIL — `PUT /me/profile` is unrouted (Hono returns 404, so `res.status` is `404` not `200`), and `me.social_handles` is `undefined` (not yet selected by `GET /me`).

(If instead every test is reported as *skipped*, the local stack/env isn't loaded — start `supabase start` and confirm `.env.test.local` exists, then re-run. A skipped suite is not a passing suite.)

- [ ] **Step 4: Implement the endpoint and the `GET /me` field**

Edit `server/routes/me.ts`. First add a shared projection constant just below the imports (after the `toE164` helper, before `meBootstrap`):

```ts
/** The column set returned to the client for the current creator (GET /me and PUT /me/profile). */
const ME_PROJECTION =
  "id, display_name, avatar_url, level, xp, categories, scores, phone, onboarding_step, onboarding_completed, referral_code, social_handles";

type SocialHandle = { platform: string; handle: string; followers?: number | null; verified?: boolean };
```

Change the `GET /me` handler to use the shared projection (replace the inline `.select("id, display_name, ...referral_code")` string with `ME_PROJECTION`):

```ts
meRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select(ME_PROJECTION)
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
```

Add the new handler immediately after the `GET /me` handler (still on `meRoutes`, so the final route is `PUT /api/me/profile`):

```ts
/** PUT /api/me/profile — edit own profile. Replace semantics, no onboarding-step coupling.
 *  Uses the user client so RLS (creators_self_update from migration 0003 + the column
 *  grants in 0004) scopes the write to id = auth.uid(): a creator can only edit their own row. */
meRoutes.put("/profile", async (c) => {
  const body = await c.req.json<{
    display_name?: string;
    categories?: string[];
    social_handles?: SocialHandle[];
  }>();
  const supabase = makeUserClient(c.get("jwt"));

  const patch: Record<string, unknown> = {};
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.categories !== undefined) patch.categories = body.categories;
  // social_handles is written WHOLE (full replace) so the editor controls the exact set.
  if (body.social_handles !== undefined) patch.social_handles = body.social_handles;

  // No fields provided → return the current row unchanged (PostgREST rejects empty updates).
  if (Object.keys(patch).length === 0) {
    const { data, error } = await supabase
      .from("creators")
      .select(ME_PROJECTION)
      .eq("id", c.get("userId"))
      .single();
    if (error) return c.json({ error: error.message, code: "db_error" }, 500);
    return c.json(data);
  }

  const { data, error } = await supabase
    .from("creators")
    .update(patch)
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `RUN_INTEGRATION=1 npx vitest run server/test/me.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/me.ts server/test/me.test.ts package.json
git commit -m "feat(me): PUT /me/profile editor endpoint + social_handles on GET /me"
```

---

## Task 2: Frontend data layer — `SocialHandle` type, `Me.social_handles`, `useUpdateProfile`

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Test: `src/lib/queries/kocmax.test.tsx`

- [ ] **Step 1: Write the failing hook test**

In `src/lib/queries/kocmax.test.tsx`, add `act` to the testing-library import and import `useUpdateProfile`, then add a new describe block. The top import lines become:

```tsx
import { renderHook, waitFor, act } from "@testing-library/react";
```
```tsx
import { useMissions, useUpdateProfile } from "./kocmax";
```

Add at the end of the file:

```tsx
describe("useUpdateProfile", () => {
  it("PUTs a stringified body to /me/profile", async () => {
    const spy = vi.spyOn(api, "apiFetch").mockResolvedValue({ id: "u1" });
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ display_name: "X", categories: ["美容"] });
    });
    expect(spy).toHaveBeenCalledWith("/me/profile", {
      method: "PUT",
      body: JSON.stringify({ display_name: "X", categories: ["美容"] }),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/queries/kocmax.test.tsx`
Expected: FAIL — `useUpdateProfile` is not exported from `./kocmax` (TypeScript/import error).

- [ ] **Step 3: Implement the type and the hook**

In `src/lib/queries/kocmax.ts`, add the `SocialHandle` type immediately above the `Me` type (line ~17) and add `social_handles` to `Me`:

```ts
export type SocialHandle = { platform: string; handle: string; followers?: number | null; verified?: boolean };
export type Me = {
  id: string;
  display_name?: string;
  level: string;
  xp: number;
  phone?: string | null;
  categories?: string[];
  social_handles?: SocialHandle[];
  onboarding_step: number;
  onboarding_completed: boolean;
  referral_code?: string;
};
```

Add the mutation directly after the `useMe` function (line ~60):

```ts
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { display_name?: string; categories?: string[]; social_handles?: SocialHandle[] }) =>
      apiFetch<Me>("/me/profile", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
```

(`useMutation` and `useQueryClient` are already imported at the top of the file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/queries/kocmax.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/queries/kocmax.test.tsx
git commit -m "feat(queries): useUpdateProfile mutation + social_handles on Me"
```

---

## Task 3: Frontend — the `/profile` route (read + edit + sign-out)

**Files:**
- Create: `src/routes/_app.profile.tsx`
- Test: `src/routes/-_app.profile.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/routes/-_app.profile.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

const hoisted = vi.hoisted(() => ({
  update: vi.fn(),
  signOut: vi.fn(),
  me: {
    data: {
      id: "u1",
      display_name: "阿明",
      level: "L1",
      xp: 120,
      categories: ["美容", "科技"],
      social_handles: [{ platform: "Instagram", handle: "@ming", followers: 500, verified: true }],
      onboarding_step: 5,
      onboarding_completed: true,
      referral_code: "ABCD1234",
    },
    isLoading: false,
    isError: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useUpdateProfile: () => ({ mutateAsync: hoisted.update, isPending: false }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: hoisted.signOut } } }));

import { Route } from "./_app.profile";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderProfile() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("Profile page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.update.mockResolvedValue({});
    hoisted.signOut.mockResolvedValue({ error: null });
  });

  it("renders name, level, categories and referral code", () => {
    renderProfile();
    expect(screen.getByText("阿明")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("美容")).toBeInTheDocument();
    expect(screen.getByText("ABCD1234")).toBeInTheDocument();
  });

  it("reveals edit inputs when 編輯 is tapped", () => {
    renderProfile();
    fireEvent.click(screen.getByText("編輯"));
    expect(screen.getByLabelText("顯示名稱")).toBeInTheDocument();
    expect(screen.getByLabelText("Instagram 帳號")).toBeInTheDocument();
  });

  it("saves edited values via useUpdateProfile (handles preserved on edit)", async () => {
    renderProfile();
    fireEvent.click(screen.getByText("編輯"));
    fireEvent.change(screen.getByLabelText("顯示名稱"), { target: { value: "新名稱" } });
    fireEvent.click(screen.getByText("儲存"));
    await waitFor(() =>
      expect(hoisted.update).toHaveBeenCalledWith({
        display_name: "新名稱",
        categories: ["美容", "科技"],
        social_handles: [{ platform: "Instagram", handle: "@ming", followers: 500, verified: true }],
      }),
    );
  });

  it("signs out and redirects to /login", async () => {
    renderProfile();
    fireEvent.click(screen.getByText("登出"));
    await waitFor(() => expect(hoisted.signOut).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/login" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: FAIL — cannot resolve `./_app.profile` (the route module does not exist yet).

- [ ] **Step 3: Implement the route**

Create `src/routes/_app.profile.tsx`:

```tsx
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FilterPillsMulti } from "@/components/FilterPills";
import { useMe, useUpdateProfile, type SocialHandle } from "@/lib/queries/kocmax";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_app/profile")({ component: Profile });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Profile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const update = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function startEdit() {
    const d = me.data;
    setDisplayName(d?.display_name ?? "");
    setCategories(d?.categories ?? []);
    const seeded: Record<string, string> = {};
    for (const s of d?.social_handles ?? []) seeded[s.platform] = s.handle;
    setHandles(seeded);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const existing = me.data?.social_handles ?? [];
    // Rebuild from the non-empty handle inputs, preserving followers/verified per platform.
    const social_handles: SocialHandle[] = PLATFORMS.flatMap((p) => {
      const handle = (handles[p] ?? "").trim();
      if (!handle) return [];
      const prev = existing.find((s) => s.platform === p);
      return [{ platform: p, handle, followers: prev?.followers ?? null, verified: prev?.verified ?? false }];
    });
    try {
      await update.mutateAsync({ display_name: displayName.trim() || undefined, categories, social_handles });
      setEditing(false);
    } catch {
      setError("儲存失敗，請重試");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    qc.removeQueries({ queryKey: ["me"] });
    navigate({ to: "/login" });
  }

  async function copyReferral() {
    const code = me.data?.referral_code;
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const d = me.data;
  const initial = (d.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="flex items-center gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
          {d.avatar_url ? <img src={d.avatar_url} alt="" className="h-full w-full object-cover" /> : initial}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{d.display_name ?? "KOC"}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
              {d.level}
            </span>
            <span className="text-sm text-[var(--color-soft-ink)]">{d.xp} XP</span>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {!editing ? (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">內容範疇</h2>
            {d.categories?.length ? (
              <div className="flex flex-wrap gap-2">
                {d.categories.map((c) => (
                  <span key={c} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">社交帳號</h2>
            {d.social_handles?.length ? (
              <ul className="space-y-1">
                {d.social_handles.map((s) => (
                  <li
                    key={s.platform}
                    className="flex items-center justify-between rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-heading font-semibold">{s.platform}</span>
                    <span className="text-[var(--color-soft-ink)]">{s.handle}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
            )}
          </section>

          <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
            <h2 className="font-heading font-bold">我的邀請碼</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold tracking-widest">{d.referral_code ?? "—"}</span>
              <button
                type="button"
                onClick={copyReferral}
                disabled={!d.referral_code}
                className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
              >
                {copied ? "已複製" : "複製"}
              </button>
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">邀請朋友，各得 200 分</p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Link
              to="/my"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              我的任務
            </Link>
            <Link
              to="/redemption/history"
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
            >
              兌換記錄
            </Link>
          </section>

          <div className="space-y-3">
            <button
              type="button"
              onClick={startEdit}
              className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
            >
              編輯
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold text-[var(--color-magenta)]"
            >
              登出
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">顯示名稱</h2>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-label="顯示名稱"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">內容範疇</h2>
            <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">社交帳號</h2>
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
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
            >
              {update.isPending ? "儲存中…" : "儲存"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Regenerate the route tree and type-check**

Run: `npm run type-check`
Expected: PASS — `tsr generate` adds `/profile` to `src/routeTree.gen.ts` and `tsc --noEmit` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app.profile.tsx src/routes/-_app.profile.test.tsx src/routeTree.gen.ts
git commit -m "feat(profile): /profile route — view, edit, referral copy, sign-out"
```

---

## Task 4: Frontend — Home avatar button → `/profile`

**Files:**
- Create: `src/routes/-_app.home.test.tsx`
- Modify: `src/routes/_app.home.tsx`

- [ ] **Step 1: Write the failing home test**

Create `src/routes/-_app.home.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1", display_name: "阿明", avatar_url: null }, isLoading: false }),
  useBalance: () => ({ data: { balance: 0, available_to: null }, isLoading: false, isError: false }),
  useMissions: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: vi.fn() }));

import { Route } from "./_app.home";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderHome() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("Home", () => {
  it("shows an avatar button linking to /profile", () => {
    renderHome();
    const link = screen.getByLabelText("個人檔案");
    expect(link).toHaveAttribute("href", "/profile");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: 個人檔案` (no avatar button on Home yet).

- [ ] **Step 3: Implement the avatar button**

In `src/routes/_app.home.tsx`, add a top-right avatar header as the first child of the outer container. Change the opening of the returned JSX from:

```tsx
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 text-[var(--color-ink)] shadow-[4px_4px_0_0_var(--color-ink)]">
```

to:

```tsx
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <div className="flex justify-end">
        <Link
          to="/profile"
          aria-label="個人檔案"
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white font-heading font-bold shadow-[2px_2px_0_0_var(--color-ink)]"
        >
          {me.data?.avatar_url ? (
            <img src={me.data.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (me.data?.display_name?.[0] ?? "?").toUpperCase()
          )}
        </Link>
      </div>
      <section className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 text-[var(--color-ink)] shadow-[4px_4px_0_0_var(--color-ink)]">
```

(`Link` and `useMe`/`me` are already imported and in scope in this file — no new imports.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.home.tsx src/routes/-_app.home.test.tsx
git commit -m "feat(home): top-right avatar button linking to /profile"
```

---

## Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Type-check (regenerates the route tree)**

Run: `npm run type-check`
Expected: PASS — no TypeScript errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS — no ESLint errors.

- [ ] **Step 3: Unit/component suite (jsdom)**

Run: `npm test`
Expected: PASS — all suites green, including the new `kocmax`, `-_app.profile`, and `-_app.home` tests.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS — `tsr generate && tsc --noEmit && vite build` completes.

- [ ] **Step 5: Integration suite (requires the local Supabase stack)**

Run: `supabase start` (if not already up), then `npm run test:integration`
Expected: PASS — all integration files including `server/test/me.test.ts` green.

- [ ] **Step 6: Commit any route-tree drift, then finish the branch**

If `npm run type-check`/`build` regenerated `src/routeTree.gen.ts`, ensure it's committed:

```bash
git add -A
git status --short   # expect a clean tree, or only routeTree.gen.ts
git commit -m "chore: regenerate route tree for /profile" || true
```

Then use **superpowers:finishing-a-development-branch** to open the PR for `feat/profile-page` → `main`.

---

## Self-review (run against the design spec)

**1. Spec coverage**
- §2.1 route `/profile` via `useMe()` → Task 3. ✅
- §2.1 read view (avatar/name/level+XP/categories/social/referral copy + invite line/quick links to `/my` + `/redemption/history`) → Task 3 (both link targets verified to exist in the route tree). ✅
- §2.1 edit mode (`display_name` text, `categories` `FilterPillsMulti`, per-platform handle inputs, Save/取消) → Task 3. ✅
- §2.1 sign-out (`signOut` → clear `["me"]` → `/login`) → Task 3 (uses `qc.removeQueries`). ✅
- §2.1 Home avatar button → Task 4. ✅
- §2.1 + §4 + §5 endpoint `PUT /api/me/profile` + hook `useUpdateProfile` → Tasks 1 & 2. ✅
- §4 extend `GET /me` to select `social_handles` + add to `Me` type → Tasks 1 & 2. ✅
- §4 replace semantics for `social_handles`; user client / RLS self-scope → Task 1 (handler + self-scope test). ✅
- §5 categories use `FilterPillsMulti` with the onboarding `CATEGORIES`; handles seeded from current, preserve followers/verified → Task 3 (`save()` flatMap). ✅
- §7 error handling: inline save error, generic load-error line, clipboard guarded with `?.` → Task 3. ✅
- §8 tests: backend integration (update + GET reflect + self-scope), frontend component (render/edit/save/sign-out), home avatar link → Tasks 1, 3, 4. ✅
- §2.2 deferred (DNA page, avatar upload, handle verification, editing phone/level/XP) → not implemented, by design. ✅
- §9 no new env / dashboard step → confirmed; Task 5 is local verification only. ✅

**2. Placeholder scan** — no TBD/TODO; every code/step shows full content and exact commands. ✅

**3. Type consistency** — `SocialHandle` defined once in `kocmax.ts` (Task 2) and imported by the route (Task 3); the backend declares a structurally identical local `SocialHandle` in `me.ts` (Task 1). `Me.social_handles?: SocialHandle[]` matches the `GET /me`/`PUT` projection (`ME_PROJECTION`) and the handler body type. `useUpdateProfile` body type `{ display_name?; categories?; social_handles? }` matches both the handler's parsed body and the `save()` call site. ✅
