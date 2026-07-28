# Publication proof release, rollback, and recovery

This is the Phase 3 operator runbook for publication proof. It supplements the
[active mission workspace operations](active-mission-workspace.md) guide. Use a
disposable, authorized environment for rehearsal and record only opaque UUIDs,
mission slugs, timestamps, response codes, and ticket references. Do not copy
credentials, JWTs, raw URLs, signed URLs, authored text, account names, or other
personal data into the ticket.

## Safety contract

`mission_submissions` remains the assignment and final-reward anchor. Publication
proof is additive: it must not alter legacy `content_urls`, submission status,
`points_awarded`, `xp_awarded`, earnings, or workspace budget. The emergency
procedure is an access gate, not a data rollback: migrations remain forward-only
and Phase 2/3 state is never rewritten.

There is **no single runtime toggle** named `publication-proof-enabled` in this
repository. Treat that phrase only as the operational gate label below, not as an
environment variable or an invented configuration key. The gate is enforced at
the route/feature boundary and, when emergency containment is required, at the
service-role RPC boundary.

## Read-only triage

Replace each `<..._UUID>` once in an authorized SQL session. These queries return
operational identifiers and state only; omit creator-authored proof fields from
any exported result.

### Blocked-item diagnostic

Run this before setup or recovery. It identifies missing setup, current proof
state, metadata status, and the canonical attempt/review anchors.

```sql
with input as (select '<WORKSPACE_UUID>'::uuid as workspace_id)
select
  workflow.id as workflow_id,
  item.id as work_item_id,
  item.state,
  item.current_proof_attempt_id,
  item.verified_proof_attempt_id,
  instruction.id as instruction_id,
  instruction.revision as instruction_revision,
  instruction.publication_due_at,
  item.deadline as creator_deadline,
  attempt.id as attempt_id,
  attempt.attempt_number,
  attempt.submitted_at,
  attempt.submitted_late,
  attempt.metadata_status,
  attempt.metadata_error_category,
  review.id as review_id,
  review.state as review_state,
  item.review_due_at,
  review.creator_response_deadline
from public.mission_workflows workflow
join public.mission_work_items item
  on item.mission_workflow_id = workflow.id
 and item.workspace_id = workflow.workspace_id
left join public.mission_publication_instructions instruction
  on instruction.mission_work_item_id = item.id
 and instruction.workspace_id = item.workspace_id
left join public.mission_publication_proof_attempts attempt
  on attempt.id = item.current_proof_attempt_id
 and attempt.workspace_id = item.workspace_id
left join public.mission_publication_proof_reviews review
  on review.mission_publication_proof_attempt_id = attempt.id
 and review.workspace_id = item.workspace_id
join input on input.workspace_id = workflow.workspace_id
where item.state in (
  'approved_to_publish', 'proof_submitted', 'proof_under_review',
  'proof_correction_requested', 'proof_verified'
)
order by instruction.publication_due_at nulls last, workflow.id, item.id;
```

An `approved_to_publish` item with no `instruction_id` is blocked for explicit
setup. `proof_submitted`, `proof_under_review`, and `proof_correction_requested`
require the current attempt and exact state/revision; do not infer an earlier
attempt. `proof_verified` is evidence of a completed state, not a candidate for
setup or review.

### Overdue priority

Use this query for an operator queue export. It exactly mirrors the current priority
ordering: late submissions or a passed review, creator-response, publication, or
creator work-item due time come first; then the earliest due time, submission time, and item
ID. Queue visibility may remain enabled during containment, but queue/review
actions must fail closed while the gate is off.

```sql
with input as (select '<WORKSPACE_UUID>'::uuid as workspace_id),
queue as (
  select
    workflow.id as workflow_id,
    item.id as work_item_id,
    item.state,
    attempt.id as attempt_id,
    attempt.submitted_at,
    attempt.submitted_late,
    item.review_due_at,
    review.creator_response_deadline,
    instruction.publication_due_at,
    item.deadline as creator_deadline,
    least(
      coalesce(item.review_due_at, 'infinity'::timestamptz),
      coalesce(review.creator_response_deadline, 'infinity'::timestamptz),
      coalesce(instruction.publication_due_at, 'infinity'::timestamptz)
      , coalesce(item.deadline, 'infinity'::timestamptz)
    ) as due_at
  from public.mission_workflows workflow
  join public.mission_work_items item
    on item.mission_workflow_id = workflow.id
   and item.workspace_id = workflow.workspace_id
  join public.mission_publication_instructions instruction
    on instruction.mission_work_item_id = item.id
   and instruction.workspace_id = item.workspace_id
  join public.mission_publication_proof_attempts attempt
    on attempt.id = item.current_proof_attempt_id
   and attempt.workspace_id = item.workspace_id
  left join public.mission_publication_proof_reviews review
    on review.mission_publication_proof_attempt_id = attempt.id
   and review.workspace_id = item.workspace_id
  join input on input.workspace_id = workflow.workspace_id
  where item.state in ('proof_submitted', 'proof_under_review', 'proof_correction_requested')
)
select *, (submitted_late or due_at < now()) as overdue
from queue
order by overdue desc, due_at, submitted_at nulls last, work_item_id;
```

