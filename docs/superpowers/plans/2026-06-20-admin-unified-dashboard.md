# Unified `/admin` Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single tabbed `/admin` dashboard (Applications · Engaged users · Submissions · Creator review queue) that unifies the operator's daily surfaces, with rows drilling into the existing `/operator/*` detail pages.

**Architecture:** TanStack Router nested layout route — `admin.tsx` renders the auth gate, a tab bar, and `<Outlet/>`; each tab is its own child route file. One new read-only backend endpoint (`GET /admin/engaged`) shaped by a pure, unit-tested function. Everything else reuses endpoints that already exist. The `/operator` list routes are converted to `<Outlet/>` layouts + index-redirects into the new tabs (which also fixes a pre-existing missing-`<Outlet/>` bug that currently stops `/operator/creators` and `/operator/missions/:id` from rendering).

**Tech Stack:** React 19 + TanStack Router (file routes, `tsr generate`) + TanStack Query, Hono server routes, Supabase (service client), Vitest + Testing Library.

---

## Spec

`docs/superpowers/specs/2026-06-20-admin-unified-dashboard-design.md`

## Conventions for this codebase (read before starting)

- **Server relative imports MUST end in `.js`** (ESM; enforced by `npm run check:esm` in CI). E.g. `import { x } from "../lib/engagedRoster.js"`.
- **New/renamed routes require codegen:** run `npm run type-check` (which runs `tsr generate` then `tsc --noEmit`), NOT bare `tsc`. `routeTree.gen.ts` is generated/gitignored — never edit it.
- **A parent route file with child routes MUST render `<Outlet/>`** or the children silently don't render (see the comment in `src/routes/_app.mission.tsx`).
- **Frontend route tests** render `Route.options.component` directly inside a `QueryClientProvider`, mocking `@/lib/admin` and `@tanstack/react-router`'s `Link`. (Pattern: `src/routes/-operator.test.tsx`.) Test files are prefixed `-` so the router ignores them.
- **Integration tests** (`server/test/*.test.ts`) hit the in-process Hono app and are gated by `hasSupabaseEnv`; run with `npm run test:integration` after exporting `.env.test.local` (local Supabase stack) into the shell. Without it they SKIP (not fail).
- Tailwind tokens already in use: `--color-ink`, `--color-soft-ink`, `--color-paper`, `--color-acid`, `--color-sky`, `--radius`. Reuse them.

## File map

**Create (server):**
- `server/lib/engagedRoster.ts` — pure `shapeEngagedRoster(rows)` + types.
- `server/lib/engagedRoster.test.ts` — unit test (no DB).

**Modify (server):**
- `server/routes/admin.ts` — add `GET /engaged`.
- `server/test/admin.test.ts` — add the engaged-roster integration block.

**Create (frontend):**
- `src/components/admin/AdminAuthContext.tsx` — context exposing `{ secret, reportAuthError }` to tabs.
- `src/components/admin/AdminTabs.tsx` — tab bar with cheap count badges.
- `src/routes/admin.tsx` — layout route (gate + tabs + `<Outlet/>`).
- `src/routes/admin.index.tsx` — redirect `/admin` → `/admin/applications`.
- `src/routes/admin.applications.tsx`, `src/routes/admin.engaged.tsx`, `src/routes/admin.submissions.tsx`, `src/routes/admin.creators.tsx` — the four tabs.
- `src/routes/-admin.test.tsx`, `-admin.applications.test.tsx`, `-admin.engaged.test.tsx`, `-admin.submissions.test.tsx`, `-admin.creators.test.tsx` — route tests.
- `src/routes/operator.index.tsx`, `src/routes/operator.creators.index.tsx` — index redirects.

**Modify (frontend):**
- `src/lib/admin.ts` — add types (`Application`, `Submission`, `EngagedCreator`, `EngagedActiveMission`), `adminKeys`, and fetchers.
- `src/lib/admin.test.ts` — add fetcher tests.
- `src/routes/operator.tsx` — convert to `() => <Outlet/>` layout.
- `src/routes/operator.creators.tsx` — convert to `() => <Outlet/>` layout.
- `src/routes/operator.missions.$missionId.tsx` — repoint its `/operator` and `/operator/creators` links to `/admin/applications` and `/admin/creators`.

**Delete (frontend):**
- `src/routes/-operator.test.tsx`, `src/routes/-operator.creators.test.tsx` — their components move to the admin tabs (covered by the new tab tests).

---

## Task 1: Backend — `shapeEngagedRoster` pure function

