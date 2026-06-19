# Profile + Passport Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-duplicate `/profile` and `/passport`, add a responsive two-column desktop layout, and group Profile's social sections — frontend-only, in the existing neo-brutalist style.

**Architecture:** Extract the copy-pasted identity/level markup into three small presentational components (`IdentityHeader`, `LevelProgress`, `LevelChip`), then rebuild the two routes around them: Passport = hero + two-column showcase; Profile = identity strip + two-column manage view. The full level/XP block lives only on Passport; Profile shows a `LevelChip` linking to it. No backend, query, or schema changes.

**Tech Stack:** React 19, TanStack Router, Tailwind v4 (CSS vars), Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-06-19-profile-passport-reorg-design.md`. Branch: `feat/profile-passport-reorg`.

---

## File structure

- `src/components/LevelProgress.tsx` (new) — level emoji/label + XP + progress bar + next-level hint, derived from `xp`. Used in the Passport hero. Replaces the inline block duplicated in both routes.
- `src/components/LevelChip.tsx` (new) — compact pill linking to `/passport`. Used in the Profile identity strip.
- `src/components/IdentityHeader.tsx` (new) — avatar (image/initial) + name + `children` slot + optional `actions` slot. Used by both routes.
- `src/components/LevelProgress.test.tsx`, `LevelChip.test.tsx`, `IdentityHeader.test.tsx` (new) — component unit tests.
- `src/routes/_app.passport.tsx` (modify) — hero + two-column layout.
- `src/routes/_app.profile.tsx` (modify) — identity strip + two-column layout + grouped social section.
- `src/routes/-_app.passport.test.tsx`, `src/routes/-_app.profile.test.tsx` (modify) — updated route tests. (Route tests use the leading `-` so TanStack ignores them as routes.)

**Conventions to follow:** brand CSS vars (`--color-ink`, `--color-acid`, `--color-magenta`, `--color-soft-ink`), card style `border-2 border-[var(--color-ink)] ... shadow-[4px_4px_0_0_var(--color-ink)]`, `font-heading`/`font-display`. Component tests are `<Name>.test.tsx` (no `-` prefix). Each task ends with a commit.

---

## Task 1: LevelProgress component

**Files:**
- Create: `src/components/LevelProgress.tsx`
- Test: `src/components/LevelProgress.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/LevelProgress.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelProgress } from "./LevelProgress";

