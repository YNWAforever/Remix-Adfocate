# Adfocate Trust Profile Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build API-synced Instagram/Threads trust profiles, richer private creator profile/passport metrics, explicit avatar selection, opt-in public passport sharing, and weekly refresh without claiming social account ownership.

**Architecture:** Add normalized social trust tables, server-only RapidAPI provider adapters, authenticated Hono routes for social accounts/scans/share controls, a public-safe passport route, and small frontend query/UI components. Passport scoring continues to use the existing pure score engine, but route inputs prefer API-synced follower counts when available.

**Tech Stack:** Supabase Postgres/RLS, Hono, TypeScript, Vitest, React 19, TanStack Query, TanStack Router, Vite, Vercel Cron Jobs.

## Global Constraints

- API-synced means Adfocate fetched public data for a handle. It does not mean the creator owns that account.
- No account ownership verification in v1.
- No public display of unverified handles, follower counts, engagement rates, or recent post data.
- No password, OAuth, or social account login flow.
- No audience demographic inference in v1.
- No large raw post archive. Store only bounded summaries needed for profile insight and trend history.
- `RAPIDAPI_KEY` stays backend-only.
- Production scan actions are disabled when `RAPIDAPI_KEY` is missing.
- A synced count is labeled `API-synced`.
- Any synced account without ownership proof is also labeled `Ownership not verified`.
- Public passport can show derived trust badges only, such as `Social scan connected`, `Active creator`, or `Fresh profile activity`.
- A scanned social avatar is internal by default. It may appear publicly only after the creator explicitly selects it as their Adfocate avatar.
- Manual scan and weekly scan use the same service.
- Public passport tokens are high entropy and stored hashed.

---

## Scope Check

This is one implementation plan because the database, scan service, scoring, public projection, and UI all depend on a shared `creator_social_accounts` contract. Each task below leaves the app in a testable state and commits independently.

## File Structure

- Create `supabase/migrations/0012_trust_profile_bundle.sql`: social trust tables, public passport table, RLS, grants, indexes.
- Modify `server/test/helpers.ts`: expose test Supabase clients and clean new tables with test creators.
- Create `server/test/social-schema.test.ts`: integration coverage for schema and RLS.
- Create `server/lib/social/types.ts`: shared social scan/account/passport trust types.
- Create `server/lib/social/normalize.ts`: platform/handle/profile URL normalization.
- Create `server/lib/social/rapidApi.ts`: RapidAPI provider adapter and response normalization.
- Create `server/lib/social/fixtures/*.json`: fixture payloads for Instagram and Threads.
- Create `server/lib/social/rapidApi.test.ts`: provider normalization and failure tests.
- Create `server/lib/social/repo.ts`: database reads/writes for social accounts, snapshots, public passport shares.
- Create `server/lib/social/service.ts`: orchestration for add account, scan account, avatar selection, share token lifecycle, weekly refresh.
- Create `server/lib/social/passportSocial.ts`: convert social account rows into passport scoring inputs and trust summaries.
- Create `server/lib/tokens.ts`: public token generation and hashing.
- Create `server/routes/social.ts`: authenticated social account and scan endpoints.
- Create `server/routes/public.ts`: public passport endpoint.
- Create `server/routes/cron.ts`: Vercel cron weekly refresh endpoint.
- Modify `server/app.ts`: mount guarded social routes and unguarded public/cron routes.
- Modify `server/routes/me.ts`: add avatar-from-social and passport share endpoints; include synced social trust in `/me/passport`.
- Modify `server/lib/persistScores.ts`: prefer synced follower counts when snapshotting scores.
- Modify `server/lib/passport.ts`: only if necessary to carry social trust badges; keep scoring pure.
- Create/modify server tests: `server/test/social.test.ts`, `server/test/passport.test.ts`, `server/test/public-passport.test.ts`, `server/test/cron-social-refresh.test.ts`.
- Modify `src/lib/queries/kocmax.ts`: social account, scan, share, public passport types and hooks.
- Modify `src/lib/queries/kocmax.test.tsx`: query hook endpoint tests.
- Create `src/components/SocialTrustPanel.tsx`: profile social trust controls.
- Create `src/components/SocialTrustPanel.test.tsx`: profile trust UI tests.
- Create `src/components/PassportTrustSummary.tsx`: authenticated passport trust metrics.
- Create `src/components/PublicPassportView.tsx`: public-safe passport view.
- Modify `src/routes/_app.profile.tsx`: render social trust panel.
- Modify `src/routes/_app.passport.tsx`: render trust summary and share controls.
- Create `src/routes/passport.$token.tsx`: public passport page.
- Modify UI tests for profile/passport/public route rendering.
- Modify `vercel.json`: add weekly cron path while preserving existing redirects and rewrites.
- Create `docs/ops/trust-profile-env.md`: env vars and RapidAPI setup notes.

---

### Task 1: Schema, RLS, And Test Helpers

**Files:**
- Create: `supabase/migrations/0012_trust_profile_bundle.sql`
- Modify: `server/test/helpers.ts`
- Test: `server/test/social-schema.test.ts`

