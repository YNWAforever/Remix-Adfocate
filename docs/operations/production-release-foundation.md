# Production release foundation operations

This runbook is the ordered handoff for the active-mission, publication-proof,
and reward-handoff release foundation. It is a preparation and evidence guide;
it does not authorize a production migration, application deployment, or pilot
mutation. Use opaque identifiers, disposable fixtures, and an approved change
ticket throughout.

## 1. Authorization boundary

The release owner records the project reference, change ticket, named operator,
rollback owner, and the exact scope before any command is run. A release
approval is a separate authorization from implementation work and must use the
exact phrase:

```text
APPROVE <projectRef> <evidenceDigest>
```

This phrase authorizes the later protected release workflow only when every
read-only gate, manifest check, disposable rehearsal, evidence review, and
expiry check has passed. It does not authorize a pilot or any direct database
write.

## 2. Pinned toolchain installation

Use Node.js 22, the repository lockfile, and the pinned Supabase CLI:

```powershell
node --version
npm.cmd ci
npx.cmd --yes supabase@2.110.0 --version
```

Do not substitute a globally installed CLI or an uncommitted dependency. Keep
the terminal output in the local gate record and redact credentials before
sharing evidence.

## 3. GitHub Actions availability and billing

Check that the repository's GitHub Actions workflow is enabled, the selected
runner is available, and the organization billing or minutes allowance can run
the job. Pull-request CI must remain credential-free: it receives no
production, Vercel, database, service-role, or access-token secrets.

A queued, skipped, blocked, or unexecuted workflow is not release evidence.
Local gates remain mandatory even when CI is healthy, and an unavailable runner
is recorded as an infrastructure limitation rather than a code pass.

## 4. Reward stack integration evidence

Record the focused reward-handoff and active-mission results, including the
neutrality snapshots and the exact migration capabilities observed by the
preflight. Verify that the publication-proof completion state leads only to a
pending handoff: no issuance, ledger credit, payout, withdrawal, or budget
debit is part of this phase. Keep only structural counts, opaque IDs, hashes,
response codes, and ticket references in the evidence bundle.

## 5. Manifest write and check

Generate the committed manifest from the reviewed forward migrations, inspect
the diff, and then run the non-mutating check:

```powershell
npm.cmd run release:manifest:write
git diff -- supabase/release-manifest.json
npm.cmd run release:manifest:check
```

The manifest checksum, ordered dependencies, capabilities, transaction mode,
and replay expectation must match the checkout. Never hand-edit an existing
migration to repair a checksum; add a reviewed forward migration instead.

## 6. Read-only production preflight

Use the service-role client only in the protected operator environment and run
the preflight in read-only mode against the exact project reference. Confirm
the migration history, manifest digest, schema fingerprint, and every expected
capability. Export no rows containing authored content, credentials, JWTs,
signed URLs, or personal data.

```powershell
npm.cmd run release:preflight
```

If the target is unreachable, the history diverges, a capability is absent, or
the fingerprint differs from the approved record, stop and request review.

## 7. Disposable rehearsal targets

Before rehearsal, the operator supplies two explicitly non-production targets:
an empty loopback database and a disposable production-shaped database. Supply
their opaque refs, loopback API URL, database URLs, temporary anonymous key,
temporary service key, approved manifest digest, expected capabilities, and the
production schema fingerprint through `RELEASE_REHEARSAL_EMPTY_TARGET_JSON`,
`RELEASE_REHEARSAL_SHAPED_TARGET_JSON`, `RELEASE_REHEARSAL_PRODUCTION_JSON`,
`RELEASE_MANIFEST_DIGEST`, and `RELEASE_EXPECTED_CAPABILITIES_JSON`. Both
targets must pass the target guard and must differ from the protected project
reference.

The empty target proves a pristine migration path. The shaped target proves
compatibility with the approved production schema without contacting or
mutating production.

## 8. Rehearsal commands and artifacts

After both disposable targets are recorded, run:

```powershell
npm.cmd run release:rehearse
```

