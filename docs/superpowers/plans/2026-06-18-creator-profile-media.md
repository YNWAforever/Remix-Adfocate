# Creator Profile Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build creator-owned avatar upload, portfolio links, explicit public passport publishing, private completeness scoring, and operator review visibility.

**Architecture:** Add a Supabase-backed profile media domain with private draft portfolio rows and a public-safe snapshot row. Hono routes own validation and publishing, React profile UI owns creator editing, public passport reads only the snapshot, and operator CRM reads private review-safe media projections.

**Tech Stack:** Supabase Postgres/RLS/Storage, Hono, TypeScript, React 19, TanStack Query, TanStack Router, Vitest, Testing Library, Vite.

## Global Constraints

- Creator publish action governs public visibility in v1.
- Operators can review richer profile media, but they do not approve it before it appears publicly.
- Public passport can show the selected avatar URL after explicit publish.
- Public passport can show selected portfolio highlights after explicit publish, capped at 3.
- Public passport must not expose unselected `external_avatar_url`, social handles, follower counts, engagement, recent post data, provider payloads, scan errors, or operator notes.
- Profile completeness is private and operator-visible only. It is guidance, not a public badge.
- API-synced social data remains labeled as API-synced and must not imply account ownership.
- RapidAPI keys are not required for this phase. Social scan metrics appear only when existing trust profile data exists.
- Avatar uploads use Supabase Storage bucket `creator-avatars`, with creator-owned object prefixes and public-read object URLs.

---

## Scope Check

This is one implementable subsystem: creator profile media. The plan intentionally excludes new social provider work, ownership verification, thumbnail scraping, and operator approval gates.

## File Structure

- Create `supabase/migrations/0015_creator_profile_media.sql`: storage bucket, portfolio links, public snapshots, RLS, grants, triggers, and highlight caps.
- Modify `server/test/helpers.ts`: cleanup new profile media rows.
- Create `server/test/profile-media-schema.test.ts`: schema/RLS/storage bucket regression tests.
- Create `server/lib/profileMedia/types.ts`: shared server profile media types and constants.
- Create `server/lib/profileMedia/service.ts`: URL/avatar validation, row serialization, completeness scoring, and public snapshot sanitization.
- Create `server/lib/profileMedia/service.test.ts`: pure unit tests for validators and serializers.
- Create `server/lib/profileMedia/repo.ts`: Supabase reads/writes for profile media, publishing, and operator projections.
- Create `server/routes/profileMedia.ts`: authenticated creator profile-media API under `/api/me/profile-media`.
- Modify `server/app.ts`: mount `profileMediaRoutes`.
- Create `server/test/profile-media.test.ts`: integration tests for creator API behavior.
- Modify `server/lib/publicPassport.ts`: read public avatar/highlights from `creator_public_profile_snapshots`.
- Modify `server/test/public-passport.test.ts`: require publish before avatar/highlights appear and assert privacy.
- Modify `src/lib/queries/kocmax.ts`: add profile-media/public passport types and hooks.
- Modify `src/components/PublicPassportView.tsx`: render published highlights only.
- Modify `src/routes/-passport.$token.test.tsx`: public highlight rendering and leak checks.
- Modify `server/lib/operatorCrm/types.ts`: add operator profile-media projections.
- Modify `server/lib/operatorCrm/repo.ts`: include media summaries in queue/detail responses.
- Modify `src/lib/admin.ts`: add profile-media fields to admin response types.
- Modify `src/routes/operator.creators.$creatorId.tsx`: add profile media review section.
- Modify `src/routes/-operator.creators.$creatorId.test.tsx`: assert operator media review rendering.
- Create `src/components/CreatorProfileMediaPanel.tsx`: avatar upload, portfolio CRUD, highlight toggles, completeness, and publish UI.
- Create `src/components/CreatorProfileMediaPanel.test.tsx`: component behavior tests.
- Modify `src/routes/_app.profile.tsx`: render the media panel.
- Modify `src/routes/-_app.profile.test.tsx`: mock hooks and assert the panel appears.

---

### Task 1: Schema, Storage Bucket, And RLS

**Files:**
- Create: `supabase/migrations/0015_creator_profile_media.sql`
- Modify: `server/test/helpers.ts`
- Test: `server/test/profile-media-schema.test.ts`

**Interfaces:**
- Produces table `public.creator_portfolio_links`.
- Produces table `public.creator_public_profile_snapshots`.
- Produces storage bucket `creator-avatars`.
- Produces constraint behavior: max 3 `public_highlight = true` rows per creator/workspace.
- Produces public snapshot shape: `avatar_url text`, `highlights jsonb`, `published_at timestamptz`.

- [ ] **Step 1: Write the failing schema test**

Create `server/test/profile-media-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("creator profile media schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets a creator CRUD only their own portfolio links", async () => {
    const c1 = await makeCreator("profile-media-rls-1@test.local");
    const c2 = await makeCreator("profile-media-rls-2@test.local");
    const user1 = userForJwt(c1.jwt);
    const user2 = userForJwt(c2.jwt);

    const { data: own, error: insertErr } = await user1
      .from("creator_portfolio_links")
      .insert({
        creator_id: c1.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/work",
        title: "Launch reel",
        platform_type: "instagram",
        caption: "Beauty launch",
        sort_order: 10,
        public_highlight: true,
      })
      .select("id, creator_id, title, public_highlight")
      .single();

    expect(insertErr).toBeNull();
    expect(own).toMatchObject({ creator_id: c1.userId, title: "Launch reel", public_highlight: true });

    const { data: visibleToOwner, error: ownerReadErr } = await user1
      .from("creator_portfolio_links")
      .select("id, title");
    expect(ownerReadErr).toBeNull();
    expect(visibleToOwner).toHaveLength(1);

    const { data: visibleToOther, error: otherReadErr } = await user2
      .from("creator_portfolio_links")
      .select("id, title");
    expect(otherReadErr).toBeNull();
    expect(visibleToOther).toEqual([]);

    const { error: otherUpdateErr } = await user2
      .from("creator_portfolio_links")
      .update({ title: "Cross-tenant edit" })
      .eq("id", own!.id);
    expect(otherUpdateErr).not.toBeNull();
  });

  it("enforces at most three public highlights per creator", async () => {
    const creator = await makeCreator("profile-media-highlight-cap@test.local");
    const svc = serviceForTests();

    const rows = [1, 2, 3].map((n) => ({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: `https://example.com/work-${n}`,
      title: `Work ${n}`,
      platform_type: "website",
      sort_order: n,
      public_highlight: true,
    }));

    const { error: firstErr } = await svc.from("creator_portfolio_links").insert(rows);
    expect(firstErr).toBeNull();

    const { error: fourthErr } = await svc.from("creator_portfolio_links").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: "https://example.com/work-4",
      title: "Work 4",
      platform_type: "website",
      sort_order: 4,
      public_highlight: true,
    });

    expect(fourthErr).not.toBeNull();
    expect(fourthErr?.message).toContain("creator_portfolio_links highlight limit exceeded");
  });

  it("keeps public profile snapshots service-owned and bounded", async () => {
    const creator = await makeCreator("profile-media-snapshot@test.local");
    const svc = serviceForTests();
    const user = userForJwt(creator.jwt);

    const { error: directInsertErr } = await user.from("creator_public_profile_snapshots").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [],
      published_by: creator.userId,
    });
    expect(directInsertErr).not.toBeNull();

    const { error: serviceInsertErr } = await svc.from("creator_public_profile_snapshots").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [
        { url: "https://example.com/1", title: "One", platform_type: "website", caption: null, sort_order: 1 },
        { url: "https://example.com/2", title: "Two", platform_type: "website", caption: null, sort_order: 2 },
        { url: "https://example.com/3", title: "Three", platform_type: "website", caption: null, sort_order: 3 },
      ],
      published_by: creator.userId,
    });
    expect(serviceInsertErr).toBeNull();

    const { error: tooManyErr } = await svc.from("creator_public_profile_snapshots").upsert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      avatar_url: "https://cdn.example.com/avatar.jpg",
      highlights: [
        { url: "https://example.com/1", title: "One", platform_type: "website", caption: null, sort_order: 1 },
        { url: "https://example.com/2", title: "Two", platform_type: "website", caption: null, sort_order: 2 },
        { url: "https://example.com/3", title: "Three", platform_type: "website", caption: null, sort_order: 3 },
        { url: "https://example.com/4", title: "Four", platform_type: "website", caption: null, sort_order: 4 },
      ],
      published_by: creator.userId,
    });
    expect(tooManyErr).not.toBeNull();
  });

  it("creates the public creator avatar storage bucket with upload limits", async () => {
    const svc = serviceForTests();
    const { data, error } = await svc
      .schema("storage")
      .from("buckets")
      .select("id, public, file_size_limit, allowed_mime_types")
      .eq("id", "creator-avatars")
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: "creator-avatars",
      public: true,
      file_size_limit: 5_242_880,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    });
  });
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/profile-media-schema.test.ts
```

Expected: FAIL because `creator_portfolio_links` and `creator_public_profile_snapshots` do not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/0015_creator_profile_media.sql`:

