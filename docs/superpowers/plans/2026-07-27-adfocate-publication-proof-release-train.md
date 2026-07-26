# Adfocate Publication Proof Release Train Implementation Plan

> **For Codex:** Execute with `superpowers:subagent-driven-development`, one independently reviewed task at a time. Use `superpowers:test-driven-development` for behavior changes, `superpowers:systematic-debugging` for unexpected failures, and `superpowers:verification-before-completion` before completion claims.

**Goal:** Finish Tasks 11-14 of publication proof and publish a release-ready PR without merging or deploying.

**Architecture:** Preserve every existing migration. Add one new migration for best-effort proof notifications and one for the explicit existing-approved setup RPC. Extend the typed analytics allowlist and pure metrics calculator around the current state machine. Use one deterministic creator/operator fixture for live integration and both browser viewports. Clean replay, unskipped Phase 3 integration, reward neutrality, static verification, and browser acceptance are hard gates.

**Stack:** TypeScript, React 19, TanStack Router/Query, Hono, Supabase/Postgres, Vitest, Vite, PowerShell, browser automation, GitHub.

**Approved design:** `docs/superpowers/specs/2026-07-26-adfocate-publication-proof-release-train-design.md`

---

## Execution rules

- Work in `C:\Users\laich\Documents\Adfocate\worktrees\creator-activation-spine` on `codex/publication-proof-validation-design`.
- Do not edit, squash, rename, or reorder existing migrations.
- New SQL:
  - `supabase/migrations/20260727120000_publication_proof_instrumentation.sql`
  - `supabase/migrations/20260727130000_publication_proof_existing_setup.sql`
- Start every behavior change with a focused failing test and end with that test passing.
- Notification failure must not fail or roll back its workflow transition.
- Analytics must never emit URLs, authored copy, handles, object paths, correction prose, personal identifiers, or database entity IDs.
- `proof_verified` must not mutate submission status, points, XP, earnings, rewards, redemptions, or workspace budget.
- A release-gate defect returns to its owning task for RED-GREEN before the release sequence restarts.

## Task 1: Close Task 11

**Review:** `src/components/admin/PublicationProofReview.tsx`, its tests, `src/lib/admin.ts`, `server/routes/adminActiveMissions.ts`, commits `117f76b` and `fd71a99`.

1. Review:

   ```powershell
   git diff 117f76b^..fd71a99 -- src/components/admin/PublicationProofReview.tsx src/components/admin/PublicationProofReview.test.tsx src/lib/admin.ts server/routes/adminActiveMissions.ts
   ```

   Check exact-attempt anchoring, stale recovery, keyboard/focus/live announcements, confirmation safety, retries, and absence of reward controls.

2. Run:

   ```powershell
   npm.cmd test -- src/components/admin/PublicationProofReview.test.tsx src/routes/-admin.active-missions.test.tsx server/test/active-missions.test.ts
   ```

   Expected: PASS and no unresolved P0-P2 findings.

3. If a defect exists, add a focused failing test, apply the minimum fix, rerun step 2, and commit:

   ```powershell
   git add src/components/admin/PublicationProofReview.tsx src/components/admin/PublicationProofReview.test.tsx src/lib/admin.ts server/routes/adminActiveMissions.ts
   git commit -m "fix: close publication review findings"
   ```

   If unchanged, record approval in the final verification report.

## Task 2: Put Phase 3 in the integration launcher

**Modify:** `scripts/run-integration-tests.mjs`, `server/test/run-integration-tests.test.ts`.

1. Add these to `expectedIntegrationFiles` before `notifications-triggers.test.ts`:

   ```ts
   "server/test/active-mission-schema.test.ts",
   "server/test/active-missions.test.ts",
   ```

2. Run `npm.cmd test -- server/test/run-integration-tests.test.ts`.

   Expected: FAIL because the executable launcher omits them.

3. Make `integrationFiles` exactly match the ordered test contract. Preserve uniqueness, `--no-file-parallelism`, signal forwarding, exit codes, and the current environment-spread expression with `RUN_INTEGRATION: "1"` overriding the inherited value.

4. Rerun the test; expected PASS.

5. Commit:

   ```powershell
   git add scripts/run-integration-tests.mjs server/test/run-integration-tests.test.ts
   git commit -m "test: run publication proof integration suites"
   ```

## Task 3: Add the deterministic release fixture

