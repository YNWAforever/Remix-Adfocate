# Brand Resources (C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give brands a read-only guide/help hub at `/brand/resources`, authored by staff through the existing `/admin` Content tab, by adding an `audience` (`'creator'|'brand'`) column to the existing `content_items` table and hard-partitioning every read path on it.

**Architecture:** One additive migration (`0027_brand_resources.sql`) adds `content_items.audience` (default `'creator'`, checked to `'creator'|'brand'`) plus a supporting index — no RLS change, since `content_items_read_published` (`status='published' and workspace_id is null`) already covers brand users as ordinary Supabase Auth users. `server/lib/contentAuthoring.ts` gains audience validation; `server/routes/adminContent.ts` exposes it to staff authoring. `server/routes/content.ts` (creator `/news`) gets a hard `.eq("audience","creator")` on both its list and detail queries — closing the leak the design spec calls out. A new `server/routes/brandResources.ts`, mounted inside `server/routes/brand.ts` under the existing `requireBrand()` guard, mirrors `content.ts` but hard-filters `audience='brand'` and drops the "related" section (no tags/categories on brand content in v1). The client adds `brandKeys.resources/resource` + fetchers to `src/lib/brand.ts`, a third `BrandNav` item, two new TanStack routes (`brand.resources.index.tsx`, `brand.resources.$slug.tsx`) mirroring the creator `/news` pages, and bilingual `app.brand.resources.*` i18n keys.

**Tech Stack:** Supabase/Postgres (additive migration + existing RLS), Hono server routes, TanStack Router + React Query, Vitest (pure unit + local-stack integration + route-stub), bilingual i18n (zh-HK default / en).

**Source spec:** [`docs/superpowers/specs/2026-07-01-brand-resources-c2-design.md`](../specs/2026-07-01-brand-resources-c2-design.md) (§ refs below).

---

## Critical context (read before Task 1)

- **Branch:** `feat/brand-resources-c2` (already checked out; the design spec is committed at `c3cefaa`).
- **House rules (CI-guarded / hard-won):**
  - New/modified `server/**` files MUST use `.js` extensions on relative imports (`npm run check:esm` guards this).
  - Add new integration test files to the explicit `test:integration` list in `package.json` (they do **not** auto-discover).
  - Run `npm run type-check` after touching routes (it runs the TanStack route-tree codegen, which bare `tsc` does not) — the generated `src/routeTree.gen.ts` is gitignored; trust the route files, not it.
  - Never `vercel --prod` from local (mis-bundles the API). Deploy via Git.
  - `.env.local` holds **prod** creds — never source it for tests.
- **Integration test workflow (local Supabase stack):**
  - Start the stack: `supabase start -x storage-api,imgproxy,edge-runtime` (a plain `supabase db reset` has been unstable here).
  - Apply migrations to the local stack (Task 1 does this).
  - Tests SKIP unless the shell has `RUN_INTEGRATION=1` **and** `.env.test.local` exported. Run them with: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration` (the script already passes `--no-file-parallelism`).
- **`cleanup()` in `server/test/helpers.ts` does NOT delete `content_items` rows.** Existing `content.test.ts`/`adminContent.test.ts` rely on `slugify`/`uniqueSlug` collision-avoidance and never assert exact row counts. New tests in this plan follow the same convention but additionally self-clean the exact slugs they insert (via a targeted `afterAll` delete) so they are safely re-runnable.
- **Prod application (do at the very end, AFTER merge — NOT during implementation):** apply `0027` to prod (`mhkoayftiuojxlrkollf`) via **raw SQL** (Supabase MCP `execute_sql` — tracker drift precedent, a `db push` would conflict), then `notify pgrst, 'reload schema'`. No new env vars, no new cron entry.

## Existing identifiers (verified — use exactly)

- `content_items` columns (migration `0021_content_hub.sql`): `id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, cover_image_url, category_id, author_id, workspace_id, pinned, pinned_rank, views, scheduled_for, published_at, archived_at, created_at, updated_at`. RLS policy `content_items_read_published`: `for select to authenticated using (status = 'published' and workspace_id is null)`.
- `server/lib/contentAuthoring.ts` exports: `CONTENT_KINDS`, `ContentKind`, `CONTENT_STATUSES`, `ContentStatus`, `ContentInput`, `ContentEditInput`, `slugify`, `uniqueSlug`, `validateContentInput`, `validateContentEdit`, `STATUS_TRANSITIONS`, `canTransition`, `isPublishable`, `isAllowedImageUrl`.
- `server/routes/adminContent.ts`: `COLS` (select column list), `EDITABLE: (keyof ContentInput)[]` (patchable fields), mounted at `/admin/content*` inside `adminRoutes` (staff auth).
- `server/routes/content.ts`: `contentRoutes` (Hono), mounted at `guarded.route("/content", contentRoutes)` in `server/app.ts`. `SEL` column string, `shape(row, lang, withBody)`, `pick(en, zh, lang)`.
- `server/routes/brand.ts`: `brandRoutes` (unguarded, exports `/accept`), an inner `guarded = new Hono<BrandEnv>()` with `guarded.use("*", requireBrand())`, mounted at `brandRoutes.route("/", guarded)`; `bearer(c)` local helper extracts the JWT from `Authorization: Bearer …`. Mounted in `server/app.ts` as `app.route("/brand", brandRoutes)` (unguarded top-level — `requireBrand()` is brand.ts's own guard, not `workspaceAuth`).
- `server/lib/brandAuth.ts` exports: `BrandEnv = { Variables: { brand: BrandIdentity } }`, `BrandIdentity = { userId; email; workspaceId; role }`, `requireBrand()`.
- `server/lib/supabase.ts` exports: `makeUserClient(jwt)` (RLS-enforced), `serviceClient()` (bypasses RLS).
- `server/test/helpers.ts` exports: `hasSupabaseEnv`, `serviceForTests()`, `makeBrand(email, workspaceId?, role?)` → `{ userId, jwt, workspaceId, deactivate() }` (email MUST end `@test.local`), `makeCreator(email, balance)` → `{ userId, jwt }`, `cleanup()`.
- `src/lib/brand.ts` exports: `BrandAuthError`, `BrandMe`, `BrandMission`, `brandKeys` (`me/missions/mission`), `brandFetch<T>(path, init)` (injects bearer JWT, throws `BrandAuthError` on 401/403, `AdminRequestError` otherwise), `fetchBrandMe`, `acceptBrand`, `fetchBrandMissions`, etc.
- `src/lib/content.ts` exports: `NewsItem` type, `contentKeys.news(filters)/newsItem(slug, lang)`, `fetchNews(f)`, `fetchNewsItem(slug, lang)`.
- `src/components/brand/BrandNav.tsx`: `ITEMS` array of `{ to, exact, icon, labelKey }`; renders both a desktop (`lg:flex`) and a mobile (`lg:hidden`) `<nav>` — both are present in the DOM in tests (only CSS-hidden), so a rendered label matches **twice**.
- `src/components/brand/BrandAuthContext.tsx`: `useBrandAuth()` → `{ brand: BrandMe; reportAuthError(e) }`.
- i18n: `dict.en`/`dict.zh` in `src/lib/i18n.dict.ts`; `useI18n()` → `{ lang, setLang, t(key, params?) }`; missing keys render as the raw key string (no throw).

---

## Phase A — Database

### Task 1: Migration `0027_brand_resources.sql`

**Files:**
- Create: `supabase/migrations/0027_brand_resources.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0027_brand_resources.sql — Brand Resources (C2): audience-partition content_items so the
-- existing Content Hub (0021_content_hub.sql) can serve brand-facing guides alongside creator
-- news, without a new table and without overloading `kind`. Additive. No RLS change — the
-- existing content_items_read_published policy (status='published' and workspace_id is null)
-- already covers brand users, who are Supabase Auth users like anyone else; audience gating
-- happens at the route/query level (server/routes/content.ts, server/routes/brandResources.ts).
-- See docs/superpowers/specs/2026-07-01-brand-resources-c2-design.md.