**Interfaces:**
- Produces tables: `creator_social_accounts`, `creator_social_scan_snapshots`, `creator_public_passports`
- Produces helper functions: `serviceForTests(): SupabaseClient`, `userForJwt(jwt: string): SupabaseClient`
- Later tasks rely on `creator_social_accounts.sync_status` values: `pending`, `synced`, `stale`, `failed`, `rate_limited`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/social-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("social trust schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets a creator read only their own social trust account", async () => {
    const c1 = await makeCreator("social-schema-1@test.local");
    const c2 = await makeCreator("social-schema-2@test.local");
    const svc = serviceForTests();

    const { error: insertErr } = await svc.from("creator_social_accounts").insert([
      {
        creator_id: c1.userId,
        workspace_id: DEMO_WS,
        platform: "instagram",
        handle: "ming",
        profile_url: "https://www.instagram.com/ming/",
        sync_status: "synced",
        follower_count: 12000,
        api_synced_at: new Date().toISOString(),
      },
      {
        creator_id: c2.userId,
        workspace_id: DEMO_WS,
        platform: "threads",
        handle: "other",
        profile_url: "https://www.threads.net/@other",
        sync_status: "synced",
        follower_count: 5000,
        api_synced_at: new Date().toISOString(),
      },
    ]);
    expect(insertErr).toBeNull();

    const user = userForJwt(c1.jwt);
    const { data, error } = await user
      .from("creator_social_accounts")
      .select("creator_id, platform, handle, follower_count")
      .order("platform");

    expect(error).toBeNull();
    expect(data).toEqual([
      {
        creator_id: c1.userId,
        platform: "instagram",
        handle: "ming",
        follower_count: 12000,
      },
    ]);
  });

  it("keeps public passport token hashes private to the owning creator", async () => {
    const c1 = await makeCreator("social-passport-token-1@test.local");
    const c2 = await makeCreator("social-passport-token-2@test.local");
    const svc = serviceForTests();

    const { error: insertErr } = await svc.from("creator_public_passports").insert([
      { creator_id: c1.userId, public_token_hash: "hash-for-c1", enabled: true },
      { creator_id: c2.userId, public_token_hash: "hash-for-c2", enabled: true },
    ]);
    expect(insertErr).toBeNull();

    const user = userForJwt(c1.jwt);
    const { data, error } = await user.from("creator_public_passports").select("creator_id, public_token_hash");

    expect(error).toBeNull();
    expect(data).toEqual([{ creator_id: c1.userId, public_token_hash: "hash-for-c1" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social-schema.test.ts
```

Expected: FAIL with `relation "public.creator_social_accounts" does not exist` or an import error for `serviceForTests`.

- [ ] **Step 3: Expose test clients and cleanup support**

Modify `server/test/helpers.ts`:

```ts
export function serviceForTests(): SupabaseClient {
  return service();
}

export function userForJwt(jwt: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
```

In `cleanup()`, before deleting creator rows, add:

```ts
  if (ids.length) {
    await service().from("creator_public_passports").delete().in("creator_id", ids);
    await service().from("creator_social_accounts").delete().in("creator_id", ids);
  }
```

- [ ] **Step 4: Add the migration**

Create `supabase/migrations/0012_trust_profile_bundle.sql`:

```sql
-- Trust Profile Bundle: social scan snapshots, API-synced account metrics,
-- and opt-in public passport sharing.

create table public.creator_social_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  platform text not null check (platform in ('instagram', 'threads')),
  handle text not null,
  handle_normalized text generated always as (lower(regexp_replace(handle, '^@+', ''))) stored,
  profile_url text,
  owner_verified boolean not null default false,
  api_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'stale', 'failed', 'rate_limited')),
  follower_count integer check (follower_count is null or follower_count >= 0),
  following_count integer check (following_count is null or following_count >= 0),
  post_count integer check (post_count is null or post_count >= 0),
  bio text,
  external_avatar_url text,
  engagement_rate numeric(8,4) check (engagement_rate is null or engagement_rate >= 0),
  avg_likes numeric(12,2) check (avg_likes is null or avg_likes >= 0),
  avg_comments numeric(12,2) check (avg_comments is null or avg_comments >= 0),
  posting_frequency numeric(12,4) check (posting_frequency is null or posting_frequency >= 0),
  freshness_score integer check (freshness_score is null or (freshness_score >= 0 and freshness_score <= 100)),
  content_themes jsonb not null default '[]',
  summary jsonb not null default '{}',
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, platform, handle_normalized)
);

create index creator_social_accounts_creator_idx
  on public.creator_social_accounts (creator_id);
create index creator_social_accounts_refresh_idx
  on public.creator_social_accounts (sync_status, api_synced_at);

create table public.creator_social_scan_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_social_accounts(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  provider text not null,
  status text not null check (status in ('synced', 'stale', 'failed', 'rate_limited')),
  metrics jsonb not null default '{}',
  recent_posts_summary jsonb not null default '[]',
  error_code text,
  error_message text
);

create index creator_social_scan_snapshots_account_idx
  on public.creator_social_scan_snapshots (account_id, scanned_at desc);

create table public.creator_public_passports (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  public_token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  unique (creator_id)
);

alter table public.creator_social_accounts enable row level security;
alter table public.creator_social_scan_snapshots enable row level security;
alter table public.creator_public_passports enable row level security;

create policy creator_social_accounts_self_select
  on public.creator_social_accounts
  for select using (creator_id = auth.uid());

create policy creator_social_accounts_self_insert
  on public.creator_social_accounts
  for insert with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_social_accounts_self_update
  on public.creator_social_accounts
  for update using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_social_accounts_self_delete
  on public.creator_social_accounts
  for delete using (creator_id = auth.uid());

create policy creator_social_snapshots_self_select
  on public.creator_social_scan_snapshots
  for select using (
    exists (
      select 1
      from public.creator_social_accounts a
      where a.id = account_id
        and a.creator_id = auth.uid()
    )
  );

create policy creator_public_passports_self_select
  on public.creator_public_passports
  for select using (creator_id = auth.uid());

create policy creator_public_passports_self_insert
  on public.creator_public_passports
  for insert with check (creator_id = auth.uid());

create policy creator_public_passports_self_update
  on public.creator_public_passports
  for update using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy creator_public_passports_self_delete
  on public.creator_public_passports
  for delete using (creator_id = auth.uid());

grant all on public.creator_social_accounts to service_role;
grant all on public.creator_social_scan_snapshots to service_role;
grant all on public.creator_public_passports to service_role;

grant select, insert, update, delete on public.creator_social_accounts to authenticated;
grant select on public.creator_social_scan_snapshots to authenticated;
grant select, insert, update, delete on public.creator_public_passports to authenticated;
```

- [ ] **Step 5: Apply migration and run the schema test**

Run:

```bash
supabase db reset
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_trust_profile_bundle.sql server/test/helpers.ts server/test/social-schema.test.ts
git commit -m "feat: add social trust schema"
```

---

### Task 2: Social Scan Types And RapidAPI Normalization

**Files:**
- Create: `server/lib/social/types.ts`
- Create: `server/lib/social/normalize.ts`
- Create: `server/lib/social/rapidApi.ts`
- Create: `server/lib/social/fixtures/instagram-profile.json`
- Create: `server/lib/social/fixtures/threads-profile.json`
- Test: `server/lib/social/rapidApi.test.ts`

**Interfaces:**
- Produces `SocialScanResult`
- Produces `normalizeHandle(platform, handle): string`
- Produces `scanRapidApiProfile(input): Promise<SocialScanResult>`
- Later services consume only normalized results, never provider-specific payloads

- [ ] **Step 1: Write provider tests**

Create `server/lib/social/rapidApi.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import instagramFixture from "./fixtures/instagram-profile.json";
import threadsFixture from "./fixtures/threads-profile.json";
import { normalizeHandle, profileUrlFor } from "./normalize";
import { scanRapidApiProfile } from "./rapidApi";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("social RapidAPI adapter", () => {
  it("normalizes handles and profile URLs", () => {
    expect(normalizeHandle("instagram", "@Ming.KOC ")).toBe("ming.koc");
    expect(normalizeHandle("threads", " @Creator ")).toBe("creator");
    expect(profileUrlFor("instagram", "ming")).toBe("https://www.instagram.com/ming/");
    expect(profileUrlFor("threads", "ming")).toBe("https://www.threads.net/@ming");
  });

  it("normalizes an Instagram profile response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(instagramFixture));
    const result = await scanRapidApiProfile({
      platform: "instagram",
      handle: "@ming",
      env: {
        RAPIDAPI_KEY: "test-key",
        RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
      },
      fetchImpl,
    });

    expect(result).toMatchObject({
      platform: "instagram",
      handle: "ming",
      profileUrl: "https://www.instagram.com/ming/",
      followerCount: 12000,
      followingCount: 321,
      postCount: 42,
      bio: "Beauty creator in HK",
      externalAvatarUrl: "https://cdn.example.com/ig/ming.jpg",
      engagementRate: 4.38,
      avgLikes: 500,
      avgComments: 25,
      freshnessScore: 100,
    });
    expect(result.recentPostsSummary).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php?username_or_url=ming",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-RapidAPI-Key": "test-key",
          "X-RapidAPI-Host": "instagram-scraper-stable-api.p.rapidapi.com",
        }),
      }),
    );
  });

  it("normalizes a Threads profile response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(threadsFixture));
    const result = await scanRapidApiProfile({
      platform: "threads",
      handle: "ming",
      env: {
        RAPIDAPI_KEY: "test-key",
        RAPIDAPI_THREADS_PROFILE_URL: "https://threads-scraper-api2.p.rapidapi.com/profile",
      },
      fetchImpl,
    });

    expect(result).toMatchObject({
      platform: "threads",
      handle: "ming",
      profileUrl: "https://www.threads.net/@ming",
      followerCount: 8800,
      bio: "Threads-first creator",
      externalAvatarUrl: "https://cdn.example.com/threads/ming.jpg",
      engagementRate: 2.05,
      avgLikes: 160,
      avgComments: 20,
    });
  });

  it("returns provider_not_configured when the key or provider URL is missing", async () => {
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {},
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
  });

  it("maps provider HTTP failures to stable app error codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "quota exceeded" }, 429));
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {
          RAPIDAPI_KEY: "test-key",
          RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
        },
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});
```

- [ ] **Step 2: Add fixtures**

Create `server/lib/social/fixtures/instagram-profile.json`:

```json
{
  "user_data": {
    "username": "ming",
    "biography": "Beauty creator in HK",
    "follower_count": 12000,
    "following_count": 321,
    "media_count": 42,
    "profile_pic_url": "https://cdn.example.com/ig/ming.jpg",
    "recent_posts": [
      {
        "id": "ig-1",
        "like_count": 600,
        "comment_count": 30,
        "taken_at": "2026-06-16T08:00:00.000Z",
        "caption": "serum routine beauty skincare"
      },
      {
        "id": "ig-2",
        "like_count": 400,
        "comment_count": 20,
        "taken_at": "2026-06-15T08:00:00.000Z",
        "caption": "daily makeup review"
      }
    ]
  }
}
```

Create `server/lib/social/fixtures/threads-profile.json`:

```json
{
  "data": {
    "username": "ming",
    "bio": "Threads-first creator",
    "followers": 8800,
    "following": 155,
    "posts_count": 28,
    "profile_pic_url": "https://cdn.example.com/threads/ming.jpg",
    "threads": [
      {
        "id": "th-1",
        "like_count": 180,
        "reply_count": 25,
        "posted_at": "2026-06-16T09:00:00.000Z",
        "text": "fresh skincare launch"
      },
      {
        "id": "th-2",
        "like_count": 140,
        "reply_count": 15,
        "posted_at": "2026-06-13T09:00:00.000Z",
        "text": "creator notes on engagement"
      }
    ]
  }
}
```

- [ ] **Step 3: Implement shared types**

Create `server/lib/social/types.ts`:

```ts
export type SocialPlatform = "instagram" | "threads";

export type SocialSyncStatus = "pending" | "synced" | "stale" | "failed" | "rate_limited";

export type SocialProviderErrorCode =
  | "provider_not_configured"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "provider_error";

export class SocialProviderError extends Error {
  code: SocialProviderErrorCode;
  status: SocialSyncStatus;

  constructor(code: SocialProviderErrorCode, message: string, status: SocialSyncStatus = "failed") {
    super(message);
    this.name = "SocialProviderError";
    this.code = code;
    this.status = status;
  }
}

export type RecentPostSummary = {
  id: string;
  postedAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  text: string | null;
};

export type SocialScanResult = {
  platform: SocialPlatform;
  handle: string;
  profileUrl: string;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  bio: string | null;
  externalAvatarUrl: string | null;
  engagementRate: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  postingFrequency: number | null;
  freshnessScore: number | null;
  contentThemes: string[];
  recentPostsSummary: RecentPostSummary[];
  summary: Record<string, unknown>;
};

export type SocialAccountRecord = {
  id: string;
  creator_id: string;
  workspace_id: string;
  platform: SocialPlatform;
  handle: string;
  profile_url: string | null;
  owner_verified: boolean;
  api_synced_at: string | null;
  sync_status: SocialSyncStatus;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  bio: string | null;
  external_avatar_url: string | null;
  engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  posting_frequency: number | null;
  freshness_score: number | null;
  content_themes: string[];
  summary: Record<string, unknown>;
  last_error_code: string | null;
  last_error_message: string | null;
};
```

- [ ] **Step 4: Implement normalization**

Create `server/lib/social/normalize.ts`:

```ts
import type { SocialPlatform } from "./types.js";

