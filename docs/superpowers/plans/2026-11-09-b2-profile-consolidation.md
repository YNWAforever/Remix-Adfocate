# B2 — profile and account consolidation (plan)

Status: started 2026-11-09 (Week 3), after B1 completed. Page: `/profile`
(`src/routes/_app.profile.tsx`, ~12 KB, legacy layout inside the studio shell). Goal: one coherent
"my account" surface for identity, portfolio and privacy, without changing any account API.

## Current state

Two stacked cards: profile header (avatar/name/level, edit/sign out, EN toggle) and a media card; then a
two-column block (content categories + social accounts | creator media + referral + task/redemption
links); then notification consent and "你的資料及帳戶" (export/delete). Layout is functional but mixes
three visual systems and leaves an empty left column on desktop.

## Phases

### B2.1 — Identity header and account card (first slice)
- `s-card` header: avatar, display name, level tag, edit/sign-out as `s-btn`s, language toggle in the
  header row; referral code folded into this card as one compact block.
- Desktop: identity card spans the row; no duplicated "編輯 profile" blocks.
- Acceptance: fixture 390/768/1440 screenshots, no overflow, one h1, existing edit/save/copy tests pass.

### B2.2 — Portfolio and social presence
- "內容範疇" (categories) + "社交帳號" (social handles) as one two-column studio card; save buttons
  become explicit per-row actions with inline saved state.
- "創作者媒體" (creator media) becomes a portfolio card: avatar upload, sample work (title/url/type/
  description), "新增作品" and "發佈到公開護照" as primary/secondary buttons with the existing
  publish-status component.
- Acceptance: existing media/upload/publish tests pass; empty states honest; no mock content labels.

### B2.3 — Privacy and data controls
- Notification consent as a labelled switch row.
- Export ("下載我的資料") and delete account become a `danger`-styled card separated from the rest, with
  the existing confirmation/export flow untouched.
- Acceptance: export/delete mutation tests still pass; no form sends data without an explicit action.

### B2.4 — Mobile and cleanup
- 390/768 layout sweep, 44 px targets, focus order, empty-column removal.
- Remove leftover legacy Tailwind conventions in this page; keep all i18n keys.

## Invariants

- Server contracts unchanged: profile/avatar/media/referral/export/delete APIs stay as-is.
- All copy through existing i18n keys; no new "preview"/mock labels.
- Honest states: unavailable media/export failures are shown, never faked.

## Verification

- Fixture screenshots at 390/768/1440 archived under `.ui-audit-2026-11-08/`.
- `src/routes/-_app.profile.test.tsx` (if present) plus profile-related media tests, typecheck, lint, build.
- No horizontal overflow; one h1; min 44 px targets except native checkbox (labelled 44 px target).
