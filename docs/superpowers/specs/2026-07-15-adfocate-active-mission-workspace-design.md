# Adfocate Phase 2: Active Mission Workspace Design

Date: 15 July 2026
Status: Approved design; implementation planning pending
Branch: `codex/active-mission-workspace-design`

## 1. Outcome

Phase 2 builds a mobile-first active-mission workspace from accepted mission through operator approval to publish. It gives creators one clear next action, per-deliverable drafting, private attachments, immutable submission versions, structured revision requests, deadlines, and a complete history. It gives operators a deadline-prioritized review queue, the brief and draft side by side, structured feedback, and approval of an exact version.

The primary success metric is the percentage of accepted missions whose required deliverables reach `approved_to_publish` before their deadlines.

This phase does not validate published proof or award mission rewards. No Phase 2 fulfilment, draft, review, revision, or approve-to-publish action awards points, cash, or XP. The existing final approval path remains the reward boundary and is reserved for the later publication-proof and reward-validation phase.

## 2. Approved product decisions

The design uses these approved decisions:

1. Phase 2 covers accepted mission through approved to publish.
2. Creators use a structured hybrid workspace: checklist, caption or copy fields, external draft URL, private file attachments, autosave, and immutable submitted versions.
3. Adfocate operators own review, revision requests, and approval to publish.
4. Product-based missions may require an optional fulfilment gate: preparing, shipped, and received. Non-product missions skip it.
5. Revision limits are configurable per mission, default to two rounds, and allow an explicit operator-granted extra round.
6. Each required deliverable is tracked independently within one mission.
7. The mission reaches approved to publish only when every required deliverable is approved.
8. The primary success metric is on-time approval; first-pass approval and review turnaround remain supporting metrics.
9. The persistence design uses normalized workflow records beside the existing `mission_submissions` reward anchor, plus an append-only event timeline.

## 3. Scope

### 3.1 In scope

- Mission authoring fields that enable the active-workspace mode and define its policy.
- Structured deliverable templates and checklist requirements.
- Workflow creation after direct join or accepted application.
- Optional product fulfilment status and creator receipt confirmation.
- Per-deliverable working drafts with autosave and optimistic concurrency.
- Private image and video attachments plus optional external draft URLs.
- Immutable draft versions.
- Operator review ownership, structured feedback, revision deadlines, and version approval.
- Default two-round revision policy with operator-granted exceptions.
- Creator timeline and version history.
- Operator review queue prioritized by deadline and review SLA.
- In-app workflow notifications.
- Privacy-limited analytics and the on-time-approval metric.
- Backward-compatible rollout beside legacy mission submissions.
- Database, domain, API, component, accessibility, and end-to-end verification.

### 3.2 Out of scope

- Brand-led or two-stage brand approval.
- Published-post proof, screenshot proof, or public URL validation.
- Final reward validation, points, cash, XP, withdrawal, payout, reversals, or disputes.
- Full logistics management such as carrier integrations, returns, reimbursements, and delivery exceptions.
- Native video or image editing, rich collaborative documents, or automated content moderation.
- Email, WhatsApp, push, or other external notification channels.
- Notification preferences and quiet hours.
- Daily check-in, streak, weekly-goal, or other retention mechanics.
- Migration of already submitted, approved, rejected, declined, or expired legacy records into the new workflow.

## 4. Design principles

1. **One next action.** Every creator-visible state identifies the responsible party, deadline, blocking reason, and next action.
2. **Source-backed facts.** The UI derives state from authoritative workflow records and never infers approval or reward from presentation state.
3. **Per-deliverable truth.** A mission may contain multiple deliverables with independent drafts, feedback, deadlines, and approval.
4. **Immutable decisions.** Submitted versions and completed review decisions cannot be edited in place.
5. **Explicit reward boundary.** Approved to publish is not completed, rewarded, paid, or published.
6. **Recoverable work.** Upload, autosave, query, and review failures preserve useful context and provide a specific recovery action.
7. **Workspace isolation.** Creator and operator access remains tenant scoped and least privileged.
8. **Gradual rollout.** Legacy missions continue to work until a mission explicitly enables the active workspace.
9. **Privacy-limited measurement.** Analytics excludes creator-authored content and direct identifiers.

