# Native read-only backup repair — v3

2026-11-01 HKT. Existing Remix-Adfocate `mhkoayftiuojxlrkollf`; existing branch and approved application scope retained. This document records parent-supplied execution/review evidence and the locally inspected helper/verifier contract. This documentation-only update runs no code, SQL, remote request or UI action and changes no immutable packet.

**Latest actual checkpoint — completed:** v3 attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture, full archive read and a disposable local restore. The unchanged approved SQL was applied to Remix-Adfocate as migration `20261031201901` (`kocmax_studio_shared_review_c879b204`); read-only postconditions passed. See the parent [backup verification receipt](backup-verification-receipt.json), [application receipt](application-receipt.json) and [completion report](completion-report.md).

The private archives and capture manifest remain unchanged. Its capture-time `restoreRehearsal: NOT_RUN` and the full-read result `ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED` are historical stage records; the separate backup verification receipt now proves the later disposable restore. Earlier failure history is retained below. No new retry or SQL application is pending.

Advisor findings remain open; see [advisors comparison](advisors-comparison.json). No deployment, real Instagram/Drive connection, external AI, pilot enablement, Auth account creation or persistent browser fixture occurred. Mobile/desktop evidence remains local mock/read-only D0 evidence, including the v3 390/1440 follow-up, not real Auth/JWT tenant acceptance.

## Preserved failure sequence and eventual success

| Attempt | Observed result |
|---|---|
| `20261031T164329Z-774ecfa218524b14b835a279952a7a96` | Historical TLS_VERIFICATION_FAILED at readonly_metadata; zero artifacts. The pinned official CA repair addressed this failure. |
| Earlier line-442 / no-new-attempt checkpoint | Stale/pre-repair-window explanation belonged to that checkpoint only; v2 marker introduced to distinguish later runs. |
| `20261031T192631Z-596b2e80aea64d888d27c040b1e68d73` | Genuine v2 readonly_metadata failure: REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH; zero artifacts. |
| Cancelled `20261031T192746Z` attempt (timestamp supplied; no suffix invented) | Successful TLS result preserved; cancellation produced no archive. |
| `20261031T192949Z-823d8a4d39dc453dbfb56b36a2f3e81b` | Genuine v2 readonly_metadata failure: REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH; zero artifacts. |

The later v3 attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture and full read; the separately recorded disposable restore passed. Prior failure rows above are unchanged.

Both new v2 failures passed TLS, password authentication and identity. Their effective settings were default_read_only off, transaction_read_only on and row_security on despite PGOPTIONS. Parent/Euler root-cause review agrees that the session pooler did not apply the requested startup settings. These are not stale-window failures, bad passwords or a recurrence of the earlier missing-CA problem.

## Explicit v3 contract

The helper marker is `3-native-readonly-20261101`. The manifest readOnlyStrategy is exact:

| Field | Value | Meaning |
|---|---|---|
| metadata | `explicit_read_only_transaction` | BEGIN READ ONLY; SET LOCAL row_security off, lock_timeout 5s, statement_timeout 15s; catalog SELECT; ROLLBACK. |
| databaseDump | `pg_dump_17_11_native_read_only_transaction` | Exact pinned pg_dump 17.11 establishes its own READ ONLY transaction and row_security off before extraction. |
| rolesDump | `pg_dumpall_17_11_catalog_select_only` | Exact pinned roles-only/no-role-passwords extraction reads catalogs; it does not establish a server READ ONLY transaction. |
| startupOptions | `requested_not_relied_on` | PGOPTIONS retained as defense in depth, not evidence that the pooler applied them. |

The metadata guard still requires the actual transaction to be read-only and row_security off. It also checks the same database/current/session identity, PostgreSQL 17 and complete required catalog coverage. default_read_only is recorded as on or off rather than required on. Turning row_security off does not grant a privilege bypass: a dump that would be filtered must fail rather than silently omit rows.

The roles exporter is accurately described as read-only in its catalog extraction effects, not server transaction enforcement. Its emitted `SET default_transaction_read_only = off` belongs to the local roles restore file and is not executed against the source. Do not execute that file as part of capture or offline archive verification. Connection setup settings do not make this a remote database configuration change.

TLS verify-full and the pinned CA, exact target/image/version, private outside-workspace destination, NTFS ACLs, secure credential prompt/pipe/disposal, no-role-passwords, full unfiltered database coverage, no provider activity and no remote configuration change remain fixed. No source permission/coverage or actual-transaction guard was relaxed. A metadata result cannot prove that the later pg_dump/pg_dumpall connections will succeed through the pooler.

## Evidence and limits

Parent reports `scripts/integrations/verify-backup-native-readonly.sh` passed five checks with network none, tmpfs and no real data:

1. Explicit metadata transaction remains READ ONLY even when the session default is off.
2. An attempted synthetic UPDATE is rejected; original synthetic rows remain unchanged.
3. Native pg_dump issues READ ONLY and row_security off before extraction.
4. Native roles-only export follows the catalog SELECT extraction path.
5. The complete synthetic custom archive is read offline without a restore.

The parent also executed the new metadata SQL read-only via MCP against the approved project. Observed database, current user and session user were all postgres; server_version_num 170006; default_read_only off; transaction_read_only on; row_security off. Unreadable relations, missing schema usage, foreign tables and extra tablespaces were each zero. No real row values were copied. This is actual metadata-path evidence, **not** proof of the new helper through the actual session pooler and **not** successful archive capture.