**Files:**
- Create: `server/lib/engagedRoster.ts`
- Test: `server/lib/engagedRoster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/engagedRoster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "./engagedRoster";

let n = 0;
function row(over: Partial<EngagedSubmissionRow> & { creator_id: string; status: string }): EngagedSubmissionRow {
  return {
    id: over.id ?? `s${n++}`,
    mission_id: over.mission_id ?? "m1",
    creator_id: over.creator_id,
    status: over.status,
    points_awarded: over.points_awarded ?? 0,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
    review_deadline: over.review_deadline ?? null,
    creators: over.creators ?? { id: over.creator_id, display_name: "C", avatar_url: null, level: "L0", xp: 0 },
    missions: over.missions ?? { slug: "m1", title: "Mission 1" },
  };
}

describe("shapeEngagedRoster", () => {
  it("rolls up counts and nests only active missions", () => {
    const roster = shapeEngagedRoster([
      row({ creator_id: "a", status: "joined", mission_id: "m1", missions: { slug: "m1", title: "M1" } }),
      row({ creator_id: "a", status: "submitted", mission_id: "m2", missions: { slug: "m2", title: "M2" } }),
      row({ creator_id: "a", status: "approved", mission_id: "m3", points_awarded: 250 }),
    ]);
    expect(roster).toHaveLength(1);
    const a = roster[0]!;
    expect(a.id).toBe("a");
    expect(a.activeCount).toBe(2);
    expect(a.completedCount).toBe(1);
    expect(a.pointsEarned).toBe(250);
    expect(a.activeMissions.map((m) => m.missionSlug).sort()).toEqual(["m1", "m2"]);
    expect(a.activeMissions.every((m) => m.status !== "approved")).toBe(true);
  });

  it("excludes creators whose every participation is terminal (no active)", () => {
    const roster = shapeEngagedRoster([row({ creator_id: "done", status: "approved", points_awarded: 100 })]);
    expect(roster).toEqual([]);
  });

  it("lastActivityAt is the max of created/submitted/reviewed; sorts roster desc", () => {
    const roster = shapeEngagedRoster([
      row({ creator_id: "old", status: "joined", created_at: "2026-06-01T00:00:00Z" }),
      row({ creator_id: "new", status: "submitted", created_at: "2026-06-02T00:00:00Z", submitted_at: "2026-06-05T00:00:00Z", reviewed_at: null }),
    ]);
    expect(roster.map((c) => c.id)).toEqual(["new", "old"]);
    expect(roster[0]!.lastActivityAt).toBe("2026-06-05T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/engagedRoster.test.ts`
Expected: FAIL — cannot resolve `./engagedRoster`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/engagedRoster.ts`:

```ts
// Shapes raw mission_submissions rows (joined to creators + missions) into the
// operator "engaged users" roster: one entry per creator with >=1 active
// participation (joined/submitted/under_review), each expandable to their active
// missions. Approved rows contribute only to the completed/points rollups. Pure —
// no DB, fully unit-tested.

const ACTIVE: ReadonlySet<string> = new Set(["joined", "submitted", "under_review"]);

export type EngagedSubmissionRow = {
  id: string;
  mission_id: string;
  creator_id: string;
  status: string;
  points_awarded: number | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_deadline: string | null;
  creators: { id: string; display_name: string | null; avatar_url: string | null; level: string; xp: number };
  missions: { slug: string; title: string };
};

export type EngagedActiveMission = {
  submissionId: string;
  missionId: string;
  missionSlug: string;
  missionTitle: string;
  status: string;
  joinedAt: string;
  submittedAt: string | null;
  reviewDeadline: string | null;
};

export type EngagedCreator = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: string;
  xp: number;
  activeCount: number;
  completedCount: number;
  pointsEarned: number;
  lastActivityAt: string | null;
  activeMissions: EngagedActiveMission[];
};