```sql
-- Creator Profile Media: private portfolio drafts, public passport snapshots,
-- and creator-owned avatar uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-avatars',
  'creator-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.creator_portfolio_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  url text not null check (url ~* '^https?://'),
  title text not null check (length(trim(title)) > 0),
  platform_type text not null check (
    platform_type in ('instagram', 'threads', 'tiktok', 'youtube', 'website', 'case_study', 'other')
  ),
  caption text,
  sort_order integer not null default 0,
  public_highlight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_portfolio_links_creator_idx
  on public.creator_portfolio_links (workspace_id, creator_id, sort_order, created_at);

create index creator_portfolio_links_highlight_idx
  on public.creator_portfolio_links (workspace_id, creator_id, public_highlight)
  where public_highlight = true;

create table public.creator_public_profile_snapshots (
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  avatar_url text,
  highlights jsonb not null default '[]',
  published_at timestamptz not null default now(),
  published_by uuid not null references public.creators(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, creator_id),
  check (jsonb_typeof(highlights) = 'array'),
  check (jsonb_array_length(highlights) <= 3)
);

create or replace function private.touch_creator_profile_media_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger creator_portfolio_links_set_updated_at
  before update on public.creator_portfolio_links
  for each row execute function private.touch_creator_profile_media_updated_at();

create trigger creator_public_profile_snapshots_set_updated_at
  before update on public.creator_public_profile_snapshots
  for each row execute function private.touch_creator_profile_media_updated_at();

create or replace function private.enforce_creator_portfolio_highlight_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if new.public_highlight then
    select count(*)
      into v_count
      from public.creator_portfolio_links
      where creator_id = new.creator_id
        and workspace_id = new.workspace_id
        and public_highlight = true
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_count >= 3 then
      raise exception 'creator_portfolio_links highlight limit exceeded';
    end if;
  end if;

  return new;
end;
$$;

create trigger creator_portfolio_links_highlight_limit
  before insert or update on public.creator_portfolio_links
  for each row execute function private.enforce_creator_portfolio_highlight_limit();

alter table public.creator_portfolio_links enable row level security;
alter table public.creator_public_profile_snapshots enable row level security;

create policy creator_portfolio_links_self_select
  on public.creator_portfolio_links
  for select using (creator_id = auth.uid());

create policy creator_portfolio_links_self_insert
  on public.creator_portfolio_links
  for insert with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_portfolio_links_self_update
  on public.creator_portfolio_links
  for update using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_portfolio_links_self_delete
  on public.creator_portfolio_links
  for delete using (creator_id = auth.uid());

create policy creator_public_profile_snapshots_self_select
  on public.creator_public_profile_snapshots
  for select using (creator_id = auth.uid());

create policy creator_avatar_objects_public_read
  on storage.objects
  for select
  using (bucket_id = 'creator-avatars');

create policy creator_avatar_objects_self_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy creator_avatar_objects_self_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy creator_avatar_objects_self_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

grant all on public.creator_portfolio_links to service_role;
grant all on public.creator_public_profile_snapshots to service_role;

grant select, insert, update, delete on public.creator_portfolio_links to authenticated;
grant select on public.creator_public_profile_snapshots to authenticated;
```

- [ ] **Step 4: Update integration cleanup**

Modify `server/test/helpers.ts` inside `cleanup()` before deleting social accounts:

```ts
    await service().from("creator_public_profile_snapshots").delete().in("creator_id", ids);
    await service().from("creator_portfolio_links").delete().in("creator_id", ids);
```

The block should sit next to existing creator-owned cleanup calls:

```ts
    await service().from("creator_public_passports").delete().in("creator_id", ids);
    await service().from("creator_public_profile_snapshots").delete().in("creator_id", ids);
    await service().from("creator_portfolio_links").delete().in("creator_id", ids);
    await service().from("creator_social_accounts").delete().in("creator_id", ids);
```

- [ ] **Step 5: Apply migration locally**

Run:

```bash
supabase migration up
```

Expected: migration `0015_creator_profile_media.sql` applies successfully.

- [ ] **Step 6: Run the schema test to verify it passes**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/profile-media-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add supabase/migrations/0015_creator_profile_media.sql server/test/helpers.ts server/test/profile-media-schema.test.ts
git commit -m "feat: add creator profile media schema"
```

---

### Task 2: Profile Media Domain Types, Validation, And Serialization

**Files:**
- Create: `server/lib/profileMedia/types.ts`
- Create: `server/lib/profileMedia/service.ts`
- Test: `server/lib/profileMedia/service.test.ts`

**Interfaces:**
- Produces `PROFILE_MEDIA_BUCKET = "creator-avatars"`.
- Produces `PLATFORM_TYPES`.
- Produces `ProfileMediaError`.
- Produces `normalizePortfolioUrl(input: string): string`.
- Produces `validateAvatarUpload(input): AvatarUploadRequest`.
- Produces `calculateCompleteness(input): ProfileCompleteness`.
- Produces `publicHighlightsFromLinks(links): PublicProfileHighlight[]`.

- [ ] **Step 1: Write the failing service tests**

Create `server/lib/profileMedia/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  calculateCompleteness,
  publicHighlightsFromLinks,
  validateAvatarUpload,
  normalizePortfolioUrl,
  ProfileMediaError,
} from "./service";
import type { ProfileMediaLink } from "./types";

function link(overrides: Partial<ProfileMediaLink>): ProfileMediaLink {
  return {
    id: overrides.id ?? "link-1",
    creatorId: overrides.creatorId ?? "creator-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    url: overrides.url ?? "https://example.com/work",
    title: overrides.title ?? "Work",
    platformType: overrides.platformType ?? "website",
    caption: overrides.caption ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    publicHighlight: overrides.publicHighlight ?? false,
    createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
  };
}

describe("profile media service", () => {
  it("normalizes HTTP URLs and rejects unsafe protocols", () => {
    expect(normalizePortfolioUrl(" example.com/work ")).toBe("https://example.com/work");
    expect(normalizePortfolioUrl("https://example.com/work?x=1")).toBe("https://example.com/work?x=1");
    expect(() => normalizePortfolioUrl("javascript:alert(1)")).toThrow(ProfileMediaError);
    expect(() => normalizePortfolioUrl("ftp://example.com/file")).toThrow(ProfileMediaError);
  });

  it("validates avatar upload metadata", () => {
    expect(validateAvatarUpload({ fileName: "headshot.png", contentType: "image/png", sizeBytes: 1024 })).toEqual({
      fileName: "headshot.png",
      contentType: "image/png",
      sizeBytes: 1024,
      extension: "png",
    });
    expect(() => validateAvatarUpload({ fileName: "headshot.gif", contentType: "image/gif", sizeBytes: 1024 })).toThrow(ProfileMediaError);
    expect(() => validateAvatarUpload({ fileName: "huge.png", contentType: "image/png", sizeBytes: 5_242_881 })).toThrow(ProfileMediaError);
  });

  it("serializes only three selected public highlights", () => {
    const result = publicHighlightsFromLinks([
      link({ id: "private", title: "Private", publicHighlight: false, sortOrder: 0 }),
      link({ id: "three", title: "Three", publicHighlight: true, sortOrder: 30 }),
      link({ id: "one", title: "One", publicHighlight: true, sortOrder: 10 }),
      link({ id: "two", title: "Two", publicHighlight: true, sortOrder: 20 }),
    ]);

    expect(result).toEqual([
      { url: "https://example.com/work", title: "One", platform_type: "website", caption: null, sort_order: 10 },
      { url: "https://example.com/work", title: "Two", platform_type: "website", caption: null, sort_order: 20 },
      { url: "https://example.com/work", title: "Three", platform_type: "website", caption: null, sort_order: 30 },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("creatorId");
  });

  it("calculates private completeness score and checklist", () => {
    const complete = calculateCompleteness({
      avatarUrl: "https://cdn.example.com/avatar.jpg",
      displayName: "Amy",
      bio: "Creator bio",
      categories: ["beauty"],
      portfolioLinks: [link({ publicHighlight: true })],
      hasSocialScan: true,
    });

    expect(complete.score).toBe(100);
    expect(complete.items.every((item) => item.complete)).toBe(true);

    const partial = calculateCompleteness({
      avatarUrl: null,
      displayName: "",
      bio: null,
      categories: [],
      portfolioLinks: [],
      hasSocialScan: false,
    });

    expect(partial.score).toBe(0);
    expect(partial.items.map((item) => item.key)).toEqual([
      "avatar",
      "display_name",
      "bio",
      "categories",
      "portfolio",
      "public_highlight",
      "social_scan",
    ]);
  });
});
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run:

```bash
vitest run server/lib/profileMedia/service.test.ts
```

Expected: FAIL because `server/lib/profileMedia/service.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `server/lib/profileMedia/types.ts`:

```ts
export const PROFILE_MEDIA_BUCKET = "creator-avatars";
export const MAX_AVATAR_BYTES = 5_242_880;
export const ALLOWED_AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PLATFORM_TYPES = ["instagram", "threads", "tiktok", "youtube", "website", "case_study", "other"] as const;

export type AvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];
export type PortfolioPlatformType = (typeof PLATFORM_TYPES)[number];

export type ProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: PortfolioPlatformType;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicProfileHighlight = {
  url: string;
  title: string;
  platform_type: PortfolioPlatformType;
  caption: string | null;
  sort_order: number;
};

export type ProfileCompletenessItem = {
  key: "avatar" | "display_name" | "bio" | "categories" | "portfolio" | "public_highlight" | "social_scan";
  label: string;
  complete: boolean;
};

export type ProfileCompleteness = {
  score: number;
  items: ProfileCompletenessItem[];
};

export type CreatorProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: ProfileMediaLink[];
  publicHighlights: PublicProfileHighlight[];
  published: {
    avatarUrl: string | null;
    highlights: PublicProfileHighlight[];
    publishedAt: string | null;
  };
  completeness: ProfileCompleteness;
};