export function normalizeHandle(platform: SocialPlatform, handle: string): string {
  const normalized = handle.trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^https?:\/\/(www\.)?threads\.net\/@?/, "");
  const firstSegment = normalized.split(/[/?#]/)[0] ?? "";
  const lowered = firstSegment.toLowerCase();
  if (!lowered) throw new Error(`empty_${platform}_handle`);
  return lowered;
}

export function profileUrlFor(platform: SocialPlatform, handle: string): string {
  const h = normalizeHandle(platform, handle);
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return `https://www.threads.net/@${h}`;
}
```

- [ ] **Step 5: Implement the RapidAPI adapter**

Create `server/lib/social/rapidApi.ts` with these exported functions:

```ts
import { normalizeHandle, profileUrlFor } from "./normalize.js";
import { SocialProviderError, type RecentPostSummary, type SocialPlatform, type SocialScanResult } from "./types.js";

type ScanEnv = Partial<Record<string, string | undefined>>;

export type RapidApiScanInput = {
  platform: SocialPlatform;
  handle: string;
  env?: ScanEnv;
  fetchImpl?: typeof fetch;
};

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(raw: unknown, keys: string[]): Record<string, unknown> {
  const root = recordFrom(raw);
  for (const key of keys) {
    const value = root[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return root;
}

function postsFrom(profile: Record<string, unknown>): RecentPostSummary[] {
  const rawPosts = profile.recent_posts ?? profile.posts ?? profile.threads ?? profile.items;
  if (!Array.isArray(rawPosts)) return [];
  return rawPosts.slice(0, 12).map((item, index) => {
    const post = recordFrom(item);
    return {
      id: String(post.id ?? post.pk ?? post.code ?? `post-${index}`),
      postedAt: stringFrom(post.taken_at) ?? stringFrom(post.posted_at) ?? stringFrom(post.timestamp),
      likeCount: numberFrom(post.like_count ?? post.likes),
      commentCount: numberFrom(post.comment_count ?? post.reply_count ?? post.comments ?? post.replies),
      text: stringFrom(post.caption) ?? stringFrom(post.text) ?? stringFrom(post.title),
    };
  });
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((sum, v) => sum + v, 0) / nums.length) * 100) / 100;
}

function freshnessScore(posts: RecentPostSummary[]): number | null {
  const latest = posts
    .map((p) => (p.postedAt ? Date.parse(p.postedAt) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  if (!latest) return null;
  const days = (Date.now() - latest) / 86_400_000;
  if (days <= 7) return 100;
  if (days <= 30) return 70;
  if (days <= 90) return 40;
  return 10;
}

function contentThemes(posts: RecentPostSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const words = (post.text ?? "").toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{3,}/g) ?? [];
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function providerUrl(platform: SocialPlatform, env: ScanEnv): string {
  if (platform === "instagram") return env.RAPIDAPI_INSTAGRAM_PROFILE_URL ?? "";
  return env.RAPIDAPI_THREADS_PROFILE_URL ?? "";
}

function providerHost(url: string): string {
  return new URL(url).host;
}

function appendHandleParam(url: string, platform: SocialPlatform, handle: string): string {
  const u = new URL(url);
  u.searchParams.set(platform === "instagram" ? "username_or_url" : "username", handle);
  return u.toString();
}

export async function scanRapidApiProfile(input: RapidApiScanInput): Promise<SocialScanResult> {
  const env = input.env ?? process.env;
  const key = env.RAPIDAPI_KEY;
  const baseUrl = providerUrl(input.platform, env);
  if (!key || !baseUrl) {
    throw new SocialProviderError("provider_not_configured", "RapidAPI social scan is not configured", "failed");
  }

  const handle = normalizeHandle(input.platform, input.handle);
  const url = appendHandleParam(baseUrl, input.platform, handle);
  const res = await (input.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": providerHost(baseUrl),
    },
  });

  if (res.status === 429) throw new SocialProviderError("rate_limited", "RapidAPI rate limit reached", "rate_limited");
  if (res.status === 404) throw new SocialProviderError("not_found", "Social profile not found", "failed");
  if (!res.ok) throw new SocialProviderError("provider_error", `RapidAPI returned ${res.status}`, "failed");

  const raw = await res.json();
  const profile = firstRecord(raw, ["user_data", "data", "user", "profile"]);
  const posts = postsFrom(profile);
  const followerCount = numberFrom(profile.follower_count ?? profile.followers ?? profile.followerCount);
  const avgLikes = average(posts.map((p) => p.likeCount));
  const avgComments = average(posts.map((p) => p.commentCount));
  const engagementRate =
    followerCount && followerCount > 0 && avgLikes != null
      ? Math.round((((avgLikes + (avgComments ?? 0)) / followerCount) * 100) * 100) / 100
      : null;

  return {
    platform: input.platform,
    handle,
    profileUrl: profileUrlFor(input.platform, handle),
    followerCount,
    followingCount: numberFrom(profile.following_count ?? profile.following ?? profile.followingCount),
    postCount: numberFrom(profile.media_count ?? profile.posts_count ?? profile.post_count),
    bio: stringFrom(profile.biography) ?? stringFrom(profile.bio),
    externalAvatarUrl:
      stringFrom(profile.profile_pic_url) ??
      stringFrom(profile.profile_pic_url_hd) ??
      stringFrom(recordFrom(profile.hd_profile_pic_url_info).url),
    engagementRate,
    avgLikes,
    avgComments,
    postingFrequency: posts.length,
    freshnessScore: freshnessScore(posts),
    contentThemes: contentThemes(posts),
    recentPostsSummary: posts,
    summary: {
      rawUsername: stringFrom(profile.username),
      providerShape: Object.keys(profile).slice(0, 20),
    },
  };
}
```

- [ ] **Step 6: Run provider tests**

Run:

```bash
vitest run server/lib/social/rapidApi.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/social
git commit -m "feat: normalize social scan providers"
```

---

### Task 3: Social Repository And Scan Service

**Files:**
- Create: `server/lib/social/repo.ts`
- Create: `server/lib/social/service.ts`
- Create: `server/lib/social/service.test.ts`

**Interfaces:**
- Consumes `SocialScanResult` from Task 2
- Produces `addOrUpdateSocialAccount(input): Promise<SocialAccountRecord>`
- Produces `scanSocialAccount(input): Promise<SocialAccountRecord>`
- Produces `selectSocialAvatar(input): Promise<string>`
- Produces `refreshDueSocialAccounts(input): Promise<{ scanned: number; failed: number }>`

- [ ] **Step 1: Write service tests with a fake repository**

Create `server/lib/social/service.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { scanSocialAccountWithDeps } from "./service";
import type { SocialAccountRecord, SocialScanResult } from "./types";

const baseAccount: SocialAccountRecord = {
  id: "acc-1",
  creator_id: "creator-1",
  workspace_id: "workspace-1",
  platform: "instagram",
  handle: "ming",
  profile_url: null,
  owner_verified: false,
  api_synced_at: null,
  sync_status: "pending",
  follower_count: null,
  following_count: null,
  post_count: null,
  bio: null,
  external_avatar_url: null,
  engagement_rate: null,
  avg_likes: null,
  avg_comments: null,
  posting_frequency: null,
  freshness_score: null,
  content_themes: [],
  summary: {},
  last_error_code: null,
  last_error_message: null,
};

const scanResult: SocialScanResult = {
  platform: "instagram",
  handle: "ming",
  profileUrl: "https://www.instagram.com/ming/",
  followerCount: 12000,
  followingCount: 321,
  postCount: 42,
  bio: "Beauty creator",
  externalAvatarUrl: "https://cdn.example.com/ming.jpg",
  engagementRate: 4.38,
  avgLikes: 500,
  avgComments: 25,
  postingFrequency: 2,
  freshnessScore: 100,
  contentThemes: ["beauty"],
  recentPostsSummary: [],
  summary: { rawUsername: "ming" },
};

describe("social scan service", () => {
  it("stores latest metrics and a snapshot after a successful scan", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      updateAccountFromScan: vi.fn().mockResolvedValue({ ...baseAccount, sync_status: "synced", follower_count: 12000 }),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.follower_count).toBe(12000);
    expect(provider).toHaveBeenCalledWith({ platform: "instagram", handle: "ming" });
    expect(repo.updateAccountFromScan).toHaveBeenCalledWith("acc-1", scanResult);
    expect(repo.insertSnapshot).toHaveBeenCalledWith("acc-1", "rapidapi", "synced", scanResult);
  });

  it("records failed status without erasing prior metrics", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue({ ...baseAccount, follower_count: 1000 }),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi.fn().mockResolvedValue({ ...baseAccount, sync_status: "rate_limited", follower_count: 1000 }),
    };
    const provider = vi.fn().mockRejectedValue(Object.assign(new Error("limited"), { code: "rate_limited", status: "rate_limited" }));

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("rate_limited");
    expect(account.follower_count).toBe(1000);
    expect(repo.updateAccountFromScan).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "rate_limited",
      expect.objectContaining({ errorCode: "rate_limited" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
vitest run server/lib/social/service.test.ts
```

Expected: FAIL with missing `./service`.

- [ ] **Step 3: Implement repository functions**

Create `server/lib/social/repo.ts` with these functions:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHandle, profileUrlFor } from "./normalize.js";
import type { SocialAccountRecord, SocialPlatform, SocialScanResult, SocialSyncStatus } from "./types.js";

export async function listSocialAccounts(supabase: SupabaseClient, creatorId: string): Promise<SocialAccountRecord[]> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .eq("creator_id", creatorId)
    .order("platform");
  if (error) throw error;
  return (data ?? []) as SocialAccountRecord[];
}

export async function addOrUpdateSocialAccount(
  supabase: SupabaseClient,
  input: { creatorId: string; workspaceId: string; platform: SocialPlatform; handle: string },
): Promise<SocialAccountRecord> {
  const handle = normalizeHandle(input.platform, input.handle);
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .upsert(
      {
        creator_id: input.creatorId,
        workspace_id: input.workspaceId,
        platform: input.platform,
        handle,
        profile_url: profileUrlFor(input.platform, handle),
        sync_status: "pending",
      },
      { onConflict: "creator_id,platform,handle_normalized" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function getAccountForCreator(
  supabase: SupabaseClient,
  input: { creatorId: string; accountId: string },
): Promise<SocialAccountRecord | null> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .eq("id", input.accountId)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (error) throw error;
  return (data as SocialAccountRecord | null) ?? null;
}

export async function updateAccountFromScan(
  supabase: SupabaseClient,
  accountId: string,
  result: SocialScanResult,
): Promise<SocialAccountRecord> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .update({
      handle: result.handle,
      profile_url: result.profileUrl,
      api_synced_at: new Date().toISOString(),
      sync_status: "synced",
      follower_count: result.followerCount,
      following_count: result.followingCount,
      post_count: result.postCount,
      bio: result.bio,
      external_avatar_url: result.externalAvatarUrl,
      engagement_rate: result.engagementRate,
      avg_likes: result.avgLikes,
      avg_comments: result.avgComments,
      posting_frequency: result.postingFrequency,
      freshness_score: result.freshnessScore,
      content_themes: result.contentThemes,
      summary: result.summary,
      last_error_code: null,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function markAccountScanFailed(
  supabase: SupabaseClient,
  accountId: string,
  input: { status: SocialSyncStatus; errorCode: string; errorMessage: string },
): Promise<SocialAccountRecord> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .update({
      sync_status: input.status,
      last_error_code: input.errorCode,
      last_error_message: input.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function insertSnapshot(
  supabase: SupabaseClient,
  accountId: string,
  provider: string,
  status: SocialSyncStatus,
  result:
    | SocialScanResult
    | { errorCode: string; errorMessage: string },
): Promise<void> {
  const success = "platform" in result;
  const { error } = await supabase.from("creator_social_scan_snapshots").insert({
    account_id: accountId,
    provider,
    status,
    metrics: success
      ? {
          followerCount: result.followerCount,
          followingCount: result.followingCount,
          postCount: result.postCount,
          engagementRate: result.engagementRate,
          avgLikes: result.avgLikes,
          avgComments: result.avgComments,
          postingFrequency: result.postingFrequency,
          freshnessScore: result.freshnessScore,
          contentThemes: result.contentThemes,
        }
      : {},
    recent_posts_summary: success ? result.recentPostsSummary : [],
    error_code: success ? null : result.errorCode,
    error_message: success ? null : result.errorMessage,
  });
  if (error) throw error;
}

export async function listDueSocialAccounts(supabase: SupabaseClient, limit = 25): Promise<SocialAccountRecord[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .in("sync_status", ["synced", "stale", "rate_limited"])
    .or(`api_synced_at.is.null,api_synced_at.lt.${sevenDaysAgo}`)
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SocialAccountRecord[];
}
```

- [ ] **Step 4: Implement service orchestration**

Create `server/lib/social/service.ts` with these exports:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../supabase.js";
import { persistScores } from "../persistScores.js";
import { scanRapidApiProfile } from "./rapidApi.js";
import * as repo from "./repo.js";
import type { SocialAccountRecord, SocialPlatform, SocialProviderErrorCode, SocialScanResult, SocialSyncStatus } from "./types.js";

type Provider = (input: { platform: SocialPlatform; handle: string }) => Promise<SocialScanResult>;

function errorStatus(err: unknown): { status: SocialSyncStatus; code: SocialProviderErrorCode | "provider_error"; message: string } {
  const e = err as { code?: SocialProviderErrorCode; status?: SocialSyncStatus; message?: string };
  return {
    status: e.status ?? (e.code === "rate_limited" ? "rate_limited" : "failed"),
    code: e.code ?? "provider_error",
    message: e.message ?? "Social scan failed",
  };
}

export async function scanSocialAccountWithDeps(input: {
  creatorId: string;
  accountId: string;
  repo: {
    getAccountForCreator: (creatorId: string, accountId: string) => Promise<SocialAccountRecord | null>;
    updateAccountFromScan: (accountId: string, result: SocialScanResult) => Promise<SocialAccountRecord>;
    insertSnapshot: (
      accountId: string,
      provider: string,
      status: SocialSyncStatus,
      result: SocialScanResult | { errorCode: string; errorMessage: string },
    ) => Promise<void>;
    markAccountScanFailed: (
      accountId: string,
      input: { status: SocialSyncStatus; errorCode: string; errorMessage: string },
    ) => Promise<SocialAccountRecord>;
  };
  provider: Provider;
}): Promise<SocialAccountRecord> {
  const account = await input.repo.getAccountForCreator(input.creatorId, input.accountId);
  if (!account) throw Object.assign(new Error("Social account not found"), { code: "not_found" });
  try {
    const result = await input.provider({ platform: account.platform, handle: account.handle });
    const updated = await input.repo.updateAccountFromScan(account.id, result);
    await input.repo.insertSnapshot(account.id, "rapidapi", "synced", result);
    return updated;
  } catch (err) {
    const failure = errorStatus(err);
    const updated = await input.repo.markAccountScanFailed(account.id, {
      status: failure.status,
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    await input.repo.insertSnapshot(account.id, "rapidapi", failure.status, {
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    return updated;
  }
}

export async function scanSocialAccount(input: { creatorId: string; accountId: string }): Promise<SocialAccountRecord> {
  const svc = serviceClient();
  const updated = await scanSocialAccountWithDeps({
    creatorId: input.creatorId,
    accountId: input.accountId,
    repo: {
      getAccountForCreator: (creatorId, accountId) => repo.getAccountForCreator(svc, { creatorId, accountId }),
      updateAccountFromScan: (accountId, result) => repo.updateAccountFromScan(svc, accountId, result),
      insertSnapshot: (accountId, provider, status, result) => repo.insertSnapshot(svc, accountId, provider, status, result),
      markAccountScanFailed: (accountId, failure) => repo.markAccountScanFailed(svc, accountId, failure),
    },
    provider: ({ platform, handle }) => scanRapidApiProfile({ platform, handle }),
  });
  await persistScores(input.creatorId);
  return updated;
}

export async function refreshDueSocialAccounts(limit = 25): Promise<{ scanned: number; failed: number }> {
  const svc = serviceClient();
  const accounts = await repo.listDueSocialAccounts(svc, limit);
  let scanned = 0;
  let failed = 0;
  for (const account of accounts) {
    const updated = await scanSocialAccount({ creatorId: account.creator_id, accountId: account.id });
    if (updated.sync_status === "synced") scanned += 1;
    else failed += 1;
  }
  return { scanned, failed };
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
vitest run server/lib/social/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/social/repo.ts server/lib/social/service.ts server/lib/social/service.test.ts
git commit -m "feat: add social scan service"
```

---

### Task 4: Authenticated Social Account And Scan APIs

**Files:**
- Create: `server/routes/social.ts`
- Modify: `server/app.ts`
- Test: `server/test/social.test.ts`

**Interfaces:**
- Consumes Task 3 service/repo functions
- Produces guarded routes:
  - `GET /api/social/accounts`
  - `POST /api/social/accounts`
  - `POST /api/social/accounts/:id/scan`

- [ ] **Step 1: Write route tests**

Create `server/test/social.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator } from "./helpers";

vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => ({
    platform,
    handle,
    profileUrl: platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://www.threads.net/@${handle}`,
    followerCount: 12000,
    followingCount: 321,
    postCount: 42,
    bio: "Mock scanned creator",
    externalAvatarUrl: "https://cdn.example.com/avatar.jpg",
    engagementRate: 4.5,
    avgLikes: 500,
    avgComments: 40,
    postingFrequency: 2,
    freshnessScore: 100,
    contentThemes: ["beauty"],
    recentPostsSummary: [],
    summary: { mocked: true },
  })),
}));

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

suite("social account endpoints", () => {
  let c: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("social-api@test.local");
  });
  afterAll(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it("adds and lists an Instagram account", async () => {
    const res = await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "instagram", handle: "@Ming" }),
    });
    expect(res.status).toBe(200);
    const account = await res.json();
    expect(account).toMatchObject({
      platform: "instagram",
      handle: "ming",
      sync_status: "pending",
      owner_verified: false,
    });

    const list = await (await req("/social/accounts", c.jwt)).json();
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0].handle).toBe("ming");
  });

  it("scans an account and returns API-synced metrics", async () => {
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "threads", handle: "ming" }),
      })
    ).json();

    const scan = await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });
    expect(scan.status).toBe(200);
    const body = await scan.json();
    expect(body.account).toMatchObject({
      platform: "threads",
      sync_status: "synced",
      follower_count: 12000,
      engagement_rate: 4.5,
    });
    expect(body.labels).toEqual(["API-synced", "Ownership not verified"]);
  });

  it("rejects unsupported platforms", async () => {
    const res = await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "x", handle: "bad" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_platform" });
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social.test.ts
```

Expected: FAIL with 404 for `/api/social/accounts`.

- [ ] **Step 3: Implement authenticated social routes**

Create `server/routes/social.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { addOrUpdateSocialAccount, listSocialAccounts } from "../lib/social/repo.js";
import { scanSocialAccount } from "../lib/social/service.js";
import type { SocialPlatform } from "../lib/social/types.js";

export const socialRoutes = new Hono<Env>();

function isPlatform(value: unknown): value is SocialPlatform {
  return value === "instagram" || value === "threads";
}

function trustLabels() {
  return ["API-synced", "Ownership not verified"];
}

socialRoutes.get("/accounts", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const accounts = await listSocialAccounts(supabase, c.get("userId"));
  return c.json({ accounts });
});

socialRoutes.post("/accounts", async (c) => {
  const body = await c.req.json<{ platform?: unknown; handle?: unknown }>();
  if (!isPlatform(body.platform)) return c.json({ error: "Unsupported platform", code: "bad_platform" }, 400);
  if (typeof body.handle !== "string" || !body.handle.trim()) return c.json({ error: "Missing handle", code: "bad_handle" }, 400);

  const supabase = makeUserClient(c.get("jwt"));
  const account = await addOrUpdateSocialAccount(supabase, {
    creatorId: c.get("userId"),
    workspaceId: c.get("workspaceId"),
    platform: body.platform,
    handle: body.handle,
  });
  return c.json(account);
});

socialRoutes.post("/accounts/:id/scan", async (c) => {
  const account = await scanSocialAccount({ creatorId: c.get("userId"), accountId: c.req.param("id") });
  if (account.last_error_code === "provider_not_configured") {
    return c.json({ error: "RapidAPI social scan is not configured", code: "provider_not_configured", account, labels: [] }, 503);
  }
  if (account.sync_status === "failed") {
    return c.json({ account, labels: account.api_synced_at ? trustLabels() : [] }, 422);
  }
  if (account.sync_status === "rate_limited") {
    return c.json({ account, labels: account.api_synced_at ? trustLabels() : [] }, 429);
  }
  return c.json({ account, labels: trustLabels() });
});
```

- [ ] **Step 4: Mount routes**

Modify `server/app.ts`:

```ts
import { socialRoutes } from "./routes/social.js";
```

Inside `createApp()`, after `guarded.route("/me", meRoutes);` add:

```ts
  guarded.route("/social", socialRoutes);
```

- [ ] **Step 5: Run route tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/social.ts server/app.ts server/test/social.test.ts
git commit -m "feat: add social account api"
```

---

### Task 5: Passport Scoring With API-Synced Counts

**Files:**
- Create: `server/lib/social/passportSocial.ts`
- Test: `server/lib/social/passportSocial.test.ts`
- Modify: `server/routes/me.ts`
- Modify: `server/lib/persistScores.ts`
- Modify: `server/test/passport.test.ts`

**Interfaces:**
- Consumes `creator_social_accounts` synced rows
- Produces `effectiveSocialHandles(input): { followers?: number | null }[] | null`
- Adds authenticated passport field `socialTrust`

- [ ] **Step 1: Write unit tests for effective follower inputs**

Create `server/lib/social/passportSocial.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveSocialHandles, privateSocialTrustSummary } from "./passportSocial";
import type { SocialAccountRecord } from "./types";

function account(partial: Partial<SocialAccountRecord>): SocialAccountRecord {
  return {
    id: "acc",
    creator_id: "creator",
    workspace_id: "workspace",
    platform: "instagram",
    handle: "ming",
    profile_url: "https://www.instagram.com/ming/",
    owner_verified: false,
    api_synced_at: "2026-06-17T00:00:00.000Z",
    sync_status: "synced",
    follower_count: 12000,
    following_count: null,
    post_count: null,
    bio: null,
    external_avatar_url: null,
    engagement_rate: 4.5,
    avg_likes: 500,
    avg_comments: 40,
    posting_frequency: 2,
    freshness_score: 100,
    content_themes: ["beauty"],
    summary: {},
    last_error_code: null,
    last_error_message: null,
    ...partial,
  };
}

describe("passport social inputs", () => {
  it("prefers synced social follower counts over self-reported handles", () => {
    const handles = effectiveSocialHandles({
      syncedAccounts: [account({ follower_count: 12000 })],
      selfReportedHandles: [{ followers: 999999 }],
    });
    expect(handles).toEqual([{ followers: 12000 }]);
  });

  it("falls back to self-reported handles when no synced counts exist", () => {
    const handles = effectiveSocialHandles({
      syncedAccounts: [account({ follower_count: null })],
      selfReportedHandles: [{ followers: 5000 }],
    });
    expect(handles).toEqual([{ followers: 5000 }]);
  });

  it("builds private social trust metrics and labels", () => {
    const summary = privateSocialTrustSummary([account({ platform: "threads", handle: "ming", engagement_rate: 2.2 })]);
    expect(summary.accounts[0]).toMatchObject({
      platform: "threads",
      handle: "ming",
      followerCount: 12000,
      engagementRate: 2.2,
      ownerVerified: false,
      labels: ["API-synced", "Ownership not verified"],
    });
    expect(summary.badges).toContain("social_scan_connected");
    expect(summary.badges).toContain("fresh_profile_activity");
  });
});
```

- [ ] **Step 2: Implement passport social helpers**

Create `server/lib/social/passportSocial.ts`:

```ts
import type { PassportSocialHandle } from "../passport.js";
import type { SocialAccountRecord } from "./types.js";

export type PrivateSocialTrustAccount = {
  id: string;
  platform: "instagram" | "threads";
  handle: string;
  followerCount: number | null;
  engagementRate: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  freshnessScore: number | null;
  apiSyncedAt: string | null;
  ownerVerified: boolean;
  labels: string[];
};

export type PrivateSocialTrustSummary = {
  accounts: PrivateSocialTrustAccount[];
  badges: string[];
};

export function effectiveSocialHandles(input: {
  syncedAccounts: SocialAccountRecord[];
  selfReportedHandles: PassportSocialHandle[] | null | undefined;
}): PassportSocialHandle[] | null {
  const synced = input.syncedAccounts
    .filter((a) => (a.sync_status === "synced" || a.sync_status === "stale") && a.follower_count != null)
    .map((a) => ({ followers: a.follower_count }));
  if (synced.length > 0) return synced;
  return input.selfReportedHandles ?? null;
}

export function privateSocialTrustSummary(accounts: SocialAccountRecord[]): PrivateSocialTrustSummary {
  const synced = accounts.filter((a) => a.sync_status === "synced" || a.sync_status === "stale");
  const badges = new Set<string>();
  if (synced.length > 0) badges.add("social_scan_connected");
  if (synced.some((a) => (a.freshness_score ?? 0) >= 70)) badges.add("fresh_profile_activity");
  if (synced.some((a) => (a.engagement_rate ?? 0) >= 2)) badges.add("active_creator");

  return {
    accounts: synced.map((a) => ({
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      followerCount: a.follower_count,
      engagementRate: a.engagement_rate,
      avgLikes: a.avg_likes,
      avgComments: a.avg_comments,
      freshnessScore: a.freshness_score,
      apiSyncedAt: a.api_synced_at,
      ownerVerified: a.owner_verified,
      labels: ["API-synced", a.owner_verified ? "Ownership verified" : "Ownership not verified"],
    })),
    badges: [...badges],
  };
}

export function publicSocialTrustBadges(accounts: SocialAccountRecord[]): string[] {
  return privateSocialTrustSummary(accounts).badges;
}
```

- [ ] **Step 3: Run unit tests**

Run:

```bash
vitest run server/lib/social/passportSocial.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update `/api/me/passport`**

Modify `server/routes/me.ts`:

```ts
import { listSocialAccounts } from "../lib/social/repo.js";
import { effectiveSocialHandles, privateSocialTrustSummary } from "../lib/social/passportSocial.js";
```

Inside `GET /passport`, after loading `creator`, load accounts with the service client:

```ts
  const syncedAccounts = await listSocialAccounts(serviceClient(), userId);
  const socialHandles = effectiveSocialHandles({
    syncedAccounts,
    selfReportedHandles: creator.social_handles as { followers?: number | null }[] | null,
  });
```

Change the `buildPassport` call to pass:

```ts
    socialHandles,
```

Return:

```ts
  return c.json({ ...passport, socialTrust: privateSocialTrustSummary(syncedAccounts) });
```

- [ ] **Step 5: Update persisted score snapshots**

Modify `server/lib/persistScores.ts`:

```ts
import { listSocialAccounts } from "./social/repo.js";
import { effectiveSocialHandles } from "./social/passportSocial.js";
```

Before `buildPassport`, add:

```ts
    const syncedAccounts = await listSocialAccounts(svc, creatorId);
    const socialHandles = effectiveSocialHandles({
      syncedAccounts,
      selfReportedHandles: creator.social_handles as { followers?: number | null }[] | null,
    });
```

Change the `buildPassport` input to:

```ts
      socialHandles,
```

- [ ] **Step 6: Add integration coverage**

Append this test to `server/test/passport.test.ts`:

```ts
  it("prefers API-synced follower counts over self-reported followers", async () => {
    const c = await makeCreator("passport-api-synced@test.local");
    await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "Instagram", handle: "@x", followers: 999999 }] }),
    });
    await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "instagram", handle: "@x" }),
    });
    const accounts = await (await req("/social/accounts", c.jwt)).json();
    const id = accounts.accounts[0].id;
    await req(`/social/accounts/${id}/scan`, c.jwt, { method: "POST" });

    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.influence).toBe(50);
    expect(p.socialTrust.accounts[0]).toMatchObject({
      handle: "x",
      followerCount: 12000,
      labels: ["API-synced", "Ownership not verified"],
    });
  });