**Create:** `server/test/fixtures/publicationProofRelease.ts`, `server/test/fixtures/publicationProofRelease.test.ts`, `scripts/seed-publication-proof-acceptance.ts`.

**Modify:** `server/test/helpers.ts`, `package.json`.

1. Write a failing test for:

   ```ts
   export type PublicationProofReleaseFixture = {
     workspace: { id: string; slug: string };
     creator: { id: string; email: string; jwt: string };
     operator: { id: string; email: string; jwt: string };
     mission: { id: string; slug: string };
     submission: { id: string };
     workflow: { id: string };
     items: {
       requiredMetadataSuccess: { id: string };
       requiredMetadataUnavailable: { id: string };
       optionalEvidence: { id: string };
       existingApprovedSetupRequired: { id: string };
     };
     rewardBaseline: Awaited<ReturnType<typeof creatorRewardSnapshot>>;
     budgetBaseline: Record<string, unknown>;
   };
   export async function seedPublicationProofReleaseFixture():
     Promise<PublicationProofReleaseFixture>;
   ```

   Assert replay-safe seeding, active operator membership, required/optional items, one approved item with no instruction/attempt, evidence-required/optional policies, both metadata paths, and pre-action reward/budget snapshots.

2. Run `npm.cmd test -- server/test/fixtures/publicationProofRelease.test.ts`.

   Expected: FAIL because the module is absent.

3. Implement using `seedActiveMission`, `makeStaff`, `serviceForTests`, `userForJwt`, `creatorRewardSnapshot`, and `DEMO_WS`. Use stable fixture slugs/emails; resolve generated IDs. Clean only fixture-owned rows or use conflict-safe writes.

4. Make the script call the same function and print only workspace slug, fixture emails, mission slug, submission/workflow IDs, and named item IDs. Never print JWTs, keys, passwords, magic links, or signed URLs.

5. Add:

   ```json
   "seed:publication-proof-acceptance": "vite-node scripts/seed-publication-proof-acceptance.ts"
   ```

6. Rerun the fixture test; expected PASS.

7. Commit:

   ```powershell
   git add server/test/fixtures/publicationProofRelease.ts server/test/fixtures/publicationProofRelease.test.ts scripts/seed-publication-proof-acceptance.ts server/test/helpers.ts package.json
   git commit -m "test: add publication proof release fixture"
   ```

## Task 4: Add best-effort publication-proof notifications

**Create:** `supabase/migrations/20260727120000_publication_proof_instrumentation.sql`.

**Modify:** `server/test/notifications-triggers.test.ts`, `src/lib/notifications.ts`, `src/lib/i18n.dict.ts`, `src/components/active-mission/active-mission.i18n.test.tsx`.

Notification families: reuse `mission_approved_to_publish`, `mission_deadline_approaching`, and `mission_deadline_overdue`; add `mission_publication_correction_requested` and `mission_publication_verified`.

1. Add failing tests proving the new migration:
   - additively extends the notification constraint;
   - observes correction and verification events;
   - uses semantic dedupe;
   - limits payload to mission title/slug, submission, deliverable, deadline, attempt number, and reason categories;
   - catches notification insert errors;
   - contains no scheduler, reward, submission-status, XP, earnings, or budget mutation.

   Add renderer, link, icon, and bilingual-key assertions for the two new types.

2. Run:

   ```powershell
   npm.cmd test -- server/test/notifications-triggers.test.ts src/components/active-mission/active-mission.i18n.test.tsx
   ```

   Expected: FAIL on absent migration, types, and copy.

3. Implement a revoked `security definer set search_path = ''` private notifier. Keep dedupe claim and insert in one exception-safe block:

   ```sql
   begin
     insert into private.mission_workflow_notification_dedupe
       (recipient_id, notification_type, entity_type, entity_id, semantic_key)
     values
       (p_recipient, p_type, 'mission_work_item', p_work_item, p_semantic_key)
     on conflict do nothing;
     get diagnostics v_claimed = row_count;
     if v_claimed = 0 then return false; end if;

     insert into public.notifications
       (user_id, type, data, entity_type, entity_id)
     values
       (p_recipient, p_type, v_data, 'mission_work_item', p_work_item);
     return true;
   exception when others then
     return false;
   end;
   ```

4. Extend `NotificationType`, `ICONS`, `hrefFor`, and both locales with:
   - `app.notif.mission_publication_correction_requested.{title,body}`
   - `app.notif.mission_publication_verified.{title,body}`

