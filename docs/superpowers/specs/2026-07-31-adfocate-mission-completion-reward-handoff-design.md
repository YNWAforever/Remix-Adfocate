# Adfocate Mission Completion and Reward Handoff Design

**Date:** 2026-07-31

**Status:** Approved design; awaiting written-spec review

**Phase:** Active mission Phase 4

**Depends on:** Publication-proof validation through `proof_verified`

## 1. Purpose

This phase closes the operational gap between verified publication proof and financial processing.

An authorized operator can confirm that an active-workspace mission is complete only when every required publication item has verified proof. Adfocate then freezes the reward contract and workspace processing SLA, records an auditable completion decision, advances the active-mission workflow to `reward_pending`, and creates a durable finance handoff.

This phase does not issue rewards. It does not credit points, cash, earnings, or XP; mutate workspace budgets; approve the legacy mission submission; or implement withdrawal and payout. Its purpose is to create a trustworthy, reviewable boundary between content verification and later financial issuance.

## 2. Approved Product Decisions

1. The next phase is mission completion plus `reward_pending`, not reward issuance or payout.
2. Completion uses a system eligibility gate followed by explicit operator approval.
3. Reward amounts come from an immutable contract frozen when the creator joins.
4. `reward_pending` is a durable finance handoff and does not mutate any financial balance or budget.
5. Legacy `mission_submissions.status` remains unchanged.
6. Erroneous pending decisions use append-only cancellation with a required reason and return the workflow to `proof_verified`.
7. The creator sees a workspace-configured processing SLA snapshot and a target timestamp when one can be calculated.
8. The creator receives in-app notifications for both pending and cancellation decisions.
9. Pending and cancelled states include a contextual support route; a formal dispute workflow remains out of scope.
10. Existing workflows without a joined reward contract require an audited operator backfill. Current mission values are never silently treated as historical joined values.

## 3. Goals

- Make completion eligibility deterministic and source-backed.
- Preserve the exact reward promise that applied when the creator joined.
- Give operators one explicit, idempotent completion action with a clear no-issuance warning.
- Give creators an honest completion state, frozen reward breakdown, processing target, timeline, and support route.
- Give finance a durable, filterable, read-only queue backed by the same facts.
- Permit safe correction before issuance without deleting or rewriting audit history.
- Keep tenant boundaries, financial boundaries, and legacy reward behavior intact.

## 4. Out of Scope

- Crediting points, cash, earnings, or XP.
- Reserving, decrementing, or otherwise changing workspace budgets.
- Finance issuance actions or automatic issuance jobs.
- Withdrawal, payment methods, payout processing, paid or failed payout states, tax, compliance, or post-issuance reversals.
- A formal creator dispute case-management workflow.
- Email, WhatsApp, or other external notification channels.
- Automatic platform proof verification.
- Changes to legacy mission approval or reward issuance.
- Retention mechanics, streaks, or new gamification rewards.

## 5. Design Principles

### 5.1 Separate trust boundaries

Proof verification establishes that required public work was accepted. Completion approval establishes mission eligibility and creates a financial handoff. Reward issuance remains a later, separate authority.

### 5.2 Freeze facts instead of re-reading mutable configuration

Reward amounts and processing expectations are snapshots. A later mission or workspace configuration edit cannot alter a creator's pending handoff.

### 5.3 Append-only decisions

Approvals and cancellations are durable decisions. Correction adds a new decision and changes the pending record through a guarded transition; it never edits or deletes prior evidence.

### 5.4 One canonical source per concern

- Active-mission workflow: creator-facing operational state.
- Reward contract: promised joined reward.
- Completion decision: who approved or cancelled, against which evidence.
- Pending reward: finance handoff state.
- Active-mission event log: chronological product history.
- Notification: actionable creator communication.

## 6. Canonical State Model

The active-mission workflow adds one state:

```text
proof_verified
  -> operator completion approval
reward_pending
  -> authorized cancellation before issuance
proof_verified
```

