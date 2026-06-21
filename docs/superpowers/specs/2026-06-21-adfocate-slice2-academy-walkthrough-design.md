# Slice 2 — Creator Academy + First-Run Walkthrough — Design

**Date:** 2026-06-21
**Parent:** [`2026-06-21-creator-activation-funnel-design.md`](./2026-06-21-creator-activation-funnel-design.md) (umbrella / north-star)
**Status:** Implementable spec (revised after an adversarial feasibility review against the codebase). Next step after approval → `writing-plans`.

The second and final funnel slice. Slice 1 built the ladder + verification gate; Slice 2 is the **education layer that explains them** — a persistent in-app **Creator Academy** (guidelines + playbooks + level-gated tracks) plus a **first-run primer** woven into onboarding.

---

## 1. Goal

Today the creator journey has no in-app education: `content/help/*` (8 zh-HK guideline docs) is rendered by nothing, playbook/academy content lives only as mock data on the marketing pages, and a new creator gets no orientation. Slice 2 surfaces all of it inside the live app as one browsable **Academy**, gated by the same `effective_level` the ladder uses, and adds a short onboarding primer so the funnel explains itself.

---

## 2. Locked decisions (from brainstorm)

1. **Scope = Full Academy** — Guide hub + playbook/academy content as real in-app tracks + level-gating + first-run walkthrough (one slice, internally phased).
2. **Language = zh-HK primary, en deferred.** Render content zh-HK now (app default locale). Translate the English playbook/academy mock copy to zh-HK. Build the structure bilingual-ready (i18n keys for chrome) but ship zh-HK content; full en pass deferred to One-Unification. (Dict `Locale` is `'en' | 'zh'` — the zh-HK distinction is copy register, not a separate dict slot.)
3. **Content model = hybrid.** Long-form reference docs stay **markdown** (`content/help/*.zh-HK.md`, rendered via `react-markdown` + `rehype-sanitize`); playbooks/academy stay **structured TS data** (rich cards with level/emoji/metadata).
4. **Hub layout = single scroll, sectioned** — one `/guide` page, three stacked sections: 快速指南 (doc list) → 攻略庫 (playbook cards) → 創作者學院 (level-gated track cards + read-progress strip).
5. **Level-gating = locked-but-visible, on `effective_level`.** Tracks above the creator's effective level render greyed with 🔒 + "L{n} 解鎖" and a teaser on tap. Reference docs are never gated.
6. **Walkthrough = a primer that occupies the existing un-rendered onboarding step-1 slot** (see §7), reusing `onboarding_step`/`onboarding_completed`. **No new flag, no step-index renumber, no migration.**
7. **No migration, no new backend.** Markdown bundled client-side; track data is TS; gating uses the existing `/api/me`. Read-progress = localStorage (server-persisted progress deferred).

---

## 3. Current-state grounding (verified against the code)

- **`content/help/*.zh-HK.md`** — 8 docs: `account`, `leveling`, `missions`, `points`, `profile`, `redemption`, `submission`, `wallet` (~300–520 bytes each). **No route renders them.**
- **Marketing content** — `src/data/mockData.ts`: `playbooks` (type `Playbook`, ~L432), `academyTracks` (type `AcademyTrack`, ~L539), `resources` (type `Resource`, ~L568). **Only two real importers:** `src/routes/_site.playbooks.tsx` (imports `playbooks`) and `_site.creators.tsx` (imports `academyTracks` + `resources`). English copy. **`AcademyTrack.level` is a DISPLAY range** like `"L0–L1"`, `"L1+"`, `"L2+"`, `"L3+"`, `"L4+"` — NOT a clean level id.
- **Onboarding (the real model — the prior spec got this wrong):**
  - DB default `onboarding_step = 1` (migration `0003_onboarding.sql`) is an **un-started sentinel that is never rendered as a screen**.
  - `src/routes/_app.onboarding.tsx` seeds `const [step] = useState(() => Math.max(2, status.data?.onboarding_step ?? 2))` (~L33) and renders screens **only for steps 2,3,4,5** (categories → social handles → recommended missions → welcome bonus + referral).
  - Server `completion_pct = onboarding_completed ? 100 : round(((onboarding_step - 1) / 4) * 100)` → step1=0%, step2=25%, step5=100% (`server/routes/onboarding.ts:18`). Denominator `4` = advances from step1→step5.
  - Client `<ProgressBar value={step - 1} max={5} />` (~L79) — a hardcoded client constant.
  - `award_welcome_bonus` (migration `0003_onboarding.sql:74`) hardcodes `onboarding_step = 5` as the completed sentinel.
  - Integration test `server/test/onboarding.test.ts:28–35` hard-asserts "status starts at step 1, 0% complete."
