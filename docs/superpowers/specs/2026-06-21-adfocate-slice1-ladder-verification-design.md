# Slice 1 — Canonical Ladder + Verification Gate — Design

**Date:** 2026-06-21
**Parent:** [`2026-06-21-creator-activation-funnel-design.md`](./2026-06-21-creator-activation-funnel-design.md) (umbrella / north-star)
**Status:** Implementable spec. Next step after approval → `writing-plans`.

This is the first of the two funnel slices. It establishes the **canonical level ladder** (one source of truth, marketing names) and the **hard L1→L2 verification gate** (bio-code social-ownership check). Slice 2 (Guide hub + first-run walkthrough) follows after this ships.

---

## 1. Goal

Make the funnel *be* the level ladder, and make "L2 Trusted KOC" mean something: a creator cannot be treated as L2 — and cannot access L2-gated missions — until they (a) have XP ≥ 2000 **and** (b) have proven they own at least one social handle via a bio-code check. Until then they are capped at L1, no matter how much XP they accrue.

Two halves, shipped together because the gate is the point of the ladder:

- **Canonical ladder** — one `LEVELS` source of truth with the marketing names/emoji; reconcile the divergent marketing `creatorLevels`; surface the label on the home chip.
- **Verification gate** — bio-code ownership check (auto via the existing RapidAPI scan, with an operator manual-verify fallback), an `is_trusted` / `effective_level` model, and enforcement in the mission RPCs + UI.

---

## 2. Locked decisions (from brainstorm)

1. **Effective-level semantics = Model A (cap at L1 until verified).** The engine's raw `creators.level` column stays XP-driven (the `0008` trigger is unchanged). The UI and all gates use a derived **`effective_level`** which caps at **L1** whenever the creator is not trusted — even if raw XP places them at L2+. Verifying lifts the cap and they jump to their true XP level (the unlock moment). XP/progress stays visible throughout with a "ready — verify to unlock L2" state.
2. **`is_trusted` rule:** `xp ≥ 2000` **AND** at least one social handle with `owner_verified = true`. Authoritative definition lives in SQL (`private.creator_is_trusted`), mirrored in `/api/me` for display.
3. **Verification method = bio-code ownership** (auto), limited to **`instagram` + `threads`** (the only platforms the scan subsystem supports). **No** OAuth, **no** identity check.
4. **Verification availability = graceful + operator manual-verify fallback.** Build the bio-code auto-check AND a minimal operator action to mark a handle verified, so the gate is functional in prod today (RapidAPI is dormant until `RAPIDAPI_*` is set). When the provider is dormant, auto-confirm returns a graceful 503 and the creator is pointed at manual review.
5. **L2-only missions are gated via the existing `required_level='L2'` column** — no new mission attribute.
6. **Operator manual-verify surface = minimal** — one endpoint + a "Mark verified" button in the existing operator console (no review queue).

---

## 3. Current-state grounding (what already exists)