// ISO 8601 strings sort lexicographically, so string compare == time compare.
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function shapeEngagedRoster(rows: EngagedSubmissionRow[]): EngagedCreator[] {
  const byCreator = new Map<string, EngagedCreator>();
  for (const r of rows) {
    let c = byCreator.get(r.creator_id);
    if (!c) {
      c = {
        id: r.creator_id,
        displayName: r.creators.display_name,
        avatarUrl: r.creators.avatar_url,
        level: r.creators.level,
        xp: r.creators.xp,
        activeCount: 0,
        completedCount: 0,
        pointsEarned: 0,
        lastActivityAt: null,
        activeMissions: [],
      };
      byCreator.set(r.creator_id, c);
    }
    c.pointsEarned += r.points_awarded ?? 0;
    c.lastActivityAt = maxIso(c.lastActivityAt, maxIso(maxIso(r.created_at, r.submitted_at), r.reviewed_at));
    if (r.status === "approved") {
      c.completedCount += 1;
    } else if (ACTIVE.has(r.status)) {
      c.activeCount += 1;
      c.activeMissions.push({
        submissionId: r.id,
        missionId: r.mission_id,
        missionSlug: r.missions.slug,
        missionTitle: r.missions.title,
        status: r.status,
        joinedAt: r.created_at,
        submittedAt: r.submitted_at,
        reviewDeadline: r.review_deadline,
      });
    }
  }
  return [...byCreator.values()]
    .filter((c) => c.activeCount > 0)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/engagedRoster.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/engagedRoster.ts server/lib/engagedRoster.test.ts
git commit -m "feat(admin): pure shapeEngagedRoster for the engaged-users roster"
```

---

## Task 2: Backend — `GET /admin/engaged` endpoint

**Files:**
- Modify: `server/routes/admin.ts`
- Test: `server/test/admin.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing integration test**

Append to `server/test/admin.test.ts` (after the existing `suite("admin submission review", ...)` block, at top level of the file):

```ts
suite("admin engaged roster", () => {
  afterAll(cleanup);

  it("requires the admin secret", async () => {
    const res = await app.request("/api/admin/engaged", { headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists creators with active participations and excludes fully-completed ones", async () => {
    await cleanup();
    const active = await makeCreator("engaged-active@test.local", 0);
    await makeMission({ slug: "engaged-active-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/engaged-active-mission/join", active.jwt, { method: "POST" });

    const done = await makeCreator("engaged-done@test.local", 0);
    await makeMission({ slug: "engaged-done-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/engaged-done-mission/join", done.jwt, { method: "POST" });
    const sub = await koreq("/missions/engaged-done-mission/submit", done.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/done"] }),
    });
    await adminreq(`/admin/submissions/${(await sub.json()).id}/approve`, { method: "POST" });

    const res = await adminreq("/admin/engaged");
    expect(res.status).toBe(200);
    const { creators } = await res.json();

    const activeRow = creators.find((c: { id: string }) => c.id === active.userId);
    expect(activeRow).toBeTruthy();
    expect(activeRow.activeCount).toBe(1);
    expect(activeRow.completedCount).toBe(0);
    expect(activeRow.activeMissions[0].missionSlug).toBe("engaged-active-mission");
    expect(activeRow.activeMissions[0].status).toBe("joined");

    // 'done' creator's only mission is approved => activeCount 0 => excluded.
    expect(creators.find((c: { id: string }) => c.id === done.userId)).toBeUndefined();
  });
});
```

(`afterAll`, `app`, `suite`, `koreq`, `adminreq`, `cleanup`, `makeCreator`, `makeMission` are already imported/defined at the top of this file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration` (with `.env.test.local` exported)
Expected: the new "lists creators…" test FAILS with 404/`not_found` (route not defined). The 401 test may already pass (middleware). If `hasSupabaseEnv` is false the suite SKIPs — export the env first.

- [ ] **Step 3: Add the import to `server/routes/admin.ts`**

At the top of `server/routes/admin.ts`, add (note the `.js` extension):

```ts
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
```

- [ ] **Step 4: Add the route**

In `server/routes/admin.ts`, add this handler (e.g. directly after the `adminRoutes.get("/applications", ...)` handler):

```ts
// Engaged users: creators with >=1 active participation (joined/submitted/under_review),
// each expandable to their active missions. Approved rows are pulled only for the
// completed/points rollups. Interim single-operator/single-workspace scope (same
// caveat as /submissions and /applications above; the Brand Dashboard replaces this).
adminRoutes.get("/engaged", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)",
    )
    .in("status", ["joined", "submitted", "under_review", "approved"])
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ creators: shapeEngagedRoster((data ?? []) as unknown as EngagedSubmissionRow[]) });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration`
Expected: both engaged-roster tests PASS.

- [ ] **Step 6: Verify the ESM guard + commit**

Run: `npm run check:esm`
Expected: no errors (the new import has `.js`).

```bash
git add server/routes/admin.ts server/test/admin.test.ts
git commit -m "feat(admin): GET /admin/engaged roster endpoint"
```

---

## Task 3: Frontend data layer — types, query keys, fetchers

**Files:**
- Modify: `src/lib/admin.ts` (append at end of file)
- Test: `src/lib/admin.test.ts` (append inside the existing `describe`)

- [ ] **Step 1: Write the failing tests**

In `src/lib/admin.test.ts`, add these imports to the existing top `import { ... } from "./admin";` block:

```ts
  approveSubmission,
  fetchEngagedUsers,
  fetchSubmissions,
```

Then add these tests inside the existing `describe("admin client helpers", ...)`:

```ts
  it("approveSubmission posts notes + quality_rating", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), { status: 200 }),
    );
    await approveSubmission("sub-1", { notes: "great", rating: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/submissions/sub-1/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ notes: "great", quality_rating: 5 }),
      }),
    );
  });

  it("fetchSubmissions encodes the status query", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ submissions: [] }), { status: 200 }),
    );
    await fetchSubmissions("submitted");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/submissions?status=submitted", expect.any(Object));
  });

  it("fetchEngagedUsers hits the engaged endpoint", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ creators: [] }), { status: 200 }),
    );
    await fetchEngagedUsers();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/engaged", expect.any(Object));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: FAIL — `approveSubmission`/`fetchSubmissions`/`fetchEngagedUsers` are not exported.

- [ ] **Step 3: Implement — append to `src/lib/admin.ts`**

Add at the end of `src/lib/admin.ts`:

```ts
// ---- Unified /admin dashboard: shared query keys, types, fetchers ----------

export const adminKeys = {
  applications: ["admin-applications"] as const,
  submissions: (status: string) => ["admin-submissions", status] as const,
  engaged: ["admin-engaged"] as const,
};

export type Application = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  creator_review?: { status: AdminReviewStatus; risk_level: AdminRiskLevel } | null;
  mission_shortlist?: { status: string } | null;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

export type Submission = Application & {
  status: string;
  content_urls: string[];
  submitted_at: string | null;
};

export type EngagedActiveMission = {
  submissionId: string;
  missionId: string;
  missionSlug: string;
  missionTitle: string;
  status: string;
  joinedAt: string;
  submittedAt: string | null;
  reviewDeadline: string | null;
};

export type EngagedCreator = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: string;
  xp: number;
  activeCount: number;
  completedCount: number;
  pointsEarned: number;
  lastActivityAt: string | null;
  activeMissions: EngagedActiveMission[];
};

export function fetchApplications() {
  return adminFetch<{ applications: Application[] }>("/admin/applications");
}

export function acceptApplication(id: string) {
  return adminFetch(`/admin/applications/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
}