export type AvatarUploadRequest = {
  fileName: string;
  contentType: AvatarMimeType;
  sizeBytes: number;
  extension: "jpg" | "png" | "webp";
};
```

- [ ] **Step 4: Add validation and serialization helpers**

Create `server/lib/profileMedia/service.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  PLATFORM_TYPES,
  type AvatarMimeType,
  type AvatarUploadRequest,
  type PortfolioPlatformType,
  type ProfileCompleteness,
  type ProfileMediaLink,
  type PublicProfileHighlight,
} from "./types.js";

export class ProfileMediaError extends Error {
  constructor(
    public code:
      | "bad_url"
      | "bad_title"
      | "bad_platform_type"
      | "bad_avatar_type"
      | "bad_avatar_size"
      | "bad_avatar_path"
      | "highlight_limit"
      | "not_found"
      | "db_error",
    message: string = code,
  ) {
    super(message);
  }
}

const AVATAR_EXTENSIONS: Record<string, AvatarUploadRequest["extension"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function parsePlatformType(value: unknown): PortfolioPlatformType | null {
  return typeof value === "string" && PLATFORM_TYPES.includes(value as PortfolioPlatformType)
    ? (value as PortfolioPlatformType)
    : null;
}

export function normalizePortfolioUrl(input: string): string {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProfileMediaError("bad_url", "Enter a valid portfolio URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProfileMediaError("bad_url", "Portfolio URL must use HTTP or HTTPS");
  }
  return parsed.toString();
}

export function normalizeTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProfileMediaError("bad_title", "Portfolio title is required");
  }
  return value.trim().slice(0, 120);
}

export function normalizeCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const caption = value.trim();
  return caption ? caption.slice(0, 240) : null;
}

export function normalizeSortOrder(value: unknown): number {
  return Number.isInteger(value) ? (value as number) : 0;
}

export function validateAvatarUpload(input: {
  fileName?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
}): AvatarUploadRequest {
  if (typeof input.contentType !== "string" || !ALLOWED_AVATAR_MIME_TYPES.includes(input.contentType as AvatarMimeType)) {
    throw new ProfileMediaError("bad_avatar_type", "Avatar must be a JPG, PNG, or WebP image");
  }
  if (typeof input.sizeBytes !== "number" || input.sizeBytes <= 0 || input.sizeBytes > MAX_AVATAR_BYTES) {
    throw new ProfileMediaError("bad_avatar_size", "Avatar must be 5 MB or smaller");
  }
  const fileName = typeof input.fileName === "string" && input.fileName.trim() ? input.fileName.trim() : "avatar";
  return {
    fileName,
    contentType: input.contentType as AvatarUploadRequest["contentType"],
    sizeBytes: input.sizeBytes,
    extension: AVATAR_EXTENSIONS[input.contentType as AvatarMimeType],
  };
}

export function ownedAvatarPath(creatorId: string, extension: AvatarUploadRequest["extension"], id = randomUUID()) {
  return `${creatorId}/${id}.${extension}`;
}

export function assertOwnedAvatarPath(creatorId: string, storagePath: unknown): string {
  if (typeof storagePath !== "string" || !storagePath.startsWith(`${creatorId}/`) || storagePath.includes("..")) {
    throw new ProfileMediaError("bad_avatar_path", "Avatar path is not owned by this creator");
  }
  return storagePath;
}

export function publicHighlightsFromLinks(links: ProfileMediaLink[]): PublicProfileHighlight[] {
  return links
    .filter((link) => link.publicHighlight)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 3)
    .map((link) => ({
      url: link.url,
      title: link.title,
      platform_type: link.platformType,
      caption: link.caption,
      sort_order: link.sortOrder,
    }));
}

export function calculateCompleteness(input: {
  avatarUrl: string | null;
  displayName: string | null;
  bio: string | null;
  categories: string[];
  portfolioLinks: ProfileMediaLink[];
  hasSocialScan: boolean;
}): ProfileCompleteness {
  const items: ProfileCompleteness["items"] = [
    { key: "avatar", label: "Avatar selected", complete: Boolean(input.avatarUrl) },
    { key: "display_name", label: "Display name added", complete: Boolean(input.displayName?.trim()) },
    { key: "bio", label: "Profile bio added", complete: Boolean(input.bio?.trim()) },
    { key: "categories", label: "Creator categories selected", complete: input.categories.length > 0 },
    { key: "portfolio", label: "Portfolio link added", complete: input.portfolioLinks.length > 0 },
    { key: "public_highlight", label: "Public highlight selected", complete: input.portfolioLinks.some((link) => link.publicHighlight) },
    { key: "social_scan", label: "Social scan connected", complete: input.hasSocialScan },
  ];
  const completeCount = items.filter((item) => item.complete).length;
  return { score: Math.round((completeCount / items.length) * 100), items };
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
vitest run server/lib/profileMedia/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/lib/profileMedia/types.ts server/lib/profileMedia/service.ts server/lib/profileMedia/service.test.ts
git commit -m "feat: add profile media validation"
```

---

### Task 3: Creator Profile Media API

**Files:**
- Create: `server/lib/profileMedia/repo.ts`
- Create: `server/routes/profileMedia.ts`
- Modify: `server/app.ts`
- Test: `server/test/profile-media.test.ts`

**Interfaces:**
- Consumes Task 1 tables and Task 2 helpers.
- Produces `GET /api/me/profile-media`.
- Produces `POST /api/me/profile-media/avatar-upload`.
- Produces `POST /api/me/profile-media/avatar-select`.
- Produces `POST /api/me/profile-media/portfolio`.
- Produces `PATCH /api/me/profile-media/portfolio/:id`.
- Produces `DELETE /api/me/profile-media/portfolio/:id`.
- Produces `POST /api/me/profile-media/publish`.

- [ ] **Step 1: Write failing API tests**

Create `server/test/profile-media.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests } from "./helpers";

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