- **`creator_social_accounts`** (`0012_trust_profile_bundle.sql`) already has `owner_verified boolean not null default false`, `bio text`, a generated `handle_normalized`, and `unique (creator_id, platform, handle_normalized)`. Platform check constraint = `('instagram','threads')`.
- **Grants:** `authenticated` may only `insert (creator_id, workspace_id, platform, handle, profile_url)` and `update (handle, profile_url)`. So `owner_verified` and the new verification columns are **not client-writable** — the flip must go through the service client. `service_role` has `grant all`.
- **Scan path** (`server/lib/social/service.ts` → `repo.updateAccountFromScan`) already parses `biography` into `SocialScanResult.bio` and stores it on the account. `scanSocialAccount` runs the provider, persists, and has a 1h cooldown (`MANUAL_SOCIAL_SCAN_COOLDOWN_MS`). RapidAPI dormant → throws `provider_not_configured` → routes return 503.
- **`join_mission`** (`0005`) gates: `if level_ordinal(creators.level) < level_ordinal(required_level) then raise 'level_locked'`. Uses **raw** level. `level_ordinal(text)→int` maps L0..L6→0..6 (defined in `0005`).
- **`apply_mission`** (`0010`) has **no** level gate (checks access_type/status/deadline/already_applied only).
- **`missions.ts`** maps RPC raise-messages to HTTP; `RPC_409` set already includes `level_locked`.
- **`/api/me`** (`me.ts`) returns a single `creators` projection (`ME_PROJECTION`).
- **`missionMeta.ts` `eligibility()`** is display-only; comment already says "the real gate is server-side (join/apply return `level_locked` 409)."
- **`src/lib/levels.ts`** — `LEVELS` L0–L6, current labels Newcomer/Explorer/Creator/Amplifier/Micro-Influencer/Pro Creator/Elite, XP 0/500/2000/6000/15000/40000/100000. `levelIndex()`, `progressToNext()`.
- **`creatorLevels`** (`src/data/mockData.ts:113`) — the marketing ladder, shape `{ level, label, goal, unlocks[], xpRequired, color, emoji, incomeExample }`, names already = Shopper/KOC Starter/Trusted KOC/Nano Creator/Micro-Influencer/Influencer/Creator Entrepreneur, emoji 🛒🌱💬📱⭐🌟🚀, **divergent illustrative XP** 0/100/500/1200/3000/8000/20000. Consumed by `_site.creators.tsx` + `_site.index.tsx` (marketing only).
- **`SocialTrustPanel.tsx`** adds handles + triggers scans, always renders "Ownership not verified" (hardcoded).
- **`_app.home.tsx:37`** renders the raw level **ID + emoji** (`{LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}`), not the label.

---

## 4. Part A — Canonical ladder

### A1. `src/lib/levels.ts` becomes the single source of truth
Rewrite `LEVELS` with the marketing names + emoji, keeping the **engine** XP thresholds:

| id | label | emoji | `xpRequired` (engine, canonical) |
|---|---|---|---|
| L0 | Shopper | 🛒 | 0 |
| L1 | KOC Starter | 🌱 | 500 |
| L2 | Trusted KOC | 💬 | 2000 |
| L3 | Nano Creator | 📱 | 6000 |
| L4 | Micro-Influencer | ⭐ | 15000 |
| L5 | Influencer | 🌟 | 40000 |
| L6 | Creator Entrepreneur | 🚀 | 100000 |

Extend `LevelDef` with the marketing narrative fields so the marketing pages have one source:
```ts
export type LevelDef = {
  id: string;
  labelKey: string;       // i18n key, e.g. "app.level.l2" (replaces hardcoded `label`)
  emoji: string;
  xpRequired: number;     // engine threshold (canonical)
  unlockKey: string;      // existing
  goalKey: string;        // marketing: "Prove reliability"
  unlockListKeys: string[]; // marketing bullet keys
  incomeKey: string;      // marketing: "HK$200–800 per mission"
  color: string;          // marketing swatch (cream/pink/yellow/...)
};
```
> **Label is now an i18n key, not a string.** Consumers that read `.label` today (`LevelChip`, `LevelProgress`, `PublicPassportView`) switch to `t(level.labelKey)`. The marketing XP numbers are dropped — engine thresholds are canonical (umbrella §3, risk §4).

### A2. Reconcile `creatorLevels`
Delete `creatorLevels` (and `CreatorLevelData`) from `mockData.ts`. Repoint `_site.creators.tsx` and `_site.index.tsx` to derive their ladder display from `LEVELS` (label/emoji/goal/unlocks/income/color via the new fields + `t()`). One ladder, no second source.

### A3. i18n
Add `app.level.l0…l6` (label), `app.level.l0.goal…`, `app.level.l0.income…`, and the unlock-bullet keys, in **both** en and zh-HK (`src/lib/i18n.dict.ts`). zh-HK names (proposed, refine in implementation): Shopper→購物者, KOC Starter→KOC 新手, Trusted KOC→信譽 KOC, Nano Creator→微型創作者, Micro-Influencer→微型influencer, Influencer→influencer, Creator Entrepreneur→創作者企業家. The dict parity test enforces both locales.

