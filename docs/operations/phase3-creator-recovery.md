# Phase 3 M1 — creator recovery after rejection

Status: runtime wiring complete; production schema application is an owner-gated
release step. The runtime degrades safely while the migration is unapplied.

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

1. Apply the migration through the release foundation (owner approval).
2. Deploy the runtime PR.
3. Verify with a rejected test submission before inviting creators.

Merging the runtime PR before step 1 is safe: `/missions/my` falls back to the
pre-migration projection and hides the form (`resubmit_available: false`), and a
rejected submission returns `schema_not_ready` rather than a false success.

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

The release foundation requires an explicit owner phrase before applying to
production:

```text
APPROVE <projectRef> <evidenceDigest>
```

No production migration has been applied as part of this change.