```

- [ ] **Step 7: Run tests**

Run:

```bash
vitest run server/lib/social/passportSocial.test.ts
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social.test.ts server/test/passport.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/lib/social/passportSocial.ts server/lib/social/passportSocial.test.ts server/routes/me.ts server/lib/persistScores.ts server/test/passport.test.ts
git commit -m "feat: prefer synced social counts in passport"
```

---

### Task 6: Avatar Selection And Public Passport Backend

**Files:**
- Create: `server/lib/tokens.ts`
- Create: `server/lib/publicPassport.ts`
- Create: `server/routes/public.ts`
- Modify: `server/routes/me.ts`
- Modify: `server/app.ts`
- Test: `server/test/public-passport.test.ts`

**Interfaces:**
- Produces `POST /api/me/avatar/from-social`
- Produces `POST /api/me/passport/share`
- Produces `DELETE /api/me/passport/share`
- Produces `GET /api/public/passports/:token`

- [ ] **Step 1: Write privacy and sharing tests**

Create `server/test/public-passport.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator } from "./helpers";

vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => ({
    platform,
    handle,
    profileUrl: platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://www.threads.net/@${handle}`,
    followerCount: 12000,
    followingCount: 321,
    postCount: 42,
    bio: "Public leak sentinel bio",
    externalAvatarUrl: "https://cdn.example.com/private-social-avatar.jpg",
    engagementRate: 4.5,
    avgLikes: 500,
    avgComments: 40,
    postingFrequency: 2,
    freshnessScore: 100,
    contentThemes: ["beauty"],
    recentPostsSummary: [{ id: "secret-post", postedAt: "2026-06-16T00:00:00.000Z", likeCount: 500, commentCount: 40, text: "secret post text" }],
    summary: { mocked: true },
  })),
}));

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

