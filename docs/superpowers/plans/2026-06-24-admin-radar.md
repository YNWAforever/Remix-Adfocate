# Admin At-risk Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin/radar` — four read-only operator queues (at-risk creators, SLA-breaching submissions, rising performers, new/unactivated) computed on-read from existing tables.

**Architecture:** Pure `shapeRadar()` in `server/lib/radar.ts` → guarded Hono `GET /api/admin/radar` (inherits staff auth from `adminRoutes`) → `src/routes/admin.radar.tsx` React page. All four DB queries run in parallel (`Promise.all`) in the route; the shaper is pure and fully unit-tested. No migration, no new env vars, no writes.

**Tech Stack:** Hono v4 (server), Supabase `serviceClient()` (RLS-bypassing reads), React + TanStack Query (client), Vitest (unit + integration tests), Tailwind v4 + Acid Y2K CSS classes, i18n (`t()` with `{n}` param support).

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `server/lib/radar.ts` | **Create** | All types + pure `shapeRadar()` |
| `server/lib/radar.test.ts` | **Create** | 8 unit tests for `shapeRadar` |
| `server/routes/adminRadar.ts` | **Create** | Hono route + 5 parallel DB queries |
| `server/routes/admin.ts` | **Modify** | Register `adminRadarRoutes` |
| `server/test/radar.test.ts` | **Create** | 4 integration tests (env-gated) |
| `package.json` | **Modify** | Append to `test:integration` file list |
| `src/lib/admin.ts` | **Modify** | Add `adminKeys.radar`, `fetchRadar`, + 5 types |
| `src/lib/i18n.dict.ts` | **Modify** | Add 17 `app.radar.*` + 1 `app.admin.tabRadar` keys (en + zh) |
| `src/components/admin/adminNavItems.ts` | **Modify** | Add Radar item to Analytics group |
| `src/routes/admin.radar.tsx` | **Create** | `RadarPage` component |
| `src/routes/-admin.radar.test.tsx` | **Create** | Route stub test (3 cases) |
| `src/routes/admin.insights.tsx` | **Modify** | Remove locked radar teaser card |

---

## Task 1: Backend types + unit tests (TDD: tests first)

**Files:**
- Create: `server/lib/radar.ts` (types only — no implementation yet)
- Create: `server/lib/radar.test.ts`

- [ ] **Step 1: Create `server/lib/radar.ts` with types and a stub**

```typescript
// server/lib/radar.ts
// Pure shaper for the operator At-risk & Opportunity Radar.
// Takes pre-fetched rows from the Hono route and returns four ranked queues.
// No DB / no async — fully unit-testable. Mirrors shapeInsights / shapeEngagedRoster.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TOP_N = 20;

const ACTIVE_STATUSES = new Set(["joined", "submitted", "under_review"]);

// --- Raw DB row types (PostgREST joined shape) --------------------------------

export type AtRiskRawRow = {
  creator_id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  creators: { display_name: string | null; phone: string | null };
};

export type OverdueRawRow = {
  id: string;
  creator_id: string;
  status: string;
  review_deadline: string;
  creators: { display_name: string | null };
  missions: { title: string };
};

export type RecentApprovalRawRow = {
  creator_id: string;
  quality_rating: number | null;
  creators: { display_name: string | null; level: string };
};

export type NewCreatorRawRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;
};

// --- Shaped output types ------------------------------------------------------

export type RadarAtRiskRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  last_active: string;   // ISO
  days_idle: number;
};

export type RadarOverdueRow = {
  submission_id: string;
  creator_id: string;
  display_name: string | null;
  mission_title: string;
  status: "submitted" | "under_review";
  review_deadline: string;   // ISO
  urgency: "overdue" | "due_soon";
  hours_overdue: number;     // positive = overdue, negative = future (due_soon)
};

export type RadarRisingRow = {
  creator_id: string;
  display_name: string | null;
  level: string;
  recent_approvals: number;
  avg_quality: number | null;  // null = no rated submissions; score uses 3 as default
  score: number;               // recent_approvals × (avg_quality ?? 3)
};

export type RadarNewCreatorRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;   // ISO
  days_since_join: number;
};

export type RadarQueue<T> = {
  items: T[];    // capped at TOP_N (20)
  total: number; // full count before cap — for "+N more" UI indicator
};

export type Radar = {
  window: { days: number; from: string };  // ISO cutoff
  atRisk: RadarQueue<RadarAtRiskRow>;
  slaBreaching: RadarQueue<RadarOverdueRow>;
  rising: RadarQueue<RadarRisingRow>;
  newUnactivated: RadarQueue<RadarNewCreatorRow>;
};

export type ShapeRadarInput = {
  now: string;                          // ISO instant — injected by route, not Date.now()
  days: number;
  allSubmissions: AtRiskRawRow[];       // all historical mission_submissions (for Queue A)
  overdueSubmissions: OverdueRawRow[];  // status ∈ submitted|under_review + deadline ≤ now+2d (Queue B)
  recentApprovals: RecentApprovalRawRow[]; // approved rows in last `days` days (Queue C)
  newCreators: NewCreatorRawRow[];      // creators created in last `days` days (Queue D)
  allParticipantIds: string[];          // distinct creator_ids from all mission_submissions (anti-join for Queue D)
};

// --- Implementation stub (will fail tests until Task 2 implements it) ---------

export function shapeRadar(_input: ShapeRadarInput): Radar {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Create `server/lib/radar.test.ts`**

```typescript
// server/lib/radar.test.ts
import { describe, it, expect } from "vitest";
import {
  shapeRadar,
  type ShapeRadarInput,
  type AtRiskRawRow,
  type OverdueRawRow,
  type RecentApprovalRawRow,
  type NewCreatorRawRow,
} from "./radar";