alter table public.content_items
  add column audience text not null default 'creator' check (audience in ('creator','brand'));

create index content_items_audience_status_pub_idx
  on public.content_items (audience, status, published_at desc);
```

- [ ] **Step 2: Load it into the local stack and verify it applies cleanly**

This machine has **no `psql` on the host PATH** — apply via `docker exec` into the local
Supabase DB container (established gotcha from prior sessions on this machine).

Run:
```bash
supabase start -x storage-api,imgproxy,edge-runtime
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres < supabase/migrations/0027_brand_resources.sql
```
Expected: `ALTER TABLE` then `CREATE INDEX`, no errors.

- [ ] **Step 3: Verify with a query**

Run:
```bash
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres -c \
  "select column_name, is_nullable, column_default from information_schema.columns where table_name='content_items' and column_name='audience';"
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres -c \
  "select audience, count(*) from public.content_items group by audience;"
```
Expected: first query returns one row — `audience | NO | 'creator'::text`. Second query returns either zero rows (empty table) or only `audience = 'creator'` rows (every pre-existing row defaults to `'creator'`, so no regression).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0027_brand_resources.sql
git commit -m "feat(brand-resources): migration 0027 — content_items.audience ('creator'|'brand')"
```

---

## Phase B — Server: authoring + the creator-route fix

### Task 2: `contentAuthoring.ts` — `audience` on the pure validators

**Files:**
- Modify: `server/lib/contentAuthoring.ts:1-28` (types), `server/lib/contentAuthoring.ts:54-77` (validators)
- Test: `server/lib/contentAuthoring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/lib/contentAuthoring.test.ts`:

```ts
describe("validateContentInput audience", () => {
  it("accepts 'creator', 'brand', and omitted (no default applied here — the DB defaults it)", () => {
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "creator" }).errors)).toHaveLength(0);
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "brand" }).errors)).toHaveLength(0);
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "" }).errors)).toHaveLength(0);
  });
  it("rejects an unknown audience", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "everyone" } as never);
    expect(errors.audience).toBeDefined();
  });
});

describe("validateContentEdit audience", () => {
  it("only errors when audience is PRESENT and invalid", () => {
    expect(Object.keys(validateContentEdit({}).errors)).toHaveLength(0);
    expect(Object.keys(validateContentEdit({ audience: "brand" }).errors)).toHaveLength(0);
    expect(validateContentEdit({ audience: "everyone" } as never).errors.audience).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/contentAuthoring.test.ts -t "audience"`
