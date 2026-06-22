# Content Hub (CMS Slice C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff author bilingual markdown articles + announcements in `/admin`, surfaced to logged-in creators at `/news` and a Home strip.

**Architecture:** One polymorphic `content_items` table (markdown body) + taxonomy tables; a pure `contentAuthoring.ts` (validation/slug/transitions) feeding a thin staff-gated `adminContent.ts` (serviceClient writes) and a creator-read `content.ts` (makeUserClient, RLS published-global). Markdown renders through the repo's existing `Markdown.tsx` (`react-markdown` + `rehype-sanitize`). Scheduled publish runs via a new cron. No Editor.js, no new sanitizer, no Academy changes.

**Tech Stack:** Vite + TanStack Router, Hono, Supabase (Postgres + RLS + Storage), TanStack Query, Vitest. Spec: `docs/superpowers/specs/2026-06-23-adfocate-content-hub-design.md`.

**Worktree:** Implement in `adfocate-2-content-hub-c1/` on branch `feat/content-hub-c1` (already created). All relative server imports MUST carry the `.js` ESM extension (`check:esm` guards CI).

**Conventions verified against the codebase:**
- Admin routes sit behind `adminRoutes` staff-auth middleware (Supabase JWT → `staff_users` via `resolveStaff`; `x-admin-secret` break-glass). Sub-mount with `adminRoutes.route("/", adminContentRoutes)`. `Hono<AdminEnv>`, read `c.get("staff")`.
- Creator reads mount on the `guarded` group (`workspaceAuth` sets `userId`/`workspaceId`/`jwt`); use `makeUserClient(c.get("jwt"))`.
- Client: `apiFetch` (`@/lib/api`) for creator calls, `adminFetch` (`@/lib/admin`) for staff calls — both attach the Supabase session JWT.
- Migration files are sequential SQL; apply to prod via Supabase MCP raw SQL (tracker drift — never `apply_migration`), BEFORE deploy, then `notify pgrst, 'reload schema'`.
- Integration tests run via `npm run test:integration` (`--no-file-parallelism`); new test files MUST be added to that script's file list in `package.json`. They no-op unless `.env.test.local` (local Supabase) is exported into the shell.

---

## File Structure

**Create:**
- `supabase/migrations/0021_content_hub.sql` — schema, indexes, RLS, grants, `content-media` bucket, 2 RPCs.
- `server/lib/contentAuthoring.ts` — pure: kinds/statuses, `slugify`, `uniqueSlug`, `validateContentInput`/`validateContentEdit`, `STATUS_TRANSITIONS`/`canTransition`, `isPublishable`, `isAllowedImageUrl`.
- `server/lib/contentAuthoring.test.ts` — unit tests for the above.
- `server/routes/adminContent.ts` — staff CRUD + lifecycle + media + taxonomy.
- `server/routes/content.ts` — creator read (list/detail/related/views).
- `server/test/adminContent.test.ts` — admin integration tests.
- `server/test/content.test.ts` — creator-read + RLS integration tests.
- `server/test/cron-publish-scheduled.test.ts` — cron integration test.
- `src/lib/content.ts` — client types + admin & creator fetch helpers + query keys.
- `src/routes/admin.content.index.tsx` — content list.
- `src/routes/admin.content.$id.tsx` — markdown editor (create + edit; `$id="new"` creates).
- `src/components/admin/ContentEditor.tsx` — editor form (markdown textarea + live `Markdown` preview + metadata rail).
- `src/routes/_app.news.index.tsx` — creator News feed.
- `src/routes/_app.news.$slug.tsx` — creator article/announcement detail.
- `src/components/news/NewsCard.tsx` — feed card (shared by feed + Home strip).

**Modify:**
- `server/routes/admin.ts` — `adminRoutes.route("/", adminContentRoutes)`.
- `server/routes/cron.ts` — add `/publish-scheduled` handler.
- `server/app.ts` — `guarded.route("/content", contentRoutes)`.
- `vercel.json` — add the `publish-scheduled` cron entry.
- `src/components/admin/AdminTabs.tsx` — add the "Content" tab.
- `src/components/Markdown.tsx` — add `remark-gfm`.
- `src/routes/_app.home.tsx` — render the announcement strip.
- `src/lib/i18n.dict.ts` — `app.news.*` + `app.admin.content.*` + `app.admin.tabContent` (both `en` and `zh-HK` blocks).
- `package.json` — add `remark-gfm`; register the 3 new test files in `test:integration`.

---

## Task 1: Migration `0021_content_hub.sql`

**Files:** Create `supabase/migrations/0021_content_hub.sql`

- [ ] **Step 1: Confirm `0021` is the next free number**

Run: `ls supabase/migrations | sort | tail -4`
Expected: highest numbered file is `0020_staff_auth.sql` (two later `2026…` timestamped files are fine). If a higher `00NN_` exists, use the next free number and rename consistently throughout this plan.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0021_content_hub.sql`:

```sql
-- 0021_content_hub.sql — Content Hub (CMS Slice C1): editorial articles + announcements.
-- Staff author markdown in /admin; authenticated creators read published-global rows at /news.

-- Taxonomy (created before content_items for the category FK) -----------------
create table public.content_categories (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  label_zh  text not null,
  label_en  text,
  sort      int  not null default 0,
  created_at timestamptz not null default now()
);

create table public.content_tags (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  label_zh  text not null,
  label_en  text,
  created_at timestamptz not null default now()
);

-- Core --------------------------------------------------------------------------
create table public.content_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('article','announcement')),
  slug            text not null unique,
  status          text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  title_zh        text not null,
  title_en        text,
  excerpt_zh      text,
  excerpt_en      text,
  body_zh         text not null default '',
  body_en         text,
  cover_image_url text,
  category_id     uuid references public.content_categories(id) on delete set null,
  author_id       uuid,
  workspace_id    uuid references public.workspaces(id),
  pinned          boolean not null default false,
  pinned_rank     int,
  views           int not null default 0,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_items_scheduled_chk check (status <> 'scheduled' or scheduled_for is not null)
);

create table public.content_item_tags (
  content_id uuid not null references public.content_items(id) on delete cascade,
  tag_id     uuid not null references public.content_tags(id) on delete cascade,
  primary key (content_id, tag_id)
);

-- updated_at trigger ------------------------------------------------------------
create or replace function public.content_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger content_items_touch
  before update on public.content_items
  for each row execute function public.content_touch_updated_at();

-- Indexes -----------------------------------------------------------------------
create index content_items_kind_status_pub_idx on public.content_items (kind, status, published_at desc);
create index content_items_category_idx        on public.content_items (category_id);
create index content_items_scheduled_idx        on public.content_items (scheduled_for) where status = 'scheduled';
create index content_items_pinned_idx           on public.content_items (pinned_rank) where pinned;