Rules:

- Only `proof_verified` can enter `reward_pending`.
- `reward_pending` does not mean rewarded, available, credited, withdrawn, or paid.
- Required publication items determine eligibility. Optional items are excluded from the denominator.
- Cancellation preserves all verified publication attempts and returns the mission to reassessment at `proof_verified`.
- Reapproval after cancellation creates a new completion decision and a new pending-reward record.
- Legacy submission status remains unchanged throughout.

## 7. Persistence Model

Names below describe the intended boundaries. Final migration names may follow established repository naming conventions without changing the contracts.

### 7.1 `mission_reward_contracts`

One immutable contract per active-workspace workflow.

Core fields:

- `id`
- `workspace_id`
- `workflow_id`
- `submission_id`
- `mission_id`
- `points_amount` as a non-negative integer
- `cash_amount` as a non-negative fixed-precision amount
- `currency` as an ISO currency code
- `xp_amount` as a non-negative integer
- `source`: `join` or `operator_backfill`
- `source_mission_updated_at`
- `confirmed_by` for backfills
- `confirmation_reason` for backfills
- `created_at`

Constraints:

- Unique `workflow_id`.
- All amounts are non-negative.
- Backfill rows require `confirmed_by` and a non-empty reason.
- Join rows do not accept an operator-authored reason.
- Client roles cannot insert, update, or delete rows directly.
- Contract rows are immutable after insertion.

For new active-workspace joins, contract creation occurs in the same authoritative join/workflow transaction. Points, cash, currency, and XP resolve from the join-time mission configuration. An unoffered reward component is stored explicitly as zero.

### 7.2 Existing-workflow backfill

Existing workflows remain completion-ineligible until a contract exists.

The operator backfill surface shows current mission reward settings only as reference. Authorized staff must explicitly enter or confirm the historical contract, select the evidence source, and provide a reason. The server records the operator identity and source timestamp. A backfill cannot overwrite an existing contract.

### 7.3 `mission_completion_decisions`

Append-only approval and cancellation decisions.

Core fields:

- `id`
- `workspace_id`
- `workflow_id`
- `decision_kind`: `approved` or `cancelled`
- `reward_contract_id`
- `pending_reward_id` for cancellation
- `supersedes_decision_id` for cancellation
- `workflow_revision`
- `required_item_count`
- `verified_required_item_count`
- accepted proof-attempt identifiers or a canonical evidence snapshot
- `reason_category` and `reason_note` for cancellation
- `decided_by`
- `decided_at`
- `idempotency_key`
- normalized request hash

Decision rows are never updated or deleted.

### 7.4 `mission_pending_rewards`

The durable finance queue and handoff.

Core fields:

- `id`
- `workspace_id`
- `workflow_id`
- `submission_id`
- `creator_id`
- `mission_id`
- `reward_contract_id`
- `completion_decision_id`
- frozen points, cash, currency, and XP values
- `status`: `pending` or `cancelled`
- `processing_window_days`
- `target_at`
- `created_at`
- cancellation decision reference and `cancelled_at`

Constraints:

- At most one `pending` record per workflow through a partial unique index.
- Frozen reward and SLA fields cannot be edited.
- The only permitted update is the guarded `pending -> cancelled` transition performed by the cancellation command.
- Direct client writes are denied.

The finance queue is a scoped query or view over `mission_pending_rewards`; it is not a second mutable queue.

### 7.5 Workflow events and notifications

New active-mission event types:

- `mission_completion_approved`
- `mission_reward_pending_cancelled`

New creator notification types:

- `mission_reward_pending`
- `mission_reward_pending_cancelled`

Payloads contain bounded identifiers, state, target timestamp, and route context. They do not contain email addresses, handles, authored notes, raw proof URLs, signed evidence URLs, or credentials.

## 8. Workspace SLA Contract

The workspace configures a non-negative processing window in calendar days. Calendar days are explicit; this phase does not introduce holiday or business-day calendars.