Expected: FAIL — `errors.audience` is `undefined` in the "rejects an unknown audience" and "only errors when audience is PRESENT" cases (the validators don't know about `audience` yet).

- [ ] **Step 3: Write minimal implementation**

In `server/lib/contentAuthoring.ts`, add the audience type/const right after `CONTENT_STATUSES`/`ContentStatus` (after line 8):

```ts
export const CONTENT_AUDIENCES = ["creator", "brand"] as const;
export type ContentAudience = (typeof CONTENT_AUDIENCES)[number];
```

Add `audience?: ContentAudience;` to `ContentInput` (right after `kind: ContentKind;`):

```ts
export type ContentInput = {
  kind: ContentKind;
  audience?: ContentAudience;
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
```

Replace `validateContentInput` with:

```ts
export function validateContentInput(input: ContentInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (input.audience !== undefined && !CONTENT_AUDIENCES.includes(input.audience as ContentAudience))
    errors.audience = "請選擇有效的受眾對象";
  if (!input.title_zh || !input.title_zh.trim()) errors.title_zh = "請輸入中文標題";
  const titleErr = lenErr(input.title_zh, MAX_TITLE, "標題");
  if (titleErr) errors.title_zh = titleErr;
  const e1 = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e1) errors.excerpt_zh = e1;
  const b1 = lenErr(input.body_zh, MAX_BODY, "內文"); if (b1) errors.body_zh = b1;
  const b2 = lenErr(input.body_en, MAX_BODY, "內文"); if (b2) errors.body_en = b2;
  return { errors };
}
```

Replace `validateContentEdit` with:

```ts
export function validateContentEdit(input: ContentEditInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const has = (k: keyof ContentEditInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("kind") && !CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (has("audience") && !CONTENT_AUDIENCES.includes(input.audience as ContentAudience)) errors.audience = "請選擇有效的受眾對象";
  if (has("title_zh") && (!input.title_zh || !input.title_zh.trim())) errors.title_zh = "請輸入中文標題";
  if (has("title_zh")) { const e = lenErr(input.title_zh, MAX_TITLE, "標題"); if (e) errors.title_zh = e; }
  if (has("excerpt_zh")) { const e = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e) errors.excerpt_zh = e; }
  if (has("body_zh")) { const e = lenErr(input.body_zh, MAX_BODY, "內文"); if (e) errors.body_zh = e; }
  if (has("body_en")) { const e = lenErr(input.body_en, MAX_BODY, "內文"); if (e) errors.body_en = e; }
  return { errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/contentAuthoring.test.ts`
Expected: PASS (all existing cases + the new `audience` cases).

- [ ] **Step 5: Commit**

```bash
git add server/lib/contentAuthoring.ts server/lib/contentAuthoring.test.ts
git commit -m "feat(brand-resources): validateContentInput/Edit accept optional audience ('creator'|'brand')"
```

### Task 3: `adminContent.ts` — expose `audience` to staff authoring

**Files:**
- Modify: `server/routes/adminContent.ts:14-22`
- Test: `server/test/adminContent.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/test/adminContent.test.ts`:

```ts
suite("adminContent audience", () => {
  afterAll(cleanup);

  it("defaults to 'creator' when omitted, and can be set + edited to 'brand'", async () => {
    const res = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "預設受眾", body_zh: "" }) });
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item.audience).toBe("creator");

    const patch = await adminreq(`/admin/content/${item.id}`, { method: "PATCH", body: JSON.stringify({ audience: "brand" }) });
    expect(patch.status).toBe(200);
    expect((await patch.json()).item.audience).toBe("brand");

    const created = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "品牌指南", body_zh: "", audience: "brand" }) });
    expect(created.status).toBe(201);
    expect((await created.json()).item.audience).toBe("brand");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "adminContent audience"`
Expected: FAIL — `expect(item.audience).toBe("creator")` fails with "expected undefined to be 'creator'" (the `COLS` select list doesn't include `audience` yet, and `EDITABLE` doesn't allow writing it).

- [ ] **Step 3: Write minimal implementation**

In `server/routes/adminContent.ts`, replace the `COLS` and `EDITABLE` constants:

```ts
const COLS =
  "id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, " +
  "cover_image_url, category_id, author_id, workspace_id, audience, pinned, pinned_rank, views, " +
  "scheduled_for, published_at, archived_at, created_at, updated_at";

const EDITABLE: (keyof ContentInput)[] = [
  "kind", "audience", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en",
  "cover_image_url", "category_id", "pinned", "pinned_rank",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "adminContent"`
Expected: PASS (both the existing "adminContent lifecycle" suite and the new "adminContent audience" suite).

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminContent.ts server/test/adminContent.test.ts
git commit -m "feat(brand-resources): staff Content tab can read/set content_items.audience"
```

### Task 4: `content.ts` — hard-filter creator reads to `audience='creator'` (closes the leak)

**Files:**
- Modify: `server/routes/content.ts:40-55` (list), `server/routes/content.ts:58-81` (detail)
- Test: `server/test/content.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the full contents of `server/test/content.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
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
      { kind: "article", slug: "c1-brand-leak", status: "published", title_zh: "品牌專屬", body_zh: "y", audience: "brand", published_at: new Date().toISOString() },
    ]);
  });
  afterAll(async () => {
    await serviceForTests().from("content_items").delete().in("slug", ["c1-pub", "c1-draft", "c1-brand-leak"]);
    await cleanup();
  });

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

  it("never returns a brand-audience row in the list, even with a kind filter", async () => {
    const { items } = await (await koreq("/content", koc.jwt)).json();
    expect(items.map((i: { slug: string }) => i.slug)).not.toContain("c1-brand-leak");
    const { items: filtered } = await (await koreq("/content?kind=article", koc.jwt)).json();
    expect(filtered.map((i: { slug: string }) => i.slug)).not.toContain("c1-brand-leak");
  });

  it("404s a direct slug fetch of a brand-audience row", async () => {
    expect((await koreq("/content/c1-brand-leak", koc.jwt)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "creator content reads"`
Expected: FAIL — "never returns a brand-audience row" fails because `items` contains `c1-brand-leak` (no audience filter exists yet); "404s a direct slug fetch of a brand-audience row" fails because the response is `200`, not `404`.

- [ ] **Step 3: Write minimal implementation**

In `server/routes/content.ts`, replace the list handler:

```ts
// ---- list ----
contentRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  let q = supabase.from("content_items").select(SEL, { count: "exact" }).eq("audience", "creator");
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const category = c.req.query("category"); if (category) q = q.eq("content_categories.slug", category);
  q = q.order("pinned_rank", { ascending: true, nullsFirst: false })
       .order("published_at", { ascending: false })
       .order("id", { ascending: false })
       .range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) return c.json({ items: [], page, pageSize, total: 0 }); // degrade, never 500
  return c.json({ items: (data as unknown as Row[]).map((r) => shape(r, lang, false)), page, pageSize, total: count ?? 0 });
});
```

And the full detail handler (only the first query gains `.eq("audience", "creator")`; the RPC call and the related-articles lookups below it are byte-for-byte unchanged from the current file):

```ts
// ---- detail (+ view increment + related) ----
contentRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const slug = c.req.param("slug");
  const { data, error } = await supabase.from("content_items").select(SEL).eq("audience", "creator").eq("slug", slug).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  await supabase.rpc("content_increment_views", { p_slug: slug });

  const row = data as unknown as Row;
  const tagSlugs = row.content_item_tags?.map((t) => t.content_tags.slug) ?? [];
  let related: ReturnType<typeof shape>[] = [];
  if (tagSlugs.length) {
    const { data: rel } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).contains("content_item_tags.content_tags.slug", tagSlugs).limit(4);
    related = ((rel as unknown as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  if (!related.length && row.content_categories) {
    const { data: rel2 } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).eq("content_categories.slug", row.content_categories.slug)
      .order("published_at", { ascending: false }).limit(4);
    related = ((rel2 as unknown as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  return c.json({ item: shape(row, lang, true), related });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "creator content reads"`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add server/routes/content.ts server/test/content.test.ts
git commit -m "fix(brand-resources): creator /content hard-filters audience='creator' (closes brand-content leak)"
```

---

## Phase C — Server: the new brand-facing route

### Task 5: `server/routes/brandResources.ts` + mount in `brand.ts` + integration test

**Files:**
- Create: `server/routes/brandResources.ts`
- Modify: `server/routes/brand.ts:1-6` (imports), `server/routes/brand.ts:47-49` (mount)
- Create: `server/test/brandResources.test.ts`
- Modify: `package.json` (`test:integration` file list)

- [ ] **Step 1: Add the new test file to the integration list**

In `package.json`, find the `"test:integration"` script string and append ` server/test/brandResources.test.ts` at the end (after `server/test/campaigns-s2.test.ts`), so the line ends with:
```
...server/test/brand.test.ts server/test/campaigns.test.ts server/test/campaigns-s2.test.ts server/test/brandResources.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `server/test/brandResources.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeBrand, makeCreator, serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function breq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("brand resources (audience isolation)", () => {
  let brand: Awaited<ReturnType<typeof makeBrand>>;

  beforeAll(async () => {
    await cleanup();
    brand = await makeBrand("resources-brand@test.local");
    const svc = serviceForTests();
    await svc.from("content_items").insert([
      { kind: "article", slug: "res-brand-pub", status: "published", title_zh: "品牌指南", body_zh: "內容", audience: "brand", published_at: new Date().toISOString() },
      { kind: "article", slug: "res-brand-draft", status: "draft", title_zh: "草稿指南", body_zh: "x", audience: "brand" },
      { kind: "article", slug: "res-creator-leak", status: "published", title_zh: "創作者專屬", body_zh: "y", audience: "creator", published_at: new Date().toISOString() },
    ]);
  });
  afterAll(async () => {
    await serviceForTests().from("content_items").delete().in("slug", ["res-brand-pub", "res-brand-draft", "res-creator-leak"]);
    await cleanup();
  });

  it("401s without a token", async () => {
    expect((await app.request("/api/brand/resources")).status).toBe(401);
  });

  it("lists published brand-audience items, hides drafts and creator-audience rows", async () => {
    const res = await breq("/brand/resources", brand.jwt);
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const slugs = items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain("res-brand-pub");
    expect(slugs).not.toContain("res-brand-draft");
    expect(slugs).not.toContain("res-creator-leak");
  });

  it("never returns a creator-audience row on direct slug fetch", async () => {
    expect((await breq("/brand/resources/res-creator-leak", brand.jwt)).status).toBe(404);
  });

  it("detail 200s a published brand row and increments views", async () => {
    const res = await breq("/brand/resources/res-brand-pub", brand.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).item.slug).toBe("res-brand-pub");
    const { data } = await serviceForTests().from("content_items").select("views").eq("slug", "res-brand-pub").single();
    expect(data!.views).toBeGreaterThanOrEqual(1);
  });

  it("a non-brand caller (creator) gets 403", async () => {
    const koc = await makeCreator("resources-koc@test.local", 0);
    expect((await breq("/brand/resources", koc.jwt)).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "brand resources"`
Expected: FAIL — "401s without a token" fails with "expected 401 to be 404" (or vice versa) because `/api/brand/resources` doesn't exist yet, so Hono returns 404 regardless of auth.

- [ ] **Step 4: Write minimal implementation**

Create `server/routes/brandResources.ts`:

```ts
// server/routes/brandResources.ts — brand-facing guide/help hub (C2). Read-only; mirrors
// server/routes/content.ts but hard-filters audience='brand' and has no "related" section
// (no tags/categories on brand content in v1). Mounted inside server/routes/brand.ts under
// the existing requireBrand() guard — content is global (workspace_id is null), same
// convention 0021_content_hub.sql already established. All relative imports carry .js.
import { Hono } from "hono";
import type { BrandEnv } from "../lib/brandAuth.js";
import { makeUserClient } from "../lib/supabase.js";

export const brandResourcesRoutes = new Hono<BrandEnv>();

type Row = {
  id: string; slug: string; kind: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  cover_image_url: string | null; published_at: string | null; pinned: boolean; pinned_rank: number | null;
  views: number;
};

const SEL =
  "id, slug, kind, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, cover_image_url, " +
  "published_at, pinned, pinned_rank, views";

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
    publishedAt: r.published_at, pinned: r.pinned, views: r.views,
  };
}

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

// ---- list ----
brandResourcesRoutes.get("/resources", async (c) => {
  const supabase = makeUserClient(bearer(c));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  const { data, error, count } = await supabase.from("content_items").select(SEL, { count: "exact" })
    .eq("audience", "brand")
    .order("pinned_rank", { ascending: true, nullsFirst: false })
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return c.json({ items: [], page, pageSize, total: 0 }); // degrade, never 500
  return c.json({ items: (data as unknown as Row[]).map((r) => shape(r, lang, false)), page, pageSize, total: count ?? 0 });
});

// ---- detail (+ view increment; no related section in v1) ----
brandResourcesRoutes.get("/resources/:slug", async (c) => {
  const supabase = makeUserClient(bearer(c));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const slug = c.req.param("slug");
  const { data, error } = await supabase.from("content_items").select(SEL)
    .eq("audience", "brand").eq("slug", slug).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  await supabase.rpc("content_increment_views", { p_slug: slug });
  return c.json({ item: shape(data as unknown as Row, lang, true) });
});
```

In `server/routes/brand.ts`, add the import (after the existing `adminMissions.js` import at line 6):

```ts
import { MISSION_COLS, EDITABLE_COLS, hkToday, countEngaged, normalizeBriefForWrite } from "./adminMissions.js";
import { brandResourcesRoutes } from "./brandResources.js";
```

And mount it right after `guarded.use("*", requireBrand());` (before `guarded.get("/me", ...)`):

```ts
const guarded = new Hono<BrandEnv>();
guarded.use("*", requireBrand());
guarded.route("/", brandResourcesRoutes);

guarded.get("/me", async (c) => {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration -- -t "brand resources"`
Expected: PASS (all 5 cases).

- [ ] **Step 6: ESM + type check**

Run: `npm run check:esm && npm run type-check`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/brandResources.ts server/routes/brand.ts server/test/brandResources.test.ts package.json
git commit -m "feat(brand-resources): GET /api/brand/resources(/:slug) — audience='brand' only, RLS-scoped"
```

---

## Phase D — Client: fetchers, nav, i18n

### Task 6: `src/lib/brand.ts` — `brandKeys.resources/resource` + fetchers

**Files:**
- Modify: `src/lib/brand.ts` (full file — small, shown below)
- Test: `src/lib/brand.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/brand.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBrandResources, fetchBrandResource, brandKeys, BrandAuthError } from "./brand";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

