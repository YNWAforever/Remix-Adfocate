# B3 — discovery and matching polish (plan)

Status: **done 2026-11-09** — B3.1–B3.4 shipped. Pages: `/mission` (mission list), `/match` (brand matching),
`/campaigns` (campaigns). Goal: make discovery feel like one product surface on the studio system while
keeping every server query and eligibility rule untouched.

## Current state

The three pages still mix legacy card/border styles with the studio shell; mission cards carry a lot of
secondary labels, and matching/campaign states rely on ad-hoc tags. Empty/error states are inconsistent.

## Phases

### B3.1 — Discovery shell and mission cards (done)
- Shared studio page header (`s-eyebrow`, title, one-line context, entry count) for all three pages.
- Mission cards as `s-task`-style items: title, platform, reward, deadline, one primary action; filters
  as `s-tag` chips in a scrollable row on mobile.
- Empty state `s-empty` when no missions match; error state `s-error` with retry.
- Acceptance: fixture screenshots at 390/1440; no overflow; one h1; query contracts unchanged.

### B3.2 — Match page (done)
- Brand-match cards: match reasons as short disclosure rows, eligibility/blocked reasons as `s-note`,
  honest "why this match" summary; no invented scores.
- CTA per card (apply/view) using `s-btn`; states for applied/accepted/declined.
- Acceptance: matching tests pass; blocked reasons visible, not hidden.

### B3.3 — Campaigns page (done)
- Campaign cards with status, dates and reward context; leaderboard/team summaries as compact rows.
- No fake metrics: only fields the API returns.
- Acceptance: campaign query/list tests pass; mobile layout verified.

### B3.4 — Mobile, a11y, cleanup (done)
- 390/768/1024 sweep, 44 px targets, focus order; remove leftover legacy card wrappers in these pages.
- Acceptance: audit script shows no overflow / one h1; screenshots archived.

## Invariants

- Server contracts, eligibility rules and reward math unchanged.
- All copy through existing i18n keys; no mock labels or invented stats.
- Cards remain honest about missing deadlines/rewards.

## Verification

- `src/routes/_app.mission*`, `_app.match*`, `_app.campaigns*` tests, typecheck, lint, build.
- Fixture screenshots at 390/768/1440 for each page under `.ui-audit-2026-11-08/`.

## Completion evidence

Mission cards and the match page share the studio card/meta/fact treatment with mint fit tags; campaigns list/detail use studio headers, s-task cards, s-grid, s-empty, studio progress bar and leaderboard cards. Audit at 390/1440: mission 1229/1000 px, match 1366/1000 px, campaigns 844/1000 px — no horizontal overflow and one h1 on every page; mission/match/campaign/card tests (181) pass.
