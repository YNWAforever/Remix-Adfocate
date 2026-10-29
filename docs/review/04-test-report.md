# 04 — Test report (Phase 3)

Run date: 2026-10-29 · Commit under test: `15f8ed1` (no application code changed).
Target: a **disposable local Supabase stack** (`supabase start` in Docker; all 78 migrations and the seed applied). No production data or real credentials were used. LLM and RapidAPI calls are disabled: no `AI_GATEWAY_API_KEY`, and the RapidAPI paths are not exercised.

## 1. What was added

All new files are under `tests/review/`. The repo's own `npm test` does not pick them up, because `vitest.config.ts` only includes `server/`, `src/` and `scripts/`.

| File | Kind | Tests | Scenarios covered |
|---|---|---|---|
| `support/fixture.ts` | helper | – | Loopback-only guard, real Hono app in-process, real Supabase Auth users, staff roles through the owner-only `private.bootstrap_staff_access` RPC |
| `support/bug.ts`, `e2e/bug.ts` | helper | – | Strict known-bug marker (see §2) |
| `integration/lifecycle.test.ts` | Vitest + DB | 3 | Happy path; empty new account; payout probe |
| `integration/rejection.test.ts` | Vitest + DB | 7 | Rejection; resubmission; correction; application decisions; notifications |
| `integration/permissions.test.ts` | Vitest + DB | 15 | Creator → operator/brand APIs; cross-creator IDOR; cross-workspace operator; role boundaries; revoked staff; break-glass secret; direct PostgREST abuse |
| `integration/hostile-input.test.ts` | Vitest + DB | 11 | Chinese and emoji text; XSS; oversize; malformed JSON; URL schemes; upload MIME and size; admin forms; passport privacy |
| `integration/concurrency.test.ts` | Vitest + DB | 8 | Double join and submit; edit under review; quota race; idempotent redemption; two operators approving; approve vs reject; stale admin edit |
| `integration/scale-lifecycle.test.ts` | Vitest + DB | 15 | Empty queues; 200 / 250 / 1,100-item queue; CRM paging; suspend; delete; session; failure mid-flow (budget, bootstrap, error leakage); notifications; cron |
| `static/contracts.test.ts` | Vitest (no DB, CI-safe) | 9 | Vercel method exports; deadline cron wiring; reward settlement; reward contract on accept; HKT and HKD formatting; withdrawal copy |
| `e2e/creator.spec.ts` | Playwright | 9 | Sign-in; onboarding redirect; join and submit at 375 px in HKT; creator on `/admin`; rejection reason; onboarding links; wallet loading; campaign error; public passport |
| `e2e/operator.spec.ts` | Playwright | 3 | Reviewer approves in the UI; one-click decline; finance-viewer landing page |
| `run-review-tests.mjs`, `run-review-e2e.mjs`, `vitest.review.config.ts`, `e2e/playwright.review.config.ts` | runners | – | Read keys from `supabase status`, refuse non-loopback targets, print no secrets |

### How to run

```bash
npx supabase start
```

```bash
node tests/review/run-review-tests.mjs
```

```bash
node tests/review/run-review-e2e.mjs
```

```bash
npx vitest run --config tests/review/vitest.review.config.ts
```

The last command runs the static contract checks only, with no database.

## 2. Expected-to-fail convention

`knownBug("F-xx", title, fn)` wraps a test that **passes while the defect exists**. Only the single assertion wrapped in `defect(() => …)` is allowed to fail:
- **Setup errors fail the test.** SQL errors, other assertion failures and navigation timeouts make it **red**, so a broken fixture can't pass as a "confirmed bug". This happened twice during authoring (a wrong column name, then a wrong CHECK value). Plain `it.fails` would have hidden both.
- **Fixes are detected.** When the defect is fixed, the test goes **red** with `F-xx appears FIXED — remove the knownBug marker`. That is the signal to turn it into a normal regression test.

## 3. Results

