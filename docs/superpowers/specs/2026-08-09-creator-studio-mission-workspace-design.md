# Creator Studio Mission Workspace Design

**Date:** 2026-08-09
**Status:** Approved design for implementation planning
**Scope:** Creator Studio accepted-mission execution workspace

## Summary

Creator Studio's next phase will deepen the accepted-mission workspace: the creator-facing loop from an accepted mission through drafting, asset upload, submission, requested changes, resubmission, and approval.

The experience will use a focused workbench. The creator sees one active deliverable at a time, a compact navigator for the remaining work items, and a next-action panel that makes the current valid action explicit. The workspace will extend the existing submission/work-item APIs and connect naturally to the completed Creator Case review flow.

## Goals

- Let a creator complete an accepted mission without leaving Creator Studio.
- Present one authoritative workspace model for the mission, submission, work items, drafts, assets, status, and review feedback.
- Preserve drafts across navigation and reloads.
- Make upload, submission, requested-change, and resubmission states understandable and retryable.
- Enforce creator ownership and submission scoping on every read and mutation.
- Preserve idempotency when a draft save or submission is retried after an uncertain network result.
- Give operators a clean downstream review handoff through the existing Creator Case module.

## Non-goals

- Mission discovery or search redesign.
- Application decision or acceptance workflows.
- Operator review UI redesign; Creator Case already owns that boundary.
- Payout, reward, or finance workflows.
- General-purpose chat or collaboration.
- AI content generation.
- A new storage mechanism when the existing upload-grant, upload, and finalize contracts are sufficient.

## Existing context and reuse

The repository already exposes the core submission workspace boundaries:

- `GET /my-missions/:submissionId/workspace` for the workspace read model.
- `PATCH /my-missions/:submissionId/work-items/:workItemId/draft` for draft persistence.
- `POST /my-missions/:submissionId/work-items/:workItemId/assets/upload-grant` for upload authorization.
- `POST /my-missions/:submissionId/work-items/:workItemId/assets/:assetId/finalize` for persisted asset finalization.
- `POST /my-missions/:submissionId/work-items/:workItemId/submit` for work-item submission.

The repository also contains a Creator Studio mission list and a submission workspace route, plus separate publication-proof endpoints for missions that require evidence. The implementation plan must verify the current source contracts before editing them and keep publication proofs as a distinct evidence lane.

## User journey

1. The creator opens an accepted mission from "My missions."
2. The workspace shows the mission brief, deadline, overall status, and work-item navigator.
3. The creator selects a work item and works in the focused workbench.
4. The creator saves a draft, uploads required assets, and sees explicit pending/finalized/failed states.
5. The creator submits a ready work item for review.
6. The creator sees review status and feedback beside the relevant work item.
7. If changes are requested, the creator edits the draft and resubmits.
8. When all required work is approved, the workspace shows a completion summary and next action.

The workspace must support resuming from any point in this journey after a reload or navigation away.

## Domain state model

Each work item follows this state progression:

```text
Not started
  -> Drafting
  -> Ready to submit
  -> Submitted
  -> Changes requested
  -> Resubmitted
  -> Approved
```

The server remains authoritative for state transitions. The client may optimistically reflect draft edits, but it must reconcile with the persisted workspace response after every mutation.

The primary action is derived from the authoritative state:

| State | Primary action |
| --- | --- |
| Not started | Start draft |
| Drafting | Save draft / upload required assets |
| Ready to submit | Submit for review |
| Submitted | View submission status |
| Changes requested | Address requested changes |
| Resubmitted | View resubmission status |
| Approved | Continue to next work item or view completion |

An overall mission status is derived from the work-item states and required evidence. A single work item may be edited without hiding the status of the remaining items.

## Architecture and data flow

### Workspace read model

`GET /my-missions/:submissionId/workspace` should provide one `SubmissionWorkspace` projection containing:

- mission identity, brief, deadline, and requirements;
- submission identity, creator ownership, and overall status;
- ordered work items;
- each work item's instruction, current draft, assets, validation state, and workflow state;
- review feedback and revision history where available;
- the computed next action;
- optional analytics or metadata availability states.

The client should not reconstruct the workspace by joining unrelated raw resources. Core fields required to work on and submit a mission are strict. Optional enrichment may return an explicit unavailable state without blocking the core workspace.

### Mutation lanes

- Draft changes remain scoped to one submission and work item.
- Asset handling remains grant -> upload -> finalize. A failed upload must not discard a saved draft.
- Submission is a state transition for one work item and must reject incomplete required inputs with item-level validation errors.
- Review feedback is read through the workspace model and is not duplicated into a creator-owned local state machine.
- Publication proofs remain separate from ordinary deliverable assets and are used only when the mission's requirements call for them.