const NOW = "2026-06-30T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86_400_000;
// Helper: ISO string N days before NOW
const daysAgo = (n: number) => new Date(NOW_MS - n * DAY_MS).toISOString();
// Helper: ISO string N days after NOW (future deadline)
const daysAhead = (n: number) => new Date(NOW_MS + n * DAY_MS).toISOString();

let uid = 0;
function sub(over: Partial<AtRiskRawRow> & { creator_id: string; status: string }): AtRiskRawRow {
  return {
    creator_id: over.creator_id,
    status: over.status,
    created_at: over.created_at ?? daysAgo(60),
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
    creators: over.creators ?? { display_name: `User ${over.creator_id}`, phone: null },
  };
}

function overdue(over: Partial<OverdueRawRow> & { id: string }): OverdueRawRow {
  return {
    id: over.id,
    creator_id: over.creator_id ?? `c${uid++}`,
    status: over.status ?? "submitted",
    review_deadline: over.review_deadline ?? daysAgo(1),
    creators: over.creators ?? { display_name: "Creator" },
    missions: over.missions ?? { title: "Test Mission" },
  };
}

function approval(over: Partial<RecentApprovalRawRow> & { creator_id: string }): RecentApprovalRawRow {
  return {
    creator_id: over.creator_id,
    quality_rating: over.quality_rating ?? null,
    creators: over.creators ?? { display_name: "Creator", level: "L1" },
  };
}

function newCreator(over: Partial<NewCreatorRawRow> & { id: string }): NewCreatorRawRow {
  return {
    id: over.id,
    display_name: over.display_name ?? `New ${over.id}`,
    phone: over.phone ?? null,
    created_at: over.created_at ?? daysAgo(5),
  };
}

function base(over: Partial<ShapeRadarInput> = {}): ShapeRadarInput {
  return {
    now: NOW,
    days: 30,
    allSubmissions: over.allSubmissions ?? [],
    overdueSubmissions: over.overdueSubmissions ?? [],
    recentApprovals: over.recentApprovals ?? [],
    newCreators: over.newCreators ?? [],
    allParticipantIds: over.allParticipantIds ?? [],
  };
}