Parent reports helper parse + ValidateOnly passed; 12 tests executing the actual metadata-guard AST passed, accepting default off and rejecting transaction off, row_security on, wrong identity/version and incomplete coverage. Raman reports verifier syntax plus 28 synthetic offline checks passed. Euler static review of v3 found no further P1/P2. These are preparation/guard checks, not successful capture.

Parent read-only IAB D0 follow-up: mobile 390×844 / document width 384 and desktop 1440×1000 / document width 1434; Instagram and Drive buttons remained disabled in both. [Mobile screenshot](screenshots/mobile-connections-v3-followup.png), [desktop screenshot](screenshots/desktop-connections-v3-followup.png). No save or fixture write occurred; viewport was reset. This does not establish real Auth/shared-database workflow acceptance.

## Current provenance

Parent-supplied SHA-256 values for the reviewed v3 files:

| File | SHA-256 |
|---|---|
| scripts/integrations/backup-shared-db.ps1 | `07cc5d1571b0f70c7d3269406b0d460818e30d1e5a35bb33e2d327f344548f75` |
| scripts/integrations/open-backup.cmd | `f0e0c5b6b96798c492f3881ce2228e9b3a3a785189f573c0252723635cdc4186` |
| scripts/integrations/verify-local-backup.ps1 | `203ed187f0e8966e987d5f6e9b0ce4d670c7425e5b09c7997857c5f48ced847c` |
| scripts/integrations/verify-backup-native-readonly.sh | `0900e018d1980f70abc756d7f79b9890914fd882761d2a7e13f7e6f67fc9232e` |

The approved application artifact remains 775,304 bytes, SHA-256 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. Earlier v2 helper/launcher hashes remain historical in README and are not current v3 provenance.

## Source basis and completed continuation

Parent-reviewed upstream sources: [pinned PostgreSQL REL_17_11 pg_dump.c, lines 1238–1276](https://github.com/postgres/postgres/blob/REL_17_11/src/bin/pg_dump/pg_dump.c#L1238-L1276), [raw pg_dump.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_11/src/bin/pg_dump/pg_dump.c), and [pinned pg_dumpall.c roles-only/output paths](https://github.com/postgres/postgres/blob/REL_17_11/src/bin/pg_dump/pg_dumpall.c). PostgreSQL 17 documentation describes [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [transaction settings](https://www.postgresql.org/docs/17/runtime-config-client.html) and [offline pg_restore script output](https://www.postgresql.org/docs/17/app-pgrestore.html). These supplied references were not fetched during this documentation-only change.

The requested v3 retry, offline full-archive read, disposable restore and approved SQL application are complete. The parent receipts, not a closed window or a historical manifest field, establish those outcomes. The capture manifest remains immutable and still records restore NOT_RUN at its capture stage; the separate restore receipt supersedes that checkpoint. No further retry/application is requested here. Storage object bytes and hosted-platform recovery remain outside the logical archive.

## Completed disposable restore

The disposable restore recovered all archive entries and matched exact row counts and opaque hashes across the source 39 public tables / 400 original columns. Restored metadata: 39 public tables, 27 auth tables, 8 storage tables, 54 public policies, 7 event triggers and 14 migration-history rows. Auth/Storage and other schemas restored without native errors but were not independently row-hashed.

Source bootstrap identity `supabase_admin` at OID 10 was required: a different bootstrap identity failed the auth grantor semantics. Only the redundant `CREATE ROLE supabase_admin` was omitted from a local tmpfs roles copy; every ALTER, GRANT and original grantor was retained. Source Supautils session preload and privileged role `supabase_privileged_role` were supplied only in the disposable environment.

Native base restore covered all entries except event triggers, then all 7 event-trigger entries were restored under their original owners via session authorization. The two TOC selections formed an exact union, every entry once. This archive had no MATERIALIZED VIEW DATA entries, making this ordering valid for this archive; it is not a universal ordering shortcut. All restore containers had network none, no published ports, tmpfs storage and no source credentials, and were destroyed. The source backup mount stayed read-only.

## Applied database checkpoint

The first application request ended with connector confirmation expiry. Before the second request, the parent rechecked that the original schema, all 14 history records and 39 original-table fingerprints were unchanged. The second request succeeded with the exact 775,304-byte approved artifact, SHA-256 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. The original packet and source migrations were untouched.

Postconditions passed: 55 new tables empty; new public-table RLS enabled; two new private asset buckets limited to 20 MiB each; direct private credential/source-write denials preserved. Application schema totals are 94 tables (80 public / 14 private), 987 columns, 86 policies and 192 non-extension functions. The original 39 tables / 400 columns retain exact row counts and opaque content hashes. All 14 original migration records remain plus exactly one named migration `20261031201901` / `kocmax_studio_shared_review_c879b204`.

See [application receipt](application-receipt.json), [application manifest](application-manifest.json) and [original-data after evidence](existing-data-after.json). The 62-file source envelope is not represented as 62 newly pending or separately replayed migration records.

Advisor warnings remain recorded in [the comparison](advisors-comparison.json); [completion-report.md](completion-report.md) lists the exact deltas. Raman is reviewing the nine authenticated RPC guards statically only. No index/constraint removal or runtime acceptance is inferred.
