# Slice 1 — Canonical Ladder + Verification Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the level ladder the funnel — one canonical `LEVELS` source (marketing names), a bio-code social-ownership verification flow (auto + operator fallback), and a hard L1→L2 gate via a derived `effective_level` that caps unverified creators at L1.

**Architecture:** Frontend rename is pure (no migration). Verification reuses the existing `creator_social_accounts` table + RapidAPI scan; a new migration adds 3 columns, a partial-unique verified-handle index, an `is_trusted` SQL helper, and rewrites `join_mission`/`apply_mission` to gate on effective level. `/api/me` exposes derived `is_trusted` + `effective_level`; the UI consumes `effective_level` everywhere a level is shown.

**Tech Stack:** TypeScript, React 19, TanStack Router/Query, Vite, Tailwind v4, Hono `/api`, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Vitest (jsdom + integration against a local Supabase stack).

**Source spec:** [`docs/superpowers/specs/2026-06-21-adfocate-slice1-ladder-verification-design.md`](../specs/2026-06-21-adfocate-slice1-ladder-verification-design.md)

**Branch:** continue on `docs/creator-funnel-umbrella` (the umbrella + spec live here), or branch `feat/slice1-ladder-verification` off it. Do not commit to `main`.

**Conventions to respect:**
- New `server/` files need `.js` on relative imports (ESM; `npm run check:esm` enforces).
- `npm run type-check` runs `tsr generate` first — use it, not bare `tsc`.
- Integration tests need a local Supabase stack and `.env.test.local` **exported into the shell** first, else they `describe.skip` (they do not fail). Never source `.env.local` (prod creds).
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Marketing narrative fields (goal/unlocks/income) stay **English literals** on `_site` pages this slice; only the level **name** is bilingual (via `labelKey`). Bilingual marketing copy is deferred (One-Unification).

---

## File Structure

**Migration**
- Create `supabase/migrations/0017_social_verification.sql` — 3 columns, partial unique index, `private.creator_is_trusted`, rewritten `join_mission` + `apply_mission`.

**Backend**
- Modify `server/lib/social/types.ts` — add verification fields to `SocialAccountRecord`.
- Modify `server/lib/social/repo.ts` — `setVerificationCode`, `markVerified`.
- Modify `server/lib/social/service.ts` — `verifyOwnershipWithDeps`, `verifyOwnership`, `issueVerificationCode`, `makeVerificationCode`.
- Modify `server/routes/social.ts` — issue + confirm endpoints.
- Modify `server/routes/admin.ts` — operator manual-verify endpoint.
- Create `server/lib/trust.ts` — `effectiveLevel`, `isTrusted`, `TRUSTED_XP_THRESHOLD`.
- Modify `server/routes/me.ts` — `/api/me` + `/me/level-seen` use trust helpers.
- Modify `server/routes/missions.ts` — add `verification_required` to `RPC_409`.

**Frontend**
- Modify `src/lib/levels.ts` — canonical `LEVELS`, `LevelDef` shape, `effectiveLevelId`.
- Modify `src/lib/i18n.dict.ts` — `app.level.l0…l6` names (en + zh) + verify/locked copy.
- Modify `src/data/mockData.ts` — delete `creatorLevels` + `CreatorLevelData`.
- Modify `src/routes/_site.creators.tsx`, `src/routes/_site.index.tsx` — derive from `LEVELS`.
- Modify `src/components/LevelChip.tsx`, `LevelProgress.tsx`, `PublicPassportView.tsx`, `LevelUpModal.tsx` — `t(labelKey)`; `LevelUpModal` + home use `effective_level`.
- Modify `src/routes/_app.home.tsx` — chip shows effective-level label.
- Modify `src/lib/queries/kocmax.ts` — `Me` gains `is_trusted`/`effective_level`; verification hooks.
- Modify `src/components/SocialTrustPanel.tsx` — verify state machine + badge.
- Modify `src/routes/_app.onboarding.tsx` — verify nudge.
- Modify `src/lib/missionMeta.ts` + the mission-detail page — `verification_required` copy.

**Tests**
- `src/lib/levels.test.ts`, `src/lib/i18n.test.tsx` (parity), `server/lib/social/service.test.ts` (verify deps), `server/test/social.test.ts` + a new `server/test/verificationGate.test.ts` (integration).

---

## Task 1: Canonical `LEVELS` + `effectiveLevelId` + level-name i18n keys

**Files:**
- Modify: `src/lib/levels.ts`
- Modify: `src/lib/i18n.dict.ts` (add `app.level.l0…l6` in `en` and `zh`)
- Test: `src/lib/levels.test.ts`, `src/lib/i18n.test.tsx` (existing parity test must still pass)

- [ ] **Step 1: Write the failing test** — append to `src/lib/levels.test.ts` (create the file with this content if it does not exist; if it exists, add these cases and keep existing ones):

```ts
import { describe, it, expect } from "vitest";
import { LEVELS } from "./levels";

describe("canonical LEVELS", () => {
  it("uses marketing names via i18n keys and engine XP thresholds", () => {
    expect(LEVELS.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(LEVELS.map((l) => l.xpRequired)).toEqual([0, 500, 2000, 6000, 15000, 40000, 100000]);
    expect(LEVELS.map((l) => l.labelKey)).toEqual([
      "app.level.l0", "app.level.l1", "app.level.l2", "app.level.l3",
      "app.level.l4", "app.level.l5", "app.level.l6",
    ]);
    // Marketing narrative fields are present for the _site pages.
    expect(LEVELS[2].emoji).toBe("💬");
    expect(LEVELS[2].goal).toBe("Prove reliability");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd adfocate-2 && npx vitest run src/lib/levels.test.ts`
Expected: FAIL — `labelKey`/`goal` undefined on `LevelDef` (still the old shape).

> Effective-level capping is computed **server-side** (`server/lib/trust.ts`, Task 8) and delivered to the client as `me.effective_level`; the frontend never recomputes it, so no `effectiveLevelId` helper is added here (YAGNI).

- [ ] **Step 3: Rewrite `src/lib/levels.ts`** — replace the `LevelDef` type, the `LEVELS` array, and add `effectiveLevelId`. Keep `levelIndex`, `Progress`, `progressToNext` exactly as they are (only the type + array + new function change):

