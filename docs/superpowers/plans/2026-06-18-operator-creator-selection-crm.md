# Operator Creator Selection CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CRM-lite operator workflow for reviewing creators, adding internal notes, governing mission eligibility, and shortlisting or inviting creators for missions while preserving public passport privacy.

**Architecture:** Add operator-only Supabase tables for review state, notes, mission shortlists, and audit events, then expose them through the existing admin-secret Hono route group. Keep operator CRM composition server-side in focused TypeScript modules, and layer dense TanStack Router pages over the existing `/operator` admin bridge.

**Tech Stack:** Supabase Postgres/RLS, Hono, TypeScript, Vitest, React 19, TanStack Query, TanStack Router, Vite, lucide-react.

---

## Scope Check

This is one implementation plan because the schema, admin API, queue UI, detail UI, and mission shortlist rules all depend on one shared operator review contract. The plan does not add social ownership verification, creator-facing restrictions, messaging, contracts, payments, or multi-operator assignment.

## Global Decisions

- V1 operator identity is a string derived from admin headers:
  - `x-operator-id` if present and non-empty.
  - `admin-secret` when the header is absent.
  - `x-operator-label` if present and non-empty.
  - `Admin operator` when the label header is absent.
- Missing `creator_review_statuses` rows are projected as `{ status: "needs_review", riskLevel: "unknown" }`.
- Public and creator-facing routes do not read the new operator CRM tables.
- Flagged creators are visible in the global review queue, hidden by default when a queue is opened with `mission_id`, and visible there only when `status=flagged` is requested.
- Shortlisting a flagged creator requires a non-empty note.
- Moving a flagged creator to `invited` returns `409` until the creator is moved out of `flagged`.
- API responses use snake_case for nested database-like fields already used by admin routes (`creator_review`, `mission_shortlist`) and camelCase inside new frontend-only types.

## File Structure

- Create `supabase/migrations/0013_operator_creator_selection_crm.sql`: operator CRM tables, constraints, indexes, RLS, service-role grants, updated-at trigger.
- Modify `server/test/helpers.ts`: delete new test rows during cleanup and expose small seed helpers for CRM tests.
- Create `server/test/operator-crm-schema.test.ts`: integration coverage for operator-only RLS and service-role write access.
- Create `server/lib/operatorCrm/types.ts`: shared status unions, constants, request/response types, and projection types.
- Create `server/lib/operatorCrm/serializers.ts`: pure helpers for default review status, enum parsing, social summary projection, and creator row composition.
- Create `server/lib/operatorCrm/serializers.test.ts`: unit coverage for pure CRM helpers.
- Create `server/lib/operatorCrm/repo.ts`: service-role Supabase data access for review queue, creator detail, notes, audit, and shortlists.
- Create `server/routes/adminOperatorCrm.ts`: admin-secret protected CRM endpoints mounted by `server/routes/admin.ts`.
- Modify `server/routes/admin.ts`: mount CRM routes, enrich existing application and submission responses with `creator_review` and `mission_shortlist`.
- Create `server/test/operator-crm.test.ts`: admin API integration coverage for queue filters, details, review actions, notes, shortlist transitions, and mission read endpoints.
- Modify `server/test/admin.test.ts`: assert existing admin application and submission payloads include review and shortlist metadata.
- Modify `server/test/public-passport.test.ts`: assert public payloads do not expose operator review, notes, audit, shortlist, social handles, counts, engagement, post summaries, or unselected external avatar URLs.
- Modify `package.json`: include `server/test/operator-crm-schema.test.ts` and `server/test/operator-crm.test.ts` in `test:integration`.
- Modify `src/lib/admin.ts`: add CRM admin types and fetch helpers while preserving shared-secret behavior.
- Create `src/components/operator/OperatorAuthGate.tsx`: shared admin-secret prompt and stale-secret reset shell.
- Create `src/components/operator/OperatorBadges.tsx`: review, risk, social sync, and shortlist badges.
- Create `src/components/operator/ReviewActionPanel.tsx`: approve, flag, or return to review with summary and optional note.
- Create `src/components/operator/MissionShortlistPanel.tsx`: mission-level shortlisted/invited creator table and status controls.
- Modify `src/routes/operator.tsx`: keep the existing operator home, add navigation to creator queue, and show review/shortlist metadata on applications.
- Create `src/routes/operator.creators.tsx`: dense review queue with filters, sorting controls, quick review actions, and mission shortlist controls when `mission_id` is present.
- Create `src/routes/operator.creators.$creatorId.tsx`: creator detail with profile/media, trust, social, mission history, review state, notes, shortlists, and audit timeline.
- Create `src/routes/operator.missions.$missionId.tsx`: mission selection page with shortlist panel and mission-scoped creator queue.
- Modify `src/routes/-operator.test.tsx`: update current operator home tests for the auth gate and enriched application rows.
- Create `src/routes/-operator.creators.test.tsx`: review queue UI tests.
- Create `src/routes/-operator.creators.$creatorId.test.tsx`: creator detail UI tests.
- Create `src/routes/-operator.missions.$missionId.test.tsx`: mission shortlist page UI tests.

---

### Task 1: Schema, RLS, And Test Helpers

**Files:**
- Create: `supabase/migrations/0013_operator_creator_selection_crm.sql`
- Modify: `server/test/helpers.ts`
- Test: `server/test/operator-crm-schema.test.ts`

**Interfaces:**
- Tables: `creator_review_statuses`, `creator_review_notes`, `mission_shortlists`, `operator_audit_events`
- Statuses:
  - Review: `needs_review`, `approved`, `flagged`
  - Risk: `low`, `medium`, `high`, `unknown`
  - Note category: `quality`, `brand_safety`, `fit`, `social`, `other`
  - Shortlist status: `shortlisted`, `invited`, `dismissed`, `accepted`, `declined`
  - Shortlist source: `manual`, `applicant`, `match`, `review_queue`

- [ ] **Step 1: Write the failing schema/RLS integration test**

Create `server/test/operator-crm-schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("operator CRM schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets the service role write review, note, shortlist, and audit rows", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator("operator-crm-schema@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-schema" });

    const review = await svc
      .from("creator_review_statuses")
      .insert({
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        status: "approved",
        risk_level: "low",
        summary: "Reliable creator for beauty missions.",
        reviewed_by: "schema-test",
      })
      .select("creator_id, status, risk_level")
      .single();
    expect(review.error).toBeNull();
    expect(review.data).toMatchObject({ creator_id: creator.userId, status: "approved", risk_level: "low" });

    const note = await svc.from("creator_review_notes").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      category: "quality",
      body: "Strong recent samples.",
    });
    expect(note.error).toBeNull();

    const shortlist = await svc
      .from("mission_shortlists")
      .insert({
        mission_id: mission.id,
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        status: "shortlisted",
        source: "manual",
        notes: "Good fit for campaign.",
        created_by: "schema-test",
        updated_by: "schema-test",
      })
      .select("mission_id, creator_id, status")
      .single();
    expect(shortlist.error).toBeNull();
    expect(shortlist.data).toMatchObject({ mission_id: mission.id, creator_id: creator.userId, status: "shortlisted" });

    const audit = await svc.from("operator_audit_events").insert({
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      actor_label: "Schema Test",
      event_type: "creator_review.updated",
      target_type: "creator",
      target_id: creator.userId,
      creator_id: creator.userId,
      metadata: { status: "approved" },
    });
    expect(audit.error).toBeNull();
  });

  it("denies authenticated creators direct read access to operator CRM tables", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator("operator-crm-hidden@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-hidden" });

    await svc.from("creator_review_statuses").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "flagged",
      risk_level: "high",
      summary: "Internal brand safety concern.",
      reviewed_by: "schema-test",
    });
    await svc.from("creator_review_notes").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      category: "brand_safety",
      body: "Internal note must stay private.",
    });
    await svc.from("mission_shortlists").insert({
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "shortlisted",
      source: "manual",
      notes: "Internal shortlist note.",
      created_by: "schema-test",
      updated_by: "schema-test",
    });
    await svc.from("operator_audit_events").insert({
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      actor_label: "Schema Test",
      event_type: "creator_note.created",
      target_type: "creator",
      target_id: creator.userId,
      creator_id: creator.userId,
      metadata: { category: "brand_safety" },
    });

    const user = userForJwt(creator.jwt);
    for (const table of ["creator_review_statuses", "creator_review_notes", "mission_shortlists", "operator_audit_events"]) {
      const { data, error } = await user.from(table).select("*");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("enforces one shortlist row per mission and creator", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator("operator-crm-unique@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-unique" });
    const row = {
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "shortlisted",
      source: "manual",
      created_by: "schema-test",
      updated_by: "schema-test",
    };

    const first = await svc.from("mission_shortlists").insert(row);
    expect(first.error).toBeNull();

    const second = await svc.from("mission_shortlists").insert(row);
    expect(second.error?.code).toBe("23505");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm-schema.test.ts
```