5. Rerun step 2; expected PASS, including live best-effort failure when integration is enabled.

6. Commit:

   ```powershell
   git add supabase/migrations/20260727120000_publication_proof_instrumentation.sql server/test/notifications-triggers.test.ts src/lib/notifications.ts src/lib/i18n.dict.ts src/components/active-mission/active-mission.i18n.test.tsx
   git commit -m "feat: notify publication proof outcomes"
   ```

## Task 5: Add privacy-safe analytics and eight metrics

**Modify:** `src/lib/activationAnalytics.ts`, `server/lib/activeMission/metrics.ts`, `server/lib/activeMission/metrics.test.ts`, `src/lib/i18n.dict.ts`, `src/components/active-mission/active-mission.i18n.test.tsx`.

**Create:** `src/lib/activationAnalytics.test.ts`.

1. Add failing allowlist tests for:

   ```ts
   [
     "publication_instructions_viewed",
     "publication_proof_form_started",
     "publication_proof_submitted",
     "publication_proof_metadata_unavailable",
     "publication_proof_review_started",
     "publication_proof_correction_requested",
     "publication_proof_resubmitted",
     "publication_proof_verified",
     "publication_proof_recovery_used",
   ] as const
   ```

   Allowed properties are event-specific subsets of locale, mission type, platform, state, timing bucket, attempt/review number, URL/evidence count, lateness, metadata status, checklist failure categories, and recovery category. Assert forbidden fields are dropped.

2. Add failing tests for:

   ```ts
   export type PublicationProofMetricRow = {
     required: boolean;
     approvedToPublishAt: string | null;
     publicationDueAt: string | null;
     firstSubmittedAt: string | null;
     verifiedAt: string | null;
     attemptCount: number;
     correctionCount: number;
     reviewStartedAt: string | null;
     reviewCompletedAt: string | null;
     metadataStatus: "available" | "unavailable" | null;
     staleRecoveryCount: number;
   };
   export type RateMetric = { numerator: number; denominator: number; rate: number };
   export type PublicationProofOperationalMetrics = {
     submissionConversion: RateMetric;
     onTimePublication: RateMetric;
     firstAttemptVerification: RateMetric;
     correctionRequest: RateMetric;
     averageAttemptsPerVerifiedItem: number;
     medianReviewTimeMs: number | null;
     metadataFailure: RateMetric;
     staleRecovery: RateMetric;
   };
   ```

   Cover all eight metrics, invalid dates, zero denominators, even/odd median, required/optional denominators, and reward neutrality.

3. Run:

   ```powershell
   npm.cmd test -- src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.test.ts
   ```

   Expected: FAIL on absent events and aggregate calculator.

4. Extend `ActivationEventMap` and `ACTIVATION_PROPERTY_KEYS`; keep `trackActivationEvent` fail-closed.

5. Implement `calculatePublicationProofOperationalMetrics(rows)`. Use explicit denominators, finite non-negative review durations, zero rates for empty denominators, and `null` for absent median. Retain `calculateOnTimeApprovalMetric`.

6. Add explicit English and Traditional Chinese status, validation, checklist, correction, metadata, recovery, confirmation, notification, and metric strings. Locale tests must compare key sets and reject blanks.

7. Run:

   ```powershell
   npm.cmd test -- src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.test.ts server/test/notifications-triggers.test.ts src/components/active-mission/active-mission.i18n.test.tsx
   ```

   Expected: PASS.

8. Commit:

   ```powershell
   git add src/lib/activationAnalytics.ts src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.ts server/lib/activeMission/metrics.test.ts src/lib/i18n.dict.ts src/components/active-mission/active-mission.i18n.test.tsx
   git commit -m "feat: measure publication proof operations"
   ```

## Task 6: Add explicit setup for existing approved items

**Create:** `supabase/migrations/20260727130000_publication_proof_existing_setup.sql`.

**Modify:** `server/routes/adminActiveMissions.ts`, `server/test/active-mission-schema.test.ts`, `server/test/active-missions.test.ts`, `src/lib/admin.ts`, `src/components/admin/PublicationProofReview.tsx`, `src/components/admin/PublicationProofReview.test.tsx`.

RPC:

```sql
public.setup_existing_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
```

1. Add failing static/live tests for active operator membership; locked matching workflow/item; exact approved state/revision; UUID idempotency; no instruction/attempt; complete operator-authored policy; immediate frozen snapshot; privacy-safe audit; exact replay; changed-payload conflict; wrong state/workspace/operator; history rewind rejection; no inferred defaults; unchanged rewards/budget.