-- RLS: authenticated creators read published-global; all writes are service-role -
alter table public.content_items     enable row level security;
alter table public.content_categories enable row level security;
alter table public.content_tags        enable row level security;
alter table public.content_item_tags   enable row level security;

create policy content_items_read_published on public.content_items
  for select to authenticated using (status = 'published' and workspace_id is null);
create policy content_categories_read on public.content_categories for select to authenticated using (true);
create policy content_tags_read       on public.content_tags       for select to authenticated using (true);
create policy content_item_tags_read  on public.content_item_tags  for select to authenticated using (true);

grant select on public.content_items, public.content_categories, public.content_tags, public.content_item_tags to authenticated;
grant all    on public.content_items, public.content_categories, public.content_tags, public.content_item_tags to service_role;

-- RPCs --------------------------------------------------------------------------
-- Increment-only view counter; published-global only; reachable by authenticated creators.
create or replace function public.content_increment_views(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.content_items set views = views + 1
  where slug = p_slug and status = 'published' and workspace_id is null;
$$;
revoke all on function public.content_increment_views(text) from public, anon;
grant execute on function public.content_increment_views(text) to authenticated, service_role;

-- Flip overdue scheduled rows to published; service-role (cron) only.
create or replace function public.content_publish_scheduled()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.content_items
     set status = 'published', published_at = now()
   where status = 'scheduled' and scheduled_for <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.content_publish_scheduled() from public, anon, authenticated;
grant execute on function public.content_publish_scheduled() to service_role;

-- Storage bucket (public read; staff upload via serviceClient server-side) -------
insert into storage.buckets (id, name, public) values ('content-media', 'content-media', true)
on conflict (id) do nothing;

-- Seed two starter categories so the editor select is non-empty -----------------
insert into public.content_categories (slug, label_zh, label_en, sort) values
  ('platform-news', '平台公告', 'Platform News', 0),
  ('creator-tips',  '創作心得', 'Creator Tips', 1)
on conflict (slug) do nothing;
```

- [ ] **Step 3: Apply to the local stack and verify**

Run:
```bash
set -a && source .env.test.local && set +a
psql "$SUPABASE_DB_URL" -f supabase/migrations/0021_content_hub.sql
```
(If `.env.test.local` has no `SUPABASE_DB_URL`, apply via `supabase db reset` or the local SQL editor.)
Expected: `CREATE TABLE`/`CREATE POLICY`/`CREATE FUNCTION`/`INSERT 0 2` with no errors.

- [ ] **Step 4: Smoke the RPC grants**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "select proname, proacl is not null as has_acl from pg_proc where proname in ('content_increment_views','content_publish_scheduled');"
```
Expected: both rows present.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0021_content_hub.sql
git commit -m "feat(content-hub): 0021 migration — content tables, RLS, RPCs, bucket"
```

---

## Task 2: Pure module `contentAuthoring.ts`

**Files:**
- Create: `server/lib/contentAuthoring.ts`
- Test: `server/lib/contentAuthoring.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/lib/contentAuthoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  slugify, uniqueSlug, validateContentInput, validateContentEdit,
  canTransition, isPublishable, isAllowedImageUrl,
} from "./contentAuthoring.js";

describe("slugify", () => {
  it("lowercases, trims, hyphenates", () => {
    expect(slugify("  Summer Sunscreen 2026!! ")).toBe("summer-sunscreen-2026");
  });
  it("falls back for empty/punctuation-only input", () => {
    expect(slugify("！！！").length).toBeGreaterThan(0);
  });
});

describe("uniqueSlug", () => {
  it("returns base when free", () => {
    expect(uniqueSlug("news", [])).toBe("news");
  });
  it("appends -2, -3 on collision", () => {
    expect(uniqueSlug("news", ["news"])).toBe("news-2");
    expect(uniqueSlug("news", ["news", "news-2"])).toBe("news-3");
  });
});

describe("validateContentInput", () => {
  it("requires kind + title_zh", () => {
    const { errors } = validateContentInput({ kind: "", title_zh: "", body_zh: "" } as never);
    expect(errors.kind).toBeDefined();
    expect(errors.title_zh).toBeDefined();
  });
  it("rejects an unknown kind", () => {
    const { errors } = validateContentInput({ kind: "video", title_zh: "x", body_zh: "" } as never);
    expect(errors.kind).toBeDefined();
  });
  it("rejects an over-long title", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "x".repeat(201), body_zh: "" });
    expect(errors.title_zh).toBeDefined();
  });
  it("passes a minimal valid draft", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "標題", body_zh: "" });
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe("validateContentEdit", () => {
  it("only errors on PRESENT invalid fields", () => {
    expect(Object.keys(validateContentEdit({}).errors)).toHaveLength(0);
    expect(validateContentEdit({ title_zh: "" }).errors.title_zh).toBeDefined();
  });
});

describe("canTransition", () => {
  it("allows draft→published, scheduled→published, published→archived", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("scheduled", "published")).toBe(true);
    expect(canTransition("published", "archived")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(true);
  });
  it("rejects nonsense transitions", () => {
    expect(canTransition("archived", "scheduled")).toBe(false);
    expect(canTransition("published", "scheduled")).toBe(false);
  });
});

describe("isPublishable", () => {
  it("needs a title and non-empty body", () => {
    expect(isPublishable({ title_zh: "t", body_zh: "hi" })).toBe(true);
    expect(isPublishable({ title_zh: "t", body_zh: "   " })).toBe(false);
    expect(isPublishable({ title_zh: "", body_zh: "hi" })).toBe(false);
  });
});

