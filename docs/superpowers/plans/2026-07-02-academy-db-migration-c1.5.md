# Academy → DB Migration (C1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all four Academy systems (8 guide docs, 9 tracks, 6 playbooks, 8 resources) out of hardcoded TS + markdown files into one new `academy_content` DB table so the DB is the single source of truth for the authenticated `/guide` surface and the AI-assistant KB, with staff authoring in `/admin`.

**Architecture:** A dedicated `academy_content` table (kind-discriminated, typed columns + bilingual `metadata` jsonb), seeded inline in migration `0028`. New guarded creator read routes (`/api/academy`) and staff CRUD routes (`/api/admin/academy`) mirror the existing content-hub pattern; the `/guide` routes swap hardcoded imports for `useQuery`; `scripts/ingest-kb.ts` re-ingests guide docs from the DB and prunes orphaned embeddings. Public `_site` marketing pages keep a static showcase (they can't call the authed API).

**Tech Stack:** Hono (server routes), Supabase Postgres + RLS, TanStack Router + React Query, Vitest, TypeScript. All server/script relative imports carry the `.js` ESM extension (CI-guarded by `scripts/check-esm-extensions.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-02-academy-db-migration-c1.5-design.md`
**Branch:** `feat/academy-db-c1.5`

---

## Conventions for this plan

- **Local stack:** integration tests need the local Supabase stack. Start it and apply migrations
  the way prior slices did (this Colima/virtiofs stack is flaky on `db reset`):
  `supabase start` then apply the new migration file via
  `docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres < supabase/migrations/0028_academy_content.sql`
  (no host `psql`). Integration tests run with `RUN_INTEGRATION=1` and `--no-file-parallelism`.
- **Env for integration:** `set -a && source .env.test.local && set +a` before running (else all
  integration specs SKIP). Service-role key var is `SUPABASE_SERVICE_KEY`.
- **Gate before every commit that touches server/client code:** `npm run check:esm` +
  `npm run type-check` (runs `tsr generate` then `tsc --noEmit`) + relevant tests. `type-check`
  is required (not bare `tsc`) whenever a TanStack route file is added/renamed, so the generated
  `routeTree.gen.ts` is regenerated.
- **Trust the route files, not `routeTree.gen.ts`** (it is gitignored and regenerated).

---

## File Structure

**Server / DB**
- Create `supabase/migrations/0028_academy_content.sql` — table + indexes + trigger + RLS + grants + inline 31-row seed.
- Create `server/lib/academyAuthoring.ts` — pure validators + constants (kinds, level-gate ids, metadata guards, length caps). Owns no clock/DB.
- Create `server/routes/academy.ts` — creator reads (`GET /api/academy`, `/api/academy/doc/:slug`, `/api/academy/track/:slug`) via `makeUserClient(jwt)`; degrade-to-empty.
- Create `server/routes/adminAcademy.ts` — staff CRUD via `serviceClient()`; mirrors `adminContent.ts`.
- Modify `server/app.ts` — mount `guarded.route("/academy", academyRoutes)`.
- Modify `server/routes/admin.ts` — `adminRoutes.route("/", adminAcademyRoutes)`.
- Modify `scripts/ingest-kb.ts` — `loadFromDb()` reads published `guide_doc` rows; add orphan prune.

**Client**
- Create `src/lib/academy.ts` — types (`AcademyDoc`, `AcademyTrack`, `AcademyPlaybook`, `AcademyResource`, `AdminAcademyRow`, `GuideCategory`), `academyKeys`, creator fetchers (`apiFetch`), admin fetchers (`adminFetch`).
- Modify `src/components/GuideDocList.tsx` — take `docs` + `readCount` via props (no data import).
- Modify `src/components/PlaybookCard.tsx` — consume client types.
- Modify `src/components/AcademyTrackCard.tsx` — consume client types.
- Modify `src/routes/_app.guide.index.tsx` — `useQuery` bundle + loading/empty.
- Modify `src/routes/_app.guide.doc.$slug.tsx` — `useQuery` doc + `isSuccess`-gated not-found.
- Modify `src/routes/_app.guide.track.$trackId.tsx` — `useQuery` track + `isSuccess`-gated not-found.
- Create `src/components/admin/AcademyEditor.tsx` — kind-aware editor.
- Create `src/routes/admin.academy.index.tsx` — admin list.
- Create `src/routes/admin.academy.$id.tsx` — admin editor page.
- Modify `src/components/admin/adminNavItems.ts` — add Academy nav item (Library group).
- Modify `src/lib/i18n.dict.ts` — remove migrated `app.guide.doc.*` + `app.guide.teaser.a1–a9` keys; add `app.admin.tabAcademy` + `app.admin.academy.*` keys.

**Marketing decouple**
- Create `src/data/marketingShowcase.ts` — static `playbooks`/`academyTracks`/`resources` + their types (moved verbatim from `academy.ts`), used only by `_site` pages.
- Modify `src/data/mockData.ts` — re-export from `./marketingShowcase` instead of `./academy`.

**Deletions (last task)**
- `src/data/academy.ts`, `src/data/academy.test.ts`, `src/data/guideDocs.ts`, `src/data/guideDocs.test.ts`, `content/help/*.md` (8).

**Tests**
- Create `server/lib/academyAuthoring.test.ts`, `server/test/academy.test.ts`, `server/test/adminAcademy.test.ts`, `server/test/academy-seed.test.ts`.
- Modify `package.json` — add the three new integration specs to the `test:integration` script.
- Modify `src/routes/-_app.guide.index.test.tsx` and `-_app.guide.track.$trackId.test.tsx` — mocked-query render.

---

## Task 1: Migration + inline seed (`0028_academy_content.sql`)

**Files:**
- Create: `supabase/migrations/0028_academy_content.sql`

- [ ] **Step 1: Write the migration file (schema + RLS + grants + trigger)**

Create `supabase/migrations/0028_academy_content.sql` starting with:

```sql
-- 0028_academy_content.sql — C1.5 Academy → DB. Single source of truth for the authenticated
-- /guide surface + the AI-assistant KB (guide_doc bodies). Staff author in /admin. Global content
-- (no workspace_id). Applied to PROD via RAW SQL (execute_sql), NOT `db push` — the cloud migration
-- tracker is out of sync (0018–0027 applied out-of-tracker). Run `NOTIFY pgrst, 'reload schema';`
-- after applying so PostgREST sees the new table + RLS.

create table public.academy_content (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('guide_doc','track','playbook','resource')),
  slug           text not null unique,
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  title_zh       text not null,
  title_en       text,
  excerpt_zh     text,
  excerpt_en     text,
  body_zh        text not null default '',
  body_en        text,
  category       text,
  required_level text check (required_level is null or required_level in
                   ('L0','L1','L2','L3','L4','L5','L6')),
  emoji          text,
  color          text,
  sort           int  not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  published_at   timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index academy_content_kind_status_sort_idx
  on public.academy_content (kind, status, sort);

-- Reuse the existing 0021 touch function (do NOT redefine it — that would clobber content_items).
create trigger academy_content_touch
  before update on public.academy_content
  for each row execute function public.content_touch_updated_at();

alter table public.academy_content enable row level security;
create policy academy_content_read_published on public.academy_content
  for select to authenticated using (status = 'published');
grant select on public.academy_content to authenticated;
grant all    on public.academy_content to service_role;
```

- [ ] **Step 2: Append the guide-doc seed (8 rows)**

Bodies are the `content/help/*.md` contents with the `---` frontmatter fence removed. Dollar-quote
(`$md$…$md$`) each body to avoid escaping CJK/newlines. Append:

```sql
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, category, emoji, sort, body_zh, published_at)
values
('guide_doc','account','published','帳戶','Account','account','👤',0, $md$平台以手機號碼作為登入方式，透過 WhatsApp 發送一次性驗證碼（OTP）完成驗證，毋須設定密碼。首次登入後會有入門引導，協助你設定內容範疇同完善帳號資料。

如需登出，可喺個人檔案頁面底部找到登出選項。如果遇到登入問題，例如收不到 OTP，可以重新輸入手機號碼再試，或稍等片刻後重試。$md$, now()),
('guide_doc','leveling','published','等級制度','Levels','start','⭐',1, $md$每次完成任務並獲得審批通過，你會同時賺取經驗值（XP）。XP 累積到一定數量後會自動升級，無需任何手動操作。

等級越高，代表你係平台上越資深嘅創作者。你嘅等級同 XP 進度會顯示喺個人檔案同創作者護照度，方便品牌合作夥伴了解你嘅活躍程度。持續完成更多任務，就能不斷積累 XP 升級，解鎖更多資深創作者嘅身份認證。$md$, now()),
('guide_doc','missions','published','任務','Missions','missions','🎯',2, $md$平台上的任務分為兩種類型：「公開任務」同「申請制任務」。

公開任務可以直接加入開始，毋須等候審批。申請制任務則需要先提交申請，由營運團隊審核後接受，才可以正式加入並開始完成任務。喺任務頁面可以睇到每個任務嘅詳細簡介、內容要求同獎勵積分，方便你決定係咪參與。揀啱任務後，按「加入」或「申請」按鈕即可開始流程。$md$, now()),
('guide_doc','submission','published','提交內容','Submitting Content','missions','📤',3, $md$成功加入任務後，請按照任務要求製作相關內容，然後提交你嘅作品連結或詳情。營運團隊會逐一審批提交內容。

審批通過後，你會即時獲得對應積分同 XP；若提交被拒，系統會列明被拒原因，你可以按指示修改後重新提交。每次提交的狀態分為：已提交、審批中、已通過、已拒絕，可隨時喺任務頁面查看最新進度。$md$, now()),
('guide_doc','points','published','積分','Points','rewards','🪙',4, $md$完成任務後，營運團隊審批通過即可獲得積分。積分可用於「積分兌換」換領禮品或優惠碼。
積分餘額會即時更新；如審批被拒，該次提交不會獲得積分。你可以在「錢包」查看現時積分。$md$, now()),
('guide_doc','redemption','published','兌換','Redemption','rewards','🎁',5, $md$累積足夠積分後，可以喺「積分兌換」頁面將積分換領禮品或優惠碼。選擇心儀獎勵並確認兌換後，積分會即時從餘額扣除。

已換領嘅禮品同優惠碼可喺「兌換記錄」查看，包括換領日期同對應嘅優惠碼詳情。請注意，兌換後積分不可退回，換領前請確認選擇正確嘅獎勵。$md$, now()),
('guide_doc','wallet','published','錢包','Wallet','rewards','💰',6, $md$錢包分為兩個獨立部分：積分同現金收益。

積分用嚟喺平台兌換禮品或優惠碼，每次任務審批通過後即時增加。現金收益則係部分任務提供嘅港幣獎勵，以唯讀方式記錄，不可用於兌換，屬於另行結算嘅收益。兩者分開計算，互不影響，可喺錢包頁面分別查看各自嘅餘額同歷史記錄。$md$, now()),
('guide_doc','profile','published','個人檔案','Profile','account','🪪',7, $md$個人檔案讓你展示自己作為創作者嘅身份。你可以設定顯示名稱、選擇內容創作範疇，以及填寫各社交平台帳號，包括 Instagram、小紅書、TikTok 同 YouTube。

創作者護照會根據你嘅檔案資料同任務記錄，自動計算並顯示你嘅等級、各項分數同已獲得嘅徽章。填寫完整嘅個人資料有助平台為你配對更合適嘅品牌任務，提升被選中嘅機會。$md$, now())
on conflict (slug) do nothing;
```

- [ ] **Step 3: Append the track seed (9 rows)**

`excerpt_*` = the track description; `metadata` = duration + display `levelLabel` + bilingual teaser.
Dollar-quote each `metadata` jsonb (`$j$…$j$`). Append:

```sql
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, required_level, emoji, color, sort, metadata, published_at)
values
('track','a1','published','KOC新手訓練營','KOC Starter Bootcamp',
 '由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。',
 'Start from zero: learn the KOC mission flow, earn points, and build your personal brand.',
 'L0','🌱','pink',0,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L0–L1","teaser_zh":"解鎖基礎：了解 KOC 任務流程，賺取你的第一批積分。","teaser_en":"Unlock the basics: learn how KOC missions work and earn your first points."}$j$, now()),
('track','a2','published','產品評測基礎','Product Review Basics',
 '學習撰寫真實有說服力的產品評測，提升品牌信任及任務評分。',
 'Write authentic, persuasive product reviews that build brand trust and lift your mission ratings.',
 'L1','⭐','yellow',1,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L1+","teaser_zh":"達到 L1 即可解鎖：學習撰寫真實評測，提升品牌信任度。","teaser_en":"Reach L1 to unlock product review fundamentals and build brand trust."}$j$, now()),
('track','a3','published','Instagram Reels 增長術','Instagram Reels Growth',
 '掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。',
 'Master Reels editing, music selection, and the algorithm to grow your reach fast.',
 'L2','📱','mint',2,
 $j${"duration":{"en":"5 lessons","zh":"5堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：掌握 Reels 剪接技巧與演算法攻略。","teaser_en":"Reach Trusted KOC to unlock Reels growth tactics and algorithm tips."}$j$, now()),
('track','a4','published','TikTok短片Hook技巧','TikTok Hook Techniques',
 '設計令人停止滑動的開場Hook，打造高留存率的短影片內容。',
 'Design scroll-stopping opening hooks and craft short videos with high retention.',
 'L2','🎬','blue',3,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：學習令人停止滑動的 TikTok Hook 公式。","teaser_en":"Reach Trusted KOC to learn TikTok hook formulas that stop the scroll."}$j$, now()),
('track','a5','published','小紅書式內容創作','RED (Xiaohongshu) Content',
 '學習小紅書的圖文排版、種草文案及標籤策略，打入內地及港人市場。',
 'Learn RED photo-text layout, recommendation copy, and tag strategy to reach mainland and HK audiences.',
 'L2','📕','pink',4,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L2+","teaser_zh":"升至信譽 KOC 即可解鎖：掌握小紅書圖文排版與種草文案技巧。","teaser_en":"Reach Trusted KOC to master RED-style content and reach new audiences."}$j$, now()),
('track','a6','published','聯盟推廣賺錢術','Affiliate Monetization',
 '建立聯盟推廣策略，選對產品、設計轉換內容，實現穩定被動收入。',
 'Build an affiliate strategy: pick the right products, design converting content, and earn steady passive income.',
 'L3','💰','lilac',5,
 $j${"duration":{"en":"4 lessons","zh":"4堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：透過聯盟推廣建立穩定被動收入。","teaser_en":"Reach Nano Creator to start building passive income through affiliate links."}$j$, now()),
('track','a7','published','直播電商培訓','Live Commerce Training',
 '直播選品、話術設計及互動技巧全攻略，助你成為直播帶貨達人。',
 'A full guide to live-selling: product picks, scripts, and audience interaction to become a live-commerce pro.',
 'L4','🎙️','mint',6,
 $j${"duration":{"en":"5 lessons","zh":"5堂課"},"levelLabel":"L4+","teaser_zh":"升至微網紅即可解鎖：直播帶貨全攻略，成為直播達人。","teaser_en":"Reach Micro-Influencer to unlock live commerce training and selling techniques."}$j$, now()),
('track','a8','published','品牌簡報及合規守則','Brand Briefs & Compliance',
 '解讀品牌Brief、了解廣告披露要求，確保內容專業合規。',
 'Read brand briefs and understand ad-disclosure rules to keep your content professional and compliant.',
 'L3','📋','yellow',7,
 $j${"duration":{"en":"2 lessons","zh":"2堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：解讀品牌 Brief，確保內容合規專業。","teaser_en":"Reach Nano Creator to learn how to read brand briefs and stay compliant."}$j$, now()),
('track','a9','published','創作者財務入門','Creator Finance 101',
 '管理自由工作者收入、稅務基礎及如何與品牌談判合理報酬。',
 'Manage freelance income, learn tax basics, and negotiate fair rates with brands.',
 'L3','🏦','blue',8,
 $j${"duration":{"en":"3 lessons","zh":"3堂課"},"levelLabel":"L3+","teaser_zh":"升至微型創作者即可解鎖：管理自由工作收入、稅務與品牌議價技巧。","teaser_en":"Reach Nano Creator to manage freelance income, taxes, and brand negotiations."}$j$, now())
on conflict (slug) do nothing;
```

- [ ] **Step 4: Append the playbook seed (6 rows)**

Minted slugs `pb-*`. `metadata` holds bilingual `levels`/`creatorAngle` + zh-only `ideas`/`measurementFocus`. Append:

```sql
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, emoji, color, sort, metadata, published_at)
values
('playbook','pb-beauty','published','美妝護膚','Beauty & Skincare','💄','pink',0,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"},{"en":"Small KOL","zh":"小型KOL"}],"creatorAngle":{"en":"From product tester to beauty affiliate creator.","zh":"由產品試用者成為美妝聯盟創作者。"},"ideas":["KOC護膚試用配前後對比故事","奈米創作者教學系列（5天5個造型）","微型KOL聯盟優惠（12%佣金）","直播購物套裝推廣","創作者產品上市先行試用","成熟美妝KOC推廣活動"],"measurementFocus":"收藏數、評論情感分析、優惠券轉換率、創作者重複合作需求"}$j$, now()),
('playbook','pb-food','published','餐飲食肆','Food & Dining','🍜','yellow',1,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"}],"creatorAngle":{"en":"From foodie to trusted local dining guide.","zh":"由美食愛好者成為受信任的本地飲食指南。"},"ideas":["餐廳開幕創作者報道","隱藏菜單挑戰","百元以下飲食系列","週末咖啡廳優惠任務","地區美食路線配地圖內容","家庭飲食KOC評測"],"measurementFocus":"到店人次、優惠券兌換、限時動態互動、粉絲增長"}$j$, now()),
('playbook','pb-travel','published','旅遊及酒店','Travel & Hotels','✈️','blue',2,
 $j${"levels":[{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"}],"creatorAngle":{"en":"From travel sharer to travel content creator.","zh":"由旅遊分享者成為旅遊內容創作者。"},"ideas":["酒店KOC住宿評測","澳門一日遊任務","景點門票創作者指南","eSIM旅遊創作者活動","旅遊保險教育內容","飲食文化行程挑戰"],"measurementFocus":"訂房查詢、行程收藏、UGC質量、目的地認知度"}$j$, now()),
('playbook','pb-retail','published','零售及電商','Retail & E-commerce','🛍️','mint',3,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"}],"creatorAngle":{"en":"From shopper to shopping-content creator and affiliate.","zh":"由購物者成為購物內容創作者及聯盟推廣員。"},"ideas":["產品開箱浪潮","短影片衝刺（10位創作者 × 3支Reels）","聯盟優惠券計劃","直播購物活動","節日禮品指南配創作者精選","產品對比系列"],"measurementFocus":"點擊率、優惠券使用量、聯盟轉換率、內容庫規模"}$j$, now()),
('playbook','pb-health','published','健康及保健','Health & Wellness','🌿','mint',4,
 $j${"levels":[{"en":"KOC Starter","zh":"KOC新手"},{"en":"Trusted KOC","zh":"受信任KOC"},{"en":"Nano Creator","zh":"奈米創作者"}],"creatorAngle":{"en":"From wellness enthusiast to trusted health creator.","zh":"由健康愛好者成為受信任的健康內容創作者。"},"ideas":["保健品KOC試用配打卡內容","健身挑戰（21天創作者旅程）","健康檢查教育系列","心理健康故事分享","營養教育短片","健康講座報道"],"measurementFocus":"打卡完成率、收藏數、信任訊號、教育觸及率"}$j$, now()),
('playbook','pb-finance','published','金融及保險','Finance & Insurance','💳','lilac',5,
 $j${"levels":[{"en":"Nano Creator","zh":"奈米創作者"},{"en":"Micro-KOL","zh":"微型KOL"},{"en":"Small KOL","zh":"小型KOL"}],"creatorAngle":{"en":"From everyday consumer to financial-literacy creator.","zh":"由日常消費者成為金融知識創作者。"},"ideas":["防騙教育活動","保險普及短片","信用卡生活方式活動","旅遊保險清單內容","理財健康挑戰","淺白金融FAQ系列"],"measurementFocus":"教育完成率、信任度提升、查詢量、內容收藏數"}$j$, now())
on conflict (slug) do nothing;
```

- [ ] **Step 5: Append the resource seed (8 rows)**

```sql
insert into public.academy_content
  (kind, slug, status, title_zh, title_en, emoji, sort, metadata, published_at)
values
('resource','r1','published','文案範本','Caption Templates','📝',0, $j${"type":{"en":"Template pack","zh":"範本包"},"fileUrl":null}$j$, now()),
('resource','r2','published','Hook 公式','Hook Formulas','🎣',1, $j${"type":{"en":"Playbook","zh":"攻略"},"fileUrl":null}$j$, now()),
('resource','r3','published','分鏡清單','Shot Lists','📸',2, $j${"type":{"en":"Checklist","zh":"清單"},"fileUrl":null}$j$, now()),
('resource','r4','published','媒體資料包範本','Media Kit Template','📁',3, $j${"type":{"en":"Template","zh":"範本"},"fileUrl":null}$j$, now()),
('resource','r5','published','報價表指南','Rate Card Guide','💵',4, $j${"type":{"en":"Guide","zh":"指南"},"fileUrl":null}$j$, now()),
('resource','r6','published','披露清單','Disclosure Checklist','✅',5, $j${"type":{"en":"Checklist","zh":"清單"},"fileUrl":null}$j$, now()),
('resource','r7','published','聯盟內容攻略','Affiliate Content Playbook','📈',6, $j${"type":{"en":"Playbook","zh":"攻略"},"fileUrl":null}$j$, now()),
('resource','r8','published','直播購物流程範本','Live Shopping Rundown Template','🎙️',7, $j${"type":{"en":"Template","zh":"範本"},"fileUrl":null}$j$, now())
on conflict (slug) do nothing;
```

- [ ] **Step 6: Apply to the local stack and verify**

Run:
```bash
supabase start
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres < supabase/migrations/0028_academy_content.sql
docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres -c \
  "select kind, count(*) from public.academy_content group by kind order by kind;"
```
Expected: `guide_doc 8`, `playbook 6`, `resource 8`, `track 9` (31 total).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0028_academy_content.sql
git commit -m "feat(academy-c1.5): 0028 academy_content table + RLS + 31-row inline seed"
```

---

## Task 2: Pure authoring lib (`academyAuthoring.ts`)

**Files:**
- Create: `server/lib/academyAuthoring.ts`
- Test: `server/lib/academyAuthoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/academyAuthoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateAcademyInput, validateAcademyEdit, ACADEMY_KINDS, LEVEL_IDS,
} from "./academyAuthoring.js";

describe("validateAcademyInput", () => {
  it("accepts a minimal valid guide_doc", () => {
    const { errors } = validateAcademyInput({ kind: "guide_doc", title_zh: "帳戶" });
    expect(errors).toEqual({});
  });
  it("requires title_zh", () => {
    const { errors } = validateAcademyInput({ kind: "guide_doc", title_zh: "  " });
    expect(errors.title_zh).toBeTruthy();
  });
  it("rejects an unknown kind", () => {
    const { errors } = validateAcademyInput({ kind: "webinar" as never, title_zh: "x" });
    expect(errors.kind).toBeTruthy();
  });
  it("rejects a non-canonical required_level (levelIndex fails OPEN)", () => {
    const { errors } = validateAcademyInput({ kind: "track", title_zh: "x", required_level: "L2+" });
    expect(errors.required_level).toBeTruthy();
  });
  it("accepts a canonical required_level", () => {
    const { errors } = validateAcademyInput({ kind: "track", title_zh: "x", required_level: "L2" });
    expect(errors.required_level).toBeUndefined();
  });
  it("exposes the canonical level id set", () => {
    expect(LEVEL_IDS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(ACADEMY_KINDS).toContain("guide_doc");
  });
});

describe("validateAcademyEdit", () => {
  it("only validates fields present in the patch", () => {
    expect(validateAcademyEdit({}).errors).toEqual({});
    expect(validateAcademyEdit({ required_level: "L9" }).errors.required_level).toBeTruthy();
    expect(validateAcademyEdit({ title_zh: "" }).errors.title_zh).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/lib/academyAuthoring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `academyAuthoring.ts`**

Create `server/lib/academyAuthoring.ts`:

```ts
/** Pure Academy authoring rules — no DB, no I/O, no `new Date()`. Mirrors contentAuthoring.ts.
 *  LEVEL_IDS mirrors LEVELS in src/lib/levels.ts; required_level MUST be a canonical id because
 *  levelIndex() fails OPEN (unknown id → 0 → ungated), so a bad value silently unlocks a gate. */

export const ACADEMY_KINDS = ["guide_doc", "track", "playbook", "resource"] as const;
export type AcademyKind = (typeof ACADEMY_KINDS)[number];

export const ACADEMY_STATUSES = ["draft", "published", "archived"] as const;
export type AcademyStatus = (typeof ACADEMY_STATUSES)[number];

export const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 500;
export const MAX_BODY = 50_000;

export type AcademyInput = {
  kind: AcademyKind;
  slug?: string;
  title_zh: string;
  title_en?: string | null;
  excerpt_zh?: string | null;
  excerpt_en?: string | null;
  body_zh?: string | null;
  body_en?: string | null;
  category?: string | null;
  required_level?: string | null;
  emoji?: string | null;
  color?: string | null;
  sort?: number | null;
  metadata?: Record<string, unknown> | null;
};
export type AcademyEditInput = Partial<AcademyInput>;

function lenErr(v: unknown, max: number, label: string): string | null {
  if (typeof v !== "string") return null;
  return v.length > max ? `${label}不可超過 ${max} 字` : null;
}

function levelErr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return (LEVEL_IDS as readonly string[]).includes(v as string) ? null : "請選擇有效的等級";
}

export function validateAcademyInput(input: AcademyInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!(ACADEMY_KINDS as readonly string[]).includes(input.kind)) errors.kind = "請選擇有效的內容類型";
  if (!input.title_zh || !input.title_zh.trim()) errors.title_zh = "請輸入中文標題";
  const te = lenErr(input.title_zh, MAX_TITLE, "標題"); if (te) errors.title_zh = te;
  const xe = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (xe) errors.excerpt_zh = xe;
  const be = lenErr(input.body_zh, MAX_BODY, "內文"); if (be) errors.body_zh = be;
  const le = levelErr(input.required_level); if (le) errors.required_level = le;
  return { errors };
}

export function validateAcademyEdit(input: AcademyEditInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const has = (k: keyof AcademyEditInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("kind") && !(ACADEMY_KINDS as readonly string[]).includes(input.kind as string)) errors.kind = "請選擇有效的內容類型";
  if (has("title_zh") && (!input.title_zh || !input.title_zh.trim())) errors.title_zh = "請輸入中文標題";
  if (has("title_zh")) { const e = lenErr(input.title_zh, MAX_TITLE, "標題"); if (e) errors.title_zh = e; }
  if (has("excerpt_zh")) { const e = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e) errors.excerpt_zh = e; }
  if (has("body_zh")) { const e = lenErr(input.body_zh, MAX_BODY, "內文"); if (e) errors.body_zh = e; }
  if (has("required_level")) { const e = levelErr(input.required_level); if (e) errors.required_level = e; }
  return { errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/academyAuthoring.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/academyAuthoring.ts server/lib/academyAuthoring.test.ts
git commit -m "feat(academy-c1.5): pure academyAuthoring validators (kind, required_level canonical guard)"
```

---

## Task 3: Creator read routes (`server/routes/academy.ts`)

**Files:**
- Create: `server/routes/academy.ts`
- Modify: `server/app.ts`
- Test: `server/test/academy.test.ts`

- [ ] **Step 1: Write the route module**

Create `server/routes/academy.ts`:

```ts
// server/routes/academy.ts — creator-facing Academy reads (C1.5). Mounted on the guarded group;
// makeUserClient(jwt) so RLS enforces published-only. Degrade to empty, never 500. All relative
// imports carry the .js ESM extension.
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const academyRoutes = new Hono<Env>();

type Row = {
  id: string; kind: string; slug: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  category: string | null; required_level: string | null; emoji: string | null; color: string | null;
  sort: number; metadata: Record<string, unknown>;
};

const LIST_COLS =
  "id, kind, slug, title_zh, title_en, excerpt_zh, excerpt_en, category, required_level, emoji, color, sort, metadata";
const FULL_COLS = LIST_COLS + ", body_zh, body_en";

function pick(en: string | null | undefined, zh: string | null | undefined, lang: string): string {
  return (lang === "en" && en ? en : zh) ?? "";
}

function localizeMeta(meta: Record<string, unknown>, lang: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "en" in v && "zh" in v) {
      out[k] = pick((v as { en: string }).en, (v as { zh: string }).zh, lang);
    } else if (Array.isArray(v)) {
      out[k] = v.map((el) =>
        el && typeof el === "object" && "en" in el && "zh" in el
          ? pick((el as { en: string }).en, (el as { zh: string }).zh, lang)
          : el,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

function shape(r: Row, lang: string, withBody: boolean) {
  return {
    id: r.id, kind: r.kind, slug: r.slug,
    title: pick(r.title_en, r.title_zh, lang),
    excerpt: pick(r.excerpt_en, r.excerpt_zh, lang) || null,
    ...(withBody ? { body: pick(r.body_en, r.body_zh, lang) } : {}),
    category: r.category, requiredLevel: r.required_level,
    emoji: r.emoji, color: r.color, sort: r.sort,
    meta: localizeMeta(r.metadata, lang),
  };
}

// ---- index bundle (docs list-only; tracks/playbooks/resources full) ----
academyRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const { data, error } = await supabase.from("academy_content").select(LIST_COLS)
    .eq("status", "published").order("kind").order("sort");
  if (error) return c.json({ docs: [], tracks: [], playbooks: [], resources: [] });
  const rows = (data as unknown as Row[]).map((r) => shape(r, lang, false));
  return c.json({
    docs: rows.filter((r) => r.kind === "guide_doc"),
    tracks: rows.filter((r) => r.kind === "track"),
    playbooks: rows.filter((r) => r.kind === "playbook"),
    resources: rows.filter((r) => r.kind === "resource"),
  });
});

// ---- guide_doc detail (with body) ----
academyRoutes.get("/doc/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const { data, error } = await supabase.from("academy_content").select(FULL_COLS)
    .eq("status", "published").eq("kind", "guide_doc").eq("slug", c.req.param("slug")).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: shape(data as unknown as Row, lang, true) });
});

// ---- track detail (body may be empty; card renders excerpt) ----
academyRoutes.get("/track/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const { data, error } = await supabase.from("academy_content").select(FULL_COLS)
    .eq("status", "published").eq("kind", "track").eq("slug", c.req.param("slug")).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: shape(data as unknown as Row, lang, true) });
});
```

- [ ] **Step 2: Mount the route in `server/app.ts`**

Add the import after the `contentRoutes` import (line 18) and the mount in the guarded group after `guarded.route("/content", contentRoutes)` (line 54):

```ts
import { academyRoutes } from "./routes/academy.js";
```
```ts
  guarded.route("/content", contentRoutes);
  guarded.route("/academy", academyRoutes);
```

- [ ] **Step 3: Write the integration test**

Create `server/test/academy.test.ts` (mirrors `server/test/content.test.ts` — uses the shared
helpers to mint a creator JWT). Assumes migration `0028` is applied to the local stack.

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../app.js";
import { makeCreator } from "./helpers.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;

d("GET /api/academy (creator reads)", () => {
  let app: ReturnType<typeof createApp>["app"];
  let jwt: string;
  beforeAll(async () => {
    app = createApp().app;
    ({ jwt } = await makeCreator("academy-reader"));
  });

  const auth = () => ({ Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" });

  it("returns the four published groups", async () => {
    const res = await app.request("/api/academy?lang=zh-HK", { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docs.length).toBe(8);
    expect(body.tracks.length).toBe(9);
    expect(body.playbooks.length).toBe(6);
    expect(body.resources.length).toBe(8);
    // list bundle omits body
    expect(body.docs[0].body).toBeUndefined();
    // track metadata is localized to a scalar
    expect(typeof body.tracks[0].meta.duration).toBe("string");
    expect(body.tracks[0].meta.levelLabel).toBeTruthy();
  });

  it("returns a guide_doc body via /doc/:slug", async () => {
    const res = await app.request("/api/academy/doc/leveling?lang=zh-HK", { headers: auth() });
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.title).toBe("等級制度");
    expect(item.body).toContain("經驗值");
    expect(item.body.startsWith("---")).toBe(false); // frontmatter stripped
  });

  it("returns a track via /track/:slug with excerpt", async () => {
    const res = await app.request("/api/academy/track/a1?lang=en", { headers: auth() });
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.title).toBe("KOC Starter Bootcamp");
    expect(item.excerpt).toBeTruthy();
    expect(item.requiredLevel).toBe("L0");
  });

  it("404s an unknown slug", async () => {
    const res = await app.request("/api/academy/doc/nope", { headers: auth() });
    expect(res.status).toBe(404);
  });
});
```

*(Note for the implementer: check `server/test/helpers.ts` for the exact creator-minting export —
it is `makeCreator` in the content/notifications suites. If the signature differs, match the
sibling `server/test/content.test.ts` setup verbatim.)*

- [ ] **Step 4: Run type-check + the test**

Run:
```bash
npm run check:esm && npm run type-check
set -a && source .env.test.local && set +a
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/academy.test.ts
```
Expected: type-check clean; 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/academy.ts server/app.ts server/test/academy.test.ts
git commit -m "feat(academy-c1.5): GET /api/academy bundle + /doc/:slug + /track/:slug (RLS, degrade-to-empty)"
```

---

## Task 4: Staff CRUD routes (`server/routes/adminAcademy.ts`)

**Files:**
- Create: `server/routes/adminAcademy.ts`
- Modify: `server/routes/admin.ts`
- Test: `server/test/adminAcademy.test.ts`

- [ ] **Step 1: Write the route module**

Create `server/routes/adminAcademy.ts` (mirrors `adminContent.ts`; sub-mounted under `adminRoutes`
so it inherits staff auth — do NOT add auth here; writes via `serviceClient()`):

```ts
// server/routes/adminAcademy.ts — staff Academy authoring (C1.5). Sub-mounted inside adminRoutes
// (inherits staff-auth). Writes via serviceClient(). All relative imports carry .js.
import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";
import {
  type AcademyInput, type AcademyEditInput, type AcademyStatus,
  validateAcademyInput, validateAcademyEdit,
} from "../lib/academyAuthoring.js";

export const adminAcademyRoutes = new Hono<AdminEnv>();

const COLS =
  "id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, " +
  "category, required_level, emoji, color, sort, metadata, published_at, archived_at, created_at, updated_at";

const EDITABLE: (keyof AcademyInput)[] = [
  "kind", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en",
  "category", "required_level", "emoji", "color", "sort", "metadata",
];

// ---- list (all statuses) ----
adminAcademyRoutes.get("/academy", async (c) => {
  const svc = serviceClient();
  let q = svc.from("academy_content").select(COLS);
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const status = c.req.query("status"); if (status) q = q.eq("status", status);
  q = q.order("kind").order("sort");
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ items: data ?? [] });
});

// ---- get one (incl. drafts) ----
adminAcademyRoutes.get("/academy/:id", async (c) => {
  const { data, error } = await serviceClient().from("academy_content").select(COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: data });
});

// ---- create (draft) ----
adminAcademyRoutes.post("/academy", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as AcademyInput & { slug?: string };
  const { errors } = validateAcademyInput(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  const svc = serviceClient();
  const row: Record<string, unknown> = { status: "draft", slug: (body.slug ?? "").trim() };
  if (!row.slug) return c.json({ error: "slug required", code: "validation_error", fields: { slug: "請輸入 slug" } }, 422);
  for (const k of EDITABLE) if (k in body) row[k] = body[k];
  const { data, error } = await svc.from("academy_content").insert(row).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data }, 201);
});

// ---- edit (optimistic concurrency; slug only while draft) ----
adminAcademyRoutes.patch("/academy/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as AcademyEditInput & { updated_at?: string; slug?: string };
  const { errors } = validateAcademyEdit(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("academy_content").select("status, updated_at").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (body.updated_at && body.updated_at !== cur.updated_at) return c.json({ error: "stale", code: "conflict" }, 409);
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (body.slug !== undefined) {
    if (cur.status !== "draft") return c.json({ error: "slug locked", code: "conflict" }, 409);
    patch.slug = body.slug.trim();
  }
  const { data, error } = await svc.from("academy_content").update(patch).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data });
});

// ---- lifecycle ----
const STATUS_NEXT: Record<AcademyStatus, AcademyStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

async function transition(c: import("hono").Context<AdminEnv>, to: AcademyStatus, extra: Record<string, unknown> = {}) {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("academy_content").select("status, title_zh").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (!STATUS_NEXT[cur.status as AcademyStatus]?.includes(to)) return c.json({ error: "bad transition", code: "conflict" }, 409);
  if (to === "published" && !(cur.title_zh && String(cur.title_zh).trim())) return c.json({ error: "needs title", code: "validation_error" }, 422);
  const { data, error } = await svc.from("academy_content").update({ status: to, ...extra }).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data });
}

adminAcademyRoutes.post("/academy/:id/publish", (c) => transition(c, "published", { published_at: new Date().toISOString() }));
adminAcademyRoutes.post("/academy/:id/unpublish", (c) => transition(c, "draft"));
adminAcademyRoutes.post("/academy/:id/archive", (c) => transition(c, "archived", { archived_at: new Date().toISOString() }));

// ---- delete (draft only) ----
adminAcademyRoutes.delete("/academy/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur } = await svc.from("academy_content").select("status, published_at").eq("id", id).maybeSingle();
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (cur.status !== "draft" || cur.published_at) return c.json({ error: "archive instead", code: "conflict" }, 409);
  const { error } = await svc.from("academy_content").delete().eq("id", id);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Register the route in `server/routes/admin.ts`**

Add the import after `adminCampaignRoutes` (line 14) and the mount after
`adminRoutes.route("/", adminCampaignRoutes)` (line 63):

```ts
import { adminAcademyRoutes } from "./adminAcademy.js";
```
```ts
adminRoutes.route("/", adminAcademyRoutes);
```

- [ ] **Step 3: Write the integration test**

Create `server/test/adminAcademy.test.ts` (mirrors `server/test/adminContent.test.ts`; uses the
shared-secret admin header per that suite):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../app.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;
const SECRET = process.env.ADMIN_SECRET ?? "test-admin-secret";

d("admin academy CRUD", () => {
  let app: ReturnType<typeof createApp>["app"];
  const hdr = { "x-admin-secret": SECRET, "Content-Type": "application/json" };
  beforeAll(() => { app = createApp().app; });

  it("lists the seeded rows", async () => {
    const res = await app.request("/api/admin/academy?kind=track", { headers: hdr });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBe(9);
  });

  it("rejects a bad required_level with 422", async () => {
    const res = await app.request("/api/admin/academy", {
      method: "POST", headers: hdr,
      body: JSON.stringify({ kind: "track", slug: "t-bad", title_zh: "x", required_level: "L2+" }),
    });
    expect(res.status).toBe(422);
    const b = await res.json();
    expect(b.fields.required_level).toBeTruthy();
  });

  it("creates → publishes → archives a draft", async () => {
    const create = await app.request("/api/admin/academy", {
      method: "POST", headers: hdr,
      body: JSON.stringify({ kind: "resource", slug: "r-test-1", title_zh: "測試資源" }),
    });
    expect(create.status).toBe(201);
    const { item } = await create.json();
    const pub = await app.request(`/api/admin/academy/${item.id}/publish`, { method: "POST", headers: hdr, body: "{}" });
    expect(pub.status).toBe(200);
    expect((await pub.json()).item.status).toBe("published");
    const arch = await app.request(`/api/admin/academy/${item.id}/archive`, { method: "POST", headers: hdr, body: "{}" });
    expect(arch.status).toBe(200);
  });

  it("409s a duplicate slug", async () => {
    const res = await app.request("/api/admin/academy", {
      method: "POST", headers: hdr,
      body: JSON.stringify({ kind: "resource", slug: "r1", title_zh: "dup" }),
    });
    expect(res.status).toBe(409);
  });
});
```

*(Implementer: confirm the admin test convention in `server/test/adminContent.test.ts` — if it
uses a real staff JWT instead of the shared secret, match that. Add a `beforeAll` cleanup of
`r-test-1`/`t-bad` rows if the suite reruns against a persistent local DB.)*

- [ ] **Step 4: Run type-check + tests**

Run:
```bash
npm run check:esm && npm run type-check
set -a && source .env.test.local && set +a
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/adminAcademy.test.ts
```
Expected: type-check clean; 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adminAcademy.ts server/routes/admin.ts server/test/adminAcademy.test.ts
git commit -m "feat(academy-c1.5): staff CRUD /api/admin/academy (mirror adminContent; 422/409 conventions)"
```

---

## Task 5: Seed-integrity test (`academy-seed.test.ts`)

**Files:**
- Create: `server/test/academy-seed.test.ts`

- [ ] **Step 1: Write the test**

Create `server/test/academy-seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serviceClient } from "../lib/supabase.js";
import { LEVEL_IDS } from "../lib/academyAuthoring.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const d = RUN ? describe : describe.skip;

d("academy_content seed integrity", () => {
  it("has the expected published row counts", async () => {
    const svc = serviceClient();
    const counts: Record<string, number> = {};
    for (const kind of ["guide_doc", "track", "playbook", "resource"]) {
      const { count } = await svc.from("academy_content").select("id", { count: "exact", head: true })
        .eq("kind", kind).eq("status", "published");
      counts[kind] = count ?? 0;
    }
    expect(counts).toEqual({ guide_doc: 8, track: 9, playbook: 6, resource: 8 });
  });

  it("no guide_doc body_zh contains a leading frontmatter fence", async () => {
    const { data } = await serviceClient().from("academy_content").select("slug, body_zh").eq("kind", "guide_doc");
    for (const row of data ?? []) expect((row.body_zh as string).trimStart().startsWith("---")).toBe(false);
  });

  it("every track required_level is a canonical LEVELS id", async () => {
    const { data } = await serviceClient().from("academy_content").select("slug, required_level").eq("kind", "track");
    for (const row of data ?? []) expect(LEVEL_IDS).toContain(row.required_level);
  });
});
```

- [ ] **Step 2: Run it**

Run:
```bash
set -a && source .env.test.local && set +a
RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/academy-seed.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/academy-seed.test.ts
git commit -m "test(academy-c1.5): seed-integrity checks (counts, no frontmatter, canonical levels)"
```

---

## Task 6: Client library (`src/lib/academy.ts`)

**Files:**
- Create: `src/lib/academy.ts`

- [ ] **Step 1: Write the client module**

Create `src/lib/academy.ts`:

```ts
import { apiFetch } from "@/lib/api";
import { adminFetch } from "@/lib/admin";

export type GuideCategory = "start" | "missions" | "rewards" | "account";
export type AcademyKind = "guide_doc" | "track" | "playbook" | "resource";
export type AcademyStatus = "draft" | "published" | "archived";

/** Localized read shape returned by the creator API (meta already flattened to the active lang). */
export type AcademyDoc = {
  id: string; slug: string; title: string; excerpt: string | null; body?: string;
  category: GuideCategory | null; emoji: string | null; sort: number;
};
export type AcademyTrack = {
  id: string; slug: string; title: string; excerpt: string | null; body?: string;
  requiredLevel: string | null; emoji: string | null; color: string | null; sort: number;
  meta: { duration?: string; levelLabel?: string; teaser_zh?: string; teaser_en?: string };
};
export type AcademyPlaybook = {
  id: string; slug: string; title: string; emoji: string | null; color: string | null; sort: number;
  meta: { levels?: string[]; creatorAngle?: string; ideas?: string[]; measurementFocus?: string };
};
export type AcademyResource = {
  id: string; slug: string; title: string; emoji: string | null; sort: number;
  meta: { type?: string; fileUrl?: string | null };
};
export type AcademyBundle = {
  docs: AcademyDoc[]; tracks: AcademyTrack[]; playbooks: AcademyPlaybook[]; resources: AcademyResource[];
};

/** Raw admin row (all languages + status), for the /admin editor. */
export type AdminAcademyRow = {
  id: string; kind: AcademyKind; slug: string; status: AcademyStatus;
  title_zh: string; title_en: string | null; excerpt_zh: string | null; excerpt_en: string | null;
  body_zh: string; body_en: string | null; category: string | null; required_level: string | null;
  emoji: string | null; color: string | null; sort: number; metadata: Record<string, unknown>;
  published_at: string | null; updated_at: string;
};

export const academyKeys = {
  bundle: (lang: string) => ["academy", "bundle", lang] as const,
  doc: (slug: string, lang: string) => ["academy", "doc", slug, lang] as const,
  track: (slug: string, lang: string) => ["academy", "track", slug, lang] as const,
  adminList: (kind: string) => ["admin", "academy", kind] as const,
  adminItem: (id: string) => ["admin", "academy", id] as const,
};

// ---- creator ----
export const fetchAcademy = (lang: string) => apiFetch<AcademyBundle>(`/academy?lang=${lang}`);
export const fetchAcademyDoc = (slug: string, lang: string) => apiFetch<{ item: AcademyDoc }>(`/academy/doc/${slug}?lang=${lang}`);
export const fetchAcademyTrack = (slug: string, lang: string) => apiFetch<{ item: AcademyTrack }>(`/academy/track/${slug}?lang=${lang}`);

// ---- admin ----
export const listAdminAcademy = (kind = "") =>
  adminFetch<{ items: AdminAcademyRow[] }>(`/admin/academy${kind ? `?kind=${kind}` : ""}`);
export const getAdminAcademy = (id: string) => adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}`);
export const createAcademy = (body: Partial<AdminAcademyRow>) =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy`, { method: "POST", body: JSON.stringify(body) });
export const updateAcademy = (id: string, patch: Partial<AdminAcademyRow> & { updated_at?: string }) =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const academyAction = (id: string, action: "publish" | "unpublish" | "archive") =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}/${action}`, { method: "POST", body: "{}" });
export const deleteAcademy = (id: string) => adminFetch<{ ok: true }>(`/admin/academy/${id}`, { method: "DELETE" });
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean (this module is not yet imported anywhere; it just needs to compile).

- [ ] **Step 3: Commit**

```bash
git add src/lib/academy.ts
git commit -m "feat(academy-c1.5): client lib (types, academyKeys, creator + admin fetchers)"
```

---

## Task 7: Rewire guide components to props/client-types

**Files:**
- Modify: `src/components/GuideDocList.tsx`
- Modify: `src/components/PlaybookCard.tsx`
- Modify: `src/components/AcademyTrackCard.tsx`

- [ ] **Step 1: Rewrite `GuideDocList.tsx` to take docs + read-set via props**

The component no longer imports `guideDocs`; the route passes DB docs. Replace the file with:

```tsx
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import type { AcademyDoc, GuideCategory } from "@/lib/academy";

type Props = {
  docs: AcademyDoc[];
  readIds: Set<string>;
};

const CATEGORY_ORDER: GuideCategory[] = ["start", "missions", "rewards", "account"];
const CATEGORY_LABEL_KEY: Record<GuideCategory, string> = {
  start: "app.guide.cat.start",
  missions: "app.guide.cat.missions",
  rewards: "app.guide.cat.rewards",
  account: "app.guide.cat.account",
};

export function GuideDocList({ docs, readIds }: Props) {
  const { t } = useI18n();
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    docs: docs.filter((d) => d.category === cat),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ cat, docs: catDocs }) => (
        <section key={cat}>
          <h4 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-[var(--color-soft-ink)]">
            {t(CATEGORY_LABEL_KEY[cat])}
          </h4>
          <ul className="flex flex-col gap-1">
            {catDocs.map((doc) => (
              <li key={doc.slug}>
                <Link
                  to="/guide/doc/$slug"
                  params={{ slug: doc.slug }}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-ink)] bg-white px-3 py-2 no-underline hover:opacity-90 transition-opacity"
                >
                  <span aria-hidden>{doc.emoji}</span>
                  <span className="flex-1 font-heading text-sm">{doc.title}</span>
                  {readIds.has(doc.slug) && (
                    <span className="text-xs text-[var(--color-soft-ink)]" aria-label={t("app.guide.read")}>✓</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `PlaybookCard.tsx` to consume client types (meta pre-localized)**

The card now receives already-localized data (title/meta are strings for the active lang). Replace with:

```tsx
import type { AcademyPlaybook, AcademyResource } from "@/lib/academy";

type Props = { item: AcademyPlaybook | AcademyResource };

function isPlaybook(item: AcademyPlaybook | AcademyResource): item is AcademyPlaybook {
  return "creatorAngle" in (item.meta ?? {}) || (item as AcademyPlaybook).meta?.ideas !== undefined;
}

export function PlaybookCard({ item }: Props) {
  if (isPlaybook(item)) {
    const levels = item.meta.levels ?? [];
    return (
      <div className="pastel-card flex flex-col gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>{item.emoji}</span>
          <h3 className="font-heading font-semibold">{item.title}</h3>
        </div>
        {item.meta.creatorAngle && (
          <p className="text-sm text-[var(--color-soft-ink)]">{item.meta.creatorAngle}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {levels.map((lvl, i) => (
            <span key={i} className="inline-block rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">
              {lvl}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <span className="text-2xl" aria-hidden>{item.emoji}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug">{item.title}</h3>
        <p className="text-xs text-[var(--color-soft-ink)]">{item.meta.type}</p>
      </div>
    </div>
  );
}
```

*Note:* the index passes playbooks and resources as separate arrays now (see Task 8), so the union
is only for prop typing. The `isPlaybook` guard keys on playbook-only meta.

- [ ] **Step 3: Rewrite `AcademyTrackCard.tsx` to consume client types**

`title`/`meta.duration`/`meta.levelLabel`/`meta.teaser_*` are pre-localized strings; `requiredLevel`
drives the gate. Replace with:

```tsx
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { eligibility } from "@/lib/missionMeta";
import type { AcademyTrack } from "@/lib/academy";

type Props = {
  track: AcademyTrack;
  /** Creator's RAW level (not effective) + trust flag — eligibility() applies the cap. */
  creatorLevel?: string | null;
  isTrusted?: boolean;
  /** Active language, to pick the teaser variant from meta. */
  lang: "en" | "zh";
};

export function AcademyTrackCard({ track, creatorLevel, isTrusted, lang }: Props) {
  const { t } = useI18n();
  const elig = eligibility(track.requiredLevel, creatorLevel, isTrusted ?? false);
  const levelLabel = track.meta.levelLabel ?? track.requiredLevel ?? "";

  if (elig.qualified) {
    return (
      <Link
        to="/guide/track/$trackId"
        params={{ trackId: track.slug }}
        className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 no-underline hover:opacity-90 transition-opacity"
      >
        <span className="text-2xl" aria-hidden>{track.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold leading-snug">{track.title}</h3>
          <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">{track.meta.duration}</p>
        </div>
      </Link>
    );
  }

  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  const lockedCopy = needsVerification ? t("app.guide.verifyToUnlock") : t("app.guide.unlockAt", { level: levelLabel });
  const body = (
    <>
      <span className="text-2xl" aria-hidden>{track.emoji}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug text-[var(--color-soft-ink)]">{track.title}</h3>
        <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">🔒 {lockedCopy}</p>
      </div>
    </>
  );

  if (needsVerification) {
    return (
      <Link to="/profile" className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 no-underline opacity-70 hover:opacity-90 transition-opacity">
        {body}
      </Link>
    );
  }
  return <div className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 opacity-60">{body}</div>;
}
```

*(`lang` is accepted for symmetry / future teaser use; the card currently uses `t()` chrome +
pre-localized fields. Keep the prop so the index can pass it without a follow-up signature change.)*

- [ ] **Step 4: Type-check (expected to FAIL until Task 8 updates the routes)**

Run: `npm run type-check`
Expected: FAILS in `_app.guide.index.tsx` (still importing removed data + old props). That is
addressed in Task 8 — do not commit yet; proceed to Task 8 and commit them together.

---

## Task 8: Rewire the `/guide` routes to `useQuery`

**Files:**
- Modify: `src/routes/_app.guide.index.tsx`
- Modify: `src/routes/_app.guide.doc.$slug.tsx`
- Modify: `src/routes/_app.guide.track.$trackId.tsx`

- [ ] **Step 1: Rewrite the index route**

Replace `src/routes/_app.guide.index.tsx` with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { academyKeys, fetchAcademy } from "@/lib/academy";
import { GuideDocList } from "@/components/GuideDocList";
import { PlaybookCard } from "@/components/PlaybookCard";
import { AcademyTrackCard } from "@/components/AcademyTrackCard";
import { getRead } from "@/lib/guideProgress";

export const Route = createFileRoute("/_app/guide/")({ component: GuideHub });

function GuideHub() {
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.bundle(uiLang), queryFn: () => fetchAcademy(uiLang) });

  const creatorLevel = me.data?.level;
  const isTrusted = me.data?.is_trusted ?? false;
  const creatorId = me.data?.id;
  const readIds = creatorId ? getRead(creatorId) : new Set<string>();
  const docs = q.data?.docs ?? [];
  const readCount = docs.filter((d) => readIds.has(d.slug)).length;

  return (
    <div className="mx-auto max-w-lg p-4 lg:max-w-5xl space-y-6">
      <h1 className="font-display text-xl font-bold">{t("app.guide.title")}</h1>

      {q.isLoading ? (
        <p className="text-sm text-[var(--color-soft-ink)]">…</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.guide.sectionGuides")}</h2>
            <GuideDocList docs={docs} readIds={readIds} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.guide.sectionPlaybooks")}</h2>
            <div className="grid grid-cols-2 gap-3">
              {(q.data?.playbooks ?? []).map((p) => <PlaybookCard key={p.slug} item={p} />)}
              {(q.data?.resources ?? []).map((r) => <PlaybookCard key={r.slug} item={r} />)}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold">{t("app.guide.sectionAcademy")}</h2>
              {creatorId && docs.length > 0 && (
                <span className="text-xs text-[var(--color-soft-ink)]">
                  {t("app.guide.progress", { done: readCount, total: docs.length })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(q.data?.tracks ?? []).map((tr) => (
                <AcademyTrackCard key={tr.slug} track={tr} creatorLevel={creatorLevel} isTrusted={isTrusted} lang={lang === "en" ? "en" : "zh"} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the doc detail route (gate not-found on `isSuccess`)**

Replace `src/routes/_app.guide.doc.$slug.tsx` with:

```tsx
import { useEffect } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { Markdown } from "@/components/Markdown";
import { academyKeys, fetchAcademyDoc } from "@/lib/academy";
import { markRead } from "@/lib/guideProgress";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/doc/$slug")({ component: GuideDocPage });

function GuideDocPage() {
  const { slug } = useParams({ from: "/_app/guide/doc/$slug" });
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.doc(slug, uiLang), queryFn: () => fetchAcademyDoc(slug, uiLang), retry: false });
  const doc = q.data?.item;

  useEffect(() => { if (doc) markRead(me.data?.id, slug); }, [doc, me.data?.id, slug]);

  if (q.isLoading) return <div className="p-4 text-sm">…</div>;
  if (q.isSuccess === false && !doc) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.docNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }
  if (!doc) return <div className="p-4 text-sm">…</div>;

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="truncate font-heading font-semibold">{doc.title}</h1>
      </header>
      <div className="p-4"><Markdown source={doc.body ?? ""} /></div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the track detail route (gate not-found on `isSuccess`; render excerpt as body)**

Replace `src/routes/_app.guide.track.$trackId.tsx` with:

```tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { academyKeys, fetchAcademyTrack } from "@/lib/academy";
import { eligibility } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/track/$trackId")({ component: TrackDetailPage });

function TrackDetailPage() {
  const { trackId } = useParams({ from: "/_app/guide/track/$trackId" });
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.track(trackId, uiLang), queryFn: () => fetchAcademyTrack(trackId, uiLang), retry: false });
  const track = q.data?.item;

  if (q.isLoading) return <div className="p-4 text-sm">…</div>;
  if (q.isSuccess === false && !track) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.trackNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }
  if (!track) return <div className="p-4 text-sm">…</div>;

  const elig = eligibility(track.requiredLevel, me.data?.level, me.data?.is_trusted ?? false);
  const unlocked = elig.qualified;
  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  const levelLabel = track.meta.levelLabel ?? track.requiredLevel ?? "";
  const bodyText = track.body && track.body.trim() ? track.body : track.excerpt;

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <span className="mr-1 text-xl">{track.emoji}</span>
        <h1 className="truncate font-heading font-semibold">{track.title}</h1>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex gap-2 text-sm text-[var(--color-ink-muted)]">
          <span>{track.meta.duration}</span><span>·</span><span>{levelLabel}</span>
        </div>
        {unlocked ? (
          <p className="text-sm leading-relaxed">{bodyText}</p>
        ) : (
          <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-5 space-y-3 text-center">
            <Lock size={32} className="mx-auto text-[var(--color-ink-muted)]" aria-hidden />
            <p className="font-heading font-bold">{lang === "en" ? track.meta.teaser_en : track.meta.teaser_zh}</p>
            {needsVerification ? (
              <>
                <p className="text-sm text-[var(--color-ink-muted)]">{t("app.guide.verifyToUnlock")}</p>
                <Link to="/profile" className="inline-block text-sm font-heading font-bold underline">{t("app.social.verifyNow")}</Link>
              </>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">{t("app.guide.unlockAt", { level: levelLabel })}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + build**

Run: `npm run type-check`
Expected: clean (guide components + routes now consistent; `guideDocs`/`academy.ts` no longer
imported by `/guide`). `academy.ts`/`guideDocs.ts` still exist (deleted in Task 13), so no
dangling-import error yet.

- [ ] **Step 5: Commit**

```bash
git add src/components/GuideDocList.tsx src/components/PlaybookCard.tsx src/components/AcademyTrackCard.tsx \
  src/routes/_app.guide.index.tsx "src/routes/_app.guide.doc.\$slug.tsx" "src/routes/_app.guide.track.\$trackId.tsx"
git commit -m "feat(academy-c1.5): /guide reads from DB via useQuery (loading/empty + isSuccess-gated not-found)"
```

---

## Task 9: Admin Academy authoring UI

**Files:**
- Create: `src/components/admin/AcademyEditor.tsx`
- Create: `src/routes/admin.academy.index.tsx`
- Create: `src/routes/admin.academy.$id.tsx`
- Modify: `src/components/admin/adminNavItems.ts`
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add the Academy nav item**

In `src/components/admin/adminNavItems.ts`, import `GraduationCap` in the lucide import block and
add the item to the Library group (after the `content` item, line 55):

```ts
import {
  BarChart3, Inbox, FileCheck, Users, UserCheck, Layers, Target, Trophy, FileText, Radar,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
```
```ts
      { to: "/admin/content", labelKey: "app.admin.tabContent", icon: FileText, exact: false },
      { to: "/admin/academy", labelKey: "app.admin.tabAcademy", icon: GraduationCap, exact: false },
```

- [ ] **Step 2: Add i18n keys**

In `src/lib/i18n.dict.ts`, add to BOTH the `en` and `zh` maps (place near the other
`app.admin.tab*` keys). English map:

```ts
    "app.admin.tabAcademy": "Academy",
    "app.admin.academy.title": "Academy content",
    "app.admin.academy.new": "New item",
    "app.admin.academy.empty": "No academy content yet.",
```
zh-HK map:
```ts
    "app.admin.tabAcademy": "學院內容",
    "app.admin.academy.title": "學院內容",
    "app.admin.academy.new": "新增項目",
    "app.admin.academy.empty": "尚未有學院內容。",
```

- [ ] **Step 3: Write the `AcademyEditor` component**

Create `src/components/admin/AcademyEditor.tsx` (bilingual toggle + markdown preview for
guide_doc/track; structured `metadata` fields for playbook/resource). Uses a JSON textarea for
`metadata` to keep the editor small while still fully authorable:

```tsx
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/components/Markdown";
import {
  getAdminAcademy, createAcademy, updateAcademy, academyAction, academyKeys,
  type AdminAcademyRow, type AcademyKind,
} from "@/lib/academy";

const EMPTY: Partial<AdminAcademyRow> = {
  kind: "guide_doc", slug: "", title_zh: "", title_en: "", body_zh: "", body_en: "",
  excerpt_zh: "", excerpt_en: "", category: null, required_level: null, emoji: "", color: "", sort: 0, metadata: {},
};
const KINDS: AcademyKind[] = ["guide_doc", "track", "playbook", "resource"];

export function AcademyEditor({ id }: { id: string }) {
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [form, setForm] = useState<Partial<AdminAcademyRow>>(EMPTY);
  const [metaText, setMetaText] = useState("{}");
  const [metaErr, setMetaErr] = useState<string | null>(null);

  useQuery({
    queryKey: academyKeys.adminItem(id), enabled: !isNew,
    queryFn: async () => {
      const { item } = await getAdminAcademy(id);
      setForm(item); setMetaText(JSON.stringify(item.metadata ?? {}, null, 2)); return item;
    },
  });

  const set = (patch: Partial<AdminAcademyRow>) => setForm((f) => ({ ...f, ...patch }));
  const titleField = lang === "zh" ? "title_zh" : "title_en";
  const bodyField = lang === "zh" ? "body_zh" : "body_en";
  const showBody = form.kind === "guide_doc" || form.kind === "track";

  function parsedMeta(): Record<string, unknown> | null {
    try { const v = JSON.parse(metaText || "{}"); setMetaErr(null); return v; } catch { setMetaErr("Invalid JSON"); return null; }
  }

  const save = useMutation({
    mutationFn: async () => {
      const metadata = parsedMeta();
      if (metadata === null) throw new Error("metadata");
      const payload = { ...form, metadata };
      if (isNew) return (await createAcademy(payload)).item;
      return (await updateAcademy(id, { ...payload, updated_at: form.updated_at })).item;
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["admin", "academy"] });
      if (isNew) navigate({ to: "/admin/academy/$id", params: { id: item.id } });
      else { setForm(item); setMetaText(JSON.stringify(item.metadata ?? {}, null, 2)); }
    },
  });
  const act = useMutation({
    mutationFn: (a: "publish" | "unpublish" | "archive") => academyAction(id, a),
    onSuccess: ({ item }) => { setForm(item); qc.invalidateQueries({ queryKey: ["admin", "academy"] }); },
  });

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
        <input value={(form[lang === "zh" ? "excerpt_zh" : "excerpt_en"] as string) ?? ""} onChange={(e) => set({ [lang === "zh" ? "excerpt_zh" : "excerpt_en"]: e.target.value })}
          placeholder="Excerpt / short description" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
        {showBody && (
          <>
            <textarea value={(form[bodyField] as string) ?? ""} onChange={(e) => set({ [bodyField]: e.target.value })}
              placeholder="Markdown…" rows={12} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm" />
            <div className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
              <p className="mb-1 text-xs uppercase">Preview</p>
              <Markdown source={(form[bodyField] as string) ?? ""} />
            </div>
          </>
        )}
        <label className="block text-xs uppercase">Metadata (JSON)
          <textarea value={metaText} onChange={(e) => setMetaText(e.target.value)} rows={8}
            className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-2 font-mono text-xs" />
          {metaErr && <span className="text-xs text-[var(--color-magenta)]">{metaErr}</span>}
        </label>
      </div>
      <aside className="space-y-3">
        <label className="block text-xs uppercase">Kind
          <select value={form.kind} onChange={(e) => set({ kind: e.target.value as AcademyKind })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="block text-xs uppercase">Slug
          <input value={form.slug ?? ""} onChange={(e) => set({ slug: e.target.value })} disabled={!isNew && form.status !== "draft"}
            className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" />
        </label>
        {form.kind === "guide_doc" && (
          <label className="block text-xs uppercase">Category
            <select value={form.category ?? ""} onChange={(e) => set({ category: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
              <option value="">—</option><option value="start">start</option><option value="missions">missions</option><option value="rewards">rewards</option><option value="account">account</option>
            </select>
          </label>
        )}
        {form.kind === "track" && (
          <label className="block text-xs uppercase">Required level
            <select value={form.required_level ?? ""} onChange={(e) => set({ required_level: e.target.value || null })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm">
              <option value="">—</option>{["L0","L1","L2","L3","L4","L5","L6"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs uppercase">Emoji<input value={form.emoji ?? ""} onChange={(e) => set({ emoji: e.target.value })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <label className="block text-xs uppercase">Color<input value={form.color ?? ""} onChange={(e) => set({ color: e.target.value })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <label className="block text-xs uppercase">Sort<input type="number" value={form.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} className="mt-1 w-full rounded border-2 border-[var(--color-ink)] p-1 text-sm" /></label>
        <button onClick={() => save.mutate()} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-2 font-bold">Save</button>
        {!isNew && form.status !== "published" && <button onClick={() => act.mutate("publish")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-bold">Publish</button>}
        {!isNew && form.status === "published" && <button onClick={() => act.mutate("archive")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm">Archive</button>}
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Write the admin route files**

Create `src/routes/admin.academy.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAdminAcademy, academyKeys } from "@/lib/academy";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/academy/")({ component: AcademyList });

function AcademyList() {
  const { t } = useI18n();
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({ queryKey: academyKeys.adminList(kind || "all"), queryFn: () => listAdminAcademy(kind) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t("app.admin.academy.title")}</h2>
        <Link to="/admin/academy/$id" params={{ id: "new" }} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1.5 text-sm font-bold">
          {t("app.admin.academy.new")}
        </Link>
      </div>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1 text-sm">
        <option value="">All</option><option value="guide_doc">Guide docs</option><option value="track">Tracks</option><option value="playbook">Playbooks</option><option value="resource">Resources</option>
      </select>
      {isLoading ? <p className="text-sm text-[var(--color-soft-ink)]">…</p>
        : !data?.items.length ? <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.academy.empty")}</p>
        : (
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b-2 border-[var(--color-ink)] text-left text-xs uppercase"><th className="p-2">Title</th><th className="p-2">Kind</th><th className="p-2">Status</th><th /></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-b border-gray-200">
                  <td className="p-2">{it.emoji} {it.title_zh}</td>
                  <td className="p-2">{it.kind}</td>
                  <td className="p-2">{it.status}</td>
                  <td className="p-2"><Link to="/admin/academy/$id" params={{ id: it.id }} className="underline">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
```

Create `src/routes/admin.academy.$id.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { AcademyEditor } from "@/components/admin/AcademyEditor";

export const Route = createFileRoute("/admin/academy/$id")({ component: EditorPage });

function EditorPage() {
  const { id } = useParams({ from: "/admin/academy/$id" });
  return <AcademyEditor id={id} />;
}
```

- [ ] **Step 5: Type-check (regenerates the route tree)**

Run: `npm run type-check`
Expected: clean — the two new routes are picked up by `tsr generate`.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AcademyEditor.tsx src/routes/admin.academy.index.tsx "src/routes/admin.academy.\$id.tsx" \
  src/components/admin/adminNavItems.ts src/lib/i18n.dict.ts
git commit -m "feat(academy-c1.5): /admin Academy section — list + kind-aware editor + nav item"
```

---

## Task 10: KB ingest rewrite + orphan prune

**Files:**
- Modify: `scripts/ingest-kb.ts`

- [ ] **Step 1: Rewrite `loadArticles()` → `loadFromDb()` and add a prune step**

Replace `scripts/ingest-kb.ts` with:

```ts
import { serviceClient } from "../server/lib/supabase.js";
import { embedTexts } from "../server/lib/llm.js";
import { chunkText } from "../server/lib/assistant/chunk.js";
import { toKbDocument, type SourceDoc } from "../server/lib/assistant/collect.js";

const LOCALE = "zh-HK";

/** Load published guide_doc rows from academy_content as KB source articles. body_zh is already
 *  frontmatter-stripped at seed, so content = body_zh directly. sourceRef = slug keeps the
 *  kb_documents unique key (source_type,source_ref,locale) stable across runs. */
async function loadFromDb(db: ReturnType<typeof serviceClient>): Promise<SourceDoc[]> {
  const { data, error } = await db.from("academy_content")
    .select("slug, title_zh, body_zh").eq("kind", "guide_doc").eq("status", "published");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    sourceType: "article" as const,
    sourceRef: r.slug as string,
    title: r.title_zh as string,
    locale: LOCALE,
    content: ((r.body_zh as string) ?? "").trim(),
  }));
}

async function main() {
  const db = serviceClient();
  const docs = await loadFromDb(db);

  for (const doc of docs) {
    const row = toKbDocument(doc);
    const { data: existing } = await db.from("kb_documents")
      .select("id, content_hash").eq("source_type", row.source_type)
      .eq("source_ref", row.source_ref).eq("locale", row.locale).maybeSingle();
    if (existing?.content_hash === row.content_hash) { console.log(`skip ${row.source_ref}`); continue; }

    const { data: upserted, error } = await db.from("kb_documents")
      .upsert(row, { onConflict: "source_type,source_ref,locale" }).select("id").single();
    if (error || !upserted) { console.error(`doc fail ${row.source_ref}`, error); continue; }
    const docId = upserted.id as string;

    await db.from("kb_chunks").delete().eq("document_id", docId);
    const chunks = chunkText(doc.content, { maxChars: 1500, overlapChars: 200 });
    const embeddings = await embedTexts(chunks);
    const rows = chunks.map((content, i) => ({ document_id: docId, chunk_index: i, content, token_count: Math.ceil(content.length / 4), embedding: embeddings[i] }));
    const { error: chunkErr } = await db.from("kb_chunks").insert(rows);
    if (chunkErr) { console.error(`chunks fail ${row.source_ref}`, chunkErr); continue; }
    console.log(`ingested ${row.source_ref} (${chunks.length} chunks)`);
  }

  // Prune: remove KB articles whose guide_doc is no longer published (archived/unpublished/deleted).
  // kb_chunks cascade on the kb_documents FK. Only touches source_type='article' rows.
  const liveSlugs = docs.map((d) => d.sourceRef);
  const { data: stale } = await db.from("kb_documents")
    .select("id, source_ref").eq("source_type", "article").eq("locale", LOCALE);
  const orphans = (stale ?? []).filter((r) => !liveSlugs.includes(r.source_ref as string));
  for (const o of orphans) {
    await db.from("kb_documents").delete().eq("id", o.id);
    console.log(`pruned ${o.source_ref}`);
  }
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Type-check**

Run: `npm run check:esm && npm run type-check`
Expected: clean (`.js` extensions preserved on all relative imports; `readFileSync`/`readdirSync`
imports removed).

- [ ] **Step 3: Verify the ingest runs against the local stack (manual)**

With the local stack up + `0028` applied, and `AI_GATEWAY_API_KEY` + `AI_GATEWAY_EMBED_MODEL` set:
```bash
set -a && source .env.test.local && set +a
npm run ingest:kb
```
Expected: logs `ingested <slug>` (or `skip <slug>` on a re-run) for the 8 guide docs; no `pruned`
lines on a healthy DB. *(If `AI_GATEWAY_*` are not set locally, this is deferred to the prod
rollout — Task 14 — and only type-check gates this task.)*

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-kb.ts
git commit -m "feat(academy-c1.5): ingest-kb reads guide_doc from DB + prunes orphaned KB articles"
```

---

## Task 11: Marketing decouple (`marketingShowcase.ts`)

**Files:**
- Create: `src/data/marketingShowcase.ts`
- Modify: `src/data/mockData.ts`

- [ ] **Step 1: Create `marketingShowcase.ts`**

Move the `playbooks`, `academyTracks`, `resources` arrays + their `Playbook`/`AcademyTrack`/`Resource`
types verbatim out of `src/data/academy.ts` into a new `src/data/marketingShowcase.ts`. This is
static marketing data for the public `_site` pages only (the live product surface reads the DB).

Copy the full contents of the current `src/data/academy.ts` into `src/data/marketingShowcase.ts`
unchanged (it already imports `LocalizedText` from `./legacyAdfocateContent`, which stays). No edits
to the data are needed — this is a rename/relocate so the public build keeps compiling.

- [ ] **Step 2: Repoint `mockData.ts` re-exports**

In `src/data/mockData.ts`, change the two re-export blocks (currently `from "./academy"`) to
`from "./marketingShowcase"`:

```ts
// ─── PLAYBOOKS (re-exported from marketingShowcase.ts) ───
export { playbooks } from "./marketingShowcase";
export type { Playbook } from "./marketingShowcase";
```
```ts
// ─── ACADEMY TRACKS + RESOURCES (re-exported from marketingShowcase.ts) ───
export { academyTracks, resources } from "./marketingShowcase";
export type { AcademyTrack, Resource } from "./marketingShowcase";
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: clean. `_site.creators.tsx` / `_site.playbooks.tsx` import from `mockData`, which now
resolves to `marketingShowcase`. `academy.ts` still exists (deleted next task) so nothing dangles.

- [ ] **Step 4: Commit**

```bash
git add src/data/marketingShowcase.ts src/data/mockData.ts
git commit -m "refactor(academy-c1.5): static marketingShowcase.ts for public _site pages (decouple from academy.ts)"
```

---

## Task 12: Update guide frontend tests to mocked queries

**Files:**
- Modify: `src/routes/-_app.guide.index.test.tsx`
- Modify: `src/routes/-_app.guide.track.$trackId.test.tsx`

- [ ] **Step 1: Inspect the existing guide route tests**

Run: `ls src/routes/-_app.guide.* && sed -n '1,40p' src/routes/-_app.guide.index.test.tsx`
These tests currently render against the hardcoded `guideDocs`/`academyTracks`. They must be
updated to provide a mocked React Query client (the routes now fetch). Follow the mocking pattern
used by an existing query-driven route test — e.g. `src/routes/-admin.insights.test.tsx` or
`-brand.resources.index.test.tsx` — which wrap the component in a `QueryClientProvider` and stub the
fetcher.

- [ ] **Step 2: Rewrite the index test to stub `fetchAcademy`**

Replace `src/routes/-_app.guide.index.test.tsx` with a test that mocks `@/lib/academy` and asserts
the three sections render from the bundle. Concrete example:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/academy", () => ({
  academyKeys: { bundle: (l: string) => ["academy", "bundle", l] },
  fetchAcademy: vi.fn(async () => ({
    docs: [{ id: "1", slug: "leveling", title: "等級制度", excerpt: null, body: undefined, category: "start", emoji: "⭐", sort: 1 }],
    tracks: [{ id: "2", slug: "a1", title: "KOC新手訓練營", excerpt: "x", requiredLevel: "L0", emoji: "🌱", color: "pink", sort: 0, meta: { duration: "4堂課", levelLabel: "L0–L1", teaser_zh: "…", teaser_en: "…" } }],
    playbooks: [], resources: [],
  })),
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMe: () => ({ data: { id: "c1", level: "L3", is_trusted: true } }) }));
vi.mock("@/lib/guideProgress", () => ({ getRead: () => new Set<string>() }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k, lang: "zh" }) }));

// The route module exports `Route`; render its component through a QueryClientProvider.
import { Route } from "./_app.guide.index";
const Comp = Route.options.component as React.FC;

function renderGuide() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Comp /></QueryClientProvider>);
}

describe("GuideHub", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders a guide doc and a track from the bundle", async () => {
    renderGuide();
    expect(await screen.findByText("等級制度")).toBeTruthy();
    expect(await screen.findByText("KOC新手訓練營")).toBeTruthy();
  });
});
```

*(Implementer: adjust the render harness to match the project's existing route-test convention if it
differs — the key change is providing a `QueryClientProvider` and stubbing `fetchAcademy`. If the
old test asserted specific i18n label keys, keep those assertions with `t` returning the key.)*

- [ ] **Step 3: Update the track test similarly**

Update `src/routes/-_app.guide.track.$trackId.test.tsx` to mock `fetchAcademyTrack` and assert the
locked vs unlocked branch (pass `useMe` levels above/below `requiredLevel`). Mirror the index test's
mocking approach.

- [ ] **Step 4: Run the guide tests**

Run: `npx vitest run src/routes/-_app.guide.index.test.tsx "src/routes/-_app.guide.track.\$trackId.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/-_app.guide.index.test.tsx "src/routes/-_app.guide.track.\$trackId.test.tsx"
git commit -m "test(academy-c1.5): guide route tests render from mocked academy query"
```

---

## Task 13: Delete legacy sources + register integration tests

**Files:**
- Delete: `src/data/academy.ts`, `src/data/academy.test.ts`, `src/data/guideDocs.ts`, `src/data/guideDocs.test.ts`, `content/help/*.md` (8)
- Modify: `src/lib/i18n.dict.ts` (remove migrated keys)
- Modify: `package.json` (register integration specs)

- [ ] **Step 1: Remove the migrated i18n keys**

In `src/lib/i18n.dict.ts`, delete these keys from BOTH the `en` and `zh` maps (they are now
DB-sourced): `app.guide.doc.account`, `app.guide.doc.leveling`, `app.guide.doc.missions`,
`app.guide.doc.submission`, `app.guide.doc.points`, `app.guide.doc.redemption`,
`app.guide.doc.wallet`, `app.guide.doc.profile`, and `app.guide.teaser.a1` … `app.guide.teaser.a9`.
Keep all other `app.guide.*` chrome keys (`title`, `sectionGuides`, `sectionPlaybooks`,
`sectionAcademy`, `read`, `progress`, `unlockAt`, `verifyToUnlock`, `cat.*`, `docNotFound`,
`trackNotFound`). Delete keys in matched en/zh pairs so the `i18n.test.tsx` parity guard stays green.

- [ ] **Step 2: Delete the legacy data files**

Run:
```bash
git rm src/data/academy.ts src/data/academy.test.ts src/data/guideDocs.ts src/data/guideDocs.test.ts \
  content/help/account.zh-HK.md content/help/leveling.zh-HK.md content/help/missions.zh-HK.md \
  content/help/submission.zh-HK.md content/help/points.zh-HK.md content/help/redemption.zh-HK.md \
  content/help/wallet.zh-HK.md content/help/profile.zh-HK.md
```

- [ ] **Step 3: Confirm no dangling importers**

Run:
```bash
grep -rn "data/academy\"\|data/guideDocs\"\|content/help" src server scripts --include="*.ts" --include="*.tsx" | grep -v marketingShowcase
```
Expected: no output (all references migrated: `/guide` → `src/lib/academy`, `_site` →
`marketingShowcase` via `mockData`, KB → DB). If `content/help` still appears, it must only be in
this plan's history — not in code.

- [ ] **Step 4: Register the new integration specs in `package.json`**

In the `test:integration` script string, append these three specs to the list:
`server/test/academy.test.ts server/test/adminAcademy.test.ts server/test/academy-seed.test.ts`.

- [ ] **Step 5: Full gate**

Run:
```bash
npm run check:esm && npm run type-check && npm run lint
npm run test
```
Expected: `check:esm` clean; `type-check` clean; lint clean; unit suite green (the deleted
`academy.test.ts`/`guideDocs.test.ts` are gone; the new guide route tests pass).

Then integration:
```bash
set -a && source .env.test.local && set +a
npm run test:integration
```
Expected: the academy specs pass alongside the existing suite.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: SUCCESS (esm + codegen + tsc + vite).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(academy-c1.5): delete legacy academy/guideDocs/help sources + register integration specs"
```

---

## Task 14: Rollout runbook (prod — manual, no code)

**Files:** none (operational checklist; execute at deploy time).

- [ ] **Step 1: Apply the migration to prod via raw SQL (NOT `db push`)**

Using the Supabase MCP `execute_sql` (or SQL editor) against project `mhkoayftiuojxlrkollf`, run the
full contents of `supabase/migrations/0028_academy_content.sql`. The `on conflict (slug) do nothing`
seed makes re-runs safe.

- [ ] **Step 2: Reload PostgREST**

Run: `NOTIFY pgrst, 'reload schema';`

- [ ] **Step 3: Verify counts in prod**

Run: `select kind, count(*) from public.academy_content where status='published' group by kind order by kind;`
Expected: `guide_doc 8`, `playbook 6`, `resource 8`, `track 9`.

- [ ] **Step 4: Deploy via Git**

Merge the PR (Vercel Git deploy). Do NOT `vercel --prod` from local (it mis-bundles the API).

- [ ] **Step 5: Re-ingest the KB on prod**

With prod env (`AI_GATEWAY_API_KEY` + `AI_GATEWAY_EMBED_MODEL` present), run `npm run ingest:kb`
against prod once. Expect `skip <slug>` for the 8 docs if their bodies match the previously-ingested
(frontmatter-stripped) content byte-for-byte — meaning embeddings are reused, not re-embedded. Any
`pruned` line means an article no longer maps to a published guide_doc.

- [ ] **Step 6: Smoke test**
  - `/guide` renders all four sections from the DB (docs, playbooks+resources grid, tracks).
  - A staff edit to a guide doc in `/admin/academy` reflects on `/guide` after refetch.
  - The AI assistant answers a guide-doc question from the re-ingested KB.
  - Unpublishing a guide doc removes it from `/guide` immediately and from the KB after the next ingest.

---

## Self-Review

**1. Spec coverage** (each spec §, mapped to a task):
- §3 title sourcing → Task 1 seed (i18n titles for docs, LocalizedText for tracks/playbooks/resources); §7/§13 remove migrated i18n keys.
- §4 data model → Task 1 (table, RLS+grants, trigger reuse, required_level CHECK, metadata shapes, minted playbook slugs, frontmatter-stripped body_zh, deterministic sort, `on conflict do nothing`).
- §5 server API → Tasks 3 (creator reads, degrade-to-empty, `makeUserClient`) + 4 (admin CRUD, 422/409, transitions, sub-mount inherits staff auth) + 2 (validators, required_level canonical guard).
- §6 KB ingest + prune → Task 10.
- §7 client + `/guide` (async states, `isSuccess`-gated not-found, preserved eligibility + guideProgress, levelLabel, excerpt-as-body) → Tasks 6, 7, 8; admin editor + nav → Task 9; marketing decouple → Task 11.
- §7 deletions → Task 13.
- §8 tests → Tasks 2, 3, 4, 5, 12, 13.
- §9 rollout → Task 14.
- §10 deferred (body_en, scheduled_for, ideas/measurementFocus en, fileUrl downloads, server-side progress) → intentionally not implemented; noted.

**2. Placeholder scan:** No "TBD"/"add validation here" placeholders; every code step shows full
code. Two tests carry implementer notes to match the exact sibling-helper signature (`makeCreator`,
admin auth convention, route-test harness) — these are verification instructions, not missing code,
because the exact helper export is confirmed by reading the sibling test at execution time.

**3. Type consistency:** `academyKeys` names (`bundle`/`doc`/`track`/`adminList`/`adminItem`) are
used identically in Tasks 6/8/9/12. `AcademyTrack.meta.levelLabel|duration|teaser_zh|teaser_en`,
`AcademyPlaybook.meta.{levels,creatorAngle,ideas,measurementFocus}`, `AcademyResource.meta.{type,fileUrl}`
match the server `shape()`/`localizeMeta()` output (Task 3) and the seed metadata (Task 1). Server
`AcademyInput`/`validateAcademyInput` (Task 2) are imported by `adminAcademy.ts` (Task 4). `GuideCategory`
is defined in `src/lib/academy.ts` (Task 6) and consumed by `GuideDocList` (Task 7). Route slugs use
`doc.slug`/`track.slug` (not the removed `.id`) everywhere. `eligibility(requiredLevel, rawLevel, isTrusted)`
signature preserved in Tasks 7/8.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-02-academy-db-migration-c1.5.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