suite("creator profile media API", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates, updates, caps, and deletes portfolio links", async () => {
    const creator = await makeCreator("profile-media-api@test.local");

    const created = await req("/me/profile-media/portfolio", creator.jwt, {
      method: "POST",
      body: JSON.stringify({
        url: "example.com/launch",
        title: "Launch reel",
        platform_type: "instagram",
        caption: "Beauty launch",
        sort_order: 2,
        public_highlight: true,
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.link).toMatchObject({
      url: "https://example.com/launch",
      title: "Launch reel",
      platformType: "instagram",
      publicHighlight: true,
    });

    const patched = await req(`/me/profile-media/portfolio/${createdBody.link.id}`, creator.jwt, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated reel", caption: "" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).link).toMatchObject({ title: "Updated reel", caption: null });

    for (const index of [1, 2]) {
      const res = await req("/me/profile-media/portfolio", creator.jwt, {
        method: "POST",
        body: JSON.stringify({
          url: `https://example.com/highlight-${index}`,
          title: `Highlight ${index}`,
          platform_type: "website",
          public_highlight: true,
        }),
      });
      expect(res.status).toBe(200);
    }

    const fourth = await req("/me/profile-media/portfolio", creator.jwt, {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com/highlight-4",
        title: "Highlight 4",
        platform_type: "website",
        public_highlight: true,
      }),
    });
    expect(fourth.status).toBe(400);
    expect((await fourth.json()).code).toBe("highlight_limit");

    const deleted = await req(`/me/profile-media/portfolio/${createdBody.link.id}`, creator.jwt, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).deleted).toBe(true);
  }, 120_000);

  it("returns upload metadata and selects an owned uploaded avatar", async () => {
    const creator = await makeCreator("profile-media-avatar@test.local");
    const upload = await req("/me/profile-media/avatar-upload", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ fileName: "face.png", contentType: "image/png", sizeBytes: 1024 }),
    });
    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    expect(uploadBody.bucket).toBe("creator-avatars");
    expect(uploadBody.path).toMatch(new RegExp(`^${creator.userId}/.+\\.png$`));
    expect(uploadBody.publicUrl).toContain("/storage/v1/object/public/creator-avatars/");

    const svc = serviceForTests();
    const { error: objectErr } = await svc.storage
      .from("creator-avatars")
      .upload(uploadBody.path, new Blob(["avatar"], { type: "image/png" }), { contentType: "image/png" });
    expect(objectErr).toBeNull();

    const selected = await req("/me/profile-media/avatar-select", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ storagePath: uploadBody.path }),
    });
    expect(selected.status).toBe(200);
    expect((await selected.json()).avatarUrl).toBe(uploadBody.publicUrl);
  }, 120_000);

  it("publishes only public-safe avatar and selected highlights", async () => {
    const creator = await makeCreator("profile-media-publish@test.local");
    const svc = serviceForTests();

    await svc.from("creators").update({ avatar_url: "https://cdn.example.com/selected-avatar.jpg" }).eq("id", creator.userId);
    await svc.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "privatehandle",
      sync_status: "synced",
      follower_count: 123456,
      engagement_rate: 9.9,
      external_avatar_url: "https://cdn.example.com/external-private.jpg",
      api_synced_at: new Date().toISOString(),
    });
    await svc.from("creator_portfolio_links").insert([
      {
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/public",
        title: "Public work",
        platform_type: "website",
        caption: "Launch proof",
        sort_order: 1,
        public_highlight: true,
      },
      {
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/private",
        title: "Private work",
        platform_type: "website",
        sort_order: 2,
        public_highlight: false,
      },
    ]);

    const published = await req("/me/profile-media/publish", creator.jwt, { method: "POST" });
    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.published.avatarUrl).toBe("https://cdn.example.com/selected-avatar.jpg");
    expect(body.published.highlights).toEqual([
      {
        url: "https://example.com/public",
        title: "Public work",
        platform_type: "website",
        caption: "Launch proof",
        sort_order: 1,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("privatehandle");
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(body)).not.toContain("external-private");
  }, 120_000);

  it("returns private completeness to the owner", async () => {
    const creator = await makeCreator("profile-media-completeness@test.local");
    const res = await req("/me/profile-media", creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completeness.score).toBeGreaterThanOrEqual(0);
    expect(body.completeness.items.map((item: { key: string }) => item.key)).toContain("avatar");
    expect(body.published).toEqual({ avatarUrl: null, highlights: [], publishedAt: null });
  }, 120_000);
});
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/profile-media.test.ts
```

Expected: FAIL because `/api/me/profile-media` routes are not mounted.

- [ ] **Step 3: Add the repository**

Create `server/lib/profileMedia/repo.ts` with these exports:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROFILE_MEDIA_BUCKET, type CreatorProfileMedia, type ProfileMediaLink } from "./types.js";
import {
  ProfileMediaError,
  assertOwnedAvatarPath,
  calculateCompleteness,
  normalizeCaption,
  normalizePortfolioUrl,
  normalizeSortOrder,
  normalizeTitle,
  parsePlatformType,
  publicHighlightsFromLinks,
} from "./service.js";

type LinkRow = {
  id: string;
  creator_id: string;
  workspace_id: string;
  url: string;
  title: string;
  platform_type: ProfileMediaLink["platformType"];
  caption: string | null;
  sort_order: number;
  public_highlight: boolean;
  created_at: string;
  updated_at: string;
};

type CreatorBasics = {
  id: string;
  workspace_id: string;
  display_name: string | null;
  avatar_url: string | null;
  categories: string[] | null;
};

type SnapshotRow = {
  avatar_url: string | null;
  highlights: unknown;
  published_at: string;
};

const LINK_PROJECTION =
  "id, creator_id, workspace_id, url, title, platform_type, caption, sort_order, public_highlight, created_at, updated_at";

function failDb(error: { message?: string | null } | null): never {
  throw new ProfileMediaError("db_error", error?.message ?? "db_error");
}

export function projectLink(row: LinkRow): ProfileMediaLink {
  return {
    id: row.id,
    creatorId: row.creator_id,
    workspaceId: row.workspace_id,
    url: row.url,
    title: row.title,
    platformType: row.platform_type,
    caption: row.caption,
    sortOrder: row.sort_order,
    publicHighlight: row.public_highlight,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCreatorBasics(supabase: SupabaseClient, creatorId: string): Promise<CreatorBasics> {
  const { data, error } = await supabase
    .from("creators")
    .select("id, workspace_id, display_name, avatar_url, categories")
    .eq("id", creatorId)
    .single();
  if (error) failDb(error);
  return data as CreatorBasics;
}

export async function listProfileMediaLinks(supabase: SupabaseClient, creatorId: string): Promise<ProfileMediaLink[]> {
  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .select(LINK_PROJECTION)
    .eq("creator_id", creatorId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) failDb(error);
  return ((data ?? []) as LinkRow[]).map(projectLink);
}

export async function getProfileMedia(supabase: SupabaseClient, creatorId: string): Promise<CreatorProfileMedia> {
  const [creator, linksRes, snapshotRes, socialRes] = await Promise.all([
    getCreatorBasics(supabase, creatorId),
    supabase
      .from("creator_portfolio_links")
      .select(LINK_PROJECTION)
      .eq("creator_id", creatorId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("creator_public_profile_snapshots")
      .select("avatar_url, highlights, published_at")
      .eq("creator_id", creatorId)
      .maybeSingle(),
    supabase
      .from("creator_social_accounts")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("sync_status", "synced")
      .limit(1),
  ]);
  if (linksRes.error) failDb(linksRes.error);
  if (snapshotRes.error) failDb(snapshotRes.error);
  if (socialRes.error) failDb(socialRes.error);

  const portfolioLinks = ((linksRes.data ?? []) as LinkRow[]).map(projectLink);
  const publicHighlights = publicHighlightsFromLinks(portfolioLinks);
  const snapshot = snapshotRes.data as SnapshotRow | null;

  return {
    avatarUrl: creator.avatar_url ?? null,
    portfolioLinks,
    publicHighlights,
    published: {
      avatarUrl: snapshot?.avatar_url ?? null,
      highlights: Array.isArray(snapshot?.highlights) ? (snapshot.highlights as CreatorProfileMedia["published"]["highlights"]) : [],
      publishedAt: snapshot?.published_at ?? null,
    },
    completeness: calculateCompleteness({
      avatarUrl: creator.avatar_url ?? null,
      displayName: creator.display_name ?? null,
      bio: null,
      categories: creator.categories ?? [],
      portfolioLinks,
      hasSocialScan: (socialRes.data ?? []).length > 0,
    }),
  };
}

export async function createProfileMediaLink(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    workspaceId: string;
    url: unknown;
    title: unknown;
    platformType: unknown;
    caption?: unknown;
    sortOrder?: unknown;
    publicHighlight?: unknown;
  },
) {
  const platformType = parsePlatformType(input.platformType);
  if (!platformType) throw new ProfileMediaError("bad_platform_type", "Unsupported portfolio type");

  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .insert({
      creator_id: input.creatorId,
      workspace_id: input.workspaceId,
      url: normalizePortfolioUrl(String(input.url ?? "")),
      title: normalizeTitle(input.title),
      platform_type: platformType,
      caption: normalizeCaption(input.caption),
      sort_order: normalizeSortOrder(input.sortOrder),
      public_highlight: input.publicHighlight === true,
    })
    .select(LINK_PROJECTION)
    .single();

  if (error?.message?.includes("highlight limit")) throw new ProfileMediaError("highlight_limit", error.message);
  if (error) failDb(error);
  return projectLink(data as LinkRow);
}

export async function updateProfileMediaLink(
  supabase: SupabaseClient,
  input: { creatorId: string; linkId: string; patch: Record<string, unknown> },
) {
  const patch: Record<string, unknown> = {};
  if ("url" in input.patch) patch.url = normalizePortfolioUrl(String(input.patch.url ?? ""));
  if ("title" in input.patch) patch.title = normalizeTitle(input.patch.title);
  if ("platform_type" in input.patch) {
    const platformType = parsePlatformType(input.patch.platform_type);
    if (!platformType) throw new ProfileMediaError("bad_platform_type", "Unsupported portfolio type");
    patch.platform_type = platformType;
  }
  if ("caption" in input.patch) patch.caption = normalizeCaption(input.patch.caption);
  if ("sort_order" in input.patch) patch.sort_order = normalizeSortOrder(input.patch.sort_order);
  if ("public_highlight" in input.patch) patch.public_highlight = input.patch.public_highlight === true;

  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .update(patch)
    .eq("id", input.linkId)
    .eq("creator_id", input.creatorId)
    .select(LINK_PROJECTION)
    .maybeSingle();

  if (error?.message?.includes("highlight limit")) throw new ProfileMediaError("highlight_limit", error.message);
  if (error) failDb(error);
  if (!data) throw new ProfileMediaError("not_found", "Portfolio link not found");
  return projectLink(data as LinkRow);
}

export async function deleteProfileMediaLink(supabase: SupabaseClient, creatorId: string, linkId: string) {
  const { error } = await supabase
    .from("creator_portfolio_links")
    .delete()
    .eq("id", linkId)
    .eq("creator_id", creatorId);
  if (error) failDb(error);
}

export async function selectUploadedAvatar(
  supabase: SupabaseClient,
  input: { creatorId: string; storagePath: unknown },
) {
  const storagePath = assertOwnedAvatarPath(input.creatorId, input.storagePath);
  const fileName = storagePath.slice(`${input.creatorId}/`.length);
  const { data: objects, error: listError } = await supabase.storage
    .from(PROFILE_MEDIA_BUCKET)
    .list(input.creatorId, { limit: 1, search: fileName });
  if (listError) failDb(listError);
  if (!objects?.some((object) => object.name === fileName)) {
    throw new ProfileMediaError("not_found", "Avatar upload not found");
  }

  const { data } = supabase.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(storagePath);
  const avatarUrl = data.publicUrl;

  const { error } = await supabase
    .from("creators")
    .update({ avatar_url: avatarUrl })
    .eq("id", input.creatorId);
  if (error) failDb(error);

  return avatarUrl;
}

export async function publishProfileMedia(supabase: SupabaseClient, creatorId: string) {
  const creator = await getCreatorBasics(supabase, creatorId);
  const links = await listProfileMediaLinks(supabase, creatorId);
  const highlights = publicHighlightsFromLinks(links);

  const { data, error } = await supabase
    .from("creator_public_profile_snapshots")
    .upsert(
      {
        creator_id: creator.id,
        workspace_id: creator.workspace_id,
        avatar_url: creator.avatar_url,
        highlights,
        published_by: creator.id,
        published_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,creator_id" },
    )
    .select("avatar_url, highlights, published_at")
    .single();
  if (error) failDb(error);

  return {
    avatarUrl: data.avatar_url ?? null,
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    publishedAt: data.published_at,
  };
}
```