### A4. Home chip
`_app.home.tsx` renders `t(effectiveLevelDef.labelKey)` + emoji using **`effective_level`** (Part C), not the raw ID. `/profile` + `/passport` pick up the rename automatically once they read `labelKey`.

---

## 5. Part B — Verification (bio-code ownership)

### B1. Migration (new — `0017_social_verification.sql`)
```sql
alter table public.creator_social_accounts
  add column verification_code text,
  add column verification_code_expires_at timestamptz,
  add column verified_at timestamptz;

-- One verified owner per (platform, handle): cross-creator anti-abuse.
create unique index creator_social_accounts_verified_handle_uniq
  on public.creator_social_accounts (platform, handle_normalized)
  where owner_verified;

-- is_trusted source of truth (used by the mission RPCs).
create or replace function private.creator_is_trusted(p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select xp from public.creators where id = p_creator), 0) >= 2000
     and exists (
       select 1 from public.creator_social_accounts
       where creator_id = p_creator and owner_verified
     );
$$;
```
> New columns are **not** added to the `authenticated` update grant, so they stay service-only. `verified_at` doubles as the manual/auto audit stamp.

### B2. Verification flow & endpoints
Add to `server/routes/social.ts` (all `instagram`/`threads`, caller-owned account, user-auth):

- **`POST /api/social/accounts/:id/verification`** (issue)
  - Generate `ADF-` + 6 random base32 chars (crypto-random; vary so it can't be guessed).
  - Set `verification_code`, `verification_code_expires_at = now() + 24h` (service client). Re-issue overwrites both.
  - Return `{ code, expiresAt }` + instruction copy ("Put this in your bio, then tap Verify").
- **`POST /api/social/accounts/:id/verification/confirm`** (verify)
  1. Load account; if no active code or `expires_at < now()` → **410 `code_expired`**.
  2. Run a verification scan (reuse `scanSocialAccount`, see B3 cooldown). If `provider_not_configured` → **503 `provider_unavailable`** (graceful; UI points to manual review).
  3. Compare `verification_code` against the freshly scanned `bio`, case-insensitively, whitespace-trimmed (`bio.toLowerCase().includes(code.toLowerCase())`).
  4. Present → service-update `owner_verified=true, verified_at=now(), verification_code=null, verification_code_expires_at=null`; call `persistScores(creatorId)`; return the updated account (verified). Absent → **422 `code_not_in_bio`**.
  - Guard the partial-unique-index violation (another creator already verified this handle) → **409 `handle_taken`**.
- **Operator fallback `POST /api/admin/social/:accountId/verify`** (in `admin.ts` / operator routes; ADMIN_SECRET-auth like existing admin endpoints) — service-flip `owner_verified=true, verified_at=now()`, clear any code. For dormant-provider or stuck auto-checks. Same `handle_taken` guard.

### B3. Anti-abuse & cooldown
- **Single-use:** code cleared on success; re-issue invalidates the prior code.
- **Expiry:** 24h, checked in confirm.
- **Cross-creator:** partial unique index on verified `(platform, handle_normalized)`.
- **Confirm cooldown:** the existing 1h metric-refresh cooldown is too slow for a just-added handle (adding a handle sets `sync_status='pending'`; the user issues a code and confirms within minutes). Give verification-confirm a **dedicated short cooldown (~60s)** — either a separate path that bypasses `hasRecentScanAttempt`, or a parameterised cooldown — so confirm is throttled against hammering but stays snappy. *(Implementation detail: thread a `cooldownMs` option through `scanSocialAccountWithDeps`, or add a `scanForVerification` wrapper.)*

### B4. Verification UI (`SocialTrustPanel.tsx` + onboarding)
- Per IG/Threads account: replace the hardcoded "Ownership not verified" with a state machine:
  - **unverified, no code** → "Verify ownership" button → issue.
  - **code issued** → show the code + "Put this in your bio, then tap Verify" + "Verify now" (confirm) + expiry countdown.
  - **confirm error** → inline copy per code (`code_not_in_bio` / `code_expired` / `provider_unavailable` → "auto-check unavailable, request manual review").
  - **verified** → ✓ "Ownership verified" badge (drop the hardcoded label).
- Onboarding (`_app.onboarding.tsx` social-handles step) gains a light "verify to become Trusted KOC later" nudge (no hard step — verification is post-onboarding).
- New TanStack Query hooks in `src/lib/queries/kocmax.ts` (`useIssueVerification`, `useConfirmVerification`).

---

## 6. Part C — The L2 gate (effective level)

### C1. `effective_level` definition
`effective_level = is_trusted ? raw_level : LEVELS[min(levelIndex(raw_level), 1)].id`
- Not trusted: capped at **L1** (or L0 if XP < 500).
- Trusted: equals raw XP-driven level.

### C2. Mission RPCs (migration `0017`, replace both functions)
In **`join_mission`** and **`apply_mission`**, gate with **decomposed** checks so the reason code reflects what is actually missing (raw XP vs verification), not the bundled `is_trusted`:
```sql
-- inside each RPC, after loading m.required_level and v_level:
-- NOTE: level_ordinal is 1-indexed (array_position: L0=1, L1=2, L2=3...), so the
-- L2+ threshold MUST be level_ordinal('L2'), NOT a bare 2 (a bare 2 == L1+).
if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then
  -- L2+ mission: need enough XP AND a verified handle.
  if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';          -- not enough XP yet → "earn XP"
  elsif not exists (
    select 1 from public.creator_social_accounts
    where creator_id = v_creator and owner_verified
  ) then
    raise exception 'verification_required';  -- XP ok but unverified → "verify"
  end if;
else
  -- L0/L1 mission: XP-only gate (unchanged semantics).
  if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;
end if;
```
- Decomposing avoids the `is_trusted` trap: a creator who *has* verified but lacks XP (e.g. xp=600, verified) correctly gets `level_locked` ("earn XP"), not a misleading "verify" prompt. `private.creator_is_trusted` stays the source for `/api/me`'s `is_trusted`/`effective_level` (C3); the RPCs check the two conditions separately only so the *message* is honest.
- This **adds** the level/verification gate to `apply_mission` (today it has none) — closing the L2 hole on application missions. *Deliberate behavior change; flagged for spec review.*
- `verification_required` is distinct from `level_locked` so the UI can say "verify" vs "earn XP".

### C3. API + client
- Add **`verification_required`** to `RPC_409` in `missions.ts` → 409.
- **`/api/me`** adds `is_trusted` (bool) + `effective_level` (string). Compute in TS: read `xp` + a count of `owner_verified` accounts (user client, RLS self-select) and apply the C1 rule. Keep the `2000` threshold as a shared server constant; add a parity note/test against `private.creator_is_trusted` to guard drift.
- Frontend consumes `effective_level` for the home chip, `/profile`, `/passport`, and `eligibility()` display; raw `level` stays available for internals.
- **Level-up celebration** (`level` vs `level_seen`, `/me/level-seen`): switch the celebration trigger to **`effective_level`** so "reached Trusted KOC" fires at verification, not on raw XP crossing 2000. *(Verify `useLevelUp`/home celebration logic reads effective level.)*
- **Locked-mission copy:** missions where `required_level='L2'` and the viewer isn't trusted show "Verify to unlock" (pointing at verification), distinct from the XP-needed copy.

---

## 7. Part D — Testing

- **Unit (`levels.ts`):** `effectiveLevel()` truth table (untrusted high-XP → L1; trusted → raw; L0/L1 edge), updated `progressToNext` labels.
- **Unit (verification):** bio-code substring match (case/whitespace), expiry, using `server/lib/social/fixtures` (IG fixture has a `biography`); inject a code into the fixture bio for the positive path.
- **Unit (gate SQL logic / service):** `is_trusted` truth table; `verification_required` vs `level_locked` selection.
- **`/api/me` shape:** `is_trusted` + `effective_level` present and correct for trusted/untrusted/high-XP-untrusted.
- **i18n parity:** new `app.level.*` keys present in both locales (existing parity test).
- **Integration:** issue → (inject code in fixture bio) → confirm → verified; `code_not_in_bio`; `code_expired`; `provider_unavailable`; operator manual-verify; `join_mission`/`apply_mission` returning `verification_required` for an untrusted creator on an L2 mission, then succeeding once trusted; `handle_taken` on a duplicate verified handle.
- Gates: `npm run type-check` (runs `tsr generate`), `lint`, unit, integration (local stack via `.env.test.local`).

---

## 8. File-level change map

**Migration**
- `supabase/migrations/0017_social_verification.sql` — new columns, partial unique index, `private.creator_is_trusted`, replace `join_mission` + `apply_mission`.

**Backend**
- `server/routes/social.ts` — issue + confirm endpoints; verified state in `trustLabels`.
- `server/lib/social/service.ts` (+ `repo.ts`) — verification-scan cooldown variant; helpers to set/clear code, flip verified.
- `server/routes/admin.ts` (or operator routes) — operator manual-verify endpoint.
- `server/routes/me.ts` — `is_trusted` + `effective_level` in `/api/me`.

**Frontend**
- `src/lib/levels.ts` — canonical `LEVELS`, extended `LevelDef`, `effectiveLevel()` helper.
- `src/data/mockData.ts` — delete `creatorLevels`/`CreatorLevelData`.
- `src/routes/_site.creators.tsx`, `_site.index.tsx` — derive from `LEVELS`.
- `src/routes/_app.home.tsx` — label from `effective_level`.
- `src/components/SocialTrustPanel.tsx` — verify state machine + badge.
- `src/routes/_app.onboarding.tsx` — verify nudge.
- `src/lib/queries/kocmax.ts` — verification hooks; `me` type gains `is_trusted`/`effective_level`.
- `src/lib/missionMeta.ts` — `eligibility()` aware of effective level + `verification_required` copy.
- consumers of `LevelDef.label` → `labelKey` (`LevelChip`, `LevelProgress`, `PublicPassportView`, celebration).
- `src/lib/i18n.dict.ts` — `app.level.*` + verify/locked copy (en + zh-HK).

---

## 9. Risks & open items

1. **Drift between SQL `creator_is_trusted` and TS `/api/me`.** Mitigate with a shared `2000` constant + a test asserting both agree. (Inherent: the XP threshold already lives in `levels.ts` + the `0008` trigger.)
2. **`apply_mission` behavior change.** Adding a level/verification gate where there was none may surprise existing application-mission flows. Intended for the hard gate; flagged.
3. **Celebration semantics.** Switching level-up to `effective_level` must not double-fire or skip; verify `level_seen` interplay.
4. **RapidAPI dormant in prod.** Auto-confirm is non-functional until `RAPIDAPI_*` is set; the operator manual-verify path keeps the gate passable. Tests use fixtures (no live provider).
5. **Migration ordering (prod).** `0017` must be applied to prod **before** the deploy that ships the new RPCs/endpoints (per the established apply-before-deploy rule). New server files need `.js` on relative imports (ESM guard).
6. **zh-HK level names** are proposed; finalize wording during implementation.

---

## 10. Out of scope (deferred)

小紅書 / TikTok / YouTube verification (not scannable); a dedicated paid/brand mission taxonomy (reuse `required_level`); identity / OAuth verification; an operator verification review queue; **Slice 2** (Guide hub + first-run walkthrough).

---

## 11. Acceptance criteria

- One ladder source (`LEVELS`) with marketing names/emoji; `creatorLevels` deleted; marketing pages + home chip render canonical labels via i18n in both locales.
- A creator with XP ≥ 2000 but no verified handle shows **L1 KOC Starter** (capped), and is refused L2 missions with `verification_required` on both `join` and `apply`.
- Bio-code issue → confirm flips `owner_verified` and lifts the cap to the true XP level; `code_not_in_bio` / `code_expired` / `provider_unavailable` handled gracefully.
- Operator manual-verify flips a handle verified without the provider.
- `/api/me` exposes `is_trusted` + `effective_level`; duplicate verified handle → `handle_taken`.
- type-check, lint, unit, and integration gates green.
