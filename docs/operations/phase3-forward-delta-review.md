# Phase 3 combined-baseline forward delta review

Decision: **HOLD — preparation only.** Production migrations, history repair, mission/cohort creation, pilot enablement, publication and rewards were not executed by this preparation. These artifacts are not `ReleaseEvidence` and contain no release or pilot approval digest.

## Why this path exists

The source migration directory and production ledger deliberately have different shapes. The approved 62-source envelope was applied as one named migration, `20261031201901 / kocmax_studio_shared_review_c879b204`, whose archived SQL SHA256 remains `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. Preserve the 14 older rows, that combined row, the Auth permission-boundary row and the M1 resubmission row: 17 records in total.

Do not replay those 62 raw files, manufacture their ledger entries, repair history, use `--include-all`, or treat object names as proof that raw sources ran. The existing protected executor still uses `supabase db push`; this preparation does not bypass its incompatible-history rejection or change its evidence, expiry, role or fingerprint gates.

The scoped new migration is [active assignment XP neutrality](../../supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql). Its canonical LF SHA256 is `846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2`. It replaces only `private.join_mission(uuid)` and `public.accept_application(uuid)`, keeping active assignment XP neutral and retaining legacy +10 behavior and prior awards. Its application remains a separate production action.

The uninstalled creator-growth and publish-intent groups (`20261103215321`, `20261104134202`) are outside this delta. Their source presence does not authorize applying them.

## Exact baseline and guarded packet

[The read-only catalog query](../../scripts/release/delta-catalog-capture.sql) exports history names/counts/hashes, five surviving FK definitions, their RI-trigger metadata, extension versions and two function body hashes/attributes/permissions. It returns no application/Auth rows, archived statement text or function bodies. The client separately verifies the fixed pooler hostname, TLS CA, project-bound username and credential target; SQL cannot attest a pooler project reference. The offline tool treats those connection fields as operator assertions.

[The fixed preparation producer](../../scripts/release/delta-preparation.ts) checks:

- The exact 17-row historical baseline and approved combined-packet provenance.
- All repository migration integrity pins, the closed 67-source reviewed manifest and the selected 62-source envelope.
- Canonical predecessor bodies: join `c6e2dbf25154897e2aa80cf2366de5c7134e1dae54b61ba77f246bc24197795b`; accept `b4504940a4e0579f0ce2f4fb7e349a7abb6fd2333a722d5f15f62a78ac055829`.
- Owner, definer/search-path/language/return/volatility/strictness attributes and explicit PUBLIC plus effective anon/authenticated/service-role EXECUTE boundaries.
- The current PG 17.6/extension profile, a catalog capture at most one hour old, validated FKs and the exact four distinct parent/child RI operations for each composite workspace FK.

The creator/workspace equality constraint was intentionally removed by [the relationship migration](../../supabase/migrations/20260720193637_resolve_mission_submission_relationships.sql), after its earlier addition. It must remain removed. The actual surviving invariant is submission workspace = mission workspace, and workflow workspace = submission workspace, with a creator identity FK. This does not universally require a creator's home workspace to equal the campaign workspace. RLS is not asserted as an equivalent replacement.

[The SQL packet builder](../../scripts/release/delta-packet.ts) accepts only the exact reviewed XP source. Its bounded transaction takes serialization locks, checks postgres database/current/session identities, compares every baseline row and checks the exact predecessor state before executing the two replacements and three ACL statements. It rechecks function state and inserts one new ledger row, archiving the complete canonical LF migration source as one array entry. It then rechecks history and function state again. An existing exact delta returns without DDL only after its archive and postconditions match; any drift fails and rolls back.

The producer has no database client, network path, approval phrase or apply mode. It creates a new review directory with `guarded-delta.sql` and `preparation.json`; it refuses overwrite and real-path outputs inside the migration directory. Ordinary module import does not invoke its CLI. Use `vite-node --script` for an intentional invocation:

```powershell
npx vite-node --script scripts/release/delta-preparation.ts `
  --catalog <fresh-sanitized-catalog.json> `
  --output <new-review-directory>