- [ ] **Step 4: Add the routes**

Create `server/routes/profileMedia.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { PROFILE_MEDIA_BUCKET } from "../lib/profileMedia/types.js";
import { ProfileMediaError, ownedAvatarPath, validateAvatarUpload } from "../lib/profileMedia/service.js";
import {
  createProfileMediaLink,
  deleteProfileMediaLink,
  getProfileMedia,
  publishProfileMedia,
  selectUploadedAvatar,
  updateProfileMediaLink,
} from "../lib/profileMedia/repo.js";

export const profileMediaRoutes = new Hono<Env>();

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown) {
  if (error instanceof ProfileMediaError) {
    const status = error.code === "not_found" ? 404 : error.code === "db_error" ? 500 : 400;
    return c.json({ error: error.message, code: error.code }, status);
  }
  const message = error instanceof Error ? error.message : "Profile media request failed";
  return c.json({ error: message, code: "db_error" }, 500);
}

profileMediaRoutes.get("/", async (c) => {
  try {
    return c.json(await getProfileMedia(serviceClient(), c.get("userId")));
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/avatar-upload", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const request = validateAvatarUpload({
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
    const path = ownedAvatarPath(c.get("userId"), request.extension);
    const { data } = serviceClient().storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(path);
    return c.json({
      bucket: PROFILE_MEDIA_BUCKET,
      path,
      publicUrl: data.publicUrl,
      contentType: request.contentType,
      maxSizeBytes: 5_242_880,
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/avatar-select", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const avatarUrl = await selectUploadedAvatar(serviceClient(), {
      creatorId: c.get("userId"),
      storagePath: body.storagePath,
    });
    return c.json({ avatarUrl });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/portfolio", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const link = await createProfileMediaLink(serviceClient(), {
      creatorId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
      url: body.url,
      title: body.title,
      platformType: body.platform_type,
      caption: body.caption,
      sortOrder: body.sort_order,
      publicHighlight: body.public_highlight,
    });
    return c.json({ link });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.patch("/portfolio/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const link = await updateProfileMediaLink(serviceClient(), {
      creatorId: c.get("userId"),
      linkId: c.req.param("id"),
      patch: body,
    });
    return c.json({ link });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.delete("/portfolio/:id", async (c) => {
  try {
    await deleteProfileMediaLink(serviceClient(), c.get("userId"), c.req.param("id"));
    return c.json({ deleted: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

profileMediaRoutes.post("/publish", async (c) => {
  try {
    const published = await publishProfileMedia(serviceClient(), c.get("userId"));
    return c.json({ published });
  } catch (error) {
    return errorResponse(c, error);
  }
});
```

- [ ] **Step 5: Mount the routes**

Modify `server/app.ts`:

```ts
import { profileMediaRoutes } from "./routes/profileMedia.js";
```

Mount inside `createApp()` with the guarded routes:

```ts
  guarded.route("/me/profile-media", profileMediaRoutes);
```

Place it after `guarded.route("/me", meRoutes);` and before other feature routes.

- [ ] **Step 6: Run API tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/profile-media.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run related backend tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/me.test.ts server/test/social.test.ts server/test/profile-media.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/lib/profileMedia server/routes/profileMedia.ts server/app.ts server/test/profile-media.test.ts
git commit -m "feat: add creator profile media api"
```

---

### Task 4: Public Passport Snapshot Consumption

**Files:**
- Modify: `server/lib/publicPassport.ts`
- Modify: `server/test/public-passport.test.ts`
- Modify: `src/lib/queries/kocmax.ts`
- Modify: `src/components/PublicPassportView.tsx`
- Modify: `src/routes/-passport.$token.test.tsx`

**Interfaces:**
- Consumes `creator_public_profile_snapshots`.
- Produces public payload field `profileMedia.highlights`.
- Changes public avatar source to `creator_public_profile_snapshots.avatar_url`.
- Public fallback when no snapshot exists is `creator.avatarUrl = null` and `profileMedia.highlights = []`.

- [ ] **Step 1: Update failing backend privacy tests**

In `server/test/public-passport.test.ts`, add `"public-profile-media@test.local"` to `PUBLIC_PASSPORT_EMAILS`.

Replace the old avatar expectation test with:

```ts
  it("shows selected avatar and highlights publicly only after explicit profile media publish", async () => {
    const c = await makeCreator("public-profile-media@test.local");
    const svc = serviceForTests();

    await svc.from("creators").update({ avatar_url: "https://cdn.example.com/draft-avatar.jpg" }).eq("id", c.userId);
    await svc.from("creator_portfolio_links").insert([
      {
        creator_id: c.userId,
        workspace_id: "00000000-0000-0000-0000-0000000000aa",
        url: "https://example.com/public-highlight",
        title: "Public campaign",
        platform_type: "website",
        caption: "Launch recap",
        sort_order: 1,
        public_highlight: true,
      },
      {
        creator_id: c.userId,
        workspace_id: "00000000-0000-0000-0000-0000000000aa",
        url: "https://example.com/private-link",
        title: "Private campaign",
        platform_type: "website",
        caption: "Internal review only",
        sort_order: 2,
        public_highlight: false,
      },
    ]);

    const share = await (await req("/me/passport/share", c.jwt, { method: "POST" })).json();
    const before = await (await app.request(`/api/public/passports/${share.token}`)).json();
    expect(before.creator.avatarUrl).toBeNull();
    expect(before.profileMedia.highlights).toEqual([]);

    const publish = await req("/me/profile-media/publish", c.jwt, { method: "POST" });
    expect(publish.status).toBe(200);

    const after = await (await app.request(`/api/public/passports/${share.token}`)).json();
    expect(after.creator.avatarUrl).toBe("https://cdn.example.com/draft-avatar.jpg");
    expect(after.profileMedia.highlights).toEqual([
      {
        url: "https://example.com/public-highlight",
        title: "Public campaign",
        platform_type: "website",
        caption: "Launch recap",
        sort_order: 1,
      },
    ]);
    expect(JSON.stringify(after)).not.toContain("private-link");
    expect(JSON.stringify(after)).not.toContain("Internal review only");
  }, 120_000);
```

In the existing `"creates, resolves, and revokes a public passport without raw social leaks"` test, add:

```ts
    expect(body.profileMedia.highlights).toEqual([]);
```

- [ ] **Step 2: Run public passport backend tests to verify they fail**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/public-passport.test.ts
```

Expected: FAIL because `profileMedia` is missing and public avatar still reads `creators.avatar_url`.