```ts
export type LevelDef = {
  id: string;
  /** i18n key for the bilingual level name, e.g. "app.level.l2". Render with t(). */
  labelKey: string;
  emoji: string;
  /** Engine XP threshold (canonical — drives the 0008 leveling trigger). */
  xpRequired: number;
  /** i18n key for what unlocks at this level (shown as a hint for the *next* level). "" for L0. */
  unlockKey: string;
  /** Marketing narrative (English literals; shown on _site pages only this slice). */
  goal: string;
  unlocks: string[];
  incomeExample: string;
  /** Marketing colour swatch token. */
  color: string;
};

export const LEVELS: LevelDef[] = [
  { id: "L0", labelKey: "app.level.l0", emoji: "🛒", xpRequired: 0, unlockKey: "",
    goal: "Discover missions and rewards", unlocks: ["Product trials", "Points", "Coupons"], incomeExample: "Points & coupons", color: "cream" },
  { id: "L1", labelKey: "app.level.l1", emoji: "🌱", xpRequired: 500, unlockKey: "app.levelUnlock.l1",
    goal: "Complete first missions", unlocks: ["Review tasks", "Simple submissions", "Starter badge"], incomeExample: "Points, product samples", color: "pink" },
  { id: "L2", labelKey: "app.level.l2", emoji: "💬", xpRequired: 2000, unlockKey: "app.levelUnlock.l2",
    goal: "Prove reliability", unlocks: ["Repeat missions", "Better rewards", "Badges"], incomeExample: "HK$200–800 per mission", color: "yellow" },
  { id: "L3", labelKey: "app.level.l3", emoji: "📱", xpRequired: 6000, unlockKey: "app.levelUnlock.l3",
    goal: "Build niche and consistency", unlocks: ["Profile insights", "Growth resources", "Affiliate eligibility"], incomeExample: "HK$800–2,500 per campaign", color: "mint" },
  { id: "L4", labelKey: "app.level.l4", emoji: "⭐", xpRequired: 15000, unlockKey: "app.levelUnlock.l4",
    goal: "Earn from campaigns", unlocks: ["Paid briefs", "Affiliate offers", "Content jobs"], incomeExample: "HK$2,500–8,000 per campaign", color: "blue" },
  { id: "L5", labelKey: "app.level.l5", emoji: "🌟", xpRequired: 40000, unlockKey: "app.levelUnlock.l5",
    goal: "Build recurring income", unlocks: ["Retainers", "Live commerce", "Brand deals"], incomeExample: "HK$8,000–25,000/month", color: "lilac" },
  { id: "L6", labelKey: "app.level.l6", emoji: "🚀", xpRequired: 100000, unlockKey: "app.levelUnlock.l6",
    goal: "Build a creator business", unlocks: ["Product drops", "Capital readiness", "Premium support"], incomeExample: "HK$25,000+/month", color: "gold" },
];
```

> Keep `levelIndex`, `Progress`, and `progressToNext` exactly as they are — only the `LevelDef` type and the `LEVELS` array change in this file.

- [ ] **Step 4: Add the level-name i18n keys.** In `src/lib/i18n.dict.ts`, in the **`en`** `app: level` section add:

```ts
"app.level.l0": "Shopper",
"app.level.l1": "KOC Starter",
"app.level.l2": "Trusted KOC",
"app.level.l3": "Nano Creator",
"app.level.l4": "Micro-Influencer",
"app.level.l5": "Influencer",
"app.level.l6": "Creator Entrepreneur",
```

and in the **`zh`** `app: level` section add the parallel keys:

```ts
"app.level.l0": "購物者",
"app.level.l1": "KOC 新手",
"app.level.l2": "信譽 KOC",
"app.level.l3": "微型創作者",
"app.level.l4": "微網紅",
"app.level.l5": "網紅",
"app.level.l6": "創作者企業家",
```

- [ ] **Step 5: Run tests (levels + i18n parity)**

Run: `cd adfocate-2 && npx vitest run src/lib/levels.test.ts src/lib/i18n.test.tsx`
Expected: PASS (parity test confirms en/zh have identical keys).

- [ ] **Step 6: Commit**

```bash
cd adfocate-2
git add src/lib/levels.ts src/lib/levels.test.ts src/lib/i18n.dict.ts
git commit -m "feat(levels): canonical marketing ladder + effectiveLevelId + i18n names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Swap in-app `.label` consumers to `t(labelKey)`

Four components render `LevelDef.label` (which no longer exists). Switch each to `t(level.labelKey)`. Pure mechanical; the type error is the failing signal.

**Files:**
- Modify: `src/components/LevelChip.tsx:18`
- Modify: `src/components/LevelProgress.tsx:15,24`
- Modify: `src/components/PublicPassportView.tsx:34`
- Modify: `src/components/LevelUpModal.tsx:25`

- [ ] **Step 1: Run type-check to see the failures**

Run: `cd adfocate-2 && npm run type-check`
Expected: FAIL — `Property 'label' does not exist on type 'LevelDef'` at the four sites.

- [ ] **Step 2: `LevelChip.tsx`** — line 18, replace `{current.label}` with `{t(current.labelKey)}`. (`t` is already in scope via `useI18n()` in this component — confirm; if not, add `const { t } = useI18n();`.)

- [ ] **Step 3: `LevelProgress.tsx`** — line 15 `{p.current.label}` → `{t(p.current.labelKey)}`; line 24 `level: p.next.label` → `level: t(p.next.labelKey)`.

- [ ] **Step 4: `PublicPassportView.tsx`** — line 34 `{lvl.label}` → `{t(lvl.labelKey)}` (ensure `const { t } = useI18n();` is present in the component; add if missing).

- [ ] **Step 5: `LevelUpModal.tsx`** — line 25 `{def.label}` → `{t(def.labelKey)}` (`t` already in scope).

- [ ] **Step 6: Run type-check + the component tests**

Run: `cd adfocate-2 && npm run type-check && npx vitest run src/components`
Expected: PASS. (If a test asserted an English label string, update it to the rendered i18n value for the default `zh` locale or wrap in the test's i18n provider — match the existing test's locale.)

- [ ] **Step 7: Commit**

```bash
git add src/components/LevelChip.tsx src/components/LevelProgress.tsx src/components/PublicPassportView.tsx src/components/LevelUpModal.tsx
git commit -m "refactor(levels): render level names via t(labelKey)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Reconcile the marketing ladder (delete `creatorLevels`, derive from `LEVELS`)