describe("shapeRadar", () => {
  it("returns empty queues on empty input without throwing", () => {
    const r = shapeRadar(base());
    expect(r.atRisk.total).toBe(0);
    expect(r.atRisk.items).toHaveLength(0);
    expect(r.slaBreaching.total).toBe(0);
    expect(r.rising.total).toBe(0);
    expect(r.newUnactivated.total).toBe(0);
    expect(r.window.days).toBe(30);
  });

  it("caps each queue at 20, reporting the full total", () => {
    const subs = Array.from({ length: 25 }, (_, i) => sub({ creator_id: `c${i}`, status: "approved", created_at: daysAgo(60) }));
    const r = shapeRadar(base({ allSubmissions: subs }));
    expect(r.atRisk.total).toBe(25);
    expect(r.atRisk.items).toHaveLength(20);
  });

  it("excludes at-risk creators who have an active row", () => {
    const stale = sub({ creator_id: "stale", status: "approved", created_at: daysAgo(60) });
    const active = sub({ creator_id: "active", status: "joined", created_at: daysAgo(60) });
    const r = shapeRadar(base({ allSubmissions: [stale, active] }));
    expect(r.atRisk.total).toBe(1);
    expect(r.atRisk.items[0].creator_id).toBe("stale");
  });

  it("computes days_idle correctly from the most recent activity timestamp", () => {
    // Creator has two rows; last activity = submitted_at = 40 days ago
    const rows = [
      sub({ creator_id: "x", status: "rejected", created_at: daysAgo(60), submitted_at: daysAgo(40) }),
      sub({ creator_id: "x", status: "approved", created_at: daysAgo(50), submitted_at: daysAgo(45), reviewed_at: daysAgo(40) }),
    ];
    const r = shapeRadar(base({ allSubmissions: rows }));
    expect(r.atRisk.total).toBe(1);
    expect(r.atRisk.items[0].days_idle).toBe(40);
  });

  it("classifies SLA rows as overdue (past deadline) or due_soon (future ≤ 2d)", () => {
    const rows = [
      overdue({ id: "o1", review_deadline: daysAgo(1) }),   // overdue
      overdue({ id: "o2", review_deadline: daysAhead(1) }), // due_soon
    ];
    const r = shapeRadar(base({ overdueSubmissions: rows }));
    expect(r.slaBreaching.total).toBe(2);
    const o = r.slaBreaching.items.find(i => i.submission_id === "o1")!;
    const d = r.slaBreaching.items.find(i => i.submission_id === "o2")!;
    expect(o.urgency).toBe("overdue");
    expect(d.urgency).toBe("due_soon");
    expect(o.hours_overdue).toBeGreaterThan(0);
    expect(d.hours_overdue).toBeLessThan(0);
  });

  it("computes rising score = approvals × avg_quality, defaulting null quality to 3", () => {
    const rows = [
      approval({ creator_id: "r1", quality_rating: 5 }),
      approval({ creator_id: "r1", quality_rating: 3 }),
      approval({ creator_id: "r2", quality_rating: null }), // defaults to 3
      approval({ creator_id: "r2", quality_rating: null }),
    ];
    const r = shapeRadar(base({ recentApprovals: rows }));
    const r1 = r.rising.items.find(i => i.creator_id === "r1")!;
    const r2 = r.rising.items.find(i => i.creator_id === "r2")!;
    expect(r1.recent_approvals).toBe(2);
    expect(r1.avg_quality).toBe(4); // (5+3)/2
    expect(r1.score).toBe(8);       // 2 × 4
    expect(r2.avg_quality).toBeNull();
    expect(r2.score).toBe(6);       // 2 × 3 (default)
  });

  it("excludes new creators who already have a participation record", () => {
    const creators = [
      newCreator({ id: "new1" }),
      newCreator({ id: "new2" }), // has a participation
    ];
    const r = shapeRadar(base({
      newCreators: creators,
      allParticipantIds: ["new2"],
    }));
    expect(r.newUnactivated.total).toBe(1);
    expect(r.newUnactivated.items[0].creator_id).toBe("new1");
  });

  it("computes days_since_join for new/unactivated creators", () => {
    const creators = [newCreator({ id: "n1", created_at: daysAgo(10) })];
    const r = shapeRadar(base({ newCreators: creators }));
    expect(r.newUnactivated.items[0].days_since_join).toBe(10);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail with "not implemented"**

```bash
cd /path/to/adfocate-2
npx vitest run server/lib/radar.test.ts 2>&1 | head -30
```

Expected: All 8 tests fail with `Error: not implemented`.

---

## Task 2: Implement `shapeRadar`

**Files:**
- Modify: `server/lib/radar.ts` (replace the stub with the real implementation)

- [ ] **Step 1: Replace the stub in `server/lib/radar.ts`**

Replace the line `export function shapeRadar(_input: ShapeRadarInput): Radar { throw new Error("not implemented"); }` with:

```typescript
// --- Private helpers ----------------------------------------------------------

function cap<T>(items: T[]): RadarQueue<T> {
  return { items: items.slice(0, TOP_N), total: items.length };
}

function buildAtRisk(rows: AtRiskRawRow[], nowMs: number, cutoffMs: number): RadarAtRiskRow[] {
  // Group rows by creator_id: track their most-recent activity timestamp and whether
  // any row is currently active. Fetching all submissions per creator lets us determine
  // both "they've participated before" and "they have nothing active right now."
  const map = new Map<
    string,
    { display_name: string | null; phone: string | null; lastActiveMs: number; hasActive: boolean }
  >();

  for (const r of rows) {
    const ts = [r.created_at, r.submitted_at, r.reviewed_at]
      .filter((t): t is string => t !== null && t !== undefined)
      .map((t) => Date.parse(t))
      .filter(Number.isFinite);
    const rowLastMs = ts.length ? Math.max(...ts) : 0;
    const isActive = ACTIVE_STATUSES.has(r.status);

    const cur = map.get(r.creator_id);
    if (cur) {
      cur.lastActiveMs = Math.max(cur.lastActiveMs, rowLastMs);
      cur.hasActive = cur.hasActive || isActive;
    } else {
      map.set(r.creator_id, {
        display_name: r.creators.display_name,
        phone: r.creators.phone,
        lastActiveMs: rowLastMs,
        hasActive: isActive,
      });
    }
  }

  return [...map.entries()]
    .filter(([, v]) => !v.hasActive && v.lastActiveMs > 0 && v.lastActiveMs < cutoffMs)
    .sort(([, a], [, b]) => a.lastActiveMs - b.lastActiveMs) // most stale first
    .map(([creator_id, v]) => ({
      creator_id,
      display_name: v.display_name,
      phone: v.phone,
      last_active: new Date(v.lastActiveMs).toISOString(),
      days_idle: Math.floor((nowMs - v.lastActiveMs) / DAY_MS),
    }));
}

function buildSlaBreaching(rows: OverdueRawRow[], nowMs: number): RadarOverdueRow[] {
  // DB query already filters to status ∈ (submitted, under_review) and deadline ≤ now+2d;
  // DB orders by review_deadline ASC (most-overdue first).
  return rows.map((r) => {
    const deadlineMs = Date.parse(r.review_deadline);
    return {
      submission_id: r.id,
      creator_id: r.creator_id,
      display_name: r.creators.display_name,
      mission_title: r.missions.title,
      status: r.status as "submitted" | "under_review",
      review_deadline: r.review_deadline,
      urgency: deadlineMs < nowMs ? "overdue" : "due_soon",
      hours_overdue: Math.round((nowMs - deadlineMs) / HOUR_MS),
    };
  });
}

function buildRising(rows: RecentApprovalRawRow[]): RadarRisingRow[] {
  const map = new Map<
    string,
    { display_name: string | null; level: string; count: number; ratingSum: number; ratedCount: number }
  >();

  for (const r of rows) {
    const cur = map.get(r.creator_id);
    if (cur) {
      cur.count += 1;
      if (r.quality_rating !== null) {
        cur.ratingSum += r.quality_rating;
        cur.ratedCount += 1;
      }
    } else {
      map.set(r.creator_id, {
        display_name: r.creators.display_name,
        level: r.creators.level,
        count: 1,
        ratingSum: r.quality_rating ?? 0,
        ratedCount: r.quality_rating !== null ? 1 : 0,
      });
    }
  }

  return [...map.entries()]
    .map(([creator_id, v]) => {
      const avg_quality =
        v.ratedCount > 0 ? Math.round((v.ratingSum / v.ratedCount) * 10) / 10 : null;
      const score = v.count * (avg_quality ?? 3);
      return {
        creator_id,
        display_name: v.display_name,
        level: v.level,
        recent_approvals: v.count,
        avg_quality,
        score,
      };
    })
    .sort((a, b) => b.score - a.score); // highest score first
}

function buildNewUnactivated(
  rows: NewCreatorRawRow[],
  participantIds: Set<string>,
  nowMs: number,
): RadarNewCreatorRow[] {
  // Creators table has no workspace_id column — creators are global, not workspace-scoped.
  // The anti-join is done here in JS against the participant set built by the route.
  // DB already returns newest-first (ORDER BY created_at DESC).
  return rows
    .filter((r) => !participantIds.has(r.id))
    .map((r) => ({
      creator_id: r.id,
      display_name: r.display_name,
      phone: r.phone,
      created_at: r.created_at,
      days_since_join: Math.floor((nowMs - Date.parse(r.created_at)) / DAY_MS),
    }));
}

// --- Public API ---------------------------------------------------------------

export function shapeRadar(input: ShapeRadarInput): Radar {
  const { now, days } = input;
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - days * DAY_MS;
  const fromIso = new Date(cutoffMs).toISOString();
  const participantIds = new Set(input.allParticipantIds);

  return {
    window: { days, from: fromIso },
    atRisk: cap(buildAtRisk(input.allSubmissions, nowMs, cutoffMs)),
    slaBreaching: cap(buildSlaBreaching(input.overdueSubmissions, nowMs)),
    rising: cap(buildRising(input.recentApprovals)),
    newUnactivated: cap(buildNewUnactivated(input.newCreators, participantIds, nowMs)),
  };
}
```

- [ ] **Step 2: Run unit tests — all 8 must pass**

```bash
npx vitest run server/lib/radar.test.ts
```

Expected: `Tests 8 passed (8)`. Fix any failures before proceeding.

- [ ] **Step 3: Commit**

```bash
git add server/lib/radar.ts server/lib/radar.test.ts
git commit -m "feat: add shapeRadar pure shaper + unit tests (Radar Slice 2)"
```

---

## Task 3: Hono route

**Files:**
- Create: `server/routes/adminRadar.ts`

- [ ] **Step 1: Create `server/routes/adminRadar.ts`**

```typescript
// server/routes/adminRadar.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeRadar } from "../lib/radar.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const DAY_MS = 86_400_000;
const VALID_DAYS = [30] as const; // only 30d in Slice 2; extend to [7, 30, 60] later

export const adminRadarRoutes = new Hono<AdminEnv>();

// GET /admin/radar?workspace=<uuid?>&days=<30>
// Inherits the staff-auth middleware from adminRoutes — no extra guard.
adminRadarRoutes.get("/radar", async (c) => {
  const rawDays = c.req.query("days");
  const days = rawDays ? Number(rawDays) : 30;
  if (!(VALID_DAYS as readonly number[]).includes(days)) {
    return c.json({ error: "days must be 30", code: "validation" }, 422);
  }
  const ws = c.req.query("workspace") || "";

  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const cutoffIso = new Date(nowMs - days * DAY_MS).toISOString();
  // Due-soon threshold: deadlines within the next 2 calendar days
  const dueSoonIso = new Date(nowMs + 2 * DAY_MS).toISOString();

  const svc = serviceClient();

  // Five queries run in parallel — wall-clock ≈ slowest single query.
  // Queue A: all historical submissions with creator info (used to derive at-risk creators).
  // O(rows × creators) — fine at MVP scale; add a cutoff if the table exceeds ~5k rows.
  let allSubsQ = svc
    .from("mission_submissions")
    .select("creator_id, status, created_at, submitted_at, reviewed_at, creators!inner(display_name, phone)");
  if (ws) allSubsQ = allSubsQ.eq("workspace_id", ws);

  // Queue B: submissions whose review_deadline is overdue OR due within 2 days.
  let overdueQ = svc
    .from("mission_submissions")
    .select("id, creator_id, status, review_deadline, creators!inner(display_name), missions!inner(title)")
    .in("status", ["submitted", "under_review"])
    .not("review_deadline", "is", null)
    .lte("review_deadline", dueSoonIso)
    .order("review_deadline", { ascending: true });
  if (ws) overdueQ = overdueQ.eq("workspace_id", ws);

  // Queue C: approved submissions in last `days` days (quality signal for rising performers).
  let risingQ = svc
    .from("mission_submissions")
    .select("creator_id, quality_rating, creators!inner(display_name, level)")
    .eq("status", "approved")
    .gte("reviewed_at", cutoffIso);
  if (ws) risingQ = risingQ.eq("workspace_id", ws);

  // Queue D: creators registered in last `days` days.
  // Creators table has no workspace_id — creators are global; see spec §7 "Queue D workspace scope".
  const newCreatorsQ = svc
    .from("creators")
    .select("id, display_name, phone, created_at")
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false });

  // Queue D anti-join: all distinct creator_ids with any participation.
  // Anti-join done in JS (see shapeRadar) to avoid PostgREST NOT IN limitations.
  let participantsQ = svc.from("mission_submissions").select("creator_id");
  if (ws) participantsQ = participantsQ.eq("workspace_id", ws);

  const [allSubs, overdue, rising, newCreators, participants] = await Promise.all([
    allSubsQ,
    overdueQ,
    risingQ,
    newCreatorsQ,
    participantsQ,
  ]);

  for (const r of [allSubs, overdue, rising, newCreators, participants]) {
    if (r.error) return c.json({ error: r.error.message, code: "db_error" }, 500);
  }

  const radar = shapeRadar({
    now,
    days,
    allSubmissions: (allSubs.data ?? []) as Parameters<typeof shapeRadar>[0]["allSubmissions"],
    overdueSubmissions: (overdue.data ?? []) as Parameters<typeof shapeRadar>[0]["overdueSubmissions"],
    recentApprovals: (rising.data ?? []) as Parameters<typeof shapeRadar>[0]["recentApprovals"],
    newCreators: (newCreators.data ?? []) as Parameters<typeof shapeRadar>[0]["newCreators"],
    allParticipantIds: (participants.data ?? []).map((r: { creator_id: string }) => r.creator_id),
  });

  return c.json({ radar });
});
```

- [ ] **Step 2: Register the route in `server/routes/admin.ts`**

In `server/routes/admin.ts`, add the import at the top (after the existing imports):

```typescript
import { adminRadarRoutes } from "./adminRadar.js";
```

And add the route registration after `adminRoutes.route("/", adminInsightsRoutes);`:

```typescript
adminRoutes.route("/", adminRadarRoutes);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run type-check 2>&1 | grep -E "error|radar" | head -20
```

Expected: No errors mentioning `adminRadar` or `radar`. Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminRadar.ts server/routes/admin.ts
git commit -m "feat: add GET /api/admin/radar Hono route"
```

---

## Task 4: Integration tests

**Files:**
- Create: `server/test/radar.test.ts`
- Modify: `package.json` (append to `test:integration` list)

- [ ] **Step 1: Create `server/test/radar.test.ts`**

```typescript
// server/test/radar.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeStaff, makeCreator, seedSubmission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminReq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("admin radar", () => {
  let staff: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    staff = await makeStaff("radar-staff@test.local");
    // Seed a creator with a stale submission (so at-risk queue is non-empty)
    const creator = await makeCreator("radar-koc@test.local", 0);
    await seedSubmission(creator.userId, "approved", "test-radar-approved");
  });
  afterAll(cleanup);

  it("returns 422 for an unsupported days value", async () => {
    const res = await adminReq("/admin/radar?days=7", staff.jwt);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
  });

  it("requires staff auth (401 without a token)", async () => {
    const res = await app.request("/api/admin/radar?days=30");
    expect(res.status).toBe(401);
  });

  it("returns a well-formed radar payload for staff", async () => {
    const res = await adminReq("/admin/radar?days=30", staff.jwt);
    expect(res.status).toBe(200);
    const { radar } = await res.json();
    expect(radar.window.days).toBe(30);
    expect(typeof radar.window.from).toBe("string");
    expect(Array.isArray(radar.atRisk.items)).toBe(true);
    expect(typeof radar.atRisk.total).toBe("number");
    expect(Array.isArray(radar.slaBreaching.items)).toBe(true);
    expect(Array.isArray(radar.rising.items)).toBe(true);
    expect(Array.isArray(radar.newUnactivated.items)).toBe(true);
  });

  it("accepts a workspace filter without crashing", async () => {
    const res = await adminReq(
      "/admin/radar?days=30&workspace=00000000-0000-0000-0000-0000000000ff",
      staff.jwt,
    );
    expect(res.status).toBe(200);
    const { radar } = await res.json();
    expect(radar.window.days).toBe(30);
  });
});
```

- [ ] **Step 2: Append to `package.json` `test:integration` file list**

In `package.json`, find the `test:integration` script. It ends with `server/test/insights.test.ts"`. Append ` server/test/radar.test.ts` before the closing quote:

The line currently ends with:
```
...server/test/insights.test.ts",
```
Change to:
```
...server/test/insights.test.ts server/test/radar.test.ts",
```

- [ ] **Step 3: Verify integration tests skip correctly without a local stack**

```bash
npx vitest run server/test/radar.test.ts 2>&1 | tail -5
```

Expected: Tests are skipped (no `RUN_INTEGRATION=1` set and no local Supabase running), output shows `0 passed, 4 skipped` or similar. No compilation errors.

- [ ] **Step 4: Commit**

```bash
git add server/test/radar.test.ts package.json
git commit -m "test: add radar integration tests"
```

---

## Task 5: Client types + fetch function

**Files:**
- Modify: `src/lib/admin.ts`

- [ ] **Step 1: Add `adminKeys.radar` entry**

In `src/lib/admin.ts`, find the `adminKeys` object (around line 267):

```typescript
export const adminKeys = {
  applications: (workspace: string) => ["admin-applications", workspace] as const,
  submissions: (status: string, workspace: string) => ["admin-submissions", status, workspace] as const,
  engaged: (workspace: string) => ["admin-engaged", workspace] as const,
  insights: (workspace: string, windowDays: number) => ["admin-insights", workspace, windowDays] as const,
};
```

Add `radar` entry:

```typescript
export const adminKeys = {
  applications: (workspace: string) => ["admin-applications", workspace] as const,
  submissions: (status: string, workspace: string) => ["admin-submissions", status, workspace] as const,
  engaged: (workspace: string) => ["admin-engaged", workspace] as const,
  insights: (workspace: string, windowDays: number) => ["admin-insights", workspace, windowDays] as const,
  radar: (workspace: string, days: number) => ["admin-radar", workspace, days] as const,
};
```