- [ ] **Step 3: Update server public passport payload**

Modify `server/lib/publicPassport.ts` type:

```ts
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
  profileMedia: {
    highlights: Array<{
      url: string;
      title: string;
      platform_type: string;
      caption: string | null;
      sort_order: number;
    }>;
    publishedAt: string | null;
  };
};
```

Inside `getPublicPassportByToken`, add this query after loading `creator`:

```ts
  const { data: profileMedia, error: profileMediaErr } = await svc
    .from("creator_public_profile_snapshots")
    .select("avatar_url, highlights, published_at")
    .eq("creator_id", share.creator_id)
    .maybeSingle();
  if (profileMediaErr) throw profileMediaErr;
```

Change the returned creator avatar and append profile media:

```ts
    creator: {
      displayName: creator.display_name ?? "KOC",
      avatarUrl: profileMedia?.avatar_url ?? null,
      level: passport.level,
      xp: passport.xp,
    },
    scores: passport.scores,
    badges: publicBadges(passport.badges),
    socialTrustBadges: publicSocialTrustBadges(syncedAccounts),
    profileMedia: {
      highlights: Array.isArray(profileMedia?.highlights) ? profileMedia.highlights : [],
      publishedAt: profileMedia?.published_at ?? null,
    },
```

- [ ] **Step 4: Update frontend public passport types**

Modify `src/lib/queries/kocmax.ts`:

```ts
export type PublicProfileHighlight = {
  url: string;
  title: string;
  platform_type: string;
  caption: string | null;
  sort_order: number;
};

export type PublicPassport = {
  creator: { displayName: string; avatarUrl: string | null; level: string; xp: number };
  scores: Passport["scores"];
  badges: string[];
  socialTrustBadges: string[];
  profileMedia: {
    highlights: PublicProfileHighlight[];
    publishedAt: string | null;
  };
};
```

- [ ] **Step 5: Render public highlights**

Modify `src/components/PublicPassportView.tsx` after the trust badges section:

```tsx
      {passport.profileMedia.highlights.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading font-bold">Creator highlights</h2>
          <div className="space-y-3">
            {passport.profileMedia.highlights.map((highlight) => (
              <a
                key={`${highlight.url}-${highlight.sort_order}`}
                href={highlight.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 shadow-[4px_4px_0_0_var(--color-ink)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading font-bold">{highlight.title}</span>
                  <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                    {highlight.platform_type}
                  </span>
                </div>
                {highlight.caption ? <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{highlight.caption}</p> : null}
              </a>
            ))}
          </div>
        </section>
      ) : null}
```

- [ ] **Step 6: Update public route component test**

Modify mocked `PublicPassport` in `src/routes/-passport.$token.test.tsx`:

```ts
      profileMedia: {
        publishedAt: "2026-06-18T00:00:00.000Z",
        highlights: [
          {
            url: "https://example.com/public",
            title: "Public campaign",
            platform_type: "website",
            caption: "Launch recap",
            sort_order: 1,
          },
        ],
      },
```

Add assertions:

```ts
    expect(screen.getByText("Creator highlights")).toBeInTheDocument();
    expect(screen.getByText("Public campaign")).toBeInTheDocument();
    expect(screen.getByText("Launch recap")).toBeInTheDocument();
```

- [ ] **Step 7: Run public passport tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/public-passport.test.ts
vitest run 'src/routes/-passport.$token.test.tsx'
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/lib/publicPassport.ts server/test/public-passport.test.ts src/lib/queries/kocmax.ts src/components/PublicPassportView.tsx 'src/routes/-passport.$token.test.tsx'
git commit -m "feat: publish profile media to public passport"
```

---

### Task 5: Operator Review Profile Media

**Files:**
- Modify: `server/lib/operatorCrm/types.ts`
- Modify: `server/lib/operatorCrm/repo.ts`
- Modify: `server/test/operator-crm.test.ts`
- Modify: `src/lib/admin.ts`
- Modify: `src/routes/operator.creators.$creatorId.tsx`
- Modify: `src/routes/-operator.creators.$creatorId.test.tsx`

**Interfaces:**
- Consumes `getProfileMedia(serviceClient(), creatorId)`.
- Produces `profileMedia` on admin creator detail responses.
- Produces queue summary fields `profileMedia.completenessScore`, `profileMedia.portfolioCount`, `profileMedia.publicHighlightCount`.
- Public passport remains unchanged by operator views.

- [ ] **Step 1: Update failing operator backend test**

In `server/test/operator-crm.test.ts`, inside `"returns creator detail with notes, shortlists, social summary, mission history, and audit timeline"`, seed one portfolio link before requesting detail:

```ts
    await svc.from("creator_portfolio_links").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: "https://example.com/operator-portfolio",
      title: "Operator-visible work",
      platform_type: "website",
      caption: "Private review caption",
      sort_order: 1,
      public_highlight: true,
    });
```

Add assertions after `const body = await res.json();`:

```ts
    expect(body.profileMedia.portfolioLinks[0]).toMatchObject({
      title: "Operator-visible work",
      publicHighlight: true,
    });
    expect(body.profileMedia.completeness.score).toBeGreaterThan(0);
```

In the mission-scoped queue test, assert every creator row includes media summary:

```ts
    expect(body.creators[0].profileMedia).toMatchObject({
      portfolioCount: expect.any(Number),
      publicHighlightCount: expect.any(Number),
      completenessScore: expect.any(Number),
    });
```

- [ ] **Step 2: Run operator backend test to verify it fails**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm.test.ts
```

Expected: FAIL because admin responses do not include `profileMedia`.

- [ ] **Step 3: Extend operator types**

Modify `server/lib/operatorCrm/types.ts`:

Add:

```ts
export type OperatorProfileMediaSummary = {
  avatarUrl: string | null;
  portfolioCount: number;
  publicHighlightCount: number;
  completenessScore: number;
};
```

Add this field to `CreatorReviewRow`:

```ts
  profileMedia: OperatorProfileMediaSummary;
```

- [ ] **Step 4: Add operator profile media projections**

Modify `server/lib/operatorCrm/repo.ts` imports:

```ts
import { getProfileMedia } from "../profileMedia/repo.js";
```

Add helper:

```ts
async function getProfileMediaSummaryMap(supabase: SupabaseClient, creatorIds: string[]) {
  const map = new Map<string, CreatorReviewRow["profileMedia"]>();
  await Promise.all(
    creatorIds.map(async (creatorId) => {
      const media = await getProfileMedia(supabase, creatorId);
      map.set(creatorId, {
        avatarUrl: media.avatarUrl,
        portfolioCount: media.portfolioLinks.length,
        publicHighlightCount: media.publicHighlights.length,
        completenessScore: media.completeness.score,
      });
    }),
  );
  return map;
}
```

In `listCreatorReviewQueue`, add `profileMedia` to the `Promise.all` call:

```ts
  const [reviews, socials, shortlists, profileMedia] = await Promise.all([
    getReviewMap(supabase, creatorIds),
    getSocialMap(supabase, creatorIds),
    getShortlistMap(supabase, creatorIds, filters.missionId),
    getProfileMediaSummaryMap(supabase, creatorIds),
  ]);
```

Inside each queue row:

```ts
        profileMedia: profileMedia.get(creator.id) ?? {
          avatarUrl: creator.avatar_url ?? null,
          portfolioCount: 0,
          publicHighlightCount: 0,
          completenessScore: 0,
        },
```

In `getCreatorOperatorDetail`, add `profileMedia` to the returned object:

```ts
  const profileMedia = await getProfileMedia(supabase, creatorId);
```

Return:

```ts
    profileMedia,
```

- [ ] **Step 5: Update admin client types**

Modify `src/lib/admin.ts`:

```ts
export type AdminProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: string;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: AdminProfileMediaLink[];
  publicHighlights: Array<{
    url: string;
    title: string;
    platform_type: string;
    caption: string | null;
    sort_order: number;
  }>;
  published: {
    avatarUrl: string | null;
    highlights: Array<{
      url: string;
      title: string;
      platform_type: string;
      caption: string | null;
      sort_order: number;
    }>;
    publishedAt: string | null;
  };
  completeness: {
    score: number;
    items: Array<{ key: string; label: string; complete: boolean }>;
  };
};
```

Add to `AdminCreatorReviewRow`:

```ts
  profileMedia: {
    avatarUrl: string | null;
    portfolioCount: number;
    publicHighlightCount: number;
    completenessScore: number;
  };
```

Add to `AdminCreatorDetailResponse`:

```ts
  profileMedia: AdminProfileMedia;
```

- [ ] **Step 6: Add operator UI assertions first**

Modify `src/routes/-operator.creators.$creatorId.test.tsx` mocked detail:

```ts
      profileMedia: {
        avatarUrl: "https://cdn.example.com/avatar.jpg",
        portfolioLinks: [
          {
            id: "portfolio-1",
            creatorId: "creator-1",
            workspaceId: "workspace-1",
            url: "https://example.com/operator-portfolio",
            title: "Operator-visible work",
            platformType: "website",
            caption: "Private review caption",
            sortOrder: 1,
            publicHighlight: true,
            createdAt: "2026-06-18T01:00:00.000Z",
            updatedAt: "2026-06-18T01:00:00.000Z",
          },
        ],
        publicHighlights: [
          {
            url: "https://example.com/operator-portfolio",
            title: "Operator-visible work",
            platform_type: "website",
            caption: "Private review caption",
            sort_order: 1,
          },
        ],
        published: { avatarUrl: null, highlights: [], publishedAt: null },
        completeness: {
          score: 71,
          items: [
            { key: "avatar", label: "Avatar selected", complete: true },
            { key: "portfolio", label: "Portfolio link added", complete: true },
          ],
        },
      },
```

Add assertions:

```ts
    expect(screen.getByRole("heading", { name: "Profile media" })).toBeInTheDocument();
    expect(screen.getByText("71% complete")).toBeInTheDocument();
    expect(screen.getByText("Operator-visible work")).toBeInTheDocument();
    expect(screen.getByText("Public highlight")).toBeInTheDocument();
```

- [ ] **Step 7: Render operator profile media**

Modify `src/routes/operator.creators.$creatorId.tsx` inside the main left column before Mission history:

```tsx
                <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                  <h3 className="font-heading font-bold">Profile media</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                      {detailData.profileMedia.completeness.score}% complete
                    </span>
                    <span className="text-sm text-[var(--color-soft-ink)]">
                      {detailData.profileMedia.portfolioLinks.length} portfolio links
                    </span>
                  </div>
                  <div className="space-y-2">
                    {detailData.profileMedia.portfolioLinks.length > 0 ? (
                      detailData.profileMedia.portfolioLinks.map((item) => (
                        <a
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">{item.title}</span>
                            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                              {item.platformType}
                            </span>
                            {item.publicHighlight ? (
                              <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">
                                Public highlight
                              </span>
                            ) : null}
                          </div>
                          {item.caption ? <p className="mt-2 text-[var(--color-soft-ink)]">{item.caption}</p> : null}
                        </a>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--color-soft-ink)]">No portfolio links</p>
                    )}
                  </div>
                </section>
```

- [ ] **Step 8: Run operator tests**

Run:

```bash
RUN_INTEGRATION=1 vitest run --no-file-parallelism server/test/operator-crm.test.ts
vitest run 'src/routes/-operator.creators.$creatorId.test.tsx'
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add server/lib/operatorCrm/types.ts server/lib/operatorCrm/repo.ts server/test/operator-crm.test.ts src/lib/admin.ts 'src/routes/operator.creators.$creatorId.tsx' 'src/routes/-operator.creators.$creatorId.test.tsx'
git commit -m "feat: add operator profile media review"
```

---

### Task 6: Creator Profile Media Frontend

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Create: `src/components/CreatorProfileMediaPanel.tsx`
- Test: `src/components/CreatorProfileMediaPanel.test.tsx`
- Modify: `src/routes/_app.profile.tsx`
- Modify: `src/routes/-_app.profile.test.tsx`

**Interfaces:**
- Consumes `/api/me/profile-media` routes.
- Uses `supabase.storage.from("creator-avatars").upload(path, file, { contentType })`.
- Produces creator UI for upload, portfolio CRUD, highlight toggle cap, completeness, and publish.

- [ ] **Step 1: Add query types and hooks**

Modify `src/lib/queries/kocmax.ts` with types:

```ts
export type PortfolioPlatformType = "instagram" | "threads" | "tiktok" | "youtube" | "website" | "case_study" | "other";

export type ProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: PortfolioPlatformType;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProfileCompleteness = {
  score: number;
  items: Array<{ key: string; label: string; complete: boolean }>;
};

export type CreatorProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: ProfileMediaLink[];
  publicHighlights: PublicProfileHighlight[];
  published: { avatarUrl: string | null; highlights: PublicProfileHighlight[]; publishedAt: string | null };
  completeness: ProfileCompleteness;
};

export type AvatarUploadMetadata = {
  bucket: "creator-avatars";
  path: string;
  publicUrl: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  maxSizeBytes: number;
};
```

Add hooks:

```ts
export function useProfileMedia() {
  return useQuery({ queryKey: ["profile-media"], queryFn: () => apiFetch<CreatorProfileMedia>("/me/profile-media") });
}

export function useCreateAvatarUpload() {
  return useMutation({
    mutationFn: (body: { fileName: string; contentType: string; sizeBytes: number }) =>
      apiFetch<AvatarUploadMetadata>("/me/profile-media/avatar-upload", { method: "POST", body: JSON.stringify(body) }),
  });
}

export function useSelectUploadedAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storagePath: string) =>
      apiFetch<{ avatarUrl: string }>("/me/profile-media/avatar-select", {
        method: "POST",
        body: JSON.stringify({ storagePath }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["profile-media"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useCreatePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      url: string;
      title: string;
      platform_type: PortfolioPlatformType;
      caption?: string;
      sort_order?: number;
      public_highlight?: boolean;
    }) => apiFetch<{ link: ProfileMediaLink }>("/me/profile-media/portfolio", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function useUpdatePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<{ link: ProfileMediaLink }>(`/me/profile-media/portfolio/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function useDeletePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: boolean }>(`/me/profile-media/portfolio/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function usePublishProfileMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ published: CreatorProfileMedia["published"] }>("/me/profile-media/publish", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-media"] });
      qc.invalidateQueries({ queryKey: ["public-passport"] });
    },
  });
}
```

- [ ] **Step 2: Write failing component tests**

Create `src/components/CreatorProfileMediaPanel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  profileMedia: {
    data: {
      avatarUrl: null,
      portfolioLinks: [
        {
          id: "link-1",
          creatorId: "creator-1",
          workspaceId: "workspace-1",
          url: "https://example.com/public",
          title: "Launch reel",
          platformType: "instagram",
          caption: "Launch caption",
          sortOrder: 1,
          publicHighlight: true,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
      ],
      publicHighlights: [
        {
          url: "https://example.com/public",
          title: "Launch reel",
          platform_type: "instagram",
          caption: "Launch caption",
          sort_order: 1,
        },
      ],
      published: { avatarUrl: null, highlights: [], publishedAt: null },
      completeness: {
        score: 57,
        items: [{ key: "portfolio", label: "Portfolio link added", complete: true }],
      },
    },
    isLoading: false,
    isError: false,
  },
  createUpload: vi.fn(),
  selectAvatar: vi.fn(),
  createLink: vi.fn(),
  updateLink: vi.fn(),
  deleteLink: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useProfileMedia: () => hoisted.profileMedia,
  useCreateAvatarUpload: () => ({ mutateAsync: hoisted.createUpload, isPending: false }),
  useSelectUploadedAvatar: () => ({ mutateAsync: hoisted.selectAvatar, isPending: false }),
  useCreatePortfolioLink: () => ({ mutateAsync: hoisted.createLink, isPending: false }),
  useUpdatePortfolioLink: () => ({ mutateAsync: hoisted.updateLink, isPending: false }),
  useDeletePortfolioLink: () => ({ mutateAsync: hoisted.deleteLink, isPending: false }),
  usePublishProfileMedia: () => ({ mutateAsync: hoisted.publish, isPending: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({ upload: hoisted.upload }),
    },
  },
}));

import { CreatorProfileMediaPanel } from "./CreatorProfileMediaPanel";

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatorProfileMediaPanel />
    </QueryClientProvider>,
  );
}

describe("CreatorProfileMediaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createUpload.mockResolvedValue({
      bucket: "creator-avatars",
      path: "creator-1/avatar.png",
      publicUrl: "https://cdn.example.com/avatar.png",
      contentType: "image/png",
      maxSizeBytes: 5_242_880,
    });
    hoisted.upload.mockResolvedValue({ error: null });
    hoisted.selectAvatar.mockResolvedValue({ avatarUrl: "https://cdn.example.com/avatar.png" });
    hoisted.createLink.mockResolvedValue({});
    hoisted.updateLink.mockResolvedValue({});
    hoisted.deleteLink.mockResolvedValue({});
    hoisted.publish.mockResolvedValue({});
  });

  it("renders completeness, portfolio links, and publish action", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "創作者媒體" })).toBeInTheDocument();
    expect(screen.getByText("57%")).toBeInTheDocument();
    expect(screen.getByText("Launch reel")).toBeInTheDocument();
    expect(screen.getByLabelText("發佈到公開護照")).toBeInTheDocument();
  });

  it("creates a portfolio link", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("作品標題"), { target: { value: "New work" } });
    fireEvent.change(screen.getByLabelText("作品連結"), { target: { value: "https://example.com/new" } });
    fireEvent.change(screen.getByLabelText("作品類型"), { target: { value: "website" } });
    fireEvent.click(screen.getByLabelText("新增作品"));

    await waitFor(() =>
      expect(hoisted.createLink).toHaveBeenCalledWith({
        title: "New work",
        url: "https://example.com/new",
        platform_type: "website",
        caption: "",
        public_highlight: false,
      }),
    );
  });

  it("uploads and selects an avatar", async () => {
    renderPanel();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上載頭像"), { target: { files: [file] } });

    await waitFor(() => expect(hoisted.createUpload).toHaveBeenCalledWith({
      fileName: "avatar.png",
      contentType: "image/png",
      sizeBytes: file.size,
    }));
    expect(hoisted.upload).toHaveBeenCalledWith("creator-1/avatar.png", file, { contentType: "image/png", upsert: false });
    expect(hoisted.selectAvatar).toHaveBeenCalledWith("creator-1/avatar.png");
  });

  it("toggles a public highlight and publishes", async () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("切換公開精選 Launch reel"));
    await waitFor(() => expect(hoisted.updateLink).toHaveBeenCalledWith({
      id: "link-1",
      patch: { public_highlight: false },
    }));

    fireEvent.click(screen.getByLabelText("發佈到公開護照"));
    await waitFor(() => expect(hoisted.publish).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run component tests to verify they fail**

Run:

```bash
vitest run src/components/CreatorProfileMediaPanel.test.tsx
```

Expected: FAIL because `CreatorProfileMediaPanel` does not exist.

- [ ] **Step 4: Build the creator media panel**

Create `src/components/CreatorProfileMediaPanel.tsx`:

```tsx
import { useState } from "react";
import { Upload, ExternalLink, Star, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  useCreateAvatarUpload,
  useCreatePortfolioLink,
  useDeletePortfolioLink,
  useProfileMedia,
  usePublishProfileMedia,
  useSelectUploadedAvatar,
  useUpdatePortfolioLink,
  type PortfolioPlatformType,
} from "@/lib/queries/kocmax";

const PLATFORM_OPTIONS: Array<{ value: PortfolioPlatformType; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "website", label: "Website" },
  { value: "case_study", label: "Case study" },
  { value: "other", label: "Other" },
];