Expected: FAIL with `relation "public.creator_review_statuses" does not exist`.

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/0013_operator_creator_selection_crm.sql`:

```sql
-- Operator Creator Selection CRM: internal review, notes, mission shortlists,
-- and append-only audit events. These tables are service-role only in v1.

create table public.creator_review_statuses (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'needs_review'
    check (status in ('needs_review', 'approved', 'flagged')),
  risk_level text not null default 'unknown'
    check (risk_level in ('low', 'medium', 'high', 'unknown')),
  summary text,
  reviewed_by text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, creator_id)
);

create index creator_review_statuses_status_idx
  on public.creator_review_statuses (workspace_id, status, risk_level);

create table public.creator_review_notes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  operator_id text not null,
  category text not null
    check (category in ('quality', 'brand_safety', 'fit', 'social', 'other')),
  body text not null,
  created_at timestamptz not null default now()
);

create index creator_review_notes_creator_idx
  on public.creator_review_notes (workspace_id, creator_id, created_at desc);

create table public.mission_shortlists (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'shortlisted'
    check (status in ('shortlisted', 'invited', 'dismissed', 'accepted', 'declined')),
  source text not null default 'manual'
    check (source in ('manual', 'applicant', 'match', 'review_queue')),
  notes text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, creator_id)
);

create index mission_shortlists_mission_idx
  on public.mission_shortlists (workspace_id, mission_id, status);
create index mission_shortlists_creator_idx
  on public.mission_shortlists (workspace_id, creator_id, updated_at desc);

