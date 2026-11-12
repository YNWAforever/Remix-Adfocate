# Phase 3 M5 — pilot rollout readiness (owner-gated)

Status: **not authorised, not started.** M1–M4 are live. This document is the
preparation bundle for the one-mission pilot; executing it needs the owner's
separate release approval.

Production deployment verified for main `985e572` (Vercel production READY,
`/` 200, `/api/health` 200).

## Production snapshot (2026-11-13, read-only)

| Check | Value |
| --- | --- |
| Missions | 6, all `creator_workflow_mode = legacy` |
| Active-workspace missions | 0 |
| `mission_workflows` rows | 0 |
| Submissions | 9 `joined`, 1 `submitted`, 0 `rejected` |
| `mission_submission_events` rows | 0 |
| `schema_migrations` rows | 17 (incomplete; earlier history was out-of-band) |

Consequences:

- No `active_workspace` mission exists, so the pilot requires authoring one
  first. It cannot reuse the live legacy missions.
- No `mission_workflows` rows means the active-workspace review routing has not
  run in production yet.
- Zero rejected submissions means M1's creator recovery is untested against a
  real creator; the pilot should deliberately exercise one reject → resubmit →
  approve cycle.
- The incomplete migration history is a release-foundation risk. The M1
  migration was applied with an operator-approved atomic transaction; a future
  protected release needs the history reconciled first.

## Authorisation gate

Plan approval is **not** release approval. To start the pilot the owner must
provide:

```text
APPROVE <projectRef> <evidenceDigest>
```

plus the pilot mission choice and cohort size. `evidenceDigest` is the SHA-256
of the evidence bundle produced in step 2. Until then, no production mission,
workflow, membership, or submission is created or changed.

## Pilot scope

- One mission only, `creator_workflow_mode = active_workspace`.
- Small cohort: 1–3 creators already in the workspace.
- Publication proof required (so the proof policy is exercised end to end).
- Short review SLA (e.g. 24–48 h) to make the overdue signal observable without
  waiting days.
- Do not expand A3.2 or other canaries from this pilot.

## Runbook (after approval)

1. **Author the pilot mission** in the admin console: active workspace, small
   quota (≤ 3), deadline, publication proof, revision limit 1–2.
2. **Capture evidence:** mission id/slug, workflow mode, revision limit, SLA,
   deadline. Export the sanitised JSON bundle and compute its SHA-256.
3. **Join the cohort** (1–3 creators) and confirm they see the mission.
4. **Submit proof** as creator 1. Confirm it lands in the operator queue with
   `submitted` and a future `review_deadline`.
5. **Reject with notes.** Confirm the creator sees the reason, remaining
   revisions, and the resubmission form.
6. **Resubmit once.** Confirm: `resubmit_count = 1`, one
   `mission_submission_events` row, `review_deadline` reset, no XP/points/
   earnings written.
7. **Exhaust or close:** set the revision limit to 1 and confirm the closed
   state hides the form and (if configured) shows the support link.
8. **Approve.** Confirm XP/points are awarded once and the workflow reaches its
   terminal state.
9. **Operator signal:** a past `review_deadline` appears under the overdue
   filter with a correct count.
10. **Stop** if any step mutates XP/earnings twice, exposes another creator's
    data, or leaves the queue inconsistent. Keep the mission paused; do not
    delete rows.

## Acceptance evidence template

Read-only, sanitised (no emails, no evidence URLs, no notes):

```sql
select id, slug, status, creator_workflow_mode, revision_limit,
       review_sla_hours, deadline
from public.missions where slug = '<pilot-slug>';

select status, count(*)::int
from public.mission_submissions
where mission_id = '<mission-id>' group by status;

select id, status, resubmit_count, review_deadline
from public.mission_submissions where mission_id = '<mission-id>';

select event, count(*)::int
from public.mission_submission_events
where mission_submission_id = '<submission-id>' group by event;

select count(*)::int from public.mission_workflows
where mission_id = '<mission-id>';
```

Plus: creator-facing screenshots of the rejected/closed states, the operator
overdue filter, and curl-style HTTP evidence for the affected routes (status
codes only).

## Rollback

No destructive rollback is needed: resubmission history is append-only and
approvals are idempotent. To stop the pilot, pause/close the pilot mission and
leave its rows intact. Report the failure point and evidence digest in the
closeout.

## Ledger

| Date | Action | Evidence digest | Result |
| --- | --- | --- | --- |
| — | Not started | — | — |