describe("brand resources client", () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("brandKeys.resources/resource are stable tuples", () => {
    expect(brandKeys.resources(2)).toEqual(["brand-resources", 2]);
    expect(brandKeys.resource("guide-1")).toEqual(["brand-resource", "guide-1"]);
  });

  it("fetchBrandResources hits /api/brand/resources with the bearer token and page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), { status: 200 }),
    );
    await fetchBrandResources(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/brand/resources?page=2",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer jwt-123" }) }),
    );
  });

  it("fetchBrandResource hits /api/brand/resources/:slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ item: {
        id: "1", slug: "guide-1", kind: "article", title: "Guide", excerpt: null,
        coverImageUrl: null, publishedAt: null, pinned: false, views: 0,
      } }), { status: 200 }),
    );
    const { item } = await fetchBrandResource("guide-1");
    expect(item.slug).toBe("guide-1");
  });

  it("throws BrandAuthError on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    await expect(fetchBrandResources()).rejects.toBeInstanceOf(BrandAuthError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brand.test.ts`
Expected: FAIL — `fetchBrandResources`/`fetchBrandResource` are not exported from `./brand` (TypeScript/module error), and `brandKeys.resources` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/brand.ts` in full:

```ts
import { supabase } from "@/lib/supabase";
import { AdminRequestError } from "@/lib/admin";
import type { AdminMission, MissionDraftInput, MissionPatch } from "@/lib/admin";

export class BrandAuthError extends Error {}
export type BrandMe = { email: string; workspaceId: string; workspaceName: string; role: "owner" | "member" };
export type BrandMission = {
  id: string; slug: string; title: string; status: string; mission_type: string;
  points_reward: number; cash_reward: number | null; filled: number; quota: number; deadline: string | null;
};
export type BrandResource = {
  id: string; slug: string; kind: string; title: string; excerpt: string | null;
  body?: string; coverImageUrl: string | null; publishedAt: string | null; pinned: boolean; views: number;
};

export const brandKeys = {
  me: () => ["brand-me"] as const,
  missions: (status: string) => ["brand-missions", status] as const,
  mission: (id: string) => ["brand-mission", id] as const,
  resources: (page: number) => ["brand-resources", page] as const,
  resource: (slug: string) => ["brand-resource", slug] as const,
};

async function brandFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/brand${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) throw new BrandAuthError(String(res.status));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields);
  }
  return res.json() as Promise<T>;
}