create table public.operator_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  operator_id text not null,
  actor_label text not null,
  event_type text not null,
  target_type text not null,
  target_id text not null,
  creator_id uuid references public.creators(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index operator_audit_events_creator_idx
  on public.operator_audit_events (workspace_id, creator_id, created_at desc);
create index operator_audit_events_mission_idx
  on public.operator_audit_events (workspace_id, mission_id, created_at desc);

create or replace function private.touch_operator_crm_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger creator_review_statuses_set_updated_at
  before update on public.creator_review_statuses
  for each row execute function private.touch_operator_crm_updated_at();

create trigger mission_shortlists_set_updated_at
  before update on public.mission_shortlists
  for each row execute function private.touch_operator_crm_updated_at();

alter table public.creator_review_statuses enable row level security;
alter table public.creator_review_notes enable row level security;
alter table public.mission_shortlists enable row level security;
alter table public.operator_audit_events enable row level security;

grant all on public.creator_review_statuses to service_role;
grant all on public.creator_review_notes to service_role;
grant all on public.mission_shortlists to service_role;
grant all on public.operator_audit_events to service_role;
```

- [ ] **Step 4: Clean CRM rows in integration helper cleanup**

Modify `server/test/helpers.ts` inside `cleanup()`:

```ts
  if (ids.length) {
    await service().from("operator_audit_events").delete().in("creator_id", ids);
    await service().from("creator_review_notes").delete().in("creator_id", ids);
    await service().from("creator_review_statuses").delete().in("creator_id", ids);
    await service().from("mission_shortlists").delete().in("creator_id", ids);
    await service().from("creator_public_passports").delete().in("creator_id", ids);
    await service().from("creator_social_accounts").delete().in("creator_id", ids);
  }
```

Also delete CRM rows for test missions before deleting each mission:

```ts
    await service().from("operator_audit_events").delete().eq("mission_id", m.id);
    await service().from("mission_shortlists").delete().eq("mission_id", m.id);
```

- [ ] **Step 5: Run the schema/RLS test to verify it passes**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add supabase/migrations/0013_operator_creator_selection_crm.sql server/test/helpers.ts server/test/operator-crm-schema.test.ts
git commit -m "feat: add operator crm schema"
```

---

### Task 2: Operator CRM Types And Pure Serializers

**Files:**
- Create: `server/lib/operatorCrm/types.ts`
- Create: `server/lib/operatorCrm/serializers.ts`
- Test: `server/lib/operatorCrm/serializers.test.ts`

**Interfaces:**
- `DEFAULT_REVIEW_STATUS`
- `parseReviewStatus(value: unknown): CreatorReviewStatus | null`
- `parseRiskLevel(value: unknown): CreatorRiskLevel | null`
- `parseNoteCategory(value: unknown): CreatorReviewNoteCategory | null`
- `parseShortlistStatus(value: unknown): MissionShortlistStatus | null`
- `parseShortlistSource(value: unknown): MissionShortlistSource | null`
- `projectReviewStatus(row)`
- `summarizeSocialAccounts(accounts)`
- `lastActivityAt(values)`

- [ ] **Step 1: Write the failing serializer tests**

Create `server/lib/operatorCrm/serializers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_STATUS,
  lastActivityAt,
  parseReviewStatus,
  parseRiskLevel,
  projectReviewStatus,
  summarizeSocialAccounts,
} from "./serializers";

describe("operator CRM serializers", () => {
  it("projects a missing review row as needs_review with unknown risk", () => {
    expect(projectReviewStatus(null)).toEqual(DEFAULT_REVIEW_STATUS);
  });

  it("projects an existing review row into the operator response shape", () => {
    expect(
      projectReviewStatus({
        status: "approved",
        risk_level: "low",
        summary: "Consistent creator",
        reviewed_by: "op-1",
        last_reviewed_at: "2026-06-18T01:00:00.000Z",
        updated_at: "2026-06-18T01:00:00.000Z",
      }),
    ).toEqual({
      status: "approved",
      riskLevel: "low",
      summary: "Consistent creator",
      reviewedBy: "op-1",
      lastReviewedAt: "2026-06-18T01:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
    });
  });

  it("rejects unknown enum values", () => {
    expect(parseReviewStatus("flagged")).toBe("flagged");
    expect(parseReviewStatus("paused")).toBeNull();
    expect(parseRiskLevel("high")).toBe("high");
    expect(parseRiskLevel("severe")).toBeNull();
  });

  it("summarizes API-synced social accounts without ownership claims", () => {
    expect(
      summarizeSocialAccounts([
        {
          platform: "instagram",
          sync_status: "synced",
          follower_count: 45000,
          engagement_rate: 3.2,
          api_synced_at: "2026-06-18T02:00:00.000Z",
        },
        {
          platform: "threads",
          sync_status: "pending",
          follower_count: null,
          engagement_rate: null,
          api_synced_at: null,
        },
      ]),
    ).toEqual({
      platforms: ["instagram", "threads"],
      syncStatus: "synced",
      followerCount: 45000,
      engagementRate: 3.2,
      apiSyncedAt: "2026-06-18T02:00:00.000Z",
      label: "API-synced",
      ownershipLabel: "Ownership not verified",
    });
  });

  it("chooses the newest non-null activity timestamp", () => {
    expect(
      lastActivityAt([
        "2026-06-17T02:00:00.000Z",
        null,
        "2026-06-18T02:00:00.000Z",
        "2026-06-16T02:00:00.000Z",
      ]),
    ).toBe("2026-06-18T02:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the serializer tests to verify they fail**

Run:

```bash
vitest run server/lib/operatorCrm/serializers.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Add shared CRM types**

Create `server/lib/operatorCrm/types.ts`:

```ts
export const REVIEW_STATUSES = ["needs_review", "approved", "flagged"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "unknown"] as const;
export const NOTE_CATEGORIES = ["quality", "brand_safety", "fit", "social", "other"] as const;
export const SHORTLIST_STATUSES = ["shortlisted", "invited", "dismissed", "accepted", "declined"] as const;
export const SHORTLIST_SOURCES = ["manual", "applicant", "match", "review_queue"] as const;

export type CreatorReviewStatus = (typeof REVIEW_STATUSES)[number];
export type CreatorRiskLevel = (typeof RISK_LEVELS)[number];
export type CreatorReviewNoteCategory = (typeof NOTE_CATEGORIES)[number];
export type MissionShortlistStatus = (typeof SHORTLIST_STATUSES)[number];
export type MissionShortlistSource = (typeof SHORTLIST_SOURCES)[number];

export type OperatorContext = {
  operatorId: string;
  actorLabel: string;
};

export type ReviewProjection = {
  status: CreatorReviewStatus;
  riskLevel: CreatorRiskLevel;
  summary: string | null;
  reviewedBy: string | null;
  lastReviewedAt: string | null;
  updatedAt: string | null;
};

export type SocialSummaryProjection = {
  platforms: string[];
  syncStatus: "pending" | "synced" | "stale" | "failed" | "rate_limited" | null;
  followerCount: number | null;
  engagementRate: number | null;
  apiSyncedAt: string | null;
  label: "API-synced" | "Not synced";
  ownershipLabel: "Ownership not verified";
};

export type CreatorQueueFilters = {
  status?: CreatorReviewStatus;
  riskLevel?: CreatorRiskLevel;
  missionId?: string;
  q?: string;
  page: number;
  pageSize: number;
  sort: "last_activity" | "trust_score" | "level" | "social_freshness";
};

export type CreatorReviewRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level: string;
  categories: string[];
  scores: Record<string, number | null>;
  social: SocialSummaryProjection;
  review: ReviewProjection;
  shortlist: {
    status: MissionShortlistStatus;
    source: MissionShortlistSource;
    notes: string | null;
    updatedAt: string;
  } | null;
  lastActivityAt: string | null;
};
```

- [ ] **Step 4: Add serializer helpers**

Create `server/lib/operatorCrm/serializers.ts`:

```ts
import {
  NOTE_CATEGORIES,
  REVIEW_STATUSES,
  RISK_LEVELS,
  SHORTLIST_SOURCES,
  SHORTLIST_STATUSES,
  type CreatorReviewNoteCategory,
  type CreatorReviewStatus,
  type CreatorRiskLevel,
  type MissionShortlistSource,
  type MissionShortlistStatus,
  type ReviewProjection,
  type SocialSummaryProjection,
} from "./types.js";

export const DEFAULT_REVIEW_STATUS: ReviewProjection = {
  status: "needs_review",
  riskLevel: "unknown",
  summary: null,
  reviewedBy: null,
  lastReviewedAt: null,
  updatedAt: null,
};

function enumValue<const T extends readonly string[]>(values: T, value: unknown): T[number] | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

export function parseReviewStatus(value: unknown): CreatorReviewStatus | null {
  return enumValue(REVIEW_STATUSES, value);
}

export function parseRiskLevel(value: unknown): CreatorRiskLevel | null {
  return enumValue(RISK_LEVELS, value);
}

export function parseNoteCategory(value: unknown): CreatorReviewNoteCategory | null {
  return enumValue(NOTE_CATEGORIES, value);
}

export function parseShortlistStatus(value: unknown): MissionShortlistStatus | null {
  return enumValue(SHORTLIST_STATUSES, value);
}

export function parseShortlistSource(value: unknown): MissionShortlistSource | null {
  return enumValue(SHORTLIST_SOURCES, value);
}

export function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function projectReviewStatus(row: {
  status: string;
  risk_level: string;
  summary: string | null;
  reviewed_by: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
} | null): ReviewProjection {
  if (!row) return DEFAULT_REVIEW_STATUS;
  return {
    status: parseReviewStatus(row.status) ?? "needs_review",
    riskLevel: parseRiskLevel(row.risk_level) ?? "unknown",
    summary: row.summary ?? null,
    reviewedBy: row.reviewed_by ?? null,
    lastReviewedAt: row.last_reviewed_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function summarizeSocialAccounts(
  accounts: Array<{
    platform: string;
    sync_status: string;
    follower_count: number | null;
    engagement_rate: number | null;
    api_synced_at: string | null;
  }>,
): SocialSummaryProjection {
  const synced = accounts
    .filter((account) => account.sync_status === "synced")
    .sort((a, b) => (b.api_synced_at ?? "").localeCompare(a.api_synced_at ?? ""));
  const best = synced[0] ?? null;
  const status = best ? "synced" : accounts[0]?.sync_status ?? null;

  return {
    platforms: accounts.map((account) => account.platform),
    syncStatus: status as SocialSummaryProjection["syncStatus"],
    followerCount: best?.follower_count ?? null,
    engagementRate: best?.engagement_rate ?? null,
    apiSyncedAt: best?.api_synced_at ?? null,
    label: best ? "API-synced" : "Not synced",
    ownershipLabel: "Ownership not verified",
  };
}

export function lastActivityAt(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter((value): value is string => Boolean(value)).sort((a, b) => b.localeCompare(a));
  return sorted[0] ?? null;
}
```

- [ ] **Step 5: Run serializer tests to verify they pass**

Run:

```bash
vitest run server/lib/operatorCrm/serializers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/lib/operatorCrm/types.ts server/lib/operatorCrm/serializers.ts server/lib/operatorCrm/serializers.test.ts
git commit -m "feat: add operator crm serializers"
```

---

### Task 3: Operator CRM Repository And Admin API

**Files:**
- Create: `server/lib/operatorCrm/repo.ts`
- Create: `server/routes/adminOperatorCrm.ts`
- Modify: `server/routes/admin.ts`
- Test: `server/test/operator-crm.test.ts`

**Endpoints:**
- `GET /api/admin/creators/review`
- `GET /api/admin/creators/:id`
- `POST /api/admin/creators/:id/review`
- `POST /api/admin/creators/:id/notes`
- `GET /api/admin/missions/:missionId/shortlist`
- `POST /api/admin/missions/:missionId/shortlist`
- `PATCH /api/admin/missions/:missionId/shortlist/:creatorId`

- [ ] **Step 1: Write failing admin API tests**

Create `server/test/operator-crm.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminreq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "x-operator-id": "crm-test",
      "x-operator-label": "CRM Test",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("operator CRM admin API", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lists creators with default needs_review status when no review row exists", async () => {
    const creator = await makeCreator("operator-crm-queue@test.local");
    const res = await adminreq("/admin/creators/review?q=operator-crm-queue");
    expect(res.status).toBe(200);

    const body = await res.json();
    const row = body.creators.find((item: { id: string }) => item.id === creator.userId);
    expect(row.review).toMatchObject({ status: "needs_review", riskLevel: "unknown" });
    expect(row.social.ownershipLabel).toBe("Ownership not verified");
  });

  it("updates review status, creates an optional note, and writes audit events", async () => {
    const creator = await makeCreator("operator-crm-review@test.local");
    const review = await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({
        status: "approved",
        risk_level: "low",
        summary: "Strong fit for skincare missions.",
        note: "Prior delivery was on brief.",
      }),
    });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      review: { status: "approved", riskLevel: "low", summary: "Strong fit for skincare missions." },
    });

    const svc = serviceForTests();
    const notes = await svc.from("creator_review_notes").select("body, category").eq("creator_id", creator.userId);
    expect(notes.data).toEqual([{ body: "Prior delivery was on brief.", category: "other" }]);

    const audits = await svc
      .from("operator_audit_events")
      .select("event_type, operator_id, actor_label")
      .eq("creator_id", creator.userId)
      .order("created_at");
    expect(audits.data?.map((event) => event.event_type)).toEqual(["creator_review.updated", "creator_note.created"]);
    expect(audits.data?.[0]).toMatchObject({ operator_id: "crm-test", actor_label: "CRM Test" });
  });

  it("returns creator detail with notes, shortlists, social summary, mission history, and audit timeline", async () => {
    const creator = await makeCreator("operator-crm-detail@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-detail" });
    const svc = serviceForTests();
    await svc.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "detailcreator",
      sync_status: "synced",
      follower_count: 22000,
      engagement_rate: 4.1,
      api_synced_at: "2026-06-18T03:00:00.000Z",
    });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved", risk_level: "low", summary: "Ready for mission selection." }),
    });
    await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Add to launch list." }),
    });

    const res = await adminreq(`/admin/creators/${creator.userId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creator.id).toBe(creator.userId);
    expect(body.social.followerCount).toBe(22000);
    expect(body.review.status).toBe("approved");
    expect(body.shortlists[0]).toMatchObject({ mission_id: mission.id, status: "shortlisted" });
    expect(body.audit.some((event: { event_type: string }) => event.event_type === "mission_shortlist.created")).toBe(true);
  });

  it("requires a note when shortlisting a flagged creator", async () => {
    const creator = await makeCreator("operator-crm-flag-note@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-flag-note" });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "flagged", risk_level: "high", summary: "Needs senior review." }),
    });

    const res = await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("flagged_note_required");
  });

  it("blocks invited status for a flagged creator", async () => {
    const creator = await makeCreator("operator-crm-flag-invite@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-flag-invite" });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "flagged", risk_level: "high", summary: "Needs senior review." }),
    });

    const created = await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Escalated exception." }),
    });
    expect(created.status).toBe(200);

    const invite = await adminreq(`/admin/missions/${mission.id}/shortlist/${creator.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invited", notes: "Invite after exception." }),
    });
    expect(invite.status).toBe(409);
    expect((await invite.json()).code).toBe("flagged_invite_blocked");
  });

  it("hides flagged creators by default in a mission-scoped queue", async () => {
    const approved = await makeCreator("operator-crm-approved@test.local");
    const flagged = await makeCreator("operator-crm-hidden-flagged@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-mission-filter" });
    await adminreq(`/admin/creators/${approved.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved", risk_level: "low", summary: "Ready." }),
    });
    await adminreq(`/admin/creators/${flagged.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "flagged", risk_level: "high", summary: "Hidden by default." }),
    });

    const res = await adminreq(`/admin/creators/review?mission_id=${mission.id}`);
    expect(res.status).toBe(200);
    const ids = (await res.json()).creators.map((row: { id: string }) => row.id);
    expect(ids).toContain(approved.userId);
    expect(ids).not.toContain(flagged.userId);

    const flaggedRes = await adminreq(`/admin/creators/review?mission_id=${mission.id}&status=flagged`);
    expect(flaggedRes.status).toBe(200);
    const flaggedIds = (await flaggedRes.json()).creators.map((row: { id: string }) => row.id);
    expect(flaggedIds).toContain(flagged.userId);
  });
});
```

- [ ] **Step 2: Run admin API tests to verify they fail**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm.test.ts
```

Expected: FAIL with `404` for `/api/admin/creators/review`.

- [ ] **Step 3: Create repository data-access functions**

Create `server/lib/operatorCrm/repo.ts` with these exported functions:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lastActivityAt,
  nonEmptyText,
  projectReviewStatus,
  summarizeSocialAccounts,
} from "./serializers.js";
import type {
  CreatorQueueFilters,
  CreatorReviewNoteCategory,
  CreatorReviewRow,
  CreatorReviewStatus,
  CreatorRiskLevel,
  MissionShortlistSource,
  MissionShortlistStatus,
  OperatorContext,
} from "./types.js";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export async function listCreatorReviewQueue(
  supabase: SupabaseClient,
  filters: CreatorQueueFilters,
): Promise<{ creators: CreatorReviewRow[]; page: number; pageSize: number; total: number }> {
  // Query creators first, then compose review/social/shortlist state in batches.
  // Use service-role Supabase and return only normalized operator fields.
}

export async function getCreatorOperatorDetail(supabase: SupabaseClient, creatorId: string) {
  // Return creator basics, selected avatar, self-reported handles, scores, social summary,
  // mission history, review status, notes, shortlists, and audit rows.
}

export async function updateCreatorReview(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    status: CreatorReviewStatus;
    riskLevel: CreatorRiskLevel;
    summary: string | null;
    note: string | null;
    context: OperatorContext;
  },
) {
  // Verify the creator exists, upsert the review row, append optional note,
  // write audit events, and return the projected review.
}

export async function addCreatorReviewNote(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    category: CreatorReviewNoteCategory;
    body: string;
    context: OperatorContext;
  },
) {
  // Verify the creator exists, insert an append-only note, write audit, and return the note.
}

export async function listMissionShortlist(supabase: SupabaseClient, missionId: string) {
  // Verify the mission exists and return mission basics plus current shortlist rows.
}

export async function upsertMissionShortlist(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    source: MissionShortlistSource;
    notes: string | null;
    context: OperatorContext;
  },
) {
  // Verify mission and creator, enforce flagged note rule, upsert status=shortlisted,
  // write audit, and return the shortlist row.
}

export async function updateMissionShortlistStatus(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    status: MissionShortlistStatus;
    notes: string | null;
    context: OperatorContext;
  },
) {
  // Verify row exists, block status=invited for flagged creators, update row,
  // write audit, and return the shortlist row.
}
```

Implement the repository functions with batched Supabase queries using these projections:

```ts
const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
const SOCIAL_PROJECTION = "creator_id, platform, handle, sync_status, follower_count, engagement_rate, api_synced_at, external_avatar_url, bio, post_count, following_count, avg_likes, avg_comments, posting_frequency, freshness_score, content_themes";
const SHORTLIST_PROJECTION = "mission_id, creator_id, workspace_id, status, source, notes, created_by, updated_by, created_at, updated_at, missions(id, slug, title)";
const NOTE_PROJECTION = "id, creator_id, workspace_id, operator_id, category, body, created_at";
const AUDIT_PROJECTION = "id, workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, mission_id, metadata, created_at";
```

Use these thrown errors so routes can map stable HTTP codes:

```ts
export class OperatorCrmError extends Error {
  constructor(
    public code:
      | "creator_not_found"
      | "mission_not_found"
      | "shortlist_not_found"
      | "flagged_note_required"
      | "flagged_invite_blocked"
      | "db_error",
    message = code,
  ) {
    super(message);
  }
}
```

- [ ] **Step 4: Create CRM admin routes**

Create `server/routes/adminOperatorCrm.ts`:

```ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import {
  addCreatorReviewNote,
  getCreatorOperatorDetail,
  listCreatorReviewQueue,
  listMissionShortlist,
  OperatorCrmError,
  updateCreatorReview,
  updateMissionShortlistStatus,
  upsertMissionShortlist,
} from "../lib/operatorCrm/repo.js";
import {
  nonEmptyText,
  parseNoteCategory,
  parseReviewStatus,
  parseRiskLevel,
  parseShortlistSource,
  parseShortlistStatus,
} from "../lib/operatorCrm/serializers.js";

export const adminOperatorCrmRoutes = new Hono();

function operatorContext(c: { req: { header(name: string): string | undefined } }) {
  return {
    operatorId: c.req.header("x-operator-id")?.trim() || "admin-secret",
    actorLabel: c.req.header("x-operator-label")?.trim() || "Admin operator",
  };
}

function crmError(c: { json: (body: unknown, status?: number) => Response }, error: unknown) {
  if (!(error instanceof OperatorCrmError)) return c.json({ error: "Database error", code: "db_error" }, 500);
  const status =
    error.code === "creator_not_found" || error.code === "mission_not_found" || error.code === "shortlist_not_found"
      ? 404
      : error.code === "flagged_invite_blocked"
        ? 409
        : 400;
  return c.json({ error: error.message, code: error.code }, status);
}

adminOperatorCrmRoutes.get("/creators/review", async (c) => {
  const page = Math.max(Number(c.req.query("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("page_size") ?? 25), 1), 100);
  const status = c.req.query("status") ? parseReviewStatus(c.req.query("status")) : undefined;
  const riskLevel = c.req.query("risk_level") ? parseRiskLevel(c.req.query("risk_level")) : undefined;
  if (c.req.query("status") && !status) return c.json({ error: "Invalid review status", code: "bad_review_status" }, 400);
  if (c.req.query("risk_level") && !riskLevel) return c.json({ error: "Invalid risk level", code: "bad_risk_level" }, 400);

  try {
    return c.json(
      await listCreatorReviewQueue(serviceClient(), {
        status,
        riskLevel,
        missionId: nonEmptyText(c.req.query("mission_id")),
        q: nonEmptyText(c.req.query("q")) ?? undefined,
        page,
        pageSize,
        sort: (c.req.query("sort") as "last_activity" | "trust_score" | "level" | "social_freshness") || "last_activity",
      }),
    );
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.get("/creators/:id", async (c) => {
  try {
    return c.json(await getCreatorOperatorDetail(serviceClient(), c.req.param("id")));
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.post("/creators/:id/review", async (c) => {
  const body = await c.req.json<{ status?: unknown; risk_level?: unknown; summary?: unknown; note?: unknown }>().catch(() => ({}));
  const status = parseReviewStatus(body.status);
  const riskLevel = parseRiskLevel(body.risk_level);
  if (!status) return c.json({ error: "Invalid review status", code: "bad_review_status" }, 400);
  if (!riskLevel) return c.json({ error: "Invalid risk level", code: "bad_risk_level" }, 400);
  if (status === "flagged" && !nonEmptyText(body.note)) {
    return c.json({ error: "Flagged reviews require a note", code: "flagged_review_note_required" }, 400);
  }

  try {
    const review = await updateCreatorReview(serviceClient(), {
      creatorId: c.req.param("id"),
      status,
      riskLevel,
      summary: nonEmptyText(body.summary),
      note: nonEmptyText(body.note),
      context: operatorContext(c),
    });
    return c.json({ review });
  } catch (error) {
    return crmError(c, error);
  }
});
```

Add the remaining route handlers in the same file using the same validation pattern:

```ts
adminOperatorCrmRoutes.post("/creators/:id/notes", async (c) => {
  const body = await c.req.json<{ category?: unknown; body?: unknown }>().catch(() => ({}));
  const category = parseNoteCategory(body.category);
  const noteBody = nonEmptyText(body.body);
  if (!category) return c.json({ error: "Invalid note category", code: "bad_note_category" }, 400);
  if (!noteBody) return c.json({ error: "Missing note body", code: "bad_note_body" }, 400);
  try {
    return c.json({
      note: await addCreatorReviewNote(serviceClient(), {
        creatorId: c.req.param("id"),
        category,
        body: noteBody,
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.get("/missions/:missionId/shortlist", async (c) => {
  try {
    return c.json(await listMissionShortlist(serviceClient(), c.req.param("missionId")));
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.post("/missions/:missionId/shortlist", async (c) => {
  const body = await c.req.json<{ creator_id?: unknown; source?: unknown; notes?: unknown }>().catch(() => ({}));
  const creatorId = nonEmptyText(body.creator_id);
  const source = parseShortlistSource(body.source ?? "manual");
  if (!creatorId) return c.json({ error: "Missing creator_id", code: "bad_creator" }, 400);
  if (!source) return c.json({ error: "Invalid shortlist source", code: "bad_shortlist_source" }, 400);
  try {
    return c.json({
      shortlist: await upsertMissionShortlist(serviceClient(), {
        missionId: c.req.param("missionId"),
        creatorId,
        source,
        notes: nonEmptyText(body.notes),
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.patch("/missions/:missionId/shortlist/:creatorId", async (c) => {
  const body = await c.req.json<{ status?: unknown; notes?: unknown }>().catch(() => ({}));
  const status = parseShortlistStatus(body.status);
  if (!status) return c.json({ error: "Invalid shortlist status", code: "bad_shortlist_status" }, 400);
  try {
    return c.json({
      shortlist: await updateMissionShortlistStatus(serviceClient(), {
        missionId: c.req.param("missionId"),
        creatorId: c.req.param("creatorId"),
        status,
        notes: nonEmptyText(body.notes),
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
});
```

- [ ] **Step 5: Mount the CRM routes**

Modify `server/routes/admin.ts`:

```ts
import { adminOperatorCrmRoutes } from "./adminOperatorCrm.js";
```

After the shared-secret middleware:

```ts
adminRoutes.route("/", adminOperatorCrmRoutes);
```

- [ ] **Step 6: Run the admin API tests to verify they pass**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add server/lib/operatorCrm/repo.ts server/routes/adminOperatorCrm.ts server/routes/admin.ts server/test/operator-crm.test.ts
git commit -m "feat: add operator crm admin api"
```

---

### Task 4: Enrich Existing Admin Application And Submission Responses

**Files:**
- Modify: `server/routes/admin.ts`
- Modify: `server/lib/operatorCrm/repo.ts`
- Test: `server/test/admin.test.ts`

**Payload additions:**
- Every `/api/admin/applications` row includes:
  - `mission_id`
  - `creator_review: { status, risk_level }`
  - `mission_shortlist: { status } | null`
- Every `/api/admin/submissions` row includes the same fields.

- [ ] **Step 1: Write failing assertions in admin tests**

Modify the `lists pending submissions` test in `server/test/admin.test.ts`:

```ts
    const row = submissions.find((s: { id: string }) => s.id === submissionId);
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
```

Add an application payload test:

```ts
  it("lists pending applications with creator review and shortlist metadata", async () => {
    const applicant = await makeCreator("admin-app-meta@test.local", 0);
    await makeMission({ slug: "test-admin-app-meta", access_type: "application", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-app-meta/apply", applicant.jwt, { method: "POST" });

    const res = await adminreq("/admin/applications");
    expect(res.status).toBe(200);
    const { applications } = await res.json();
    const row = applications.find((item: { creator_id: string }) => item.creator_id === applicant.userId);
    expect(row.mission_id).toMatch(/[0-9a-f-]{36}/);
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
  });
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/admin.test.ts
```

Expected: FAIL because `creator_review` is missing.

- [ ] **Step 3: Add row enrichment helper**

In `server/lib/operatorCrm/repo.ts`, export:

```ts
export async function enrichAdminMissionRows<
  T extends { creator_id: string; mission_id: string },
>(supabase: SupabaseClient, rows: T[]): Promise<Array<T & {
  creator_review: { status: string; risk_level: string };
  mission_shortlist: { status: string } | null;
}>> {
  const creatorIds = [...new Set(rows.map((row) => row.creator_id))];
  const missionIds = [...new Set(rows.map((row) => row.mission_id))];
  if (rows.length === 0) return [];

  const { data: reviews, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select("creator_id, status, risk_level")
    .in("creator_id", creatorIds);
  if (reviewError) throw new OperatorCrmError("db_error", reviewError.message);

  const { data: shortlists, error: shortlistError } = await supabase
    .from("mission_shortlists")
    .select("creator_id, mission_id, status")
    .in("creator_id", creatorIds)
    .in("mission_id", missionIds);
  if (shortlistError) throw new OperatorCrmError("db_error", shortlistError.message);

  const reviewByCreator = new Map((reviews ?? []).map((row) => [row.creator_id as string, row]));
  const shortlistByPair = new Map((shortlists ?? []).map((row) => [`${row.mission_id}:${row.creator_id}`, row]));

  return rows.map((row) => {
    const review = reviewByCreator.get(row.creator_id);
    const shortlist = shortlistByPair.get(`${row.mission_id}:${row.creator_id}`);
    return {
      ...row,
      creator_review: {
        status: (review?.status as string | undefined) ?? "needs_review",
        risk_level: (review?.risk_level as string | undefined) ?? "unknown",
      },
      mission_shortlist: shortlist ? { status: shortlist.status as string } : null,
    };
  });
}
```

- [ ] **Step 4: Use the helper in existing admin list routes**

Modify `/submissions` and `/applications` in `server/routes/admin.ts` to select `mission_id` and call the helper:

```ts
const { data, error } = await svc
  .from("mission_submissions")
  .select("id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
  .eq("status", status)
  .order("submitted_at", { ascending: true });
if (error) return c.json({ error: error.message, code: "db_error" }, 500);
try {
  return c.json({ submissions: await enrichAdminMissionRows(svc, data ?? []) });
} catch (err) {
  const message = err instanceof Error ? err.message : "Failed to enrich submissions";
  return c.json({ error: message, code: "db_error" }, 500);
}
```

For applications, order by `created_at` and return `{ applications: enriched }`.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add server/routes/admin.ts server/lib/operatorCrm/repo.ts server/test/admin.test.ts
git commit -m "feat: enrich admin mission rows with creator review"
```

---

### Task 5: Frontend Admin Client Types And Fetch Helpers

**Files:**
- Modify: `src/lib/admin.ts`
- Test: `src/lib/admin.test.ts`

**Interfaces:**
- `fetchCreatorReviewQueue(filters)`
- `fetchCreatorDetail(creatorId)`
- `postCreatorReview(creatorId, body)`
- `postCreatorNote(creatorId, body)`
- `fetchMissionShortlist(missionId)`
- `postMissionShortlist(missionId, body)`
- `patchMissionShortlist(missionId, creatorId, body)`

- [ ] **Step 1: Write failing frontend client tests**

Create `src/lib/admin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminAuthError,
  clearAdminSecret,
  fetchCreatorReviewQueue,
  getAdminSecret,
  postCreatorReview,
  setAdminSecret,
} from "./admin";

describe("admin client helpers", () => {
  afterEach(() => {
    clearAdminSecret();
    vi.restoreAllMocks();
  });

  it("adds review queue filters to the admin URL", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ creators: [], page: 2, pageSize: 10, total: 0 }), { status: 200 }),
    );

    await fetchCreatorReviewQueue({
      status: "approved",
      riskLevel: "low",
      missionId: "mission-1",
      q: "amy",
      page: 2,
      pageSize: 10,
      sort: "trust_score",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/review?status=approved&risk_level=low&mission_id=mission-1&q=amy&page=2&page_size=10&sort=trust_score",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-admin-secret": "secret" }),
      }),
    );
  });

  it("posts creator review bodies with snake_case API keys", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ review: { status: "approved", riskLevel: "low" } }), { status: 200 }),
    );

    await postCreatorReview("creator-1", {
      status: "approved",
      riskLevel: "low",
      summary: "Ready.",
      note: "Strong samples.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/creator-1/review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          risk_level: "low",
          summary: "Ready.",
          note: "Strong samples.",
        }),
      }),
    );
  });

  it("clears a stale secret on 401", async () => {
    setAdminSecret("bad-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "no_admin" }), { status: 401 }));

    await expect(fetchCreatorReviewQueue({ page: 1, pageSize: 25, sort: "last_activity" })).rejects.toBeInstanceOf(AdminAuthError);
    expect(getAdminSecret()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
vitest run src/lib/admin.test.ts
```

Expected: FAIL with missing exports.

- [ ] **Step 3: Add CRM types and helpers**

Modify `src/lib/admin.ts` with these exported types and helpers:

```ts
export type AdminReviewStatus = "needs_review" | "approved" | "flagged";
export type AdminRiskLevel = "low" | "medium" | "high" | "unknown";
export type AdminNoteCategory = "quality" | "brand_safety" | "fit" | "social" | "other";
export type AdminShortlistStatus = "shortlisted" | "invited" | "dismissed" | "accepted" | "declined";
export type AdminShortlistSource = "manual" | "applicant" | "match" | "review_queue";

export type AdminReviewProjection = {
  status: AdminReviewStatus;
  riskLevel: AdminRiskLevel;
  summary: string | null;
  reviewedBy: string | null;
  lastReviewedAt: string | null;
  updatedAt: string | null;
};

export type AdminCreatorReviewRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level: string;
  categories: string[];
  scores: Record<string, number | null>;
  social: {
    platforms: string[];
    syncStatus: string | null;
    followerCount: number | null;
    engagementRate: number | null;
    apiSyncedAt: string | null;
    label: "API-synced" | "Not synced";
    ownershipLabel: "Ownership not verified";
  };
  review: AdminReviewProjection;
  shortlist: { status: AdminShortlistStatus; source: AdminShortlistSource; notes: string | null; updatedAt: string } | null;
  lastActivityAt: string | null;
};

export type CreatorReviewQueueFilters = {
  status?: AdminReviewStatus;
  riskLevel?: AdminRiskLevel;
  missionId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "last_activity" | "trust_score" | "level" | "social_freshness";
};

function queryString(filters: CreatorReviewQueueFilters) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.riskLevel) qs.set("risk_level", filters.riskLevel);
  if (filters.missionId) qs.set("mission_id", filters.missionId);
  if (filters.q) qs.set("q", filters.q);
  qs.set("page", String(filters.page ?? 1));
  qs.set("page_size", String(filters.pageSize ?? 25));
  qs.set("sort", filters.sort ?? "last_activity");
  return qs.toString();
}

export function fetchCreatorReviewQueue(filters: CreatorReviewQueueFilters = {}) {
  return adminFetch<{ creators: AdminCreatorReviewRow[]; page: number; pageSize: number; total: number }>(
    `/admin/creators/review?${queryString(filters)}`,
  );
}

export function fetchCreatorDetail(creatorId: string) {
  return adminFetch<{
    creator: AdminCreatorReviewRow;
    social: AdminCreatorReviewRow["social"];
    review: AdminReviewProjection;
    notes: Array<{ id: string; category: AdminNoteCategory; body: string; operator_id: string; created_at: string }>;
    missionHistory: Array<Record<string, unknown>>;
    shortlists: Array<Record<string, unknown>>;
    audit: Array<Record<string, unknown>>;
  }>(`/admin/creators/${creatorId}`);
}

export function postCreatorReview(
  creatorId: string,
  body: { status: AdminReviewStatus; riskLevel: AdminRiskLevel; summary?: string; note?: string },
) {
  return adminFetch<{ review: AdminReviewProjection }>(`/admin/creators/${creatorId}/review`, {
    method: "POST",
    body: JSON.stringify({
      status: body.status,
      risk_level: body.riskLevel,
      summary: body.summary,
      note: body.note,
    }),
  });
}

export function postCreatorNote(creatorId: string, body: { category: AdminNoteCategory; body: string }) {
  return adminFetch<{ note: { id: string; category: AdminNoteCategory; body: string; created_at: string } }>(
    `/admin/creators/${creatorId}/notes`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
```

Add mission shortlist helpers in the same file:

```ts
export function fetchMissionShortlist(missionId: string) {
  return adminFetch<{
    mission: { id: string; slug: string; title: string };
    shortlist: Array<{ creator_id: string; status: AdminShortlistStatus; source: AdminShortlistSource; notes: string | null }>;
  }>(`/admin/missions/${missionId}/shortlist`);
}

export function postMissionShortlist(
  missionId: string,
  body: { creatorId: string; source: AdminShortlistSource; notes?: string },
) {
  return adminFetch<{ shortlist: { creator_id: string; status: AdminShortlistStatus } }>(
    `/admin/missions/${missionId}/shortlist`,
    {
      method: "POST",
      body: JSON.stringify({ creator_id: body.creatorId, source: body.source, notes: body.notes }),
    },
  );
}

export function patchMissionShortlist(
  missionId: string,
  creatorId: string,
  body: { status: AdminShortlistStatus; notes?: string },
) {
  return adminFetch<{ shortlist: { creator_id: string; status: AdminShortlistStatus } }>(
    `/admin/missions/${missionId}/shortlist/${creatorId}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}
```

- [ ] **Step 4: Run admin client tests**

Run:

```bash
vitest run src/lib/admin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat: add operator crm admin client"
```

---

### Task 6: Operator Auth Shell And Creator Review Queue

**Files:**
- Create: `src/components/operator/OperatorAuthGate.tsx`
- Create: `src/components/operator/OperatorBadges.tsx`
- Create: `src/components/operator/ReviewActionPanel.tsx`
- Modify: `src/routes/operator.tsx`
- Create: `src/routes/operator.creators.tsx`
- Modify: `src/routes/-operator.test.tsx`
- Test: `src/routes/-operator.creators.test.tsx`

**UX:**
- Compact internal tool surface.
- Search input, status filter, risk filter, sort select, and mission context from `mission_id`.
- Rows show creator avatar/name, level, categories, trust score summary, social sync label, ownership label, review status, risk, last activity, and quick approve/flag buttons.
- Buttons use lucide icons (`Search`, `Check`, `Flag`, `UserRound`, `ListFilter`) with accessible labels.

- [ ] **Step 1: Write failing queue UI tests**

Create `src/routes/-operator.creators.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  secret: "s" as string | null,
  fetchCreatorReviewQueue: vi.fn(),
  postCreatorReview: vi.fn(),
}));

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  fetchCreatorReviewQueue: hoisted.fetchCreatorReviewQueue,
  postCreatorReview: hoisted.postCreatorReview,
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator.creators";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator creator review queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.secret = "s";
    vi.spyOn(Route, "useSearch").mockReturnValue({} as never);
    hoisted.fetchCreatorReviewQueue.mockResolvedValue({
      creators: [
        {
          id: "creator-1",
          displayName: "Amy Chan",
          avatarUrl: null,
          level: "L2",
          categories: ["beauty", "ugc"],
          scores: { influence: 80, content: 90, reliability: 70, brandSafety: 100 },
          social: {
            platforms: ["instagram"],
            syncStatus: "synced",
            followerCount: 45000,
            engagementRate: 3.2,
            apiSyncedAt: "2026-06-18T02:00:00.000Z",
            label: "API-synced",
            ownershipLabel: "Ownership not verified",
          },
          review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
          shortlist: null,
          lastActivityAt: "2026-06-18T02:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  });

  it("renders filters, social labels, and creator rows", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByLabelText("Search creators")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("needs_review")).toBeInTheDocument();
  });

  it("quick-approves a creator and refetches the queue", async () => {
    hoisted.postCreatorReview.mockResolvedValue({ review: { status: "approved", riskLevel: "low" } });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.click(screen.getByLabelText("Approve Amy Chan"));
    await waitFor(() =>
      expect(hoisted.postCreatorReview).toHaveBeenCalledWith("creator-1", {
        status: "approved",
        riskLevel: "low",
        summary: "Approved from creator review queue.",
      }),
    );
  });
});
```

- [ ] **Step 2: Run queue UI tests to verify they fail**

Run:

```bash
vitest run src/routes/-operator.creators.test.tsx
```

Expected: FAIL with missing route/component files.

- [ ] **Step 3: Create the reusable operator auth gate**

Create `src/components/operator/OperatorAuthGate.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { AdminAuthError, clearAdminSecret, getAdminSecret, setAdminSecret } from "@/lib/admin";

export function OperatorAuthGate({ error, children }: { error?: unknown; children: ReactNode }) {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [input, setInput] = useState("");

  useEffect(() => {
    if (error instanceof AdminAuthError) {
      clearAdminSecret();
      setSecret(null);
    }
  }, [error]);

  if (!secret) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <h1 className="font-display text-xl font-bold">營運後台</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">輸入管理密碼以檢視營運工具</p>
        <input
          type="password"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="ADMIN_SECRET"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2"
        />
        <button
          type="button"
          onClick={() => { setAdminSecret(input); setSecret(input); }}
          className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold"
        >
          進入
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Create shared operator badges**

Create `src/components/operator/OperatorBadges.tsx`:

```tsx
import type { AdminReviewStatus, AdminRiskLevel, AdminShortlistStatus } from "@/lib/admin";

const reviewTone: Record<AdminReviewStatus, string> = {
  approved: "bg-[var(--color-acid)]",
  needs_review: "bg-white",
  flagged: "bg-[var(--color-magenta)] text-white",
};

export function ReviewBadge({ status }: { status: AdminReviewStatus }) {
  return <span className={`rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold ${reviewTone[status]}`}>{status}</span>;
}

export function RiskBadge({ risk }: { risk: AdminRiskLevel }) {
  return <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">risk: {risk}</span>;
}

export function SocialSyncBadge({ label }: { label: "API-synced" | "Not synced" }) {
  return <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{label}</span>;
}

export function ShortlistBadge({ status }: { status: AdminShortlistStatus }) {
  return <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{status}</span>;
}
```

- [ ] **Step 5: Create quick review action panel**

Create `src/components/operator/ReviewActionPanel.tsx`:

```tsx
import { Check, Flag } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postCreatorReview, type AdminCreatorReviewRow, type AdminRiskLevel, type AdminReviewStatus } from "@/lib/admin";

export function ReviewActionPanel({ creator }: { creator: AdminCreatorReviewRow }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { status: AdminReviewStatus; riskLevel: AdminRiskLevel; summary: string; note?: string }) =>
      postCreatorReview(creator.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-creators-review"] }),
  });

  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-label={`Approve ${creator.displayName}`}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ status: "approved", riskLevel: "low", summary: "Approved from creator review queue." })}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)]"
        title="Approve creator"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Flag ${creator.displayName}`}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ status: "flagged", riskLevel: "high", summary: "Flagged from creator review queue.", note: "Flagged from queue for operator review." })}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-white"
        title="Flag creator"
      >
        <Flag className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Create creator queue route**