The two `_site` marketing pages map over `creatorLevels` (mockData). Repoint them to `LEVELS` and delete the duplicate.

**Files:**
- Modify: `src/data/mockData.ts` (delete `creatorLevels` + `CreatorLevelData`)
- Modify: `src/routes/_site.creators.tsx`
- Modify: `src/routes/_site.index.tsx`

- [ ] **Step 1: Run type-check baseline** (so the post-change errors are attributable)

Run: `cd adfocate-2 && npm run type-check` → currently PASS.

- [ ] **Step 2: Delete the duplicate.** In `src/data/mockData.ts` remove the `CreatorLevelData` type and the `creatorLevels` array (the block at ~lines 101–121). Leave `mockCreatorPassport` and everything else.

- [ ] **Step 3: `_site.creators.tsx`** — replace the `creatorLevels` import with `import { LEVELS } from "@/lib/levels"` and add `const { t } = useI18n();` to the component (import `useI18n` from `@/lib/i18n`). In the map:
  - `creatorLevels.map((level, i) => {` → `LEVELS.map((level, i) => {`
  - `level.level` → `level.id` (all occurrences: the `key`, `levelPillClass[level.id]`, `{level.id} {…}`)
  - `{level.label}` → `{t(level.labelKey)}`
  - `level.goal`, `level.unlocks`, `level.incomeExample`, `level.emoji`, `level.xpRequired` keep working (same field names on `LevelDef`).
  - `mockCreatorPassport.level` comparison stays (it's an id like "L3").

- [ ] **Step 4: `_site.index.tsx`** — same import swap + `const { t } = useI18n();`. In the map:
  - `creatorLevels.map(...)` → `LEVELS.map(...)`
  - `level.level` → `level.id` (incl. `level.id.slice(1)` and `levelPillClass[level.id]`)
  - `{level.label}` → `{t(level.labelKey)}`
  - the `nextLevel` finder: `creatorLevels.find((l) => parseInt(l.level.slice(1)) === …)` → `LEVELS.find((l) => parseInt(l.id.slice(1)) === …)`
  - `{nextLevel?.label ?? "Higher Level"}` → `{nextLevel ? t(nextLevel.labelKey) : "Higher Level"}`

- [ ] **Step 5: Run type-check + build the marketing routes**

Run: `cd adfocate-2 && npm run type-check && npx vitest run src/routes`
Expected: PASS. No remaining references to `creatorLevels` (grep to confirm: `grep -rn creatorLevels src/` → no matches).

- [ ] **Step 6: Commit**

```bash
git add src/data/mockData.ts src/routes/_site.creators.tsx src/routes/_site.index.tsx
git commit -m "refactor(levels): marketing pages derive from canonical LEVELS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migration `0017` — verification columns, trust helper, RPC gates

**Files:**
- Create: `supabase/migrations/0017_social_verification.sql`
- Modify: `server/lib/social/types.ts` (extend `SocialAccountRecord`)

- [ ] **Step 1: Write the migration** — `supabase/migrations/0017_social_verification.sql`:

```sql
-- Slice 1: bio-code social-ownership verification + the L1->L2 trust gate.

-- 1. Verification columns on the existing social-accounts table.
alter table public.creator_social_accounts
  add column verification_code text,
  add column verification_code_expires_at timestamptz,
  add column verified_at timestamptz;

-- One verified owner per (platform, handle): cross-creator anti-abuse.
create unique index creator_social_accounts_verified_handle_uniq
  on public.creator_social_accounts (platform, handle_normalized)
  where owner_verified;

-- 2. is_trusted source of truth: XP >= 2000 AND >= 1 verified handle.
create or replace function private.creator_is_trusted(p_creator uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select xp from public.creators where id = p_creator), 0) >= 2000
     and exists (
       select 1 from public.creator_social_accounts
       where creator_id = p_creator and owner_verified
     );
$$;

-- 3. join_mission: gate on effective level (cap at L1 until verified).
create or replace function public.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_rows int;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level, quota, filled
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'open' then raise exception 'not_open'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- Effective-level gate. L2+ missions need both XP and a verified handle;
  -- the codes are decomposed so the message is honest (earn XP vs verify).
  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then  -- level_ordinal is 1-indexed (L0=1..L6=7); compare to L2's ordinal, not a bare 2
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'joined', 10)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_joined';
  end;
  update public.creators set xp = xp + 10 where id = v_creator;
  return v_sub;
end;
$$;

-- 4. apply_mission: add the same effective-level gate (it had none before).
create or replace function public.apply_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'application' then raise exception 'not_application'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then  -- level_ordinal is 1-indexed (L0=1..L6=7); compare to L2's ordinal, not a bare 2
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'applied', 0)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_applied';
  end;
  return v_sub;
end;
$$;
```

> `apply_mission` now also selects `required_level` + `level` (added to the original query). The new columns are not added to the `authenticated` update grant, so they remain service-only; `service_role` already has `grant all` (from `0012`).

- [ ] **Step 2: Apply locally and sanity-check**

Run: `cd adfocate-2 && supabase db reset` (rebuilds the local stack from all migrations)
Expected: completes without SQL errors; `0017` listed in the applied set.

Sanity check the function exists:
Run: `supabase db execute "select private.creator_is_trusted('00000000-0000-0000-0000-000000000000');"` (or via the local SQL editor)
Expected: returns `false` (no such creator).

- [ ] **Step 3: Extend `SocialAccountRecord`** in `server/lib/social/types.ts` — add the three fields (anywhere in the type, e.g. after `owner_verified`):

```ts
  verification_code: string | null;
  verification_code_expires_at: string | null;
  verified_at: string | null;
```

- [ ] **Step 4: Type-check**

Run: `cd adfocate-2 && npm run type-check`
Expected: PASS (the new fields are optional reads; `repo.getAccountForCreator` uses `select("*")` so the record carries them).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0017_social_verification.sql server/lib/social/types.ts
git commit -m "feat(db): 0017 social verification columns + trust helper + effective-level RPC gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Verification service + repo helpers (TDD with injected deps)

Add an injectable `verifyOwnershipWithDeps` (mirrors `scanSocialAccountWithDeps`) plus thin service wrappers and repo writes. Verification scans the provider **directly** for the bio — no cooldown coupling (it's bounded by the 24h code).

**Files:**
- Modify: `server/lib/social/repo.ts`
- Modify: `server/lib/social/service.ts`
- Test: `server/lib/social/service.test.ts`

- [ ] **Step 1: Write the failing unit tests** — append to `server/lib/social/service.test.ts`:

```ts
import { verifyOwnershipWithDeps } from "./service";