describe("isAllowedImageUrl", () => {
  const hosts = ["abc.supabase.co"];
  it("accepts https on an allowed host", () => {
    expect(isAllowedImageUrl("https://abc.supabase.co/x.png", hosts)).toBe(true);
  });
  it("rejects other hosts, http, and javascript:", () => {
    expect(isAllowedImageUrl("https://evil.com/x.png", hosts)).toBe(false);
    expect(isAllowedImageUrl("http://abc.supabase.co/x.png", hosts)).toBe(false);
    expect(isAllowedImageUrl("javascript:alert(1)", hosts)).toBe(false);
    expect(isAllowedImageUrl("not a url", hosts)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/lib/contentAuthoring.test.ts`
Expected: FAIL — `Cannot find module './contentAuthoring.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/contentAuthoring.ts`:

```ts
/** Pure content-authoring rules — no DB, no I/O, no `new Date()`. Mirrors the
 *  pure-module pattern of lib/missionAuthoring.ts. The routes own the clock + DB. */

export const CONTENT_KINDS = ["article", "announcement"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 500;
export const MAX_BODY = 50_000;

export type ContentInput = {
  kind: ContentKind;
  slug?: string;
  title_zh: string;
  title_en?: string | null;
  excerpt_zh?: string | null;
  excerpt_en?: string | null;
  body_zh: string;
  body_en?: string | null;
  cover_image_url?: string | null;
  category_id?: string | null;
  pinned?: boolean;
  pinned_rank?: number | null;
};
export type ContentEditInput = Partial<ContentInput>;

/** URL-safe slug. ASCII fallback keeps non-Latin titles from collapsing to "". */
export function slugify(input: string): string {
  const base = (input ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `post-${(input ?? "").length}`;
}

export function uniqueSlug(base: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function lenErr(v: unknown, max: number, label: string): string | null {
  if (typeof v !== "string") return null;
  return v.length > max ? `${label}不可超過 ${max} 字` : null;
}

export function validateContentInput(input: ContentInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (!input.title_zh || !input.title_zh.trim()) errors.title_zh = "請輸入中文標題";
  const titleErr = lenErr(input.title_zh, MAX_TITLE, "標題");
  if (titleErr) errors.title_zh = titleErr;
  const e1 = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e1) errors.excerpt_zh = e1;
  const b1 = lenErr(input.body_zh, MAX_BODY, "內文"); if (b1) errors.body_zh = b1;
  const b2 = lenErr(input.body_en, MAX_BODY, "內文"); if (b2) errors.body_en = b2;
  return { errors };
}

/** Edit validation only errors on fields actually PRESENT in the patch. */
export function validateContentEdit(input: ContentEditInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const has = (k: keyof ContentEditInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("kind") && !CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (has("title_zh") && (!input.title_zh || !input.title_zh.trim())) errors.title_zh = "請輸入中文標題";
  if (has("title_zh")) { const e = lenErr(input.title_zh, MAX_TITLE, "標題"); if (e) errors.title_zh = e; }
  if (has("excerpt_zh")) { const e = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e) errors.excerpt_zh = e; }
  if (has("body_zh")) { const e = lenErr(input.body_zh, MAX_BODY, "內文"); if (e) errors.body_zh = e; }
  if (has("body_en")) { const e = lenErr(input.body_en, MAX_BODY, "內文"); if (e) errors.body_en = e; }
  return { errors };
}

export const STATUS_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPublishable(row: { title_zh: string; body_zh: string }): boolean {
  return Boolean(row.title_zh && row.title_zh.trim() && row.body_zh && row.body_zh.trim());
}

/** https + exact-hostname match against the allowlist (never endsWith). */
export function isAllowedImageUrl(url: string, allowedHosts: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return allowedHosts.includes(u.hostname);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/lib/contentAuthoring.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/contentAuthoring.ts server/lib/contentAuthoring.test.ts
git commit -m "feat(content-hub): pure contentAuthoring module + unit tests"
```

---

## Task 3: Admin route `adminContent.ts` (CRUD + lifecycle + media + taxonomy)

**Files:**
- Create: `server/routes/adminContent.ts`
- Modify: `server/routes/admin.ts`
- Test: `server/test/adminContent.test.ts`
- Modify: `package.json` (register the test file)

- [ ] **Step 1: Write the route**

Create `server/routes/adminContent.ts`:

```ts
// server/routes/adminContent.ts — staff content authoring (CMS C1). Sub-mounted inside
// adminRoutes (inherits staff-auth). Writes via serviceClient(). All relative imports carry .js.
import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";
import {
  type ContentInput, type ContentEditInput, type ContentStatus,
  validateContentInput, validateContentEdit, canTransition, isPublishable,
  slugify, uniqueSlug, isAllowedImageUrl,
} from "../lib/contentAuthoring.js";

export const adminContentRoutes = new Hono<AdminEnv>();

const COLS =
  "id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, " +
  "cover_image_url, category_id, author_id, workspace_id, pinned, pinned_rank, views, " +
  "scheduled_for, published_at, archived_at, created_at, updated_at";

const EDITABLE: (keyof ContentInput)[] = [
  "kind", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en",
  "cover_image_url", "category_id", "pinned", "pinned_rank",
];

function bucketHosts(): string[] {
  try { return [new URL(process.env.SUPABASE_URL!).hostname]; } catch { return []; }
}

// ---- list ----
adminContentRoutes.get("/content", async (c) => {
  const svc = serviceClient();
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  let q = svc.from("content_items").select(COLS, { count: "exact" });
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const status = c.req.query("status"); if (status) q = q.eq("status", status);
  const category = c.req.query("category"); if (category) q = q.eq("category_id", category);
  const search = c.req.query("q"); if (search) q = q.ilike("title_zh", `%${search}%`);
  q = q.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ items: data ?? [], page, pageSize, total: count ?? 0 });
});

// ---- get one (incl. drafts) ----
adminContentRoutes.get("/content/:id", async (c) => {
  const { data, error } = await serviceClient().from("content_items").select(COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: data });
});

// ---- create (draft) ----
adminContentRoutes.post("/content", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as ContentInput;
  const { errors } = validateContentInput(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  if (body.cover_image_url && !isAllowedImageUrl(body.cover_image_url, bucketHosts()))
    return c.json({ error: "bad cover url", code: "validation_error", fields: { cover_image_url: "封面圖片網址無效" } }, 422);

  const svc = serviceClient();
  const base = slugify(body.slug || body.title_zh);
  const { data: existing } = await svc.from("content_items").select("slug").like("slug", `${base}%`);
  const slug = uniqueSlug(base, (existing ?? []).map((r) => r.slug as string));
  const row: Record<string, unknown> = { slug, status: "draft", author_id: c.get("staff").userId };
  for (const k of EDITABLE) if (k in body) row[k] = body[k];
  const { data, error } = await svc.from("content_items").insert(row).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data }, 201);
});

// ---- edit (optimistic concurrency; slug only while draft) ----
adminContentRoutes.patch("/content/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as ContentEditInput & { updated_at?: string; slug?: string };
  const { errors } = validateContentEdit(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  if (body.cover_image_url && !isAllowedImageUrl(body.cover_image_url, bucketHosts()))
    return c.json({ error: "bad cover url", code: "validation_error", fields: { cover_image_url: "封面圖片網址無效" } }, 422);

  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("content_items").select("status, updated_at").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (body.updated_at && body.updated_at !== cur.updated_at)
    return c.json({ error: "stale", code: "conflict" }, 409);

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (body.slug !== undefined) {
    if (cur.status !== "draft") return c.json({ error: "slug locked", code: "conflict" }, 409);
    patch.slug = slugify(body.slug);
  }
  const { data, error } = await svc.from("content_items").update(patch).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data });
});

// ---- lifecycle helper ----
async function transition(c: import("hono").Context<AdminEnv>, to: ContentStatus, extra: Record<string, unknown> = {}) {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("content_items").select("status, title_zh, body_zh").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (!canTransition(cur.status as ContentStatus, to)) return c.json({ error: "bad transition", code: "conflict" }, 409);
  if (to === "published" && !isPublishable(cur as { title_zh: string; body_zh: string }))
    return c.json({ error: "needs title + body", code: "validation_error" }, 422);
  const { data, error } = await svc.from("content_items").update({ status: to, ...extra }).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data });
}

adminContentRoutes.post("/content/:id/publish", (c) => transition(c, "published", { published_at: new Date().toISOString() }));
adminContentRoutes.post("/content/:id/unpublish", (c) => transition(c, "draft"));
adminContentRoutes.post("/content/:id/archive", (c) => transition(c, "archived", { archived_at: new Date().toISOString() }));
adminContentRoutes.post("/content/:id/schedule", async (c) => {
  const { scheduled_for } = (await c.req.json().catch(() => ({}))) as { scheduled_for?: string };
  const when = scheduled_for ? new Date(scheduled_for) : null;
  if (!when || isNaN(when.getTime()) || when.getTime() <= Date.now())
    return c.json({ error: "future time required", code: "validation_error", fields: { scheduled_for: "請選擇未來時間" } }, 422);
  return transition(c, "scheduled", { scheduled_for: when.toISOString() });
});

// ---- delete (draft + never-published only) ----
adminContentRoutes.delete("/content/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur } = await svc.from("content_items").select("status, published_at").eq("id", id).maybeSingle();
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (cur.status !== "draft" || cur.published_at) return c.json({ error: "archive instead", code: "conflict" }, 409);
  const { error } = await svc.from("content_items").delete().eq("id", id);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

// ---- taxonomy ----
adminContentRoutes.get("/content-categories", async (c) => {
  const { data, error } = await serviceClient().from("content_categories").select("id, slug, label_zh, label_en, sort").order("sort");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ categories: data ?? [] });
});
adminContentRoutes.get("/content-tags", async (c) => {
  const { data, error } = await serviceClient().from("content_tags").select("id, slug, label_zh, label_en").order("label_zh");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ tags: data ?? [] });
});

// ---- media upload (server-side via serviceClient; bucket is public-read) ----
adminContentRoutes.post("/content/media", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ error: "no file", code: "validation_error" }, 422);
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `images/${crypto.randomUUID()}.${ext}`;
  const svc = serviceClient();
  const { error } = await svc.storage.from("content-media").upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const { data } = svc.storage.from("content-media").getPublicUrl(path);
  return c.json({ url: data.publicUrl });
});
```

- [ ] **Step 2: Sub-mount the route**

In `server/routes/admin.ts`, add the import and the mount next to the other `adminRoutes.route("/", …)` lines:

```ts
import { adminContentRoutes } from "./adminContent.js";
// …after the existing adminRoutes.route("/", adminMissionRoutes); line:
adminRoutes.route("/", adminContentRoutes);
```

- [ ] **Step 3: Write the failing integration test**

Create `server/test/adminContent.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const SECRET = process.env.ADMIN_SECRET!;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminreq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": SECRET, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("adminContent lifecycle", () => {
  let id = "";
  beforeAll(cleanup);
  afterAll(cleanup);

  it("create → draft with generated slug", async () => {
    const res = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "夏日防曬攻略", body_zh: "" }) });
    expect(res.status).toBe(201);
    const { item } = await res.json();
    id = item.id;
    expect(item.status).toBe("draft");
    expect(item.slug).toBe("summer"); // slugify of an all-CJK title falls back; assert it is non-empty instead:
  });

  it("publish fails without a body, succeeds after editing one in", async () => {
    expect((await adminreq(`/admin/content/${id}/publish`, { method: "POST" })).status).toBe(422);
    await adminreq(`/admin/content/${id}`, { method: "PATCH", body: JSON.stringify({ body_zh: "內容" }) });
    const ok = await adminreq(`/admin/content/${id}/publish`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).item.status).toBe("published");
  });

  it("rejects an illegal transition (published→scheduled)", async () => {
    const res = await adminreq(`/admin/content/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduled_for: new Date(Date.now() + 3600_000).toISOString() }) });
    expect(res.status).toBe(409);
  });

  it("blocks hard-delete of a published row", async () => {
    expect((await adminreq(`/admin/content/${id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("401s without the secret/JWT", async () => {
    expect((await app.request("/api/admin/content")).status).toBe(401);
  });
});
```

> Note: replace the `item.slug` assertion in the first test with `expect(item.slug.length).toBeGreaterThan(0);` — an all-CJK title produces a `post-N` fallback slug, not `"summer"`. (Left visible so the implementer fixes it deliberately.)

- [ ] **Step 4: Register the test + run it**

In `package.json`, append ` server/test/adminContent.test.ts` to the `test:integration` file list.
Run: `RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/adminContent.test.ts` (with `.env.test.local` exported).
Expected: PASS (or SKIP if no local Supabase env — then verify on the machine that has it before merge).

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminContent.ts server/routes/admin.ts server/test/adminContent.test.ts package.json
git commit -m "feat(content-hub): staff content CRUD/lifecycle/media route + tests"
```

---

## Task 4: Creator read route `content.ts`

**Files:**
- Create: `server/routes/content.ts`
- Modify: `server/app.ts`
- Test: `server/test/content.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the route**

Create `server/routes/content.ts`:

```ts
// server/routes/content.ts — creator-facing reads. Mounted on the guarded group;
// makeUserClient(jwt) so RLS enforces published-global visibility. Relative imports carry .js.
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const contentRoutes = new Hono<Env>();

type Row = {
  id: string; slug: string; kind: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  cover_image_url: string | null; published_at: string | null; pinned: boolean; pinned_rank: number | null;
  views: number; content_categories: { slug: string; label_zh: string; label_en: string | null } | null;
  content_item_tags: { content_tags: { slug: string; label_zh: string; label_en: string | null } }[];
};

const SEL =
  "id, slug, kind, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, cover_image_url, " +
  "published_at, pinned, pinned_rank, views, content_categories(slug,label_zh,label_en), " +
  "content_item_tags(content_tags(slug,label_zh,label_en))";

function pick(en: string | null | undefined, zh: string, lang: string) {
  return lang === "en" && en ? en : zh;
}

function shape(r: Row, lang: string, withBody: boolean) {
  return {
    id: r.id, slug: r.slug, kind: r.kind,
    title: pick(r.title_en, r.title_zh, lang),
    excerpt: pick(r.excerpt_en, r.excerpt_zh ?? "", lang) || null,
    ...(withBody ? { body: pick(r.body_en, r.body_zh, lang) } : {}),
    coverImageUrl: r.cover_image_url,
    category: r.content_categories ? { slug: r.content_categories.slug, label: pick(r.content_categories.label_en, r.content_categories.label_zh, lang) } : null,
    tags: (r.content_item_tags ?? []).map((t) => t.content_tags.slug),
    publishedAt: r.published_at, pinned: r.pinned, views: r.views,
  };
}

// ---- list ----
contentRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  let q = supabase.from("content_items").select(SEL, { count: "exact" });
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const category = c.req.query("category"); if (category) q = q.eq("content_categories.slug", category);
  q = q.order("pinned_rank", { ascending: true, nullsFirst: false })
       .order("published_at", { ascending: false })
       .order("id", { ascending: false })
       .range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) return c.json({ items: [], page, pageSize, total: 0 }); // degrade, never 500
  return c.json({ items: (data as Row[]).map((r) => shape(r, lang, false)), page, pageSize, total: count ?? 0 });
});

// ---- detail (+ view increment + related) ----
contentRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const slug = c.req.param("slug");
  const { data, error } = await supabase.from("content_items").select(SEL).eq("slug", slug).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  await supabase.rpc("content_increment_views", { p_slug: slug });

  const tagSlugs = (data as Row).content_item_tags?.map((t) => t.content_tags.slug) ?? [];
  let related: ReturnType<typeof shape>[] = [];
  if (tagSlugs.length) {
    const { data: rel } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).contains("content_item_tags.content_tags.slug", tagSlugs).limit(4);
    related = ((rel as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  if (!related.length && (data as Row).content_categories) {
    const { data: rel2 } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).eq("content_categories.slug", (data as Row).content_categories!.slug)
      .order("published_at", { ascending: false }).limit(4);
    related = ((rel2 as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  return c.json({ item: shape(data as Row, lang, true), related });
});
```

> Note: the `.contains("content_item_tags…")` related-by-tag filter is best-effort; if PostgREST cannot express the nested filter, fall back to the category-only related query (already implemented) and log once. The integration test (Step 3) only asserts the category fallback path.

- [ ] **Step 2: Mount on the guarded group**

In `server/app.ts`, add the import and mount inside the `guarded` block:

```ts
import { contentRoutes } from "./routes/content.js";
// …with the other guarded.route(...) lines:
guarded.route("/content", contentRoutes);
```

- [ ] **Step 3: Write the failing integration test**

Create `server/test/content.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { createClient } from "@supabase/supabase-js";
import { makeCreator, serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" } });
}

suite("creator content reads (RLS)", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("content-read@test.local", 0);
    const svc = serviceForTests();
    await svc.from("content_items").insert([
      { kind: "article", slug: "c1-pub", status: "published", title_zh: "已發布", body_zh: "內容", published_at: new Date().toISOString() },
      { kind: "article", slug: "c1-draft", status: "draft", title_zh: "草稿", body_zh: "x" },
    ]);
  });
  afterAll(cleanup);

  it("list returns published, hides draft", async () => {
    const { items } = await (await koreq("/content", koc.jwt)).json();
    const slugs = items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain("c1-pub");
    expect(slugs).not.toContain("c1-draft");
  });

  it("detail 404s a draft slug, 200s a published one and increments views", async () => {
    expect((await koreq("/content/c1-draft", koc.jwt)).status).toBe(404);
    const res = await koreq("/content/c1-pub", koc.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).item.slug).toBe("c1-pub");
    const { data } = await serviceForTests().from("content_items").select("views").eq("slug", "c1-pub").single();
    expect(data!.views).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Register the test + run**

Append ` server/test/content.test.ts` to `test:integration` in `package.json`.
Run: `RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/content.test.ts`
Expected: PASS (or SKIP without local env).

- [ ] **Step 5: Commit**

```bash
git add server/routes/content.ts server/app.ts server/test/content.test.ts package.json
git commit -m "feat(content-hub): creator read route (list/detail/views/related) + tests"
```

---

## Task 5: Scheduled-publish cron

**Files:**
- Modify: `server/routes/cron.ts`, `vercel.json`
- Test: `server/test/cron-publish-scheduled.test.ts`, `package.json`

- [ ] **Step 1: Add the handler**

In `server/routes/cron.ts`, add the `serviceClient` import and a handler:

```ts
import { serviceClient } from "../lib/supabase.js";

cronRoutes.get("/publish-scheduled", async (c) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || c.req.header("Authorization") !== `Bearer ${expected}`)
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  const { data, error } = await serviceClient().rpc("content_publish_scheduled");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ published: data ?? 0 });
});
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Add to the `crons` array:

```json
{ "path": "/api/cron/publish-scheduled", "schedule": "*/10 * * * *" }
```

- [ ] **Step 3: Write the failing test**

Create `server/test/cron-publish-scheduled.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

suite("cron publish-scheduled", () => {
  beforeAll(async () => {
    await cleanup();
    await serviceForTests().from("content_items").insert({
      kind: "announcement", slug: "c1-overdue", status: "scheduled", title_zh: "到期",
      body_zh: "x", scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    });
  });
  afterAll(cleanup);

  it("401s without the secret", async () => {
    expect((await app.request("/api/cron/publish-scheduled")).status).toBe(401);
  });

  it("flips overdue scheduled rows to published", async () => {
    const res = await app.request("/api/cron/publish-scheduled", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status).toBe(200);
    const { data } = await serviceForTests().from("content_items").select("status").eq("slug", "c1-overdue").single();
    expect(data!.status).toBe("published");
  });
});
```

- [ ] **Step 4: Register + run**

Append ` server/test/cron-publish-scheduled.test.ts` to `test:integration`.
Run: `RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/cron-publish-scheduled.test.ts`
Expected: PASS (or SKIP without env).

- [ ] **Step 5: Commit**

```bash
git add server/routes/cron.ts vercel.json server/test/cron-publish-scheduled.test.ts package.json
git commit -m "feat(content-hub): scheduled-publish cron + vercel entry + test"
```

---

## Task 6: Client data layer `src/lib/content.ts`

**Files:** Create `src/lib/content.ts`

- [ ] **Step 1: Write the client module**

Create `src/lib/content.ts`:

```ts
import { apiFetch } from "@/lib/api";
import { adminFetch } from "@/lib/admin";

export type ContentKind = "article" | "announcement";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export type AdminContentRow = {
  id: string; kind: ContentKind; slug: string; status: ContentStatus;
  title_zh: string; title_en: string | null; excerpt_zh: string | null; excerpt_en: string | null;
  body_zh: string; body_en: string | null; cover_image_url: string | null; category_id: string | null;
  pinned: boolean; pinned_rank: number | null; views: number; scheduled_for: string | null;
  published_at: string | null; updated_at: string;
};
export type ContentCategory = { id: string; slug: string; label_zh: string; label_en: string | null; sort: number };

export type NewsItem = {
  id: string; slug: string; kind: ContentKind; title: string; excerpt: string | null;
  body?: string; coverImageUrl: string | null; category: { slug: string; label: string } | null;
  tags: string[]; publishedAt: string | null; pinned: boolean; views: number;
};

export const contentKeys = {
  adminList: (f: Record<string, string>) => ["admin", "content", f] as const,
  adminItem: (id: string) => ["admin", "content", id] as const,
  categories: () => ["admin", "content-categories"] as const,
  news: (f: Record<string, string>) => ["news", f] as const,
  newsItem: (slug: string, lang: string) => ["news", slug, lang] as const,
};

// ---- admin ----
export const listAdminContent = (f: { kind?: string; status?: string; category?: string; q?: string; page?: number } = {}) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  return adminFetch<{ items: AdminContentRow[]; page: number; pageSize: number; total: number }>(`/admin/content?${qs}`);
};
export const getAdminContent = (id: string) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}`);
export const createContent = (body: Partial<AdminContentRow>) => adminFetch<{ item: AdminContentRow }>(`/admin/content`, { method: "POST", body: JSON.stringify(body) });
export const updateContent = (id: string, patch: Partial<AdminContentRow> & { updated_at?: string }) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const contentAction = (id: string, action: "publish" | "unpublish" | "archive") => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}/${action}`, { method: "POST", body: "{}" });
export const scheduleContent = (id: string, scheduled_for: string) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduled_for }) });
export const deleteContent = (id: string) => adminFetch<{ ok: true }>(`/admin/content/${id}`, { method: "DELETE" });
export const listCategories = () => adminFetch<{ categories: ContentCategory[] }>(`/admin/content-categories`);
export async function uploadContentImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const { url } = await adminFetch<{ url: string }>(`/admin/content/media`, { method: "POST", body: fd, headers: {} });
  return url;
}

// ---- creator ----
export const fetchNews = (f: { kind?: string; category?: string; page?: number; lang: string }) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  return apiFetch<{ items: NewsItem[]; page: number; pageSize: number; total: number }>(`/content?${qs}`);
};
export const fetchNewsItem = (slug: string, lang: string) => apiFetch<{ item: NewsItem; related: NewsItem[] }>(`/content/${slug}?lang=${lang}`);
```

