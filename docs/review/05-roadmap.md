# 05 — Fix roadmap

Ordering principle: **unblock money and operations, then close privacy and compliance gaps, then raise quality.**
- Finding IDs refer to `02-findings.md`. Effort: S < 1 day · M = 1–3 days · L > 3 days.
- 🗄️ = needs a schema migration. Per the review rules, migrations need your sign-off before Phase 5.
- 🧪 = a `knownBug` test already exists in `tests/review/`. It flips red when the fix lands, then becomes a regression test.

## 1. Quick wins (each under a day; about 4–5 dev-days in total)

| # | Finding | Change | Effort | Test |
|---|---|---|---|---|
| Q1 | F-001 (Critical) | Add `export const PATCH = handle(app)` (and `OPTIONS`) to `api/index.ts`. Add a static test that every route method is exported. Smoke-test PATCH on a preview deploy. | S | 🧪 |
| Q2 | F-002 (High) | Mask contact-shaped names in the public passport with the existing `publicDisplayName()`. Stop defaulting `display_name` to email or phone at bootstrap, and backfill existing rows. The backfill is a one-off data fix, not a schema change. | S | 🧪 |
| Q3 | F-006 (Critical, copy part) | Replace "Available to withdraw / 可提現收益 / 可提取金額" and the `/earn` "cash you can withdraw" copy with honest wording ("Cash credits — paid by Fimmick finance"), and link a payout-policy page. | S | 🧪 |
| Q4 | F-012 (High, partial) | Call `emit_active_mission_deadline_notifications` from `/api/cron/daily` (better: an hourly cron). | S | 🧪 |
| Q5 | F-010 (High, UX part) | Show `review_notes` for `rejected`. Change the "needs work" notification copy until resubmission exists. | S | 🧪 |
| Q6 | F-016 | Redirect `/admin` to the first page the role may open. Gate the financial insights section behind `reward.read`. | S | 🧪 |
| Q7 | F-018 | Allow `/guide*` and `/profile` during onboarding, or drop the links. Add sign-out to the onboarding shell and the nav. | S | 🧪 |
| Q8 | F-020 | Route every creator-facing date through `formatCreatorDate` (Asia/Hong_Kong). Ban `timeZone:"UTC"` and `.slice(0,10)` in `src/` with a lint rule. | S | 🧪 |
| Q9 | F-021 | Check each bootstrap upsert's error and return 503, or move bootstrap into one RPC. | S | 🧪 |
| Q10 | F-026, F-029 | Add error, not-found and loading states to campaign detail and the wallet. Use `Intl` HKD formatting with sign. | S | 🧪 |
| Q11 | F-014 | Allow-list image MIME types, check magic bytes and cap size at 5 MB for `/admin/content/media`. Set the bucket's `allowed_mime_types` and `file_size_limit` (storage config, no table change). | S | 🧪 |
| Q12 | F-032 (part) | Add Hono `app.onError` and replace `error.message` passthroughs with code-mapped messages. | S | 🧪 |
| Q13 | F-034, F-037, F-040 | Keep the staff deep link through sign-in, hide actions on decided submissions, and catch `mutateAsync` rejections. | S | – |
| Q14 | F-036, F-050 | Fix the runbook (remove the `ADMIN_SECRET` instructions), stale code comments and the journey docs. | S | – |
| Q15 | F-049 | **Verification, not code.** Run the read-only ACL query on production for `creators` and every public table. | S | – |

## 2. Must-fix before launch (beyond the quick wins)