export function CreatorProfileMediaPanel() {
  const media = useProfileMedia();
  const createUpload = useCreateAvatarUpload();
  const selectAvatar = useSelectUploadedAvatar();
  const createLink = useCreatePortfolioLink();
  const updateLink = useUpdatePortfolioLink();
  const deleteLink = useDeletePortfolioLink();
  const publish = usePublishProfileMedia();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [platformType, setPlatformType] = useState<PortfolioPlatformType>("website");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function uploadAvatar(file: File) {
    setMessage(null);
    const metadata = await createUpload.mutateAsync({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    const { error } = await supabase.storage
      .from(metadata.bucket)
      .upload(metadata.path, file, { contentType: metadata.contentType, upsert: false });
    if (error) throw error;
    await selectAvatar.mutateAsync(metadata.path);
    setMessage("頭像已更新，發佈後會顯示在公開護照");
  }

  async function submitLink() {
    setMessage(null);
    await createLink.mutateAsync({
      title: title.trim(),
      url: url.trim(),
      platform_type: platformType,
      caption,
      public_highlight: false,
    });
    setTitle("");
    setUrl("");
    setCaption("");
  }

  if (media.isLoading) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </section>
    );
  }

  if (media.isError || !media.data) {
    return (
      <section className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <p className="text-sm text-[var(--color-magenta)]">媒體資料載入失敗</p>
      </section>
    );
  }

  const selectedHighlights = media.data.portfolioLinks.filter((link) => link.publicHighlight).length;

  return (
    <section className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold">創作者媒體</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
          {media.data.completeness.score}%
        </span>
      </div>

      {message ? <p className="text-sm font-medium text-[var(--color-soft-ink)]">{message}</p> : null}

      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-heading font-bold">
        <Upload className="h-4 w-4" />
        上載頭像
        <input
          aria-label="上載頭像"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void uploadAvatar(file).catch(() => setMessage("頭像上載失敗"));
          }}
        />
      </label>

      <div className="grid gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="作品標題"
          placeholder="作品標題"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="作品連結"
          placeholder="https://example.com/work"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <select
          value={platformType}
          onChange={(event) => setPlatformType(event.target.value as PortfolioPlatformType)}
          aria-label="作品類型"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          aria-label="作品說明"
          placeholder="作品說明"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        />
        <button
          type="button"
          aria-label="新增作品"
          disabled={!title.trim() || !url.trim() || createLink.isPending}
          onClick={() => void submitLink().catch(() => setMessage("作品新增失敗"))}
          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
        >
          新增作品
        </button>
      </div>

      <div className="space-y-2">
        {media.data.portfolioLinks.map((link) => {
          const highlightDisabled = !link.publicHighlight && selectedHighlights >= 3;
          return (
            <div key={link.id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-heading font-bold">
                  {link.title}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                  {link.platformType}
                </span>
              </div>
              {link.caption ? <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{link.caption}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={`切換公開精選 ${link.title}`}
                  disabled={highlightDisabled || updateLink.isPending}
                  onClick={() =>
                    void updateLink
                      .mutateAsync({ id: link.id, patch: { public_highlight: !link.publicHighlight } })
                      .catch(() => setMessage("公開精選更新失敗"))
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold disabled:opacity-50"
                >
                  <Star className="h-4 w-4" />
                  {link.publicHighlight ? "公開精選" : "設為公開"}
                </button>
                <button
                  type="button"
                  aria-label={`刪除作品 ${link.title}`}
                  disabled={deleteLink.isPending}
                  onClick={() => void deleteLink.mutateAsync(link.id).catch(() => setMessage("作品刪除失敗"))}
                  className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 text-sm font-heading font-bold text-[var(--color-magenta)] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  刪除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="發佈到公開護照"
        disabled={publish.isPending}
        onClick={() => void publish.mutateAsync().then(() => setMessage("公開護照已更新")).catch(() => setMessage("發佈失敗"))}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50"
      >
        發佈到公開護照
      </button>
    </section>
  );
}
```

- [ ] **Step 5: Mount panel on profile page**

Modify `src/routes/_app.profile.tsx` imports:

```ts
import { CreatorProfileMediaPanel } from "@/components/CreatorProfileMediaPanel";
```

Render it in view mode after `<SocialTrustPanel />`:

```tsx
          <CreatorProfileMediaPanel />
```

- [ ] **Step 6: Update profile route test mocks**

Modify `src/routes/-_app.profile.test.tsx` mock for `@/lib/queries/kocmax`:

```ts
  useProfileMedia: () => ({
    data: {
      avatarUrl: null,
      portfolioLinks: [],
      publicHighlights: [],
      published: { avatarUrl: null, highlights: [], publishedAt: null },
      completeness: { score: 0, items: [] },
    },
    isLoading: false,
    isError: false,
  }),
  useCreateAvatarUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSelectUploadedAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublishProfileMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
```

Add an assertion in `"renders name, level, categories and referral code"`:

```ts
    expect(screen.getByRole("heading", { name: "創作者媒體" })).toBeInTheDocument();
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
vitest run src/components/CreatorProfileMediaPanel.test.tsx 'src/routes/-_app.profile.test.tsx'
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/lib/queries/kocmax.ts src/components/CreatorProfileMediaPanel.tsx src/components/CreatorProfileMediaPanel.test.tsx src/routes/_app.profile.tsx 'src/routes/-_app.profile.test.tsx'
git commit -m "feat: add creator profile media ui"
```

---

### Task 7: Full Verification And PR Readiness

**Files:**
- Modify only if verification finds a defect in files touched by Tasks 1-6.

**Interfaces:**
- Consumes all previous tasks.
- Produces a validated local branch ready to push.

- [ ] **Step 1: Verify generated route tree and TypeScript**

Run:

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run unit/component tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: PASS with local Supabase env.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. The existing Vite chunk-size warning is acceptable if no new build error appears.

- [ ] **Step 6: Start or verify local dev server**

If the existing dev server is not running, run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Expected: Vite serves `http://127.0.0.1:5173/`.

Verify:

```bash
curl -I http://127.0.0.1:5173/
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 7: Final privacy grep**

Run:

```bash
rg -n "external_avatar_url|follower_count|engagement_rate|recent_posts_summary|creator_review_notes|operator_audit_events" server/lib/publicPassport.ts src/components/PublicPassportView.tsx
```

Expected: no matches.

- [ ] **Step 8: Inspect git history**

Run:

```bash
git status -sb
git log --oneline -8
```

Expected: clean worktree and task commits visible.

- [ ] **Step 9: Push branch**

Run:

```bash
git push origin feat/mission-brief
```

Expected: branch pushes successfully. GitHub Actions may still fail before running if repository billing/spending-limit checks are blocked.
