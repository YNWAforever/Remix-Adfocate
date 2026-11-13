# Protected combined-baseline XP delta

Status: **HOLD for a live database release and for pilot enablement.** This profile supplies a separately gated execution path for the existing combined migration history. The ordinary reviewed source-range executor keeps its v1 contract.

The only permitted release delta is `20261113090001 / active_assignment_xp_neutrality`, source LF SHA-256 `846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2`. Its approved behavior is active assignment join/accept at zero XP, legacy/NULL join at +10 XP, with existing awards, workflow gates, quota, replay and ACLs preserved. No production SQL, history repair, cohort/mission creation, pilot enablement, publication or rewards are authorized by this document or by an offline preparation result.

## Source and evidence commits

1. Merge the implementation to main and obtain a successful main/push run of `ci.yml`, with both `build-test` and `integration` successful. This immutable code revision is `sourceCommit`.
2. Collect complete, fresh proof artifacts using that revision. Create a descendant main commit containing only sanitized JSON beneath `docs/verification/releases/`. This is `evidenceCommit`; its own SHA is supplied by the protected workflow, outside its bundle.
3. The runner checks the actual checkout HEAD, clean tracked/untracked tree, ancestry, changed paths and committed artifact bytes. All tracked bytes outside the release JSON area must be identical between these commits. A deployment may use either commit only after this equivalence is established.

The v2 envelope does not change the v1 evidence core. It binds the complete before fingerprint descriptor to the core preflight hash, the complete equivalence proof to the rehearsal hash, and all 16 named report payload hashes to the core test records. Approval is over the **outer v2 bundle digest**:

```text
APPROVE mhkoayftiuojxlrkollf <actual-outer-bundle-digest>
```

The placeholder above is documentation, never approval. A core digest, historical preparation digest or edited HOLD report cannot authorize this path.

## Offline commands

```bash
npm run release:delta:plan
npm run release:delta:plan -- --bindings /absolute/path/reviewed-metadata-bindings.json
npm run release:delta:evidence -- --input /absolute/path/evidence-input.json --output docs/verification/releases/xp-neutrality.json
```

`plan` rechecks all 67 repository sources. With a `DeltaProgramBindings` metadata file it also derives the exact execution program, 62-source reviewed envelope lineage, 17-row baseline, fixed deferred-source object registry and retired-constraint treatment. Its output remains HOLD and performs no source SQL. Absence receipt hashes in a plan are metadata bindings, not independent evidence that the live objects are absent.

The `evidence` input is exactly `{ "context": DeltaExpectedContext, "evidence": Omit<DeltaReleaseEvidence, "contentDigest"> }`. The command rejects incomplete, expired, skipped or mismatched inputs, calculates the outer digest and exclusively creates a UTF-8 artifact under the release JSON area. It checks existing ancestor directories before creating missing directories, refuses symlinks, and never overwrites an existing artifact. Its preparation receipt remains HOLD: it has not authenticated the protected run or current providers.

All new commands use the fixed transformation runner with the Vite version locked to `vite-node`, application config and dotenv disabled, no route generation, no file watching and no listening application server. No command accepts arbitrary SQL, migration ranges, source-SHA overrides, history repair or include-all switches.

## Independent protected policy

`PHASE3_DELTA_POLICY_JSON` is a production environment variable, passed as `RELEASE_DELTA_POLICY_JSON`. It is deliberately outside the bundle and must contain exactly:

```text
schemaVersion: 1
context: the complete independently reviewed DeltaExpectedContext
sourceCiRunId: immutable successful main/push CI run ID
githubApproverId: numeric GitHub user ID
proofAcceptance:
  schemaVersion: 1
  acceptedReportSetHash: exact digest of the bundle's named report set
  acceptedByGitHubActorId: the actual configured and approving user ID
  acceptanceReference: the owner's review/control reference
vercel:
  projectId: independently pinned Vercel project ID
  teamId: independently pinned team ID, when a team is used
```

The `context` includes independent plan/program/source/capability/collector pins, expected before/after roots, exact extension profile, role assignments, recovery reference/tool profile/owner acceptance, maximum ages/lifetime, accepted RPO/RTO limits and required/accepted-uncovered recovery categories. Copying these fields from an unreviewed bundle does not create independent acceptance.