```

The [frozen reviewed packet](../verification/phase3-delta-proposals/20261113-xp-neutrality/guarded-delta.sql) and [preparation metadata](../verification/phase3-delta-proposals/20261113-xp-neutrality/preparation.json) bind packet byte SHA256 `e7ce6a847f57d05d9efde376a2a774e9f6b7310b3cb362fd979936a4891be9da` and baseline history digest `8f73e44618f9af60644527e44e0a78e735d7d23fe1b9fc6fc64ee3e4dc339467`. Neither is a release approval digest. A change in baseline, source or packet requires renewed review; refreshing timestamps is not a substitute.

## Fresh recovery checkpoint

[The fixed read-only capture helper](../../scripts/integrations/backup-shared-db.ps1) now has explicit `SharedDatabaseReview` and `Phase3Preparation` profiles. Original defaults retain their old branch/image restrictions. Phase 3 pins its branch, PG 17.11 client image and a separate cached image solely for credential-free OpenSSL preflight. The first attempted capture stopped before credential access because the database image had no OpenSSL executable. The corrected preflight verified TLS 1.3, the hostname and the original pinned CA; certificate verification was not relaxed. Public CA and byte-pinned restore scripts/queries have explicit LF attributes.

The successful private attempt is `20261113T092852Z-b107cffbb4164728872591a1b3a73a77`, captured from `09:28:52Z` to `09:31:04Z` on 2026-11-13. Database dump, password-free roles and TOC remain under the existing private ACL root outside the repository. No backup contents were copied into these artifacts. Manifest SHA256 is `62f6432485ef9327a61559ce931fdeb1b27c8812c78d2a1b2cd415f7098c909f`; [the sanitized capture reference](../verification/2026-11-13-phase3-delta-backup.json) publishes all three artifact sizes/checksums and the capture tool/TLS/read-only facts.

[The archive verifier](../../scripts/integrations/verify-local-backup.ps1) read the whole unfiltered custom archive offline and checked exact artifact hashes/ACLs before and after. [The disposable restore wrapper](../../scripts/integrations/verify-auth-pilot-restore.ps1) then restored every TOC entry, including managed event triggers under their original owners, using a cached pinned PG 17.6 image. The sole omitted role command in a temporary copy was the redundant `CREATE ROLE supabase_admin` already performed by `initdb`; original ALTER, membership, grantor, ownership and ACL commands remained. Source files stayed read-only.

The actual restore completed at `2026-11-13T09:58:47Z`. [The sanitized recovery receipt](../verification/2026-11-13-phase3-delta-restore.json) records:

| Check | Observed result |
| --- | --- |
| Full archive read / native restore | Passed / executed |
| Public / private application tables | 90 / 14 |
| Application rows | 487 |
| Application data digest | `166cc70a859361c9984249a71aefa426` |
| Migration rows | 17 |
| Policies / Auth tables / Storage tables | 90 / 27 / 10 |
| Managed event triggers | 7 |
| Input hashes after restore | Unchanged |
| Network / published ports / source credentials | None / none / none |
| Owned disposable container cleanup | Confirmed |

[The source fingerprint](../verification/2026-11-13-phase3-delta-source-fingerprint.json) was sampled after capture, at `09:42:56.865Z`, and all five declared fields matched the restored copy. [The separate table-count query](../verification/2026-11-13-phase3-delta-table-counts.json) confirmed the 90/14 split with the same `pg_class` relation kinds used by the restore checker. [The catalog snapshot](../verification/2026-11-13-phase3-delta-catalog.snapshot.json) contains the current two predecessor bodies' hashes and actual PUBLIC/role/attribute/RI metadata.

These are separately sampled snapshots, not a synchronized exported snapshot. MD5 is used only for opaque consistency comparison. Auth/Storage table counts were compared; their row contents, hosted behavior, object bytes, role passwords, platform encryption keys and external provider recovery were not independently validated. The original receipt retains these limitations.

## Disposable delta and replay verification

The preparation-specific optional mode accepts only the frozen packet, runs it solely in the owned restored database and repeats the same packet. Its required result is 17 → 18 → 18 ledger rows, full source archival, unchanged prior ledger rows, unchanged application data, unchanged other catalog/bucket state, and unchanged function/history tuple versions on replay. All source backup inputs remain read-only and hash-stable. A seventh read-only packet mount is permitted only in this mode; the default six-mount restore path remains intact.

The actual native run completed at `2026-11-13T10:40:22Z`; [its sanitized delta/replay receipt](../verification/2026-11-13-phase3-delta-rehearsal.json) reports `PHASE3_DISPOSABLE_DELTA_REPLAY_VERIFIED_AUTH_NOT_TESTED`:

- Ledger rows were exactly **17 → 18 → 18**; the old 17 rows, including their tuple versions, remained unchanged.
- Both target function bodies changed on the first application. Their OIDs remained stable, and body/tuple versions were unchanged on replay, proving the second invocation performed no DDL or receipt write.
- Full target-function owner/ACL/grantor/grant-option/configuration/ordinary-attribute digests matched before, after and on replay.
- The 104-table/487-row application fingerprint, declared policy/Auth/Storage counts, scoped other-catalog digest and local Storage bucket metadata digest remained unchanged.
- All source input hashes remained unchanged; owned container cleanup was confirmed. Network, published ports and source credentials were absent.

The scoped catalog digest covers the relations/columns/defaults/constraints/indexes/policies/triggers and other function definitions/attributes/ACLs/configuration in public/private/auth/storage, plus schema/default ACLs, role attributes/memberships and event-trigger metadata. It excludes physical statistics and is not asserted as a universal source-catalog or hosted-platform equivalence proof.

For an intentional local rerun, use the reviewed PowerShell 7 runtime and the existing private backup attempt. The wrapper reads the complete archive again and creates a new owned disposable cluster:

```powershell
$phase3Pwsh = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
$phase3Attempt = Join-Path $env:LOCALAPPDATA 'KOCmax\PrivateBackups\mhkoayftiuojxlrkollf\20261113T092852Z-b107cffbb4164728872591a1b3a73a77'
$phase3Package = (Resolve-Path -LiteralPath 'docs/verification/phase3-delta-proposals/20261113-xp-neutrality').Path
$phase3Fingerprint = (Resolve-Path -LiteralPath 'docs/verification/2026-11-13-phase3-delta-source-fingerprint.json').Path
& $phase3Pwsh -NoProfile -File scripts/integrations/verify-auth-pilot-restore.ps1 `
  -Profile Phase3Preparation `
  -AttemptDirectory $phase3Attempt `
  -SourceFingerprintPath $phase3Fingerprint `
  -CheckpointNotBeforeUtc '2026-11-13T09:28:00Z' `
  -SourceCapturedUtc '2026-11-13T09:42:56.865Z' `
  -DeltaPreparationDirectory $phase3Package
```

These historical times identify this checkpoint; a new live release requires new fresh evidence. This local result does not grant production authorization or imply hosted Auth/pilot acceptance.

## Remaining release and pilot inputs

The technical packet and local proofs do not constitute a production release bundle. Before a live action, review a baseline-compatible production execution path with valid fresh evidence and the existing approval, identity, containment and complete schema/ACL/policy/storage gates. The stock raw-source executor remains unchanged. Do not offer the preparation report to it as `ReleaseEvidence`.

The one-slot offline pilot proposal still has no created mission or selected creator. Its zero-point/zero-cash legacy draft is valid for authoring; publication requires positive points or cash. The proposed one-point alternative, operator/MFA identities, creator/cohort, exact content/deadline and publication choice require owner input. Release authorization and subsequent atomic pilot enablement are distinct. Pilot enablement does not publish. No authorization is inferred from the earlier unreplaced `<evidenceDigest>` placeholder.