## 5. Canonical state model

### 5.1 Mission workflow states

The creator-facing workspace exposes these overall states:

| State | Meaning | Responsible party | Primary action |
| --- | --- | --- | --- |
| `accepted` | The creator owns the mission slot and the workspace exists | System/operator | Resolve the fulfilment gate or begin drafting |
| `fulfillment_pending` | A product is being prepared or shipped | Operator, then creator | Operator marks shipped; creator confirms receipt |
| `drafting` | At least one required deliverable needs a draft or revision | Creator | Continue the highest-priority work item |
| `in_review` | At least one submitted version awaits or is receiving review | Operator | Review the next SLA-risk item |
| `revision_requested` | At least one deliverable has required changes | Creator | Address structured feedback before its response deadline |
| `approved_to_publish` | Every required deliverable has an approved exact version | Creator | Await the later publication-proof phase |
| `cancelled` | The underlying mission assignment was cancelled | Operator/support | Review reason and support route |
| `expired` | The underlying mission opportunity ended before approval | Creator/support | Review outcome and find another mission |

Overall state is derived from fulfilment and work-item records. It is materialized on the workflow row only as a query optimization and must be updated by the same database transaction as the authoritative transition.

### 5.2 Work-item states

Each instantiated deliverable uses:

| State | Allowed next states |
| --- | --- |
| `blocked_by_fulfillment` | `drafting`, `cancelled`, `expired` |
| `drafting` | `submitted`, `cancelled`, `expired` |
| `submitted` | `under_review`, `revision_requested`, `approved_to_publish`, `cancelled`, `expired` |
| `under_review` | `revision_requested`, `approved_to_publish`, `cancelled`, `expired` |
| `revision_requested` | `submitted`, `cancelled`, `expired` |
| `approved_to_publish` | `cancelled` only through an explicit audited override |
| `cancelled` | terminal |
| `expired` | terminal |

The system must reject every transition not listed above. Operators cannot approve a mutable working copy; they approve only the latest submitted immutable version.

### 5.3 Fulfilment states

Product-based missions use:

1. `preparing` when the workflow is created.
2. `shipped` when an operator confirms dispatch.
3. `received` when the creator confirms receipt.

The phase stores status timestamps and an optional operator-facing note. It does not promise carrier tracking, delivery guarantees, returns, or reimbursements. Non-product missions have no fulfilment row and begin in `drafting`.

### 5.4 Revision policy

- Mission policy defaults to two revision rounds.
- A revision round is consumed when an operator submits a valid `revision_requested` decision against an immutable version.
- The operator must provide at least one structured required-change item and a creator response deadline.
- Once the configured limit is reached, another revision request is rejected unless an operator first records an extra-round grant with a reason.
- Grants are append-only and visible in the timeline.
- Approval does not consume a revision round.

## 6. Persistence architecture

The UI calls the feature an active-mission workspace. Database objects use `mission_workflow` rather than `mission_workspace` to avoid confusion with the existing tenant `workspace_id` concept.

### 6.1 Existing reward anchor

`mission_submissions` remains the record that proves creator ownership of a mission and anchors final reward processing. Existing statuses and final approval functions are not repurposed to mean approved to publish.

For active-workspace missions, `mission_submissions.status` remains `joined` throughout Phase 2. Phase 2 status comes from the new workflow records. The later publication-proof phase will define the safe transition back into final submission and reward validation.

### 6.2 Mission authoring additions

Add these mission-level fields:

- `creator_workflow_mode`: `legacy` or `active_workspace`; default `legacy`.
- `fulfillment_required`: boolean; default `false`.
- `revision_limit`: small integer; default `2`, minimum `0`.
- `review_sla_hours`: positive integer; default `48`.
- `revision_response_hours`: positive integer; default `48`.