Create `src/routes/operator.creators.tsx` using `createFileRoute("/operator/creators")`. The route should:

```tsx
const [q, setQ] = useState("");
const [status, setStatus] = useState<AdminReviewStatus | "all">("all");
const [risk, setRisk] = useState<AdminRiskLevel | "all">("all");
const [sort, setSort] = useState<CreatorReviewQueueFilters["sort"]>("last_activity");
const missionId = Route.useSearch({ select: (search) => typeof search.mission_id === "string" ? search.mission_id : undefined });
const creators = useQuery({
  queryKey: ["admin-creators-review", { q, status, risk, sort, missionId }],
  queryFn: () => fetchCreatorReviewQueue({
    q,
    status: status === "all" ? undefined : status,
    riskLevel: risk === "all" ? undefined : risk,
    sort,
    missionId,
    page: 1,
    pageSize: 25,
  }),
  retry: false,
});
```

Render with `OperatorAuthGate`, `ReviewBadge`, `RiskBadge`, `SocialSyncBadge`, and `ReviewActionPanel`. Use stable row height classes (`min-h-[88px]`) so filters and mutation states do not shift the list.

- [ ] **Step 7: Update operator home and tests**

Modify `src/routes/operator.tsx` to use `OperatorAuthGate` and add a top navigation row with a link to `/operator/creators`. Preserve the existing applications list and mutation behavior.