describe("verifyOwnershipWithDeps", () => {
  const account = {
    ...baseAccount,
    verification_code: "ADF-7K9Q2M",
    verification_code_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    verified_at: null,
  };
  function deps(over: Partial<{ acct: typeof account; bio: string | null }> = {}) {
    const verified = { ...(over.acct ?? account), owner_verified: true, verified_at: new Date().toISOString() };
    return {
      repo: {
        getAccountForCreator: vi.fn().mockResolvedValue(over.acct ?? account),
        markVerified: vi.fn().mockResolvedValue(verified),
      },
      provider: vi.fn().mockResolvedValue({ bio: over.bio ?? "beauty creator ADF-7K9Q2M in HK" }),
      verified,
    };
  }

  it("flips verified when the code is in the bio (case-insensitive)", async () => {
    const d = deps({ bio: "Beauty ✨ adf-7k9q2m" });
    const res = await verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider });
    expect(d.repo.markVerified).toHaveBeenCalledWith("acc-1");
    expect(res.owner_verified).toBe(true);
  });

  it("throws code_not_in_bio when absent", async () => {
    const d = deps({ bio: "no code here" });
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "code_not_in_bio" });
    expect(d.repo.markVerified).not.toHaveBeenCalled();
  });

  it("throws code_expired when expired or missing", async () => {
    const expired = { ...account, verification_code_expires_at: new Date(Date.now() - 1000).toISOString() };
    const d = deps({ acct: expired });
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "code_expired" });
    expect(d.provider).not.toHaveBeenCalled();
  });

  it("propagates provider_not_configured", async () => {
    const d = deps();
    d.provider.mockRejectedValue(new SocialProviderError("provider_not_configured", "off"));
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "provider_not_configured" });
  });
});
```

> `baseAccount` already exists in this test file (from `scanSocialAccountWithDeps` tests); reuse it. Spread the three new fields onto it.

- [ ] **Step 2: Run and watch it fail**

Run: `cd adfocate-2 && npx vitest run server/lib/social/service.test.ts`
Expected: FAIL — `verifyOwnershipWithDeps` not exported.

- [ ] **Step 3: Add repo writes** in `server/lib/social/repo.ts`:

```ts
export async function setVerificationCode(
  supabase: SupabaseClient,
  accountId: string,
  code: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("creator_social_accounts")
    .update({ verification_code: code, verification_code_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) throw error;
}

export async function markVerified(
  supabase: SupabaseClient,
  accountId: string,
): Promise<SocialAccountRecord> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .update({
      owner_verified: true,
      verified_at: new Date().toISOString(),
      verification_code: null,
      verification_code_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) {
    // 23505 = unique_violation on the verified-handle partial index.
    if ((error as { code?: string }).code === "23505") {
      throw Object.assign(new Error("handle already verified by another creator"), { code: "handle_taken" });
    }
    throw error;
  }
  return data as SocialAccountRecord;
}
```

- [ ] **Step 4: Add the service functions** in `server/lib/social/service.ts`:

```ts
import { randomBytes } from "node:crypto";
import { scanRapidApiProfile } from "./rapidApi.js";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1

/** ADF- + 6 unambiguous base32-ish chars. */
export function makeVerificationCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `ADF-${out}`;
}

type VerifyRepo = {
  getAccountForCreator: (creatorId: string, accountId: string) => Promise<SocialAccountRecord | null>;
  markVerified: (accountId: string) => Promise<SocialAccountRecord>;
};

export async function verifyOwnershipWithDeps(input: {
  creatorId: string;
  accountId: string;
  now?: number;
  repo: VerifyRepo;
  provider: (x: { platform: SocialPlatform; handle: string }) => Promise<{ bio: string | null }>;
}): Promise<SocialAccountRecord> {
  const account = await input.repo.getAccountForCreator(input.creatorId, input.accountId);
  if (!account) throw Object.assign(new Error("Social account not found"), { code: "not_found" });

  const code = account.verification_code;
  const exp = account.verification_code_expires_at;
  const now = input.now ?? Date.now();
  if (!code || !exp || Date.parse(exp) < now) {
    throw Object.assign(new Error("Verification code missing or expired"), { code: "code_expired" });
  }

  const scan = await input.provider({ platform: account.platform, handle: account.handle });
  const bio = (scan.bio ?? "").toLowerCase();
  if (!bio.includes(code.toLowerCase())) {
    throw Object.assign(new Error("Code not found in bio"), { code: "code_not_in_bio" });
  }
  return input.repo.markVerified(input.accountId);
}

export async function verifyOwnership(input: { creatorId: string; accountId: string }): Promise<SocialAccountRecord> {
  const svc = serviceClient();
  const verified = await verifyOwnershipWithDeps({
    creatorId: input.creatorId,
    accountId: input.accountId,
    repo: {
      getAccountForCreator: (creatorId, accountId) => repo.getAccountForCreator(svc, { creatorId, accountId }),
      markVerified: (accountId) => repo.markVerified(svc, accountId),
    },
    provider: ({ platform, handle }) => scanRapidApiProfile({ platform, handle }),
  });
  await persistScores(input.creatorId);
  return verified;
}

export async function issueVerificationCode(input: { creatorId: string; accountId: string }): Promise<{ code: string; expiresAt: string }> {
  const svc = serviceClient();
  const account = await repo.getAccountForCreator(svc, input);
  if (!account) throw Object.assign(new Error("Social account not found"), { code: "not_found" });
  const code = makeVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await repo.setVerificationCode(svc, input.accountId, code, expiresAt);
  return { code, expiresAt };
}
```

> `scanRapidApiProfile` is already imported at the top of `service.ts` — don't double-import; reuse. `SocialPlatform`, `serviceClient`, `repo`, `persistScores` are already imported.

- [ ] **Step 5: Run unit tests**

Run: `cd adfocate-2 && npx vitest run server/lib/social/service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/social/repo.ts server/lib/social/service.ts server/lib/social/service.test.ts
git commit -m "feat(social): bio-code verification service (issue + confirm) with injected-deps tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Verification endpoints (issue + confirm)