2. Run:

   ```powershell
   npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts
   ```

   Expected: FAIL because the RPC is absent.

3. Implement a private worker and public `security definer set search_path = ''` wrapper. Validate `auth.jwt()`, reuse the operator assertion, lock canonical rows, validate anchors, insert and freeze once, append the idempotency key, and emit `mission_publication_existing_instructions_setup` without authored fields. Revoke public/anon/authenticated; grant only the existing server role.

4. Add a separate repository method calling only the new RPC:

   ```ts
   async setupExistingPublicationInstructions(input) {
     const workspace = await workspaceId(client, input.workspaceSlug);
     const result = await client.rpc("setup_existing_publication_instructions", {
       p_workspace: workspace,
       p_workflow: input.workflowId,
       p_work_item: input.workItemId,
       p_operator: input.operatorId,
       p_expected_state: input.expectedState,
       p_expected_revision: input.expectedRevision,
       p_idempotency_key: input.idempotencyKey,
       p_instructions: {
         publication_instructions: input.instructions.publicationInstructions,
         publication_window_hours: input.instructions.publicationWindowHours,
         required_disclosures: input.instructions.requiredDisclosures,
         expected_account: input.instructions.expectedAccount,
         proof_evidence_policy: input.instructions.proofEvidencePolicy,
       },
     });
     // Reuse dbError and stable OperatorActiveMissionError mapping.
   }
   ```

5. Expose `POST /admin/active-missions/:workflowId/work-items/:workItemId/publication-setup`. Do not silently fall back from `set_publication_instructions`.

6. Add `setupActiveMissionPublicationInstructions` to `src/lib/admin.ts`. Show “Set up publication proof” only for `PUBLICATION_SETUP_REQUIRED`; require confirmation and call the separate endpoint. Preserve Task 11 stale-state focus/retry behavior.

7. Run:

   ```powershell
   npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts src/components/admin/PublicationProofReview.test.tsx
   ```

   Expected: PASS.

8. Commit:

   ```powershell
   git add supabase/migrations/20260727130000_publication_proof_existing_setup.sql server/routes/adminActiveMissions.ts server/test/active-mission-schema.test.ts server/test/active-missions.test.ts src/lib/admin.ts src/components/admin/PublicationProofReview.tsx src/components/admin/PublicationProofReview.test.tsx
   git commit -m "feat: set up existing publication proof items"
   ```

## Task 7: Document rollback and recovery

**Create:** `docs/operations/publication-proof-release-runbook.md`.

**Modify:** `docs/operations/active-mission-workspace.md`, `server/test/active-mission-schema.test.ts`.

1. Add a failing documentation contract requiring: blocked-item query, setup request, overdue priority, metadata retry, stale recovery, feature disable/re-enable, record preservation, reward-neutrality queries, and no destructive rollback SQL.

2. Run `npm.cmd test -- server/test/active-mission-schema.test.ts`; expected FAIL.

3. Document that feature disable blocks new creator proof mutations and operator queue/review actions at the route/feature boundary. It must not reverse migrations, delete records/storage, or rewrite Phase 2/3 states. Include exact diagnostics without credentials or user data.

4. Run `npm.cmd run test:active-missions`; expected PASS, including legacy `content_urls` and reward approval.

5. Commit:

   ```powershell
   git add docs/operations/active-mission-workspace.md docs/operations/publication-proof-release-runbook.md server/test/active-mission-schema.test.ts
   git commit -m "docs: add publication proof rollout runbook"
   ```

## Task 8: Clean replay and live integration

**Create:** `docs/verification/2026-07-27-publication-proof-release.md`.

1. Preflight:

   ```powershell
   docker version
   supabase --version
   node --version
   npm.cmd --version
   supabase status
   ```

   Check ports 54320-54329 and browser runtime. Free local prerequisites may be installed; do not touch cloud resources, production secrets, or production data.

2. Replay:

   ```powershell
   supabase start
   supabase db reset
   ```

   Expected: every migration applies in order and seed completes on an empty database.

3. Export local-only environment without recording keys:

   ```powershell
   $status = supabase status -o env
   $env:RUN_INTEGRATION = '1'
   $env:SUPABASE_URL = (($status | Select-String '^API_URL=').ToString().Split('=',2)[1]).Trim('"')
   $env:SUPABASE_ANON_KEY = (($status | Select-String '^ANON_KEY=').ToString().Split('=',2)[1]).Trim('"')
   $env:SUPABASE_SERVICE_KEY = (($status | Select-String '^SERVICE_ROLE_KEY=').ToString().Split('=',2)[1]).Trim('"')
   ```