Completion snapshots:

- the configured processing-window value;
- the decision timestamp; and
- `target_at`, calculated from those two values.

If the workspace has no usable configured window, completion remains allowed but `target_at` is null. The creator sees that finance review is pending without a fabricated date. Later workspace configuration changes do not alter existing handoffs.

## 9. Completion Eligibility

The server calculates eligibility. The client cannot assert it.

Approval requires:

1. Authenticated staff with the existing active-mission review authority in the workflow workspace.
2. Workflow state exactly `proof_verified`.
3. Expected workflow revision matches the locked row.
4. Every required publication work item is `proof_verified`.
5. Each required item has an accepted, exact proof-attempt anchor.
6. No required item has an open correction or review state.
7. One immutable reward contract exists.
8. No active pending-reward record exists.
9. A valid idempotency key accompanies the normalized request.

Optional work items never block completion and are not counted as verified requirements.

## 10. Completion Transaction

One server-controlled transaction:

1. Resolves staff identity and workspace authority from the authenticated session.
2. Locks the workflow and verifies its expected revision.
3. Recalculates eligibility from authoritative records.
4. Loads the immutable reward contract and current workspace SLA.
5. Claims the idempotency key against a normalized request hash.
6. Inserts the approval decision with the exact evidence snapshot.
7. Inserts the pending-reward handoff.
8. Advances the workflow to `reward_pending` and increments its revision.
9. Appends the active-mission timeline event.
10. Returns the canonical workflow, decision, and handoff projection.

Any failure in steps 1–9 rolls back the transaction. Notification creation happens through the repository's failure-isolated notification pattern so a delivery problem cannot undo a valid completion decision. Failed notifications remain retryable.

The transaction contains no write to legacy submission status, creator points, XP, earnings, cash balances, reward ledgers, redemptions, or workspace budget records.

## 11. Cancellation Transaction

Cancellation requires:

- authenticated active-mission staff in the same workspace;
- workflow state `reward_pending`;
- matching expected workflow revision;
- a pending handoff that has not entered any future issuance state;
- a bounded reason category;
- a non-empty operator note; and
- an idempotency key.

The transaction:

1. Locks the workflow and pending handoff.
2. Validates authorization, revision, and current state.
3. Claims the idempotency key.
4. Inserts an append-only cancellation decision referencing the approval.
5. Transitions the pending handoff to `cancelled`.
6. Returns the workflow to `proof_verified` and increments its revision.
7. Appends the cancellation event.
8. Returns the canonical reassessment state.

Publication attempts, verification decisions, reward contracts, and the original completion decision remain unchanged.

## 12. API and Service Boundaries

The exact route naming should follow existing active-mission conventions. Required capabilities are:

- Read completion eligibility and reward-contract status for one workflow.
- Create or read an audited reward-contract backfill.
- Approve mission completion.
- Cancel a pending reward for reassessment.
- List workspace-scoped pending rewards with filters and stable ordering.
- Read creator-visible handoff status through the existing mission workspace projection.

All mutation inputs use typed validation, expected revisions, and idempotency headers. Workspace identity is derived and authorized server-side rather than trusted from an unverified body value.

Typed errors include:

- `REWARD_CONTRACT_REQUIRED`
- `COMPLETION_NOT_ELIGIBLE`
- `WORKFLOW_STALE`
- `WRONG_STATE`
- `PENDING_REWARD_EXISTS`
- `PENDING_REWARD_NOT_FOUND`
- `CANCELLATION_NOT_ALLOWED`
- `IDEMPOTENCY_CONFLICT`
- `FORBIDDEN`

Errors expose safe recovery guidance without leaking cross-workspace record existence.

## 13. Operator Experience

The operator completion panel appears only for `proof_verified`.

It shows:

- required-item eligibility and exact accepted attempts;
- any blocking condition;
- the frozen points, cash, currency, and XP contract;
- reward-contract source and backfill provenance when applicable;
- the workspace processing target;
- an explicit warning that completion does not issue a reward; and
- an exact confirmation action.

After success, focus returns to the status heading and the canonical `reward_pending` state replaces the approval action.

The cancellation action appears only for a pending handoff. Its dialog requires a reason category and note, identifies the exact handoff, explains reassessment behavior, and preserves input after recoverable errors.

## 14. Creator Experience

The mission workspace shows:

- `Reward pending` as the canonical state;
- a plain-language mission-complete message;
- the frozen reward breakdown;
- the target date when available, or honest pending wording when absent;
- the completion and finance-handoff timeline;
- an explanation that the reward is not yet credited or available; and
- a contextual `Contact support` action.

Cancellation shows that the handoff returned for reassessment, preserves verified proof history, and directs the creator to the current mission state. It never suggests that credited funds were reversed.

All copy ships in English and Traditional Chinese.

## 15. Finance Experience

This phase provides a read-only pending-reward queue.

The queue:

- is scoped to authorized workspaces;
- defaults to earliest target date, then oldest creation timestamp;
- filters by workspace, target-date status, reward type, and pending status;
- shows creator, mission, frozen reward, SLA target, completion decision, and evidence availability;
- links to the active-mission timeline; and
- contains no issue, pay, release, or mark-paid action.

Cancelled handoffs remain queryable for audit but are not part of the default pending view.

## 16. Analytics and Operational Metrics

Privacy-safe events may include:

- completion review viewed;
- completion approved;
- reward-pending state viewed;
- pending reward cancelled;
- creator support selected; and
- finance queue viewed or filtered.

Allowed properties are bounded categorical values and identifiers already permitted by the activation analytics contract, such as mission ID, locale, device category, reward-component presence, state, source, and classified error category.

Client analytics must not contain reward amounts, creator-authored notes, proof URLs, evidence paths, emails, handles, or raw errors.

Operational metrics may aggregate:

- proof-verified to reward-pending time;
- pending handoffs by workspace and age;
- SLA target breaches;
- cancellation rate and bounded reason category; and
- missing-contract backfill volume.

Metrics never treat `reward_pending` as issued or paid.

## 17. Security and Tenant Isolation

- Every read and mutation is workspace-scoped from authenticated authority.
- Creator reads are limited to handoffs attached to their own submission.
- Operator and finance reads require existing staff workspace access.
- Backfill, approval, and cancellation are server-controlled actions.
- Direct table writes from browser roles are denied.
- Privileged database functions use an empty search path, explicit schema qualification, revoked public execution, and narrow grants consistent with existing secure RPC patterns.
- Signed publication-evidence access remains private and time-bounded; the handoff stores identifiers, not signed URLs.
- Cross-workspace identifiers return a non-enumerating authorization response.
- Operator notes are audit data and never enter notification or analytics payloads.

## 18. Concurrency and Recovery

- Row locking plus expected revisions prevent approval against stale evidence.
- A partial unique index prevents two active handoffs for one workflow.
- Idempotency binds the key to action, workflow, expected revision, and normalized payload.
- Reusing a key with the same payload returns the original result.
- Reusing a key with a different payload returns `IDEMPOTENCY_CONFLICT`.
- An ambiguous client failure preserves the key for safe retry.
- Definitive stale or wrong-state responses clear the client key and reload canonical state.
- Notification failures do not roll back completion or cancellation.
- Finance queue reads derive from durable handoff records and require no cache to remain correct.

## 19. Migration and Compatibility

The change is additive:

- add reward-contract, completion-decision, and pending-reward tables;
- extend active-mission workflow and event constraints with the new states and event types;
- extend notification constraints and renderers;
- add workspace SLA configuration;
- update the active-workspace join transaction to create the reward contract; and
- leave legacy mission schemas and approval functions behaviorally unchanged.

No migration guesses historical reward values. Existing active workflows remain usable through proof verification, but completion is blocked until the audited backfill succeeds.

