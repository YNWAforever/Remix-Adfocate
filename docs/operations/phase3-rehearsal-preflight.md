# Offline rehearsal preflight

`release:delta:rehearsal-plan` validates a public owner worksheet and produces a bounded preparation report. It does not connect to a database, query a provider, open a private recovery store, provision credentials or dispatch a workflow. There is no capture or execution mode. All sixteen release gates remain `HOLD` and `accepted: false`, even when every worksheet declaration is present.

This fills the preparation gap before a separately reviewed read-only capture entry point. The current Production Release workflow invokes `execute --apply`; existing protected `verify` requires a completed v2 bundle, independent policy, actual protected-run provenance and all sixteen accepted reports before database inspection. Neither is the bootstrap probe for collecting missing inputs.

## Run the preflight

The committed [worksheet](../verification/phase3-rehearsal-preflight/worksheet-d9d3803c348033a3fc43ed814d8dae3c98d9606a.json) records the known source candidate and the owner-selected GitHub reviewer ID. Skipped owner roles, budgets, recovery acceptance, freeze and plan references remain explicitly null. The four mandatory coverage rows say `verify` because the existing recovery contract requires proof; this is not a claim that proof exists.

```text
npm run release:delta:rehearsal-plan -- --input docs/verification/phase3-rehearsal-preflight/worksheet-d9d3803c348033a3fc43ed814d8dae3c98d9606a.json --output docs/verification/phase3-rehearsal-preflight/plan-d9d3803c348033a3fc43ed814d8dae3c98d9606a-owner-review1.json
```

The committed [engineering check](../verification/phase3-rehearsal-preflight/plan-d9d3803c348033a3fc43ed814d8dae3c98d9606a-engineering-check.json) was produced by running this offline command against the real repository files and Git ancestry. It reports 26 missing decisions and sixteen HOLD gates; a regression check reproduces its canonical bytes. Its `sourceCommit` identifies the declared release-source candidate, not authenticated producer CI or live production observations. The committed worksheet/report preserve the intentionally incomplete historical example; use a new worksheet for a newly selected release-source revision and a new output label for each review.

Only those worksheet/output namespaces are accepted, and their source commit must match. An optional lower-case output label, at most 32 characters, lets successive reviews create new immutable outputs. Existing output is never overwritten. Invalid or unsafe input fails closed. A structurally valid incomplete worksheet produces an explicit HOLD report and a successful preparation-command exit; it grants no live authority.

Before writing, the adapter checks regular bounded canonical files and all ancestor directories, preflights every migration SQL file before the existing 67-source manifest validator, and checks the declared source is an ancestor of the current checkout using a bounded Git command with the explicit [`--no-lazy-fetch`](https://git-scm.com/docs/git#Documentation/git.txt---no-lazy-fetch) option. A missing object in a partial/promisor clone must not trigger a remote fetch. Git versions that do not support the option refuse the preflight. An owned temporary Git/loopback regression verifies zero requests with this guard and actual requests in its unguarded control; it exercises no database or hosted provider. It reads only the fixed manifest/migration paths and the selected public worksheet. JSON values cannot select another file. It uses the fixed transformation runner without application config or dotenv. Ambient protected-policy or credential variables do not participate in this command.

## Worksheet decisions

The top-level shape is closed: `schemaVersion`, `kind`, `projectRef`, `sourceCommit`, `githubReviewerId`, `roles`, `recoveryAcceptedBy`, `budgets`, `recoveryCoverage`, `freeze` and `planReferences`. Every field is present; null means undecided. Extra fields, credential-shaped values, absolute filesystem references, placeholder values and invalid types are rejected with fixed diagnostics.

- `roles` contains `executor`, `observer`, `containmentOwner`, `productOwner` and `approver`. The existing contract does not require five distinct people. Role overlap remains an explicit owner choice. The declared numeric GitHub reviewer ID is separate from the role label `approver`; preflight does not authenticate membership or approval.
- `budgets` contains nonnegative safe-integer `maximumRpoSeconds` and `maximumRtoSeconds`, and positive safe-integer `maximumEvidenceAgeMs`, `maximumEvidenceLifetimeMs` and `maximumProofAgeMs`. There are no production defaults. Fixture timings are not budgets.
- `recoveryCoverage` declares every one of the nine existing categories exactly once. `database-schema`, `database-rows`, `role-definitions-without-passwords` and `storage-configuration` must seek verified proof. Each other category remains undecided, seeks additional proof, or declares `accept-not-covered` with a non-placeholder reference. A declaration or reference is not authenticated report-set acceptance.
- `freeze` records a proposed window, change-control reference and declarations about schema/global state, sequence/application writers and deployment/configuration control. Missing or false control declarations remain incomplete; an expired window blocks preparation. The report does not verify that writers are actually quiesced.
- `planReferences` points to the reviewed capture scope, containment and forward-recovery decisions as metadata references. These are not executable commands, SQL or private store filenames.

The report identifies missing inputs without filling them. `decisionStatus: complete-unverified` means declarations are present, not that they have been accepted or observed. Capture, execution, production equivalence and owner acceptance flags remain false in every case. The existing strict v2 parser rejects this report, including release-envelope relabelling attempts.

## Producer bounds and next stage

Owner budgets do not extend native producer limits. Paired recovery allows at most 600,000 ms each for capture and restore, 64 MiB per archive bound and a capture-context expiry no more than 900,000 ms ahead. Its source observation time is fixed, and reinspection does not renew it. Ordinary runtime fingerprints have a separate 60,000 ms expiry. These values are constraints, not RPO/RTO defaults.

After the owner decisions are separately authorized, the next stage still needs a reviewed fixed read-only source-capture entry point, scoped protected credentials, actual writer/configuration control, fresh source/reference/restored evidence, live provider/deployment observations and all sixteen complete reports. The evidence core is created after its observations. Exact report-set acceptance, independent policy, evidence-only descendant provenance and outer-bundle approval remain later decisions over known bytes.

The existing [protected release runbook](phase3-protected-delta.md), [paired recovery runbook](phase3-paired-recovery.md) and [engineering review runbook](phase3-release-review.md) retain their authority boundaries. This command changes no production SQL/history, GitHub protections, deployment settings, hosted fixtures, pilot flags, publication or rewards.
