# Phase 3 M1 — creator recovery after rejection

Status: shipped to production. Migration applied 2026-11-13 after explicit owner
approval; runtime merged in PR #156 (`4937b45`) and deployed to
`https://adfocate-2.vercel.app`.

## What ships

- `supabase/migrations/20261113090000_creator_resubmission.sql`
  - `mission_submissions.resubmit_count`
  - immutable `mission_submission_events` rows (`resubmitted`, prior status,
    reviewer-notes/points/XP/evidence-revision snapshots, payload hash, request id)
  - `public.resubmit_mission(p_mission, p_urls, p_data, p_request)`
- `PUT /api/missions/:slug/submit`
  - first submission keeps calling `submit_mission`;
  - a rejected submission answers `wrong_state` there, so the route retries
    through `resubmit_mission` with an idempotency request id;
  - new mapping: `revision_limit_reached`, `deadline_passed`,
    `IDEMPOTENCY_CONFLICT` → 409; missing RPC → 503 `schema_not_ready`.
- `GET /api/missions/my` returns `resubmit_count`, `revision_limit`,
  `resubmit_remaining`, `resubmit_available`, `closed`.
- Mission page: a rejected submission with revisions left shows the reviewer
  reason, remaining revisions, and the evidence form. Zero revisions or an
  unavailable schema renders the existing closed state instead.
- Resubmission never writes XP, points, earnings, or budget. It resets the
  review SLA and clears the previous review fields only after snapshotting them
  into `mission_submission_events`.

## Deploy order

1. Apply the migration (owner approval). **Done 2026-11-13.**
2. Deploy the runtime PR. **Done in PR #156.**
3. Verify with the first rejected submission before inviting creators. **Pending:
   production currently has 0 rejected submissions**, so the UI stays dark until
   an operator rejects one.

Merging the runtime PR before step 1 was safe: `/missions/my` falls back to the
pre-migration projection and hides the form (`resubmit_available: false`), and a
rejected submission returns `schema_not_ready` rather than a false success.

## Production application evidence (2026-11-13, Asia/Singapore)

Production `supabase_migrations.schema_migrations` only records a subset of the
reviewed history (several migrations were applied out of band), so the release
foundation preflight cannot be used as-is. The migration was therefore applied
as one `BEGIN … COMMIT` transaction over the operator database credential and
recorded as a new history row:

| Check | Result |
| --- | --- |
| `mission_submissions.resubmit_count` | present |
| `mission_submission_events` + RLS policy + 2 explicit indexes | present |
| `public.resubmit_mission(uuid,text[],jsonb,uuid)` | present, `SECURITY DEFINER`, owner `postgres` |
| function ACL | `postgres`, `authenticated`, `service_role` = EXECUTE |
| table ACL | `authenticated` SELECT, `service_role` ALL |
| `schema_migrations` row `20261113090000` | present |
| submissions before / after | 10 / 10, rejected 0 / 0 |
| RPC probe with a missing mission (rolled back) | `wrong_state`, no writes |

Production health after deployment: `/` 200, `/api/health` 200, unauthenticated
`/api/missions` and `/api/missions/my` 401.

## Verification

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'mission_submissions'
  and column_name = 'resubmit_count';
select proname from pg_proc where proname = 'resubmit_mission';
```

Creator flow (legacy mission, rejected submission):

1. `/my` lists the submission; opening the mission shows the reason and
   "尚餘 N 次修改機會 / N revisions left".
2. Submitting corrected evidence moves the submission to `submitted`, increments
   `resubmit_count`, and writes one `mission_submission_events` row.
3. Replaying the same request id with the same payload is a no-op; a different
   payload returns `IDEMPOTENCY_CONFLICT`.
4. After `revision_limit` resubmissions the page shows the closed state and the
   route returns `revision_limit_reached`.

## Rollback

The migration is additive. Reverting the runtime PR restores the previous
closed-state behavior; the new column/table/RPC remain unused. Do not drop them
while `mission_submission_events` rows may be needed for audit.

## Release evidence

The release foundation's `APPROVE <projectRef> <evidenceDigest>` phrase is still
required for future releases that use the protected executor. This migration was
an explicitly approved, standalone additive apply; its evidence is recorded
above and in `supabase_migrations.schema_migrations`.