Add `mission_deliverable_templates`:

- `id`, `workspace_id`, `mission_id`.
- `title`, `platform`, `position`.
- `required`.
- `draft_due_offset_hours` relative to assignment acceptance.
- `created_at`, `updated_at`.

Add `mission_deliverable_requirements`:

- Stable requirement ID.
- Deliverable template ID.
- Category: `format`, `key_message`, `compliance`, `quality`, or `other`.
- Creator-visible requirement text.
- Required flag and display position.

When a workflow is created, template titles, platform, deadlines, and requirements are snapshotted into the instance. Later brief edits therefore do not silently alter an accepted creator commitment.

### 6.3 Workflow instance

Add `mission_workflows`:

- `id`, `workspace_id`, `mission_submission_id` with a unique constraint.
- Materialized overall state.
- `accepted_at` and overall mission deadline snapshot.
- Policy snapshots: fulfilment required, revision limit, review SLA, and revision-response SLA.
- `created_at`, `updated_at`.

Add `mission_work_items`:

- `id`, `workspace_id`, `mission_workflow_id`.
- Source template ID plus title, platform, and requirement snapshots.
- Required flag, position, and creator deadline.
- Current state.
- Current submitted version ID and approved version ID.
- Current reviewer ID and review-start timestamp when claimed.
- `created_at`, `updated_at`.

The workflow has at least one required work item. All required work items must be approved before the overall workflow becomes `approved_to_publish`.

### 6.4 Working drafts and immutable versions

Add `mission_working_drafts`, one mutable row per work item:

- Caption or copy text.
- Optional external draft URL.
- Checklist answers keyed by snapshotted requirement ID.
- Optimistic concurrency revision number.
- Last saved timestamp.

Add `mission_draft_versions`:

- Work item ID and monotonically increasing version number.
- Immutable caption or copy snapshot.
- Immutable external URL snapshot.
- Immutable checklist snapshot.
- Submitter and submission timestamp.
- Content checksum used to prevent accidental duplicate submissions.

Add `mission_draft_assets`:

- Work item ID and owning creator.
- Private storage object path, original filename, MIME type, byte size, and checksum.
- Upload state.
- Nullable immutable version ID once included in a submitted version.
- Created and retained/deleted timestamps.

Submitted assets cannot be replaced in place. A later version references new or explicitly reused asset records.

### 6.5 Reviews and feedback

Add `mission_review_rounds`:

- Work item and exact draft version.
- Round number.
- State: `open`, `revision_requested`, or `approved_to_publish`.
- Reviewer, review-started timestamp, decision timestamp, and creator response deadline.
- Unique constraint preventing more than one completed decision for the same version.

Add `mission_review_items`:

- Review round ID.
- Optional requirement ID.
- Category: `format`, `key_message`, `compliance`, `quality`, or `other`.
- Required-change text.
- Required flag and display position.

Add `mission_revision_grants`:

- Work item, granted-by operator, reason, granted count, and timestamp.
- Append-only; never updates the configured mission policy.

### 6.6 Fulfilment and audit timeline

Add `mission_fulfillments`, at most one per workflow:

- State: `preparing`, `shipped`, or `received`.
- Shipped-by operator and shipped timestamp.
- Received-by creator and received timestamp.
- Optional short operational note that is not exposed as a delivery guarantee.

Add `mission_workflow_events` as an append-only timeline:

- Workflow and optional work-item ID.
- Actor type and actor ID.
- Event type, entity type, and entity ID.
- Structured metadata limited to non-content operational facts.
- Occurred-at timestamp.

The timeline does not duplicate captions, URLs, filenames, assets, or feedback text. It links to the authoritative record containing that content.

## 7. Transaction and data flow

### 7.1 Workflow creation

When a creator directly joins an active-workspace mission, or an operator accepts an application:

1. Lock the `mission_submissions` row.
2. Verify the mission is active-workspace enabled and no workflow exists.
3. Snapshot workflow policy and deliverable templates.
4. Create work items and working drafts.
5. Create optional fulfilment row.
6. Append workflow-created events.
7. Return the complete creator read model.