The workflow also needs the existing `SUPABASE_DB_URL` secret and project-reference variable, its read-only `GITHUB_TOKEN`, and a `VERCEL_TOKEN` with read rights for the pinned project's production deployment and alias. Do not place credentials in the policy JSON or evidence. The native database adapter accepts only the exact project direct endpoint or reviewed session pooler on port 5432, with the pinned public CA and `verify-full`.

The actual main branch must be protected. The production environment must restrict deployment to main and configure the individual required reviewer used by the policy. The adapter reads the real configuration and approval history; names and labels do not substitute for policy. Team-only reviewer rules are currently unsupported and HOLD. The read-only inspection on 14 November 2026 found main unprotected, no required-reviewer rule and no deployment-branch policy. Those settings were not changed by this implementation.

## Complete gate reports

Report payloads are addressed as `docs/verification/releases/proofs/<canonical-report-sha256>.json`. The resolver validates the actual payload digest, closed field/check matrix, producer class, source/target/scope/time bindings, exact expected facts, and empty warnings/skips. The independently configured and actually approving reviewer must accept the exact complete report-set digest.

| Gate | Required evidence |
| --- | --- |
| source-integrity | All 67 files, reviewed 62-source lineage, two deferred absences, retired constraint absence |
| target-binding | Project route, CA verification, database/session role identity |
| reviewed-baseline-equivalence | Complete source/reference/restored before roots and source/restored row-data equality |
| empty-rehearsal | Reviewed reference forward delta and complete after root |
| shaped-rehearsal | Restored before root, bounded delta and unchanged catalog/data/ACL receipts |
| identical-replay | Exact archive, 17→18→18 history, function/ledger tuple preservation, complete after root |
| legacy-integration | Ordinary/NULL-mode +10 XP and full legacy submit/review/reward behavior |
| active-mission | Join/accept zero XP, quota/replay, zero backfill/clawback |
| reward-handoff | Preserved reward snapshots, zero reward mutation/publication/pilot enablement |
| provider-auth-role-mfa | Real provider-issued signed sessions, revocation, tenant/role denial, AAL1 denial/AAL2 authorization, HTTP round trips |
| api-database-binding | Current API issuer/authority and exact database project binding |
| storage-api | Actual HTTP tests for anonymous/cross-owner denial and MIME/size policy |
| fresh-recovery | Paired exported snapshot, global recheck, complete archive read, native restore/data equality and owned cleanup |
| production-deployment | Real main CI, Vercel READY production deployment, authenticated alias binding and current API health |
| source-ci | Exact successful main/push CI record with both required jobs |
| schema-change-control | All DDL/global/sequence/application writers and deployments/configuration controlled through postflight; named containment owner |

Hashes authenticate bytes. Historical native/provider rehearsal facts also need the explicit named reviewer's independent acceptance; they are not automatically provider-signed facts. Source CI and current GitHub protection/approval configuration are re-read live. Vercel's authenticated alias/deployment APIs bind the canonical alias, immutable deployment ID, project/team, READY production state and permitted commit. Both current API health routes must report that commit and the backend project reference derived from the same captured URL used by both server clients. The public health metadata contains no keys, URLs, users, schema or data and uses `no-store`.

The implementation authenticates these authorities again after the initial read-only database inspection and before opening the writer transaction. Missing tokens, unknown provider shapes, an alias/code/project mismatch, an unprotected branch or missing reviewer policy HOLD before database write execution.

## Fingerprint and transaction protocol

Seven complete semantic components cover schema export, roles/memberships, database-role settings, storage configuration, extension configuration, extension members and migration history. Full `pg_dump 17.11` output must identify source PostgreSQL 17.6. Canonicalization preserves literal/function bytes and statement multiplicity with effective SET context. It accepts only the reviewed fixed-key psql framing, including the observed two-block `--create` reconnect to the exact `postgres` database.

