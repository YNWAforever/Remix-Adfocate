# Phase 3 M5 — pilot preparation and approval boundaries

Status: **HOLD; no production pilot has been authorised or enabled.** Reviewed
2026-11-13 (Asia/Singapore). The earlier version of this runbook conflated the
legacy creator recovery flow with active-workspace publication proof, and used
the release approval phrase for pilot enablement. Those instructions are
superseded by the gates and separate flows below.

Follow [production release foundation](production-release-foundation.md),
[active workspace operations](active-mission-workspace.md), and
[publication proof operations](publication-proof-release-runbook.md).

## Current evidence

Read-only inspection on 2026-11-13 confirmed production deployment commit
`159361980dd968580c7aa457328dd05f5b5c0e70`, READY, with `/` and `/api/health`
returning 200. Unauthenticated `/api/admin/me` and `/api/missions/my` returned
401. These checks establish availability and deployment identity only.

The database inspection used a repeatable-read, read-only transaction with TLS
certificate verification and returned:

| Check | Observed value |
| --- | --- |
| Missions | 6; all active, legacy, with existing submissions |
| Eligible draft legacy candidates | 0 |
| Workflows / resubmission events | 0 / 0 |
| Submissions | 9 joined, 1 submitted, 0 rejected |
| Recorded migration versions | 17 |
| Reviewed manifest versions | 66; 64 absent from recorded history |

Missing history does not prove a migration is unapplied. Do not replay old SQL,
insert history rows, reset the target, or infer a passing schema preflight from
this version comparison. Required capability verification, schema fingerprint,
rehearsals, and recovery evidence are still outstanding.

## Distinct authorisations

1. **Preparation:** local plans and read-only observations do not authorise
   creation of a production draft, templates, memberships, or submissions.
   Draft creation needs a separately scoped instruction identifying the
   workspace and approved mission specification. Prepare the specification
   locally first; production authoring is a write.
2. **Protected release:** after the passing preflight, disposable rehearsals,
   evidence review, expiry, recovery, and containment gates, the executor uses
   `APPROVE <projectRef> <evidenceDigest>`. This authorises the reviewed release
   only; it does not authorise pilot enablement or direct database writes.
3. **Pilot enablement:** inspect an exact workspace/mission pair. After review,
   the existing pilot command requires
   `ENABLE PILOT <workspaceId> <missionId> <evidenceDigest>`. Its digest must be
   the actual approved 64-character hexadecimal value. The command repeats
   inspection and calls the service-role atomic enable RPC, affecting one row.
4. **Publication and participation:** the atomic RPC switches mode on a draft;
   it does not publish. Publication, the admission mechanism, the named creator,
   creator actions, and operator review actions must be explicitly included in
   the approved pilot scope. Credentials do not imply permission to impersonate
   a creator.

A literal `<evidenceDigest>`, the manifest digest, or the file hash of a HOLD
report cannot replace valid release evidence. Do not produce a passing release
bundle by filling missing fingerprints, rehearsal results, role assignments, or
expiry checks with invented values.

## Conditions before a pilot can be approved

- Resolve migration-history divergence through a separately reviewed recovery
  plan. Do not repair history during pilot enablement.
- Complete the pinned-toolchain, schema/capability, compatibility, disposable
  rehearsal, recovery, containment, and evidence-expiry gates in the foundation
  runbook. Passing unit tests and a READY deployment alone are insufficient.
- Resolve the join-XP conflict: the deployed active join calls
  `private.join_mission`, which adds 10 XP. The observer treats XP movement as a
  containment condition. A zero-XP completion reward contract does not remove
  join XP. Establish a reviewed compatible contract or implementation before
  launch; do not hide the mutation by starting the baseline after joining.
- Specify one workspace, one fresh mission, one approved creator, one required
  deliverable, publication policy, deadline, revision limit, review and response
  SLAs, reward contract, and containment owner. One creator is the initial scope;
  the current seven-day exit expects one completed workflow and one pending
  reward.
- Prove admission control for that creator before publication. Quota 1 limits
  capacity; it does not reserve the place for an approved identity. Do not
  assume workspace membership or a small quota provides creator isolation.
- Author a **draft legacy** candidate with no submissions or workflows and no
  other active-workspace pilot in the workspace. Save and validate all required
  templates and publication instructions before guarded mode enablement. Zero
  workflows alone does not make an already active legacy mission eligible.

## Active-workspace sequence after all applicable approvals

