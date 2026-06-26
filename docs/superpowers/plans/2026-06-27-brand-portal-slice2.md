# Brand Portal Slice 2 — Review & Payout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in brand review the creators working on its own missions — approve/reject submissions (approve = the payout: points + cash + optional 1–5 quality rating), accept/decline applications, and view an engaged roster — all scoped to the brand's single workspace.

**Architecture:** Option A. The brand identity comes from `requireBrand` (Slice 1), which sets `c.var.brand = { userId, email, workspaceId, role }`. Review **reads** use the privileged `serviceClient()` hard-filtered to `brand.workspaceId` (the lists join `creators`, which a brand user cannot read via RLS), mirroring the operator `/admin` review endpoints. Review **writes** (the 4 action RPCs are `SECURITY DEFINER` and don't check brand ownership) are each preceded by an ownership gate — the target submission must belong to a mission in `brand.workspaceId`, else **404** before any RPC runs. `workspace_id` always comes from the verified identity, never a request param. **No migration. No new env vars.** Reuses the existing `approve_submission` / `reject_submission` / `accept_application` / `decline_application` RPCs (already in prod).

**Tech Stack:** Hono v4 (`new Hono<BrandEnv>()`), Supabase `@supabase/supabase-js` (`serviceClient`), React + TanStack Router/Query, Tailwind v4 + Acid Y2K CSS classes, Vitest. Branch: `feat/brand-portal-slice2` (stacked on `feat/brand-portal-slice1` / PR #46).

**Spec:** `docs/superpowers/specs/2026-06-27-brand-portal-slice2-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `server/routes/brandReview.ts` | Create | Brand-scoped review lists + ownership-gated action endpoints |
| `server/routes/brand.ts` | Modify | Mount `guarded.route("/review", brandReviewRoutes)` |
| `package.json` | Modify | Append `server/test/brandReview.test.ts` to `test:integration` |
| `server/test/helpers.ts` | Modify | Add `seedBrandSubmission` (seeds a workspace-scoped submission + the payout balance rows) |
| `server/test/brandReview.test.ts` | Create | Two-brand isolation + payout + rating-validation integration |
| `src/lib/brand.ts` | Modify | review query keys + fetchers + action mutations (reuse `@/lib/admin` row types) |
| `src/components/brand/BrandReviewSubmissions.tsx` | Create | Submissions panel (approve w/ rating + notes / reject) |
| `src/components/brand/BrandReviewApplications.tsx` | Create | Applications panel (accept / decline) |
| `src/components/brand/BrandReviewEngaged.tsx` | Create | Engaged roster panel (read-only, expandable) |
| `src/routes/brand.review.tsx` | Create | Tabbed `/brand/review` page (local tab state) |
| `src/components/brand/BrandNav.tsx` | Modify | Add Review nav item (`ClipboardCheck` icon) |
| `src/lib/i18n.dict.ts` | Modify | `app.brand.navReview` + `app.brand.review.*` keys (en + zh) |
| `src/routes/-brand.review.test.tsx` | Create | Route-stub tests (mirror `-brand.test.tsx`) |

**Conventions (hard-won, do not violate):**
- Every relative import in non-test `server/**` files **must** carry the `.js` ESM extension (enforced by `npm run build` → `scripts/check-esm-extensions.mjs`). `.test.ts` files are exempt.
- `@typescript-eslint/no-explicit-any` is an **error**. Any `any` in a test fake needs `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directly above it (repo convention).
- The brand integration suite **auto-skips** without a local Supabase stack (`hasSupabaseEnv` → `describe.skip`). The implementer will NOT be able to run it green locally; it runs in CI. Local verification for server tasks = `npm run type-check` + `npm run build` (+ `npm run lint`). Do not chase a local green integration run.
- TanStack `<Link to>` is type-checked against the generated route tree. The new `/brand/review` route + the `BrandNav` link to it are interdependent, so the route file, the nav edit, and the panels land in **one task** with a single `npm run type-check` (which runs `tsr generate`) at the end.

---

### Task 1: Server — `brandReview.ts` review lists + ownership-gated actions

**Files:**
- Create: `server/routes/brandReview.ts`
- Modify: `server/routes/brand.ts`

- [ ] **Step 1: Create the route module**

Create `server/routes/brandReview.ts` with this exact content:

```ts
// server/routes/brandReview.ts
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../lib/supabase.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
import { persistScores } from "../lib/persistScores.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-scoped review + payout. Mounted under requireBrand (server/routes/brand.ts), so c.var.brand
 *  is the verified identity and the workspace ALWAYS comes from it, never a request param. Reads use
 *  serviceClient (privileged) hard-filtered to brand.workspaceId because the lists join `creators`,
 *  which a brand user cannot read via RLS. Every write first verifies the target submission belongs to
 *  brand.workspaceId (→ 404 otherwise) before invoking the existing SECURITY DEFINER decision/payout
 *  RPCs. Mirrors server/routes/admin.ts review endpoints. All relative imports carry the .js extension. */

export const brandReviewRoutes = new Hono<BrandEnv>();

// True iff submission `id` belongs to a mission in `workspaceId`. Gates every brand action so a
// cross-workspace submission/application id resolves to 404 before any privileged RPC runs.
async function brandOwnsSubmission(svc: SupabaseClient, id: string, workspaceId: string): Promise<boolean> {
  const { data } = await svc
    .from("mission_submissions")
    .select("id, missions!inner(workspace_id)")
    .eq("id", id)
    .eq("missions.workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

brandReviewRoutes.get("/submissions", async (c) => {
  const ws = c.var.brand.workspaceId;
  const status = c.req.query("status") ?? "submitted";
  if (status !== "submitted" && status !== "under_review") {
    return c.json({ error: "unsupported status", code: "bad_status" }, 400);
  }
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", status)
    .eq("missions.workspace_id", ws)
    .order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ submissions: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich submissions";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

brandReviewRoutes.get("/applications", async (c) => {
  const ws = c.var.brand.workspaceId;
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", "applied")
    .eq("missions.workspace_id", ws)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ applications: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich applications";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

brandReviewRoutes.get("/engaged", async (c) => {
  const ws = c.var.brand.workspaceId;
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)",
    )
    .in("status", ["joined", "submitted", "under_review", "approved"])
    .eq("missions.workspace_id", ws)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ creators: shapeEngagedRoster((data ?? []) as unknown as EngagedSubmissionRow[]) });
});

brandReviewRoutes.post("/submissions/:id/approve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ notes?: string; quality_rating?: number }>()
    .catch(() => ({}) as { notes?: string; quality_rating?: number });
  const notes = body.notes ?? null;
  const raw = body.quality_rating;
  if (raw !== undefined && raw !== null && (!Number.isInteger(raw) || raw < 1 || raw > 5)) {
    return c.json({ error: "quality_rating must be an integer 1-5", code: "bad_rating" }, 400);
  }
  const rating = raw ?? null;
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("approve_submission", { p_submission: id, p_notes: notes, p_quality_rating: rating });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

brandReviewRoutes.post("/submissions/:id/reject", async (c) => {
  const id = c.req.param("id");
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("reject_submission", { p_submission: id, p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

brandReviewRoutes.post("/applications/:id/accept", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("accept_application", { p_submission: id });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

brandReviewRoutes.post("/applications/:id/decline", async (c) => {
  const id = c.req.param("id");
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("decline_application", { p_submission: id, p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});
```

> Note: the join selects deliberately omit `missions.workspace_id` (matching the operator endpoints) — the `.eq("missions.workspace_id", ws)` filter works on the joined column without selecting it, and this keeps the response shape identical to the reused client `Submission`/`Application` types.

- [ ] **Step 2: Mount the sub-router under the brand gate**

In `server/routes/brand.ts`, add the import near the other route imports at the top:

```ts
import { brandReviewRoutes } from "./brandReview.js";
```

Then, immediately **before** the final `brandRoutes.route("/", guarded);` line, mount the review routes onto the guarded app so they inherit `requireBrand`:

```ts
guarded.route("/review", brandReviewRoutes);

brandRoutes.route("/", guarded);
```

- [ ] **Step 3: Type-check, lint, build**

```bash
npm run type-check && npm run lint && npm run build
```

Expected: all pass. `build` runs the ESM-extension guard — if it flags `brandReview.ts`, you missed a `.js` on a relative import.

- [ ] **Step 4: Commit**

```bash
git add server/routes/brandReview.ts server/routes/brand.ts
git commit -m "feat(brand): brand-scoped review + payout endpoints"
```

---

### Task 2: Integration test — two-brand isolation, payout proof, rating validation

**Files:**
- Modify: `server/test/helpers.ts`
- Create: `server/test/brandReview.test.ts`
- Modify: `package.json`

This suite skips without a local Supabase stack — that is expected. It documents intent and runs in CI. Local verification is type-check + lint.

- [ ] **Step 1: Add the `seedBrandSubmission` helper**

In `server/test/helpers.ts`, add this exported function (place it after `seedMission`, near the other brand helpers):

```ts
/** Seed a mission_submissions row (service-role) in a brand's own workspace for the review tests,
 *  plus the point/earnings balance rows the payout RPC needs in THAT workspace. The payout RPC
 *  (approve_submission) credits point_balances/earnings_balances keyed by (creator_id, workspace_id),
 *  so a creator whose home workspace is DEMO_WS needs balance rows seeded in the brand workspace
 *  before they can be paid out there. Returns the new submission id. */
export async function seedBrandSubmission(opts: {
  creatorId: string;
  workspaceId: string;
  missionId: string;
  status: string;
}) {
  await service()
    .from("point_balances")
    .upsert(
      { creator_id: opts.creatorId, workspace_id: opts.workspaceId, balance: 0 },
      { onConflict: "creator_id,workspace_id" },
    );
  await service()
    .from("earnings_balances")
    .upsert(
      { creator_id: opts.creatorId, workspace_id: opts.workspaceId, available: 0 },
      { onConflict: "creator_id,workspace_id" },
    );
  const row: Record<string, unknown> = {
    mission_id: opts.missionId,
    creator_id: opts.creatorId,
    workspace_id: opts.workspaceId,
    status: opts.status,
  };
  if (opts.status === "submitted") row.submitted_at = new Date().toISOString();
  const { data, error } = await service().from("mission_submissions").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}
```

> `point_balances` and `earnings_balances` both have `unique (creator_id, workspace_id)` (migrations 0001 / 0007), so `onConflict: "creator_id,workspace_id"` is correct. Cleanup is already covered: `cleanup()` deletes these balance rows by `creator_id` and the submissions cascade when the test creator is deleted.

- [ ] **Step 2: Create the integration test**

Create `server/test/brandReview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import {
  makeBrand,
  makeCreator,
  seedMission,
  seedBrandSubmission,
  serviceForTests,
  cleanup,
  hasSupabaseEnv,
} from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

const req = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

async function pointBalance(creatorId: string, workspaceId: string) {
  const { data } = await serviceForTests()
    .from("point_balances")
    .select("balance")
    .eq("creator_id", creatorId)
    .eq("workspace_id", workspaceId)
    .single();
  return data?.balance as number;
}

suite("brand review + payout", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let koc: Awaited<ReturnType<typeof makeCreator>>;

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("brand-rev-a@test.local");
    B = await makeBrand("brand-rev-b@test.local");
    koc = await makeCreator("brand-rev-koc@test.local", 0);
  });
  afterAll(cleanup);

  it("a brand sees only its own workspace's submissions; another brand sees none", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-sub-iso", title: "Iso", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const resA = await req("/brand/review/submissions", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).submissions.some((s: { id: string }) => s.id === subId)).toBe(true);

    const resB = await req("/brand/review/submissions", B.jwt);
    expect((await resB.json()).submissions.some((s: { id: string }) => s.id === subId)).toBe(false);
  });

  it("a brand cannot approve another workspace's submission (→ 404), and no payout occurs", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-xws-approve", title: "XWS", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const res = await req(`/brand/review/submissions/${subId}/approve`, B.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(404);
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(0);
  });

  it("the owning brand approves with a 5-star rating: 200 + the creator is paid the mission's points", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-payout", title: "Payout", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(0);

    const res = await req(`/brand/review/submissions/${subId}/approve`, A.jwt, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 5, notes: "great" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(100);
  });

  it("rejects an out-of-range quality_rating with 400 bad_rating before touching the RPC", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-badrate", title: "BadRate", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const res = await req(`/brand/review/submissions/${subId}/approve`, A.jwt, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 7 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_rating");
  });

  it("applications are workspace-scoped, and a non-owning brand cannot accept (→ 404)", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-appl", title: "Appl", status: "active", points_reward: 0 });
    const appId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "applied" });

    const resA = await req("/brand/review/applications", A.jwt);
    expect((await resA.json()).applications.some((a: { id: string }) => a.id === appId)).toBe(true);
    const resB = await req("/brand/review/applications", B.jwt);
    expect((await resB.json()).applications.some((a: { id: string }) => a.id === appId)).toBe(false);

    const xws = await req(`/brand/review/applications/${appId}/accept`, B.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(xws.status).toBe(404);

    const ok = await req(`/brand/review/applications/${appId}/accept`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(ok.status).toBe(200);
  });

  it("the engaged roster is scoped to the brand's workspace", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-engaged", title: "Engaged", status: "active", points_reward: 0 });
    await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const resA = await req("/brand/review/engaged", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).creators.some((cr: { id: string }) => cr.id === koc.userId)).toBe(true);

    const resB = await req("/brand/review/engaged", B.jwt);
    expect((await resB.json()).creators.length).toBe(0);
  });
});
```

> Each `it` seeds its own mission so the `mission_submissions (mission_id, creator_id)` unique constraint never collides across tests. `points_reward: 0` missions avoid leftover balance noise where payout isn't under test.

- [ ] **Step 3: Register the suite in `test:integration`**

In `package.json`, find the `"test:integration"` script and append ` server/test/brandReview.test.ts` to the very end of the space-separated file list (after `server/test/brand.test.ts`).

- [ ] **Step 4: Verify type-check + lint (the suite itself skips locally)**

```bash
npm run type-check && npm run lint
```

Expected: pass. If a local Supabase stack happens to be running with `RUN_INTEGRATION=1`, `npm run test:integration` should be green; otherwise the suite is skipped — that is fine.

- [ ] **Step 5: Commit**

```bash
git add server/test/helpers.ts server/test/brandReview.test.ts package.json
git commit -m "test(brand): brand review isolation + payout integration tests"
```

---

### Task 3: Client lib — `brand.ts` review keys, fetchers, mutations

**Files:**
- Modify: `src/lib/brand.ts`

- [ ] **Step 1: Extend the imported admin types**

In `src/lib/brand.ts`, change the existing admin type import to also pull the review row types (reuse, don't re-declare):

```ts
import type { AdminMission, MissionDraftInput, MissionPatch, Application, Submission, EngagedCreator } from "@/lib/admin";
```

- [ ] **Step 2: Add review query keys**

Replace the existing `brandKeys` object with:

```ts
export const brandKeys = {
  me: () => ["brand-me"] as const,
  missions: (status: string) => ["brand-missions", status] as const,
  mission: (id: string) => ["brand-mission", id] as const,
  submissions: (status: string) => ["brand-submissions", status] as const,
  applications: () => ["brand-applications"] as const,
  engaged: () => ["brand-engaged"] as const,
};
```

- [ ] **Step 3: Add the review fetchers + action mutations**

Append to the bottom of `src/lib/brand.ts`:

```ts
// --- Slice 2: review + payout ----------------------------------------------------------------
export const fetchBrandSubmissions = (status = "submitted") =>
  brandFetch<{ submissions: Submission[] }>(`/review/submissions?status=${encodeURIComponent(status)}`);
export const fetchBrandApplications = () =>
  brandFetch<{ applications: Application[] }>("/review/applications");
export const fetchBrandEngaged = () =>
  brandFetch<{ creators: EngagedCreator[] }>("/review/engaged");

export const approveBrandSubmission = (id: string, body: { notes?: string; rating?: number }) =>
  brandFetch(`/review/submissions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes: body.notes, quality_rating: body.rating }),
  });
export const rejectBrandSubmission = (id: string, notes?: string) =>
  brandFetch(`/review/submissions/${id}/reject`, { method: "POST", body: JSON.stringify(notes ? { notes } : {}) });
export const acceptBrandApplication = (id: string) =>
  brandFetch(`/review/applications/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
export const declineBrandApplication = (id: string, notes?: string) =>
  brandFetch(`/review/applications/${id}/decline`, { method: "POST", body: JSON.stringify(notes ? { notes } : {}) });
```

> The client signature uses `{ notes?, rating? }` (mapped to `quality_rating` in the body) so the submission card UI is identical to the operator card. `brandFetch` already throws `BrandAuthError` on 401/403 and `AdminRequestError` otherwise.

- [ ] **Step 4: Type-check + lint**

```bash
npm run type-check && npm run lint
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brand.ts
git commit -m "feat(brand): review fetchers + payout mutations in client lib"
```

---

### Task 4: i18n — `app.brand.navReview` + `app.brand.review.*` keys (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts`

Parity between the en and zh blocks is enforced by a unit test, so add the **same key set** to both. The `zh` values are asserted verbatim by the route-stub tests (Task 6) and used as `aria-label`s — keep them exactly as written here.

- [ ] **Step 1: Add the English keys**

In `src/lib/i18n.dict.ts`, in the **en** block, immediately after `"app.brand.callbackFailed": "Sign-in failed. Please request a new link.",` add:

```ts
    "app.brand.navReview": "Review",
    "app.brand.review.tabSubmissions": "Submissions",
    "app.brand.review.tabApplications": "Applications",
    "app.brand.review.tabEngaged": "Engaged",
    "app.brand.review.submissionsEmpty": "No submissions to review.",
    "app.brand.review.applicationsEmpty": "No pending applications.",
    "app.brand.review.engagedEmpty": "No one is working on your missions yet.",
    "app.brand.review.approve": "Approve",
    "app.brand.review.reject": "Reject",
    "app.brand.review.accept": "Accept",
    "app.brand.review.decline": "Decline",
    "app.brand.review.ratingLabel": "Quality rating",
    "app.brand.review.ratingPlaceholder": "Rate (optional)",
    "app.brand.review.notesLabel": "Notes",
    "app.brand.review.notesPlaceholder": "Notes (optional)",
```

- [ ] **Step 2: Add the Traditional Chinese keys**

In the **zh** block, immediately after `"app.brand.callbackFailed": "登入失敗，請重新索取連結。",` add:

```ts
    "app.brand.navReview": "審核",
    "app.brand.review.tabSubmissions": "提交",
    "app.brand.review.tabApplications": "申請",
    "app.brand.review.tabEngaged": "參與者",
    "app.brand.review.submissionsEmpty": "沒有待審核的提交。",
    "app.brand.review.applicationsEmpty": "沒有待處理的申請。",
    "app.brand.review.engagedEmpty": "暫時未有人參與你的任務。",
    "app.brand.review.approve": "批准",
    "app.brand.review.reject": "拒絕",
    "app.brand.review.accept": "接受",
    "app.brand.review.decline": "婉拒",
    "app.brand.review.ratingLabel": "品質評分",
    "app.brand.review.ratingPlaceholder": "評分（可選）",
    "app.brand.review.notesLabel": "備註",
    "app.brand.review.notesPlaceholder": "備註（可選）",
```

- [ ] **Step 3: Run the i18n + type-check gates**

```bash
npm run type-check && npm run test -- src/lib/i18n
```

Expected: type-check passes; the i18n parity test passes (en and zh key sets now match).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "i18n(brand): review tab/nav/action keys (en + zh)"
```

---

### Task 5: UI — review panels + tabbed `/brand/review` route + nav item

**Files:**
- Create: `src/components/brand/BrandReviewSubmissions.tsx`
- Create: `src/components/brand/BrandReviewApplications.tsx`
- Create: `src/components/brand/BrandReviewEngaged.tsx`
- Create: `src/routes/brand.review.tsx`
- Modify: `src/components/brand/BrandNav.tsx`

These land together because the route and the nav link to it are interdependent under TanStack's generated route tree (one `tsr generate` / type-check at the end). All three panels read the brand identity via `useBrandAuth` (provided by the `BrandAuthGate` in the `brand.tsx` layout) and report auth errors through `reportAuthError`, mirroring the operator review tabs.

- [ ] **Step 1: Submissions panel**

Create `src/components/brand/BrandReviewSubmissions.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import {
  BrandAuthError,
  brandKeys,
  fetchBrandSubmissions,
  approveBrandSubmission,
  rejectBrandSubmission,
} from "@/lib/brand";
import type { Submission } from "@/lib/admin";

export function BrandReviewSubmissions() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: brandKeys.submissions("submitted"),
    queryFn: () => fetchBrandSubmissions("submitted"),
    retry: false,
  });
  useEffect(() => {
    if (subs.error instanceof BrandAuthError) reportAuthError(subs.error);
  }, [subs.error, reportAuthError]);

  if (subs.isLoading) return <p className="text-sm">載入中…</p>;
  if (subs.data?.submissions.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.submissionsEmpty")}</p>;

  return (
    <div className="space-y-3">
      {subs.data?.submissions.map((s) => (
        <BrandSubmissionCard
          key={s.id}
          submission={s}
          onDone={() => qc.invalidateQueries({ queryKey: brandKeys.submissions("submitted") })}
        />
      ))}
    </div>
  );
}

function BrandSubmissionCard({ submission, onDone }: { submission: Submission; onDone: () => void }) {
  const { t } = useI18n();
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const approve = useMutation({
    mutationFn: () => approveBrandSubmission(submission.id, { notes: notes || undefined, rating: rating ? Number(rating) : undefined }),
    onSuccess: onDone,
  });
  const reject = useMutation({ mutationFn: () => rejectBrandSubmission(submission.id, notes || undefined), onSuccess: onDone });
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
        <select
          aria-label={t("app.brand.review.ratingLabel")}
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm"
        >
          <option value="">{t("app.brand.review.ratingPlaceholder")}</option>
          <option value="1">1★</option>
          <option value="2">2★</option>
          <option value="3">3★</option>
          <option value="4">4★</option>
          <option value="5">5★</option>
        </select>
        <input
          aria-label={t("app.brand.review.notesLabel")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("app.brand.review.notesPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm"
        />
        <button
          aria-label={t("app.brand.review.approve")}
          disabled={busy}
          onClick={() => approve.mutate()}
          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold"
        >
          {t("app.brand.review.approve")}
        </button>
        <button
          aria-label={t("app.brand.review.reject")}
          disabled={busy}
          onClick={() => reject.mutate()}
          className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold"
        >
          {t("app.brand.review.reject")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Applications panel**

Create `src/components/brand/BrandReviewApplications.tsx`:

```tsx
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import {
  BrandAuthError,
  brandKeys,
  fetchBrandApplications,
  acceptBrandApplication,
  declineBrandApplication,
} from "@/lib/brand";

export function BrandReviewApplications() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: brandKeys.applications(), queryFn: fetchBrandApplications, retry: false });
  useEffect(() => {
    if (apps.error instanceof BrandAuthError) reportAuthError(apps.error);
  }, [apps.error, reportAuthError]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      action === "accept" ? acceptBrandApplication(id) : declineBrandApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: brandKeys.applications() }),
  });

  if (apps.isLoading) return <p className="text-sm">載入中…</p>;
  if (apps.data?.applications.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.applicationsEmpty")}</p>;

  return (
    <div className="space-y-3">
      {apps.data?.applications.map((a) => (
        <div
          key={a.id}
          className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          <div className="min-w-0 space-y-1">
            <p className="font-heading font-bold">{a.creators.display_name}</p>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              aria-label={t("app.brand.review.accept")}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: a.id, action: "accept" })}
              className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold"
            >
              {t("app.brand.review.accept")}
            </button>
            <button
              aria-label={t("app.brand.review.decline")}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: a.id, action: "decline" })}
              className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold"
            >
              {t("app.brand.review.decline")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Engaged roster panel**

Create `src/components/brand/BrandReviewEngaged.tsx` (internals are inline-zh, consistent with the existing brand mission-list precedent):

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandEngaged } from "@/lib/brand";
import type { EngagedCreator } from "@/lib/admin";

const STAGE_ZH: Record<string, string> = { joined: "已加入", submitted: "已提交", under_review: "審核中" };

export function BrandReviewEngaged() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.engaged(), queryFn: fetchBrandEngaged, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (q.data?.creators.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.engagedEmpty")}</p>;

  return (
    <div className="space-y-3">
      {q.data?.creators.map((c) => <BrandEngagedCard key={c.id} creator={c} />)}
    </div>
  );
}

function BrandEngagedCard({ creator }: { creator: EngagedCreator }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold">{creator.displayName ?? "未命名"}</span>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{creator.level}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span>{creator.activeCount} 進行中</span>
          <span>{creator.completedCount} 已完成</span>
          <span>{creator.pointsEarned} 分</span>
        </div>
      </button>
      {open && (
        <ul className="space-y-2 border-t-2 border-[var(--color-ink)] p-3">
          {creator.activeMissions.map((m) => (
            <li key={m.submissionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{m.missionTitle}</span>
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{STAGE_ZH[m.status] ?? m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Tabbed route**

Create `src/routes/brand.review.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BrandReviewSubmissions } from "@/components/brand/BrandReviewSubmissions";
import { BrandReviewApplications } from "@/components/brand/BrandReviewApplications";
import { BrandReviewEngaged } from "@/components/brand/BrandReviewEngaged";

export const Route = createFileRoute("/brand/review")({ component: BrandReview });

type Tab = "submissions" | "applications" | "engaged";

function BrandReview() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("submissions");
  const tabs: { key: Tab; label: string }[] = [
    { key: "submissions", label: t("app.brand.review.tabSubmissions") },
    { key: "applications", label: t("app.brand.review.tabApplications") },
    { key: "engaged", label: t("app.brand.review.tabEngaged") },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            aria-pressed={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={
              tab === tb.key
                ? "rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading text-sm font-bold"
                : "rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading text-sm font-semibold text-[var(--color-soft-ink)]"
            }
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "submissions" && <BrandReviewSubmissions />}
      {tab === "applications" && <BrandReviewApplications />}
      {tab === "engaged" && <BrandReviewEngaged />}
    </div>
  );
}
```

- [ ] **Step 5: Add the Review nav item**

In `src/components/brand/BrandNav.tsx`, add `ClipboardCheck` to the lucide import:

```ts
import { LayoutDashboard, Target, ClipboardCheck } from "lucide-react";
```

Then add the third item to the `ITEMS` array:

```ts
const ITEMS = [
  { to: "/brand", exact: true, icon: LayoutDashboard, labelKey: "app.brand.navDashboard" },
  { to: "/brand/missions", exact: false, icon: Target, labelKey: "app.brand.navMissions" },
  { to: "/brand/review", exact: false, icon: ClipboardCheck, labelKey: "app.brand.navReview" },
] as const;
```

- [ ] **Step 6: Generate the route tree + full gate**

```bash
npm run type-check && npm run lint && npm run build
```

Expected: `type-check` regenerates the route tree (so `<Link to="/brand/review">` and `createFileRoute("/brand/review")` resolve) and passes; lint + build pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/brand/BrandReviewSubmissions.tsx src/components/brand/BrandReviewApplications.tsx src/components/brand/BrandReviewEngaged.tsx src/routes/brand.review.tsx src/components/brand/BrandNav.tsx
git commit -m "feat(brand): review tabs UI + nav item"
```

---

### Task 6: Route-stub tests for `/brand/review`

**Files:**
- Create: `src/routes/-brand.review.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/routes/-brand.review.test.tsx` (mirrors `-brand.test.tsx`; the real `useI18n` resolves zh labels, so the asserted strings are the zh values added in Task 4):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandSubmissions: vi.fn(),
  fetchBrandApplications: vi.fn(),
  fetchBrandEngaged: vi.fn(),
  approveBrandSubmission: vi.fn(),
  rejectBrandSubmission: vi.fn(),
  acceptBrandApplication: vi.fn(),
  declineBrandApplication: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandSubmissions: h.fetchBrandSubmissions,
  fetchBrandApplications: h.fetchBrandApplications,
  fetchBrandEngaged: h.fetchBrandEngaged,
  approveBrandSubmission: h.approveBrandSubmission,
  rejectBrandSubmission: h.rejectBrandSubmission,
  acceptBrandApplication: h.acceptBrandApplication,
  declineBrandApplication: h.declineBrandApplication,
  brandKeys: {
    submissions: (s: string) => ["brand-submissions", s],
    applications: () => ["brand-applications"],
    engaged: () => ["brand-engaged"],
  },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/lib/admin", () => ({ AdminRequestError: class extends Error {} }));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({
    brand: { email: "b@x", workspaceId: "w1", workspaceName: "Acme", role: "owner" },
    reportAuthError: h.reportAuthError,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.review";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
    h.fetchBrandSubmissions.mockResolvedValue({ submissions: [] });
    h.fetchBrandApplications.mockResolvedValue({ applications: [] });
    h.fetchBrandEngaged.mockResolvedValue({ creators: [] });
  });

  it("renders a submission with an approve action on the default tab", async () => {
    h.fetchBrandSubmissions.mockResolvedValue({
      submissions: [
        {
          id: "s1",
          status: "submitted",
          content_urls: ["https://x.test/post"],
          submitted_at: null,
          creators: { display_name: "Alice" },
          missions: { slug: "m", title: "Mission One", points_reward: 100 },
        },
      ],
    });
    r();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Mission One")).toBeInTheDocument();
    expect(screen.getByLabelText("批准")).toBeInTheDocument(); // approve
  });

  it("shows applications with accept/decline after switching tabs", async () => {
    h.fetchBrandApplications.mockResolvedValue({
      applications: [
        { id: "a1", creators: { display_name: "Bob" }, missions: { slug: "m", title: "Mission Two", points_reward: 0 } },
      ],
    });
    r();
    fireEvent.click(screen.getByText("申請")); // tabApplications
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.getByLabelText("接受")).toBeInTheDocument(); // accept
    expect(screen.getByLabelText("婉拒")).toBeInTheDocument(); // decline
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm run test -- src/routes/-brand.review.test.tsx
```

Expected: 2 passing.

- [ ] **Step 3: Full gate**

```bash
npm run type-check && npm run lint && npm run test && npm run build
```

Expected: all green (full unit suite + type-check + lint + build).

- [ ] **Step 4: Commit**

```bash
git add src/routes/-brand.review.test.tsx
git commit -m "test(brand): route-stub tests for /brand/review"
```

---

## Final: Holistic review + finish branch

- [ ] Dispatch a final code reviewer over the whole branch diff (`git diff feat/brand-portal-slice1...HEAD`), with special attention to the **RLS/identity trust boundary**: every read filters on `c.var.brand.workspaceId` (never a request param), and every action calls `brandOwnsSubmission` before the RPC. Confirm the two-brand isolation + payout integration test actually proves cross-workspace 404.
- [ ] Use superpowers:finishing-a-development-branch to open the PR. The PR description must carry the **deploy checklist**:
  - **No migration, no new env vars** — deploy is a code push only (reuses RPCs already in prod).
  - This PR is **stacked on PR #46 (Slice 1)**. Slice 1's prod-pending items still apply (apply migration `0023`, add `/brand/auth/callback` to the Supabase redirect allow-list). Merge order: #46 first, then this.
  - Post-deploy smoke: as a brand, `GET /api/brand/review/submissions` returns only the brand's workspace rows; approving a submission credits the creator's points.

---

## Self-Review (completed by plan author)

- **Spec coverage:** ✅ submissions list + approve(payout, rating)/reject (Tasks 1, 3, 5); applications list + accept/decline (Tasks 1, 3, 5); engaged roster (Tasks 1, 3, 5); ownership gate → 404 + identity-derived workspace filter (Task 1); `/brand/review` tabbed page + Review nav item (Task 5); `app.brand.review.*` i18n en+zh parity (Task 4); two-brand isolation + payout + rating-validation integration (Task 2); route-stub tests (Task 6); no migration / no env (header + final). Out-of-scope brand budget/billing correctly excluded.
- **Placeholder scan:** ✅ no TBD/TODO; every code step shows complete code; every command shows expected output.
- **Type consistency:** ✅ `brandOwnsSubmission(svc, id, workspaceId)` used identically in all 4 actions; client `approveBrandSubmission(id, { notes?, rating? })` → maps to `quality_rating`, consumed by `BrandSubmissionCard`; reused `Submission`/`Application`/`EngagedCreator` from `@/lib/admin` match the server select shapes; `brandKeys.submissions/applications/engaged` defined in Task 3 and consumed in Tasks 5–6; zh i18n values asserted in Task 6 match Task 4 exactly (批准/接受/婉拒/申請).