The transaction is idempotent by unique submission ID. Retrying returns the existing workflow.

### 7.2 Autosave

The creator sends changed fields and an expected draft revision number. The server:

1. Authorizes creator ownership.
2. Verifies the work item remains editable.
3. Compares the expected revision with the stored revision.
4. Applies valid fields and increments the revision.
5. Returns the saved draft and server timestamp.

An optimistic-concurrency conflict returns the current server version and the unsaved local payload remains in the client. The UI offers reload or copy-local-content recovery rather than overwriting either version.

Autosave is debounced and flushed before navigation when possible. The submit action always performs a final server save and validation transaction.

### 7.3 Attachment upload

1. The creator requests an upload grant with filename, MIME type, byte size, and work-item ID.
2. The server validates creator ownership, editable state, allowed MIME types, and size limits.
3. The server creates a pending asset record and a short-lived signed upload URL for a private storage bucket.
4. The client uploads directly and calls finalize with checksum and asset ID.
5. The server verifies object metadata before marking the asset ready.

Each file retries independently. Failed uploads do not erase saved text or completed uploads. Download and preview use short-lived signed reads after authorization.

### 7.4 Submit immutable version

The creator submits with an idempotency key and expected working-draft revision. In one transaction, the server:

1. Locks the work item and draft.
2. Validates state, deadline, revision policy, required fields, checklist answers, and ready assets.
3. Rejects an accidental duplicate checksum unless the prior action is the same idempotent request.
4. Creates the next immutable version and associates its assets.
5. Opens a review round with a deadline equal to the earlier of `submitted_at + review_sla_hours` and the work-item deadline.
6. Moves the work item to `submitted`.
7. Appends events and enqueues the operator review read model.

### 7.5 Operator review

The queue orders submitted work by:

1. Overdue review SLA.
2. Nearest review SLA deadline.
3. Nearest creator or mission deadline.
4. Oldest submission timestamp.

Opening a review can atomically claim it for the operator and move the item to `under_review`. Supervisors may reassign through an audited action.

The operator reviews the exact immutable version beside the snapshotted brief and checklist. A decision includes the expected version ID and current state to prevent stale approvals.

### 7.6 Request revision

The transaction:

1. Verifies the current immutable version and operator authorization.
2. Verifies revision capacity including grants.
3. Requires at least one structured required-change item.
4. Completes the review round as `revision_requested`.
5. Sets a creator response deadline from the policy snapshot or an earlier mission deadline.
6. Clones the last submitted version into the editable working draft without changing the immutable version.
7. Moves the work item to `revision_requested`.
8. Appends events and creates an in-app notification.

The next creator submission creates a new immutable version and review round.

### 7.7 Approve to publish

The transaction:

1. Verifies the exact current immutable version and operator authorization.
2. Requires every mandatory checklist item to be accepted.
3. Completes the review round and sets the work item approved-version ID.
4. Moves the work item to `approved_to_publish`.
5. If all required work items are approved, moves the workflow to `approved_to_publish`.
6. Appends events and creates creator notifications.

It must not call `approve_submission`, credit balances, award points, award XP, or label the mission completed or paid.

## 8. API and route design

### 8.1 Creator UI routes

- `/my`: existing mission-record list, enhanced with workflow stage and next action when a workflow exists.
- `/my/:submissionId`: active-mission workspace for one owned mission record.
- `/mission/:slug`: discovery and commitment remain; joined active-workspace missions deep-link to `/my/:submissionId`.

### 8.2 Creator API

- `GET /my-missions/:submissionId/workspace`
- `PATCH /my-missions/:submissionId/work-items/:workItemId/draft`
- `POST /my-missions/:submissionId/work-items/:workItemId/assets/upload-grant`
- `POST /my-missions/:submissionId/work-items/:workItemId/assets/:assetId/finalize`
- `POST /my-missions/:submissionId/work-items/:workItemId/submit`
- `POST /my-missions/:submissionId/fulfillment/received`