describe("LevelProgress", () => {
  it("shows current level, XP and the next-level hint", () => {
    render(<LevelProgress xp={600} />); // L1 Explorer (>=500), next L2 Creator (2000)
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText(/600 XP/)).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 Creator")).toBeInTheDocument();
  });

  it("shows the max-level state at L6", () => {
    render(<LevelProgress xp={100000} />); // L6 Elite, no next
    expect(screen.getByText("最高等級")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/LevelProgress.test.tsx`
Expected: FAIL — cannot resolve `./LevelProgress`.

- [ ] **Step 3: Write the component**

```tsx
// src/components/LevelProgress.tsx
import { progressToNext } from "@/lib/levels";

/** Level emoji + label, XP, progress bar and the "next level" hint, derived from xp.
 *  De-duplicates the block previously inlined in both /profile and /passport. */
export function LevelProgress({ xp }: { xp: number }) {
  const p = progressToNext(xp);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>
          {p.current.emoji}
        </span>
        <span className="font-heading font-bold">{p.current.label}</span>
        <span className="ml-auto text-sm text-[var(--color-soft-ink)]">{xp} XP</span>
      </div>
      {p.next ? (
        <>
          <div className="h-3 overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white">
            <div className="h-full bg-[var(--color-acid)]" style={{ width: `${p.pct}%` }} />
          </div>
          <p className="text-sm text-[var(--color-soft-ink)]">
            還需 {p.xpForNext! - p.xpIntoCurrent} XP 升至 {p.next.label}
          </p>
          <p className="text-xs text-[var(--color-soft-ink)]">解鎖：{p.next.unlock}</p>
        </>
      ) : (
        <p className="text-sm font-heading font-bold">最高等級</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/LevelProgress.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/LevelProgress.tsx src/components/LevelProgress.test.tsx
git commit -m "feat: add LevelProgress component (de-dups inline level block)"
```

---

## Task 2: LevelChip component

**Files:**
- Create: `src/components/LevelChip.tsx`
- Test: `src/components/LevelChip.test.tsx`

- [ ] **Step 1: Write the failing test**

`LevelChip` uses TanStack `<Link>`, which needs router context — mock it to a plain anchor (same pattern as the profile route test).

```tsx
// src/components/LevelChip.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { LevelChip } from "./LevelChip";

describe("LevelChip", () => {
  it("shows the current level label and links to /passport", () => {
    render(<LevelChip xp={600} />); // L1 Explorer
    const link = screen.getByText(/Explorer/).closest("a");
    expect(link).toHaveAttribute("href", "/passport");
    expect(screen.getByText(/看護照/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/LevelChip.test.tsx`
Expected: FAIL — cannot resolve `./LevelChip`.

- [ ] **Step 3: Write the component**

```tsx
// src/components/LevelChip.tsx
import { Link } from "@tanstack/react-router";
import { progressToNext } from "@/lib/levels";

/** Compact level pill for the Profile page that links to the full Passport. */
export function LevelChip({ xp }: { xp: number }) {
  const { current } = progressToNext(xp);
  return (
    <Link
      to="/passport"
      className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
    >
      <span aria-hidden>{current.emoji}</span>
      <span>{current.label}</span>
      <span>· 看護照 →</span>
    </Link>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/LevelChip.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/LevelChip.tsx src/components/LevelChip.test.tsx
git commit -m "feat: add LevelChip component (compact level pill linking to passport)"
```

---

## Task 3: IdentityHeader component

**Files:**
- Create: `src/components/IdentityHeader.tsx`
- Test: `src/components/IdentityHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/IdentityHeader.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityHeader } from "./IdentityHeader";

describe("IdentityHeader", () => {
  it("renders the name, the initial fallback, and children", () => {
    render(
      <IdentityHeader name="阿明" avatarUrl={null}>
        <span>child-slot</span>
      </IdentityHeader>,
    );
    expect(screen.getByRole("heading", { name: "阿明" })).toBeInTheDocument();
    expect(screen.getByText("阿")).toBeInTheDocument();
    expect(screen.getByText("child-slot")).toBeInTheDocument();
  });

  it("renders an avatar image and the actions slot when provided", () => {
    const { container } = render(
      <IdentityHeader name="阿明" avatarUrl="https://x/a.png" actions={<button>編輯</button>} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://x/a.png");
    expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/IdentityHeader.test.tsx`
Expected: FAIL — cannot resolve `./IdentityHeader`.

- [ ] **Step 3: Write the component**

```tsx
// src/components/IdentityHeader.tsx
import type { ReactNode } from "react";

/** Avatar (image or initial) + display name, with a children slot (level block / chip)
 *  and an optional right-aligned actions slot (edit / sign-out). Shared by both pages. */
export function IdentityHeader({
  name,
  avatarUrl,
  children,
  actions,
}: {
  name: string;
  avatarUrl?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const initial = (name?.[0] ?? "?").toUpperCase();
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="truncate font-display text-2xl font-bold">{name}</h1>
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-col gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/IdentityHeader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/IdentityHeader.tsx src/components/IdentityHeader.test.tsx
git commit -m "feat: add IdentityHeader component (shared avatar+name+slots)"
```

---

## Task 4: Rebuild the Passport page (hero + two-column)

**Files:**
- Modify: `src/routes/_app.passport.tsx`
- Modify: `src/routes/-_app.passport.test.tsx`

- [ ] **Step 1: Add a hero assertion to the passport test**

Add this test inside the existing `describe("Passport page", ...)` block in `src/routes/-_app.passport.test.tsx` (the mock `me.data.display_name` is `"阿明"`, `passport.data.xp` is `600`):

```tsx
  it("renders the identity hero with name and level progress", () => {
    renderPassport();
    expect(screen.getByRole("heading", { name: "阿明" })).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 Creator")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the passport test to verify the new test fails**

Run: `npx vitest run src/routes/-_app.passport.test.tsx`
Expected: FAIL on "renders the identity hero…" — `Explorer` / hint not present yet (old hero shows `L1 · 600 XP` inline, no progress hint). Other tests still pass.

- [ ] **Step 3: Rewrite the passport route**

Replace the entire contents of `src/routes/_app.passport.tsx` with:

```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { IdentityHeader } from "@/components/IdentityHeader";
import { LevelProgress } from "@/components/LevelProgress";
import { PassportTrustSummary } from "@/components/PassportTrustSummary";
import { ScoreRing } from "@/components/ScoreRing";
import { useCreatePassportShare, useMe, useMyPassport, useRevokePassportShare } from "@/lib/queries/kocmax";
import { SCORE_META, SCORE_ORDER, BADGES } from "@/lib/passport";

export const Route = createFileRoute("/_app/passport")({ component: Passport });

const CARD = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]";
const FLAT = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4";

function Passport() {
  const me = useMe();
  const passport = useMyPassport();
  const share = useCreatePassportShare();
  const revoke = useRevokePassportShare();
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  if (passport.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const p = passport.data;
  const name = me.data?.display_name ?? "KOC";

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <section className={`${CARD} p-5`}>
        <IdentityHeader name={name} avatarUrl={me.data?.avatar_url}>
          <LevelProgress xp={p.xp} />
        </IdentityHeader>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-heading font-bold">創作者評分</h2>
            <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${CARD}`}>
              {SCORE_ORDER.map((k) => (
                <div key={k} className="flex flex-col items-center gap-1">
                  <ScoreRing value={p.scores[k]} label={SCORE_META[k].label} accent={SCORE_META[k].accent} />
                  {SCORE_META[k].note && (
                    <p className="text-center text-[10px] leading-tight text-[var(--color-soft-ink)]">
                      {SCORE_META[k].note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold">徽章</h2>
            {p.badges.length ? (
              <div className="grid grid-cols-2 gap-3">
                {p.badges.map((id) => {
                  const b = BADGES[id];
                  if (!b) return null;
                  return (
                    <div key={id} className={`flex items-center gap-2 ${FLAT}`}>
                      <span className="text-2xl" aria-hidden>
                        {b.emoji}
                      </span>
                      <div className="min-w-0">
                        <p className="font-heading text-sm font-bold">{b.label}</p>
                        <p className="truncate text-xs text-[var(--color-soft-ink)]">{b.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">完成任務與連結社交帳號即可解鎖徽章。</p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <PassportTrustSummary socialTrust={p.socialTrust} />

          <section className={`space-y-3 ${CARD}`}>
            <h2 className="font-heading font-bold">Public passport</h2>
            {shareUrl && <p className="break-all text-sm text-[var(--color-soft-ink)]">{shareUrl}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const result = await share.mutateAsync();
                  setShareUrl(result.publicUrl);
                  await globalThis.navigator?.clipboard?.writeText?.(result.publicUrl);
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
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the passport test to verify all tests pass**

Run: `npx vitest run src/routes/-_app.passport.test.tsx`
Expected: PASS (all tests incl. the new hero test, scores, badges, trust summary, share link).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.passport.tsx src/routes/-_app.passport.test.tsx
git commit -m "feat: rebuild passport page as hero + two-column showcase"
```

---

## Task 5: Rebuild the Profile page (identity strip + two-column + grouped social)

**Files:**
- Modify: `src/routes/_app.profile.tsx`
- Modify: `src/routes/-_app.profile.test.tsx`

- [ ] **Step 1: Update the profile test for the new structure**

In `src/routes/-_app.profile.test.tsx`, make these edits:

(a) In the `"renders name, level, categories and referral code"` test, the full level/progress block is no longer on Profile (it moved to Passport — Profile now shows a `LevelChip`). Replace the line:

```tsx
    expect(screen.getByText("還需 1400 XP 升至 Creator")).toBeInTheDocument();
```

with the chip assertion (the chip shows the level label and a "看護照" link):

```tsx
    expect(screen.getByText(/看護照/).closest("a")).toHaveAttribute("href", "/passport");
```

(`expect(screen.getByText("Explorer"))` stays — the chip still renders the level label.)

(b) Replace the `"links to the creator passport"` test body (the old `創作者護照` quick-link is removed; the chip is now the passport link):

```tsx
  it("links to the creator passport via the level chip", () => {
    renderProfile();
    expect(screen.getByText(/看護照/).closest("a")).toHaveAttribute("href", "/passport");
  });
```

- [ ] **Step 2: Run the profile test to verify it fails**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: FAIL — `看護照` not present yet (Profile still renders the old full level block / `創作者護照` link).

- [ ] **Step 3: Rewrite the profile route**

Replace the entire contents of `src/routes/_app.profile.tsx` with:

```tsx
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CreatorProfileMediaPanel } from "@/components/CreatorProfileMediaPanel";
import { FilterPillsMulti } from "@/components/FilterPills";
import { IdentityHeader } from "@/components/IdentityHeader";
import { LevelChip } from "@/components/LevelChip";
import { SocialTrustPanel } from "@/components/SocialTrustPanel";
import { useMe, useUpdateProfile, type SocialHandle } from "@/lib/queries/kocmax";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_app/profile")({ component: Profile });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;
const CARD = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]";

function Profile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const update = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function startEdit() {
    const d = me.data;
    setDisplayName(d?.display_name ?? "");
    setCategories(d?.categories ?? []);
    const seeded: Record<string, string> = {};
    for (const s of d?.social_handles ?? []) seeded[s.platform] = s.handle;
    setHandles(seeded);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const existing = me.data?.social_handles ?? [];
    const social_handles: SocialHandle[] = PLATFORMS.flatMap((p) => {
      const handle = (handles[p] ?? "").trim();
      if (!handle) return [];
      const prev = existing.find((s) => s.platform === p);
      return [{ platform: p, handle, followers: prev?.followers ?? null, verified: prev?.verified ?? false }];
    });
    try {
      await update.mutateAsync({ display_name: displayName.trim() || undefined, categories, social_handles });
      setEditing(false);
    } catch {
      setError("儲存失敗，請重試");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    qc.clear();
    navigate({ to: "/login" });
  }

  async function copyReferral() {
    const code = me.data?.referral_code;
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const d = me.data;

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <section className={`${CARD} p-5`}>
        <IdentityHeader
          name={d.display_name ?? "KOC"}
          avatarUrl={d.avatar_url}
          actions={
            !editing && (
              <>
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-1.5 text-sm font-heading font-bold"
                >
                  編輯
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-1.5 text-sm font-heading font-bold text-[var(--color-magenta)]"
                >
                  登出
                </button>
              </>
            )
          }
        >
          <LevelChip xp={d.xp} />
        </IdentityHeader>
      </section>

      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {!editing ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="font-heading font-bold">內容範疇</h2>
              {d.categories?.length ? (
                <div className="flex flex-wrap gap-2">
                  {d.categories.map((c) => (
                    <span key={c} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm">
                      {c}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-heading font-bold">社交帳號</h2>
              {d.social_handles?.length ? (
                <ul className="space-y-1">
                  {d.social_handles.map((s) => (
                    <li
                      key={s.platform}
                      className="flex items-center justify-between rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-heading font-semibold">{s.platform}</span>
                      <span className="text-[var(--color-soft-ink)]">{s.handle}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--color-soft-ink)]">尚未設定</p>
              )}
              <SocialTrustPanel />
            </section>
          </div>

          <div className="space-y-6">
            <CreatorProfileMediaPanel />

            <section className={`space-y-2 ${CARD}`}>
              <h2 className="font-heading font-bold">我的邀請碼</h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold tracking-widest">{d.referral_code ?? "—"}</span>
                <button
                  type="button"
                  onClick={copyReferral}
                  disabled={!d.referral_code}
                  aria-label="複製邀請碼"
                  className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
                >
                  {copied ? "已複製" : "複製"}
                </button>
              </div>
              <p className="text-sm text-[var(--color-soft-ink)]">邀請朋友，各得 200 分</p>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Link
                to="/my"
                className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
              >
                我的任務
              </Link>
              <Link
                to="/redemption/history"
                className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
              >
                兌換記錄
              </Link>
            </section>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-lg space-y-6">
          <section className="space-y-2">
            <h2 className="font-heading font-bold">顯示名稱</h2>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-label="顯示名稱"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">內容範疇</h2>
            <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">社交帳號</h2>
            <div className="space-y-2">
              {PLATFORMS.map((p) => (
                <input
                  key={p}
                  value={handles[p] ?? ""}
                  onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                  placeholder={`${p} 帳號`}
                  aria-label={`${p} 帳號`}
                  className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
                />
              ))}
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
            >
              {update.isPending ? "儲存中…" : "儲存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the profile test to verify all tests pass**

Run: `npx vitest run src/routes/-_app.profile.test.tsx`
Expected: PASS — name/level-chip/categories/referral render; edit reveals inputs; save calls `useUpdateProfile`; chip links to `/passport`; sign-out navigates to `/login`; save-failure stays in edit mode.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app.profile.tsx src/routes/-_app.profile.test.tsx
git commit -m "feat: rebuild profile page as identity strip + two-column manage view"
```

---

## Task 6: Full verification

**Files:** none (gates only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: PASS — all suites, including the three new component tests and both updated route tests.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS (no type errors). If `tsr generate` rewrites `src/routeTree.gen.ts`, that's expected codegen — do not hand-edit it.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no errors).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS — `check:esm` passes (frontend `src/` only, no server import change), `tsc --noEmit` clean, Vite build succeeds.

- [ ] **Step 5: Commit any codegen + open the PR**

```bash
git add -A
git commit -m "chore: profile+passport reorg — verification (codegen, if any)" || echo "nothing to commit"
git push -u origin feat/profile-passport-reorg
gh pr create --base main --head feat/profile-passport-reorg \
  --title "feat: reorganize profile + passport (de-dup, desktop layout)" \
  --body "Implements docs/superpowers/specs/2026-06-19-profile-passport-reorg-design.md. De-dups level/XP (Passport-only + LevelChip on Profile), adds responsive two-column desktop layout, groups Profile social sections. Frontend-only, no migration."
```

---

## Notes / decisions baked in

- **Level/XP is unified on `xp`.** `LevelProgress`/`LevelChip` derive the level from `progressToNext(xp)` rather than the stored `level` field, removing the slight divergence between the two old implementations. The leveling trigger keeps `level` in sync with `xp`, so this is equivalent and simpler.
- **Social grouping is UI-only.** `SocialTrustPanel` (connected accounts) renders inside the same 「社交帳號」 section as the manual handle list; the two data models are untouched.
- **`/passport` quick-link removed from Profile** — the `LevelChip` is now the single path to Passport. `/my` and `/redemption/history` quick-links remain.
- **Tests stay behavioral** (text/roles/hrefs), not layout-class-specific, so the responsive grid doesn't make them brittle.