4. Run `npm.cmd run seed:publication-proof-acceptance`, then `npm.cmd run test:integration`.

   Expected: secret-free fixture JSON, exit 0, and Phase 3 schema/workflow/notification suites execute rather than skip.

5. Record commands, timestamps, exits, replay, executed suites, and unchanged warnings in the verification report. A discovered defect returns to its owning task.

## Task 9: Full static and build verification

1. Run in order:

   ```powershell
   npm.cmd run test:active-missions
   npm.cmd test
   npm.cmd run lint
   npm.cmd run type-check
   npm.cmd run build
   ```

   Expected: every command exits 0; build completes ESM check, route generation, TypeScript, and Vite.

2. A touched-surface failure returns to its owner for RED-GREEN, then Task 8 restarts. Prove and document any unchanged baseline warning; baseline failures still block release unless explicitly allowed.

3. Record exact commands, exits, passing counts, build result, and warning classification.

## Task 10: Browser acceptance and reward neutrality

1. Start the app against local Supabase with `npm.cmd run dev`.

2. Capture fixture submission status, creator points/XP, earnings, transactions, redemptions/rewards, workspace budget, and budget transactions.

3. Creator at 390 x 844: instructions, URL/evidence validation, metadata-success submit, metadata-unavailable warning, correction attempt 2 with immutable attempt 1, history, exact verified message, stale recovery, keyboard/focus/live region/sticky action, and no horizontal overflow.

4. Operator at 1440 x 900: filters/canonical order, explicit setup, exact-attempt claim/checklist/correction/verify, signed evidence, stale recovery, metadata refresh, no reward control, keyboard/focus, and no horizontal overflow.

5. Repeat persisted queries. Expected: required items/workflow reach `proof_verified`; all proof history persists; submission status, points, XP, earnings, rewards/redemptions, and budget are unchanged.

6. Record viewport, route, scenario, result, and before/after comparison without credentials, tokens, raw signed URLs, or personal data.

## Task 11: Final review, push, and PR

1. Use `superpowers:requesting-code-review` on the full branch. Resolve findings through the owning task, then rerun Tasks 8-10.

2. Run:

   ```powershell
   git diff --check
   git status --short
   git log --oneline --decorate -15
   ```

   Expected before evidence commit: only the verification report is modified; no generated noise, secret-bearing screenshots, environment files, or unrelated changes.

3. Commit evidence:

   ```powershell
   git add docs/verification/2026-07-27-publication-proof-release.md
   git commit -m "docs: record publication proof release verification"
   git diff --check HEAD^
   git status --short
   ```

   Expected: diff check exits 0 and status is empty.

4. Push:

   ```powershell
   git push -u origin codex/publication-proof-validation-design
   ```

5. Use `github:yeet` or the GitHub connector to create a ready PR. Include Tasks 11-14, additive migrations, clean reset, unskipped integration, all verification results, both viewports, reward/budget neutrality, known warnings, and “merge/deploy out of scope.”

6. Confirm PR head SHA equals local `HEAD` and CI is queued/running. Do not merge or deploy.

---

## Completion checklist

- [ ] Task 11 re-review has no P0-P2 findings.
- [ ] Launcher includes Phase 3 suites.
- [ ] Deterministic shared fixture covers creator, operator, mixed items, setup, proof paths, and baselines.
- [ ] Existing migrations are unchanged and new migrations replay cleanly.
- [ ] Five notification families are best-effort.
- [ ] Nine analytics events are content-free and identifier-free.
- [ ] Eight metrics pass denominator and edge coverage.
- [ ] English/Traditional Chinese key sets match and are non-blank.
- [ ] Existing approved items use only explicit setup and cannot rewind history.
- [ ] Feature disable preserves every Phase 3 record.
- [ ] Phase 3 integration executes unskipped.
- [ ] Focused/full tests, lint, type-check, and build pass.
- [ ] Creator 390 x 844 and operator 1440 x 900 pass.
- [ ] Submission, reward, earnings, and budget state remain unchanged.
- [ ] Final review is clean; branch is pushed; ready PR exists.
- [ ] PR is not merged and no deployment occurs.
