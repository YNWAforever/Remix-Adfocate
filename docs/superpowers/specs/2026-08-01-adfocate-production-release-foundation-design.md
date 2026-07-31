# Adfocate Production Release Foundation Design

Date: 2026-08-01  
Status: Approved for implementation planning  
Production change status: Not authorized

## 1. Purpose

Adfocate's application code now contains the creator activation, active mission,
publication proof, and mission completion/reward-handoff workflow. Production
Supabase does not yet contain the full schema those capabilities require. The
missing-schema incident on mission join demonstrated that application
compatibility alone is not an adequate release process.

This phase builds a repository-controlled, repeatable release train that can
prove the migration chain against production's actual shape, prepare a
single-workspace/single-mission pilot, and produce an approval-ready evidence
bundle. It does not modify production or enable a real pilot.

## 2. Approved Decisions

1. The phase prioritizes production release safety rather than a new creator
   feature.
2. The release strategy is expand-contract: additive schema first, compatible
   application second, pilot enablement last.
3. The intended first rollout is one allow-listed workspace and one new
   mission.
4. The pilot remains financially neutral and ends at `reward_pending`.
5. Expansion requires one real end-to-end workflow, seven stable days, no
   integrity incident, no new unexpected 5xx, and a successful containment
   drill.
6. Production schema mutation requires a separate, explicit go-live approval
   after the implementation and evidence bundle are reviewed.
7. The repository is the control plane. A Supabase development branch or
   disposable database may be used for rehearsal, but branch promotion is not
   the sole source of release truth.

## 3. Goals

- Inventory and fingerprint the Phase 2-4 migration chain.
- Detect production schema drift before any write occurs.
- Rehearse migrations from both an empty database and a production-shaped
  disposable database.
- Prove legacy mission compatibility before and after schema expansion.
- Make production-targeting commands fail closed unless every approval input
  matches.
- Prepare a database-authoritative pilot selector for exactly one workspace
  and one new mission.
- Produce sanitized, append-only evidence for go-live review and later pilot
  expansion decisions.
- Define containment that preserves workflow, proof, decision, and audit
  records.

## 4. Out of Scope

- Executing migrations against production.
- Enabling a real production pilot.
- Moving an in-progress legacy mission into the active-workspace flow.
- Issuing rewards, writing financial ledger entries, reserving or deducting a
  budget, paying out, or supporting withdrawal.
- Adding a formal dispute workflow.
- Destructive down migrations.
- Rewriting historical mission, proof, reward, or audit state.
- General retention, notification preference, or daily engagement features.

## 5. Release Inputs

The manifest covers the ordered migration chain needed by:

- Phase 2 active mission workspace, beginning with
  `20260715163350_active_mission_workspace.sql` and its hardening migrations.
- Phase 3 publication proof, beginning with
  `20260723090000_publication_proof_validation.sql` and its rollout,
  compatibility, policy, instrumentation, and existing-setup migrations.
- Phase 4 mission completion and reward handoff, including reward schema,
  contract capture, transitions, notifications, and release hardening once
  that stacked work is rebased and integrated onto the implementation branch.

The implementation must discover files from the repository and validate them
against the explicit manifest. It must not infer that a timestamped file was
applied merely because a later file exists.

## 6. Architecture

The release train has five ordered stages:

1. **Inventory:** build and validate the migration manifest, checksums,
   dependencies, required schema capabilities, and application compatibility
   floor.
2. **Rehearsal:** run empty replay, production-shape replay, integration,
   security, idempotency, and compatibility gates in a disposable environment.
3. **Approval:** produce an immutable evidence bundle containing the exact
   target, change digest, safety references, results, and proposed commands.
4. **Expand and deploy:** after a separate approval, apply additive migrations,
   validate schema, deploy compatible application code, and prove health while
   the new workflow remains dark.
5. **Pilot:** enable one new mission, monitor its end-to-end workflow through
   `reward_pending`, and decide whether to expand, hold, or contain.

This phase may implement and test tooling for all five stages in disposable
environments. It authorizes operational execution only through stage 3.
Production execution of stage 4 and real pilot execution of stage 5 require
the separate go-live approval defined above.

## 7. Component Boundaries

### 7.1 Migration manifest

A pure repository artifact with no credentials or network access. For each
migration it records:

- repository path and version;
- SHA-256 checksum;
- ordering and dependency information;
- phase and capability labels;
- expected tables, columns, functions, policies, triggers, grants, or storage
  policies;
- whether the migration is expected to be transaction-safe and replay-safe.

Manifest validation rejects missing files, duplicate versions, ordering
conflicts, checksum drift, unknown dependencies, and unclassified migrations.

### 7.2 Read-only production preflight