| Suite | Files | Tests | Passed | Failed | Of which known-bug (defect reproduced) |
|---|---|---|---|---|---|
| Review: static (no DB) | 1 | 9 | 9 | 0 | 8 |
| Review: integration (local DB) | 6 | 59 | 59 | 0 | 21 |
| Review: Playwright (Chromium, `Asia/Hong_Kong`, `en-HK`) | 2 | 12 | 12 | 0 | 7 |
| **Total review suite** | **9** | **80** | **80** | **0** | **36** |
| Repo baseline: unit and component (`npm test`) | 261 (+44 skipped) | 2,765 | 2,402 | 0 | – (363 skipped) |
| Repo baseline: integration (`npm run test:integration`) | 40 | 441 | 187 | **102** | Blocked by the runner's identity gate (F-005); not app failures |

After adding the tests: `npm run lint` → 0 errors, the 4 pre-existing warnings. `tsc --noEmit` over `tests/review` → clean.

### 3.1 Defects reproduced by tests (24 findings)

| Finding | Test(s) | What the test showed |
|---|---|---|
| F-001 | static `contracts` | Routes use PATCH, and `api/index.ts` exports no PATCH. Runtime 405 on Vercel is still ❓; the in-process app accepts PATCH, so the integration PATCH test passes locally. |
| F-002 | hostile-input; e2e creator | The public passport JSON and page show the creator's sign-up email. |
| F-003 | permissions ×2 | A brand inserted an `active` mission with `points_reward = -500, cash_reward = 9999` through PostgREST. An owner `DELETE` erased a creator's submission. |
| F-004 | rejection ×2; concurrency; e2e operator | Reject with `{}` → 200. No `operator_audit_events` row. The losing operator gets a raw 400 RPC error, not 409. The UI Decline is final on one click. |
| F-006 | static | "Available to withdraw" / "可提現收益" copy exists while no payout route exists (probe also confirms 404). |
| F-007 | static ×2 | Wallet "pending" ignores `mission_pending_rewards`, and no migration settles them. |
| F-009 | scale-lifecycle | `auth.admin.deleteUser` fails for a creator holding an issued redemption code (FK). |
| F-010 | rejection; e2e creator | A rejected creator can't resubmit, and the reason isn't shown on the mission page. |
| F-012 | rejection; scale-lifecycle; static | No notification on correction request. The daily cron has no deadline-reminder step. |
| F-014 | hostile-input | A content editor uploaded `evil.html` (`text/html`) to the public bucket: 200. |
| F-016 | permissions; e2e operator | A finance viewer gets 403 on `/admin/insights`. The UI shows "Workspace access is required. Contact the owner." |
| F-017 | scale-lifecycle | A `status = 'suspended'` creator can still join missions. |
| F-018 | e2e creator | The onboarding "visit guide" link bounces back to `/onboarding`. |
| F-020 | static | Creator components format with `timeZone: "UTC"` or `.slice(0,10)`. |
| F-021 | scale-lifecycle | Bootstrap returns 200 while the `earnings_balances` row failed to insert (simulated outage). |
| F-022 | concurrency | A stale mission PATCH silently overwrote a newer edit (no 409). |
| F-026 | e2e creator | An unknown campaign shows "…" indefinitely. |
| F-028 | hostile-input ×2 | A 100,000-character `display_name` is stored. Malformed JSON on submit → 500. |
| F-029 | e2e creator | The wallet renders `HK$0.00` while earnings are still loading. |
| F-032 | scale-lifecycle | A budget-failure approval returns `code: "rpc_error"` with the raw Postgres message. |
| F-038 | static | The application-accept path calls `create_mission_workflow` without capturing a reward contract. |
| **F-046** | scale-lifecycle ×2 (+ boundary) | **The legacy submissions queue returns 500 "URI too long" at 250 pending items**, which is worse than the original truncation hypothesis, so it was re-rated Critical. 200 items still loads. |
| F-047 | permissions | A creator read another workspace's knowledge-base document. |
| F-048 | permissions | A creator inserted a `role = 'assistant'` message into their own history. |