- [ ] **Step 2: Add radar types and `fetchRadar` at the end of `src/lib/admin.ts`**

Append after the existing `fetchInsights` function (end of file):

```typescript
// ---- Radar dashboard (mirrors server/lib/radar.ts — keep in sync) ------------

export type RadarQueue<T> = { items: T[]; total: number };

export type RadarAtRiskRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  last_active: string;
  days_idle: number;
};

export type RadarOverdueRow = {
  submission_id: string;
  creator_id: string;
  display_name: string | null;
  mission_title: string;
  status: "submitted" | "under_review";
  review_deadline: string;
  urgency: "overdue" | "due_soon";
  hours_overdue: number;
};

export type RadarRisingRow = {
  creator_id: string;
  display_name: string | null;
  level: string;
  recent_approvals: number;
  avg_quality: number | null;
  score: number;
};

export type RadarNewCreatorRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;
  days_since_join: number;
};

export type Radar = {
  window: { days: number; from: string };
  atRisk: RadarQueue<RadarAtRiskRow>;
  slaBreaching: RadarQueue<RadarOverdueRow>;
  rising: RadarQueue<RadarRisingRow>;
  newUnactivated: RadarQueue<RadarNewCreatorRow>;
};

export function fetchRadar(workspace = "", days = 30) {
  const parts = [`days=${days}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ radar: Radar }>(`/admin/radar?${parts.join("&")}`);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run type-check 2>&1 | grep -i "error" | head -10