Update `src/routes/-operator.test.tsx` so mocked applications include:

```ts
{
  id: "a1",
  mission_id: "m1",
  creator_id: "creator-1",
  creator_review: { status: "needs_review", risk_level: "unknown" },
  mission_shortlist: null,
  creators: { display_name: "Amy" },
  missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
}
```

Assert the page renders `needs_review` and still accepts the application.

- [ ] **Step 8: Run UI tests**

Run:

```bash
vitest run src/routes/-operator.test.tsx src/routes/-operator.creators.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/components/operator src/routes/operator.tsx src/routes/operator.creators.tsx src/routes/-operator.test.tsx src/routes/-operator.creators.test.tsx
git commit -m "feat: add operator creator review queue"
```

---

### Task 7: Creator Detail, Notes, Review Actions, And Audit Timeline

**Files:**
- Create: `src/routes/operator.creators.$creatorId.tsx`
- Create or modify: `src/components/operator/ReviewActionPanel.tsx`
- Test: `src/routes/-operator.creators.$creatorId.test.tsx`

**UX:**
- Detail view sections:
  - Profile header and selected avatar.
  - Social/media preview with API-synced metrics and ownership-not-verified label.
  - Trust/passport scores.
  - Mission history.
  - Review action form.
  - Internal notes.
  - Shortlist memberships.
  - Audit timeline.