Migration replay must pass from an empty local database and from the current migration chain. Forward-only migrations preserve existing publication-proof records and verified attempts.

## 20. Test Strategy

### 20.1 Schema and migration

- Clean database reset and complete migration replay.
- Constraints for non-negative rewards, contract immutability, backfill provenance, allowed states, and one active handoff.
- Privilege and RLS checks for creator, operator, finance, anonymous, and cross-workspace access.

### 20.2 Reward contract

- New active-workspace join creates exactly one contract with join-time values.
- Retry does not duplicate the contract.
- Later mission edits do not alter it.
- Existing workflows cannot complete without a contract.
- Audited backfill requires authority, evidence source, and reason.
- Backfill cannot overwrite or cross workspace.

### 20.3 Completion

- All required proof verified permits approval.
- Optional items do not block approval.
- Missing, correcting, submitted, or under-review required items block approval.
- Stale revisions and wrong states fail safely.
- Concurrent approval attempts create one decision and one handoff.
- Same-key retries return the original result; changed payloads conflict.
- Database failures roll back decision, handoff, workflow, and event together.

### 20.4 Cancellation

- Pending handoff can be cancelled once with a reason and note.
- Cancellation appends history and returns the workflow to `proof_verified`.
- Repeated, stale, cross-workspace, or non-pending cancellation fails safely.
- Reapproval after cancellation creates new records without rewriting old ones.

### 20.5 Financial neutrality and compatibility

Before and after approval and cancellation, assert exact equality for:

- legacy submission status;
- creator points;
- XP;
- earnings and cash balances;
- legacy issued-reward, ledger, and redemption records;
- workspace budget and budget transactions; and
- existing legacy approval behavior.

### 20.6 UI and browser acceptance

- Operator eligibility, backfill, approval, stale recovery, ambiguous retry, and cancellation.
- Creator pending, no-target fallback, cancellation, timeline, and support route.
- Finance queue ordering, filtering, tenant isolation, and read-only behavior.
- English and Traditional Chinese.
- Keyboard completion, focus restoration, live announcements, zoom, responsive layouts, reduced motion, and no horizontal overflow.
- Notification links land on the exact mission state.

## 21. Operations

The runbook covers:

- identifying workflows that require reward-contract backfill;
- acceptable evidence sources and backfill reason categories;
- approving completion;
- cancelling a pending handoff before issuance;
- interpreting missing SLA targets;
- reconciling the finance queue against completion decisions;
- retrying failed in-app notifications; and
- escalating creator support without promising issuance or payout.

Operational logs contain identifiers and classified outcomes, not proof URLs, signed URLs, credentials, or operator-authored notes.

## 22. Acceptance Criteria

This phase is complete when:

1. A new active-workspace join freezes one immutable reward contract.
2. An existing workflow requires an audited contract backfill before completion.
3. The server independently proves every required item is verified.
4. An authorized operator can approve completion exactly once per active cycle.
5. Approval atomically creates the decision, pending handoff, workflow state, and timeline event.
6. The creator and finance queue show the same frozen reward and SLA facts.
7. Cancellation preserves history and returns the mission to `proof_verified`.
8. Retries, concurrency, stale clients, and notification failures cannot duplicate or corrupt a handoff.
9. Cross-workspace reads and writes are denied without leaking record existence.
10. Legacy submission state, creator balances, XP, earnings, issued-reward and ledger records, redemptions, and workspace budgets remain unchanged.
11. English, Traditional Chinese, accessibility, integration, and browser acceptance gates pass.
12. No UI or metric describes `reward_pending` as issued, available, withdrawn, or paid.

## 23. Later Phases

The next financial phase may consume pending handoffs to implement reward issuance, ledger entries, budget accounting, reconciliation, and reversal rules. Withdrawal and payout remain a separate phase after issuance is auditable. Formal disputes and external notification channels should be designed only after those financial states exist.
