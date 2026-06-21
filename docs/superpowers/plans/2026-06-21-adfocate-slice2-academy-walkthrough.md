# Slice 2 — Creator Academy + First-Run Walkthrough — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-app Creator Academy (`/guide`) that renders the existing help docs (markdown) + playbooks/academy tracks (TS data) with level-gating, plus a first-run primer woven into onboarding — the education layer of the activation funnel.

**Architecture:** Frontend + content only — **no migration, no new backend route**. Markdown help docs are bundled via Vite `?raw`; playbook/academy data stays typed TS and gains a canonical `requiredLevel`; gating reuses Slice 1's `me.effective_level`. The first-run primer reuses the existing (currently unrendered) onboarding `step=1` sentinel slot, so there is no step renumber and no `award_welcome_bonus`/SQL change.

**Tech Stack:** TypeScript, React 19, TanStack Router/Query, Vite, Tailwind v4, Vitest (jsdom). New deps: `react-markdown`, `rehype-sanitize`.

**Source spec:** [`docs/superpowers/specs/2026-06-21-adfocate-slice2-academy-walkthrough-design.md`](../specs/2026-06-21-adfocate-slice2-academy-walkthrough-design.md)

**Branch:** continue on `feat/slice2-academy-walkthrough` (off Slice 1's branch, since gating needs `effective_level`). Do NOT commit to `main` or to `feat/slice1-ladder-verification`.

**Conventions to respect:**
- `npm run type-check` runs `tsr generate` first — use it, not bare `tsc`. (New TanStack routes only register after codegen.)
- New i18n strings go in BOTH `en` and `zh` blocks of `src/lib/i18n.dict.ts` (the parity test `src/lib/i18n.test.tsx` enforces it). Dict `Locale` is `'en' | 'zh'`.
- Default test locale is `zh`; component tests render under the i18n provider — match the existing test pattern (see `src/components/LevelChip.test.tsx` / `SocialTrustPanel.test.tsx`).
- This is frontend-only — do NOT add a migration or a server route.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Marketing `_site` pages keep their English copy this slice (same carve-out as Slice 1); only in-app Academy copy is zh-HK.

---

## File Structure

**New**
- `src/components/Markdown.tsx` — sanitized markdown renderer (react-markdown + rehype-sanitize).
- `src/data/guideDocs.ts` — typed index of help docs, bodies imported via `?raw`.
- `src/data/academy.ts` — playbooks/academyTracks/resources (moved from mockData), tracks gain `requiredLevel` + `teaserKey`/`description`.
- `src/lib/academyGating.ts` — `isTrackUnlocked`.
- `src/lib/guideProgress.ts` — localStorage read-progress (per creatorId).
- `src/components/GuideDocList.tsx`, `PlaybookCard.tsx`, `AcademyTrackCard.tsx` — presentational.
- `src/routes/_app.guide.index.tsx`, `_app.guide.doc.$slug.tsx`, `_app.guide.track.$trackId.tsx` — routes.
- tests alongside each (`*.test.ts(x)`).

**Modified**
- `src/data/mockData.ts` — move playbooks/academy/resources to `academy.ts`, re-export for `_site` consumers.
- `src/components/navItems.ts` — append Academy entry to `NAV_ITEMS`.
- `src/routes/_app.onboarding.tsx` — primer at step 1, seed floor 2→1, ProgressBar value/max.
- `server/test/onboarding.test.ts` — verify/adjust to the new step model (likely unchanged).
- `src/lib/i18n.dict.ts` — `app.guide.*`, `app.nav.guide`, primer keys (en + zh).
- `package.json` — add `react-markdown`, `rehype-sanitize`.

---

## Task 1: Markdown renderer component (sanitized)

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/components/Markdown.tsx`
- Test: `src/components/Markdown.test.tsx`

- [ ] **Step 1: Install deps**

Run: `cd adfocate-2 && npm install react-markdown rehype-sanitize`
Expected: both added to `dependencies`; lockfile updated.

- [ ] **Step 2: Write the failing test** — `src/components/Markdown.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings and lists", () => {
    render(<Markdown source={"# 標題\n\n- 一\n- 二"} />);
    expect(screen.getByRole("heading", { name: "標題" })).toBeInTheDocument();
    expect(screen.getByText("一")).toBeInTheDocument();
  });

  it("sanitizes dangerous html", () => {
    const { container } = render(<Markdown source={"安全<script>window.x=1</script><img src=x onerror=\"window.y=1\">"} />);
    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it, watch it fail**

Run: `cd adfocate-2 && npx vitest run src/components/Markdown.test.tsx`
Expected: FAIL — module `./Markdown` not found.

- [ ] **Step 4: Implement** `src/components/Markdown.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/** Renders first-party markdown, sanitized. Tailwind prose-ish styling via wrapper classes. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-heading [&_h1]:font-bold [&_h2]:font-heading [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{source}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Run tests** — `cd adfocate-2 && npx vitest run src/components/Markdown.test.tsx` → PASS. Then `npm run type-check` → PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/Markdown.tsx src/components/Markdown.test.tsx
git commit -m "feat(guide): sanitized Markdown renderer (react-markdown + rehype-sanitize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Guide-docs content index (`?raw` markdown import)

**Files:**
- Create: `src/data/guideDocs.ts`
- Test: `src/data/guideDocs.test.ts`

- [ ] **Step 1: Spike the import** — confirm a relative `?raw` import of a file under `content/` type-checks and resolves. Add to `guideDocs.ts` a single import and run `npm run type-check`. If `tsc` errors TS2307 (it should NOT — `vite/client` declares `*?raw`), create `src/md-raw.d.ts` with `declare module "*.md?raw" { const c: string; export default c; }` and re-run. Record which was needed.

- [ ] **Step 2: Write the failing test** — `src/data/guideDocs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { guideDocs } from "./guideDocs";

describe("guideDocs", () => {
  it("indexes all 8 help docs with non-empty markdown bodies", () => {
    const ids = guideDocs.map((d) => d.id).sort();
    expect(ids).toEqual(["account","leveling","missions","points","profile","redemption","submission","wallet"]);
    for (const d of guideDocs) {
      expect(d.body.length).toBeGreaterThan(0);
      expect(d.titleKey).toMatch(/^app\.guide\.doc\./);
    }
  });
});
```

- [ ] **Step 3: Run it, watch it fail** — `npx vitest run src/data/guideDocs.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/data/guideDocs.ts` — import each doc via relative `?raw` and build the typed index:

```ts
import account from "../../content/help/account.zh-HK.md?raw";
import leveling from "../../content/help/leveling.zh-HK.md?raw";
import missions from "../../content/help/missions.zh-HK.md?raw";
import points from "../../content/help/points.zh-HK.md?raw";
import profile from "../../content/help/profile.zh-HK.md?raw";
import redemption from "../../content/help/redemption.zh-HK.md?raw";
import submission from "../../content/help/submission.zh-HK.md?raw";
import wallet from "../../content/help/wallet.zh-HK.md?raw";

export type GuideCategory = "start" | "missions" | "rewards" | "account";
export type GuideDoc = { id: string; titleKey: string; category: GuideCategory; emoji: string; body: string };

export const guideDocs: GuideDoc[] = [
  { id: "account",    titleKey: "app.guide.doc.account",    category: "account",  emoji: "👤", body: account },
  { id: "leveling",   titleKey: "app.guide.doc.leveling",   category: "start",    emoji: "⭐", body: leveling },
  { id: "missions",   titleKey: "app.guide.doc.missions",   category: "missions", emoji: "🎯", body: missions },
  { id: "submission", titleKey: "app.guide.doc.submission", category: "missions", emoji: "📤", body: submission },
  { id: "points",     titleKey: "app.guide.doc.points",     category: "rewards",  emoji: "🪙", body: points },
  { id: "redemption", titleKey: "app.guide.doc.redemption", category: "rewards",  emoji: "🎁", body: redemption },
  { id: "wallet",     titleKey: "app.guide.doc.wallet",     category: "rewards",  emoji: "💰", body: wallet },
  { id: "profile",    titleKey: "app.guide.doc.profile",    category: "account",  emoji: "🪪", body: profile },
];
```

- [ ] **Step 5: Run tests + type-check** — `npx vitest run src/data/guideDocs.test.ts && npm run type-check` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/guideDocs.ts src/data/guideDocs.test.ts src/md-raw.d.ts 2>/dev/null; git add -A
git commit -m "feat(guide): typed help-doc index with ?raw markdown bodies

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Move playbooks/academy to `academy.ts` + add `requiredLevel`/`teaser`

**Files:**
- Create: `src/data/academy.ts`
- Modify: `src/data/mockData.ts` (move the three exports, re-export for `_site`)
- Test: `src/data/academy.test.ts`

- [ ] **Step 1: Read** `src/data/mockData.ts` around the `Playbook`/`AcademyTrack`/`Resource` types + `playbooks`/`academyTracks`/`resources` arrays (~L421–575), and the two importers `src/routes/_site.playbooks.tsx`, `_site.creators.tsx`, to preserve their consumed shape.

- [ ] **Step 2: Write the failing test** — `src/data/academy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { academyTracks } from "./academy";
import { levelIndex, LEVELS } from "@/lib/levels";

const IDS = new Set(LEVELS.map((l) => l.id));

describe("academyTracks", () => {
  it("every track has a canonical requiredLevel id and a teaserKey", () => {
    expect(academyTracks.length).toBeGreaterThan(0);
    for (const t of academyTracks) {
      expect(IDS.has(t.requiredLevel)).toBe(true);              // never a range like "L2+"
      expect(levelIndex(t.requiredLevel)).toBe(LEVELS.findIndex((l) => l.id === t.requiredLevel));
      expect(typeof t.teaserKey).toBe("string");
    }
  });
});
```

- [ ] **Step 3: Run it, watch it fail** — `npx vitest run src/data/academy.test.ts` → FAIL (module not found).

- [ ] **Step 4: Create `src/data/academy.ts`** — move the `Playbook`/`AcademyTrack`/`Resource` types + arrays here from `mockData.ts`. Extend `AcademyTrack` with `requiredLevel: string` (canonical id derived from the old display `level`: `"L0–L1"→"L0"`, `"L1+"→"L1"`, `"L2+"→"L2"`, `"L3+"→"L3"`, `"L4+"→"L4"`; keep the old `level` field for the display label) and `teaserKey: string` + a short `description` (zh-HK). Ensure at least two tracks are `requiredLevel` L0/L1 so a new untrusted creator has unlocked content. Translate `title`/`description` to zh-HK.

```ts
// shape (illustrative — port the real 9 tracks):
export type AcademyTrack = {
  id: string; title: string; level: string;        // display label, e.g. "L2+"
  requiredLevel: string;                            // canonical gate id, e.g. "L2"
  duration: string; color: string; emoji: string;
  description: string;                              // zh-HK, shown on the card + detail
  teaserKey: string;                                // i18n key for the locked teaser
};
```

- [ ] **Step 5: Re-export from `mockData.ts`** so `_site.playbooks.tsx`/`_site.creators.tsx` keep working without edits:

```ts
export { playbooks, academyTracks, resources } from "./academy";
export type { Playbook, AcademyTrack, Resource } from "./academy";
```
Remove the original definitions from `mockData.ts` (leave the re-export). Confirm no duplicate-symbol error.

- [ ] **Step 6: Run tests + gates** — `npx vitest run src/data/academy.test.ts src/routes/_site.smoke.test.tsx && npm run type-check && grep -rn "academyTracks\|playbooks" src/routes/_site.creators.tsx src/routes/_site.playbooks.tsx` → academy test PASS, smoke PASS, `_site` still imports fine.

- [ ] **Step 7: Commit**

```bash
git add src/data/academy.ts src/data/academy.test.ts src/data/mockData.ts
git commit -m "feat(guide): academy content module + per-track requiredLevel/teaser (zh-HK)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Gating helper

**Files:**
- Create: `src/lib/academyGating.ts`
- Test: `src/lib/academyGating.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/academyGating.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isTrackUnlocked } from "./academyGating";

describe("isTrackUnlocked", () => {
  it("unlocks when effective level >= required", () => {
    expect(isTrackUnlocked("L0", "L1")).toBe(true);
    expect(isTrackUnlocked("L1", "L1")).toBe(true);
    expect(isTrackUnlocked("L2", "L1")).toBe(false);   // untrusted capped at L1
    expect(isTrackUnlocked("L3", "L5")).toBe(true);
  });
  it("treats missing effective level as L0", () => {
    expect(isTrackUnlocked("L0", undefined)).toBe(true);
    expect(isTrackUnlocked("L2", undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `npx vitest run src/lib/academyGating.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/lib/academyGating.ts`:

```ts
import { levelIndex } from "./levels";

/** A track is unlocked when the creator's EFFECTIVE level reaches its requiredLevel.
 *  requiredLevel must be a canonical LEVELS id (not a display range). */
export function isTrackUnlocked(requiredLevel: string, effectiveLevel: string | undefined | null): boolean {
  return levelIndex(effectiveLevel ?? "L0") >= levelIndex(requiredLevel);
}
```

- [ ] **Step 4: Run tests + type-check** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/academyGating.ts src/lib/academyGating.test.ts
git commit -m "feat(guide): isTrackUnlocked gating helper (effective_level)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Read-progress (localStorage)

**Files:**
- Create: `src/lib/guideProgress.ts`
- Test: `src/lib/guideProgress.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/guideProgress.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { markRead, getRead } from "./guideProgress";

beforeEach(() => localStorage.clear());

describe("guideProgress", () => {
  it("records and reads per-creator", () => {
    markRead("c1", "leveling");
    markRead("c1", "missions");
    expect([...getRead("c1")].sort()).toEqual(["leveling", "missions"]);
    expect(getRead("c2").size).toBe(0);              // namespaced by creator
  });
  it("no-ops without a creatorId", () => {
    markRead(undefined, "leveling");
    expect(getRead(undefined).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** → FAIL.

- [ ] **Step 3: Implement** `src/lib/guideProgress.ts`:

```ts
const key = (creatorId: string) => `adfocate.guide.read.${creatorId}`;

export function getRead(creatorId: string | undefined | null): Set<string> {
  if (!creatorId) return new Set();
  try {
    const raw = localStorage.getItem(key(creatorId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markRead(creatorId: string | undefined | null, docId: string): void {
  if (!creatorId) return;
  const set = getRead(creatorId);
  set.add(docId);
  try { localStorage.setItem(key(creatorId), JSON.stringify([...set])); } catch { /* quota — ignore */ }
}
```

- [ ] **Step 4: Run tests + type-check** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/guideProgress.ts src/lib/guideProgress.test.ts
git commit -m "feat(guide): per-creator read-progress in localStorage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: i18n keys (Academy chrome + doc titles + primer)

**Files:**
- Modify: `src/lib/i18n.dict.ts` (en + zh)
- Test: `src/lib/i18n.test.tsx` (existing parity test must pass)

- [ ] **Step 1: Add keys in BOTH `en` and `zh`** — match the file's existing key-string style. Keys:
  - `app.nav.guide` (en "Academy" / zh "學院")
  - `app.guide.title`, `app.guide.sectionGuides`, `app.guide.sectionPlaybooks`, `app.guide.sectionAcademy`, `app.guide.read`, `app.guide.progress` (param `{done}`/`{total}`), `app.guide.unlockAt` (param `{level}`), `app.guide.locked`, `app.guide.back`
  - `app.guide.doc.account|leveling|missions|submission|points|redemption|wallet|profile` (titles)
  - track teaser keys referenced by `academyTracks[i].teaserKey` (e.g. `app.guide.teaser.<trackId>`)
  - primer: `app.onboarding.primerTitle`, `app.onboarding.primerBody`, `app.onboarding.primerLadder`, `app.onboarding.primerCta` (start), `app.onboarding.primerVisitGuide`

- [ ] **Step 2: Run parity test** — `cd adfocate-2 && npx vitest run src/lib/i18n.test.tsx` → PASS (en/zh key sets identical).

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "i18n(guide): Academy + primer keys (en + zh)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Presentational sub-components

**Files:**
- Create: `src/components/GuideDocList.tsx`, `PlaybookCard.tsx`, `AcademyTrackCard.tsx`
- Test: `src/components/AcademyTrackCard.test.tsx`

- [ ] **Step 1: Write the failing test** (the gated card is the one with logic) — `src/components/AcademyTrackCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AcademyTrackCard } from "./AcademyTrackCard";

const track = { id: "a3", title: "直播帶貨", level: "L2+", requiredLevel: "L2", duration: "20 min", color: "yellow", emoji: "📈", description: "x", teaserKey: "app.guide.teaser.a3" };

function renderCard(effective: string) {
  return render(<I18nProvider><AcademyTrackCard track={track} effectiveLevel={effective} /></I18nProvider>);
}

describe("AcademyTrackCard", () => {
  it("shows a lock + unlock label when above effective level", () => {
    renderCard("L1");
    expect(screen.getByText(/🔒|解鎖/)).toBeInTheDocument();
  });
  it("is an active link when unlocked", () => {
    const { container } = renderCard("L3");
    expect(container.querySelector('a[href="/guide/track/a3"]')).not.toBeNull();
  });
});
```

> Confirm the `I18nProvider` import path/usage against an existing test (e.g. `SocialTrustPanel.test.tsx`); adapt if the provider is named/used differently.

- [ ] **Step 2: Run it, watch it fail** → FAIL.

- [ ] **Step 3: Implement the three components.** `AcademyTrackCard` uses `isTrackUnlocked(track.requiredLevel, effectiveLevel)`: unlocked → `<Link to="/guide/track/$trackId">` with emoji/title/duration; locked → greyed, non-link, 🔒 + `t("app.guide.unlockAt", { level: t(LEVELS[levelIndex(track.requiredLevel)].labelKey) })`. `GuideDocList` renders `guideDocs` grouped by category, each row `<Link to="/guide/doc/$slug">` + a "✓" when `getRead(creatorId).has(doc.id)`. `PlaybookCard` renders a playbook/resource card. Keep each focused; match existing card styling (`pastel-card`, borders).

- [ ] **Step 4: Run tests + type-check** — `npx vitest run src/components/AcademyTrackCard.test.tsx && npm run type-check` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/GuideDocList.tsx src/components/PlaybookCard.tsx src/components/AcademyTrackCard.tsx src/components/AcademyTrackCard.test.tsx
git commit -m "feat(guide): GuideDocList + PlaybookCard + gated AcademyTrackCard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Hub route `/guide`

**Files:**
- Create: `src/routes/_app.guide.index.tsx`
- Test: `src/routes/-_app.guide.index.test.tsx`

- [ ] **Step 1: Read** an existing `_app.*` route (e.g. `_app.match.tsx`) for the `createFileRoute` pattern, `useMe()` usage, and the page header/scroll-container styling.

- [ ] **Step 2: Write the failing test** — `src/routes/-_app.guide.index.test.tsx` (mirror an existing route test's mocks for `useMe`/i18n; the file is `-`-prefixed so it is excluded from the route tree). Assert the three section headings render and a known doc title appears.

- [ ] **Step 3: Run it, watch it fail** → FAIL.

- [ ] **Step 4: Implement** `src/routes/_app.guide.index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { guideDocs } from "@/data/guideDocs";
import { playbooks, resources, academyTracks } from "@/data/academy";
import { GuideDocList } from "@/components/GuideDocList";
import { PlaybookCard } from "@/components/PlaybookCard";
import { AcademyTrackCard } from "@/components/AcademyTrackCard";
import { getRead } from "@/lib/guideProgress";

export const Route = createFileRoute("/_app/guide/")({ component: GuideHub });

function GuideHub() {
  const me = useMe();
  const { t } = useI18n();
  const effective = me.data?.effective_level ?? me.data?.level;
  const creatorId = me.data?.id;
  const readCount = creatorId ? guideDocs.filter((d) => getRead(creatorId).has(d.id)).length : 0;
  return (
    <div className="mx-auto max-w-lg p-4 lg:max-w-5xl space-y-6">
      <h1 className="font-display text-xl font-bold">{t("app.guide.title")}</h1>
      <section className="space-y-2">
        <h2 className="font-heading font-bold">{t("app.guide.sectionGuides")}</h2>
        <GuideDocList creatorId={creatorId} />
      </section>
      <section className="space-y-2">
        <h2 className="font-heading font-bold">{t("app.guide.sectionPlaybooks")}</h2>
        <div className="grid grid-cols-2 gap-3">{[...playbooks, ...resources].map((p) => <PlaybookCard key={p.id} item={p} />)}</div>
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold">{t("app.guide.sectionAcademy")}</h2>
          {creatorId && <span className="text-xs text-[var(--color-soft-ink)]">{t("app.guide.progress", { done: readCount, total: guideDocs.length })}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">{academyTracks.map((tr) => <AcademyTrackCard key={tr.id} track={tr} effectiveLevel={effective} />)}</div>
      </section>
    </div>
  );
}
```
> Adjust `PlaybookCard` props to the real `Playbook`/`Resource` shapes. After creating routes, run `npm run type-check` (it runs `tsr generate`) so the route tree picks them up.

- [ ] **Step 5: Run tests + type-check** → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app.guide.index.tsx "src/routes/-_app.guide.index.test.tsx"
git commit -m "feat(guide): /guide hub (single-scroll, gated academy section)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Doc + Track detail routes

**Files:**
- Create: `src/routes/_app.guide.doc.$slug.tsx`, `src/routes/_app.guide.track.$trackId.tsx`
- Test: `src/routes/-_app.guide.track.$trackId.test.tsx`

- [ ] **Step 1: Write the failing test** — `-_app.guide.track.$trackId.test.tsx`: for a locked track (effective L1, required L2) assert the teaser copy renders and the body/description does NOT; for unlocked assert the description renders. Mirror an existing param-route test's `useParams`/`useMe` mock pattern (see `-_app.mission.$missionSlug.test.tsx`).

- [ ] **Step 2: Run it, watch it fail** → FAIL.

- [ ] **Step 3: Implement** both routes.
  - `_app.guide.doc.$slug.tsx`: look up `guideDocs.find(d => d.id === slug)`; render `<Markdown source={doc.body} />` + a back link; on mount call `markRead(me.id, slug)`. 404-ish fallback if not found.
  - `_app.guide.track.$trackId.tsx`: look up the track; compute `unlocked = isTrackUnlocked(track.requiredLevel, me.effective_level ?? me.level)`. Unlocked → render `description`/body; locked → render the teaser (`t(track.teaserKey)` + `t("app.guide.unlockAt", {level})`), NOT the body.

- [ ] **Step 4: Run tests + type-check** → PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/_app.guide.doc.\$slug.tsx" "src/routes/_app.guide.track.\$trackId.tsx" "src/routes/-_app.guide.track.\$trackId.test.tsx"
git commit -m "feat(guide): doc (markdown) + gated track detail routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Academy nav entry

**Files:**
- Modify: `src/components/navItems.ts`

- [ ] **Step 1: Read** `src/components/navItems.ts` for the `NavItem` shape + how icons are imported (lucide-react).

- [ ] **Step 2: Append** to `NAV_ITEMS`: `{ to: "/guide", labelKey: "app.nav.guide", icon: <BookOpen size={...} />, exact: false }` (match the existing entries' icon style/size). This is the 6th tab — acceptable on the mobile `BottomNav` (`flex-1`).

- [ ] **Step 3: Gate** — `cd adfocate-2 && npm run type-check && npm run lint && npx vitest run src/components` → PASS. Manually confirm (or via an existing nav test) the Academy entry appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/navItems.ts
git commit -m "feat(guide): Academy entry in shared nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: First-run primer in the onboarding step-1 slot

**Files:**
- Modify: `src/routes/_app.onboarding.tsx`
- Verify/Modify: `server/test/onboarding.test.ts`
- Test: `src/routes/-_app.onboarding.test.tsx` (existing; extend)

- [ ] **Step 1: Read** `src/routes/_app.onboarding.tsx` fully — the `step` state seed (~L33 `Math.max(2, …)`), the per-step render switch, the `saveProfile`/advance mechanism, and `<ProgressBar value={step-1} max={5} />` (~L79). Read `server/routes/onboarding.ts` (`completion_pct`) and `server/test/onboarding.test.ts:28–35`.

- [ ] **Step 2: Write/extend the failing client test** — in `src/routes/-_app.onboarding.test.tsx`, add: a fresh creator (status `onboarding_step: 1`, not completed) renders the **primer** (assert `t("app.onboarding.primerTitle")` text); clicking the primer CTA calls the save mutation with `{ step: 2 }`; a creator at `onboarding_step: 3` does NOT see the primer. Mirror the file's existing mock setup.

- [ ] **Step 3: Run it, watch it fail** → FAIL (no primer rendered).

- [ ] **Step 4: Implement:**
  - Change the seed floor `Math.max(2, …)` → `Math.max(1, …)` so step 1 is reachable.
  - Add a `step === 1` branch rendering the primer card: `app.onboarding.primerTitle` + `primerBody` + `primerLadder` (levels/verification explainer) + a "逛逛學院" link to `/guide` + a primary CTA (`primerCta`) that calls the existing advance/save with `step: 2`.
  - Update `<ProgressBar value={step - 1} max={4} />` so step 5 = 100% (5 rendered steps; advances = 4). Keep value/max consistent with server `completion_pct`.
  - Do NOT change `server/routes/onboarding.ts` (the `(step-1)/4` formula already yields primer=0%…step5=100%) and do NOT touch `award_welcome_bonus` (step=5 stays the completed sentinel).

- [ ] **Step 5: Verify the server test** — `cd adfocate-2 && set -a && source .env.test.local && set +a && npx vitest run server/test/onboarding.test.ts` (needs the local stack). Expected: still PASS ("step 1 = 0%" holds — the primer is 0% complete). If it asserts "step 1 is not rendered" or similar, update that assertion to the new model; otherwise leave it. If the local stack is down, note it and rely on the client test + the unchanged server formula.

- [ ] **Step 6: Run gates** — `npm run type-check && npm run lint && npx vitest run src/routes/-_app.onboarding.test.tsx` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_app.onboarding.tsx "src/routes/-_app.onboarding.test.tsx" server/test/onboarding.test.ts
git commit -m "feat(onboarding): first-run primer in the step-1 slot (no renumber/migration)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `cd adfocate-2 && npm run type-check && npm run lint && npx vitest run` — all green (unit). If the local Supabase stack is up, also `set -a && source .env.test.local && set +a && npm run test:integration` to confirm the onboarding route test.
- [ ] `grep -rn "src/lib/navItems" src/` → no stale references (nav lives in `src/components/navItems.ts`).
- [ ] Manual smoke (`npm run dev`): `/guide` reachable from the nav; help docs render as sanitized markdown; an untrusted creator sees L2+ tracks locked with "L2 解鎖"; a new creator's onboarding opens on the primer and advances to categories.
- [ ] Dispatch a final code review before opening the PR.

## Out of scope (deferred — see spec §9)
English content translations; server-persisted read-progress; AI-personalized recommendations; replay-walkthrough; gating playbooks/resources; Academy search; mobile bottom-nav rebalance for 6 tabs.
