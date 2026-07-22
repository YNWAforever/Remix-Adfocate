# Adfocate Phase 3: Publication Proof and Validation Design

**Date:** 2026-07-22

**Status:** Draft for written-spec review
**Predecessor:** `2026-07-15-adfocate-active-mission-workspace-design.md`

## 1. Outcome

Phase 3 extends the active-mission workspace from `approved_to_publish` through submission and operator validation of public publication proof.

Creators receive frozen publication instructions, publish externally, and submit one required primary public URL with optional additional URLs and private evidence files. Operators validate the exact immutable proof attempt with a structured checklist or request structured corrections. Every attempt, decision, deadline, and recovery action remains auditable.

Proof verification does not complete the legacy submission or issue rewards. `mission_submissions.status`, points, XP, earnings, and workspace budgets remain unchanged. Final completion and `reward_pending` are reserved for the next phase.

## 2. Approved product decisions

1. Validation is operator-led. Automatic platform API verification is out of scope.
2. A verified proof ends Phase 3 at `proof_verified`; it does not enter `reward_pending`.
3. Each proof attempt requires one primary public URL and may include additional URLs and private evidence files.
4. Corrections create a new immutable proof attempt. Existing attempts are never edited in place.
5. Publication instructions start from mission-template defaults and may be overridden by an operator before approval to publish.
6. Each attempt preserves submitted URLs, evidence references, safely fetched page metadata, operator checklist answers, timestamps, and decisions.
7. Phase 3 extends the current active-mission work-item state machine and interfaces. It does not create a parallel workflow shell.
8. Late proof remains submittable, is marked late, and receives higher queue priority.
9. Metadata retrieval is best-effort. A fetch failure is visible and recoverable but does not discard the proof attempt.
10. Public proof validation and reward approval remain separate trust boundaries.

## 3. Scope

### 3.1 In scope

- Publication-policy defaults on deliverable templates.
- Frozen per-work-item publication instruction snapshots.
- Operator overrides before a work item becomes publishable.
- Creator submission of immutable public-proof attempts.
- One primary URL, optional additional URLs, and optional evidence assets.
- Safe best-effort public page metadata capture.
- Operator claim, structured checklist, correction request, and exact-attempt verification.
- Publication deadlines, late markers, and queue prioritization.
- Attempt history and workflow audit events.
- Creator and operator notifications.
- Privacy-limited analytics and operating metrics.
- Additive migration and explicit setup for already-approved work items.

### 3.2 Out of scope

- Automatic platform API verification or social-network OAuth scopes.
- Downloading or archiving full copies of public media.
- Reach, engagement, or conversion-performance validation.
- Brand-led or two-stage approval.
- Final mission completion, `reward_pending`, reward issuance, withdrawal, or payout.
- Dispute resolution and appeals.
- Editing or publishing content inside Adfocate.
- Changes to legacy mission reward approval.

## 4. Architecture

Phase 3 is an additive bounded extension of the Phase 2 active-mission workflow.

The existing records retain their responsibilities:

- `mission_submissions` remains creator ownership and the later reward anchor.
- `mission_workflows` remains aggregate workflow state.
- `mission_work_items` remains the per-deliverable state anchor.
- `mission_draft_versions` and `mission_review_rounds` remain the immutable pre-publication content-review history.
- `mission_workflow_events` remains the append-only audit timeline.

New publication records have narrow responsibilities:

- A publication instruction snapshot defines what, where, and when the creator must publish.
- A proof attempt records what the creator submitted at a point in time.
- A proof review records how an operator evaluated one exact attempt.
- Proof review items record structured required corrections.

No publication record carries point, XP, cash, budget, or payout mutations.

## 5. Canonical state model

### 5.1 Work-item states

Add these states to `mission_work_items.state`:

- `proof_submitted`
- `proof_under_review`
- `proof_correction_requested`
- `proof_verified`

Canonical transitions:

```text
approved_to_publish
  -> proof_submitted
  -> proof_under_review
  -> proof_verified

proof_under_review
  -> proof_correction_requested
  -> proof_submitted
```