- **Slice 1 primitives** — `/api/me` returns `effective_level` + `is_trusted` (`server/routes/me.ts:96–98`); client `Me` type has them (`src/lib/queries/kocmax.ts:35`). `src/lib/levels.ts` exports `LEVELS` + `levelIndex(id)` (0-indexed; returns **0 for any unknown string** — so a range like `"L2+"` would silently map to 0). `me.level` (raw) is the documented fallback if `effective_level` is absent.
- **Nav** — the shared source is **`src/components/navItems.ts`** exporting `NAV_ITEMS: NavItem[]` (shape `{ to, labelKey, icon, exact }`), consumed by `SideNav.tsx` (lg+) and `BottomNav.tsx` (mobile). It currently has **5 entries**.
- **No markdown renderer** in `package.json` (React 19.2 — `react-markdown@10` + `rehype-sanitize@6` are compatible). **No `/guide` route.** TanStack file routes under `src/routes/`; the `<Outlet/>` caution is real (documented in `src/routes/_app.mission.tsx`).

---

## 4. Architecture

### 4.1 Routes + nav
- `src/routes/_app.guide.index.tsx` — the hub (single-scroll, 3 sections).
- `src/routes/_app.guide.doc.$slug.tsx` — one reference doc (sanitized markdown).
- `src/routes/_app.guide.track.$trackId.tsx` — one academy track (full content if unlocked; teaser if locked).
- If a `_app.guide.tsx` layout wrapper is generated by `tsr`, it MUST render `<Outlet/>` (prefer flat sibling routes; verify nav renders after wiring).
- **Nav:** append one entry to `NAV_ITEMS` in **`src/components/navItems.ts`**: `{ to: "/guide", labelKey: "app.nav.guide", icon: <BookOpen/>, exact: false }`. This makes **6 mobile bottom-nav tabs** — `BottomNav` uses `flex-1` so a 6th fits but is tighter; **decision: 6 tabs is acceptable** (re-balancing the bottom nav is out of scope).

### 4.2 Content layer
- **Reference docs:** typed index `src/data/guideDocs.ts`:
  ```ts
  export type GuideDoc = { id: string; titleKey: string; category: GuideCategory; emoji: string; body: string };
  ```
  `body` = raw markdown imported with Vite `?raw`. **Use a relative import** from `src/data/` (e.g. `import leveling from "../../content/help/leveling.zh-HK.md?raw"`), NOT the `@/../` alias-escape (the `@` alias maps only to `src/*`). **No custom `*.md?raw` declaration is required** — `vite/client` (in tsconfig `types`) already declares `*?raw`. (A one-line spike during implementation confirms the import type-checks under `tsc` + resolves under `vite`/`vitest`; the copy-into-`src/content/` fallback is an optional de-risk only.)
- **Markdown rendering:** add `react-markdown` + `rehype-sanitize`; a `<Markdown>` wrapper (`src/components/Markdown.tsx`) applying the sanitize schema + Tailwind prose styles. Sanitized even though content is first-party.
- **Tracks/playbooks:** move `playbooks`/`academyTracks`/`resources` into `src/data/academy.ts`; **re-export them from `mockData.ts`** (or repoint the two `_site` importers) so the marketing pages + their tests stay green. Translate the English `title`/`description` copy to zh-HK.
  - Add **`requiredLevel: string`** (a canonical `LEVELS` id, NEVER a range) to each track, derived from the existing display `level`: `"L0–L1"→"L0"`, `"L1+"→"L1"`, `"L2+"→"L2"`, `"L3+"→"L3"`, `"L4+"→"L4"`. **Keep the old `level` field for the card's display label.**
  - Add a **`teaserKey: string`** (and reuse/add a short `description`) so the track-detail page has something to render for BOTH the locked teaser and the unlocked view — `academyTracks` today only carry `id/title/level/duration/color/emoji`, so a renderable body field is required (§12 binds to it).

### 4.3 Hub composition (`/guide`)
- **快速指南**: `guideDocs` grouped by `category`, each row links to `/guide/doc/$slug` with a "✓ 已讀" marker from localStorage. Not gated.
- **攻略庫**: `playbooks`/`resources` as cards.
- **創作者學院**: `academyTracks` as gated cards (§5) + a read-progress strip ("X/Y 已讀", §6).
- Pure presentational sub-components: `GuideDocList`, `PlaybookCard`, `AcademyTrackCard` (single-purpose, independently testable).

---

## 5. Level-gating model

