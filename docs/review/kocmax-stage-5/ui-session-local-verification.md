# UI and session local verification

Date: 2026-11-04, Asia/Singapore. Branch: `codex/kocmax-studio-stages-1-2`.

This is local component and in-app-browser evidence using synthetic data. It does not establish live Supabase Auth/RLS, Instagram, Google Drive, hosted, or production acceptance.

## Environment

- HEAD: `e491e2d`, including the reviewed direct mission edit and brand Delete commits.
- The reviewed Task 3 sign-out/context/copy patch remains uncommitted.
- Local URL: `http://127.0.0.1:8768`, with `VITE_STUDIO_FIXTURE=true`.
- The first role checks used the legacy shell flag setting. The preview was then restarted with the existing Studio shell/thread flags enabled; the follow-up below verifies the new shell with the same permission components.
- Supabase configuration uses an `example.invalid` URL and a synthetic placeholder key.
- The existing development fixture intercepts fetch, rejects external destinations, and does not install the Hono development API.
- The preview was extended with a synthetic brand-member role and persistent visitor state after mock sign-out. This prevents an old saved preview role from falsely resurrecting a session on reload.
- The preview controls are visibly labelled `本機示例 · 無真實連接`.

## In-app-browser checks

Every absence assertion below waited for the relevant page or draft to load first. Widths are requested viewport sizes; the browser's usable content width can be six pixels narrower because of the scrollbar.

| Journey | 320px | 390px | 430px | 1440px |
| --- | --- | --- | --- | --- |
| Operator opens the mission edit URL directly | PASS: denial, no title input or Save | PASS | PASS | PASS |
| Workspace admin opens the same mission | PASS: enabled title and Save | PASS | PASS | PASS |
| Brand member opens a loaded draft | PASS: no Delete button | PASS | PASS | PASS |
| Brand owner opens a loaded draft | PASS: one Delete button | PASS | PASS | PASS |
| Nonstaff creator opens the operator console | PASS: identity-neutral denial | PASS | PASS | PASS |
| Horizontal page overflow on those role views | None observed | None observed | None observed | None observed |

The brand owner Delete button was inspected without executing deletion. The existing active mission had no Delete button.

At 390×844 and 1440×1000, mock staff sign-out immediately removed the private mission form. Reload and browser Back/Forward returned the signed-out view, with zero private title inputs. The mobile run also typed an unsaved synthetic title before sign-out and confirmed it was absent afterward.

The nonstaff message was `此帳戶未獲授權使用營運後台。`. The Google sign-in button retained its accurate provider label on the signed-out view.

Screenshots were visually inspected in the in-app browser during this run. These checks exercise the actual application components through the development fixture, rather than the earlier static concept HTML.

## Studio-shell follow-up

With `VITE_STUDIO_SHELL=true`, `VITE_STUDIO_THREADS=true` and the same synthetic fixture settings, the following were repeated in the selected in-app-browser tab at 390×844 and 1440×1000:

| Check | Mobile | Desktop |
| --- | --- | --- |
| Operator direct edit URL: denial, no title/Save | PASS | PASS |
| Brand member: loaded draft has zero Delete buttons | PASS | PASS |
| Brand owner: loaded draft has one Delete button | PASS | PASS |
| Authorized workspace admin can edit the title | PASS | PASS |
| Sign-out removes an unsaved synthetic title | PASS | PASS |
| Back, Forward and Reload remain signed out, zero private title inputs | PASS | PASS |
| Nonstaff denial remains identity-neutral | PASS | PASS |
| Horizontal overflow on those views | None | None |

Switching from a creator's image-growth sample to the operator role also removed the private image-growth panel. No deletion, save, task mutation or reward action was executed in these role checks.

## Automated verification

- Direct mission edit focused regression: 35/35 passed after the two review fixes.
- Brand UI and offline Hono DELETE permission tests: 10/10 passed.
- Task 3 auth/form tests: 44/44 passed.
- Related Task 3 route regressions: 45/45 passed.
- TypeScript and focused lint passed after the final sign-out change.
- `npm run build` passed after the final sign-out remount guard.
- The subsequent preview-only role/sign-out fixture change passed `npx tsc --noEmit` and focused ESLint.

The earlier broad suite remained red in unrelated release-manifest, temporary-file permission, local transport, and pilot-package cases. It is not recorded as a full-suite PASS.

## Remaining acceptance

- Pending/failed sign-out, same-owner token refresh races, unavailable access and draft restoration are covered by focused component tests. The browser fixture's successful sign-out does not simulate a real provider outage.
- Browser history checks use the in-app browser's actual Back/Forward/Reload actions with mocked Auth. They do not establish every browser's bfcache behavior.
- The remount latch depends on `sessionStorage`; a browser that denies storage cannot persist it across a full reload.
- Real refresh-token replay, exact live cleanup and independent database readback require the separate Task 5 approval packet.
- No database changes, real connections, publication, or deployment were performed.