### 3.2 Protections confirmed working (regression tests, all green)

- **Concurrency:**
  - Parallel double join or double submit creates one submission and awards +25 XP once.
  - A quota of 2 holds under 5 concurrent joins.
  - Same-intent redemption debits once.
  - Two reviewers approving in parallel credit once, with exactly one earnings transaction.
  - An approve-vs-reject race ends consistent (credit if and only if approved).
  - Resubmitting while under review is refused.
- **Authorization:**
  - Creator JWTs are refused on all `/api/admin/*` and `/api/brand/*` routes, and can't approve their own work.
  - No cross-creator read through the API or PostgREST.
  - An operator in workspace A gets 404 for B's items, including a `?workspace=` spoof.
  - The reviewer, finance and operator capability split holds.
  - A deactivated staff row is revoked.
  - The `ADMIN_SECRET` header grants nothing.
  - A brand sees only its own workspace through the API.
  - Locally, creators can't raise their own XP or status (production unverified, see F-049).
- **Input handling:**
  - Chinese and emoji names round-trip intact.
  - XSS payloads are returned as inert JSON.
  - Evidence URL schemes and credentials are validated.
  - Avatar uploads reject SVG, HTML and files over 5 MB.
  - Portfolio links reject `javascript:` URLs.
  - Application decline reasons are capped at 500 code points.
  - Admin rejects negative mission rewards.
- **Failure mid-flow:** approval on an insufficient enforced budget rolls back with no partial credit.
- **Notifications and cron:**
  - Approve and reject each emit exactly one notification.
  - The daily cron rejects a missing or wrong secret and runs cleanly with the right one.
- **Pagination and locale:**
  - The CRM creator list is server-paged (≤ 25).
  - The shared formatter renders HKT dates and HKD correctly (16:30 UTC → the 29th in HKT).
- **Browser:**
  - The UI sign-in, onboarding redirect, and join-and-submit flow work at 375 px with no horizontal overflow.
  - A creator session on `/admin` gets only 401/403 from the API, and no operator data renders.

## 4. Scenario matrix coverage

| Scenario | Creator | Operator | Status |
|---|---|---|---|
| Happy path, full lifecycle | ✅ legacy (signup → approve → credited). Active-workspace lifecycle not automated. | ✅ review → approve (API and UI) | Partial: active-workspace and payout can't be completed (F-006, F-007) |
| Rejection and resubmission | ✅ reason stored; ❌ resubmit (F-010) | ✅ reject; correction; application decline | Covered |
| Invalid / hostile input | ✅ | ✅ (mission create, content media, decline cap) | Covered |
| Permissions | ✅ | ✅ (cross-workspace, roles, revoked) | Covered |
| Concurrency | ✅ | ✅ | Covered |
| Failure mid-flow | ✅ bootstrap outage. ⚠️ upload failure and network drop not automated. | ✅ budget failure. ⚠️ webhook (none exist) and payout error (no payouts) N/A. | Partial |
| Empty and scale | ✅ empty account | ✅ empty queue; ❌ 250+ queue (F-046); CRM paging ✅ | Covered |
| Notifications | ✅ approve and reject; ❌ correction and deadlines | ⚠️ no operator notifications exist to test (F-013) | Covered with gaps |
| Account lifecycle | ✅ session tamper; ❌ delete (F-009); deletion and export probes | ✅ revoke staff; ❌ suspend (F-017) | Partial: password reset and change email need SMTP (Mailpit was excluded) |
| Timezone / locale | ✅ HKT formatter; ❌ UTC components (F-020); E2E in `Asia/Hong_Kong` | ⚠️ reports and cut-offs not tested (no exports exist) | Partial |

## 5. Coverage gaps (not automated, with reason)