```

Expected: No errors. Fix any issues before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin.ts
git commit -m "feat: add adminKeys.radar, fetchRadar, and Radar types to admin.ts"
```

---

## Task 6: i18n keys + nav item

**Files:**
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/components/admin/adminNavItems.ts`
- Modify: `src/routes/admin.insights.tsx` (remove the locked radar teaser)

- [ ] **Step 1: Add i18n keys to `src/lib/i18n.dict.ts`**

The i18n dict has a `en` section and a `zh` section. Add to **both** (parity is enforced by the build; missing a key in either will fail `npm test`).

In the `en` section, after the `app.insights.*` block, add:

```typescript
"app.radar.heading": "Today's Radar",
"app.radar.atRiskTitle": "At-risk Creators",
"app.radar.atRiskEmpty": "No at-risk creators right now.",
"app.radar.slaTitle": "SLA Breaching",
"app.radar.slaEmpty": "All submissions within SLA.",
"app.radar.risingTitle": "Rising Performers",
"app.radar.risingEmpty": "No standout performers this period.",
"app.radar.newTitle": "New & Unactivated",
"app.radar.newEmpty": "No new inactive creators.",
"app.radar.moreItems": "+{n} more",
"app.radar.daysIdle": "{n}d idle",
"app.radar.hoursOverdue": "{n}h overdue",
"app.radar.dueSoon": "Due soon",
"app.radar.daysSinceJoin": "Joined {n}d ago",
"app.radar.loadError": "Couldn't load radar data.",
"app.admin.tabRadar": "Radar",
```

In the `zh` section, at the same relative position, add:

```typescript
"app.radar.heading": "今日雷達",
"app.radar.atRiskTitle": "有流失風險的創作者",
"app.radar.atRiskEmpty": "目前沒有流失風險的創作者。",
"app.radar.slaTitle": "審核逾期",
"app.radar.slaEmpty": "所有提交均在審核期限內。",
"app.radar.risingTitle": "上升中的創作者",
"app.radar.risingEmpty": "本期暫無突出創作者。",
"app.radar.newTitle": "新加入未啟動",
"app.radar.newEmpty": "沒有新加入但未啟動的創作者。",
"app.radar.moreItems": "+{n} 更多",
"app.radar.daysIdle": "閒置 {n} 天",
"app.radar.hoursOverdue": "逾期 {n} 小時",
"app.radar.dueSoon": "即將到期",
"app.radar.daysSinceJoin": "{n} 天前加入",
"app.radar.loadError": "無法載入雷達數據。",
"app.admin.tabRadar": "雷達",
```

- [ ] **Step 2: Add Radar nav item to `src/components/admin/adminNavItems.ts`**

In `adminNavItems.ts`, find the Analytics group:

```typescript
{
  labelKey: "app.admin.navGroupAnalytics",
  items: [{ to: "/admin/insights", labelKey: "app.admin.tabInsights", icon: BarChart3, exact: false }],
},
```

Add `Radar` to the import list at the top:

```typescript
import {
  BarChart3,
  Inbox,
  FileCheck,
  Users,
  UserCheck,
  Layers,
  Target,
  FileText,
  Radar,       // add this
  type LucideIcon,
} from "lucide-react";
```

Then add the Radar item to the Analytics group:

```typescript
{
  labelKey: "app.admin.navGroupAnalytics",
  items: [
    { to: "/admin/insights", labelKey: "app.admin.tabInsights", icon: BarChart3, exact: false },
    { to: "/admin/radar", labelKey: "app.admin.tabRadar", icon: Radar, exact: false },
  ],
},
```

- [ ] **Step 3: Remove the locked radar teaser from `src/routes/admin.insights.tsx`**

In `admin.insights.tsx`, find and remove the teaser block (currently around lines 211–214):

```tsx
{/* Slice 2 teaser — locked, matches the nav locked idiom */}
<div className="pastel-card p-5 opacity-60">
  <h2 className="font-heading text-base font-bold">{t("app.insights.radarTitle")}</h2>
  <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.insights.radarSoon")}</p>
</div>
```

Delete those 4 lines. The `app.insights.radarTitle` and `app.insights.radarSoon` keys in `i18n.dict.ts` can stay — they are still valid keys and removing them would risk failing the parity check if they're referenced elsewhere.

- [ ] **Step 4: Verify TypeScript compiles and i18n parity passes**

```bash
npm run type-check 2>&1 | grep -i "error" | head -10
npm test -- --reporter=verbose 2>&1 | grep -E "fail|i18n|parity" | head -10
```

Expected: No type errors, no i18n parity failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.dict.ts src/components/admin/adminNavItems.ts src/routes/admin.insights.tsx
git commit -m "feat: add radar i18n keys and nav item; remove insights teaser"
```

---

## Task 7: Radar page

**Files:**
- Create: `src/routes/admin.radar.tsx`

- [ ] **Step 1: Create `src/routes/admin.radar.tsx`**

