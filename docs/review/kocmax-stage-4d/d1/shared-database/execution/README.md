# Approved application: execution evidence

The user approved applying the reviewed SQL to existing **Remix-Adfocate**, project `mhkoayftiuojxlrkollf`, on branch `codex/kocmax-studio-stages-1-2`. That approval remains valid. Production deployment, real Instagram/Drive connections, external AI, pilot enablement and persistent browser fixtures remain excluded.

**Latest actual checkpoint — completed:** v3 attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture, full archive read and a disposable local restore. The unchanged approved SQL was applied to Remix-Adfocate as migration `20261031201901` (`kocmax_studio_shared_review_c879b204`); read-only postconditions passed. See the parent [backup verification receipt](backup-verification-receipt.json), [application receipt](application-receipt.json) and [completion report](completion-report.md).

The private archives and capture manifest remain unchanged. Its capture-time `restoreRehearsal: NOT_RUN` and the full-read result `ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED` are historical stage records; the separate backup verification receipt now proves the later disposable restore. Earlier failure history is retained below. No new retry or SQL application is pending.

Advisor findings remain open; see [advisors comparison](advisors-comparison.json). No deployment, real Instagram/Drive connection, external AI, pilot enablement, Auth account creation or persistent browser fixture occurred. Mobile/desktop evidence remains local mock/read-only D0 evidence, including the v3 390/1440 follow-up, not real Auth/JWT tenant acceptance.

## Verified before application

- Project identity rechecked through the existing Supabase account link. Live catalog and extended metadata matched the frozen fingerprints. Four data-consistency/name-conflict checks passed.
- Original data captured only as counts and opaque checksums for the 400 original columns across 39 tables. No customer row values were exported through those queries.
- The exact approved payload remains SHA-256 `c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff`. Original source migrations and release manifest were not rewritten.
- [Committing application artifact](approved-apply.sql): 775,304 UTF-8 bytes; SHA-256 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. It retains the four reviewed guards, surrounds the unchanged payload with one explicit transaction and adds before/after original-column checksum checks.
- Local packet and committing-wrapper rehearsals passed. Independent [execution review](execution-review.md) found no remaining concrete P1/P2 in the SQL wrapper. Schema transaction and migration-history reconciliation are explicitly separate evidence; unknown API ordering is not represented as proven atomic history recording.
- [Mobile/desktop fixture verification](ui-verification.md) completed at mobile 390 / desktop 1440; the existing 31 scoped mocked tests remain unchanged. Application code was not modified by this backup repair. This is not real Auth/shared-database browser acceptance.

## Preserved backup preparation and failure history

Authorized Edge inspection of the [project backups page](https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf/database/backups/scheduled) showed **Free Plan does not include project backups** and no available scheduled backup. [Screenshot](screenshots/backup-unavailable.png). This is the missing recovery evidence identified by the already reviewed [rollback plan](../rollback-plan.md), not a request to approve the same SQL again.

The user chose a free local backup. A capture helper and user launcher were prepared without altering application code. The helper pins the exact project/session pooler and the installed official PostgreSQL 17 image; requires verified TLS, explicit/native read-only transactions for metadata/database extraction, and a catalog-SELECT-only roles export; uses a masked local credential prompt; does not save the connection password; and stores sensitive archives under the user's LocalApplicationData `KOCmax/PrivateBackups/mhkoayftiuojxlrkollf` directory with private NTFS permissions. This destination is outside the Vite-served workspace and visualization roots. The reviewer’s original archive-location finding was corrected before any archive capture.

Two automatically started helpers were closed/failed before credential input and before remote database access. They created no archives. Native desktop-control approval timed out while trying to open the user's visible Run window. No desktop permission denial has been bypassed.

The user's subsequent `20261031T164329Z-774ecfa218524b14b835a279952a7a96` attempt ended at `readonly_metadata` with `TLS_VERIFICATION_FAILED`, status `FAILED_NOT_A_VERIFIED_BACKUP`, and no artifacts. The reported completion was therefore not a successful backup. A credential-free probe reproduced certificate-chain error 19: the pinned image's system trust store lacked the Supabase Root 2021 CA.

The official certificate download link was verified in this project's authorized dashboard. Its 1,367-byte PEM file is pinned at SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7` and mounted read-only only for the helper. `verify-full` remains enabled; there is no OS-wide trust change or TLS bypass. The actual repaired helper's credential-free chain-and-hostname preflight passed, and now runs before password entry. Independent review found no TLS/credential/privacy blocker; its cancellation-classification finding was fixed and checked using stubbed I/O. The launcher now explicitly distinguishes capture completion from failure.

At an earlier checkpoint, a line-442 result and absence of a new attempt suggested a stale pre-repair window. That diagnosis belongs only to that earlier observation. The v2 marker was introduced to distinguish fresh attempts. Historical v2 helper SHA-256 was `99189cd235e06211c6801b6084b42e098a0f0016fdf4c4ae3f07ee8448c6ec56`; historical launcher SHA-256 was `ef4dac6d065c343709ccb5e8baa24f1448999843877302edbeb9a32ed0683d60`. Neither is the current v3 hash; current hashes are recorded in [the native repair evidence](backup-native-readonly-repair.md).

