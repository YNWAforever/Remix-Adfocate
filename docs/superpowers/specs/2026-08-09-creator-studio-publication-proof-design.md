# Creator Studio Publication Proof Design

**Date:** 2026-08-09
**Status:** Approved for implementation planning
**Scope:** Publication-proof evidence inside the Creator Studio focused workbench

## Summary

The next Creator Studio phase adds a publication-proof lane to the existing
focused workbench. Mission authoring explicitly declares proof requirements per
deliverable. A creator submits a published URL and may attach supporting
evidence. Platform metadata is retryable; unsupported or unavailable metadata
falls back to manual operator verification. Creator Case owns the operator
decision, while Creator Studio remains the creator-facing submission surface.

Publication proof is a separate evidence domain. It must not be represented as
an ordinary deliverable asset, and it must not replace the existing draft,
asset, or work-item state contracts.

## Goals

- Let mission authors require publication proof for individual deliverables.
- Let creators submit a published URL with optional supporting evidence without
  leaving the focused workbench.
- Keep metadata inspection retryable and support a safe manual-review fallback.
- Let operators verify proof or request correction through the existing Creator
  Case boundary.
- Preserve submitted proof attempts as an auditable history; corrections create
  new attempts.
- Reuse the Creator Studio repository, ownership, command, and workspace
  boundaries.
- Keep ordinary deliverable assets and publication-proof evidence isolated.

## Non-goals

- Automatic proof approval or provider-based mission completion.
- Reward issuance, payout, finance handoff, or changes to legacy submission
  status semantics.
- A new operator review application or a visual redesign of Creator Case.
- General social-provider integrations beyond the metadata contract needed for
  retryable inspection and manual fallback.
- Production migration, seeding, deployment, or credential changes.

## Existing context and reuse

The current branch contains:

- `CreatorStudioRepository` and its in-memory and Supabase adapters;
- one `SubmissionWorkspace` projection for the focused workbench;
- ordinary deliverable draft and asset commands with command replay protection;
- the Creator Case module and operator route for workspace-scoped review;
- Creator Studio workflow/work-item tables and command/event ledgers.

Adjacent active-mission work contains behavioral references for proof attempts,
metadata refresh, correction, verification, and proof evidence uploads. Those
files are references only. This phase defines the current branch's own
Creator Studio proof contract and does not copy the adjacent worktree
wholesale.

## Chosen architecture

Extend the existing Creator Studio boundary with a distinct publication-proof
lane:

1. Mission authoring accepts a structured per-deliverable proof requirement.
2. Workflow initialization snapshots that requirement onto the corresponding
   work item so later mission edits cannot change an accepted creator's proof
   contract.
3. `CreatorStudioRepository` owns creator-side proof reads and mutations.
4. Proof-specific tables and security-definer RPCs own attempt, evidence,
   command, and event consistency.
5. Creator Case owns operator authorization and the verify/request-correction
   decision, delegating persistence to the proof adapter/RPC boundary.
6. `SubmissionWorkspace` remains the single creator read model; the client does
   not join a second proof endpoint to reconstruct the workbench.

### Mission authoring contract

The authoring input accepts legacy string deliverables and structured
deliverables. Legacy strings are normalized to structured snapshots with no
proof requirement, preserving existing missions. A structured deliverable has
the following canonical shape:

```text
{
  title: string,
  instructions: string,
  requirements: {
    caption: boolean,
    externalUrl: boolean,
    checklist: string[]
  },
  requiresAsset: boolean,
  proofRequirement: null | {
    kind: "publication_url",
    allowedPlatforms: string[],
    evidence: "optional"
  }
}
```

`proofRequirement` is copied into the immutable work-item snapshot. An empty
or absent requirement means that the work item has no publication-proof lane.
The server validates the requirement; the client cannot make proof optional
for an item whose snapshot requires it.

### Workspace projection