## Setup for an existing approved item

Only an active operator may set up an existing item, and only while the item is
exactly `approved_to_publish`, has no publication instruction or proof attempt,
and the caller has its current revision. The request is a separate setup path;
it never falls back to publication-instruction editing.

```http
POST /admin/active-missions/<WORKFLOW_UUID>/work-items/<WORK_ITEM_UUID>/publication-setup
X-Workspace-Slug: <WORKSPACE_SLUG>
Idempotency-Key: <NEW_IDEMPOTENCY_UUID>
Content-Type: application/json

{
  "expectedState": "approved_to_publish",
  "expectedRevision": 0,
  "idempotencyKey": "<NEW_IDEMPOTENCY_UUID>",
  "instructions": {
    "publicationInstructions": "<approved operator policy>",
    "publicationWindowHours": 48,
    "requiredDisclosures": ["<required disclosure>"],
    "expectedAccount": null,
    "proofEvidencePolicy": { "required": true }
  }
}
```

The route maps to `setup_existing_publication_instructions` with these exact
fields: `p_workspace`, `p_workflow`, `p_work_item`, `p_operator`,
`p_expected_state`, `p_expected_revision`, `p_idempotency_key`, and
`p_instructions`. A successful call creates one frozen
`mission_publication_instructions` record and the
`mission_publication_existing_instructions_setup` event. On `WRONG_STATE`,
`WORKFLOW_NOT_FOUND`, `NOT_AUTHORIZED`, `VALIDATION_FAILED`, or
`IDEMPOTENCY_CONFLICT`, stop and re-run the blocked-item diagnostic; do not
change historical rows to make the request fit.

## Metadata retry and stale recovery

For an attempt whose `metadata_status` is `unavailable`, an operator may make a
bounded metadata retry through the exact route below after recording the
canonical attempt ID, work-item state, instruction revision, and response code.
Use a new idempotency UUID only for a new retry; an identical replay retains its
original key.

```http
POST /admin/active-missions/<WORKFLOW_UUID>/work-items/<WORK_ITEM_UUID>/proofs/<ATTEMPT_UUID>/metadata-refresh
X-Workspace-Slug: <WORKSPACE_SLUG>
Idempotency-Key: <NEW_IDEMPOTENCY_UUID>
Content-Type: application/json

{
  "attemptId": "<ATTEMPT_UUID>",
  "expectedState": "proof_submitted",
  "expectedRevision": 0,
  "idempotencyKey": "<NEW_IDEMPOTENCY_UUID>"
}
```

`metadata-refresh` (refresh-publication-proof-metadata) calls the prepare and
complete metadata RPCs with the exact attempt/state/revision anchors. It may
change only metadata fields on the immutable attempt. Retry transient inspection
failure once; leave an `unavailable` result reviewable when the platform remains
unavailable. Never substitute a URL, attempt, or evidence object to make a retry
succeed.

On `WORKFLOW_STALE`, do not replay the previous body. Re-fetch
`GET /admin/active-missions/<WORKFLOW_UUID>` and the blocked-item diagnostic,
compare `state`, `current_proof_attempt_id`, `attempt_id`, and
`instruction_revision`, then choose the current supported action. A correction
requires a new creator submission; an already `proof_verified` item has no
further review action. Record the recovery category through the existing
`publication_proof_recovery_used` analytics event without content or identifiers.

## Emergency disable and re-enable

### Route/feature boundary

A disable must block **new creator proof mutations** at these routes:

- `POST /:submissionId/publication/:workItemId/proofs`
- `POST /:submissionId/publication/:workItemId/assets/upload-grant`
- `POST /:submissionId/publication/:workItemId/assets/:assetId/finalize`

It must also block **operator queue/review actions** (setup and metadata actions
included) at these routes:

- `PUT /admin/active-missions/:workflowId/work-items/:workItemId/publication-instructions`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/publication-setup`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/proof-review/start`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/proof-review/corrections`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/proof-review/verify`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/proofs/:attemptId/metadata-refresh`

Deploy/router policy, where supported, must return a stable feature-disabled
response before these handlers invoke their repositories. Keep the read routes
available for instructions, attempts, reviews, evidence history, events, and
verified state. Do not block the queue `GET`; it is a diagnostic surface only.

### Service-role permission gate

There is no application toggle to flip. For emergency containment, an authorized
schema owner can revoke execute from the current caller role, `service_role`, for
the exact Phase 3 public mutation signatures. First run the pre-check and attach
only its function names and boolean results to the ticket.

```sql
select p.oid::regprocedure as function_name,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p
where p.oid in (
  'public.submit_mission_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb,uuid[])'::regprocedure,
  'public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text)'::regprocedure,
  'public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text)'::regprocedure,
  'public.start_publication_proof_review(uuid,uuid,uuid,uuid,text,integer,uuid,uuid)'::regprocedure,
  'public.request_publication_proof_correction(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,jsonb,text)'::regprocedure,
  'public.verify_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,text)'::regprocedure,
  'public.request_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid)'::regprocedure,
  'public.complete_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,text,jsonb,text)'::regprocedure,
  'public.set_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb)'::regprocedure,
  'public.setup_existing_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb)'::regprocedure
)
order by 1;
```

```sql
revoke execute on function public.submit_mission_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb,uuid[]) from service_role;
revoke execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from service_role;
revoke execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from service_role;
revoke execute on function public.start_publication_proof_review(uuid,uuid,uuid,uuid,text,integer,uuid,uuid) from service_role;
revoke execute on function public.request_publication_proof_correction(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,jsonb,text) from service_role;
revoke execute on function public.verify_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,text) from service_role;
revoke execute on function public.request_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid) from service_role;
revoke execute on function public.complete_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,text,jsonb,text) from service_role;
revoke execute on function public.set_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb) from service_role;
revoke execute on function public.setup_existing_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb) from service_role;
```

Re-run the pre-check and require every `service_role_execute` result to be false.
The route block and this permission gate are both required: the first makes the
intent visible at the boundary, while the second makes service-role repository
calls fail closed if a router rule is bypassed.

After the incident owner approves re-enable, remove the route block, then restore
only the grants supplied by the committed migration contracts:

```sql
grant execute on function public.submit_mission_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb,uuid[]) to service_role;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;
grant execute on function public.start_publication_proof_review(uuid,uuid,uuid,uuid,text,integer,uuid,uuid) to service_role;
grant execute on function public.request_publication_proof_correction(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.verify_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.request_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid) to service_role;
grant execute on function public.complete_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.set_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;
grant execute on function public.setup_existing_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb) to service_role;
```

Run the same privilege query again and require every result to be true before a
single disposable-fixture mutation is attempted. Verify a read route, one
creator proof mutation, and one operator action with current anchors; then repeat
the reward-neutrality comparison below.

## Preservation and reward-neutrality proof

During disable, re-enable, metadata recovery, and setup, preserve
`mission_publication_instructions`, `mission_publication_proof_attempts`,
`mission_publication_proof_assets`, `mission_publication_proof_reviews`,
`mission_publication_proof_review_items`, `mission_workflow_events`, and storage
objects. Preserve all instructions, attempts, reviews, evidence, events, storage
objects, and verified state. Do not erase records, rewrite Phase 2/3 states, or
alter the legacy submission/reward anchor as compensation.

Capture the following before and after each recovery with the same opaque IDs:

```sql
-- Legacy submission anchor: compare content_urls digest/count, never export raw URLs.
select id, workspace_id, mission_id, status,
       cardinality(content_urls) as content_urls_count,
       md5(coalesce(array_to_string(content_urls, E'\x1f'), '')) as content_urls_digest,
       points_awarded, xp_awarded, submitted_at, reviewed_at
from public.mission_submissions
where id = '<SUBMISSION_UUID>'::uuid;

-- Creator and workspace reward/budget snapshot.
select c.xp, pb.balance as points,
       eb.available as earnings, wb.balance as workspace_budget
from public.creators c
left join public.point_balances pb
  on pb.creator_id = c.id and pb.workspace_id = '<WORKSPACE_UUID>'::uuid
left join public.earnings_balances eb
  on eb.creator_id = c.id and eb.workspace_id = '<WORKSPACE_UUID>'::uuid
left join public.workspace_budgets wb on wb.workspace_id = '<WORKSPACE_UUID>'::uuid
where c.id = '<CREATOR_UUID>'::uuid;

-- Transaction counts are part of the neutrality comparison.
select
  (select count(*) from public.point_transactions where creator_id = '<CREATOR_UUID>'::uuid and workspace_id = '<WORKSPACE_UUID>'::uuid) as point_transactions,
  (select count(*) from public.earnings_transactions where creator_id = '<CREATOR_UUID>'::uuid and workspace_id = '<WORKSPACE_UUID>'::uuid) as earnings_transactions,
  (select count(*) from public.workspace_budget_transactions where workspace_id = '<WORKSPACE_UUID>'::uuid) as workspace_budget_transactions;
```

Any difference in submission status, `content_urls` digest/count, points, XP,
earnings, workspace budget, or these transaction counts is release-stopping. Keep
the before/after digests, numeric counters, and event/attempt counts in the incident record, without
credentials or personal data.