**Files:**
- Modify: `server/routes/social.ts`

- [ ] **Step 1: Add the endpoints** — append to `server/routes/social.ts` (import the new service fns at the top: `import { issueVerificationCode, scanSocialAccount, verifyOwnership } from "../lib/social/service.js";`):

```ts
socialRoutes.post("/accounts/:id/verification", async (c) => {
  try {
    const { code, expiresAt } = await issueVerificationCode({
      creatorId: c.get("userId"),
      accountId: c.req.param("id"),
    });
    return c.json({ code, expiresAt });
  } catch (error) {
    const ecode = typeof error === "object" && error && "code" in error ? error.code : null;
    if (ecode === "not_found") return c.json({ error: "Social account not found", code: ecode }, 404);
    return c.json({ error: "Failed to issue verification code", code: "db_error" }, 500);
  }
});

socialRoutes.post("/accounts/:id/verification/confirm", async (c) => {
  try {
    const account = await verifyOwnership({
      creatorId: c.get("userId"),
      accountId: c.req.param("id"),
    });
    return c.json({ account });
  } catch (error) {
    const ecode = typeof error === "object" && error && "code" in error ? (error.code as string) : null;
    if (ecode === "not_found") return c.json({ error: "Social account not found", code: ecode }, 404);
    if (ecode === "code_expired") return c.json({ error: "Verification code missing or expired", code: ecode }, 410);
    if (ecode === "code_not_in_bio") return c.json({ error: "Code not found in your bio", code: ecode }, 422);
    if (ecode === "handle_taken") return c.json({ error: "Handle already verified by another creator", code: ecode }, 409);
    if (ecode === "provider_not_configured") return c.json({ error: "Verification is temporarily unavailable", code: "provider_unavailable" }, 503);
    return c.json({ error: "Verification failed", code: "db_error" }, 500);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `cd adfocate-2 && npm run type-check && npm run check:esm`
Expected: PASS (note the `.js` import extension is required and present).

- [ ] **Step 3: Commit**

```bash
git add server/routes/social.ts
git commit -m "feat(api): POST verification issue + confirm endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Operator manual-verify endpoint (fallback)

**Files:**
- Modify: `server/routes/admin.ts`

- [ ] **Step 1: Add the handler** — in `server/routes/admin.ts` (the `x-admin-secret` middleware already guards `*`). Import `markVerified`, `serviceClient` (likely already imported):

```ts
import { markVerified } from "../lib/social/repo.js";

adminRoutes.post("/social/:accountId/verify", async (c) => {
  try {
    const account = await markVerified(serviceClient(), c.req.param("accountId"));
    return c.json({ account });
  } catch (error) {
    const ecode = typeof error === "object" && error && "code" in error ? (error.code as string) : null;
    if (ecode === "handle_taken") return c.json({ error: "Handle already verified by another creator", code: ecode }, 409);
    return c.json({ error: "Manual verify failed", code: "db_error" }, 500);
  }
});
```

> `markVerified` is creator-agnostic (operates by accountId) — correct for an operator override. The partial-unique index still guards against double-verifying a handle.

- [ ] **Step 2: Type-check + esm**

Run: `cd adfocate-2 && npm run type-check && npm run check:esm`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/routes/admin.ts
git commit -m "feat(api): operator manual social-verify fallback endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Trust helper + `/api/me` & `/me/level-seen` expose effective level

**Files:**
- Create: `server/lib/trust.ts`
- Modify: `server/routes/me.ts`
- Modify: `src/lib/queries/kocmax.ts` (`Me` type)

- [ ] **Step 1: Write the failing test** — create `server/lib/trust.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveLevel } from "./trust";

describe("effectiveLevel", () => {
  it("returns raw level when trusted", () => {
    expect(effectiveLevel("L4", true)).toBe("L4");
  });
  it("caps at L1 when not trusted", () => {
    expect(effectiveLevel("L5", false)).toBe("L1");
    expect(effectiveLevel("L2", false)).toBe("L1");
  });
  it("leaves L0/L1 unchanged when not trusted", () => {
    expect(effectiveLevel("L0", false)).toBe("L0");
    expect(effectiveLevel("L1", false)).toBe("L1");
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd adfocate-2 && npx vitest run server/lib/trust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/lib/trust.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** Mirrors private.creator_is_trusted (migration 0017). Keep this constant in sync. */
export const TRUSTED_XP_THRESHOLD = 2000;

const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];

function ordinal(level: string | null | undefined): number {
  const i = LEVEL_IDS.indexOf(level ?? "L0");
  return i < 0 ? 0 : i;
}

/** Cap the displayed/gating level at L1 until the creator is trusted. */
export function effectiveLevel(rawLevel: string | null | undefined, trusted: boolean): string {
  const idx = ordinal(rawLevel);
  return trusted ? LEVEL_IDS[idx] : LEVEL_IDS[Math.min(idx, 1)];
}

/** XP >= threshold AND >= 1 verified handle. Uses whatever client is passed
 *  (user client is fine — RLS self-select exposes the caller's own accounts). */
export async function isTrusted(
  supabase: SupabaseClient,
  creatorId: string,
  xp: number | null | undefined,
): Promise<boolean> {
  if ((xp ?? 0) < TRUSTED_XP_THRESHOLD) return false;
  const { count, error } = await supabase
    .from("creator_social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("owner_verified", true);
  if (error) throw error;
  return (count ?? 0) >= 1;
}
```

- [ ] **Step 4: Wire into `GET /api/me`** — in `server/routes/me.ts`, replace the body of `meRoutes.get("/")` so it computes the derived fields (import `import { effectiveLevel, isTrusted } from "../lib/trust.js";`):

```ts
meRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("creators")
    .select(ME_PROJECTION)
    .eq("id", c.get("userId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  const trusted = await isTrusted(supabase, c.get("userId"), (data as { xp?: number }).xp);
  return c.json({
    ...data,
    is_trusted: trusted,
    effective_level: effectiveLevel((data as { level?: string }).level, trusted),
  });
});
```

- [ ] **Step 5: Make the celebration honest — `/me/level-seen` stamps the effective level.** Replace the `meRoutes.post("/level-seen")` body:

```ts
meRoutes.post("/level-seen", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data: current, error: readErr } = await supabase
    .from("creators")
    .select("level, xp")
    .eq("id", c.get("userId"))
    .single();
  if (readErr) return c.json({ error: readErr.message, code: "db_error" }, 500);

  const trusted = await isTrusted(supabase, c.get("userId"), (current as { xp?: number }).xp);
  const seen = effectiveLevel((current as { level?: string }).level, trusted);

  const { data, error } = await supabase
    .from("creators")
    .update({ level_seen: seen })
    .eq("id", c.get("userId"))
    .select(ME_PROJECTION)
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ...data, is_trusted: trusted, effective_level: effectiveLevel((data as { level?: string }).level, trusted) });
});
```

- [ ] **Step 6: Extend the `Me` type** in `src/lib/queries/kocmax.ts` — add to the `Me` type:

```ts
  is_trusted?: boolean;
  effective_level?: string;
```

- [ ] **Step 7: Run tests + type-check + esm**

Run: `cd adfocate-2 && npx vitest run server/lib/trust.test.ts && npm run type-check && npm run check:esm`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/lib/trust.ts server/lib/trust.test.ts server/routes/me.ts src/lib/queries/kocmax.ts
git commit -m "feat(api): /me exposes is_trusted + effective_level; level-seen stamps effective

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Frontend verification UI (hooks + SocialTrustPanel + onboarding nudge)

**Files:**
- Modify: `src/lib/queries/kocmax.ts` (hooks)
- Modify: `src/components/SocialTrustPanel.tsx`
- Modify: `src/routes/_app.onboarding.tsx`
- Modify: `src/lib/i18n.dict.ts` (verify copy keys, en + zh)

- [ ] **Step 1: Add query hooks** in `src/lib/queries/kocmax.ts`:

```ts
export function useIssueVerification() {
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<{ code: string; expiresAt: string }>(`/social/accounts/${accountId}/verification`, { method: "POST" }),
  });
}

export function useConfirmVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<{ account: SocialAccount }>(`/social/accounts/${accountId}/verification/confirm`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-accounts"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
```

> Add `verification_code`-related fields to the `SocialAccount` type only if the UI needs them; `owner_verified` already exists and is what the badge keys off.

- [ ] **Step 2: Add verify copy keys** to `src/lib/i18n.dict.ts` (both `en` and `zh`). EN:

```ts
"app.social.verifyCta": "Verify ownership",
"app.social.verified": "Ownership verified",
"app.social.verifyInstructions": "Add this code to your {platform} bio, then tap Verify:",
"app.social.verifyNow": "Verify now",
"app.social.verifyReissue": "Get a new code",
"app.social.errCodeNotInBio": "We couldn't find the code in your bio yet. Save your bio and try again.",
"app.social.errCodeExpired": "That code expired. Get a new one.",
"app.social.errUnavailable": "Auto-check is unavailable right now — please request manual review.",
"app.social.errHandleTaken": "This handle is already verified by another account.",
```

ZH (parallel keys, same set):

```ts
"app.social.verifyCta": "驗證擁有權",
"app.social.verified": "已驗證擁有權",
"app.social.verifyInstructions": "將此代碼加入你的 {platform} 個人簡介，然後按驗證：",
"app.social.verifyNow": "立即驗證",
"app.social.verifyReissue": "取得新代碼",
"app.social.errCodeNotInBio": "暫時喺你嘅簡介搵唔到代碼。儲存簡介後再試。",
"app.social.errCodeExpired": "代碼已過期，請取得新代碼。",
"app.social.errUnavailable": "自動驗證暫時未能使用 — 請申請人手審核。",
"app.social.errHandleTaken": "此帳號已被另一位用戶驗證。",
```

- [ ] **Step 3: Add the verify state machine to `SocialTrustPanel.tsx`.** Replace the hardcoded `<p>…Ownership not verified</p>` (line 78) with a per-account verify block. Add at the top of the component: `const { t } = useI18n();`, `const issue = useIssueVerification();`, `const confirm = useConfirmVerification();`, and local state `const [codes, setCodes] = useState<Record<string, string>>({});` and `const [errs, setErrs] = useState<Record<string, string>>({});`. Replace the ownership line with:

```tsx
{account.owner_verified ? (
  <p className="text-xs font-bold text-[var(--color-acid-ink,var(--color-ink))]">✓ {t("app.social.verified")}</p>
) : codes[account.id] ? (
  <div className="space-y-1">
    <p className="text-xs text-[var(--color-soft-ink)]">
      {t("app.social.verifyInstructions", { platform: platform.label })}
    </p>
    <p className="font-mono text-sm font-bold tracking-widest">{codes[account.id]}</p>
    {errs[account.id] && <p className="text-xs text-[var(--color-magenta)]">{errs[account.id]}</p>}
    <div className="flex gap-2">
      <button
        type="button"
        onClick={async () => {
          setErrs((e) => ({ ...e, [account.id]: "" }));
          try {
            await confirm.mutateAsync(account.id);
            setCodes((cs) => { const n = { ...cs }; delete n[account.id]; return n; });
          } catch (err) {
            const code = (err as { code?: string }).code;
            const key =
              code === "code_not_in_bio" ? "app.social.errCodeNotInBio"
              : code === "code_expired" ? "app.social.errCodeExpired"
              : code === "provider_unavailable" ? "app.social.errUnavailable"
              : code === "handle_taken" ? "app.social.errHandleTaken"
              : "common.saveError";
            setErrs((e) => ({ ...e, [account.id]: t(key) }));
          }
        }}
        className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
      >
        {t("app.social.verifyNow")}
      </button>
      <button
        type="button"
        onClick={async () => {
          const { code } = await issue.mutateAsync(account.id);
          setCodes((cs) => ({ ...cs, [account.id]: code }));
        }}
        className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-bold"
      >
        {t("app.social.verifyReissue")}
      </button>
    </div>
  </div>
) : (
  <button
    type="button"
    onClick={async () => {
      const { code } = await issue.mutateAsync(account.id);
      setCodes((cs) => ({ ...cs, [account.id]: code }));
    }}
    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
  >
    {t("app.social.verifyCta")}
  </button>
)}
```

> Imports to add at the top of the file: `useIssueVerification`, `useConfirmVerification` from `@/lib/queries/kocmax`; `useI18n` from `@/lib/i18n`. The panel currently uses hardcoded English elsewhere — leave the rest as-is this slice (only the ownership line is in scope).

