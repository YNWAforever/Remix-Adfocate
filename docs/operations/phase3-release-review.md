# Provider and recovery release review

The offline review packet binds the owned provider HTTP observation, the existing native paired-recovery fixture receipt and exact-subject CI metadata to current public source bytes. Every one of the sixteen protected release gates remains `HOLD` and `accepted: false`. The packet is a review aid and is rejected by the existing strict v2 release-evidence parser.

The provider observation must come from the newly owned stack, with all 27 case receipts, actual HTTP counts and confirmed application/namespace cleanup. A structurally valid failed observation produces an incomplete packet with zero accepted provider cases. Unknown cleanup, malformed receipts, changed code bytes or missing fault prerequisites cannot produce a complete engineering packet. The provider runner is documented in [the provider runbook](phase3-provider-rehearsal.md).

The recovery input is the frozen public nine-case receipt under `docs/verification/phase3-paired-recovery`. Its byte hash, canonical digest, nested manifest and observation digests, seven semantic components, portable-data summaries, fault prerequisites, code-input hashes and cleanup are checked. Its source ledger and commit are synthetic and belong to a separate local recovery fixture. They do not establish a restore of the provider stack or production. Private archives, roles files, keys and store paths are not read by this command.

The subject commit M is the commit tested by the provider runner. Complete engineering preparation requires supplied metadata for a successful `CI` workflow on a `push` to `main`, with `build-test`, `integration` and `provider-acceptance` all successful at M. The preparer must authenticate these facts and the downloaded provider artifact against GitHub. The offline command validates the supplied metadata and byte bindings; it does not authenticate a producer or contact GitHub. Green jobs grant no owner acceptance or protected-policy authority.

## Prepare the packet

Commit the sanitized provider observation and source-CI metadata with the review. The CI metadata has exactly these fields: `repository`, `workflow`, `branch`, `runId`, `sourceCommit`, `event`, `url`, `conclusion` and `jobs`. Each job has `name`, `sourceCommit` and `conclusion`. Use the actual main-push run, rather than inferring a main checkout from a pull-request run.

Create the public selection at `docs/verification/phase3-release-review/selection-M.json`, replacing M with the actual 40-character subject commit. Its closed shape is:

```json
{
  "schemaVersion": 1,
  "sourceCommit": "<actual subject M>",
  "provider": { "path": "<owned provider JSON>", "sha256": "<actual byte SHA-256>", "contentDigest": "<canonical payload digest>" },
  "pairedRecovery": { "path": "docs/verification/phase3-paired-recovery/native-20261114-fault-confirmed.json", "sha256": "<actual byte SHA-256>", "contentDigest": "8da85170bf9500b326f5794e0afef6acc7a6ae4f80873869e7e24fa557994d76" },
  "sourceCi": { "path": "docs/verification/phase3-release-review/source-ci-<actual subject M>.json", "sha256": "<actual byte SHA-256>", "contentDigest": "<canonical CI JSON digest>" }
}
```

Byte hashes cover the complete file, including its newline. Provider and recovery content digests cover their canonical payload excluding their own `contentDigest` field. CI metadata has no embedded content digest; its descriptor digest covers the complete canonical CI object. Hashes bind bytes and do not authenticate the author.

Run from this checkout, with M replaced by the same actual commit:

```text
npm run release:delta:review -- --input docs/verification/phase3-release-review/selection-M.json --output docs/verification/phase3-release-review/review-M.json
```

The command reuses the existing manifest validator for the 67-source release plan, checks M is an ancestor of the current checkout, reads only bounded regular public JSON and the fixed 23 public source files, checks canonical parent paths, and writes the new output exclusively. Existing output is never overwritten. The current source bytes must match both producers' recorded inputs. The recovery's synthetic commit is never substituted for M. No database, provider, private recovery store, publication or approval operation is constructed.

## Owner preparation still required

The packet lists observations and missing inputs separately for each of the existing sixteen gates. RPO, RTO, freeze, executor/observer/containment/product/approver roles, report-set acceptance and exact outer approval remain unset. A NULL schema guard does not establish a historical NULL-mode provider join; a seeded issued-history anchor does not establish issuance; a pending reward does not establish settlement; blocked external metadata does not establish publication.

The next protected rehearsal requires fresh approved target/reference/deployment/provider/recovery inputs, independent scope and owner acceptance, and the existing strict v2 evidence, provenance and execution checks. Workspace, mission, creator/cohort, pilot enablement and the seven-day observation remain separately authorized steps. This preparation changes no production SQL, migration history, protection settings, hosted accounts, rewards or pilot flags.