> Note: `uploadContentImage` passes `headers: {}` to override `adminFetch`'s default `Content-Type: application/json` so the browser sets the multipart boundary. Confirm `adminFetch` spreads `init.headers` last (it does) — the empty object removes the JSON content-type.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no errors from `src/lib/content.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/content.ts
git commit -m "feat(content-hub): client data layer (admin + creator fetchers)"
```

---

## Task 7: Admin UI — Content tab, list, editor

**Files:**
- Modify: `src/components/admin/AdminTabs.tsx`, `src/lib/i18n.dict.ts`
- Create: `src/routes/admin.content.index.tsx`, `src/routes/admin.content.$id.tsx`, `src/components/admin/ContentEditor.tsx`

- [ ] **Step 1: Add i18n keys**

In `src/lib/i18n.dict.ts`, add to BOTH the `en` and `zh-HK` blocks (place near the existing `app.admin.tab*` keys and add an `app.admin.content.*` group):

```ts
// en block:
"app.admin.tabContent": "Content",
"app.admin.content.title": "Content Hub",
"app.admin.content.new": "New content",
"app.admin.content.empty": "No content yet.",
"app.admin.content.saved": "Saved",
// zh-HK block:
"app.admin.tabContent": "內容",
"app.admin.content.title": "內容管理",
"app.admin.content.new": "新增內容",
"app.admin.content.empty": "尚未有內容。",
"app.admin.content.saved": "已儲存",
```

- [ ] **Step 2: Add the Content tab**

In `src/components/admin/AdminTabs.tsx`, add to the `tabs` array (after Creators):

```tsx
{ to: "/admin/content", label: t("app.admin.tabContent") },
```

- [ ] **Step 3: Write the list route**

Create `src/routes/admin.content.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAdminContent, contentKeys, type ContentStatus } from "@/lib/content";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/content/")({ component: ContentList });