| # | Finding | Change | Effort | Notes |
|---|---|---|---|---|
| L1 | **F-046 (Critical)** | Paginate the legacy submissions, applications, engaged, missions and campaigns queues on the server (cursor). Enrich rows with SQL joins or an RPC, not `in.(ids)` in the URL. Use `count: exact, head: true` badges. Filter proof reviews by work item. | M | 🧪 (the 250 and 1,100 tests become regressions) |
| L2 | **F-003 (High)** | Revoke `INSERT/DELETE` on `missions`, `campaigns` and `campaign_missions` from `authenticated`, and route brand writes through the API. Add CHECKs on reward, quota and filled. Require staff approval before a brand publishes a cash mission. | M | 🗄️ 🧪 |
| L3 | **F-004 (High)** | Legacy approve/reject: require a reason on reject. Pass `p_operator` and write `operator_audit_events` in the same transaction. Add an `expected_revision` precondition (409 on a race). Add a confirmation dialog. | M | 🗄️ 🧪 |
| L4 | **F-007 + F-038 (High)** | Capture the reward contract when an application is accepted. Define the settlement transition for `mission_pending_rewards` (an idempotent RPC that writes the points, earnings and XP ledgers with a unique `source_ref`). Include pending hand-offs in wallet "pending". | M | 🗄️ 🧪 |
| L5 | **F-008 (High)** | Consent at signup or onboarding: T&C, Privacy and PICS acceptance stored with version and timestamp. Separate marketing consent. | M | 🗄️ |
| L6 | **F-009 (High)** | At minimum before launch: a documented deletion-request process plus an operator-run anonymisation RPC that scrubs PII, revokes passports, deletes storage and keeps pseudonymous ledgers. Fix the blocking FKs. Self-service can follow (S1). | M–L | 🗄️ 🧪 |
| L7 | **F-005 (High)** | Make the integration suite runnable in CI on Linux. Add an "ephemeral CI target" mode to the identity guard and re-enable the job for every PR. | M | Unlocks the active-workspace regression suites |
| L8 | **F-032 (High)** | Error tracking (Sentry or Vercel Observability) on client and server. Alert on cron `errors[]` and on notification-delivery failures. | M | 🧪 |
| L9 | **F-022 (High)** | Optimistic locking on mission and campaign edits (`expected_updated_at`). Make publish conditional on the current status, and make the campaign broadcast idempotent. | S–M | 🧪 |
| L10 | **F-012 (rest)** | Add a `submission_correction_requested` notification type. | S | 🗄️ 🧪 |
| L11 | **F-047, F-048** | Scope knowledge-base reads to global plus own workspace. Revoke creator write access on assistant tables. | S | 🗄️ 🧪 |
| L12 | **F-023** | Per-user rate limits and caching for `/match` and `/copilot`, plus a gateway spend cap. | S–M | – |
| L13 | **F-036** | Production config: Supabase redirect allow-list, production SMTP, and reconciling the migration tracker before the next `db push`. | S | Ops |
| L14 | **F-006 decision** | Product decision: how and when creators are paid (manual FPS batch is fine to start), communicated in-product. See S1 for the build. | – | Business |

## 3. Next 30 days

| # | Finding | Change | Effort |
|---|---|---|---|
| N1 | F-013 | Operator signals: active-queue badge, an SLA-overdue filter, and a daily digest (email or Slack) of stuck items. Enforce or remove the 48 h `review_deadline`. | M |
| N2 | F-015 | Staff-access screen (the API exists), brand-invite screen and gift-code upload screen. Decide on, or delete, domain auto-promotion. | M |
| N3 | F-017 | Suspend and reinstate with reason and audit, enforced in `workspaceAuth` and the join/submit RPCs. | M 🗄️ |
| N4 | F-035 | MFA (`aal2`) for staff. Central 401 handling for mutations. Brand logout and session-expiry handling. | M |
| N5 | F-010 (rest) | Resubmission after rejection, bounded by `revision_limit`, or an explicit "not accepted, closed" outcome. | S–M 🗄️ |
| N6 | F-024, F-025, F-027 | Align onboarding and verification platforms. Fix `/my` status grouping and workspace links. Localize the proof form and fix its mobile offset. | M |
| N7 | F-028 | Request-schema validation (zod) on all write routes, with limits mirrored in DB CHECKs. | M |
| N8 | F-039, F-041 | Budget screen with idempotent credit. Gift stock derived from the code pool. Mandatory `client_request_id`. Physical-gift fulfilment type. | M 🗄️ |
| N9 | F-052, F-051, F-043 | Audit coverage for budget, settlement, membership and brand edits, with an append-only audit table. Revoke default `TRUNCATE/TRIGGER/REFERENCES` grants. Shortlist RPC. | M 🗄️ |
| N10 | F-011 | Real support channel: a WhatsApp Business deep link with the submission id, or a `support_requests` table and operator queue. | S–M |
| N11 | F-033 | Accessibility pass: landmarks, labels, unread state, `role=status`. Add an axe scan to CI. | S–M |
| N12 | F-031, F-042 | Implement or remove unreachable states. Pin the resolved IP in the proof-URL fetch. Enforce asset grant expiry in storage policies. | S–M |

