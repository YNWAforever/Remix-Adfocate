# Offline current Auth-pilot restore checkpoint

`verify-auth-pilot-restore.ps1` is prepared for the parent to run in the actual Windows host context. It has been statically reviewed only; no PowerShell, Docker, database, source capture or restore execution was performed while preparing it. The wrapper does not apply the approved SQL or run the nine Auth tests.

## Inputs

- `AttemptDirectory`: one explicit **successful new** v3 attempt directly under Windows known-folder LocalApplicationData `KOCmax/PrivateBackups/mhkoayftiuojxlrkollf`. Never select a newest directory automatically or use a failed attempt.
- `SourceFingerprintPath`: the parent's sanitized JSON result in an explicit regular local file outside the attempt directory. Sanitized source metadata may be kept in the repository; it is never mounted into the container or executed. If placed under the private project backup root, its ACL must allow only the current user and SYSTEM. The existing verifier requires the attempt directory to contain exactly the original four files.
- `CheckpointNotBeforeUtc`: the parent's UTC lower bound for this newly authorized checkpoint. The selected capture must have started at or after it.
- `SourceCapturedUtc`: optional exact source-capture UTC timestamp, if the parent has it. The supplied review file currently records an HKT date only, so no precise time is invented or required. The receipt records whether a supplied exact time preceded or followed the backup. Live source stability remains the parent's separate check.
- `TimeoutSeconds`: optional native archive-read / restore timeout, default 1800 seconds. The existing archive verifier owns its timeout and cleanup; the wrapper does not interrupt that verifier's cleanup with an outer timeout.

The source file must contain either the one JSON result row, or a JSON array containing exactly that row, from the unchanged `auth-pilot-fingerprint.sql` run by the parent on the approved source project. The parent's current sanitized envelope is also accepted: `projectRef` and `queryFile`, when present, must match the approved target/query; its date and descriptive limits are not fingerprint values. These five result columns are extracted and compared:

| Field | Required value/type |
| --- | --- |
| `application_data.table_count` | Integer 94 |
| `application_data.row_count` | Actual nonnegative summed application row count |
| `application_data.data_digest` | Actual 32-character lowercase opaque MD5 |
| `migration_count` | Integer 15 |
| `policy_count` | Actual nonnegative public/private policy count |
| `auth_table_count` | Actual positive Auth table count |
| `storage_table_count` | Actual positive Storage table count |

`application_data` may be a JSON object or its JSON string representation. Do not supply the whole MCP transcript, credentials, row values or a hand-constructed expected digest. The digest covers every current column of every public/private ordinary or partitioned table, including table identities and counts. A separate source read is not automatically the same snapshot as the archive; any mismatch fails instead of being waived as expected activity. The source query does not independently attest project identity; the parent owns the source capture and its provenance.

## Host command

Use the installed PowerShell 7 host runtime. The parent may require its already authorized escalated host context to reach the actual private root and local Docker named pipe. Replace all placeholders with verified values; no password is accepted by this wrapper.

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -NoProfile -File 'C:\Users\laich\.codex\worktrees\kocmax-studio\Adfocate\scripts\integrations\verify-auth-pilot-restore.ps1' -AttemptDirectory 'C:\Users\laich\AppData\Local\KOCmax\PrivateBackups\mhkoayftiuojxlrkollf\20261101T073819Z-4e90d939a7a144639faa6a720e0d1f6c' -SourceFingerprintPath 'C:\Users\laich\.codex\worktrees\kocmax-studio\Adfocate\docs\review\kocmax-stage-4d\d1\auth-permission-execution\source-fingerprint.json' -CheckpointNotBeforeUtc '2026-11-01T07:38:19Z'
```

## What runs

1. The unchanged `verify-local-backup.ps1` validates exact target/status, actual private-root containment, ACLs, original manifest and all three artifact hashes, then performs its existing offline complete archive read. Its successful receipt is required before restore.
2. The wrapper checks freshness, hashes the supplied source result, validates its current 94-table/15-migration scope, and records the exact source-query and script hashes. Hash pins reject changed dependencies; source owners can review a deliberate dependency change and update this new wrapper's pins.
3. The installed image is fixed to `public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9`. Docker is fixed to `npipe:////./pipe/dockerDesktopLinuxEngine`. No pull, remote daemon, ports, source credentials, Docker socket mount or network is used. The image entrypoint is replaced, the user is `postgres`, root and backup mounts are read-only, capabilities are dropped, logging is disabled and the database lives under a bounded private `/tmp` tmpfs. Known image-declared PostgreSQL data volumes, if present, are replaced by tmpfs before start; unexpected volumes fail.
4. The unchanged `verify-backup-disposable-restore.sh` runs with its original legacy `/checks.sql`. This preserves its `supabase_admin` OID-10 bootstrap, single redundant CREATE removal in tmpfs, complete native restore, original-owner event-trigger pass and clean shutdown. Both the host and a native TOC read reject `MATERIALIZED VIEW DATA`, because this existing two-pass script cannot preserve the required trailing refresh order for such an archive. No entries are silently excluded.
5. The wrapper restarts the **same restored tmpfs cluster**, with the same Supautils-only session support and no shared preload workers, runs the parent's exact new fingerprint SQL in CSV mode, then stops the cluster. The parent's SQL has five result columns and cannot be substituted into the generic script's single-JSON `/checks.sql` slot unchanged. CSV is parsed privately and compared with the supplied source JSON. The old 39-table/400-column result is not the current comparison.
6. Success requires all declared fingerprint fields to match, restored native metadata to report 80 public tables and 15 migrations, the total application count to be 94 (therefore 14 private), a clean container exit, unchanged input hashes, private output ACLs and confirmed cleanup. Only this run's exact UUID container with its matching ownership label may be removed. No other container, image or volume is pruned.

## Output and limits

The wrapper prints one sanitized JSON receipt and returns exit 0 only for `AUTH_PILOT_CURRENT_RESTORE_VERIFIED`. All other outcomes return exit 1 and `AUTH_PILOT_RESTORE_NOT_VERIFIED`. The receipt binds the explicit attempt's manifest hash, source file hash, source query hash, capture timestamps, any supplied source timestamp/date, image and reviewed script hashes. It reports aggregate counts and comparison/cleanup status, never row values or raw diagnostics. Exact equality to the supplied baseline does not independently prove live source stability after capture.

The receipt and native diagnostics are stored in a new protected `restore-check-<UTC>-<UUID>` sibling directory under the private project root. Raw stdout/stderr and PostgreSQL logs stay there, including when they contain SQL or sensitive values; do not copy that directory into the repository or chat. The container gets write access only to its dedicated private output subdirectory, not to the host receipt or input copies. Failed cleanup reports only the exact owned container name for local follow-up.

This is a complete native restore plus the parent's bounded current-data comparison. Auth/Storage **table counts**, not their row counts or content hashes, are compared. Migration-history and policy **counts** are compared, not their full contents. Owner, ACL and grantor statements are retained during restore, but this fingerprint does not separately prove catalog/privilege equivalence. Storage object bytes, role passwords, hosted services, providers, production Auth behavior and full-platform recovery remain outside the evidence. `migrationAuthorization` remains `NOT_ASSESSED`, and `authTests` remains `NOT_RUN`.

The first host syntax check and actual run are still pending. No successful new capture, source comparison, restore or Auth result should be inferred from the presence of these prepared files.
