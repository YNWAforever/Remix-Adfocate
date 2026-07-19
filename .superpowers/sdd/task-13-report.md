# Task 13 report: workflow notifications, analytics, and metric

## Scope and migration chronology

- Clean baseline: `aa5a3181f922603033fe99cd9744579f73d50a56`.
- The brief's `20260715090000_active_mission_workspace.sql` does not exist in this branch; the foundational migration is `20260715163350_active_mission_workspace.sql`.
- Later forward migrations override lifecycle functions through `20260719160000`. Task 13 therefore uses the CLI-generated, correctly ordered forward migration `20260719200000_active_mission_workflow_notifications.sql`.
- Existing atomic transition RPCs remain unchanged. AFTER UPDATE triggers emit best-effort notifications from durable transition rows.

## RED evidence

Command:

```text
npx.cmd vitest run server/test/notifications-triggers.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.test.ts --no-file-parallelism
```

Result: exit 1; 4 failed files; 15 failed, 20 passed, 6 skipped. Expected failures covered missing workflow notification SQL/types/translations, runtime analytics privacy leakage, and the missing metric module.

## GREEN evidence

The same focused command exited 0 with 4 passed files, 38 passed tests, and 6 guarded live tests skipped.

Additional verification:

- Related notification and active-mission schema suites: exit 0; 14 passed, 17 guarded live tests skipped.
- `npm.cmd run type-check`: exit 0; retains the pre-existing route-file naming warning for `src/routes/_site.smoke.test.tsx`.
- Touched-file ESLint: exit 0.
- `git diff --check`: exit 0.
- `npx.cmd supabase migration list --local`: confirms `20260719200000` sorts after `20260719160000`.
- `npx.cmd supabase db lint --local --schema public,private --level warning --fail-on error`: connected successfully but exits 1 on pre-existing `public.redeem_perk` ambiguous-column debt, with two additional pre-existing warnings. Task 13 functions are not applied to that divergent local database.

## Security, privacy, and error-boundary review

- Every Task 13 SECURITY DEFINER function has `search_path = ''` and schema-qualified relations.
- The internal notifier and trigger functions revoke EXECUTE from PUBLIC, anon, authenticated, and service_role, with no re-grant.
- The deadline emitter is intentionally service-only: it validates the service-role JWT, revokes all roles, then grants only service_role.
- The notification INSERT is isolated in a tight `exception when others then null` block after workflow transition row writes; payload keys are limited to mission title/slug, submission ID, deliverable title, deadline, version number, and reason category.
- Deadline notifications are idempotent by notification type, entity, deadline, version, and reason category. No scheduler or cloud resource was provisioned.
- The ten Phase 2 analytics event payloads contain only locale, mission type, state/action/error/timing categories, counts, and version/round numbers. A runtime allowlist strips untyped creator content and identifiers.

## Concerns

- Supabase-backed integration tests remain guarded because the test environment variables are unavailable.
- The running local database has substantially divergent migration history; it was inspected but not reset or mutated.
- The implementation commit hash is reported in the Task 13 handoff because a report cannot embed the hash of the same commit that contains it without changing that hash.