```tsx
// src/routes/admin.radar.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AdminAuthError,
  adminKeys,
  fetchRadar,
  type Radar,
  type RadarAtRiskRow,
  type RadarOverdueRow,
  type RadarRisingRow,
  type RadarNewCreatorRow,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/radar")({ component: RadarPage });

// --- Sub-components -----------------------------------------------------------

function MoreIndicator({ queue }: { queue: { items: unknown[]; total: number } }) {
  const { t } = useI18n();
  const remaining = queue.total - queue.items.length;
  if (remaining <= 0) return null;
  return (
    <p className="mt-2 text-center font-mono text-xs text-[var(--color-soft-ink)]">
      {t("app.radar.moreItems", { n: remaining })}
    </p>
  );
}

function QueueCard({
  titleKey,
  emptyKey,
  total,
  children,
}: {
  titleKey: string;
  emptyKey: string;
  total: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="pastel-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-heading text-base font-bold">{t(titleKey)}</h2>
        <span className="rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-xs">
          {total}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t(emptyKey)}</p>
      ) : (
        children
      )}
    </div>
  );
}

function AtRiskList({ queue }: { queue: Radar["atRisk"] }) {
  const { t } = useI18n();
  return (
    <QueueCard titleKey="app.radar.atRiskTitle" emptyKey="app.radar.atRiskEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarAtRiskRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold">{row.display_name ?? row.phone ?? row.creator_id}</p>
            </div>
            <span className="font-mono text-xs text-[var(--color-soft-ink)]">
              {t("app.radar.daysIdle", { n: row.days_idle })}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function SlaList({ queue }: { queue: Radar["slaBreaching"] }) {
  const { t } = useI18n();
  return (
    <QueueCard titleKey="app.radar.slaTitle" emptyKey="app.radar.slaEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarOverdueRow) => (
          <li key={row.submission_id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold">{row.display_name ?? row.creator_id}</p>
              <p className="text-xs text-[var(--color-soft-ink)]">{row.mission_title}</p>
            </div>
            <span
              className={`font-mono text-xs ${
                row.urgency === "overdue" ? "metric-badge metric-down" : "text-[var(--color-soft-ink)]"
              }`}
            >
              {row.urgency === "overdue"
                ? t("app.radar.hoursOverdue", { n: row.hours_overdue })
                : t("app.radar.dueSoon")}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function RisingList({ queue }: { queue: Radar["rising"] }) {
  return (
    <QueueCard titleKey="app.radar.risingTitle" emptyKey="app.radar.risingEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarRisingRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className={`level-pill level-pill-${row.level.toLowerCase()}`}>{row.level}</span>
              <p className="text-sm font-semibold">{row.display_name ?? row.creator_id}</p>
            </div>
            <span className="font-mono text-xs text-[var(--color-ink)]">
              {row.recent_approvals}✓ {row.avg_quality !== null ? `★${row.avg_quality}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function NewList({ queue }: { queue: Radar["newUnactivated"] }) {
  const { t } = useI18n();
  return (
    <QueueCard titleKey="app.radar.newTitle" emptyKey="app.radar.newEmpty" total={queue.total}>
      <ul className="divide-y divide-[var(--color-soft-ink)] divide-opacity-20 space-y-0">
        {queue.items.map((row: RadarNewCreatorRow) => (
          <li key={row.creator_id} className="flex items-center justify-between py-2">
            <p className="text-sm font-semibold">{row.display_name ?? row.phone ?? row.creator_id}</p>
            <span className="font-mono text-xs text-[var(--color-soft-ink)]">
              {t("app.radar.daysSinceJoin", { n: row.days_since_join })}
            </span>
          </li>
        ))}
      </ul>
      <MoreIndicator queue={queue} />
    </QueueCard>
  );
}

function RadarSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton-acid skeleton-card h-48" />
      ))}
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