suite("public passport privacy", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates, resolves, and revokes a public passport without raw social leaks", async () => {
    const c = await makeCreator("public-passport@test.local");
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", handle: "@secretcreator" }),
      })
    ).json();
    await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });

    const share = await req("/me/passport/share", c.jwt, { method: "POST" });
    expect(share.status).toBe(200);
    const shareBody = await share.json();
    expect(shareBody.publicUrl).toMatch(/^\/passport\//);

    const token = shareBody.token as string;
    const publicRes = await app.request(`/api/public/passports/${token}`);
    expect(publicRes.status).toBe(200);
    const body = await publicRes.json();
    expect(body.creator.displayName).toBe("public-passport@test.local");
    expect(body.socialTrustBadges).toContain("social_scan_connected");
    expect(JSON.stringify(body)).not.toContain("secretcreator");
    expect(JSON.stringify(body)).not.toContain("12000");
    expect(JSON.stringify(body)).not.toContain("4.5");
    expect(JSON.stringify(body)).not.toContain("secret-post");
    expect(JSON.stringify(body)).not.toContain("private-social-avatar");

    const revoke = await req("/me/passport/share", c.jwt, { method: "DELETE" });
    expect(revoke.status).toBe(200);
    const afterRevoke = await app.request(`/api/public/passports/${token}`);
    expect(afterRevoke.status).toBe(404);
  });

  it("uses a scanned avatar publicly only after explicit avatar selection", async () => {
    const c = await makeCreator("public-avatar@test.local");
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", handle: "avatarcreator" }),
      })
    ).json();
    await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });

    const firstShare = await (await req("/me/passport/share", c.jwt, { method: "POST" })).json();
    const before = await (await app.request(`/api/public/passports/${firstShare.token}`)).json();
    expect(before.creator.avatarUrl).toBeNull();

    const avatar = await req("/me/avatar/from-social", c.jwt, {
      method: "POST",
      body: JSON.stringify({ accountId: created.id }),
    });
    expect(avatar.status).toBe(200);

    const after = await (await app.request(`/api/public/passports/${firstShare.token}`)).json();
    expect(after.creator.avatarUrl).toBe("https://cdn.example.com/private-social-avatar.jpg");
  });
});
```

- [ ] **Step 2: Implement token helpers**

Create `server/lib/tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function createPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 3: Implement public-safe passport projection**