const STATUS_CHIP: Record<ContentStatus, string> = {
  published: "bg-[#c7f9cc]", scheduled: "bg-[#ffe28a]", draft: "bg-gray-200", archived: "bg-gray-300 text-gray-500",
};

function ContentList() {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const filters = status ? { status } : {};
  const { data, isLoading } = useQuery({ queryKey: contentKeys.adminList(filters), queryFn: () => listAdminContent(filters) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t("app.admin.content.title")}</h2>
        <Link to="/admin/content/$id" params={{ id: "new" }} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1.5 text-sm font-bold">
          {t("app.admin.content.new")}
        </Link>
      </div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1 text-sm">
        <option value="">All</option><option value="draft">Draft</option><option value="scheduled">Scheduled</option>
        <option value="published">Published</option><option value="archived">Archived</option>
      </select>
      {isLoading ? (
        <p className="text-sm text-[var(--color-soft-ink)]">…</p>
      ) : !data?.items.length ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.content.empty")}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-[var(--color-ink)] text-left text-xs uppercase">
            <th className="p-2">Title</th><th className="p-2">Kind</th><th className="p-2">Status</th><th className="p-2">Views</th><th />
          </tr></thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="p-2">{it.pinned ? "★ " : ""}{it.title_zh}</td>
                <td className="p-2">{it.kind}</td>
                <td className="p-2"><span className={`rounded-full border border-[var(--color-ink)] px-2 text-xs ${STATUS_CHIP[it.status]}`}>{it.status}</span></td>
                <td className="p-2">{it.views || "—"}</td>
                <td className="p-2"><Link to="/admin/content/$id" params={{ id: it.id }} className="underline">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the editor component**

Create `src/components/admin/ContentEditor.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/components/Markdown";
import {
  getAdminContent, createContent, updateContent, contentAction, scheduleContent,
  listCategories, uploadContentImage, contentKeys, type AdminContentRow,
} from "@/lib/content";

const EMPTY: Partial<AdminContentRow> = { kind: "article", title_zh: "", body_zh: "", title_en: "", body_en: "" };

export function ContentEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [form, setForm] = useState<Partial<AdminContentRow>>(EMPTY);

  useQuery({
    queryKey: contentKeys.adminItem(id), enabled: !isNew,
    queryFn: async () => { const { item } = await getAdminContent(id); setForm(item); return item; },
  });
  const cats = useQuery({ queryKey: contentKeys.categories(), queryFn: listCategories });

  const set = (patch: Partial<AdminContentRow>) => setForm((f) => ({ ...f, ...patch }));
  const titleField = lang === "zh" ? "title_zh" : "title_en";
  const bodyField = lang === "zh" ? "body_zh" : "body_en";

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return (await createContent(form)).item;
      return (await updateContent(id, { ...form, updated_at: form.updated_at })).item;
    },
    onSuccess: (item) => { qc.invalidateQueries({ queryKey: ["admin", "content"] }); if (isNew) navigate({ to: "/admin/content/$id", params: { id: item.id } }); else setForm(item); },
  });
  const act = useMutation({
    mutationFn: (a: "publish" | "unpublish" | "archive") => contentAction(id, a),
    onSuccess: ({ item }) => { setForm(item); qc.invalidateQueries({ queryKey: ["admin", "content"] }); },
  });

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadContentImage(file);
    set({ body_zh: `${form.body_zh ?? ""}\n\n![](${url})` });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setLang("zh")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "zh" ? "bg-[var(--color-ink)] text-white" : ""}`}>中文</button>
          <button onClick={() => setLang("en")} className={`rounded-full border-2 border-[var(--color-ink)] px-3 text-sm ${lang === "en" ? "bg-[var(--color-ink)] text-white" : ""}`}>EN</button>
          {!isNew && <span className="ml-auto text-xs">{form.status}</span>}
        </div>
        <input value={(form[titleField] as string) ?? ""} onChange={(e) => set({ [titleField]: e.target.value })}
          placeholder="Title" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-lg font-bold" />
        <textarea value={(form[bodyField] as string) ?? ""} onChange={(e) => set({ [bodyField]: e.target.value })}
          placeholder="Markdown…" rows={14} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm" />
        <div className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
          <p className="mb-1 text-xs uppercase">Preview</p>
          <Markdown source={(form[bodyField] as string) ?? ""} />
        </div>
      </div>
      <aside className="space-y-3">
        <label className="block text-xs uppercase">Kind
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value as AdminContentRow["kind"] })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            <option value="article">Article</option><option value="announcement">Announcement</option>
          </select>
        </label>
        <label className="block text-xs uppercase">Category
          <select value={form.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            <option value="">—</option>{cats.data?.categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.label_zh}</option>)}
          </select>
        </label>
        <label className="block text-xs uppercase">Cover image<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set({ cover_image_url: await uploadContentImage(f) }); }} className="mt-1 block w-full text-xs" /></label>
        {form.cover_image_url && <img src={form.cover_image_url} alt="" className="rounded border-2 border-[var(--color-ink)]" />}
        <label className="block text-xs uppercase">Insert body image<input type="file" accept="image/*" onChange={onImage} className="mt-1 block w-full text-xs" /></label>
        <label className="flex items-center gap-2 text-xs uppercase"><input type="checkbox" checked={!!form.pinned} onChange={(e) => set({ pinned: e.target.checked, pinned_rank: e.target.checked ? 0 : null })} /> Pin to feed</label>
        <button onClick={() => save.mutate()} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-2 font-bold">Save</button>
        {!isNew && form.status !== "published" && <button onClick={() => act.mutate("publish")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-bold">Publish</button>}
        {!isNew && form.status === "published" && <button onClick={() => act.mutate("archive")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm">Archive</button>}
      </aside>
    </div>
  );
}
```

> Scheduling UI is intentionally minimal in C1: `scheduleContent(id, isoString)` exists in the client; wire a datetime input to it the same way `act` is wired if/when staff need it. Document this as the only deferred admin control.

- [ ] **Step 5: Write the editor route**

Create `src/routes/admin.content.$id.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { ContentEditor } from "@/components/admin/ContentEditor";

export const Route = createFileRoute("/admin/content/$id")({ component: EditorPage });

function EditorPage() {
  const { id } = useParams({ from: "/admin/content/$id" });
  return <ContentEditor id={id} />;
}
```

- [ ] **Step 6: Type-check + build the route tree**

Run: `npm run type-check`
Expected: PASS (this runs `tsr generate`, registering the new `/admin/content` routes).

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AdminTabs.tsx src/lib/i18n.dict.ts src/routes/admin.content.index.tsx src/routes/admin.content.\$id.tsx src/components/admin/ContentEditor.tsx
git commit -m "feat(content-hub): admin Content tab, list, and markdown editor"
```

---

## Task 8: Creator UI — News feed, detail, Home strip

**Files:**
- Modify: `src/components/Markdown.tsx`, `src/lib/i18n.dict.ts`, `src/routes/_app.home.tsx`, `package.json`
- Create: `src/components/news/NewsCard.tsx`, `src/routes/_app.news.index.tsx`, `src/routes/_app.news.$slug.tsx`

- [ ] **Step 1: Add GFM to the shared renderer**

Run: `npm install remark-gfm`
Then update `src/components/Markdown.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-heading [&_h1]:font-bold [&_h2]:font-heading [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline [&_img]:rounded-[var(--radius)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{source}</ReactMarkdown>
    </div>
  );
}
```

(The existing `Markdown.test.tsx` still passes — `rehype-sanitize` runs after `remark-gfm`. If a sanitize assertion exists, confirm it still strips `<script>`.)

- [ ] **Step 2: Add i18n keys (both blocks)**

```ts
// en:
"app.news.title": "Updates",
"app.news.empty": "Nothing here yet.",
"app.news.related": "Related",
"app.home.newsHeading": "Latest",
// zh-HK:
"app.news.title": "資訊",
"app.news.empty": "暫時未有內容。",
"app.news.related": "相關內容",
"app.home.newsHeading": "最新消息",
```

- [ ] **Step 3: Write the shared card**

Create `src/components/news/NewsCard.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { NewsItem } from "@/lib/content";

export function NewsCard({ item }: { item: NewsItem }) {
  return (
    <Link to="/news/$slug" params={{ slug: item.slug }} className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 hover:bg-[var(--color-paper)]">
      {item.coverImageUrl && <img src={item.coverImageUrl} alt="" className="mb-2 aspect-video w-full rounded object-cover" />}
      <div className="flex items-center gap-2 text-xs text-[var(--color-soft-ink)]">
        {item.category && <span className="rounded-full border border-[var(--color-ink)] px-2">{item.category.label}</span>}
        {item.kind === "announcement" && <span>📣</span>}
      </div>
      <h3 className="mt-1 font-heading font-bold">{item.title}</h3>
      {item.excerpt && <p className="mt-1 line-clamp-2 text-sm text-[var(--color-soft-ink)]">{item.excerpt}</p>}
    </Link>
  );
}
```

- [ ] **Step 4: Write the feed route**

Create `src/routes/_app.news.index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchNews, contentKeys } from "@/lib/content";
import { NewsCard } from "@/components/news/NewsCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/news/")({ component: NewsFeed });

function NewsFeed() {
  const { t, lang } = useI18n();
  const filters = { lang };
  const { data, isLoading } = useQuery({ queryKey: contentKeys.news(filters), queryFn: () => fetchNews(filters) });
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 lg:max-w-5xl">
      <h1 className="font-display text-xl font-bold">{t("app.news.title")}</h1>
      {isLoading ? <p className="text-sm">…</p>
        : !data?.items.length ? <p className="text-sm text-[var(--color-soft-ink)]">{t("app.news.empty")}</p>
        : <div className="grid gap-3 lg:grid-cols-2">{data.items.map((it) => <NewsCard key={it.id} item={it} />)}</div>}
    </div>
  );
}
```

> Confirm the `useI18n()` hook exposes the current `lang` (e.g. `"en"` | `"zh-HK"`). If it is named differently (e.g. `locale`), use that. Check `src/lib/i18n.tsx` and adjust.

- [ ] **Step 5: Write the detail route**

Create `src/routes/_app.news.$slug.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchNewsItem, contentKeys } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { NewsCard } from "@/components/news/NewsCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/news/$slug")({ component: NewsDetail });

function NewsDetail() {
  const { t, lang } = useI18n();
  const { slug } = useParams({ from: "/_app/news/$slug" });
  const { data, isLoading } = useQuery({ queryKey: contentKeys.newsItem(slug, lang), queryFn: () => fetchNewsItem(slug, lang) });
  if (isLoading) return <div className="p-4 text-sm">…</div>;
  if (!data) return <div className="p-4 text-sm">{t("app.news.empty")}</div>;
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-4">
      {data.item.coverImageUrl && <img src={data.item.coverImageUrl} alt="" className="aspect-video w-full rounded-[var(--radius)] object-cover" />}
      <h1 className="font-display text-2xl font-bold">{data.item.title}</h1>
      {data.item.body && <Markdown source={data.item.body} />}
      {data.related.length > 0 && (
        <section className="space-y-2 border-t-2 border-[var(--color-ink)] pt-4">
          <h2 className="font-heading font-bold">{t("app.news.related")}</h2>
          <div className="grid gap-3 lg:grid-cols-2">{data.related.map((r) => <NewsCard key={r.id} item={r} />)}</div>
        </section>
      )}
    </article>
  );
}
```

- [ ] **Step 6: Add the Home announcement strip**

In `src/routes/_app.home.tsx`, add an announcements query and render a strip of pinned items near the top of the page body:

```tsx
// imports
import { useQuery } from "@tanstack/react-query";
import { fetchNews, contentKeys } from "@/lib/content";
import { NewsCard } from "@/components/news/NewsCard";
import { useI18n } from "@/lib/i18n"; // if not already imported

// inside the component (lang from useI18n):
const news = useQuery({ queryKey: contentKeys.news({ kind: "announcement", lang }), queryFn: () => fetchNews({ kind: "announcement", lang }) });

// in the JSX, above the existing home content:
{news.data?.items.length ? (
  <section className="space-y-2">
    <h2 className="font-heading font-bold">{t("app.home.newsHeading")}</h2>
    <div className="grid gap-3 lg:grid-cols-2">{news.data.items.slice(0, 2).map((it) => <NewsCard key={it.id} item={it} />)}</div>
  </section>
) : null}
```

> Read `src/routes/_app.home.tsx` first to place this inside the existing layout wrapper without breaking its structure; match the surrounding spacing/section pattern.

- [ ] **Step 7: Frontend route test (feed render + empty state)**

Mirror the provider setup of an existing route test — open `src/routes/-_app.guide.index.test.tsx` and copy its render harness (QueryClientProvider + i18n provider + router stub) and its mock style for the data fetcher. Create `src/routes/-_app.news.index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
// Reuse the SAME wrapper/render helper as -_app.guide.index.test.tsx (copy its imports + renderWithProviders).
import { NewsFeed } from "./_app.news.index"; // export the component if the test needs it, else test via the route harness in the guide test
import * as content from "@/lib/content";

describe("NewsFeed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders cards for returned items", async () => {
    vi.spyOn(content, "fetchNews").mockResolvedValue({ items: [{ id: "1", slug: "x", kind: "article", title: "夏日防曬", excerpt: null, coverImageUrl: null, category: null, tags: [], publishedAt: null, pinned: false, views: 0 }], page: 1, pageSize: 20, total: 1 });
    renderWithProviders(<NewsFeed />); // from the copied harness
    expect(await screen.findByText("夏日防曬")).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", async () => {
    vi.spyOn(content, "fetchNews").mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<NewsFeed />);
    expect(await screen.findByText(/暫時未有內容|Nothing here/)).toBeInTheDocument();
  });
});
```

If the existing guide test renders through the generated router rather than importing the component, follow that pattern instead and drop the `NewsFeed` export. Run: `npx vitest run src/routes/-_app.news.index.test.tsx` → PASS.

- [ ] **Step 8: Type-check**

Run: `npm run type-check`
Expected: PASS (registers `/news` routes via `tsr generate`).

- [ ] **Step 9: Commit**

```bash
git add src/components/Markdown.tsx src/lib/i18n.dict.ts src/routes/_app.news.index.tsx src/routes/_app.news.\$slug.tsx src/routes/-_app.news.index.test.tsx src/components/news/NewsCard.tsx src/routes/_app.home.tsx package.json package-lock.json
git commit -m "feat(content-hub): creator News feed, detail, Home strip, GFM renderer + test"
```

---

## Task 9: Final verification & rollout

**Files:** none (verification + prod steps)

- [ ] **Step 1: Full gates**

Run, expecting each to pass:
```bash
npm run lint
npm run type-check
npm run build
npx vitest run            # unit tests
```

- [ ] **Step 2: Integration suite (machine with local Supabase)**

Run: `npm run test:integration` (with `.env.test.local` exported).
Expected: the 3 new suites pass alongside the existing ones.

- [ ] **Step 3: Manual smoke (local dev)**

Run: `npm run dev`, then: sign in as staff → `/admin/content` → New → write zh title + markdown body → Save → Publish. Sign in as a creator → `/news` shows it → open detail → views increment → Home shows a pinned announcement.

- [ ] **Step 4: Prod migration BEFORE deploy**

Apply `supabase/migrations/0021_content_hub.sql` to prod (`mhkoayftiuojxlrkollf`) via **Supabase MCP raw SQL / `execute_sql`** (NOT `apply_migration` — tracker drift), then run `notify pgrst, 'reload schema';`. Verify the 4 tables + 2 RPCs + `content-media` bucket exist.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/content-hub-c1
gh pr create --title "feat: Content Hub (CMS Slice C1)" --body "Implements docs/superpowers/specs/2026-06-23-adfocate-content-hub-design.md. Migration 0021 applied to prod before deploy. Academy migration deferred to C1.5."
```

- [ ] **Step 6: Post-merge checklist**

- Confirm the `publish-scheduled` cron appears in the Vercel project crons after deploy.
- `STAFF_EMAIL_ALLOWLIST` already set (B3a); no new env vars required for C1.
- Smoke `/admin/content` and `/news` on the deployed URL.

---

## Notes & deferrals (carried from spec §12)

- **Academy → DB is C1.5**, not this slice. Do not touch `/guide`, `src/data/academy.ts`, `guideDocs.ts`, `eligibility()`, `guideProgress.ts`, or `scripts/ingest-kb.ts`.
- Deferred within C1: scheduling UI control (client method exists, wire later), category/tag management UI (endpoints exist; editor reads seeded categories), YouTube/callout blocks, full-text search, revision history.