function RadarPage() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();

  const q = useQuery({
    queryKey: adminKeys.radar(workspace, 30),
    queryFn: () => fetchRadar(workspace, 30),
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = q.data?.radar;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("app.radar.heading")}</h1>

      {!data ? (
        q.isError && !(q.error instanceof AdminAuthError) ? (
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.radar.loadError")}</p>
        ) : (
          <RadarSkeleton />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AtRiskList queue={data.atRisk} />
          <SlaList queue={data.slaBreaching} />
          <RisingList queue={data.rising} />
          <NewList queue={data.newUnactivated} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run `type-check` to trigger `tsr generate` and register the new route**

```bash
npm run type-check 2>&1 | grep -E "error|admin.radar" | head -20
```

Expected: No errors. The `routeTree.gen.ts` (gitignored) is regenerated and now includes `/admin/radar`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.radar.tsx
git commit -m "feat: add /admin/radar page (RadarPage)"
```

---

## Task 8: Route stub test

**Files:**
- Create: `src/routes/-admin.radar.test.tsx`

- [ ] **Step 1: Create `src/routes/-admin.radar.test.tsx`**

```tsx
// src/routes/-admin.radar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchRadar: vi.fn(), reportAuthError: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", () => ({
  fetchRadar: h.fetchRadar,
  adminKeys: { radar: (ws: string, d: number) => ["admin-radar", ws, d] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.radar";
import { AdminAuthError } from "@/lib/admin";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

const emptyRadar = {
  radar: {
    window: { days: 30, from: "2026-06-01T00:00:00.000Z" },
    atRisk: { items: [], total: 0 },
    slaBreaching: { items: [], total: 0 },
    rising: { items: [], total: 0 },
    newUnactivated: { items: [], total: 0 },
  },
};

const populatedRadar = {
  radar: {
    window: { days: 30, from: "2026-06-01T00:00:00.000Z" },
    atRisk: {
      items: [
        { creator_id: "c1", display_name: "Alice Lam", phone: null, last_active: "2026-05-01T00:00:00.000Z", days_idle: 60 },
      ],
      total: 1,
    },
    slaBreaching: { items: [], total: 0 },
    rising: { items: [], total: 0 },
    newUnactivated: { items: [], total: 0 },
  },
};

describe("admin radar page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("shows a loading skeleton before data resolves", () => {
    h.fetchRadar.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = r();
    expect(container.querySelector(".skeleton-acid")).not.toBeNull();
  });

  it("renders queue headings and a creator name when data resolves", async () => {
    h.fetchRadar.mockResolvedValue(populatedRadar);
    r();
    await waitFor(() => expect(screen.getByText("有流失風險的創作者")).toBeInTheDocument());
    expect(screen.getByText("Alice Lam")).toBeInTheDocument();
    // Empty queues show their empty messages
    expect(screen.getByText("審核逾期")).toBeInTheDocument();
  });

  it("reports auth errors through reportAuthError", async () => {
    h.fetchRadar.mockRejectedValue(new AdminAuthError("unauthorized"));
    r();
    await waitFor(() => expect(h.reportAuthError).toHaveBeenCalled());
  });

  it("shows load-error message on a non-auth error", async () => {
    h.fetchRadar.mockRejectedValue(new Error("network failure"));
    r();
    await waitFor(() => expect(screen.getByText("無法載入雷達數據。")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run unit tests — all must pass**

```bash
npx vitest run src/routes/-admin.radar.test.tsx
```

Expected: `Tests 4 passed (4)`. Fix any failures before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/routes/-admin.radar.test.tsx
git commit -m "test: add route stub test for /admin/radar page"
```

---

## Task 9: Full gate pass + PR

**Files:** No changes — verification only.

- [ ] **Step 1: Run the full unit + component test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass. If any fail, fix them before continuing.

- [ ] **Step 2: Run type-check + lint + build**

```bash
npm run type-check && npm run lint && npm run build
```

Expected: All three exit `0`. The build also runs `check:esm` — fix any missing `.js` extensions in `server/**` imports if it fails.

- [ ] **Step 3: (Optional, requires `.env.test.local`) Run integration tests**

```bash
export $(cat .env.test.local | xargs)
npm run test:integration 2>&1 | tail -15
```

Expected: Integration tests pass (including the 4 new radar tests). If no local stack is available, the radar suite auto-skips.

- [ ] **Step 4: Open PR**

```bash
git push -u origin feat/admin-radar
gh pr create \
  --title "feat: Slice 2 — At-risk & opportunity radar (/admin/radar)" \
  --body "$(cat <<'EOF'
## Summary
- Adds `/admin/radar` page with four operator queues computed on-read from existing tables
- Queue A: at-risk/churning creators (≥1 past participation, last activity >30d, no active row)
- Queue B: SLA-breaching submissions (review_deadline overdue or within 2 days)
- Queue C: rising performers (approved in last 30d, ranked by approvals × avg quality)
- Queue D: new/unactivated creators (registered last 30d, zero participations)
- Top-20 cap per queue with "+N more" indicator; four pastel-card panels in lg:grid-cols-2
- Pure `shapeRadar()` in `server/lib/radar.ts` (8 unit tests) + guarded Hono route + integration tests
- Removes the locked radar teaser from /insights; adds Radar to Analytics nav group
- NO migration, NO new env vars, NO write paths

## Test plan
- [ ] `npm test` — all unit + component tests pass
- [ ] `npm run type-check && npm run lint && npm run build`
- [ ] `npm run test:integration` (requires `.env.test.local`)
- [ ] Verify `/admin/radar` renders all four panels in the browser
- [ ] Verify `/admin/insights` no longer shows the radar teaser
- [ ] Verify Radar appears in the left sidebar under Analytics

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ All four queues implemented (at-risk, SLA, rising, new/unactivated)
- ✅ 30d window; 422 for other values
- ✅ Top-20 cap + total count ("+N more")
- ✅ Queue D anti-join in JS (avoids PostgREST NOT IN limitations; documented in code)
- ✅ Queue D workspace-scope caveat documented in comment
- ✅ SLA `due_soon` vs `overdue` classification + `hours_overdue` sign convention
- ✅ Rising performer score = `recent_approvals × (avg_quality ?? 3)`
- ✅ `now` injected into shaper (deterministic, no Date.now() inside)
- ✅ Auth error → `reportAuthError` (useEffect pattern, matching other admin pages)
- ✅ Non-auth error → load-error message (not infinite skeleton)
- ✅ i18n en + zh parity (16 keys added to both sections)
- ✅ Radar nav item added to Analytics group; teaser removed from insights page
- ✅ `.js` extensions on all server-side relative imports
- ✅ No double auth guard (inherits from `adminRoutes`)
- ✅ Integration test file appended to `package.json` explicit list
- ✅ `npm run type-check` required after adding `admin.radar.tsx` (tsr generate)

**Type consistency:**
- `RadarQueue<T>` used in both `server/lib/radar.ts` and `src/lib/admin.ts`
- `RadarAtRiskRow`, `RadarOverdueRow`, `RadarRisingRow`, `RadarNewCreatorRow` match between shaper output types, client types, and page component props
- `shapeRadar(input: ShapeRadarInput): Radar` — `Radar` is the same type returned by `fetchRadar`
- `adminKeys.radar(workspace, days)` matches the key used in `useQuery` in `RadarPage`