Create `server/lib/publicPassport.ts`:

```ts
import { serviceClient } from "./supabase.js";
import { buildPassport } from "./passport.js";
import { hashPublicToken } from "./tokens.js";
import { listSocialAccounts } from "./social/repo.js";
import { effectiveSocialHandles, publicSocialTrustBadges } from "./social/passportSocial.js";

export type PublicPassportPayload = {
  creator: {
    displayName: string;
    avatarUrl: string | null;
    level: string;
    xp: number;
  };
  scores: {
    influence: number | null;
    reliability: number | null;
    content: number | null;
    brandSafety: number | null;
  };
  badges: string[];
  socialTrustBadges: string[];
};

export async function getPublicPassportByToken(token: string): Promise<PublicPassportPayload | null> {
  const svc = serviceClient();
  const tokenHash = hashPublicToken(token);
  const { data: share, error: shareErr } = await svc
    .from("creator_public_passports")
    .select("creator_id, enabled")
    .eq("public_token_hash", tokenHash)
    .eq("enabled", true)
    .maybeSingle();
  if (shareErr) throw shareErr;
  if (!share) return null;

  const { data: creator, error: creatorErr } = await svc
    .from("creators")
    .select("id, display_name, avatar_url, level, xp, social_handles")
    .eq("id", share.creator_id)
    .single();
  if (creatorErr) throw creatorErr;

  const { data: subs, error: subsErr } = await svc
    .from("mission_submissions")
    .select("status, quality_rating")
    .eq("creator_id", share.creator_id);
  if (subsErr) throw subsErr;

  const { count: referredCount, error: refErr } = await svc
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", share.creator_id);
  if (refErr) throw refErr;

  const syncedAccounts = await listSocialAccounts(svc, share.creator_id as string);
  const socialHandles = effectiveSocialHandles({
    syncedAccounts,
    selfReportedHandles: creator.social_handles as { followers?: number | null }[] | null,
  });
  const passport = buildPassport({
    level: creator.level,
    xp: creator.xp,
    socialHandles,
    statuses: (subs ?? []).map((s) => s.status as string),
    ratings: (subs ?? [])
      .filter((s) => {
        const row = s as { status: string; quality_rating?: number | null };
        return row.status === "approved" && row.quality_rating != null;
      })
      .map((s) => (s as { quality_rating: number }).quality_rating),
    referredCount: referredCount ?? 0,
  });

  await svc.from("creator_public_passports").update({ last_viewed_at: new Date().toISOString() }).eq("public_token_hash", tokenHash);

  return {
    creator: {
      displayName: creator.display_name ?? "KOC",
      avatarUrl: creator.avatar_url ?? null,
      level: passport.level,
      xp: passport.xp,
    },
    scores: passport.scores,
    badges: passport.badges,
    socialTrustBadges: publicSocialTrustBadges(syncedAccounts),
  };
}
```

- [ ] **Step 4: Add share and avatar endpoints**

Modify `server/routes/me.ts` imports:

```ts
import { createPublicToken, hashPublicToken } from "../lib/tokens.js";
import { getAccountForCreator } from "../lib/social/repo.js";
```

Add handlers:

```ts
meRoutes.post("/avatar/from-social", async (c) => {
  const body = await c.req.json<{ accountId?: string }>();
  if (!body.accountId) return c.json({ error: "Missing accountId", code: "bad_account" }, 400);

  const svc = serviceClient();
  const account = await getAccountForCreator(svc, { creatorId: c.get("userId"), accountId: body.accountId });
  if (!account) return c.json({ error: "Social account not found", code: "not_found" }, 404);
  if (!account.external_avatar_url?.startsWith("https://")) {
    return c.json({ error: "No scanned avatar available", code: "no_avatar" }, 422);
  }

  const { data, error } = await svc
    .from("creators")
    .update({ avatar_url: account.external_avatar_url })
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});

meRoutes.post("/passport/share", async (c) => {
  const token = createPublicToken();
  const tokenHash = hashPublicToken(token);
  const { error } = await serviceClient()
    .from("creator_public_passports")
    .upsert(
      {
        creator_id: c.get("userId"),
        public_token_hash: tokenHash,
        enabled: true,
        revoked_at: null,
      },
      { onConflict: "creator_id" },
    );
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ token, publicUrl: `/passport/${token}` });
});

meRoutes.delete("/passport/share", async (c) => {
  const { error } = await serviceClient()
    .from("creator_public_passports")
    .update({ enabled: false, revoked_at: new Date().toISOString() })
    .eq("creator_id", c.get("userId"));
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ revoked: true });
});
```

- [ ] **Step 5: Add public route and mount it**

Create `server/routes/public.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { getPublicPassportByToken } from "../lib/publicPassport.js";

export const publicRoutes = new Hono<Env>();

publicRoutes.get("/passports/:token", async (c) => {
  const passport = await getPublicPassportByToken(c.req.param("token"));
  if (!passport) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(passport);
});
```

Modify `server/app.ts`:

```ts
import { publicRoutes } from "./routes/public.js";
```

Before the guarded app is mounted:

```ts
  app.route("/public", publicRoutes);
```

- [ ] **Step 6: Run backend public passport tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/public-passport.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/tokens.ts server/lib/publicPassport.ts server/routes/public.ts server/routes/me.ts server/app.ts server/test/public-passport.test.ts
git commit -m "feat: add public passport sharing"
```

---

### Task 7: Frontend Query Types And Hooks

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Modify: `src/lib/queries/kocmax.test.tsx`

**Interfaces:**
- Consumes API routes from Tasks 4 and 6
- Produces hooks:
  - `useSocialAccounts()`
  - `useAddSocialAccount()`
  - `useScanSocialAccount()`
  - `useUseSocialAvatar()`
  - `useCreatePassportShare()`
  - `useRevokePassportShare()`
  - `usePublicPassport(token: string)`

- [ ] **Step 1: Add hook tests**

First change the import in `src/lib/queries/kocmax.test.tsx` from named query imports to a namespace import:

```ts
import * as queries from "./kocmax";
```

Then update existing hook calls in that file to `queries.useMissions()`, `queries.useUpdateProfile()`, and `queries.useMyPassport()`.

Append these tests:

```ts
it("fetches social trust accounts from /social/accounts", async () => {
  vi.spyOn(api, "apiFetch").mockResolvedValueOnce({ accounts: [] });
  const { result } = renderHook(() => queries.useSocialAccounts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.apiFetch).toHaveBeenCalledWith("/social/accounts");
});

it("scans a social account through /social/accounts/:id/scan", async () => {
  vi.spyOn(api, "apiFetch").mockResolvedValueOnce({ account: { id: "acc-1" }, labels: ["API-synced", "Ownership not verified"] });
  const { result } = renderHook(() => queries.useScanSocialAccount(), { wrapper });
  result.current.mutate("acc-1");
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.apiFetch).toHaveBeenCalledWith("/social/accounts/acc-1/scan", { method: "POST" });
});

it("fetches a public passport by token", async () => {
  vi.spyOn(api, "apiFetch").mockResolvedValueOnce({
    creator: { displayName: "KOC", avatarUrl: null, level: "L1", xp: 500 },
    scores: { influence: 50, reliability: null, content: null, brandSafety: null },
    badges: [],
    socialTrustBadges: ["social_scan_connected"],
  });
  const { result } = renderHook(() => queries.usePublicPassport("token-1"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.apiFetch).toHaveBeenCalledWith("/public/passports/token-1");
});
```

- [ ] **Step 2: Add types and hooks**

Modify `src/lib/queries/kocmax.ts`:

```ts
export type SocialPlatform = "instagram" | "threads";
export type SocialSyncStatus = "pending" | "synced" | "stale" | "failed" | "rate_limited";
export type SocialAccount = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  profile_url?: string | null;
  owner_verified: boolean;
  api_synced_at?: string | null;
  sync_status: SocialSyncStatus;
  follower_count?: number | null;
  following_count?: number | null;
  post_count?: number | null;
  bio?: string | null;
  external_avatar_url?: string | null;
  engagement_rate?: number | null;
  avg_likes?: number | null;
  avg_comments?: number | null;
  posting_frequency?: number | null;
  freshness_score?: number | null;
  content_themes?: string[];
  last_error_code?: string | null;
  last_error_message?: string | null;
};

export type SocialTrust = {
  accounts: Array<{
    id: string;
    platform: SocialPlatform;
    handle: string;
    followerCount: number | null;
    engagementRate: number | null;
    avgLikes: number | null;
    avgComments: number | null;
    freshnessScore: number | null;
    apiSyncedAt: string | null;
    ownerVerified: boolean;
    labels: string[];
  }>;
  badges: string[];
};

export type PassportShare = { token: string; publicUrl: string };

export type PublicPassport = {
  creator: { displayName: string; avatarUrl: string | null; level: string; xp: number };
  scores: Passport["scores"];
  badges: string[];
  socialTrustBadges: string[];
};
```

Extend `Passport`:

```ts
  socialTrust?: SocialTrust;
```

Add hooks:

```ts
export function useSocialAccounts() {
  return useQuery({
    queryKey: ["social-accounts"],
    queryFn: async () => (await apiFetch<{ accounts: SocialAccount[] }>("/social/accounts")).accounts,
  });
}

export function useAddSocialAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { platform: SocialPlatform; handle: string }) =>
      apiFetch<SocialAccount>("/social/accounts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-accounts"] }),
  });
}

export function useScanSocialAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ account: SocialAccount; labels: string[] }>(`/social/accounts/${id}/scan`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-accounts"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useUseSocialAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<Me>("/me/avatar/from-social", { method: "POST", body: JSON.stringify({ accountId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useCreatePassportShare() {
  return useMutation({
    mutationFn: () => apiFetch<PassportShare>("/me/passport/share", { method: "POST" }),
  });
}