- [ ] **Step 1: Write failing creator detail UI tests**

Create `src/routes/-operator.creators.$creatorId.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  secret: "s" as string | null,
  fetchCreatorDetail: vi.fn(),
  postCreatorNote: vi.fn(),
  postCreatorReview: vi.fn(),
}));

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  fetchCreatorDetail: hoisted.fetchCreatorDetail,
  postCreatorNote: hoisted.postCreatorNote,
  postCreatorReview: hoisted.postCreatorReview,
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator.creators.$creatorId";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator creator detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.secret = "s";
    vi.spyOn(Route, "useParams").mockReturnValue({ creatorId: "creator-1" } as never);
    hoisted.fetchCreatorDetail.mockResolvedValue({
      creator: {
        id: "creator-1",
        displayName: "Amy Chan",
        avatarUrl: "https://cdn.example.com/avatar.jpg",
        level: "L2",
        categories: ["beauty"],
        scores: { influence: 80, content: 90, reliability: 70, brandSafety: 100 },
        social: { platforms: ["instagram"], syncStatus: "synced", followerCount: 45000, engagementRate: 3.2, apiSyncedAt: "2026-06-18T02:00:00.000Z", label: "API-synced", ownershipLabel: "Ownership not verified" },
        review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
        shortlist: null,
        lastActivityAt: "2026-06-18T02:00:00.000Z",
      },
      social: { platforms: ["instagram"], syncStatus: "synced", followerCount: 45000, engagementRate: 3.2, apiSyncedAt: "2026-06-18T02:00:00.000Z", label: "API-synced", ownershipLabel: "Ownership not verified" },
      review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
      notes: [{ id: "note-1", category: "quality", body: "Good samples.", operator_id: "op", created_at: "2026-06-18T03:00:00.000Z" }],
      missionHistory: [{ id: "sub-1", status: "approved", missions: { title: "夏日面膜" } }],
      shortlists: [],
      audit: [{ id: "audit-1", event_type: "creator_review.updated", created_at: "2026-06-18T03:00:00.000Z" }],
    });
  });

  it("renders profile, social metrics, notes, mission history, and audit", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByText("45,000 followers")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("Good samples.")).toBeInTheDocument();
    expect(screen.getByText("creator_review.updated")).toBeInTheDocument();
  });

  it("adds an internal note", async () => {
    hoisted.postCreatorNote.mockResolvedValue({ note: { id: "note-2", category: "fit", body: "Great for launch.", created_at: "2026-06-18T04:00:00.000Z" } });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Great for launch." } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledWith("creator-1", { category: "other", body: "Great for launch." }));
  });
});
```