The actual fresh v2 attempts `20261031T192631Z-596b2e80aea64d888d27c040b1e68d73` and `20261031T192949Z-823d8a4d39dc453dbfb56b36a2f3e81b` both failed at `readonly_metadata` with `REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH` and zero artifacts. TLS, password authentication and target identity succeeded. Observed default read-only was off, current transaction read-only on, and row_security on despite requested PGOPTIONS. These are genuine new failures, not stale-window results. The intervening cancelled 19:27:46Z attempt preserved successful TLS and produced no archive.

Parent/Euler review attributes the failure to the session pooler not applying the requested startup settings. Version `3-native-readonly-20261101` establishes the metadata transaction explicitly, relies on pinned pg_dump 17.11 native READ ONLY / row_security off for database extraction, and describes pg_dumpall roles-only as catalog SELECT extraction rather than a server-enforced read-only transaction. PGOPTIONS remain defense in depth, `requested_not_relied_on`. No remote configuration, target, TLS, privacy, ACL, credential handling or full-coverage boundary was changed. See [native read-only repair and evidence](backup-native-readonly-repair.md).

The five network-isolated synthetic proof checks passed with tmpfs and no real data. Separately, the parent executed the new metadata SQL read-only through MCP against the approved project: database/current user/session user postgres, server 170006, default off, current transaction on, row_security off, and zero unreadable relations, missing schema usage, foreign tables or extra tablespaces. This confirms the metadata SQL path, not a fresh capture through the actual session pooler. Raman updated the archive verifier to require v3 and the exact strategy metadata. Those pre-capture checks alone did not prove a real archive or restore; the completed capture/full-read/restore receipt above now supplies that later evidence.

**Completed continuation:** the requested v3 retry succeeded, its archive was fully read and restored in isolation, and the approved SQL was applied. The parent receipts supersede the earlier pending checkpoint without modifying any failed attempt.

Parent reports helper parse + ValidateOnly passed; 12 tests executing the actual metadata-guard AST passed, accepting default off and rejecting transaction off, row_security on, wrong identity/version and incomplete coverage. Raman reports verifier syntax plus 28 synthetic offline checks passed. Euler static review of v3 found no further P1/P2. These are preparation/guard checks, not successful capture.

Parent read-only IAB D0 follow-up: mobile 390×844 / document width 384 and desktop 1440×1000 / document width 1434; Instagram and Drive buttons remained disabled in both. [Mobile screenshot](screenshots/mobile-connections-v3-followup.png), [desktop screenshot](screenshots/desktop-connections-v3-followup.png). No save or fixture write occurred; viewport was reset. This does not establish real Auth/shared-database workflow acceptance.

Historical launch command used for the completed user-local retry; retained for reference, not a request to rerun:

```powershell
& "$env:USERPROFILE/.codex/worktrees/kocmax-studio/Adfocate/scripts/integrations/open-backup.cmd"
```

The user entered the existing database password only in the local masked prompt and selected Backup. No password reset, paid service, provider connection or remote restore was performed. See [backup coverage and limitations](local-backup-guide.md). Inventory/hash checks alone do not establish restore success; the separate receipt now records the completed disposable restore.

## Completed application and remaining findings

The first application request ended with connector confirmation expiry. Before the second request, the parent rechecked that the original schema, all 14 history records and 39 original-table fingerprints were unchanged. The second request succeeded with the exact 775,304-byte approved artifact, SHA-256 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. The original packet and source migrations were untouched.

Postconditions passed: 55 new tables empty; new public-table RLS enabled; two new private asset buckets limited to 20 MiB each; direct private credential/source-write denials preserved. Application schema totals are 94 tables (80 public / 14 private), 987 columns, 86 policies and 192 non-extension functions. The original 39 tables / 400 columns retain exact row counts and opaque content hashes. All 14 original migration records remain plus exactly one named migration `20261031201901` / `kocmax_studio_shared_review_c879b204`.

See [application receipt](application-receipt.json), [application manifest](application-manifest.json) and [original-data after evidence](existing-data-after.json). The 62-file source envelope is not represented as 62 newly pending or separately replayed migration records.

The [completion report](completion-report.md) records the restore method and remaining advisor findings. Nine additional authenticated SECURITY DEFINER warnings have fixed empty search_path and anon EXECUTE false, but Raman is reviewing their authorization guards statically only. There are also 21 added RLS-without-policy INFO findings, increased foreign-key/unused-index findings and one duplicate-index warning. No index was dropped and no all-advisors-clear claim is made.

Actual JWT/tenant isolation and durable shared-database UI acceptance still require approved dedicated identities and a persistent test fixture. The rollback-only fixture cannot serve a separate browser session and must not be changed to COMMIT for convenience.