export function useRevokePassportShare() {
  return useMutation({
    mutationFn: () => apiFetch<{ revoked: boolean }>("/me/passport/share", { method: "DELETE" }),
  });
}

export function usePublicPassport(token: string) {
  return useQuery({
    queryKey: ["public-passport", token],
    queryFn: () => apiFetch<PublicPassport>(`/public/passports/${token}`),
    enabled: Boolean(token),
  });
}
```

- [ ] **Step 3: Run query tests**

Run:

```bash
vitest run src/lib/queries/kocmax.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/kocmax.ts src/lib/queries/kocmax.test.tsx
git commit -m "feat: add social trust query hooks"
```

---

### Task 8: Profile Trust UI And Explicit Avatar Selection

**Files:**
- Create: `src/components/SocialTrustPanel.tsx`
- Test: `src/components/SocialTrustPanel.test.tsx`
- Modify: `src/routes/_app.profile.tsx`
- Modify: `src/routes/-_app.profile.test.tsx`

**Interfaces:**
- Consumes hooks from Task 7
- Produces UI labels `API-synced` and `Ownership not verified`
- Produces explicit `Use as Adfocate avatar` action

- [ ] **Step 1: Write component tests**

Create `src/components/SocialTrustPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialTrustPanel } from "./SocialTrustPanel";

const hoisted = vi.hoisted(() => ({
  accounts: [
    {
      id: "acc-1",
      platform: "instagram",
      handle: "ming",
      owner_verified: false,
      sync_status: "synced",
      follower_count: 12000,
      engagement_rate: 4.5,
      avg_likes: 500,
      avg_comments: 40,
      api_synced_at: "2026-06-17T00:00:00.000Z",
      external_avatar_url: "https://cdn.example.com/avatar.jpg",
    },
  ],
  add: vi.fn(),
  scan: vi.fn(),
  avatar: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useSocialAccounts: () => ({ data: hoisted.accounts, isLoading: false, isError: false }),
  useAddSocialAccount: () => ({ mutateAsync: hoisted.add, isPending: false }),
  useScanSocialAccount: () => ({ mutateAsync: hoisted.scan, isPending: false }),
  useUseSocialAvatar: () => ({ mutateAsync: hoisted.avatar, isPending: false }),
}));

describe("SocialTrustPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.add.mockResolvedValue({});
    hoisted.scan.mockResolvedValue({});
    hoisted.avatar.mockResolvedValue({});
  });

  it("shows synced metrics with required trust labels", () => {
    render(<SocialTrustPanel />);
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("@ming")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("4.5%")).toBeInTheDocument();
  });

  it("adds a Threads handle and scans an account", async () => {
    render(<SocialTrustPanel />);
    fireEvent.change(screen.getByLabelText("Threads handle"), { target: { value: "@threadming" } });
    fireEvent.click(screen.getByText("Save Threads"));
    await waitFor(() => expect(hoisted.add).toHaveBeenCalledWith({ platform: "threads", handle: "@threadming" }));

    fireEvent.click(screen.getByText("Refresh Instagram"));
    await waitFor(() => expect(hoisted.scan).toHaveBeenCalledWith("acc-1"));
  });

  it("uses the scanned avatar only after explicit selection", async () => {
    render(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Use as Adfocate avatar"));
    await waitFor(() => expect(hoisted.avatar).toHaveBeenCalledWith("acc-1"));
  });
});
```

- [ ] **Step 2: Implement `SocialTrustPanel`**

Create `src/components/SocialTrustPanel.tsx`:

```tsx
import { useState } from "react";
import {
  useAddSocialAccount,
  useScanSocialAccount,
  useSocialAccounts,
  useUseSocialAvatar,
  type SocialPlatform,
} from "@/lib/queries/kocmax";

const PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: "instagram", label: "Instagram" },
  { id: "threads", label: "Threads" },
];

function formatNumber(value?: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value?: number | null) {
  return value == null ? "—" : `${value}%`;
}

