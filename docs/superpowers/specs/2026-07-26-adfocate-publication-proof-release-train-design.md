# Adfocate Publication Proof Release Train Design

**Date:** 2026-07-26

**Status:** Approved

## Objective

Complete the remaining publication-proof work as a release-ready PR. The release must preserve the additive migration history, replay cleanly on an empty local Supabase database, use deterministic creator/operator seed data, execute integration tests without Phase 3 skips, pass static and browser acceptance, and prove that proof verification does not change rewards or budgets.

## Starting Point

The branch is `codex/publication-proof-validation-design`. Tasks 1-10 are approved. Task 11 feature commit `117f76b` and interaction-hardening commit `fd71a99` are implemented; `fd71a99` still requires final independent re-review before Task 11 closes.

The remaining approved product scope is:

- Task 12: notifications, analytics, metrics, and bilingual copy;
- Task 13: existing-approved setup and compatibility rollout;
- Task 14: clean integration, static, build, and browser acceptance;
- final branch review, push, and ready-for-review pull request.

## Delivery Architecture

The remaining phase is a five-gate release train.

### Gate 1: Close Task 11

Independently review `fd71a99`. Findings remain owned by Task 11 and require a focused RED-GREEN cycle before approval. The gate closes only when the operator publication review experience is approved and the worktree is clean.

### Gate 2: Environment Preflight

Before Task 12 implementation, verify the local release toolchain:

- Docker is installed and running;
- Supabase CLI can start and reset the local stack;
- required local ports are available;
- Node dependencies and project commands resolve;
- the browser automation runtime can launch at the required viewports;
- deterministic local creator/operator credentials can be seeded and used.

The preflight may install free local prerequisites needed for the approved workflow. It must not provision paid resources, modify production secrets, or mutate production data.

### Gate 3: Task 12 Instrumentation and Copy

Implement publication-ready, approaching, overdue, correction, and verified in-app notifications. Notification delivery is best-effort: insertion or dispatch failure is recorded but never rolls back a publication transition.

Implement the eight approved operational metrics:

1. proof submission conversion;
2. on-time publication rate;
3. first-attempt verification rate;
4. correction-request rate;
5. average attempts per verified item;
6. median review time;
7. metadata-failure rate;
8. stale-recovery rate.

Optional work items are excluded from required-item completion denominators. `proof_verified` remains reward-neutral and must never be translated into reward completion.

Implement the nine approved analytics events with an allowlist. Event properties may contain only:

- locale;
- mission type;
- platform;
- state;
- timing bucket;
- attempt or review number;
- URL and evidence counts;
- lateness;
- metadata status;
- checklist failure categories;
- recovery category.

Authored content, publication URLs, account names, storage paths, raw correction prose, and personal identifiers are forbidden.

Complete English and Traditional Chinese creator/operator strings for statuses, errors, checklists, corrections, metadata, confirmations, recovery, and notifications. Every added English key must have an explicit Traditional Chinese value.

### Gate 4: Task 13 Compatibility Rollout

Add one explicit setup mutation for existing `approved_to_publish` items that lack frozen publication instructions. The mutation must require:

- service-authorized active operator membership in the target workspace;
- exact workflow, work-item, state, and revision anchors;
- a UUID idempotency key;
- no existing publication instruction;
- no publication-proof attempt;
- complete operator-authored instructions and policy.

The mutation freezes the supplied instruction snapshot immediately and emits a privacy-safe audit event. It must never infer defaults, fabricate policies, rewind an item with history, alter rewards, or change Phase 2 legacy contracts.

Document a feature-disable rollback. Disabling Phase 3 blocks new proof mutations and operator queue actions while preserving all instruction, attempt, review, evidence, audit, and verified records.

## Deterministic Acceptance Fixture

Task 14 uses a reproducible local fixture rather than ad hoc data. It contains:

- one creator identity;
- one operator identity with active workspace membership;
- one workspace and active mission workflow;
- required and optional publication items;
- one existing approved item requiring explicit setup;
- required-evidence and optional-evidence policies;
- metadata-success and metadata-unavailable proof URLs;
- correction, resubmission, and verification paths;
- baseline points, XP, earnings, rewards, and workspace budget snapshots.

The creator and operator browser flows operate on this same workflow. IDs may be deterministic seed UUIDs, but user-visible screenshots and reports must not expose secrets.

## Data Flow and Boundaries

Tasks 12 and 13 consume the workflow events and state machine established by Tasks 6-8. Notifications observe committed transitions and cannot participate in their transaction outcome. Metrics and analytics use derived categories instead of authored or identifying values.

Task 13's setup mutation is the only compatibility entry point for existing approved items. New active-workspace items continue using frozen instructions from the normal approval flow. Items with attempts cannot return to setup.

Task 14 exercises the same public creator and operator HTTP surfaces used by the UI. Direct SQL is used only for fixture setup, persisted-boundary inspection, and diagnostics—not to bypass acceptance flows.

## Error Handling

Environment preflight failures must identify the missing executable, unavailable port, stopped service, missing environment variable, or failed seed step and provide the exact recovery command.

Notification failures are best-effort and observable. Analytics validation fails closed by dropping or rejecting disallowed properties; it never serializes an unsafe payload. Compatibility setup returns stable authorization, not-found, validation, wrong-state, stale, and idempotency-conflict codes.

Browser and integration failures return to the task that owns the implicated file. The owning task adds a failing regression, applies the minimal fix, reruns its focused verification, and then reruns the complete Task 14 sequence.

## Verification Sequence

Task 14 must run in this order:

1. Start a clean local Supabase stack and reset all migrations and seeds.
2. Apply the deterministic acceptance fixture.
3. Run integration tests with `RUN_INTEGRATION=1` and confirm Phase 3 cases execute rather than skip.
4. Run `npm.cmd run test:active-missions`.
5. Run the full Vitest suite.
6. Run lint, type-check, and the production build.
7. Run creator browser acceptance at 390 x 844.
8. Run operator browser acceptance at 1440 x 900.
9. Compare persisted reward and budget boundaries before and after proof verification.
10. Run final code review, `git diff --check`, and worktree cleanliness checks.

Creator browser acceptance covers approved instructions, URL and evidence validation, submit, metadata-unavailable warnings, correction resubmission, immutable history, the exact verified message, stale recovery, keyboard completion, visible focus, live announcements, sticky actions, and no horizontal page overflow.

Operator browser acceptance covers filters and canonical ordering, explicit setup, exact-attempt claim/checklist/correction/verify, signed private evidence, stale recovery, metadata refresh, absence of reward controls, keyboard operation, visible focus, and no horizontal page overflow.

## Release Criteria

The branch is release-ready only when:

- Task 11, Task 12, and Task 13 have independent approval;
- the additive migration chain replays from an empty database;
- all Phase 3 integration tests execute unskipped and pass;
- focused tests, full tests, lint, type-check, and build exit successfully;
- creator and operator browser acceptance pass at the required viewports;
- points, XP, earnings, rewards, and workspace budget remain unchanged;
- no unreviewed or uncommitted changes remain;
- known unrelated baseline warnings are documented and proven unchanged.

After final approval, push `codex/publication-proof-validation-design` and create a ready-for-review pull request containing migration, test, browser, reward-neutrality, and known-warning evidence. Production merge and deployment are outside this design.

## Non-Goals

- Squashing or rewriting the additive Phase 3 migration history.
- Provisioning paid or production infrastructure.
- Modifying production secrets or data.
- Treating proof verification as reward completion.
- Adding product features outside Tasks 11-14.
- Merging or deploying the final pull request.
