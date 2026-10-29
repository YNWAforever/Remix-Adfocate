# Adfocate — End-to-end review: executive summary

**Date:** 2026-10-29 · **Commit:** `15f8ed1` (main) · **Scope:** creator and operator journeys, plus the brand portal.
**Method:**
- Code and schema review of 78 migrations and about 5k lines of API, plus the SPA.
- Baseline gates.
- **80 new scenario tests** (Vitest and Playwright) against a disposable local Supabase stack.

Details: `00-actors` · `01-journeys` · `02-findings` (52 findings) · `03-scorecard` · `04-test-report` · `05-roadmap`.

## Readiness

| Actor | Rating | Why |
|---|---|---|
| **Creators** | 🔴 **Red** | They can sign up, join, submit and earn points, but **cannot be paid**: there is no payout flow, active-mission rewards are never credited, and the UI says cash is "withdrawable". A shared passport **exposes their email**. There is no consent capture, account deletion or data export. Draft autosave **likely fails on Vercel**. |
| **Operators** | 🔴 **Red** | The legacy review queue **returns a server error once about 250 items are pending**. Mission, campaign and CMS edits **likely fail on Vercel** (no PATCH export). Approvals that credit cash leave **no operator audit and need no reason**. Staff can only be onboarded by SQL. |
| Pilot (single workspace, internal) | 🟠 **Amber, conditional** | Reaches Amber once quick wins Q1–Q3, Q8 and Q12 land, together with L1 (queue pagination), L3 (audit) and an agreed manual payout process. |

**What's strong:**
- **Authorization.** The staff API denies by default, and every resource id is scope-checked. Tests found no cross-creator or cross-workspace leak through the API.
- **Money safety under concurrency.** No double credit, quota never overfills, redemption is idempotent, and approval rolls back atomically.
- **The active-mission review flow.** It uses revisions and idempotency keys, and requires reasons.
- **A large existing unit suite.** 2,402 passing tests.

## Top 10 risks

| # | Risk | Sev | Evidence |
|---|---|---|---|
| 1 | Legacy review queue returns 500 from about 250 pending submissions, halting operations | Critical | F-046: `server/routes/admin.ts:147-169`; tested 200 → OK, 250 → "URI too long" |
| 2 | PATCH not exported in the Vercel entry, so draft autosave and all admin edits likely 405 in production | Critical (❓ runtime) | F-001: `api/index.ts`; 8 PATCH routes |
| 3 | Creators can't be paid; "withdrawable" copy promises what doesn't exist; active rewards never settle | Critical | F-006, F-007, F-038 |
| 4 | Public passport leaks creator email or phone | High | F-002: `server/routes/me.ts:75`, `server/lib/publicPassport.ts:124`; tested |
| 5 | Brands can write missions directly via PostgREST (negative or huge rewards, cascade deletes) | High | F-003: `0023_brand_access.sql:36-42`; tested |
| 6 | Cash-crediting approvals and rejections: no operator, no audit, no reason | High | F-004: `server/routes/admin.ts:171-240`; tested |
| 7 | No consent capture; account deletion impossible; no data export (PDPO exposure) | High | F-008, F-009; deletion tested |
| 8 | DB integration suite can't run in CI, so regressions in RLS and money logic go unseen | High | F-005: `scripts/run-integration-tests.mjs:86-153` |
| 9 | No error tracking; raw DB errors reach users; cron failures are silent | High | F-032; tested |
| 10 | Production may still let creators edit their own XP and status (inherited broad grants), unverified | High (❓) | F-049: `0004_grants.sql:1-7`, `20261023192141_*.sql:2` |

## Top 5 recommendations

1. **Ship the one-day fixes now** (`05-roadmap` Q1–Q12): the PATCH export, passport masking, honest payout copy, deadline cron, rejection reason, HKT dates, and a safe error handler. Each has a test that flips when it's fixed.
2. **Make the review queue scale and auditable** (L1, L3). Use server pagination with SQL-side enrichment. Require a reason and record operator plus audit on legacy approve/reject, with a 409 on races.
3. **Decide and build the money path end to end** (L4, L14, then S1). Capture contracts on accept and settle pending rewards into the ledger. Agree an interim manual payout process, and tell creators in-product how and when they're paid.
4. **Close the data-protection gaps before any public signup** (L2, L5, L6, Q2, L11). Revoke brand direct-writes and add reward CHECKs. Add consent and an anonymising deletion path, and scope knowledge-base reads. **Verify production database grants (F-049) this week.**
5. **Restore the safety net** (L7, L8). Get the integration suite running in CI on every PR, add error tracking and alerting, and adopt `tests/review/` as the regression suite for these findings.