export function declineApplication(id: string, notes?: string) {
  return adminFetch(`/admin/applications/${id}/decline`, {
    method: "POST",
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function fetchSubmissions(status = "submitted") {
  return adminFetch<{ submissions: Submission[] }>(`/admin/submissions?status=${encodeURIComponent(status)}`);
}

export function approveSubmission(id: string, body: { notes?: string; rating?: number }) {
  return adminFetch(`/admin/submissions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes: body.notes, quality_rating: body.rating }),
  });
}

export function rejectSubmission(id: string, notes?: string) {
  return adminFetch(`/admin/submissions/${id}/reject`, {
    method: "POST",
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function fetchEngagedUsers() {
  return adminFetch<{ creators: EngagedCreator[] }>("/admin/engaged");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/admin.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat(admin): dashboard data layer (types, query keys, fetchers)"
```

---

## Task 4: Frontend — auth context, tab bar, layout route, index redirect

**Files:**
- Create: `src/components/admin/AdminAuthContext.tsx`
- Create: `src/components/admin/AdminTabs.tsx`
- Create: `src/routes/admin.tsx`
- Create: `src/routes/admin.index.tsx`
- Test: `src/routes/-admin.test.tsx`

- [ ] **Step 1: Create the auth context**

Create `src/components/admin/AdminAuthContext.tsx`:

```tsx
import { createContext, useContext } from "react";

export type AdminAuth = {
  secret: string | null;
  reportAuthError: (error: unknown) => void;
};

export const AdminAuthContext = createContext<AdminAuth>({
  secret: null,
  reportAuthError: () => {},
});

export function useAdminAuth(): AdminAuth {
  return useContext(AdminAuthContext);
}
```

- [ ] **Step 2: Create the tab bar**

Create `src/components/admin/AdminTabs.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminKeys, fetchApplications, fetchSubmissions } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

const TABS = [
  { to: "/admin/applications", label: "申請" },
  { to: "/admin/engaged", label: "活躍創作者" },
  { to: "/admin/submissions", label: "作品審批" },
  { to: "/admin/creators", label: "創作者審核" },
] as const;

const base = "inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] px-3 text-sm font-heading font-bold";

export function AdminTabs() {
  const { secret } = useAdminAuth();
  // Shared query keys => these reuse the cache the tabs populate; no extra fetch.
  const apps = useQuery({ queryKey: adminKeys.applications, queryFn: fetchApplications, enabled: !!secret, retry: false });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted"),
    queryFn: () => fetchSubmissions("submitted"),
    enabled: !!secret,
    retry: false,
  });
  const counts: Record<string, number | undefined> = {
    "/admin/applications": apps.data?.applications.length,
    "/admin/submissions": subs.data?.submissions.length,
  };
  return (
    <nav className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} className={`${base} bg-white`} activeProps={{ className: `${base} bg-[var(--color-acid)]` }}>
          {t.label}
          {counts[t.to] ? (
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-1.5 text-xs">{counts[t.to]}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create the layout route**

Create `src/routes/admin.tsx`:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { getAdminSecret } from "@/lib/admin";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [authError, setAuthError] = useState<unknown>(null);
  return (
    <OperatorAuthGate
      error={authError}
      prompt="輸入管理密碼以進入營運後台"
      onSecretChange={(s) => {
        setSecret(s);
        setAuthError(null);
      }}
    >
      <AdminAuthContext.Provider value={{ secret, reportAuthError: setAuthError }}>
        <div className="mx-auto max-w-5xl space-y-4 p-4">
          <header className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <h1 className="font-display text-xl font-bold">營運後台</h1>
            <p className="text-sm text-[var(--color-soft-ink)]">申請、活躍創作者、作品審批與創作者審核。</p>
          </header>
          <AdminTabs />
          <Outlet />
        </div>
      </AdminAuthContext.Provider>
    </OperatorAuthGate>
  );
}
```

- [ ] **Step 4: Create the index redirect**

Create `src/routes/admin.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/applications" });
  },
});
```

- [ ] **Step 5: Write the layout route test**

Create `src/routes/-admin.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hoisted = vi.hoisted(() => ({ secret: null as string | null }));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return { ...actual, Outlet: () => <div>outlet</div> };
});
vi.mock("@/lib/admin", () => ({
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  AdminAuthError: class AdminAuthError extends Error {},
  adminKeys: { applications: ["admin-applications"], submissions: () => ["admin-submissions", "submitted"] },
  fetchApplications: vi.fn().mockResolvedValue({ applications: [] }),
  fetchSubmissions: vi.fn().mockResolvedValue({ submissions: [] }),
}));

import { Route } from "./admin";

function renderLayout() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin layout", () => {
  beforeEach(() => { hoisted.secret = null; });

  it("prompts for the admin secret when none is stored", () => {
    renderLayout();
    expect(screen.getByPlaceholderText("ADMIN_SECRET")).toBeInTheDocument();
  });

  it("renders the tab bar + outlet once authed", () => {
    hoisted.secret = "s";
    renderLayout();
    expect(screen.getByText("活躍創作者")).toBeInTheDocument();
    expect(screen.getByText("outlet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run codegen + the test**

Run: `npm run type-check`
Expected: PASS (tsr generate registers `/admin`, `/admin/`; tsc clean).

Run: `npx vitest run src/routes/-admin.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/admin src/routes/admin.tsx src/routes/admin.index.tsx src/routes/-admin.test.tsx
git commit -m "feat(admin): /admin layout route, auth context, tab bar"
```

---

## Task 5: Frontend — Applications tab

**Files:**
- Create: `src/routes/admin.applications.tsx`
- Test: `src/routes/-admin.applications.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-admin.applications.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchApplications: vi.fn(), acceptApplication: vi.fn(), declineApplication: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchApplications: h.fetchApplications,
  acceptApplication: h.acceptApplication,
  declineApplication: h.declineApplication,
  adminKeys: { applications: ["admin-applications"] },
  AdminAuthError: class extends Error {},
}));
vi.mock("@/components/operator/OperatorBadges", () => ({
  ReviewBadge: ({ status }: { status: string }) => <span>{status}</span>,
  ShortlistBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import { Route } from "./admin.applications";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin applications tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists applications and accepts one", async () => {
    h.fetchApplications.mockResolvedValue({
      applications: [{
        id: "a1", mission_id: "m1", creator_id: "c1",
        creator_review: { status: "needs_review", risk_level: "unknown" },
        mission_shortlist: null,
        creators: { display_name: "Amy" },
        missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
      }],
    });
    h.acceptApplication.mockResolvedValue({});
    r();
    await screen.findByText("Amy");
    expect(screen.getByText("needs_review")).toBeInTheDocument();
    expect(screen.getByText("not shortlisted")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("接受"));
    await waitFor(() => expect(h.acceptApplication).toHaveBeenCalledWith("a1"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routes/-admin.applications.test.tsx`
Expected: FAIL — cannot resolve `./admin.applications`.

- [ ] **Step 3: Implement the tab**

Create `src/routes/admin.applications.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError,
  acceptApplication,
  adminKeys,
  declineApplication,
  fetchApplications,
  type Application,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { ReviewBadge, ShortlistBadge } from "@/components/operator/OperatorBadges";

export const Route = createFileRoute("/admin/applications")({ component: ApplicationsTab });

function ApplicationsTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: adminKeys.applications, queryFn: fetchApplications, enabled: !!secret, retry: false });
  useEffect(() => {
    if (apps.error instanceof AdminAuthError) reportAuthError(apps.error);
  }, [apps.error, reportAuthError]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      action === "accept" ? acceptApplication(id) : declineApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.applications }),
  });

  if (apps.isLoading) return <p className="text-sm">載入中…</p>;
  if (apps.data?.applications.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批申請</p>;

  return (
    <div className="space-y-3">
      {apps.data?.applications.map((a: Application) => (
        <div
          key={a.id}
          className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading font-bold">{a.creators.display_name}</p>
              {a.creator_review?.status ? <ReviewBadge status={a.creator_review.status} /> : null}
              {a.mission_shortlist?.status ? (
                <ShortlistBadge status={a.mission_shortlist.status as "shortlisted" | "invited" | "dismissed" | "accepted" | "declined"} />
              ) : (
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">not shortlisted</span>
              )}
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
            {a.mission_id ? (
              <a href={`/operator/missions/${a.mission_id}`} className="text-xs font-bold underline">Mission selection</a>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button aria-label="接受" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">接受</button>
            <button aria-label="拒絕" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/routes/-admin.applications.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.applications.tsx src/routes/-admin.applications.test.tsx
git commit -m "feat(admin): applications tab"
```

---

## Task 6: Frontend — Submissions tab (new UI)

**Files:**
- Create: `src/routes/admin.submissions.tsx`
- Test: `src/routes/-admin.submissions.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-admin.submissions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchSubmissions: vi.fn(), approveSubmission: vi.fn(), rejectSubmission: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchSubmissions: h.fetchSubmissions,
  approveSubmission: h.approveSubmission,
  rejectSubmission: h.rejectSubmission,
  adminKeys: { submissions: () => ["admin-submissions", "submitted"] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.submissions";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin submissions tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves a submission with a quality rating", async () => {
    h.fetchSubmissions.mockResolvedValue({
      submissions: [{
        id: "s1", creator_id: "c1", status: "submitted", content_urls: ["https://ig.com/p/x"], submitted_at: null,
        creators: { display_name: "Amy" }, missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
      }],
    });
    h.approveSubmission.mockResolvedValue({});
    r();
    await screen.findByText("Amy");
    fireEvent.change(screen.getByLabelText("品質評分"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("批准"));
    await waitFor(() => expect(h.approveSubmission).toHaveBeenCalledWith("s1", { notes: undefined, rating: 5 }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routes/-admin.submissions.test.tsx`
Expected: FAIL — cannot resolve `./admin.submissions`.

- [ ] **Step 3: Implement the tab**

Create `src/routes/admin.submissions.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError,
  adminKeys,
  approveSubmission,
  fetchSubmissions,
  rejectSubmission,
  type Submission,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

export const Route = createFileRoute("/admin/submissions")({ component: SubmissionsTab });

function SubmissionsTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted"),
    queryFn: () => fetchSubmissions("submitted"),
    enabled: !!secret,
    retry: false,
  });
  useEffect(() => {
    if (subs.error instanceof AdminAuthError) reportAuthError(subs.error);
  }, [subs.error, reportAuthError]);

  if (subs.isLoading) return <p className="text-sm">載入中…</p>;
  if (subs.data?.submissions.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批作品</p>;

  return (
    <div className="space-y-3">
      {subs.data?.submissions.map((s) => (
        <SubmissionCard
          key={s.id}
          submission={s}
          onDone={() => qc.invalidateQueries({ queryKey: adminKeys.submissions("submitted") })}
        />
      ))}
    </div>
  );
}

function SubmissionCard({ submission, onDone }: { submission: Submission; onDone: () => void }) {
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const approve = useMutation({
    mutationFn: () => approveSubmission(submission.id, { notes: notes || undefined, rating: rating ? Number(rating) : undefined }),
    onSuccess: onDone,
  });
  const reject = useMutation({ mutationFn: () => rejectSubmission(submission.id, notes || undefined), onSuccess: onDone });
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading font-bold">{submission.creators.display_name}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">{submission.missions.title}</p>
      </div>
      <ul className="space-y-1 text-sm">
        {submission.content_urls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className="font-bold underline break-all">{url}</a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="品質評分" value={rating} onChange={(e) => setRating(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          <option value="">評分（選填）</option>
          <option value="1">1★</option>
          <option value="2">2★</option>
          <option value="3">3★</option>
          <option value="4">4★</option>
          <option value="5">5★</option>
        </select>
        <input aria-label="審批備註" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="備註" className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
        <button aria-label="批准" disabled={busy} onClick={() => approve.mutate()} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">批准</button>
        <button aria-label="拒絕" disabled={busy} onClick={() => reject.mutate()} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/routes/-admin.submissions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.submissions.tsx src/routes/-admin.submissions.test.tsx
git commit -m "feat(admin): submissions review tab"
```

---

## Task 7: Frontend — Engaged users tab (roster + expand)

**Files:**
- Create: `src/routes/admin.engaged.tsx`
- Test: `src/routes/-admin.engaged.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-admin.engaged.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchEngagedUsers: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchEngagedUsers: h.fetchEngagedUsers,
  adminKeys: { engaged: ["admin-engaged"] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.engaged";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin engaged tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a roster row and expands to its active missions", async () => {
    h.fetchEngagedUsers.mockResolvedValue({
      creators: [{
        id: "c1", displayName: "Amy", avatarUrl: null, level: "L1", xp: 50,
        activeCount: 1, completedCount: 2, pointsEarned: 300, lastActivityAt: "2026-06-10T00:00:00Z",
        activeMissions: [{ submissionId: "s1", missionId: "m1", missionSlug: "m1", missionTitle: "夏日面膜", status: "submitted", joinedAt: "2026-06-01T00:00:00Z", submittedAt: null, reviewDeadline: null }],
      }],
    });
    r();
    await screen.findByText("Amy");
    expect(screen.queryByText("夏日面膜")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Amy"));
    expect(screen.getByText("夏日面膜")).toBeInTheDocument();
    expect(screen.getByText("已提交")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routes/-admin.engaged.test.tsx`
Expected: FAIL — cannot resolve `./admin.engaged`.

- [ ] **Step 3: Implement the tab**

Create `src/routes/admin.engaged.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminKeys, fetchEngagedUsers, type EngagedCreator } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

export const Route = createFileRoute("/admin/engaged")({ component: EngagedTab });

const STAGE_LABEL: Record<string, string> = {
  joined: "已加入",
  submitted: "已提交",
  under_review: "審核中",
};

function EngagedTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const q = useQuery({ queryKey: adminKeys.engaged, queryFn: fetchEngagedUsers, enabled: !!secret, retry: false });
  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (q.data?.creators.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">暫無活躍創作者</p>;

  return (
    <div className="space-y-3">
      {q.data?.creators.map((c) => <EngagedCard key={c.id} creator={c} />)}
    </div>
  );
}

function EngagedCard({ creator }: { creator: EngagedCreator }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left">
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold">{creator.displayName ?? "未命名創作者"}</span>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{creator.level}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span>進行中 {creator.activeCount}</span>
          <span>已完成 {creator.completedCount}</span>
          <span>{creator.pointsEarned} 分</span>
        </div>
      </button>
      {open && (
        <ul className="space-y-2 border-t-2 border-[var(--color-ink)] p-3">
          {creator.activeMissions.map((m) => (
            <li key={m.submissionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{m.missionTitle}</span>
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{STAGE_LABEL[m.status] ?? m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/routes/-admin.engaged.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.engaged.tsx src/routes/-admin.engaged.test.tsx
git commit -m "feat(admin): engaged users roster tab"
```

---

## Task 8: Frontend — Creator review queue tab

**Files:**
- Create: `src/routes/admin.creators.tsx`
- Test: `src/routes/-admin.creators.test.tsx`

This relocates the `/operator/creators` review queue (filters + `CreatorReviewRow`) into a tab. The tab no longer wraps content in its own `OperatorAuthGate` (the layout gates) — it reads `secret`/`reportAuthError` from `useAdminAuth()`. `CreatorReviewRow` is reused unchanged (it links to `/operator/creators/:id`, which still exists).

- [ ] **Step 1: Write the failing test**

Create `src/routes/-admin.creators.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchCreatorReviewQueue: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({ fetchCreatorReviewQueue: h.fetchCreatorReviewQueue }));
vi.mock("@/components/operator/CreatorReviewRow", () => ({
  CreatorReviewRow: ({ creator }: { creator: { display_name: string } }) => <div>{creator.display_name}</div>,
}));

import { Route } from "./admin.creators";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin creators tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the creator review queue rows", async () => {
    h.fetchCreatorReviewQueue.mockResolvedValue({ creators: [{ id: "c1", display_name: "Amy" }], page: 1, pageSize: 25, total: 1 });
    r();
    await screen.findByText("Amy");
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/routes/-admin.creators.test.tsx`
Expected: FAIL — cannot resolve `./admin.creators`.

- [ ] **Step 3: Implement the tab**

Create `src/routes/admin.creators.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { CreatorReviewRow } from "@/components/operator/CreatorReviewRow";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import {
  AdminAuthError,
  fetchCreatorReviewQueue,
  type AdminReviewStatus,
  type AdminRiskLevel,
  type CreatorReviewQueueFilters,
} from "@/lib/admin";

export const Route = createFileRoute("/admin/creators")({
  component: CreatorsTab,
  validateSearch: (s: Record<string, unknown>): { mission_id?: string } =>
    typeof s.mission_id === "string" ? { mission_id: s.mission_id } : {},
});

function CreatorsTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AdminReviewStatus | "all">("all");
  const [risk, setRisk] = useState<AdminRiskLevel | "all">("all");
  const [sort, setSort] = useState<CreatorReviewQueueFilters["sort"]>("last_activity");
  const { mission_id: missionId } = Route.useSearch();

  const creators = useQuery({
    queryKey: ["admin-creators-review", { q, status, risk, sort, missionId }],
    enabled: !!secret,
    retry: false,
    queryFn: () =>
      fetchCreatorReviewQueue({
        q,
        status: status === "all" ? undefined : status,
        riskLevel: risk === "all" ? undefined : risk,
        sort,
        missionId,
        page: 1,
        pageSize: 25,
      }),
  });
  useEffect(() => {
    if (creators.error instanceof AdminAuthError) reportAuthError(creators.error);
  }, [creators.error, reportAuthError]);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        {missionId ? (
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">mission_id: {missionId}</span>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_minmax(0,0.9fr)]">
          <label className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3">
            <Search className="h-4 w-4 shrink-0" />
            <input aria-label="Search creators" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creators" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Status</span>
            <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value as AdminReviewStatus | "all")} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="flagged">Flagged</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Risk</span>
            <select aria-label="Risk filter" value={risk} onChange={(e) => setRisk(e.target.value as AdminRiskLevel | "all")} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="all">all</option>
              <option value="unknown">unknown</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Sort</span>
            <select aria-label="Sort creators" value={sort} onChange={(e) => setSort(e.target.value as CreatorReviewQueueFilters["sort"])} className="h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm font-medium text-[var(--color-ink)]">
              <option value="last_activity">last_activity</option>
              <option value="trust_score">trust_score</option>
              <option value="level">level</option>
              <option value="social_freshness">social_freshness</option>
            </select>
          </label>
          <div className="space-y-1 text-xs font-bold text-[var(--color-soft-ink)]">
            <span>Queue</span>
            <div className="flex h-9 items-center rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-3 text-sm font-medium text-[var(--color-ink)]">{creators.data?.total ?? 0} creators</div>
          </div>
        </div>
      </section>

      {creators.isLoading && <p className="text-sm">載入中…</p>}
      {!creators.isLoading && creators.data?.creators.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">暫無待審核創作者</p>
      )}

      <div className="space-y-3">
        {creators.data?.creators.map((creator) => (
          <CreatorReviewRow key={creator.id} creator={creator} missionId={missionId} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run codegen + the test**

Run: `npm run type-check`
Expected: PASS (registers `/admin/creators` with its search schema).

Run: `npx vitest run src/routes/-admin.creators.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.creators.tsx src/routes/-admin.creators.test.tsx
git commit -m "feat(admin): creator review queue tab"
```

---

## Task 9: Operator route restructure — Outlet layouts + index redirects

`operator.tsx` and `operator.creators.tsx` currently render leaf content but ARE parents of nested routes (`/operator/creators`, `/operator/creators/:id`, `/operator/missions/:id`) — and they render no `<Outlet/>`, so those children currently don't render. Convert them to `<Outlet/>` layouts (fixing that bug) and add index routes that redirect into the new tabs. The detail routes are untouched.

**Files:**
- Modify: `src/routes/operator.tsx`
- Modify: `src/routes/operator.creators.tsx`
- Modify: `src/routes/operator.missions.$missionId.tsx`
- Create: `src/routes/operator.index.tsx`
- Create: `src/routes/operator.creators.index.tsx`
- Delete: `src/routes/-operator.test.tsx`, `src/routes/-operator.creators.test.tsx`

- [ ] **Step 1: Delete the stale tests (their components moved to the admin tabs)**

```bash
git rm src/routes/-operator.test.tsx src/routes/-operator.creators.test.tsx
```

- [ ] **Step 2: Convert `operator.tsx` to an Outlet layout**

Replace the entire contents of `src/routes/operator.tsx` with:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /operator/* detail pages (creator detail, mission selection). MUST
// render <Outlet/> or the children won't show. The /operator index redirects to
// the unified /admin dashboard (see operator.index.tsx).
export const Route = createFileRoute("/operator")({ component: () => <Outlet /> });
```

- [ ] **Step 3: Convert `operator.creators.tsx` to an Outlet layout**

Replace the entire contents of `src/routes/operator.creators.tsx` with:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /operator/creators/:id. MUST render <Outlet/>. The list view moved
// to the /admin/creators tab; /operator/creators redirects there (operator.creators.index.tsx).
export const Route = createFileRoute("/operator/creators")({ component: () => <Outlet /> });
```

- [ ] **Step 4: Create the index redirects**

Create `src/routes/operator.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/operator/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/applications" });
  },
});
```

Create `src/routes/operator.creators.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/operator/creators/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/creators", search: (prev) => prev as never });
  },
});
```

- [ ] **Step 5: Repoint the mission-selection page's links to the new tabs**

In `src/routes/operator.missions.$missionId.tsx`, change the two operator links so they no longer bounce through redirects:
- `to="/operator"` → `to="/admin/applications"`
- `to="/operator/creators"` (with `search={{ mission_id: missionId } as never}`) → `to="/admin/creators"` (keep the same `search` prop).

- [ ] **Step 6: Run codegen + full unit tests**

Run: `npm run type-check`
Expected: PASS — `tsr generate` registers `/operator/`, `/operator/creators/`; the old leaf components are gone; no dangling imports.

Run: `npx vitest run`
Expected: PASS — the deleted operator tests are gone; detail-page tests (`-operator.creators.$creatorId.test.tsx`, `-operator.missions.$missionId.test.tsx`) still pass (they mock `Link`, so the changed `to` targets don't affect them).

- [ ] **Step 7: Commit**

```bash
git add src/routes/operator.tsx src/routes/operator.creators.tsx src/routes/operator.index.tsx src/routes/operator.creators.index.tsx src/routes/operator.missions.$missionId.tsx
git commit -m "refactor(operator): redirect list routes into /admin tabs; fix missing Outlet on operator layouts"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full gate sweep**

```bash
npm run type-check && npm run lint && npm run test && npm run build
```
Expected: all green. `build` runs `check:esm` (the engaged import's `.js`), `tsr generate`, `tsc`, and `vite build`.

- [ ] **Step 2: Integration suite (with local Supabase env)**

Export `.env.test.local` into the shell, then:

```bash
npm run test:integration
```
Expected: green, including the new `admin engaged roster` block.

- [ ] **Step 3: Manual smoke (optional, dev server)**

`npm run dev`, then visit `/admin` → enter `ADMIN_SECRET` → confirm all four tabs load, the Engaged roster expands, an application accept/decline works, and a submission approve/reject works. Visit `/operator` and confirm it redirects to `/admin/applications`; visit a creator detail `/operator/creators/<id>` and confirm it renders (the Outlet fix).

- [ ] **Step 4: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(admin): final gate fixups for unified dashboard"
```

---

## Rollout notes

- **No migration** — `/admin/engaged` is read-only aggregation over existing tables. Nothing to apply on prod.
- **`ADMIN_SECRET` must be set in Vercel** (known pending item) or every `/admin` call 401s and the gate re-prompts forever.
- Frontend-only + one read endpoint → safe to ship via the normal Git deploy (never `vercel --prod` from local — it mis-bundles the API per repo history).

## Self-review (completed by plan author)

- **Spec coverage:** ✅ all four tabs (Tasks 5–8), engaged endpoint + pure fn (Tasks 1–2), data layer (Task 3), layout/auth/nav (Task 4), `/operator` redirects + detail-page preservation (Task 9), error handling (per-tab `reportAuthError` → layout gate), testing (unit/integration/route), non-goals respected (no migration, no role auth, detail pages linked not rebuilt, engaged read-only, not in creator nav).
- **Placeholder scan:** ✅ no TBD/TODO; every code step shows full code.
- **Type consistency:** ✅ `EngagedCreator`/`EngagedActiveMission`/`Submission`/`Application` identical between `server/lib/engagedRoster.ts` and `src/lib/admin.ts`; `adminKeys` shape consistent across layout, tabs, and tests; `approveSubmission(id, {notes, rating})` signature matches its test and maps `rating`→`quality_rating`.
- **Added beyond spec (justified):** Task 9 converts the `/operator` parents to `<Outlet/>` layouts (not just "redirect the index") because they are nested parents lacking `<Outlet/>` — required for the detail pages `/admin` links to actually render, and fixes a pre-existing latent bug.