- Pure helper `src/lib/academyGating.ts`: `isTrackUnlocked(requiredLevel: string, effectiveLevel: string): boolean` = `levelIndex(effectiveLevel) >= levelIndex(requiredLevel)`. **Reads `requiredLevel` (a canonical id) only — never parses the display `level` range** (which would `levelIndex → 0` and unlock everything). A unit test asserts every track's `requiredLevel` is a canonical `LEVELS` id.
- Gating input = **`me.effective_level`** (fallback `me.level`). Reference docs are never gated.
- **Locked-but-visible:** a locked `AcademyTrackCard` renders greyed, shows 🔒 + `t("app.guide.unlockAt", { level })` (required level's label via `t(LEVELS[levelIndex(requiredLevel)].labelKey)`); on tap, `/guide/track/$id` shows a **teaser** (`title` + `teaserKey` + the unlock requirement), not the body. Unlocked tracks show full content.
- **Expected consequence (by design):** `effectiveLevel()` caps untrusted creators at L1, so **every track with `requiredLevel ≥ L2` is locked for the entire pre-verification population** regardless of XP — this is the intended funnel pressure. To keep the hub rewarding rather than walled-off for a brand-new untrusted creator, the **L0/L1 tracks + the 快速指南 docs must give a meaningful first session** (ensure at least a couple of tracks are `requiredLevel` L0/L1). No server enforcement is added — gating is display/UX only (tracks are content, not a write path).

---

## 6. Read-progress (localStorage, MVP)

- `src/lib/guideProgress.ts`: `markRead(creatorId, docId)`, `getRead(creatorId): Set<string>`, keyed `adfocate.guide.read.<creatorId>`. **`creatorId` is an explicit argument** sourced from the `me` query (`me.id`); if `me` hasn't resolved, callers no-op / skip rendering the progress strip (never write an `undefined`-namespaced key).
- Client-only for MVP (no migration); server-persisted/cross-device progress deferred (§9).

---

## 7. First-run walkthrough (primer in the onboarding step-1 slot)

The primer **occupies the existing, currently-unrendered `onboarding_step = 1` sentinel** — this avoids any step renumber, `award_welcome_bonus`/SQL change, or migration. Concretely in `src/routes/_app.onboarding.tsx`:

- **Seed floor `Math.max(2, …)` → `Math.max(1, …)`** (~L33) so a new creator (DB default step 1) lands on the **primer** instead of being forced to step 2.
- **Render a primer screen for `step === 1`**: a short scrollable card with (a) platform rules/expectations, (b) a plain-language "how levels & verification work" explainer (earn XP → verify a handle → unlock L2 Trusted KOC, referencing Slice 1), (c) a "逛逛學院" hand-off to `/guide`. Its "開始" button calls `saveProfile({ step: 2 })` and advances to the existing categories screen.
- **In-flight users** persisted at `step ≥ 2` skip the primer (by design — acceptable; they've already started). Users with `onboarding_completed = true` never see it. **No backfill needed.**
- **`completion_pct` is UNCHANGED:** the formula `round(((step-1)/4)*100)` already gives primer(step1)=0%, step5=100%. `award_welcome_bonus`'s `step = 5` completed-sentinel stays valid. The existing integration assertion "step 1 = 0% complete" still holds (the primer is 0% complete) — **verify** it still passes; update only if the test also asserts "step 1 not rendered".
- **ProgressBar:** with 5 rendered steps (1–5), set `<ProgressBar value={step - 1} max={4} />` so step 5 = 100% (the current `max={5}` never fills); keep `value`/`max` in lockstep with `completion_pct`. (Pre-existing `max={5}` was a display quirk; correcting it here is in-scope.)
- Primer copy via i18n keys (en + zh).

**Worked step → completion_pct oracle (the §8 test target):** step1(primer)=0%, step2=25%, step3=50%, step4=75%, step5=100%, completed=100%.

---

## 8. Testing

Frontend-only → fast gates (no integration/migration suite for the Academy itself; the onboarding change touches one existing server route + test).
- **Unit (gating):** `isTrackUnlocked` truth table (effective L1 vs required L0/L1/L2/L3); a guard test that every `academyTracks[i].requiredLevel` is a canonical `LEVELS` id.
- **Unit (markdown):** `<Markdown>` renders headings/lists and **sanitizes** (a `<script>`/`onerror` payload is stripped).
- **Unit (progress):** `guideProgress` mark/get round-trip + per-`creatorId` keying + undefined-creatorId no-op.
- **Component:** hub renders the 3 sections; a locked `AcademyTrackCard` shows the lock + unlock label and renders the teaser (not the body) on the detail route; an unlocked track renders its body; the doc route renders sanitized markdown.
- **Onboarding:** the primer renders at step 1; the "開始" button advances to step 2 (`saveProfile({step:2})`); a `completed` user does not see the primer; client `ProgressBar` value/max assertion; **server** `completion_pct` matches the §7 oracle table (update `server/test/onboarding.test.ts` to the new model if its assertions changed).
- **i18n parity:** new `app.guide.*` / `app.nav.guide` / primer keys present in both `en` and `zh`.
- Gates: `npm run type-check` (runs `tsr generate`), `lint`, unit.

---

## 9. Out of scope (deferred)

English content translations (One-Unification); server-persisted read-progress + cross-device sync; AI-personalized academy recommendations; a "replay walkthrough" entry from the Guide; gating playbooks/resources (only academy *tracks* gate this slice); search within the Academy; re-balancing the mobile bottom nav for 6 tabs.

---

## 10. File-level change map

**New**
- `src/routes/_app.guide.index.tsx`, `_app.guide.doc.$slug.tsx`, `_app.guide.track.$trackId.tsx`
- `src/components/Markdown.tsx`, `GuideDocList.tsx`, `PlaybookCard.tsx`, `AcademyTrackCard.tsx`
- `src/data/guideDocs.ts`, `src/data/academy.ts`
- `src/lib/academyGating.ts`, `src/lib/guideProgress.ts`
- tests alongside the above

**Modified**
- `src/components/navItems.ts` — append the Academy entry to `NAV_ITEMS`
- `src/routes/_app.onboarding.tsx` — seed floor `2→1`, primer step-1 screen, `ProgressBar` value/max
- `server/test/onboarding.test.ts` — verify/adjust to the §7 oracle (likely unchanged: step1 still 0%)
- `src/lib/i18n.dict.ts` — `app.guide.*`, `app.nav.guide`, primer keys (under `en` + `zh`)
- `src/data/mockData.ts` — playbooks/academy/resources moved to `academy.ts` + re-exported (or `_site` importers repointed); `academyTracks` gain `requiredLevel` + `teaserKey`/`description`; zh-HK copy
- `package.json` — add `react-markdown`, `rehype-sanitize`

> NOT changed: `server/routes/onboarding.ts` (`completion_pct` formula stays — primer reuses the step-1 slot); no migration; no `*.md?raw` declaration file (vite/client provides it).

---

## 11. Risks & open items

1. **Vite `?raw` markdown import** — relative import from `src/data/`; `vite/client` already types `*?raw` (no custom decl). A one-line spike confirms `tsc` + `vitest` resolution; fallback = copy docs into `src/content/`.
2. **Marketing-page coupling** — moving `playbooks`/`academyTracks`/`resources` out of `mockData` must not break `_site.playbooks.tsx`/`_site.creators.tsx`; re-export or repoint and keep their tests green.
3. **Onboarding primer in the step-1 slot** — verify the resumable seed change (`Math.max(1,…)`) lands new creators on the primer while in-flight `step≥2` users skip it; verify `completion_pct` + the existing onboarding integration test still pass (oracle in §7/§8).
4. **Mostly-locked hub for new users** — untrusted creators are capped at L1, so L2+ tracks are all locked; ensure L0/L1 tracks + docs make the first session rewarding (§5).
5. **Sanitization** — render via `rehype-sanitize`; test the XSS-strip path.
6. **zh-HK translations** — playbook/academy copy translation is content work bundled in this slice; finalize wording during implementation.

---

## 12. Acceptance criteria

- `/guide` renders a single-scroll hub with 快速指南 (markdown docs) + 攻略庫 + 創作者學院 sections; reachable from the nav (`NAV_ITEMS` entry).
- Reference docs open at `/guide/doc/$slug` as sanitized markdown; never gated.
- Academy tracks gate on `effective_level` via `isTrackUnlocked(requiredLevel, effective)`: a track above the creator's effective level shows locked (🔒 + "L{n} 解鎖") and its detail route renders the **teaser** (`title` + `teaserKey` + requirement), not the body; at/below shows full content. An unverified XP≥2000 creator sees L2+ tracks locked until verified. Every track's `requiredLevel` is a canonical `LEVELS` id.
- A first-run primer renders at onboarding step 1 for new creators, explains levels+verification, hands off to `/guide`, advances to step 2 on continue, and does not reappear once onboarding is complete; `completion_pct` matches the §7 oracle (step1=0% … step5=100%).
- Read-progress strip shows "X/Y 已讀" reflecting localStorage marks (keyed per `creatorId`); doc rows show "✓ 已讀" when read; new `app.guide.*` keys present in both locales.
- type-check, lint, and unit gates green. (No migration; no Academy integration suite required.)