Each work item retains its existing `assets` field for ordinary deliverables
and gains a separate `publicationProof` section. The section is absent or
`not_required` when no requirement exists. When required, it exposes:

- the frozen requirement;
- the current proof state;
- the editable draft attempt, if any;
- the active submitted attempt;
- immutable submitted-attempt history;
- normalized metadata status and safe summary fields;
- proof evidence state and metadata;
- creator-visible correction feedback;
- proof-specific validation contributing to `ready_to_submit`.

The strict workspace core remains available even when metadata enrichment is
unavailable. Unavailable metadata is represented explicitly and never as a
fabricated successful verification.

## Repository and command interface

`CreatorStudioRepository` gains proof methods alongside the existing draft and
ordinary-asset methods:

- create or resume a creator-owned proof attempt for a work item;
- create a proof-evidence upload grant;
- finalize proof evidence after storage-object validation;
- submit the current proof attempt for operator review;
- refresh normalized publication metadata.

Submitting after a correction creates a new attempt linked to the corrected
attempt. A draft attempt may be edited before submission. Once submitted, an
attempt's URL, evidence identity, and review lineage are immutable.

Every method receives the existing creator context and a stable command ID.
Command identity is scoped to the submission, work item, attempt where
applicable, and actor. Identical replays return the original result; a reused
ID with a different canonical request returns `command_conflict`.

The Creator Case repository adds the operator proof decision seam used by the
existing Creator Case route and UI:

- `verify` marks the submitted attempt verified;
- `request_correction` freezes the attempt with a safe correction message.

The operator command requires explicit workspace, creator, submission,
workflow, work-item, attempt, actor, and command context. It is persisted by a
proof-specific transaction and returns the case/proof projection needed by the
operator UI. Creator Case owns the decision and authorization; Creator Studio
owns the creator projection and proof storage boundary.

## Proof state and data flow

The proof lifecycle is:

```text
not_required
  or not_started
  -> draft
  -> submitted
  -> changes_requested
  -> resubmitted
  -> verified
```

`resubmitted` identifies a new attempt created after correction. Metadata has an
independent status of `pending`, `available`, `unavailable`, or `failed`.
Metadata failure does not silently verify proof and does not block manual
submission. Supporting evidence is optional; if supplied, it must be finalized
before the attempt can be submitted.

The server performs these checks:

- URL uses an allowed HTTP(S) form and matches the frozen platform requirement
  when the platform can be determined;
- unsupported or unavailable platform metadata becomes manual-review state;
- evidence grants use server-generated paths in the private proof bucket;
- finalize validates the exact reservation, owner lineage, object existence,
  stored size, MIME type, and expiry;
- only a creator owning the submission may create, upload, finalize, or submit
  its proof;
- only an authorized operator in the explicit workspace may verify or request
  correction;
- ordinary Creator Studio assets cannot be attached to a proof attempt, and
  proof evidence cannot satisfy an ordinary asset requirement.

Every state-changing command is one security-definer RPC transaction that
records the command receipt, attempt/evidence change, required workflow event,
and correction or verification result together. Direct client table writes are
not permitted; the signed storage upload is followed by server validation and
finalization.

## Error semantics

The repository exposes stable public errors without raw database or provider
details:

- `submission_not_found` for unknown, cross-owner, or cross-workspace context;
- `proof_requirement_missing` when a proof command targets an item without a
  frozen requirement;
- `proof_attempt_not_found` and `proof_attempt_conflict` for invalid lineage or
  state;
- `proof_url_invalid` for malformed or disallowed URLs;
- `proof_evidence_not_found`, `proof_evidence_not_uploaded`, and
  `proof_evidence_expired` for evidence failures;
- `invalid_transition` for commands not valid in the authoritative state;
- `version_conflict` when a creator is acting on stale workspace data;
- `command_required` and `command_conflict` for idempotency violations;
- `db_error` or a safe provider-unavailable result with a correlation ID.

