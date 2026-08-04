# Active mission workspace operations

This runbook covers the Phase 2 `active_workspace` rollout. The legacy
`mission_submissions` row remains the assignment and final-reward anchor. Draft,
review, fulfilment, revision, and approve-to-publish operations must not change
its status, points, XP, earnings, or workspace budget.

The ordered release gates, disposable rehearsal, go-live authorization, pilot
handoff, and containment rules are in the
[production release foundation](production-release-foundation.md) runbook.

> Phase 3 publication-proof rollout, rollback, feature containment, and operator
> recovery are governed by the dedicated
> [publication proof release runbook](publication-proof-release-runbook.md).
> It is additive to this Phase 2 guide and does not authorize state rewrites or
> record removal.

## Safety rules

- New missions default to `creator_workflow_mode=legacy`.
- Enable one internal-pilot mission at a time. Do not bulk-update mission modes.
- Save and validate structured deliverable templates before changing the mode.
- Never edit, delete, or backfill workflow history to make a rollback possible.
- Never reset or repair a divergent local or deployed migration history during
  this rollout. Apply the committed forward migrations to a fresh disposable
  local stack first, then use the normal reviewed deployment path.
- Never run the migration procedure with a creator JWT or expose it in a client.
  `migrate_pristine_joined_active_mission` is service-role only.
- A failed eligibility check is a stop signal. Keep that assignment on the
  legacy path; do not clear content or reward fields to make it eligible.

## Enable a pilot mission

1. Inventory every existing submission for the mission. If any active
   assignment cannot be safely migrated, do not change the existing mission's
   mode; keep it legacy and use a new pilot mission instead.
2. While the mission is still `legacy`, save all
   `mission_deliverable_templates` and their checklist requirements. Confirm at
   least one deliverable is marked `required`, positions are deterministic, and
   due offsets do not exceed the mission deadline.
3. In mission authoring, save the fulfilment flag, revision limit, review SLA,
   and creator-response SLA. Re-read the saved mission and templates.
4. Set `creator_workflow_mode=active_workspace` only after steps 1-3 pass.
5. Join with an internal fixture creator (or accept an internal fixture
   application). Confirm exactly one workflow, snapshotted work items and
   requirements, one working draft per item, and a `workflow_created` event.
   A product mission must begin in `fulfillment_pending`; a non-product mission
   must begin in `drafting`.
6. Repeat the join/accept request once and confirm the same workflow ID is
   returned. Confirm the submission anchor and creator reward snapshot did not
   change.

## Confirm private asset controls

Before opening the pilot, verify all of the following in the target environment:

- Storage bucket `mission-draft-assets` exists with `public=false`, the expected
  20 MiB limit, and only the approved image/video MIME types.
- Creator storage policies require the canonical
  `<creator>/<workflow>/<item>/<asset>.<extension>` path and bind creator,
  workspace, workflow, and work item ownership relationally.
- Another creator cannot list, read, upload, replace, or delete the fixture
  creator's object.
- Signed read URLs are issued only after the ownership check and expire within
  the configured short lifetime.
- Submitted assets and versions reject update/delete attempts as
  `immutable_record`.

Use the schema and integration checks in `npm run test:active-missions` against
a fresh loopback Supabase before deployment. Do not point the test harness at a
hosted or production Supabase project.

## Explicit pristine-joined migration

The forward RPC
`public.migrate_pristine_joined_active_mission(p_submission uuid)` is the only
supported conversion procedure. It obtains a row lock and rechecks every
condition in the same transaction before creating a workflow.

A submission is eligible only when all of these are true:

- its status is exactly `joined`;
- `content_urls` is empty and `submission_data` is `{}`;
- `reviewer_notes`, `submitted_at`, `reviewed_at`, and `review_deadline` are null;
- `points_awarded=0` and `xp_awarded=0`;
- no `mission_workflows` row already references the submission;
- its mission is already `active_workspace` and has at least one required
  deliverable template.

Rows in `submitted`, `under_review`, `approved`, `rejected`, `declined`, or
`expired` are never eligible. A joined row carrying assignment XP or any other
reward is also not pristine under this rollout contract and must remain legacy.

Procedure:

1. Record the submission ID, mission ID, operator/change ticket, and a read-only
   snapshot of the submission and current creator balances.
2. Perform a read-only preflight of the conditions above. The preflight is for
   operator review only; it does not replace the RPC's locked validation.
3. Confirm the mission templates and mode using the enablement checklist.
4. From a trusted backend process configured with the service-role key, invoke:

   ```ts
   const { data, error } = await service.rpc(
     "migrate_pristine_joined_active_mission",
     { p_submission: submissionId },
   );
   ```

   Do not call it from browser code. Calling the function directly in a SQL
   editor without a service-role JWT context is intentionally rejected.
5. On `wrong_state`, stop. Re-read the row and keep it on the legacy path; do
   not retry after modifying history or reward fields. On `legacy_mission` or
   `required_deliverable_missing`, correct mission authoring only if the
   assignment remains pristine, then repeat the reviewed procedure.
6. On success, verify one workflow, the `workflow_created` and
   `legacy_submission_migrated` events, snapshotted items/drafts, and unchanged
   submission and creator reward snapshots.

The procedure deliberately rejects a second call once a workflow exists. That
makes accidental replay visible and preserves a single auditable migration
event.

## Monitoring and alerting

Break dashboards down by mission and workflow mode, and distinguish creator-
owned waiting time from operator-owned waiting time. Alert on:

- workflow creation failure count/rate after direct joins, accepted
  applications, and explicit migrations;
- stale autosave conflict rate, recovery success rate, and repeated conflicts;
- image/video upload failures, retry exhaustion, and signed-URL failures;
- review SLA breaches, queue age, and queue ordering drift;
- revision-limit rejections and extra-round grants, including grant reason;
- notification insert/send failures (notifications are best effort and must not
  roll back durable workflow transitions);
- on-time exact-version approval rate and overall approval rate;
- overdue creator work, creator abandonment before first submission, and median
  revision rounds.

Also continuously compare active-workspace transitions with the legacy anchor:
unexpected changes to submission status, points, XP, earnings, or budget are a
release-stopping invariant breach. Analytics and notification metadata must not
contain creator-authored draft content or creator identifiers.

## Rollback

Rollback is mode gating, not data deletion.

1. Stop expanding the pilot and disable further authoring changes.
2. A mission may be returned to `creator_workflow_mode=legacy` only when it has
   no active assignments: no joined/applied creator assignment that depends on
   active workspace and no workflow row in any nonterminal or terminal state.
3. Re-check immediately before the update; if a join, accepted application, or
   migration created a workflow, do not flip the mission. Let existing
   workflows continue and contain the incident at routing/feature-flag level.
4. For an eligible mission, change only its mode back to `legacy` through the
   normal mission-authoring service. Preserve templates for diagnosis and a
   future reviewed rollout.
5. Never delete workflow events, drafts, versions, assets, review rounds,
   revision grants, or fulfilment records. Never rewrite submission reward
   fields as compensation.
6. Verify legacy join, submit, final `approve_submission`, points, XP, earnings,
   budget accounting, passport scoring, and notifications with a disposable
   fixture before declaring rollback complete.

## Release evidence

Attach the focused test output, lint, type-check, full test, integration, build,
and both browser viewport passes to the rollout ticket. Record skips and
infrastructure failures separately from code regressions. Production accounts,
data, secrets, and cloud resources are outside this runbook's acceptance test;
use fixture users and an authorized disposable environment.