1. Re-read the approved draft candidate, templates, capabilities, deployment,
   evidence creation/expiry, and exact target IDs. Stop on any mismatch.
2. Use guarded pilot inspection and atomic enablement with the exact pilot
   phrase. Do not bypass it with a direct table update or by authoring the draft
   directly in active-workspace mode. Confirm exactly one row changed and the
   mission is still draft.
3. Apply the approved admission control and publish through the validated
   mission-authoring route. Confirm only the approved creator can obtain the
   assignment before requesting their participation.
4. Join through `join_active_mission`; replay once to verify no duplicate
   workflow or additional XP. Compare the pre-join balance and anchor snapshots
   against the resolved, approved join-XP contract.
5. Submit an active work-item draft. Review through the active queue: start
   review, request a revision if required, submit a new version, then approve
   that exact version to publish. Preserve state/revision/idempotency anchors.
   Revision limits are snapshotted at join; do not lower mission limits to try
   to close an existing workflow.
6. The creator follows the approved publication instructions and submits proof.
   Use proof-review start/corrections/verify, with the current attempt, state,
   revision, checklist, and idempotency key. A correction produces another proof
   attempt and workflow events; it does not use `resubmit_mission` or increment
   legacy `resubmit_count`.
7. Confirm required work items are `proof_verified`. Through the separate
   completion-review path, create one pending reward and reach `reward_pending`.
   Do not invoke settlement, issue rewards, credit ledgers, debit budget, or
   trigger payout/withdrawal as part of this pilot.
8. Inspect active queue due times (`mission_work_items.review_due_at` and proof
   response/publication deadlines). Do not use the legacy
   `mission_submissions.review_deadline` as active review evidence or backdate
   production rows to manufacture an overdue badge.
9. Observe the exact scope for seven consecutive days using the existing
   observer and exit evaluator. Any integrity, tenant, unexpected reward/XP, or
   queue incident requires containment. No expansion is implied.

## Separate legacy M1 recovery verification

M1 resubmission is a different flow. `resubmit_mission` rejects active-workspace
missions. A separately authorised disposable legacy assignment may exercise
rejection, remaining revisions, resubmission, event history, and exhaustion.
Verify resubmission adds no XP, points, earnings, or budget movement. Use a
preconfigured exhaustion fixture in a disposable environment rather than
editing live limits or deadlines. This is not evidence that active publication
proof passed, and it does not authorise rejecting a real creator's work.

## Read-only evidence query pattern

Use bound UUID parameters for the approved workspace (`$1`) and mission (`$2`)
in a read-only transaction. Export structural data only; omit creator IDs,
authored content, reviewer notes, proof URLs, and credentials.

```sql
select m.id, m.workspace_id, m.status, m.creator_workflow_mode,
       m.revision_limit, m.review_sla_hours, m.deadline
from public.missions m
where m.workspace_id = $1 and m.id = $2;

select s.status, count(*)::int
from public.mission_submissions s
where s.workspace_id = $1 and s.mission_id = $2
 group by s.status;

-- mission_workflows has no mission_id column; scope through its anchor.
select w.id, w.state, w.revision
from public.mission_workflows w
join public.mission_submissions s
  on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
where w.workspace_id = $1 and s.mission_id = $2;

select i.state, count(*)::int
from public.mission_work_items i
join public.mission_workflows w
  on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
join public.mission_submissions s
  on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
where w.workspace_id = $1 and s.mission_id = $2
 group by i.state;
```

Capture separate legacy resubmission evidence only when that test is in scope.
A complete release bundle must also contain the actual commit, manifest digest,
schema fingerprint, preflight and rehearsal hashes, role assignments, recovery
reference, expiry, proposed commands, and containment commands. A snapshot
report with failed or unexecuted gates is a HOLD report, not that bundle.

## Containment

Use the approved mission close route to stop new entry when applicable (supported
statuses are draft, active, closed). Closing a mission does not freeze in-flight
workflow mutations; follow the publication-proof route/RPC containment procedure
separately. Preserve assignments, proof attempts, workflow events, and reward
records. Do not delete history, rewrite balances, or return a mission with any
workflow to legacy mode. Record the failure point and ownership for recovery.

## Ledger

| Date (Asia/Singapore) | Action | Release/pilot evidence | Result |
| --- | --- | --- | --- |
| 2026-11-13 | Read-only readiness review; correct prior runbook | No valid release bundle generated | HOLD; no production writes |