## 4. Strategic improvements (one quarter or more)

1. **Creator payouts (F-006).**
   - Payout-details capture: FPS ID or bank, name match, and the HK tax and identity checks the business requires.
   - A withdrawal request state machine: `requested → approved → paid | failed | reversed`.
   - A finance queue with batch export (CSV/FPS) and reconciliation against the ledger.
   - Creator-visible payout history.
2. **One reward pipeline.** Converge the legacy instant credit and the active-workspace hand-off into a single contract → decision → settlement pipeline with one ledger. That removes the two parallel models (F-007).
3. **Notifications platform (F-012, F-013).** An outbox table with retries, plus email and WhatsApp channels, per-user preferences, and operator-facing notifications.
4. **Brand value loop (F-045).** A brand results view (applicants, approved content, proof links, spend vs budget) and in-product budget funding, so brands can self-serve without staff in the loop.
5. **Operator scale (F-045, F-046).** Bulk actions, saved filters, CSV exports with HKT cut-offs, and SLA dashboards.
6. **Privacy programme (F-008, F-009).** PDPO-aligned data inventory, retention schedule, self-service export and deletion, and a DPA with processors (Supabase, Vercel, AI gateway, RapidAPI).
7. **Test and release simplification (F-005).** The bespoke identity, fingerprint and evidence tooling around tests now blocks ordinary CI. Keep the safety intent (never hit shared targets) with a simpler, standard ephemeral-database CI path.
8. **Creator analytics (F-044).** Per-mission reach and engagement from proof metadata; earnings over time.

## 5. Missing features

### For creators

| Feature | Blocks earning or retention? | Finding |
|---|---|---|
| Get paid: payout details, withdrawal, payout history | **Yes, blocks earning** | F-006 |
| Active-mission reward actually credited | **Yes** | F-007, F-038 |
| See the rejection reason and resubmit | Yes (retention) | F-010 |
| Email or WhatsApp notifications and deadline reminders | Yes (missed deadlines) | F-012 |
| Working support channel and disputes | Yes (trust) | F-011 |
| Consent, account deletion, data export, change email or phone | Compliance | F-008, F-009 |
| Verification for TikTok, YouTube and 小紅書 | Limits eligible missions | F-024 |
| Per-mission performance analytics | Retention | F-044 |
| Browse missions before signup | Acquisition | F-019 |

### For operators

| Feature | Blocks running ops? | Finding |
|---|---|---|
| A queue that works past about 250 items, with pagination and true counts | **Yes** | F-046 |
| Saving edits in production (PATCH) | **Yes (if F-001 is confirmed)** | F-001 |
| Audit and reason on legacy approve/reject | Yes (finance and accountability) | F-004 |
| Payout execution, reconciliation, exports | Yes (finance) | F-006, F-045 |
| Staff role, brand invite and gift-code screens | Yes (no SQL needed to onboard staff) | F-015 |
| Suspend and reinstate creators | Yes (trust and safety) | F-017 |
| Alerts for new work and SLA breaches; failed-job visibility | Yes (stuck items) | F-013, F-032 |
| Budget funding and enforcement screen | Needed for cash missions | F-039 |
| Bulk actions, CSV exports | Scale | F-045 |
| MFA for staff who move money | Security | F-035 |