- [ ] **Step 4: Onboarding nudge** — in `src/routes/_app.onboarding.tsx`, in the platforms step (step 3) add one line under the hint:

```tsx
<p className="text-xs text-[var(--color-soft-ink)]">{t("app.onboarding.verifyLater")}</p>
```

and add the key `app.onboarding.verifyLater` (en: "You can verify ownership later to become a Trusted KOC and unlock paid missions." / zh: "你之後可以驗證擁有權，成為信譽 KOC 並解鎖有薪任務。") to both locales in `i18n.dict.ts`.

- [ ] **Step 5: Run type-check + parity + component tests**

Run: `cd adfocate-2 && npm run type-check && npx vitest run src/lib/i18n.test.tsx src/components/SocialTrustPanel`
Expected: PASS. (If `SocialTrustPanel` has no test yet, the type-check + parity passing is the gate.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kocmax.ts src/components/SocialTrustPanel.tsx src/routes/_app.onboarding.tsx src/lib/i18n.dict.ts
git commit -m "feat(ui): bio-code verify flow in SocialTrustPanel + onboarding nudge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Effective-level UI (home chip, celebration) + `verification_required` mission copy

**Files:**
- Modify: `server/routes/missions.ts` (RPC_409)
- Modify: `src/routes/_app.home.tsx` (chip)
- Modify: `src/components/LevelUpModal.tsx` (use effective_level)
- Modify: `src/lib/missionMeta.ts` + the mission-detail route (locked copy)
- Modify: `src/lib/i18n.dict.ts` (locked copy keys)

- [ ] **Step 1: API maps the new code.** In `server/routes/missions.ts`, add `"verification_required"` to the `RPC_409` set:

```ts
const RPC_409 = new Set([
  "mission_full", "already_joined", "not_open", "closed",
  "level_locked", "wrong_state", "empty_urls", "not_authenticated",
  "not_application", "already_applied", "verification_required",
]);
```

- [ ] **Step 2: Home chip uses effective level + label.** In `src/routes/_app.home.tsx` line ~37, replace:

```tsx
{LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}
```

with:

```tsx
{(() => {
  const eff = me.data.effective_level ?? me.data.level;
  const def = LEVELS[levelIndex(eff)];
  return <>{def.emoji} {t(def.labelKey)}</>;
})()}
```

> `t` and `LEVELS`/`levelIndex` are already imported in this route (it renders the chip today). Confirm `useI18n()` is called; add if missing.

- [ ] **Step 3: Celebration keys off effective level.** In `src/components/LevelUpModal.tsx`, change the level read + comparison to use `effective_level`:

```tsx
const level = me.data?.effective_level ?? me.data?.level;
const seen = me.data?.level_seen;
if (!level || seen === undefined) return null;
if (levelIndex(level) <= levelIndex(seen)) return null;
const def = LEVELS[levelIndex(level)];
```

> Because `/me/level-seen` now stamps the **effective** level (Task 8 Step 5), the comparison is apples-to-apples: the L2 "Trusted KOC" celebration fires at verification (when effective jumps L1→L2+), not on raw XP alone.

- [ ] **Step 4: Locked-mission copy.** Add i18n keys (en + zh) in `i18n.dict.ts`:

```ts
// en
"app.eligibility.verifyToUnlock": "Verify a social handle to unlock {req} missions",
// zh
"app.eligibility.verifyToUnlock": "驗證社交帳號以解鎖 {req} 任務",
```

In `src/lib/missionMeta.ts`, extend `eligibility()` to accept trust and return the verify message when the gate is verification (not XP). Change the signature and logic:

```ts
export function eligibility(
  requiredLevel: string | undefined | null,
  creatorLevel: string | undefined | null,
  isTrusted = true,
): Eligibility {
  const need = levelIndex(requiredLevel);
  const have = levelIndex(creatorLevel); // pass the EFFECTIVE level from callers
  const reqId = requiredLevel ?? "L0";
  if (have >= need) {
    if (need === 0) return { qualified: true, labelKey: "app.eligibility.allLevels" };
    return { qualified: true, labelKey: "app.eligibility.qualified", params: { req: reqId } };
  }
  // Capped at L1 specifically because unverified (XP would otherwise qualify) → point to verify.
  if (need >= 2 && !isTrusted && levelIndex(creatorLevel) >= 1) {
    return { qualified: false, labelKey: "app.eligibility.verifyToUnlock", params: { req: reqId } };
  }
  return { qualified: false, labelKey: "app.eligibility.notQualified", params: { req: reqId, level: creatorLevel ?? "L0" } };
}
```

Update the mission-detail route (and mission list) callers of `eligibility(...)` to pass `me.effective_level` as `creatorLevel` and `me.is_trusted` as the third arg. (Grep `eligibility(` under `src/` to find the call sites.) Also handle the `verification_required` 409 from join/apply by showing the verify copy + a link to the verification UI (e.g. toast/inline using `app.eligibility.verifyToUnlock`).

- [ ] **Step 5: Run type-check + parity + tests**

Run: `cd adfocate-2 && npm run type-check && npm run check:esm && npx vitest run src/lib/i18n.test.tsx src/lib/missionMeta.test.ts src/components`
Expected: PASS. (Update `missionMeta.test.ts` expectations for the new third arg / `verifyToUnlock` branch — add a case: `eligibility("L2","L1",false)` → `verifyToUnlock` only when effective ≥ L1; `eligibility("L2","L2",true)` → qualified.)

- [ ] **Step 6: Commit**

```bash
git add server/routes/missions.ts src/routes/_app.home.tsx src/components/LevelUpModal.tsx src/lib/missionMeta.ts src/lib/missionMeta.test.ts src/lib/i18n.dict.ts
# plus the mission-detail/list route files touched
git commit -m "feat(ui): effective-level chip + celebration + verify-to-unlock mission copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Integration tests (verification flow + gate)

Mirror `server/test/social.test.ts`: boot the app, mock `rapidApi.js`, use `makeCreator`/`makeMission`. Requires the local Supabase stack + exported `.env.test.local`.

**Files:**
- Create: `server/test/verificationGate.test.ts`

- [ ] **Step 1: Write the integration suite** — `server/test/verificationGate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator, makeMission, DEMO_WS } from "./helpers";
import { createClient } from "@supabase/supabase-js";

