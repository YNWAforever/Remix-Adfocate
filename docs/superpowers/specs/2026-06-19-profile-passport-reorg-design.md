# Profile + Passport Reorganization — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**Scope:** Frontend only (`src/routes/_app.profile.tsx`, `src/routes/_app.passport.tsx`, a few shared components). **No backend / no migration.**

## Problem

`/profile` and `/passport` overlap and read as half-redundant:

- **Duplicated** across both pages: the identity header (avatar + name) and the full **level / XP / progress** block (near-identical inline code in both routes).
- **Overlapping** social-trust treatment: `SocialTrustPanel` (manage, on Profile) vs `PassportTrustSummary` (show, on Passport).
- Both pages are **mobile-only** in practice: a single `max-w-lg` column that leaves a desktop screen mostly empty.
- Visual hierarchy is flat — every section is the same bordered card stacked vertically.

## Goals

1. **De-duplicate** — each piece of data has one home; nothing editable appears twice.
2. **Clear split of purpose** — Profile = *manage your identity*; Passport = *your earned credential*.
3. **Desktop layout** — a responsive two-column layout on `lg+`; mobile stays single-column.
4. **Better hierarchy** — within the existing neo-brutalist brand style (hard 2px ink borders, `4px` hard shadow, acid/magenta/ink palette). No restyle, no new design language.

## Non-Goals (YAGNI)

- No change to other routes (home, match, wallet, etc.).
- No backend, API, schema, or query changes — reuses `useMe`, `useMyPassport`, `useUpdateProfile`, `SocialTrustPanel`, `CreatorProfileMediaPanel` as-is.
- No merge of the underlying **data models** for social (manual handles vs RapidAPI-connected accounts stay separate data; only the **UI grouping** changes).
- No new public-passport / share behavior — the existing share card moves, unchanged.

## Decision

**Direction A — two pages, cleanly split** (chosen over a single tabbed page or passport-as-hero).

### Information architecture (de-duplicated)

| Piece | Today | After |
|---|---|---|
| Avatar + name | both pages | shared `IdentityHeader` on both |
| **Level / XP / progress (full block)** | both pages | **Passport hero only** |
| Level indicator on Profile | full block | a compact **`LevelChip`** linking to `/passport` |
| Score rings, badges, trust summary, public share | Passport | Passport (unchanged content, re-laid-out) |
| Display name, categories, manual social handles | Profile (edit) | Profile (edit) |
| Connected social accounts (`SocialTrustPanel`) | Profile | Profile — **grouped under one「社交帳號」section** with the manual handles |
| Portfolio media, referral code, edit, sign-out | Profile | Profile |

## Component changes

Extract the duplicated inline markup into small, single-purpose components:

- **`LevelProgress`** (`src/components/LevelProgress.tsx`) — renders level emoji + label + `XP` + progress bar + "還需 N XP 升至 …" hint, from an `xp` (and optional `level`) prop. Replaces the inline block currently copy-pasted in both routes. Used in the **Passport hero**.
- **`LevelChip`** (`src/components/LevelChip.tsx`) — compact pill: emoji + `Lv` label + "看護照 →", links to `/passport`. Used in the **Profile** identity strip.
- **`IdentityHeader`** (`src/components/IdentityHeader.tsx`) — avatar (image or initial fallback) + display name; accepts a `children`/`actions` slot so Passport can place `LevelProgress` and Profile can place `LevelChip` + Edit/Sign-out. De-dups the avatar rendering currently inline in both routes.
- **`Avatar`** (optional, small) — the image-or-initial circle, if it keeps `IdentityHeader` clean. Internal detail.

These components carry their own focused tests (`*.test.tsx`).

## Page designs

Both pages share a responsive shell: `mx-auto w-full max-w-lg px-4 lg:max-w-5xl`. Below `lg` everything stacks in one column exactly as today; at `lg+` the body becomes a two-column grid.

### `/passport` — earned credential (read-only + share)

1. **Hero** (full width): `IdentityHeader` with `LevelProgress` (avatar · name · level · XP · progress).
2. **Two-column body** (`lg:grid-cols-[1.4fr_1fr]`):
   - **Main:** 「創作者評分」 — the 4 `ScoreRing`s in a **single row** on desktop (`grid-cols-4`), 2×2 on mobile; then 「徽章」 badge grid.
   - **Side:** `PassportTrustSummary`; then the 「公開護照」 share card (Create / Revoke), unchanged behavior.

### `/profile` — manage identity (edit)

1. **Identity strip** (full width): `IdentityHeader` with `LevelChip` (→ Passport) and the **Edit / Sign-out** actions on the right (instead of full-width buttons at the bottom).
2. **Two-column body** (`lg:grid-cols-[1.2fr_1fr]`):
   - **Main:** 「基本資料」 (display name + categories); 「社交帳號」 — one section grouping manual handles **and** the connected accounts (`SocialTrustPanel`) under sub-labels.
   - **Side:** 「作品集」 (`CreatorProfileMediaPanel`); 「邀請碼」 (referral).
3. **Edit mode** keeps the current inline-form behavior (display name, categories `FilterPillsMulti`, handles), re-flowed into the two-column shell. The quick-links block (`/my`, `/redemption/history`) is retained — Passport is no longer a quick-link since the chip already points there.

### Visual refinement (within existing style)

- Keep the bordered-card + hard-shadow vocabulary, but introduce **two levels of emphasis**: primary cards keep the `4px` shadow; nested/secondary cards are flat (border only) — already prototyped in the mockups — so a desktop screen has hierarchy instead of a wall of equal cards.
- Consistent section spacing and headings; the hero/credential and the identity strip get slightly more prominence than body sections.

## Data flow / error handling

Unchanged. Pages keep their existing loading / error states (`載入中…` / `載入失敗，請重試`). No new network calls. `LevelProgress`/`LevelChip`/`IdentityHeader` are pure presentational components driven by props from `useMe` / `useMyPassport`.

## Testing

- New unit tests for `LevelProgress`, `LevelChip`, `IdentityHeader` (render label/XP/progress; chip links to `/passport`; avatar image vs initial fallback).
- Update `_app.profile.test.tsx` and `_app.passport.test.tsx` for the reorganized DOM (level block only on Passport; Profile shows the chip; merged social section heading). Keep assertions behavioral (text/roles), not layout-class-specific, so the responsive grid doesn't make them brittle.
- `npm run lint`, `npm run type-check`, `npm test`, `npm run build` all green; the new ESM guard (`check:esm`) is N/A here (frontend `src/`, not `server/`).

## Out of scope / follow-ups

- Applying the shared desktop shell to other routes (home, etc.).
- Any deeper merge of manual-handle vs connected-account data models.
- Social-scan being live still depends on `RAPIDAPI_*` env (separate config item).