### 8.3 Operator UI routes

The operator-led experience lives in the existing admin-authenticated shell:

- `/admin/active-missions`: review queue and fulfilment workload.
- `/admin/active-missions/:workflowId`: mission-wide progress and review workspace.
- `/admin/active-missions/:workflowId/work-items/:workItemId`: exact deliverable review.

### 8.4 Operator API

- `GET /admin/active-missions/queue`
- `GET /admin/active-missions/:workflowId`
- `POST /admin/active-missions/:workflowId/fulfillment/shipped`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/start-review`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/request-revision`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/approve-to-publish`
- `POST /admin/active-missions/:workflowId/work-items/:workItemId/grant-revision`

Mutation requests include an idempotency key and expected state or version. Responses return the updated read model and classified error code.

## 9. UI responsibilities

### 9.1 Creator workspace

The mobile-first page contains:

1. Workflow header: mission, overall stage, responsible party, deadline, and reward wording that remains conditional on later completion.
2. One next-action card.
3. Optional fulfilment card.
4. Per-deliverable progress list.
5. Draft editor with checklist, copy field, URL field, attachment uploader, autosave state, and submit action.
6. Structured feedback panel with response deadline.
7. Approved-version summary and publication-waiting explanation.
8. Timeline and version history.
9. Support route for blocked, cancelled, expired, or policy-exception states.

Only the highest-priority action receives primary-button treatment. Other deliverables remain accessible without competing primary actions.

### 9.2 Operator review experience

The desktop-responsive surface contains:

1. Queue filters for mission, state, SLA risk, and deadline.
2. Queue rows at deliverable granularity.
3. Mission-wide completion summary.
4. Snapshotted brief and checklist.
5. Exact-version copy, link, and signed private asset preview.
6. Previous-version comparison.
7. Structured feedback form with requirement/category anchors.
8. Decision bar for revision or approval to publish.
9. Revision policy and audited extra-round grant.
10. Fulfilment workload for product missions.

The UI does not expose final reward approval in Phase 2.

## 10. Authorization, storage, and privacy

- Creator reads and writes require authenticated ownership of the linked `mission_submissions` row.
- Operator actions require the existing staff/admin session and matching tenant workspace.
- Every workflow table carries `workspace_id` for explicit tenant filtering and RLS.
- Private draft assets live in a dedicated non-public bucket.
- Upload and read grants are short lived and scoped to one object.
- Allowed types initially cover common image and video formats already supported by product policy; executable and archive formats are rejected.
- Server validation enforces configured per-file and per-work-item limits.
- Submitted versions, review decisions, revision grants, and events are append-only.
- Analytics and event metadata exclude email, phone, handle, caption, URL, filename, asset content, feedback text, and raw errors.
- Operational content follows the product retention policy; deletion must preserve the minimum immutable audit facts without retaining creator-authored media longer than required.

## 11. Error and recovery contract

| Code | Meaning | Preserved context | Recovery |
| --- | --- | --- | --- |
| `WORKFLOW_NOT_FOUND` | No owned workflow exists | Mission list remains available | Return to `/my` or retry load |
| `WORKFLOW_MODE_MISMATCH` | A legacy endpoint was used for an active-workspace mission, or vice versa | Current mission and workflow state | Navigate to the authoritative workspace action |
| `WORKFLOW_STALE` | Expected state or version no longer matches | Local draft or review input | Reload current state; copy unsaved text if needed |
| `WRONG_STATE` | Action is invalid for the current stage | Current read model | Explain current owner and next action |
| `REVISION_LIMIT_REACHED` | No revision capacity remains | Draft and prior feedback | Operator grants an exception or approves/cancels |
| `DEADLINE_PASSED` | Creator deadline or mission deadline has passed | Saved draft and assets | Contact support/operator; no silent submission |
| `VALIDATION_FAILED` | Required field, checklist item, URL, or asset is invalid | All valid draft fields | Highlight exact fields and resubmit |
| `ASSET_UPLOAD_FAILED` | Grant, upload, or finalize failed | Draft and other successful assets | Retry only the failed file |
| `NOT_AUTHORIZED` | Creator/operator lacks access | No sensitive record data returned | Reauthenticate or use a permitted workspace |
| `RATE_LIMITED` | Mutation or upload grant exceeded limits | Draft remains local/server saved | Show retry timing |
| `UNKNOWN` | Unclassified failure | Existing saved state | Retry safely and expose a support reference, not raw provider text |

Creator draft, attachments, timeline, and mission facts load independently. Operator queue, brief, asset preview, timeline, and decision controls also fail independently where safe.

## 12. Notifications

Phase 2 adds best-effort in-app notifications for:

- Product shipped.
- Receipt confirmation required.
- Revision requested, including response deadline.
- Draft approved to publish.
- Entire mission approved to publish.
- Creator deadline approaching.
- Creator deadline overdue.

Operator workload is driven by the review queue rather than one notification per submission. Notification failures must never roll back workflow transitions. External delivery channels, preferences, and quiet hours remain out of scope.

## 13. Analytics and metrics

### 13.1 Events

Add typed events:

- `active_mission_workspace_viewed`
- `active_mission_action_clicked`
- `mission_product_received_confirmed`
- `mission_draft_started`
- `mission_draft_version_submitted`
- `mission_review_started`
- `mission_draft_revision_requested`
- `mission_draft_approved_to_publish`
- `active_mission_approved_to_publish`
- `active_mission_recovery_used`

Autosave keystrokes and upload progress do not emit analytics events.

Allowed properties include mission ID/type, work-item platform, workflow state, version number, revision round, deadline bucket, review SLA bucket, device category, locale, error category, and recovery action. They exclude creator identifiers and creator-authored content.

### 13.2 Success metrics

Primary:

- On-time approval rate: accepted active-workspace missions for which every required work item reaches approved to publish at or before both its snapshotted work-item deadline and the overall mission deadline.

Supporting:

- Accepted-to-first-draft median time.
- Draft-to-first-review median time.
- First-pass approval rate.
- Median revision rounds per approved deliverable.
- Creator abandonment before first submission.
- Overdue creator work and overdue operator reviews.
- Upload, validation, concurrency, and recovery rates.
- Operator queue size and age.

Metrics must distinguish creator-owned waiting time from operator-owned waiting time.

## 14. Rollout and compatibility

1. Ship new tables, RLS, storage policy, and APIs without changing legacy behavior.
2. Add mission authoring support for structured deliverables and active-workspace policy.
3. Default every existing and new mission to `legacy` until an operator explicitly enables `active_workspace` with valid structured deliverables.
4. Create workflows only for direct joins or accepted applications after enablement.
5. Permit an explicit operator migration for an existing `joined` record only when it has no submitted legacy content. Record the migration in the timeline.
6. Never migrate submitted, under-review, approved, rejected, declined, or expired legacy records in this phase.
7. Update `/home`, `/my`, `/mission/:slug`, and activation derivation to prefer workflow next actions when a workflow exists and otherwise preserve legacy status behavior.
8. Restrict the legacy `PUT /missions/:slug/submit` path to legacy missions. It returns `WORKFLOW_MODE_MISMATCH` for active-workspace missions so an old client cannot bypass versioning and review.
9. Keep `submit_mission`, `approve_submission`, reward transactions, earnings, points, XP, and passport scoring unchanged.
10. Enable active-workspace missions for an internal pilot before broader authoring access.
11. Monitor transition errors, overdue queues, runtime errors, and primary/supporting metrics before expanding the pilot.

## 15. Testing and verification

### 15.1 Database and integration

- Table constraints, foreign keys, uniqueness, and terminal-state protections.
- RLS isolation across creators and tenant workspaces.
- Workflow creation from direct join and accepted application.
- Optional fulfilment gate and receipt authorization.
- Autosave optimistic-concurrency conflict.
- Signed upload authorization, type/size validation, and finalize checks.
- Idempotent immutable-version submission.
- Concurrent creator submit and operator action rejection.
- Revision limit and extra-round grant.
- Exact-version approval and all-required-deliverables aggregation.
- Proof that approve-to-publish cannot award points, cash, or XP.
- Legacy mission behavior remains unchanged.

### 15.2 Domain and API

- Pure overall-state and next-action derivation.
- Responsible-party and deadline calculations.
- Queue priority comparator.
- Classified error mapping.
- Creator and operator route authorization.
- Read-model behavior for loading, empty, stale, cancelled, expired, and partial-error states.

### 15.3 UI and accessibility

- Mobile creator workspace for every state.
- Autosave, unsaved conflict recovery, upload retry, and submit validation.
- Per-deliverable version and feedback history.
- Operator queue filters and risk ordering.
- Brief/draft comparison and structured decision form.
- Keyboard-only navigation, visible focus, semantic labels, error association, status announcements, reduced motion, zoom, and narrow viewport behavior.
- English and Traditional Chinese dictionary parity.

### 15.4 End to end

Run the full two-actor path against local Supabase or an approved isolated environment:

1. Creator joins or operator accepts application.
2. Operator marks product shipped when required.
3. Creator confirms receipt.
4. Creator drafts, uploads, and submits version 1.
5. Operator starts review and requests revision.
6. Creator submits version 2.
7. Operator approves each required deliverable.
8. Workflow reaches approved to publish.
9. Balances, points, XP, and payout remain unchanged.

Production verification must use a safe disposable account or approved test tenant. A one-time magic link is not treated as reusable evidence.

## 16. Acceptance criteria

Phase 2 is complete when:

1. An active-workspace mission can define multiple structured deliverables and review policy.
2. Join or application acceptance creates one idempotent workflow and its snapshotted work items.
3. Product missions enforce preparing, shipped, and received before drafting; other missions skip the gate.
4. Creators can autosave structured drafts, attach private files or an external URL, and submit immutable versions.
5. Operators can review the exact version, attach structured feedback, request revisions, grant an exception round, and approve to publish.
6. Revision policy defaults to two rounds and is enforced atomically.
7. Each deliverable progresses independently, and the mission becomes approved to publish only after all required deliverables are approved.
8. Every state shows owner, deadline, requirements, next action, and immutable history.
9. Error recovery preserves creator work and prevents stale operator decisions.
10. In-app notifications cover shipment, receipt, revision, approval, and deadlines without controlling transaction success.
11. Analytics can calculate on-time approval without collecting creator-authored content or direct identifiers.
12. Approved to publish does not credit or describe any reward as completed, available, withdrawn, or paid.
13. Legacy missions and final reward functions remain behaviorally unchanged.
14. Focused, full-suite, accessibility, integration, and two-actor end-to-end checks pass, with environment-dependent gaps reported explicitly.

## 17. Rejected alternatives

### Extend `mission_submissions` directly

Rejected because one mutable row cannot represent multiple deliverables, immutable versions, structured review rounds, and fulfilment history safely. It also risks conflating approved to publish with the existing reward-awarding approval function.

### Fully event-source the workflow

Rejected for this phase because projections, replay, event versioning, and operational tooling would add substantial complexity. The chosen model keeps normalized current-state records and an append-only audit timeline.

### Brand-led or two-stage approval

Rejected for Phase 2 to keep ownership and response expectations clear. Brand review can be designed later using the same immutable versions and review interfaces.

### Full in-app media editor

Rejected because drafting, file storage, versioning, and review deliver the required workflow value without building media-production software.

## 18. Follow-on phases

After Phase 2 is proven:

1. Publication instructions, public proof submission, and validation.
2. Final completion and reward-pending state.
3. Wallet withdrawal and payout lifecycle.
4. Brand review, external notification channels, and preferences if validated by operations.
5. Retention mechanics only after outcome data and auditable reward rules exist.