// Mock the provider so confirm finds the code we inject into the returned bio.
let nextBio = "";
vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(async ({ platform, handle }: { platform: string; handle: string }) => ({
    platform, handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
    followerCount: 12000, followingCount: 100, postCount: 20,
    bio: nextBio,
    externalAvatarUrl: null, engagementRate: 4, avgLikes: 100, avgComments: 5,
    postingFrequency: 1, freshnessScore: 90, contentThemes: [], recentPostsSummary: [],
    summary: { postSampleSize: 0, hasRecentPosts: false, hasAvatar: false, hasBio: true },
  })),
}));

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const svc = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

suite("verification + L2 gate", () => {
  let c: { userId: string; jwt: string };
  let accountId: string;

  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("verify-gate@test.local");
    const created = await (await req("/social/accounts", c.jwt, {
      method: "POST", body: JSON.stringify({ platform: "instagram", handle: "@verifyme" }),
    })).json();
    accountId = created.id;
  });
  afterAll(cleanup);

  it("issue → confirm flips owner_verified when the code is in the bio", async () => {
    const issued = await (await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" })).json();
    expect(issued.code).toMatch(/^ADF-/);
    nextBio = `beauty creator ${issued.code}`;
    const res = await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).account.owner_verified).toBe(true);
  });

  it("confirm returns 422 code_not_in_bio when absent", async () => {
    // re-issue then confirm with a bio missing the code
    await svc.from("creator_social_accounts").update({ owner_verified: false }).eq("id", accountId);
    const issued = await (await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" })).json();
    nextBio = "no code here";
    const res = await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("code_not_in_bio");
    // restore verified for the gate tests
    nextBio = `restore ${issued.code}`;
    await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" }).then(async (r) => {
      const i2 = await r.json(); nextBio = `restore ${i2.code}`;
      await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
    });
  });

  it("untrusted high-XP creator is blocked from an L2 mission with verification_required", async () => {
    const u = await makeCreator("xp-no-verify@test.local");
    await svc.from("creators").update({ xp: 5000, level: "L2" }).eq("id", u.userId); // raw L2, no verified handle
    const mission = await makeMission({ slug: "test-l2-open", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, u.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("verification_required");
  });

  it("low-XP creator gets level_locked (not verification_required)", async () => {
    const u = await makeCreator("low-xp@test.local");
    await svc.from("creators").update({ xp: 100, level: "L0" }).eq("id", u.userId);
    const mission = await makeMission({ slug: "test-l2-open2", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, u.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("level_locked");
  });

  it("verified + enough XP can join the L2 mission", async () => {
    await svc.from("creators").update({ xp: 5000, level: "L2" }).eq("id", c.userId); // c has a verified handle
    const mission = await makeMission({ slug: "test-l2-open3", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, c.jwt, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("operator manual-verify flips a handle without the provider", async () => {
    const u = await makeCreator("manual-verify@test.local");
    const acc = await (await req("/social/accounts", u.jwt, {
      method: "POST", body: JSON.stringify({ platform: "threads", handle: "manualme" }),
    })).json();
    const res = await app.request(`/api/admin/social/${acc.id}/verify`, {
      method: "POST", headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "test-admin-secret", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.owner_verified).toBe(true);
  });
});
```

> Set `ADMIN_SECRET=test-admin-secret` in `.env.test.local` so the manual-verify case authenticates. `makeMission` requires `test-`-prefixed slugs (cleanup keys off it).

- [ ] **Step 2: Run the integration suite** (local stack up, `.env.test.local` exported)

Run: `cd adfocate-2 && set -a && source .env.test.local && set +a && npx vitest run server/test/verificationGate.test.ts`
Expected: PASS (or `skip` if `hasSupabaseEnv` is false — then start the local stack: `supabase start`, ensure `.env.test.local` has `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_KEY`/`ADMIN_SECRET`, and re-run).

- [ ] **Step 3: Run the FULL gate suite once more**

Run: `cd adfocate-2 && npm run type-check && npm run lint && npx vitest run`
Expected: All green (unit always; integration green when the stack is up).

- [ ] **Step 4: Commit**

```bash
git add server/test/verificationGate.test.ts
git commit -m "test(integration): verification flow + L2 effective-level gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `cd adfocate-2 && npm run type-check && npm run lint && npm run check:esm && npx vitest run` — all green.
- [ ] `grep -rn creatorLevels src/` → no matches (reconciliation complete).
- [ ] Manual smoke (dev server): an unverified creator with XP ≥ 2000 shows **L1 KOC Starter** on the home chip; an L2 mission shows "Verify to unlock"; issuing a code + (mock) verifying flips the badge and lifts the chip to the true level.
- [ ] Dispatch a final code review (subagent-driven-development's final reviewer) before opening the PR.

## Post-merge (USER-GATED — not part of the coding tasks)
- [ ] Apply `0017_social_verification.sql` to prod (`mhkoayftiuojxlrkollf`) **before** the deploy that ships these endpoints/RPCs (apply-before-deploy rule). Then `notify pgrst, 'reload schema';`.
- [ ] Confirm `ADMIN_SECRET` is set in Vercel (operator manual-verify).
- [ ] Set `RAPIDAPI_*` in Vercel to activate the auto-check (until then the gate is passable only via operator manual-verify, by design).

---

## Self-review notes (coverage check)

- **Spec §4 ladder** → Tasks 1–3. **§5 verification** → Tasks 4–7, 9. **§6 gate** → Tasks 4, 8, 10. **§7 testing** → unit in each task + Task 11. **§8 file map** → all files covered.
- **Decomposed gate codes** (spec C2, the self-review fix) → Task 4 SQL + Task 11 tests assert `verification_required` vs `level_locked` distinctly.
- **Celebration uses effective level** (spec C3) → Task 8 Step 5 (`level-seen` stamps effective) + Task 10 Step 3 (modal reads effective). These two MUST ship together (consistency).
- **Cooldown** — the spec floated threading `cooldownMs`; this plan instead scans the provider **directly** in `verifyOwnership` (no cooldown coupling), which is simpler and bounded by the 24h code. Equivalent outcome.
- **Drift risk** (spec §9.1) → `TRUSTED_XP_THRESHOLD = 2000` in `trust.ts` mirrors `private.creator_is_trusted`; both are exercised (Task 8 unit + Task 11 integration) so a divergence surfaces.