The preflight reads:

- Supabase migration history;
- relevant `information_schema` and PostgreSQL catalogs;
- RPC signatures and grants;
- RLS policies and storage policies;
- application deployment and compatibility metadata.

It produces a normalized schema fingerprint and classifies each expected
capability as present, absent, divergent, or unverifiable. It has no write
credential and cannot invoke mutation RPCs.

### 7.3 Rehearsal runner

The runner accepts only a disposable local database or explicitly identified
Supabase development branch. It rejects the production project reference.

It performs:

1. complete empty-database migration replay;
2. replay from a production-shaped schema snapshot;
3. a second replay/idempotency assessment where the migration contract permits;
4. integration, RLS, tenant-isolation, storage-policy, and service-role tests;
5. legacy join/submit compatibility checks before and after expansion;
6. an active workflow through verified proof, completion, and
   `reward_pending`;
7. financial-neutrality assertions.

Production-shaped rehearsal data must be structural or sanitized. Creator PII,
access tokens, content assets, and secrets must not enter repository artifacts.

### 7.4 Approval evidence bundle

The bundle is generated only when preflight and rehearsal pass. It contains:

- exact Supabase project reference and schema fingerprint;
- application commit and migration manifest digest;
- migration range and checksums;
- test and rehearsal results;
- backup or recovery reference;
- proposed production and containment commands;
- named execution, observation, rollback, and approval responsibilities;
- creation time and expiry;
- known warnings and explicitly skipped checks.

The bundle is append-only. A changed target, schema fingerprint, application
commit, migration file, or command invalidates it and requires regeneration.
Secrets and personal data are redacted.

### 7.5 Production migration executor

This is the only component permitted to write production schema. It is
implemented in this phase but not executed.

Before any write, it must verify:

- the target exactly matches the approved production project reference;
- the supplied bundle is unexpired;
- the approved manifest digest and current files match;
- the current schema fingerprint matches the approved preflight;
- required backup/recovery and responsibility fields are present;
- the operator supplied the explicit go-live authorization input defined by the
  runbook.

It applies forward-only migrations in manifest order, stops on the first
failure, never attempts an automatic down migration, and emits a postflight
record.

### 7.6 Application deployment verifier

This read-only observer confirms:

- deployed commit and environment;
- health endpoint and core route availability;
- schema capability compatibility;
- legacy mission join and read paths;
- no unexpected 5xx or new runtime error cluster;
- no pilot flag or mission mode was enabled prematurely.

An application failure leaves the expanded schema dark and triggers rollback to
the last known compatible deployment.

### 7.7 Pilot selector

Pilot scope is database-authoritative, not a client-side feature flag. The
selector requires an exact workspace and an exact new mission. It refuses:

- a mission outside the approved workspace;
- a mission with an existing submission or workflow;
- more than one enabled pilot mission;
- an incomplete workflow or reward contract;
- activation before schema and deployment postflight gates pass.

Once an active-workspace join exists, the mission cannot be downgraded to
legacy mode. Containment closes new entry and preserves the active workflow.

### 7.8 Runtime observers and evidence writer

Observers collect:

- request failures by deployment and route;
- PostgreSQL/PostgREST errors and RPC failures;
- illegal state transitions, orphans, duplicate decisions, and missing reward
  contracts;
- workflow queue age, review latency, overdue items, and retry health;
- notification failures;
- proof/completion/reward-pending counts;
- assertions that no ledger, payout, balance, or budget movement occurred.

The evidence writer stores sanitized results, deployment IDs, schema
fingerprints, workflow identifiers, decisions, and gate status. It does not
store secrets, creator PII, or uploaded content.

## 8. Data Flow

1. Repository migrations and manifest enter static validation.
2. The preflight reads production and emits the production-shape fingerprint.
3. The rehearsal runner builds a disposable environment from that shape and
   applies the manifest.
4. Passing tests produce the approval evidence bundle.
5. The user reviews the bundle and separately authorizes or rejects go-live.
6. If authorized later, the executor revalidates target, fingerprint, digest,
   and approval immediately before applying migrations.
7. Postflight schema verification unlocks application deployment verification.
8. Passing deployment verification unlocks selection of one pilot mission.
9. Runtime evidence determines expand, hold, or containment after the pilot.

No later stage may infer approval from the success of an earlier stage.

## 9. Failure Handling and Containment

### Preflight drift

Abort before writes. Classify the difference, revise or repair the manifest,
and regenerate all evidence.

### Rehearsal failure

Do not create an approval bundle. Production remains untouched.

### Migration failure

Stop on the first error. Preserve any successfully committed additive objects,
keep new capabilities dark, capture the actual schema fingerprint, and use a
reviewed forward repair. Never auto-down.