- [ ] **Step 2: Run detail UI tests to verify they fail**

Run:

```bash
vitest run 'src/routes/-operator.creators.$creatorId.test.tsx'
```

Expected: FAIL with missing route file.

- [ ] **Step 3: Create creator detail route**

Create `src/routes/operator.creators.$creatorId.tsx` with `createFileRoute("/operator/creators/$creatorId")`. Use:

```tsx
const { creatorId } = Route.useParams();
const detail = useQuery({
  queryKey: ["admin-creator-detail", creatorId],
  queryFn: () => fetchCreatorDetail(creatorId),
  retry: false,
});
```

The note mutation:

```tsx
const note = useMutation({
  mutationFn: (body: { category: AdminNoteCategory; body: string }) => postCreatorNote(creatorId, body),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-creator-detail", creatorId] }),
});
```

Render field labels:

```tsx
<textarea aria-label="New internal note" ... />
<button aria-label="Save internal note" ...>Save note</button>
```

Use `Intl.NumberFormat("en-US").format(value)` for follower and average metrics. Render `followers`, `engagement`, `avg likes`, `avg comments`, and `freshness` when values are present.

- [ ] **Step 4: Expand review action panel for detail use**

Update `ReviewActionPanel` to accept optional `variant="full"` and render:

```tsx
<select aria-label="Review status" value={status} onChange={...}>
  <option value="needs_review">Needs review</option>
  <option value="approved">Approved</option>
  <option value="flagged">Flagged</option>
</select>
<select aria-label="Risk level" value={riskLevel} onChange={...}>
  <option value="unknown">Unknown</option>
  <option value="low">Low</option>
  <option value="medium">Medium</option>
  <option value="high">High</option>
</select>
<textarea aria-label="Review summary" value={summary} onChange={...} />
<textarea aria-label="Review note" value={note} onChange={...} />
<button aria-label="Save review action" ...>Save review</button>
```

When status is `flagged`, require a note before calling `postCreatorReview` and render the inline text `Flagged reviews require a note`.

- [ ] **Step 5: Run detail UI tests**

Run:

```bash
vitest run 'src/routes/-operator.creators.$creatorId.test.tsx' src/routes/-operator.creators.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/routes/operator.creators.'$creatorId'.tsx src/routes/-operator.creators.'$creatorId'.test.tsx src/components/operator/ReviewActionPanel.tsx
git commit -m "feat: add operator creator detail"
```

---

### Task 8: Mission Shortlist Panel And Mission-Scoped Selection

**Files:**
- Create: `src/components/operator/CreatorReviewRow.tsx`
- Create: `src/components/operator/MissionShortlistPanel.tsx`
- Create: `src/routes/operator.missions.$missionId.tsx`
- Modify: `src/routes/operator.tsx`
- Modify: `src/routes/operator.creators.tsx`
- Test: `src/routes/-operator.missions.$missionId.test.tsx`
- Test: `src/routes/-operator.test.tsx`
- Test: `src/routes/-operator.creators.test.tsx`

**UX:**
- `/operator` application rows link to `/operator/missions/$missionId`.
- `/operator/missions/$missionId` shows mission title, current shortlist rows, and a mission-scoped creator queue.
- Mission-scoped queues show approved creators first and hide flagged creators unless the flagged filter is selected.
- A flagged shortlist attempt shows the API error text without clearing current filters.

- [ ] **Step 1: Write failing mission shortlist route tests**