### Command identity and retries

Every mutation that can be retried after an uncertain result receives a stable command ID for the logical user action. The client generates the ID once, retains it through retry, and clears it only after success or explicit cancellation/context change. The server treats a repeated identical command as an idempotent replay and a reused ID with different input as a conflict.

## Focused workbench UI

The workspace has three structural regions:

1. **Mission header** - mission title, deadline, overall status, and save/connection state.
2. **Compact work-item navigator** - ordered deliverables, completion state, review markers, and current selection.
3. **Active workbench** - the selected brief/editor/upload area plus a right-side next-action panel.

The next-action panel is intentionally small and action-oriented. It should tell the creator what is blocking progress, what is already complete, and which action is safe to take next. It should not become a second full dashboard.

Interaction rules:

- Selecting a work item preserves the current draft and updates the active workbench.
- Saving shows an explicit saved, saving, failed, or retry state.
- Upload cards distinguish pending, finalized, failed, and retryable assets.
- Requested changes keep the feedback visible beside the affected work item.
- Switching work items or reloading must not lose locally edited content that has already been persisted.
- Workspace or submission context changes clear pending command identities and draft state that belongs to the previous context.
- Keyboard focus, labels, and error messages must support accessible operation of the navigator, editor, upload controls, and primary action.

## Error and security behavior

- Missing authentication or creator ownership is denied without disclosing another submission's existence.
- A creator requesting a different creator's submission receives a non-disclosing 404 response.
- Invalid state transitions return a conflict response with the current authoritative state.
- Invalid draft or submission input returns validation details tied to the affected work item.
- Upload grant, upload, and finalize failures preserve any persisted draft and expose a retry path.
- Core workspace loading failures block the workbench with a recoverable error; optional enrichment failures render as unavailable rather than blank or misleading data.
- Logs and analytics may include submission ID, work-item ID, command ID, and event type, but must not include draft text, private asset contents, or secrets.

## Testing strategy

### Server and contract tests

- creator ownership and cross-submission access denial;
- workspace read model shape and ordering;
- valid and invalid work-item transitions;
- draft save and reload persistence;
- upload grant/finalize failure and retry behavior;
- stable command replay and conflict behavior for draft and submit mutations;
- requested-change feedback and resubmission transitions;
- publication-proof isolation from ordinary deliverable assets.

### Client tests

- loading, empty, unavailable, and error states;
- work-item navigator selection and next-action rendering;
- draft persistence across navigation and reload;
- upload pending/finalized/failed/retry states;
- submission success and item-level validation errors;
- requested-change feedback and resubmission;
- approved-state rendering and completion summary;
- clearing pending command state when submission context changes.

### End-to-end acceptance path

The minimum acceptance path is:

```text
accepted mission
  -> open workspace
  -> save draft
  -> upload and finalize assets
  -> submit
  -> receive requested changes
  -> resubmit
  -> approved
```

The acceptance test must use an isolated test database or deterministic repository fixture and must not mutate production data.

## Rollout and observability

The implementation should reuse the existing route and storage contracts where they already satisfy this design. Any schema change must be delivered through a reviewed migration and verified against an isolated database before production consideration. No production seed, deployment, or migration is part of this design approval.

Instrument the core lifecycle with low-cardinality events such as `workspace_opened`, `draft_saved`, `asset_finalized`, `work_item_submitted`, `changes_viewed`, `work_item_resubmitted`, and `work_item_approved`. Events should carry submission/work-item/command correlation identifiers without sensitive content.

## Acceptance criteria

- An accepted creator can open an isolated mission workspace from Creator Studio.
- The workspace presents the brief, all work items, current status, and next action from one read model.
- A creator can save, reload, upload, finalize, submit, receive feedback, revise, and resubmit without leaving the workspace.
- Failed network operations have explicit retry behavior and do not create duplicate state transitions.
- Ownership and state-transition checks are enforced server-side.
- The focused workbench remains usable on narrow screens and with keyboard navigation.
- Core tests cover the complete acceptance path and negative authorization/state cases.
- Operator review continues through the existing Creator Case boundary.

## Implementation boundary

The implementation plan should be decomposed around the existing read model, server mutation contracts, focused client query/mutation layer, workbench UI, and acceptance tests. It should not include unrelated Creator Studio redesign, mission discovery changes, payment work, or production rollout actions.