`cancelled` and `expired` remain terminal operational exits where already allowed by policy. A verified proof cannot be silently rewound. Any later invalidation or dispute needs a future explicit state and audit contract.

### 5.2 Workflow state

Add aggregate workflow states:

- `publication_in_progress`: at least one required work item is between `approved_to_publish` and `proof_correction_requested`.
- `proof_verified`: every required work item is `proof_verified`.

Optional work items do not block the aggregate `proof_verified` state.

### 5.3 Ownership and next action

| State                        | Owner            | Primary action                   |
| ---------------------------- | ---------------- | -------------------------------- |
| `approved_to_publish`        | Creator          | Publish and submit proof         |
| `proof_submitted`            | Operator queue   | Start proof review               |
| `proof_under_review`         | Claimed operator | Verify or request correction     |
| `proof_correction_requested` | Creator          | Submit a corrected proof attempt |
| `proof_verified`             | None in Phase 3  | View accepted proof              |

Every visible state includes its owner, deadline, blocking reason, and one primary action.

## 6. Persistence design

All new tenant-owned tables include `workspace_id`. Composite unique keys and foreign keys bind child records to the same workspace as their parent. RLS follows the Phase 2 ownership model: creators can read only records belonging to their own submission; writes occur through guarded security-definer functions or the authorized backend; staff access is workspace-scoped through existing operator authorization.

### 6.1 Deliverable-template publication policy

Extend `mission_deliverable_templates` with:

| Field                      | Type          | Contract                                            |
| -------------------------- | ------------- | --------------------------------------------------- |
| `publication_instructions` | text          | Non-blank when publication proof is enabled         |
| `publication_window_hours` | integer       | Positive duration from approval to publish deadline |
| `required_disclosures`     | jsonb array   | Ordered non-empty disclosure strings                |
| `expected_account`         | text nullable | Expected public handle/account when known           |
| `proof_evidence_policy`    | text          | `optional` or `required`                            |

The existing `platform` field remains the expected publication platform. Template writes validate that an `active_workspace` deliverable has a complete publication policy before a new assignment can be accepted.

### 6.2 `mission_publication_instructions`

One immutable effective instruction snapshot exists per work item once publication is enabled:

| Field                                        | Contract                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| `id`, `workspace_id`, `mission_work_item_id` | Tenant-bound identity; one row per work item         |
| `platform`                                   | Snapshotted expected platform                        |
| `expected_account`                           | Snapshotted expected handle/account, nullable        |
| `instruction_text`                           | Frozen creator-facing instructions                   |
| `required_disclosures`                       | Frozen ordered JSON array                            |
| `evidence_policy`                            | `optional` or `required`                             |
| `publish_due_at`                             | Effective publication deadline                       |
| `source_template_id`                         | Audit pointer, nullable after template deletion      |
| `override_reason`                            | Required when an operator changes a template default |
| `overridden_by`, `overridden_at`             | Operator audit fields, nullable                      |
| `frozen_at`                                  | Time the effective instructions became immutable     |

New workflows snapshot template defaults when work items are created. Operators may revise the pending snapshot only before the work item enters `approved_to_publish`. Approval to publish freezes it. After freezing, changes require an explicit future amendment model rather than in-place mutation.

### 6.3 `mission_publication_proof_attempts`

| Field                                        | Contract                                                       |
| -------------------------------------------- | -------------------------------------------------------------- |
| `id`, `workspace_id`, `mission_work_item_id` | Tenant-bound identity                                          |
| `attempt_number`                             | Positive, unique per work item                                 |
| `primary_url`                                | Normalized HTTPS URL                                           |
| `additional_urls`                            | JSON array of normalized HTTPS URLs                            |
| `submitted_by`, `submitted_at`               | Creator audit identity/time                                    |
| `submitted_late`                             | Derived against frozen `publish_due_at` inside the transaction |
| `metadata_status`                            | `available`, `unavailable`, or `unsafe`                        |
| `metadata_snapshot`                          | Bounded JSON object containing safe response metadata only     |
| `metadata_error_category`                    | Stable category, never raw infrastructure secrets              |
| `content_checksum`                           | Dedupe checksum over normalized URLs and evidence checksums    |