Create `src/routes/-operator.missions.$missionId.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  secret: "s" as string | null,
  fetchMissionShortlist: vi.fn(),
  fetchCreatorReviewQueue: vi.fn(),
  patchMissionShortlist: vi.fn(),
}));

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  fetchMissionShortlist: hoisted.fetchMissionShortlist,
  fetchCreatorReviewQueue: hoisted.fetchCreatorReviewQueue,
  patchMissionShortlist: hoisted.patchMissionShortlist,
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator.missions.$missionId";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator mission shortlist page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Route, "useParams").mockReturnValue({ missionId: "mission-1" } as never);
    hoisted.fetchMissionShortlist.mockResolvedValue({
      mission: { id: "mission-1", slug: "test-mission", title: "夏日面膜" },
      shortlist: [{ creator_id: "creator-1", status: "shortlisted", source: "manual", notes: "Good fit.", creators: { display_name: "Amy Chan" } }],
    });
    hoisted.fetchCreatorReviewQueue.mockResolvedValue({ creators: [], page: 1, pageSize: 25, total: 0 });
  });

  it("renders mission shortlist rows and invite action", async () => {
    renderRoute();
    expect(await screen.findByText("夏日面膜")).toBeInTheDocument();
    expect(screen.getByText("Amy Chan")).toBeInTheDocument();
    hoisted.patchMissionShortlist.mockResolvedValue({ shortlist: { creator_id: "creator-1", status: "invited" } });
    fireEvent.click(screen.getByLabelText("Invite Amy Chan"));
    await waitFor(() => expect(hoisted.patchMissionShortlist).toHaveBeenCalledWith("mission-1", "creator-1", { status: "invited" }));
  });
});
```

- [ ] **Step 2: Run mission UI tests to verify they fail**

Run:

```bash
vitest run 'src/routes/-operator.missions.$missionId.test.tsx'
```

Expected: FAIL with missing route/component files.

- [ ] **Step 3: Create shortlist panel component**

Create `src/components/operator/MissionShortlistPanel.tsx`:

```tsx
import { Send, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchMissionShortlist, type AdminShortlistStatus } from "@/lib/admin";
import { ShortlistBadge } from "./OperatorBadges";

type ShortlistRow = {
  creator_id: string;
  status: AdminShortlistStatus;
  source: string;
  notes: string | null;
  creators?: { display_name?: string | null };
};

export function MissionShortlistPanel({ missionId, rows }: { missionId: string; rows: ShortlistRow[] }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ creatorId, status }: { creatorId: string; status: AdminShortlistStatus }) =>
      patchMissionShortlist(missionId, creatorId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-mission-shortlist", missionId] }),
  });

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg font-bold">Shortlist</h2>
      <div className="overflow-hidden border-2 border-[var(--color-ink)] bg-white">
        {rows.map((row) => {
          const name = row.creators?.display_name ?? row.creator_id;
          return (
            <div key={row.creator_id} className="grid min-h-[64px] grid-cols-[1fr_auto_auto] items-center gap-3 border-b-2 border-[var(--color-ink)] p-3 last:border-b-0">
              <div>
                <p className="font-heading font-bold">{name}</p>
                {row.notes ? <p className="text-xs text-[var(--color-soft-ink)]">{row.notes}</p> : null}
              </div>
              <ShortlistBadge status={row.status} />
              <div className="flex gap-2">
                <button type="button" aria-label={`Invite ${name}`} onClick={() => mutation.mutate({ creatorId: row.creator_id, status: "invited" })} className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)]" title="Invite">
                  <Send className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Dismiss ${name}`} onClick={() => mutation.mutate({ creatorId: row.creator_id, status: "dismissed" })} className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-white" title="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create mission route**

Create `src/routes/operator.missions.$missionId.tsx` using `createFileRoute("/operator/missions/$missionId")`. Fetch:

```tsx
const { missionId } = Route.useParams();
const shortlist = useQuery({
  queryKey: ["admin-mission-shortlist", missionId],
  queryFn: () => fetchMissionShortlist(missionId),
  retry: false,
});
const queue = useQuery({
  queryKey: ["admin-creators-review", { missionId }],
  queryFn: () => fetchCreatorReviewQueue({ missionId, page: 1, pageSize: 25, sort: "last_activity" }),
  retry: false,
});
```

Render `MissionShortlistPanel` above a compact creator queue using a shared `src/components/operator/CreatorReviewRow.tsx` component. Move the queue row JSX from `operator.creators.tsx` into that component before wiring the mission route so both route tests exercise the same row behavior.

- [ ] **Step 5: Add mission links on operator home and shortlist actions in queue**

Modify `src/routes/operator.tsx`:

```tsx
<a href={`/operator/missions/${a.mission_id}`} className="text-xs font-bold underline">Mission selection</a>
```

Modify `src/routes/operator.creators.tsx` so when `missionId` is present each row has a `Shortlist` button that calls:

```ts
postMissionShortlist(missionId, { creatorId: creator.id, source: "review_queue", notes })
```

For flagged rows, show a note input before calling the mutation. When the API returns `flagged_note_required`, render `Flagged creators need a shortlist note`.

- [ ] **Step 6: Run mission UI tests**

Run:

```bash
vitest run src/routes/-operator.test.tsx src/routes/-operator.creators.test.tsx 'src/routes/-operator.missions.$missionId.test.tsx'
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/components/operator/MissionShortlistPanel.tsx src/routes/operator.missions.'$missionId'.tsx src/routes/-operator.missions.'$missionId'.test.tsx src/routes/operator.tsx src/routes/operator.creators.tsx src/routes/-operator.test.tsx src/routes/-operator.creators.test.tsx
git commit -m "feat: add mission shortlist selection tools"
```

---

### Task 9: Integration Script, Privacy Regression, And Final Verification

**Files:**
- Modify: `package.json`
- Modify: `server/test/public-passport.test.ts`
- Test: full local test suite

- [ ] **Step 1: Add new integration tests to `test:integration`**

Modify `package.json`:

```json
"test:integration": "RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/rls.test.ts server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/admin.test.ts server/test/redemption.test.ts server/test/wallet.test.ts server/test/me.test.ts server/test/leveling.test.ts server/test/passport.test.ts server/test/match.test.ts server/test/copilot.test.ts server/test/applications.test.ts server/test/social-schema.test.ts server/test/social.test.ts server/test/public-passport.test.ts server/test/cron-social-refresh.test.ts server/test/operator-crm-schema.test.ts server/test/operator-crm.test.ts"
```

- [ ] **Step 2: Strengthen public passport privacy regression**

In `server/test/public-passport.test.ts`, inside `creates, resolves, and revokes a public passport without raw social leaks`, insert operator CRM rows before creating the share:

```ts
    const svc = serviceForTests();
    await svc.from("creator_review_statuses").insert({
      creator_id: c.userId,
      workspace_id: "00000000-0000-0000-0000-0000000000aa",
      status: "flagged",
      risk_level: "high",
      summary: "Internal-only summary.",
      reviewed_by: "privacy-test",
    });
    await svc.from("creator_review_notes").insert({
      creator_id: c.userId,
      workspace_id: "00000000-0000-0000-0000-0000000000aa",
      operator_id: "privacy-test",
      category: "brand_safety",
      body: "Internal-only note.",
    });
```

Then add assertions after `const body = await publicRes.json();`:

```ts
    expect(JSON.stringify(body)).not.toContain("flagged");
    expect(JSON.stringify(body)).not.toContain("high");
    expect(JSON.stringify(body)).not.toContain("Internal-only summary");
    expect(JSON.stringify(body)).not.toContain("Internal-only note");
    expect(JSON.stringify(body)).not.toContain("creator_review");
    expect(JSON.stringify(body)).not.toContain("mission_shortlist");
    expect(JSON.stringify(body)).not.toContain("audit");
```

- [ ] **Step 3: Run full local verification**

Run:

```bash
npm run type-check
```

Expected: PASS.

Run:

```bash
npm run lint
```

Expected: PASS.

Run:

```bash
npm test
```

Expected: PASS with skipped integration suites only when Supabase env is absent.

Run:

```bash
npm run test:integration
```

Expected: PASS when local Supabase env variables are exported.

Run:

```bash
npm run build
```

Expected: PASS. Existing chunk-size warnings are acceptable.

- [ ] **Step 4: Commit Task 9**

```bash
git add package.json server/test/public-passport.test.ts
git commit -m "test: cover operator crm integration and privacy"
```

---

## Self-Review Checklist

- Spec coverage:
  - Global queue: Task 6.
  - Creator detail: Task 7.
  - Approve, flag, needs-review: Tasks 3, 6, 7.
  - Notes and audit: Tasks 1, 3, 7.
  - Mission shortlist and invite: Tasks 3, 8.
  - Existing admin application/submission metadata: Task 4.
  - Flagged eligibility rules: Tasks 3 and 8.
  - Public passport privacy unchanged: Task 9.
  - Admin-secret bridge with future operator identity fields: Tasks 1 and 3.
- Type consistency:
  - Database uses snake_case columns.
  - Server projections use camelCase for new CRM response objects.
  - Existing admin list enrichment uses `creator_review` and `mission_shortlist`.
  - Frontend helper inputs use camelCase and translate API payloads to snake_case.
- Verification:
  - Unit tests cover pure serializers and frontend admin helpers.
  - Integration tests cover schema/RLS and admin API behavior.
  - UI tests cover auth shell, queue, detail, mission shortlist page, and existing operator home.
  - Final verification runs type-check, lint, unit tests, integration tests, and build.