1. **The active-workspace lifecycle end to end** (draft → review → revision → approve-to-publish → proof → completion → hand-off). It needs deliverable templates, private-bucket uploads and proof-URL fetching. The repo's own suites cover this behind the identity gate (F-005). **Recommendation:** once F-005 is fixed, run `server/test/active-missions.test.ts` and `reward-handoffs.test.ts` in CI.
2. **Runtime proof of F-001 on Vercel.** It needs a preview deploy. One `PATCH /api/admin/missions/x` without auth would settle it: 405 means the bug is present; 401 means it isn't.
3. **The production ACL check for F-049.** Needs read-only production access.
4. **Email flows** (magic link, password reset, change email). Mailpit and SMTP were not part of this run. Production SMTP is also still pending (F-036).
5. **Mobile proof-form overlap** (F-027) and **accessibility** (F-033). Not automated here. The repo has axe scans in `e2e/accessibility.spec.ts` behind its own fixture gate.
6. **Upload failure and network drop mid-upload,** and **session expiry mid-mutation in the UI** (F-035).
7. **LLM cost limits** (F-023). The gateway was deliberately disabled, so no paid AI was called.
8. **Brand portal UI** (F-035 logout and expiry). API-level brand tests only.

## 6. Notes on method

- **Real code paths:** tests call the real Hono app (`createApp().app.request`) with real Supabase Auth JWTs and real RLS. This is the same code Vercel runs, except that `api/index.ts` method exports are bypassed. That is exactly why F-001 needs a static test.
- **SQL fixtures:** direct SQL is used only to set up state the product has no API for, such as staff role grants, synthetic bulk users and suspension. App behaviour is always exercised through the API or UI.
- **One temporary trigger:** the F-021 test creates a trigger to simulate an outage and always removes it in `finally`.
- **Test data:** all users are `review-*@review.test` on the local stack. Nothing was created outside the local Docker containers.

## 7. Phase 5 re-run (after fixes, 2026-10-29)

| Suite | Before fixes | After fixes |
|---|---|---|
| `npm run lint` | 0 errors, 4 warnings | 0 errors, 4 warnings (unchanged, pre-existing) |
| `npm run type-check` | ✅ | ✅ |
| `npm run build` | ✅ | ✅ |
| `npm test` (unit/component) | 2,402 passed | **2,420 passed** (+18 new regression tests), 0 failed |
| Review: static and integration | 68 passed (29 known bugs) | **71 passed (12 known bugs)** |
| Review: Playwright | 12 passed (7 known bugs) | **12 passed (0 known bugs)** |

**New regression tests** in the repo's own suite, which CI runs:
- `server/apiEntry.test.ts` (F-001)
- `server/lib/contentMedia.test.ts` (F-014)
- `server/lib/profileInput.test.ts` (F-028)
- `src/routes/-admin.index.test.tsx` (F-016)

**Extended regression tests** (existing files):
- `server/test/cron-daily.test.ts` (F-012)
- `src/routes/-admin.submissions.test.tsx` (F-004)
- `src/routes/-admin.missions.manage.test.tsx` (F-053)
- `src/routes/-_app.mission.$missionSlug.test.tsx` (F-010)
- `src/routes/-_app.gate.test.tsx` (F-018)
- `src/routes/-_app.wallet.test.tsx` (F-029)
- `src/components/creator-activation.test.tsx` (F-006 copy)

Each fixed `knownBug` in `tests/review/` was converted to a normal test labelled `[F-xx fixed]`. The 12 that remain still reproduce, and all need a migration or a new feature: F-003 ×2, F-004 (audit), F-007 ×2, F-009, F-010 (resubmit), F-012 (correction notification), F-017, F-038, F-047, F-048.

One test-harness change was needed. `server/test/legacy-correction-validation.test.ts` uses a hand-written Supabase mock, which gained `.range()` for the paged queue reads (F-046). The real client is covered by the 250/1,100-row integration tests.