Semantic roots normalize physical object identities across databases. Same-database transaction invariants preserve physical catalog identities, target OID/xmin/attributes/ACL, the complete old 17-row values and tuple identity, user row values and sequence state. User-data binary records preserve nested OID aliases, JSON text and array lower bounds; unavailable binary send functions HOLD. Unknown, unreadable or unsupported nonempty categories HOLD, including unsupported large objects, custom tablespaces, replication origins, subscriptions, user mappings, foreign data and unrendered configuration types.

The writer acquires the cooperating migration session lock before establishing a repeatable-read snapshot, then begins one RR read-write transaction, binds the approved hashes/deadline, and takes transaction/history locks. A separate RO reader and `pg_dump` import its exported before snapshot. The controller compares the entire approved before state, captures its same-session invariant, runs the fixed DO program, forces all queued constraint triggers immediate, compares the complete invariant again, checks freshness and commits. The fixed flush is included in the execution-program digest and its immediate mode remains in force through commit. The DO checks the server clock immediately before its first DDL; a server-clock guard runs immediately before COMMIT. The source archive's literal BEGIN/COMMIT remains archived text; no nested packet COMMIT executes.

Advisory/history locks and RR do not freeze unrelated DDL, global roles or sequence state. Operational quiescence is mandatory; global/configuration changes during an export cause HOLD. Session and transaction idle deadlines bound abandoned locks. Docker uses an explicitly local daemon, read-only client containers, no capabilities, no privileges escalation, exact mounts/TLS/environment/resource settings and no logs. Credentials enter only anonymous stdin; host children receive a strict environment allowlist. Process/output deadlines settle even without a local child-close acknowledgement. A failed CREATE cannot proceed to START, and declared owned leases are reconciled conservatively during cleanup.

## Recovery and uncertain outcomes

Recovery must include exactly the reviewed `database.dump`, `roles.sql` and `toc.list` artifacts, a real shared exported source snapshot and global-state recheck, actual native restore start/finish times and cleanup. Mandatory database schema, rows, role definitions without verifiers, and storage configuration must be covered. External object bytes, role verifiers, platform encryption keys, WAL/PITR and extension binaries need explicit covered proof or named acceptance of their uncovered status; database restore alone does not prove platform recovery.

`rpoSeconds` is the accepted maximum snapshot-age/loss budget. Actual age is derived from `captureStartedAt` and must fit both that declared budget and the independent policy maximum. `rtoSeconds` must cover the measured restore interval and fit the policy maximum. Old backups and historical AUTH_NOT_TESTED results cannot be refreshed by editing timestamps or labels.

A precommit failure requests ROLLBACK in the same backend and records acknowledgement honestly. An uncertain COMMIT, missing rollback acknowledgement after attempted DDL, unverified post-write invariants, failed postcommit fingerprint or unverified managed-client cleanup produces a HOLD/containment outcome retaining attempted/possibly committed/confirmed flags. Even an acknowledged rollback cannot undo sequence advances or external effects, so a failed post-write invariant retains containment. Local process-close acknowledgement is not proof of database rollback. Keep the receipt, stop retries, and inspect the source read-only before deciding on a new approved attempt. No automatic reverse migration, reset, history erasure or reward mutation runs.

## Protected execution and pilot separation

```bash
npm run release:delta:verify -- --bundle docs/verification/releases/xp-neutrality.json --bundle-digest ACTUAL_OUTER_DIGEST --project-ref mhkoayftiuojxlrkollf
```

The protected `supabase.yml` workflow selects `phase3-combined62-xp-v1` explicitly, serializes both release profiles, checks out full history and invokes `release:delta:execute` with the exact approval and `--apply`. This implementation session does not dispatch it. Only after every independent input and live gate passes can that command attempt the two-function delta and one genuine history insertion.

The disposable native receipts are kernel/export/replay evidence only. Their synthetic checkpoint ledger, fixture superuser and exact extension versions do not prove production-shaped baseline equivalence, provider Auth/MFA, fresh production recovery or release authorization. Their `validReleaseEvidence` remains false. Keep the original partial-profile receipt and the separate exact-six-profile receipt with their own input hashes and limitations.

Pilot selection and later `ENABLE PILOT <workspaceId> <missionId> <actual-digest>` remain a separate inspection and one-row enablement process. This profile creates no mission, chooses no creator/cohort, enables no pilot and publishes or awards nothing.