An operator correction requires a non-empty safe message. A failed metadata
refresh leaves the submitted attempt intact and exposes a retry path. A failed
evidence operation leaves the draft and prior attempts intact.

## Focused workbench UI

Add a `PublicationProofPanel` to the active workbench only for items with a
frozen proof requirement. It contains:

- URL input and platform guidance;
- metadata checking, available, unavailable/manual-review, and retry states;
- optional proof-evidence upload and finalize states;
- immutable attempt history;
- operator correction feedback;
- one authoritative proof next action.

The existing `AssetUploadPanel` remains responsible only for ordinary
deliverable assets. The existing `NextActionPanel` gains proof-specific labels
without creating a second competing primary action. The panel follows current
keyboard, narrow-screen, focus, context-change, and recoverable-error rules.

## Testing strategy

### Domain and repository tests

Run the same contract suite against the in-memory and Supabase adapters. Cover:

- explicit requirement snapshots and legacy deliverable normalization;
- URL validation and allowed-platform matching;
- optional evidence grant, finalize, retry, and storage isolation;
- metadata available, unavailable, failed, and refreshable states;
- immutable submitted attempts and correction-linked resubmission;
- same-command replay and conflicting replay;
- workspace/owner mismatch with no writes;
- operator verification and correction authorization;
- proof validation contributing to work-item readiness;
- separation from ordinary deliverable assets.

### Route and client tests

Verify creator routes carry submission/work-item/attempt context and command IDs,
operator routes translate Creator Case proof decisions, and no route performs
direct proof-table writes. Verify safe errors, unavailable metadata, retry
behavior, and non-disclosing workspace mismatch responses.

### Workbench tests

Cover the required/absent proof panel, URL entry, optional evidence, metadata
fallback, correction feedback, new-attempt resubmission, verified state, one
next action, keyboard operation, narrow-screen layout, and clearing pending
proof command state when the submission context changes.

### Isolated acceptance path

The minimum end-to-end path is:

```text
author proof requirement
  -> accepted mission snapshots requirement
  -> creator submits URL
  -> metadata unavailable falls back to manual review
  -> optional evidence is uploaded and finalized
  -> operator requests correction
  -> creator submits a new immutable attempt
  -> operator verifies proof
```

The acceptance path uses an isolated test database or deterministic repository
fixture. It must not mutate production data.

## Rollout and safety boundary

Any schema or RPC change is delivered through a reviewed migration and verified
against the isolated test environment before production consideration. No live
migration, seed, upload, deployment, provider credential, reward, or payout
action is included. Existing unrelated untracked artifacts, worktrees, and
publication-proof migration drafts remain untouched until separately reviewed.

## Rejected alternatives

### Separate proof workspace

Rejected because it would duplicate workspace context and force the creator to
leave the focused workbench for a deliverable-specific requirement.

### Mandatory evidence for every URL

Rejected because it adds storage and creator friction even when a URL is
available for manual verification.

### Automatic provider approval

Rejected because provider metadata is an input to review, not an authorization
to complete a mission.

### Reusing adjacent active-mission code wholesale

Rejected because its route, repository, and operator assumptions belong to a
different boundary. Only its proof behavior is a reference.

## Acceptance criteria

- Authors can declare publication proof per deliverable without changing the
  meaning of existing legacy deliverables.
- Accepted workspaces contain a frozen, explicit proof requirement.
- Creators submit URL proof and optional evidence inside the existing workbench.
- Unsupported or unavailable metadata safely falls back to manual verification.
- Submitted attempts are immutable; corrections create linked new attempts.
- Creator Case is the only operator decision boundary for verify/correction.
- Ordinary assets and proof evidence remain isolated in storage, schema, and
  repository contracts.
- All mutations are owner-scoped, idempotent, atomic, and retryable.
- Contract, route, client, workbench, and isolated acceptance tests cover the
  complete path and negative cases.
- No production state or credentials are changed by this phase.