export function SocialTrustPanel() {
  const accounts = useSocialAccounts();
  const add = useAddSocialAccount();
  const scan = useScanSocialAccount();
  const avatar = useUseSocialAvatar();
  const [handles, setHandles] = useState<Record<SocialPlatform, string>>({ instagram: "", threads: "" });

  if (accounts.isLoading) return <p className="text-sm text-[var(--color-soft-ink)]">Loading social trust...</p>;
  if (accounts.isError) return <p className="text-sm text-[var(--color-magenta)]">Social trust failed to load</p>;

  return (
    <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
      <h2 className="font-heading font-bold">Social trust</h2>
      <div className="space-y-3">
        {PLATFORMS.map((platform) => {
          const account = accounts.data?.find((a) => a.platform === platform.id);
          return (
            <div key={platform.id} className="space-y-2 rounded-xl border-2 border-[var(--color-ink)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading font-bold">{platform.label}</span>
                {account?.sync_status === "synced" && (
                  <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                    API-synced
                  </span>
                )}
              </div>

              {account ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--color-soft-ink)]">@{account.handle}</span>
                    <span className="font-heading font-bold">{formatNumber(account.follower_count)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>Engagement {formatPercent(account.engagement_rate)}</span>
                    <span>Avg likes {formatNumber(account.avg_likes)}</span>
                    <span>Avg comments {formatNumber(account.avg_comments)}</span>
                    <span>Freshness {account.freshness_score ?? "—"}</span>
                  </div>
                  <p className="text-xs font-bold text-[var(--color-soft-ink)]">Ownership not verified</p>
                  {account.api_synced_at && (
                    <p className="text-xs text-[var(--color-soft-ink)]">
                      Last synced {new Date(account.api_synced_at).toLocaleDateString()}
                    </p>
                  )}
                  {account.external_avatar_url && (
                    <div className="flex items-center gap-3">
                      <img
                        src={account.external_avatar_url}
                        alt=""
                        className="h-10 w-10 rounded-full border-2 border-[var(--color-ink)] object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => avatar.mutateAsync(account.id)}
                        className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-bold"
                      >
                        Use as Adfocate avatar
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => scan.mutateAsync(account.id)}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
                  >
                    Refresh {platform.label}
                  </button>
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={handles[platform.id]}
                    onChange={(event) => setHandles((h) => ({ ...h, [platform.id]: event.target.value }))}
                    aria-label={`${platform.label} handle`}
                    className="min-w-0 flex-1 rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => add.mutateAsync({ platform: platform.id, handle: handles[platform.id] })}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
                  >
                    Save {platform.label}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render panel on Profile**

Modify `src/routes/_app.profile.tsx`:

```tsx
import { SocialTrustPanel } from "@/components/SocialTrustPanel";
```

In the non-editing profile layout, after the existing social account section, add:

```tsx
          <SocialTrustPanel />
```

- [ ] **Step 4: Update profile test mocks**

Modify `src/routes/-_app.profile.test.tsx` query mock:

```ts
  useSocialAccounts: () => ({ data: [], isLoading: false, isError: false }),
  useAddSocialAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useScanSocialAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUseSocialAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
```

Add assertion to the render test:

```ts
expect(screen.getByText("Social trust")).toBeInTheDocument();
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
vitest run src/components/SocialTrustPanel.test.tsx src/routes/-_app.profile.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SocialTrustPanel.tsx src/components/SocialTrustPanel.test.tsx src/routes/_app.profile.tsx src/routes/-_app.profile.test.tsx
git commit -m "feat: add profile social trust panel"
```

---

### Task 9: Passport Trust Summary And Public Passport Page

**Files:**
- Create: `src/components/PassportTrustSummary.tsx`
- Create: `src/components/PublicPassportView.tsx`
- Create: `src/routes/passport.$token.tsx`
- Test: `src/components/PassportTrustSummary.test.tsx`
- Test: `src/routes/-passport.$token.test.tsx`
- Modify: `src/routes/_app.passport.tsx`
- Modify: `src/routes/-_app.passport.test.tsx`

**Interfaces:**
- Consumes `Passport.socialTrust` from Task 5
- Consumes `useCreatePassportShare`, `useRevokePassportShare`, `usePublicPassport` from Task 7
- Public route path: `/passport/$token`

- [ ] **Step 1: Write component and route tests**

Create `src/components/PassportTrustSummary.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PassportTrustSummary } from "./PassportTrustSummary";

describe("PassportTrustSummary", () => {
  it("renders private synced metrics and trust labels", () => {
    render(
      <PassportTrustSummary
        socialTrust={{
          badges: ["social_scan_connected", "active_creator"],
          accounts: [
            {
              id: "acc-1",
              platform: "instagram",
              handle: "ming",
              followerCount: 12000,
              engagementRate: 4.5,
              avgLikes: 500,
              avgComments: 40,
              freshnessScore: 100,
              apiSyncedAt: "2026-06-17T00:00:00.000Z",
              ownerVerified: false,
              labels: ["API-synced", "Ownership not verified"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("12,000 followers")).toBeInTheDocument();
    expect(screen.getByText("4.5% engagement")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
  });
});
```

Create `src/routes/-passport.$token.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useParams: () => ({ token: "token-1" }),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  usePublicPassport: () => ({
    isLoading: false,
    isError: false,
    data: {
      creator: { displayName: "阿明", avatarUrl: null, level: "L1", xp: 500 },
      scores: { influence: 50, reliability: null, content: null, brandSafety: null },
      badges: ["social_linked"],
      socialTrustBadges: ["social_scan_connected", "active_creator"],
    },
  }),
}));

import { Route } from "./passport.$token";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("public passport route", () => {
  it("renders public-safe creator passport badges", () => {
    renderRoute();
    expect(screen.getByText("阿明")).toBeInTheDocument();
    expect(screen.getByText("Social scan connected")).toBeInTheDocument();
    expect(screen.getByText("Active creator")).toBeInTheDocument();
    expect(screen.queryByText(/followers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/engagement/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement trust summary component**

Create `src/components/PassportTrustSummary.tsx`:

```tsx
import type { SocialTrust } from "@/lib/queries/kocmax";

function number(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

export function PassportTrustSummary({ socialTrust }: { socialTrust?: SocialTrust }) {
  if (!socialTrust?.accounts.length) {
    return (
      <section className="space-y-2">
        <h2 className="font-heading font-bold">Social trust</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">Connect Instagram or Threads to sync public creator metrics.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading font-bold">Social trust</h2>
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
        {socialTrust.accounts.map((account) => (
          <div key={account.id} className="space-y-2 border-b-2 border-[var(--color-ink)] pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between">
              <span className="font-heading font-bold capitalize">{account.platform}</span>
              <span className="text-sm text-[var(--color-soft-ink)]">@{account.handle}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>{number(account.followerCount)} followers</span>
              <span>{account.engagementRate ?? "—"}% engagement</span>
              <span>{number(account.avgLikes)} avg likes</span>
              <span>{number(account.avgComments)} avg comments</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {account.labels.map((label) => (
                <span key={label} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                  {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Implement public view component**

Create `src/components/PublicPassportView.tsx`:

```tsx
import { LEVELS, levelIndex } from "@/lib/levels";
import { BADGES, SCORE_META, SCORE_ORDER } from "@/lib/passport";
import type { PublicPassport } from "@/lib/queries/kocmax";
import { ScoreRing } from "./ScoreRing";

const TRUST_BADGES: Record<string, string> = {
  social_scan_connected: "Social scan connected",
  active_creator: "Active creator",
  fresh_profile_activity: "Fresh profile activity",
};

export function PublicPassportView({ passport }: { passport: PublicPassport }) {
  const lvl = LEVELS[levelIndex(passport.creator.level)];
  const initial = (passport.creator.displayName[0] ?? "?").toUpperCase();
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
            {passport.creator.avatarUrl ? <img src={passport.creator.avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold">{passport.creator.displayName}</h1>
            <p className="font-heading font-bold">
              <span aria-hidden>{lvl.emoji}</span> {lvl.label} · {passport.creator.xp} XP
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">Creator scores</h2>
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
          {SCORE_ORDER.map((k) => (
            <ScoreRing key={k} value={passport.scores[k]} label={SCORE_META[k].label} accent={SCORE_META[k].accent} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">Trust badges</h2>
        <div className="grid grid-cols-2 gap-3">
          {passport.socialTrustBadges.map((id) => (
            <div key={id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
              {TRUST_BADGES[id] ?? id}
            </div>
          ))}
          {passport.badges.map((id) => {
            const badge = BADGES[id];
            if (!badge) return null;
            return (
              <div key={id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
                {badge.label}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add public route**

Create `src/routes/passport.$token.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { PublicPassportView } from "@/components/PublicPassportView";
import { usePublicPassport } from "@/lib/queries/kocmax";

export const Route = createFileRoute("/passport/$token")({ component: PublicPassportRoute });

function PublicPassportRoute() {
  const { token } = useParams({ from: "/passport/$token" });
  const passport = usePublicPassport(token);

  if (passport.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">Loading passport...</p>
      </div>
    );
  }
  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">Passport unavailable</p>
      </div>
    );
  }

  return <PublicPassportView passport={passport.data} />;
}
```

- [ ] **Step 5: Wire authenticated passport**

Modify `src/routes/_app.passport.tsx`:

```tsx
import { useState } from "react";
import { PassportTrustSummary } from "@/components/PassportTrustSummary";
import { useCreatePassportShare, useRevokePassportShare } from "@/lib/queries/kocmax";
```

Inside `Passport()`, initialize:

```tsx
  const share = useCreatePassportShare();
  const revoke = useRevokePassportShare();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
```

After badges section, add:

```tsx
      <PassportTrustSummary socialTrust={p.socialTrust} />

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
        <h2 className="font-heading font-bold">Public passport</h2>
        {shareUrl && <p className="break-all text-sm text-[var(--color-soft-ink)]">{shareUrl}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              const result = await share.mutateAsync();
              setShareUrl(result.publicUrl);
              await navigator.clipboard?.writeText(result.publicUrl);
            }}
            className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 text-sm font-bold"
          >
            Create link
          </button>
          <button
            type="button"
            onClick={async () => {
              await revoke.mutateAsync();
              setShareUrl(null);
            }}
            className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-sm font-bold"
          >
            Revoke link
          </button>
        </div>
      </section>
```

- [ ] **Step 6: Update passport test mocks**

Modify `src/routes/-_app.passport.test.tsx` mocked query module:

```ts
  useCreatePassportShare: () => ({ mutateAsync: vi.fn().mockResolvedValue({ token: "token", publicUrl: "/passport/token" }) }),
  useRevokePassportShare: () => ({ mutateAsync: vi.fn().mockResolvedValue({ revoked: true }) }),
```

Add `socialTrust` to mocked passport data:

```ts
      socialTrust: {
        badges: ["social_scan_connected"],
        accounts: [],
      },
```

- [ ] **Step 7: Run UI tests and route generation**

Run:

```bash
vitest run src/components/PassportTrustSummary.test.tsx src/routes/-_app.passport.test.tsx src/routes/-passport.$token.test.tsx
npm run type-check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/PassportTrustSummary.tsx src/components/PassportTrustSummary.test.tsx src/components/PublicPassportView.tsx src/routes/passport.\$token.tsx src/routes/-passport.\$token.test.tsx src/routes/_app.passport.tsx src/routes/-_app.passport.test.tsx
git commit -m "feat: add passport trust sharing ui"
```

---

### Task 10: Weekly Refresh, Ops Docs, And Full Verification

**Files:**
- Create: `server/routes/cron.ts`
- Modify: `server/app.ts`
- Modify: `vercel.json`
- Create: `server/test/cron-social-refresh.test.ts`
- Create: `docs/ops/trust-profile-env.md`

**Interfaces:**
- Produces `GET /api/cron/social-refresh`
- Consumes `CRON_SECRET`
- Consumes `refreshDueSocialAccounts(limit?: number)`

- [ ] **Step 1: Write cron route tests**

Create `server/test/cron-social-refresh.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../app";

vi.mock("../lib/social/service.js", () => ({
  refreshDueSocialAccounts: vi.fn().mockResolvedValue({ scanned: 2, failed: 1 }),
}));

const { refreshDueSocialAccounts } = await import("../lib/social/service.js");
const { app } = createApp();

describe("social refresh cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret-1234567890";
  });

  it("rejects requests without the Vercel cron bearer token", async () => {
    const res = await app.request("/api/cron/social-refresh");
    expect(res.status).toBe(401);
  });

  it("refreshes due accounts when authorized", async () => {
    const res = await app.request("/api/cron/social-refresh", {
      headers: { Authorization: "Bearer secret-1234567890" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 2, failed: 1 });
    expect(refreshDueSocialAccounts).toHaveBeenCalledWith(25);
  });
});
```

- [ ] **Step 2: Implement cron route**

Create `server/routes/cron.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { refreshDueSocialAccounts } from "../lib/social/service.js";

export const cronRoutes = new Hono<Env>();

cronRoutes.get("/social-refresh", async (c) => {
  const expected = process.env.CRON_SECRET;
  const auth = c.req.header("Authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  }
  const result = await refreshDueSocialAccounts(25);
  return c.json(result);
});
```

Modify `server/app.ts`:

```ts
import { cronRoutes } from "./routes/cron.js";
```

Before guarded routes:

```ts
  app.route("/cron", cronRoutes);
```

- [ ] **Step 3: Add Vercel cron config**

Modify `vercel.json` while preserving redirects and rewrites:

```json
{
  "crons": [
    { "path": "/api/cron/social-refresh", "schedule": "0 3 * * 1" }
  ],
  "redirects": [
    { "source": "/kocmax/demo", "destination": "/home" },
    { "source": "/kocmax/demo/", "destination": "/home" },
    { "source": "/kocmax/demo/:path*", "destination": "/:path*" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 4: Add ops documentation**

Create `docs/ops/trust-profile-env.md`:

```md
# Trust Profile Bundle Environment

Required for live social scans:

- `RAPIDAPI_KEY`: RapidAPI key, server-only.
- `RAPIDAPI_INSTAGRAM_PROFILE_URL`: Instagram profile endpoint. Default production value: `https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php`.
- `RAPIDAPI_THREADS_PROFILE_URL`: Threads profile endpoint from the subscribed RapidAPI provider console.
- `CRON_SECRET`: Random value of at least 16 characters. Vercel sends it as `Authorization: Bearer <value>` to cron paths.

Public privacy rules:

- Public passport does not expose social handles, raw follower counts, engagement rates, recent post summaries, provider payloads, or external avatar source URLs.
- A fetched social avatar appears publicly only after the creator chooses it as their Adfocate avatar.

Operational checks:

- Manual scan path: `POST /api/social/accounts/:id/scan`.
- Weekly scan path: `GET /api/cron/social-refresh`.
- Cron schedule: Mondays at 03:00 UTC.
```

- [ ] **Step 5: Run cron tests**

Run:

```bash
vitest run server/test/cron-social-refresh.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run type-check
npm run test
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/social-schema.test.ts server/test/social.test.ts server/test/passport.test.ts server/test/public-passport.test.ts
npm run build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/cron.ts server/app.ts vercel.json server/test/cron-social-refresh.test.ts docs/ops/trust-profile-env.md
git commit -m "feat: add weekly social trust refresh"
```

---

## Final Review Checklist

- [ ] `RAPIDAPI_KEY` is read only on the server.
- [ ] Missing RapidAPI config returns `provider_not_configured` and does not break profile/passport pages.
- [ ] `API-synced` and `Ownership not verified` appear on private social metrics.
- [ ] Public passport serializer excludes handles, raw counts, engagement rates, recent posts, provider payloads, and external avatar source URLs.
- [ ] Avatar is public only after `POST /api/me/avatar/from-social`.
- [ ] Passport influence uses API-synced counts when at least one synced count exists.
- [ ] Self-reported follower fallback still works when no synced counts exist.
- [ ] Weekly refresh uses `GET /api/cron/social-refresh` and validates `Authorization: Bearer ${CRON_SECRET}`.
- [ ] `npm run type-check`, `npm run test`, targeted integration tests, and `npm run build` pass.