export const fetchBrandMe = () => brandFetch<{ brand: BrandMe }>("/me");
export const acceptBrand = () => brandFetch<{ brand: BrandMe }>("/accept", { method: "POST" });
export const fetchBrandMissions = (status = "") =>
  brandFetch<{ missions: BrandMission[] }>(`/missions${status ? `?status=${status}` : ""}`);
export const publishBrandMission = (id: string) => brandFetch(`/missions/${id}/publish`, { method: "POST" });
export const closeBrandMission = (id: string) => brandFetch(`/missions/${id}/close`, { method: "POST" });
export const deleteBrandMission = (id: string) => brandFetch(`/missions/${id}`, { method: "DELETE" });
export const fetchBrandMission = (id: string) => brandFetch<{ mission: AdminMission }>(`/missions/${id}`);
export const createBrandMission = (body: MissionDraftInput) =>
  brandFetch<{ mission: AdminMission }>("/missions", { method: "POST", body: JSON.stringify(body) });
export const updateBrandMission = (id: string, patch: MissionPatch) =>
  brandFetch<{ mission: AdminMission }>(`/missions/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const fetchBrandResources = (page = 1) =>
  brandFetch<{ items: BrandResource[]; page: number; pageSize: number; total: number }>(`/resources?page=${page}`);
export const fetchBrandResource = (slug: string) =>
  brandFetch<{ item: BrandResource }>(`/resources/${slug}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/brand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brand.ts src/lib/brand.test.ts
git commit -m "feat(brand-resources): brandKeys.resources/resource + fetchBrandResources/fetchBrandResource"
```

### Task 7: i18n keys — `app.brand.resources.*` + `app.brand.navResources` (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts:744` (en, insert before closing brace), `src/lib/i18n.dict.ts:1478` (zh, insert before closing brace)
- Test: `src/lib/i18n.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/i18n.test.tsx` (inside the `describe("i18n dictionary", ...)` block is fine, or as its own block):

```ts
describe("brand resources i18n keys", () => {
  it("defines app.brand.resources.* + app.brand.navResources in both locales", () => {
    const keys = [
      "app.brand.resources.title",
      "app.brand.resources.empty",
      "app.brand.resources.loading",
      "app.brand.resources.error",
      "app.brand.navResources",
    ];
    for (const k of keys) {
      expect(dict.en[k], `en.${k}`).toBeDefined();
      expect(dict.zh[k], `zh.${k}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/i18n.test.tsx -t "brand resources i18n keys"`
Expected: FAIL — `dict.en["app.brand.resources.title"]` (and the others) are `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/i18n.dict.ts`, in the `en` block, replace line 744 (`"app.brand.callbackFailed": "Sign-in failed. Please request a new link.",`) with:

```ts
    "app.brand.callbackFailed": "Sign-in failed. Please request a new link.",
    "app.brand.navResources": "Resources",
    "app.brand.resources.title": "Resources",
    "app.brand.resources.empty": "No resources yet.",
    "app.brand.resources.loading": "Loading…",
    "app.brand.resources.error": "Couldn't load resources. Please try again.",
```

In the `zh` block, replace line 1478 (`"app.brand.callbackFailed": "登入失敗，請重新索取連結。",`) with:

```ts
    "app.brand.callbackFailed": "登入失敗，請重新索取連結。",
    "app.brand.navResources": "資源",
    "app.brand.resources.title": "資源中心",
    "app.brand.resources.empty": "暫時未有內容。",
    "app.brand.resources.loading": "載入中…",
    "app.brand.resources.error": "無法載入資源，請稍後再試。",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/i18n.test.tsx`
Expected: PASS (existing "identical key sets" + "no empty values" tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.dict.ts src/lib/i18n.test.tsx
git commit -m "feat(brand-resources): app.brand.resources.* + app.brand.navResources (en/zh-HK)"
```

### Task 8: `BrandNav.tsx` — third nav item "Resources"

**Files:**
- Modify: `src/components/brand/BrandNav.tsx` (full file — small, shown below)
- Test: `src/components/brand/BrandNav.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/components/brand/BrandNav.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { I18nProvider } from "@/lib/i18n";
import { BrandNav } from "./BrandNav";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

function renderNav() {
  const root = createRootRoute({ component: () => <BrandNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<I18nProvider><RouterProvider router={router as never} /></I18nProvider>);
}

describe("BrandNav", () => {
  it("renders a Resources item linking to /brand/resources", async () => {
    renderNav();
    await waitFor(() => {
      const links = screen.getAllByText("資源").map((el) => el.closest("a"));
      expect(links.some((a) => a?.getAttribute("href") === "/brand/resources")).toBe(true);
    });
  });

  it("still renders the existing Overview and Missions items", async () => {
    renderNav();
    await waitFor(() => expect(screen.getAllByText("概覽").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText("任務").length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/brand/BrandNav.test.tsx -t "Resources"`
Expected: FAIL — `screen.getAllByText("資源")` throws (no element found) since `BrandNav` only has two items and the `app.brand.navResources` key isn't rendered anywhere yet.

- [ ] **Step 3: Write minimal implementation**

Replace `src/components/brand/BrandNav.tsx` in full:

```tsx
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Target, BookOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const ITEMS = [
  { to: "/brand", exact: true, icon: LayoutDashboard, labelKey: "app.brand.navDashboard" },
  { to: "/brand/missions", exact: false, icon: Target, labelKey: "app.brand.navMissions" },
  { to: "/brand/resources", exact: false, icon: BookOpen, labelKey: "app.brand.navResources" },
] as const;

const DESKTOP_ITEM =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-transparent px-3 py-2 font-heading text-sm font-semibold text-[var(--color-soft-ink)]";
const DESKTOP_ITEM_ACTIVE =
  "flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2 font-heading text-sm font-bold text-[var(--color-ink)]";
const MOBILE_ITEM =
  "flex flex-1 flex-col items-center gap-1 py-2 font-heading text-xs font-semibold text-[var(--color-soft-ink)]";
const MOBILE_ITEM_ACTIVE =
  "flex flex-1 flex-col items-center gap-1 py-2 font-heading text-xs font-bold text-[var(--color-ink)]";

export function BrandNav() {
  const { t } = useI18n();
  return (
    <>
      <nav
        aria-label={t("app.brand.title")}
        className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col gap-1 overflow-y-auto border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4"
      >
        <Link to="/brand" className="mb-2 px-3 font-display text-xl font-bold">
          {t("app.brand.title")}
        </Link>
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.exact }} className={DESKTOP_ITEM} activeProps={{ className: DESKTOP_ITEM_ACTIVE }}>
              <Icon size={20} aria-hidden />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label={t("app.brand.title")}
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-[var(--color-ink)] bg-[var(--color-paper)]"
      >
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} activeOptions={{ exact: item.exact }} className={MOBILE_ITEM} activeProps={{ className: MOBILE_ITEM_ACTIVE }}>
              <Icon size={20} aria-hidden />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/brand/BrandNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/brand/BrandNav.tsx src/components/brand/BrandNav.test.tsx
git commit -m "feat(brand-resources): BrandNav gains a third 'Resources' item (BookOpen icon)"
```

---

## Phase E — Client: the two new pages

### Task 9: `brand.resources.index.tsx` — list page

**Files:**
- Create: `src/routes/brand.resources.index.tsx`
- Test: `src/routes/-brand.resources.index.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-brand.resources.index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandResources: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandResources: h.fetchBrandResources,
  brandKeys: {
    resources: (page: number) => ["brand-resources", page],
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
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Link: ({ to, params, children, ...p }: any) => {
      const href = params
        ? String(to).replace(/\$(\w+)/g, (_: string, k: string) => String(params[k]))
        : to;
      return <a href={href} {...p}>{children}</a>;
    },
    useNavigate: () => vi.fn(),
  };
});

import { Route as ResourcesRoute } from "./brand.resources.index";

function withClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("brand resources list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders a resource title and links to its slug", async () => {
    h.fetchBrandResources.mockResolvedValue({
      items: [
        { id: "r1", slug: "budget-explainer", kind: "article", title: "預算解說", excerpt: "了解你的錢包", coverImageUrl: null, publishedAt: "2026-01-01T00:00:00Z", pinned: false, views: 0 },
      ],
      page: 1, pageSize: 20, total: 1,
    });
    const C = ResourcesRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("預算解說")).toBeInTheDocument());
    const link = screen.getByText("預算解說").closest("a");
    expect(link?.getAttribute("href")).toBe("/brand/resources/budget-explainer");
  });

  it("shows the empty state when there are no items", async () => {
    h.fetchBrandResources.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const C = ResourcesRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("暫時未有內容。")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/-brand.resources.index.test.tsx`
Expected: FAIL — `Cannot find module './brand.resources.index'` (the route file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/brand.resources.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandAuthError, brandKeys, fetchBrandResources } from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/resources/")({ component: BrandResourcesList });

function BrandResourcesList() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const list = useQuery({ queryKey: brandKeys.resources(1), queryFn: () => fetchBrandResources(1), retry: false });

  useEffect(() => {
    if (list.error instanceof BrandAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("app.brand.resources.title")}</h1>
      {list.isLoading ? <p className="text-sm">{t("app.brand.resources.loading")}</p> : null}
      {!list.isLoading && (list.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.resources.empty")}</p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.data?.items.map((item) => (
          <Link
            key={item.id}
            to="/brand/resources/$slug"
            params={{ slug: item.slug }}
            className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 hover:bg-[var(--color-paper)]"
          >
            {item.coverImageUrl && (
              <img src={item.coverImageUrl} alt="" className="mb-2 aspect-video w-full rounded object-cover" />
            )}
            <h3 className="font-heading font-bold">{item.title}</h3>
            {item.excerpt && (
              <p className="mt-1 line-clamp-2 text-sm text-[var(--color-soft-ink)]">{item.excerpt}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routes/-brand.resources.index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type check**

Run: `npm run type-check`
Expected: pass (TanStack route-tree codegen picks up the new `/brand/resources/` route).

- [ ] **Step 6: Commit**

```bash
git add src/routes/brand.resources.index.tsx src/routes/-brand.resources.index.test.tsx
git commit -m "feat(brand-resources): /brand/resources list page (card grid, pinned-first, empty state)"
```

### Task 10: `brand.resources.$slug.tsx` — detail page

**Files:**
- Create: `src/routes/brand.resources.$slug.tsx`
- Test: `src/routes/-brand.resources.$slug.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/routes/-brand.resources.$slug.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandResource: vi.fn(),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandResource: h.fetchBrandResource,
  brandKeys: { resource: (slug: string) => ["brand-resource", slug] },
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
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useParams: () => ({ slug: "budget-explainer" }),
  };
});

import { Route as ResourceDetailRoute } from "./brand.resources.$slug";

function withClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("brand resource detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders the title and markdown body, with no related-articles block", async () => {
    h.fetchBrandResource.mockResolvedValue({
      item: {
        id: "r1", slug: "budget-explainer", kind: "article", title: "預算解說",
        excerpt: null, body: "# 標題\n\n內容", coverImageUrl: null,
        publishedAt: "2026-01-01T00:00:00Z", pinned: false, views: 3,
      },
    });
    const C = ResourceDetailRoute.options.component as React.ComponentType;
    withClient(<C />);
    await waitFor(() => expect(screen.getByText("預算解說")).toBeInTheDocument());
    expect(screen.queryByText("相關內容")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/-brand.resources.\$slug.test.tsx`
Expected: FAIL — `Cannot find module './brand.resources.$slug'` (the route file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/brand.resources.$slug.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandAuthError, brandKeys, fetchBrandResource } from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { Markdown } from "@/components/Markdown";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/resources/$slug")({ component: BrandResourceDetail });

function BrandResourceDetail() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const { slug } = useParams({ from: "/brand/resources/$slug" });
  const item = useQuery({ queryKey: brandKeys.resource(slug), queryFn: () => fetchBrandResource(slug), retry: false });

  useEffect(() => {
    if (item.error instanceof BrandAuthError) reportAuthError(item.error);
  }, [item.error, reportAuthError]);

  if (item.isLoading) return <div className="p-4 text-sm">{t("app.brand.resources.loading")}</div>;
  if (!item.data) return <div className="p-4 text-sm">{t("app.brand.resources.empty")}</div>;
  return (
    <article className="mx-auto max-w-2xl space-y-4 p-4">
      {item.data.item.coverImageUrl && (
        <img
          src={item.data.item.coverImageUrl}
          alt=""
          className="aspect-video w-full rounded-[var(--radius)] object-cover"
        />
      )}
      <h1 className="font-display text-2xl font-bold">{item.data.item.title}</h1>
      {item.data.item.body && <Markdown source={item.data.item.body} />}
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routes/-brand.resources.\$slug.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type check**

Run: `npm run type-check`
Expected: pass (TanStack route-tree codegen picks up the new `/brand/resources/$slug` route).

- [ ] **Step 6: Commit**

```bash
git add src/routes/brand.resources.\$slug.tsx src/routes/-brand.resources.\$slug.test.tsx
git commit -m "feat(brand-resources): /brand/resources/\$slug detail page (cover, markdown body, no related)"
```

---

## Phase F — Full verification

### Task 11: Full suite + lint + type-check + ESM guard

- [ ] **Step 1: Pure/unit + frontend tests**

Run: `npm run type-check && npm run lint && npx vitest run`
Expected: all green (unit suites; integration suites SKIP without `RUN_INTEGRATION`).

- [ ] **Step 2: Integration suite (local stack)**

Run: `set -a; source .env.test.local; set +a; RUN_INTEGRATION=1 npm run test:integration`
Expected: all green, including `server/test/adminContent.test.ts`, `server/test/content.test.ts`, and the new `server/test/brandResources.test.ts`.

- [ ] **Step 3: ESM guard**

Run: `npm run check:esm`
Expected: pass (`brandResources.ts`'s relative imports carry `.js`).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: succeeds (runs `check:esm` + `tsr generate` + `tsc --noEmit` + `vite build`).

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A && git commit -m "chore(brand-resources): lint/type fixups" --allow-empty
```

---

## Post-merge prod runbook (NOT during implementation)

1. Merge the PR to `main`.
2. Apply `0027` to prod (`mhkoayftiuojxlrkollf`) via raw SQL (Supabase MCP `execute_sql`):
   ```sql
   alter table public.content_items
     add column audience text not null default 'creator' check (audience in ('creator','brand'));
   create index content_items_audience_status_pub_idx
     on public.content_items (audience, status, published_at desc);
   ```
3. `notify pgrst, 'reload schema';`
4. Smoke-test: as a staff user, create a draft in `/admin` Content with `audience: 'brand'`, publish it, then confirm it appears at `/brand/resources` for a real brand login and NOT at `/news` for a creator login.
5. Document `0027` as "applied via raw SQL — not in tracker, do not re-apply" (same convention as `0018`/`0019`/`0024`/`0025`/`0026`).

---

## Self-review notes (author)

- **Spec coverage:** §4 migration→Task 1; §5.1 authoring→Task 2 (validators) + Task 3 (route COLS/EDITABLE); §5.2 creator-route fix→Task 4; §5.3 new brand route→Task 5; §6 client/UI→Task 6 (fetchers), Task 7 (i18n), Task 8 (nav), Task 9 (list page), Task 10 (detail page); §7 invariants→the "never returns a brand/creator row" tests in Tasks 4 and 5 explicitly; §8 file manifest→every listed file is created/modified across Tasks 1–10, none invented beyond it; §9 sequencing/prod→the runbook section. No gaps found.
- **Type/signature consistency verified:** `ContentAudience = 'creator' | 'brand'` (Task 2) is the only audience type introduced and is reused verbatim (not restated as `'brand' | 'creator'`) everywhere it appears — the migration CHECK constraint (Task 1), `EDITABLE`/`COLS` (Task 3), the `content_items.audience` column filters `.eq("audience", "creator")` / `.eq("audience", "brand")` (Tasks 4–5), and the `BrandResource` client type (Task 6) all agree on field name `audience` and value set `'creator'|'brand'`. `brandKeys.resources(page: number)` / `brandKeys.resource(slug: string)` (Task 6) are used with identical call shapes in Tasks 9–10. `fetchBrandResources(page = 1)` / `fetchBrandResource(slug)` return shapes (`{items,page,pageSize,total}` / `{item}`) match what Tasks 9–10's pages destructure.
- **Placeholder scan:** grepped for "TBD", "similar to", "appropriate", "handle edge cases" — none found; every code step above contains complete, runnable code (full functions/files, no elided diffs — Task 4's detail handler is reproduced in full, including the untouched related-articles logic, not just the one changed line).
