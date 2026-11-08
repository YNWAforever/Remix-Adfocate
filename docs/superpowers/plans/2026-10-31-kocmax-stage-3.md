# Stage 3 — complete the existing product journeys

Approved scope: apply the creator studio design to the remaining visitor, creator, brand and staff screens on `codex/kocmax-studio-stages-1-2`. Baseline `64f4e93`. Local implementation and isolated browser verification only; no deployment, provider connection, remote data writes or schema changes.

## Delivery slices

1. Extend the opt-in studio theme to all route families, including standalone authentication and public passports. Keep `STUDIO_SHELL=false` as the rollback path. Preserve routes and business controls.
2. Design mission, reward, learning and identity cards; responsive navigation, forms, dialogs and staff queues. Preserve all decision facts, version checks, confirmations, permissions and pagination. Unknown balances/counts must not become zero.
3. Expand the development-only transport fixture with sample data for the actual contracts. Exercise visitor discovery, creator work/rewards/profile/learning, brand mission management and staff review/content/reward journeys at mobile and desktop widths. The fixture is evidence of UI behavior only.
4. Run regression tests, type/build/lint/release-manifest checks; independent final review; save a route coverage matrix and screenshots. Commit locally on the same branch.

## Boundaries

- Existing authoritative task, proof, reward and editorial flows remain authoritative; chat is orchestration.
- Real social/Drive authorization, support backend, new brand-private result projection, new invitation/budget/gift mutation services remain later-stage work. Do not simulate unavailable functionality as working production functionality.
- Personal data and evidence keep existing visibility and consent semantics. Do not add a cosmetic leaderboard privacy switch without a persistence/enforcement contract.
- No reward for refreshes, visits or repeated actions; no streak loss, random reward or pressure timer.
- No tests mirroring CSS. Add focused tests only for changed data/error behavior and responsive-table semantics; use the existing regression suite for preserved workflows.

## Acceptance

- Every existing page has studio styling at narrow and wide widths; controls and decision information stay reachable.
- Canonical mutations are unchanged except fail-closed presentation of unknown data. No API, SQL or permission widening.
- Browser evidence names the role, fixture state and viewport. Skipped/live checks are explicitly separated from local acceptance.

## Work ledger

| Slice | State | Evidence |
| --- | --- | --- |
| Baseline and scope | Complete | Clean `64f4e93`; route inventory and graph refreshed |
| Shared theme and page families | Complete | All route families; responsive cards, navigation, forms and dialogs |
| Isolated journeys | Complete | 75 destinations at 390/1440px; 22 extra breakpoint checks; representative mutations |
| Regression and review | Complete | Build/lint/manifest; full regression plus final focused tests; all independent findings closed |

Evidence: [Stage 3 verification](../../review/kocmax-stage-3/verification.md). Runtime acceptance remains separate; no production deployment or real connection.