The rehearsal must produce a sanitized report containing the manifest digest,
production/empty/shaped schema fingerprints, each command's exit code, and
stdout/stderr hashes. It must cover empty replay, production-shape matching,
migration dry-run/apply, integration, active-mission, reward acceptance, and
postflight checks. A rehearsal report is invalid if either target is not
disposable or if a command output contains credentials.

## 9. Evidence generation and expiry

Generate evidence only from the passing local reports. Include the exact
checkout commit, manifest digest, schema fingerprint, capability statuses,
rehearsal hash, target refs, created-at time, expiry time, recovery reference,
and containment owner. Set a short expiry and reject evidence created in the
future or already expired when it is reviewed.

Review the serialized bundle manually for credentials, personal data, raw
creator content, raw URLs, service keys, and unbounded error text before
attaching it to the change ticket.

## 10. No production execution in this phase

Do not run production execution in this phase. Do not invoke the production
executor with an apply flag, do not run a hosted migration, and do not invoke
pilot enablement while the release foundation is being implemented or while
any required gate is missing.

## 11. Later go-live approval

After a separate reviewer confirms the complete evidence bundle, the protected
workflow may receive the exact approval phrase:

```text
APPROVE <projectRef> <evidenceDigest>
```

The workflow must receive the project reference, evidence digest, approved
commit, manifest digest, expiry, recovery reference, and containment plan as
protected inputs. They must be checked again at execution time; values copied
from an earlier ticket or an untrusted pull request are not authorization.

## 12. Deployment verification

Verify that the deployed commit is the approved commit and that the deployment
state is READY before any pilot inspection. Record the deployment ID, commit,
project reference, manifest digest, and read-only route checks. A preview,
queued deployment, or stale grouped log is not proof of the approved release.

```powershell
npm.cmd run release:verify-deployment
```

## 13. Pilot inspection and enablement

Inspect exactly one workspace/mission pair with the guarded, read-only pilot
inspection command. Confirm the mission is draft, legacy, reward-neutral, and
free of submissions/workflows; confirm the schema and deployment evidence is
still current. Inspection failure is a stop signal.

Only after separate go-live approval, repeat the inspection immediately before
the conditional atomic update. The operator must provide the exact phrase:

```text
ENABLE PILOT <workspaceId> <missionId> <evidenceDigest>
```

The enable command must affect exactly one eligible row and must reject a
submission race. Never substitute a direct table update or a browser/client
credential for the service-role atomic procedure.

## 14. Seven-day observation and exit

Observe the same workspace/mission scope once per stable calendar day for seven
consecutive days. Persist only structural counts, salted creator identity
hashes, opaque workflow hashes, queue/error clusters, and reward-neutrality
snapshots. The exit evaluator must see exactly one completed workflow and one
pending reward, no integrity or tenant-isolation incident, healthy retry
queues, and approved thresholds for every measured metric.

An incomplete, stale, out-of-scope, financially moving, or non-consecutive
observation returns hold or contain. Expansion requires the explicit seven-day
exit decision and reviewer sign-off.

## 15. Containment

On an integrity, tenant, reward-neutrality, queue, or deployment incident:

1. close new entry;
2. freeze risky mutations and the pilot expansion;
3. restore the last compatible application and route boundary;
4. preserve workflow and audit records;
5. compare the legacy submission, creator balances, workspace budget, ledger
   counters, proof history, decisions, notifications, and workflow events.

Do not erase history or compensate by rewriting reward fields. Record the
containment decision, owner, timestamps, opaque IDs, and before/after numeric
digests, then keep the mission on the legacy path until a new review approves
the next action.

## 16. Forbidden commands and data handling

Never reset, roll back, or repair a linked or hosted database as part of this
phase. Never invoke a migration rollback/down command, seed production data,
run the executor in apply mode without the protected approval, or run the pilot
enable command from CI. Use only committed forward migrations and disposable
targets for destructive tests.

Never log or export service keys, JWTs, access tokens, environment values,
emails, account names, creator-authored text, proof URLs, signed URLs, or raw
database errors. Keep evidence to opaque identifiers, hashes, bounded counts,
response codes, timestamps, capability names, and ticket references. Escalate
any accidental exposure immediately and invalidate the affected credential.