Attempts are insert-only. The work item stores `current_proof_attempt_id` and, after success, `verified_proof_attempt_id`.

### 6.4 Evidence assets

Create `mission_publication_proof_assets` using the Phase 2 private-asset ownership pattern. Evidence must be uploaded, finalized, owned by the creator, bound to the same workspace and work item, and within the existing safe MIME/size policy before it can be attached to an attempt. Attaching an asset freezes its attempt association. Evidence remains private and is exposed to authorized reviewers through short-lived signed URLs.

### 6.5 Proof reviews and correction items

`mission_publication_proof_reviews` contains:

- the exact `mission_publication_proof_attempt_id`;
- a monotonically increasing review number;
- `open`, `correction_requested`, or `verified` state;
- reviewer claim and decision timestamps;
- `creator_response_deadline`, set for correction decisions;
- structured checklist JSON with all required boolean keys;
- optional decision note;
- a unique terminal decision per proof attempt.

The required checklist keys are:

- `publicly_accessible`
- `platform_matches`
- `account_matches`
- `content_matches_approved_version`
- `timing_acceptable`
- `disclosures_present`

`mission_publication_proof_review_items` records ordered required corrections. Categories are `access`, `platform`, `account`, `content`, `timing`, `disclosure`, `evidence`, and `other`. A correction decision requires at least one non-blank item. A verification decision requires every checklist value to be true.

### 6.6 Audit events

Add append-only event types:

- `mission_publication_instructions_frozen`
- `mission_publication_proof_submitted`
- `mission_publication_proof_review_started`
- `mission_publication_proof_correction_requested`
- `mission_publication_proof_resubmitted`
- `mission_publication_proof_verified`
- `mission_publication_metadata_refresh_requested`
- `mission_publication_metadata_refresh_completed`

Event metadata may contain platform, attempt/review number, lateness, timing bucket, evidence count, checklist failure categories, and metadata status. It must not contain URLs, captions, evidence contents, creator identifiers, or raw operator notes.

## 7. Transaction and data flow

### 7.1 Freeze instructions

When an operator approves the exact draft version to publish:

1. Lock the workflow and work item in canonical order.
2. Confirm the approved draft version and effective publication instructions belong to the same workspace and work item.
3. Calculate `publish_due_at` from the approved time plus the effective window, bounded by any earlier workflow deadline.
4. Freeze the instruction snapshot.
5. Move the work item to `approved_to_publish` and append the audit event.

Approval fails if required publication instructions are incomplete. It never fabricates defaults.

### 7.2 Submit proof

The creator submits an expected state/revision, primary URL, additional URLs, and evidence asset IDs.

Before the transaction, the backend normalizes and safety-checks URLs and performs a bounded best-effort metadata fetch. The transaction then:

1. Locks the workflow, work item, and current instruction snapshot.
2. Verifies creator ownership, workspace, state, and expected revision.
3. Verifies all evidence assets are finalized and unassigned.
4. Calculates attempt number, checksum, and `submitted_late` server-side.
5. Inserts the immutable attempt and binds its evidence.
6. Opens an unclaimed proof review.
7. Sets `current_proof_attempt_id`, clears prior proof-review claim fields, and moves the item to `proof_submitted`.
8. Refreshes aggregate workflow state and appends one event.

An identical checksum for the current state returns the existing attempt. A different concurrent submission returns `WORKFLOW_STALE` with the current proof summary.

### 7.3 Review and correction

Starting review locks and claims the exact current attempt, moves the item to `proof_under_review`, and calculates the review SLA from the existing workflow policy.

A correction request:

1. Confirms the reviewer still owns the claim and the attempt is current.
2. Requires a complete checklist and at least one correction item.
3. Sets `creator_response_deadline` to the decision time plus the workflow's snapshotted `revision_response_hours`. A passed publication deadline marks the correction late but does not create an impossible deadline in the past.
4. Closes the review as `correction_requested`.
5. Moves the item to `proof_correction_requested`.
6. Appends an event and best-effort creator notification.

The creator cannot change an attempt. Resubmission follows the normal submit transaction and creates the next attempt number.

### 7.4 Verify proof

Verification:

1. Locks the workflow, work item, current attempt, and open review.
2. Confirms the claimed reviewer, expected state, and exact attempt.
3. Requires every checklist value to be true.
4. Closes the review as `verified` and records the decision time.
5. Stores `verified_proof_attempt_id` and moves the item to `proof_verified`.
6. Refreshes the aggregate workflow state.
7. Appends an event and best-effort creator notification.

The transaction contains no write to `mission_submissions`, points, XP, earnings, rewards, or budgets.

## 8. URL and metadata safety

Proof URLs must:

- use HTTPS;
- contain no embedded credentials;
- use a host allowed for the work item's platform;
- reject localhost, private, loopback, link-local, reserved, multicast, and cloud-metadata destinations after DNS resolution;
- reject non-standard ports unless explicitly allowed by policy;
- remain safe after every redirect.

Metadata retrieval uses a short timeout, small redirect limit, bounded response size, safe content types, and no cookies or authorization headers. It records only bounded fields such as final canonical URL, HTTP status category, page title, Open Graph type, declared publication time when available, and fetch time. It never downloads the full media body.

DNS rebinding defenses revalidate resolved destinations at connection time where the runtime permits. If the platform blocks server fetching, the attempt records `metadata_status='unavailable'` and remains reviewable. Operators may request a bounded refresh; refreshes update metadata fields only and never change creator-submitted URLs or the proof decision.

## 9. API design

Creator endpoints extend the existing `/api/my-missions/:submissionId` surface:

| Method and path                                          | Responsibility                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /publication/:workItemId`                           | Instructions, current state, attempts, corrections, accepted proof |
| `POST /publication/:workItemId/assets/upload-grant`      | Ownership-scoped private evidence upload grant                     |
| `POST /publication/:workItemId/assets/:assetId/finalize` | Finalize evidence metadata                                         |
| `POST /publication/:workItemId/proofs`                   | Submit immutable proof attempt                                     |

Operator endpoints extend `/api/admin/active-missions`:

| Method and path                                                               | Responsibility                   |
| ----------------------------------------------------------------------------- | -------------------------------- |
| `PUT /:workflowId/work-items/:workItemId/publication-instructions`            | Set pre-freeze operator override |
| `POST /:workflowId/work-items/:workItemId/proof-review/start`                 | Claim current attempt            |
| `POST /:workflowId/work-items/:workItemId/proof-review/corrections`           | Request structured correction    |
| `POST /:workflowId/work-items/:workItemId/proof-review/verify`                | Verify exact attempt             |
| `POST /:workflowId/work-items/:workItemId/proofs/:attemptId/metadata-refresh` | Safe bounded refresh             |

All mutation endpoints require expected state/revision and an idempotency key. Read models return stable camel-case API fields and never expose raw storage paths or privileged fetch diagnostics.

## 10. Error and recovery contract

| Condition                               | Response                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| Missing creator/operator ownership      | `404 NOT_FOUND`                                             |
| Wrong state or outdated attempt         | `409 WORKFLOW_STALE` with current summary                   |
| Attempt already terminal                | `409 WRONG_STATE`                                           |
| Invalid URL/platform/evidence/checklist | `422 VALIDATION_FAILED` with field categories               |
| Unsafe resolved destination             | `422 UNSAFE_PROOF_URL`                                      |
| Missing required instructions           | `409 PUBLICATION_SETUP_REQUIRED`                            |
| Metadata unavailable                    | Successful proof submission with structured metadata status |
| Storage/network interruption            | Retryable error; no partial attempt or orphan binding       |

Client recovery replaces stale cache data with the returned current summary, preserves unsent form values locally, and asks the creator to review before resubmission. Operator stale conflicts return to the current attempt without applying a decision to an outdated proof.

## 11. Creator experience

Within the existing active-mission work-item page:

- `approved_to_publish` displays one primary action: **Publish and submit proof**.
- A frozen instruction card shows platform/account, approved version, instruction text, disclosures, evidence requirement, and deadline.
- The form provides a required primary URL, optional additional URLs, and optional/required evidence uploads according to policy.
- Confirmation states that proof validation does not issue rewards.
- A metadata warning explains when automatic preview is unavailable without implying the proof is invalid.
- `proof_correction_requested` leads with categorized required changes and the response deadline.
- Previous attempts, metadata snapshots, and decisions are read-only.
- `proof_verified` shows the accepted attempt and decision timestamp with the message: proof verified; reward processing is a later step.

Mobile uses stacked sections and a sticky primary action. Desktop may place instructions and proof side by side. Status changes use an accessible live region; focus moves to the first invalid field or the new state heading after a successful transition.

## 12. Operator experience

The active-mission queue gains filters for proof state, lateness, metadata status, platform, publication deadline, mission, and reviewer. Server order remains canonical: overdue publication/review SLA first, then nearest deadline, oldest submitted attempt, and stable ID.

The proof-review view presents:

- approved immutable draft version and assets;
- frozen publication instructions;
- submitted URLs as safe external links;
- bounded fetched metadata and fetch status;
- private evidence through short-lived signed URLs;
- structured checklist;
- prior attempts and decisions;
- correction or verify actions.

Verification confirmation names the exact attempt and explicitly states that no reward is issued. Correction requires at least one categorized action item. The UI contains no final reward control.

## 13. Notifications and analytics

Best-effort in-app notifications cover:

- publication ready;
- publication deadline approaching;
- publication deadline overdue;
- correction requested;
- proof verified.

Analytics events include:

- `publication_instructions_viewed`
- `publication_proof_form_started`
- `publication_proof_submitted`
- `publication_proof_metadata_unavailable`
- `publication_proof_review_started`
- `publication_proof_correction_requested`
- `publication_proof_resubmitted`
- `publication_proof_verified`
- `publication_proof_recovery_used`

Allowed properties are locale, mission type, platform, state, timing bucket, attempt/review number, evidence count, URL count, lateness, metadata status, checklist failure categories, and recovery category. URLs, captions, account handles, evidence contents, notes, and user identifiers are forbidden.

## 14. Metrics

Operational metrics are:

- approved-to-proof-submitted conversion;
- on-time proof submission rate;
- first-attempt verification rate;
- correction rate;
- attempts per required deliverable;
- median proof-submission-to-verification time;
- metadata-fetch failure rate;
- stale-conflict and upload-recovery rates.

Metrics exclude optional work items from mission-completion denominators and never infer reward completion from `proof_verified`.

## 15. Rollout and compatibility

The migration is additive and replays cleanly from an empty database.

For new active-workspace assignments, publication policy is snapshotted with the deliverable. For work items already at `approved_to_publish` when Phase 3 ships, the system does not invent template defaults retrospectively. Those items surface `PUBLICATION_SETUP_REQUIRED` to operators. A one-time operator action creates and immediately freezes explicit instructions before creator proof submission is enabled.

Legacy missions continue to use their existing `content_urls` and final reward approval. Phase 3 endpoints reject legacy submissions. Existing Phase 2 draft, review, revision, and approval transitions remain unchanged except for freezing complete publication instructions at approval.

Rollback disables proof mutations and queue actions while preserving all instruction snapshots, attempts, evidence, reviews, and workflow events. Verified records are never deleted or rewound. Only work items with no proof attempt may be returned operationally to the Phase 2-only path.

## 16. Testing and verification

### 16.1 Database and domain tests

- Full migration replay and seed.
- Tenant-composite foreign keys, grants, RLS, and PostgREST relationship uniqueness.
- State-transition matrix and aggregate workflow derivation.
- Instruction freeze and override immutability.
- Attempt sequencing, checksum idempotency, and immutable rows.
- Exact-attempt review and concurrent claim behavior.
- Correction requirements and checklist-complete verification.
- Late submission and canonical queue ordering.
- Evidence ownership, finalization, and binding.
- Zero reward/status/budget mutations through proof verification.

### 16.2 URL safety tests

- Scheme, credential, host, port, and platform validation.
- IPv4/IPv6 private, loopback, link-local, reserved, multicast, and metadata destinations.
- Safe and unsafe redirect chains.
- DNS rebinding guard behavior supported by the runtime.
- Timeout, response-size, redirect-count, content-type, and malformed metadata handling.
- Platform fetch blocking and manual review fallback.

### 16.3 API and UI tests

- Creator read/submit/resubmit and cross-creator isolation.
- Operator instruction override, claim, correction, refresh, and verification.
- Stale-state recovery with current summary.
- Upload interruption and retry without orphaned attempt bindings.
- Creator and operator state rendering, form validation, and read-only history.
- Both locales, keyboard completion, visible focus, live announcements, and descriptive errors.
- Browser acceptance at 390x844 and 1440x900 with no horizontal page overflow.

### 16.4 Repository verification

The implementation plan must include focused Phase 3 tests, complete integration tests against a clean local Supabase stack, lint, type-check, unit/component tests, production build, and browser acceptance. Integration verification must confirm that tests actually ran with `RUN_INTEGRATION=1` and the repository's exact `SUPABASE_SERVICE_KEY` environment variable.

## 17. Acceptance criteria

Phase 3 is complete when:

1. Every newly approved active-workspace deliverable has frozen, complete publication instructions.
2. A creator can submit one primary URL, optional additional URLs, and policy-compliant evidence.
3. Every proof attempt is immutable, tenant-bound, numbered, and auditable.
4. Unsafe URLs are rejected without network access to private or reserved destinations.
5. Metadata failure never loses an otherwise valid proof attempt.
6. Operators review and decide the exact current attempt through the structured checklist.
7. Corrections require structured items and produce a new immutable attempt.
8. Late submissions remain possible and are clearly prioritized and labeled.
9. `proof_verified` requires every required work item to be verified.
10. No Phase 3 transition changes `mission_submissions.status`, points, XP, earnings, rewards, or budgets.
11. Legacy missions and every Phase 2 action retain existing behavior.
12. Existing approved work items require explicit operator setup rather than fabricated defaults.
13. Notifications are best-effort and analytics contain no creator-authored content or identifiers.
14. Focused, full integration, static, build, and browser verification pass before rollout.

## 18. Rejected alternatives

### Separate publication workflow aggregate

Rejected because it duplicates the Phase 2 ownership, queue, deadline, notification, and audit machinery. Dedicated proof tables provide isolation without a second workflow shell.

### Reuse legacy `mission_submissions.content_urls`

Rejected because that surface is coupled to legacy final approval and rewards. Reuse would weaken the deliberate proof-versus-reward boundary and create PostgREST/state compatibility risk.

### Edit proof attempts in place

Rejected because operators must know exactly what they reviewed. Immutable attempts make corrections, timing, metadata, and decisions auditable.

### Automatic platform API verification first

Rejected because platform access, ownership scopes, rate limits, and inconsistent metadata would expand the trust boundary before the operational checklist is proven.

### Archive full public media

Rejected because it introduces substantial copyright, storage, privacy, and retention obligations. Phase 3 preserves bounded metadata and creator-provided private evidence only.

## 19. Follow-on phases

After Phase 3 is proven:

1. Final completion and `reward_pending` state with explicit auditable reward eligibility.
2. Reward issuance and wallet transaction detail.
3. Withdrawal and payout lifecycle.
4. Disputes, invalidation, and appeals.
5. Brand-led review, external notification channels, and preferences if operations validate the need.
6. Automatic platform verification only where reliable provider access and measurable operational value justify it.