### Deployment failure

Keep the pilot disabled and restore the last known compatible deployment. The
expanded schema remains inert.

### Pilot incident

Close the pilot mission to new entry and freeze risky mutations. Preserve
existing workflows, submissions, assets, proof attempts, completion decisions,
reward contracts, pending handoffs, events, and audit records. Repair forward
or resume only after an incident review and fresh evidence.

### Containment limitations

Containment is not a promise to make every UI state legacy-compatible. An
active-workspace workflow remains active-workspace data. The safe action is to
stop new entry, preserve evidence, and keep valid read/support paths available.

## 10. Test Strategy

### Static tests

- manifest schema and deterministic digest;
- duplicate/missing version and dependency detection;
- checksum drift detection;
- production project rejection by rehearsal;
- expired or mismatched evidence rejection by executor;
- secret and PII redaction.

### Migration tests

- empty-database replay;
- production-shape replay;
- expected capability verification after every phase;
- replay/idempotency behavior;
- failure at controlled boundaries without destructive cleanup.

### Security tests

- tenant isolation and RLS for creator, operator, finance, and service roles;
- RPC signature and grant boundaries;
- private asset path and storage-policy enforcement;
- no creator-controlled reward mutation;
- no application route that can run schema migration.

### Compatibility tests

- legacy mission listing, detail, join, submit, and my-missions before and after
  schema expansion;
- active-workspace entry only for the selected mission;
- existing legacy records remain unchanged;
- client behavior when capabilities are absent, present, or divergent.

### Workflow tests

- new pilot mission from join through draft, review, publication proof,
  verification, completion, and `reward_pending`;
- correction and retry paths;
- duplicate request and concurrency safety;
- immutable reward contract and append-only completion decisions;
- no reward issuance or financial movement.

### Release tests

- deployment commit and health verification;
- schema capability endpoint or equivalent read-only check;
- route smoke checks;
- runtime 5xx and database-error inspection;
- containment drill;
- evidence-bundle completeness and reproducibility.

## 11. Operational Ownership

The runbook must name roles rather than silently assigning permissions:

- **Executor:** runs approved migration and deployment commands.
- **Observer:** watches schema, application, workflow, and error signals.
- **Containment owner:** can stop new pilot entry and restore the compatible
  application.
- **Product owner:** decides expand, hold, or contain.
- **Approver:** explicitly authorizes production mutation after reviewing the
  evidence bundle.

One person may hold multiple roles, but each responsibility and action must be
recorded.

## 12. Pilot Exit Criteria

Expansion is allowed only when all are true:

1. one real creator completes the selected mission through verified proof,
   completion, and `reward_pending`;
2. the pilot has seven consecutive stable days;
3. no schema, tenant-isolation, state-integrity, or financial-neutrality
   incident occurred;
4. no new unexpected application 5xx or database error cluster is attributable
   to the rollout;
5. workflow and notification retry queues are healthy;
6. one containment drill succeeds without deleting or rewriting workflow
   history;
7. the evidence bundle is complete and reviewed.

Elapsed time or creator volume alone cannot authorize expansion.

## 13. Deliverables

- migration manifest and validator;
- read-only production preflight;
- disposable rehearsal runner;
- production executor with fail-closed approval guards;
- application deployment verifier;
- pilot selector and invariant checks;
- sanitized evidence-bundle generator;
- release, containment, rollback, and pilot runbooks;
- automated tests for all boundaries above;
- an approval-ready production go-live evidence bundle.

## 14. Acceptance Criteria

- Manifest validation detects missing files, duplicates, ordering errors,
  dependency errors, and checksum drift.
- Production drift is reported without write access.
- Empty and production-shape rehearsals are repeatable and pass the defined
  migration, integration, security, compatibility, and workflow gates.
- Production execution refuses a wrong target, stale bundle, changed schema,
  changed digest, missing safety reference, or absent explicit authorization.
- Legacy mission join and submission work before and after expansion.
- Rehearsal completes one active workflow through `reward_pending` with no
  financial movement.
- Containment stops new pilot entry while preserving every existing workflow
  and audit record.
- The generated bundle contains enough exact, sanitized evidence for a human to
  approve or reject production go-live without reconstructing the release.
- No production mutation or real pilot enablement occurs during this phase.

## 15. Implementation Sequence

The later implementation plan should order work as:

1. manifest and schema fingerprint contracts;
2. read-only preflight;
3. disposable rehearsal and migration gates;
4. security, compatibility, and workflow verification;
5. evidence bundle;
6. guarded production executor;
7. deployment verifier;
8. pilot selector and runtime observers;
9. runbook, containment drill, and release acceptance;
10. final evidence generation and separate go-live approval request.
