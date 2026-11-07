# Local backup before the reviewed shared-database migration

**Latest actual checkpoint — completed:** v3 attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture, full archive read and a disposable local restore. The unchanged approved SQL was applied to Remix-Adfocate as migration `20261031201901` (`kocmax_studio_shared_review_c879b204`); read-only postconditions passed. See the parent [backup verification receipt](backup-verification-receipt.json), [application receipt](application-receipt.json) and [completion report](completion-report.md).

The private archives and capture manifest remain unchanged. Its capture-time `restoreRehearsal: NOT_RUN` and the full-read result `ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED` are historical stage records; the separate backup verification receipt now proves the later disposable restore. Earlier failure history is retained below. No new retry or SQL application is pending.

Prepared 2026-11-01 HKT on `codex/kocmax-studio-stages-1-2`, observed HEAD `5c60020091e8e6fee934b61c498bf7518944c433`. This helper captures a local logical backup only. It does not apply SQL, restore anything, change platform settings, create accounts, reset credentials, deploy, or enable the app/Instagram/Drive. The parent's existing application/migration authorization is unchanged; backup status is a separate prerequisite.

The parent reports the Free plan has no scheduled backup, Docker is ready, and the already installed official image supplies PostgreSQL tools **17.11**. The parent supplied those runtime facts and has since reported the actual failed attempts and isolated proof below. This documentation update does not execute the helper or contact the database. No paid backup service or image download is requested. This still uses local disk and normal source-database/network resources; it is not a promise of zero resource usage.

## Historical failure checkpoint and retained v3 strategy

The actual fresh v2 attempts `20261031T192631Z-596b2e80aea64d888d27c040b1e68d73` and `20261031T192949Z-823d8a4d39dc453dbfb56b36a2f3e81b` both failed at `readonly_metadata` with `REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH` and zero artifacts. TLS, password authentication and target identity succeeded. Observed default read-only was off, current transaction read-only on, and row_security on despite requested PGOPTIONS. These are genuine new failures, not stale-window results. The intervening cancelled 19:27:46Z attempt preserved successful TLS and produced no archive.

The successful capture used helper marker `3-native-readonly-20261101`. Earlier v2 hashes and failed attempts remain historical. [Native read-only repair](backup-native-readonly-repair.md) retains the exact strategy and pre-capture proof; the [backup receipt](backup-verification-receipt.json) now records actual pooler capture, complete read and disposable restore.

## Capture procedure retained for reference

The requested user-local v3 capture has completed. The commands below document the procedure already used; this documentation update requests or launches no repeat password step.

Script: `scripts/integrations/backup-shared-db.ps1`.

```powershell
Set-Location -LiteralPath 'C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate'
pwsh -NoProfile -File ./scripts/integrations/backup-shared-db.ps1 -ValidateOnly
pwsh -NoProfile -File ./scripts/integrations/backup-shared-db.ps1
```

The second command performs local checks and a credential-free TLS chain/hostname preflight, then displays a secure `Read-Host -AsSecureString` prompt only if TLS succeeds. **The user enters the existing database password there, never in chat, a command argument, the repository, an environment file or a saved credential.** Do not reset it. The parent owns opening/attending this visible console and any required local Docker-pipe permission. Run directly as the usual Windows user; no automatic elevation is built in. Do not pipe input, turn on tracing, or run the credential prompt through an assistant tool transcript.

All endpoint parameters have defaults and are checked against this exact allowlist; no credential parameter exists:

If the console is not visible, the parent can launch the same helper's masked Windows Forms dialog:

```powershell
pwsh -NoProfile -STA -WindowStyle Hidden -File 'C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/scripts/integrations/backup-shared-db.ps1' -GuiPrompt
```

The modal shows the exact host/project/user, the new outside-workspace destination and read-only local-backup purpose. Only the user enters the existing credential and selects **Backup** or **Cancel**; closing the dialog also cancels before any authenticated database connection or query. A credential-free TLS handshake has already occurred. The masked textbox is cleared/disposed and its temporary character array cleared after building a read-only SecureString. Windows Forms necessarily holds input in process memory while typing; no plaintext is logged or saved. `-GuiPrompt` bypasses only the redirected-console-input guard; every target, ACL, image, TLS, explicit/native read-only strategy and capture guard still applies. It requires an STA PowerShell process. `-GuiPrompt -ValidateOnly` remains entirely offline and does not display a dialog. Cancellation now records `USER_CANCELLED_NO_AUTHENTICATED_CONNECTION` with the existing failed-attempt status; historical attempts are not rewritten. The previous console mode remains available.

| Setting | Pinned value |
| --- | --- |
| Project | `mhkoayftiuojxlrkollf` |
| `DbHost` | `aws-1-ap-northeast-1.pooler.supabase.com` |
| `DbPort` | `5432` (session pooler) |
| `DbUser` | `postgres.mhkoayftiuojxlrkollf` |
| `Database` | `postgres` |
| `PostgresImage` | `postgres@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232` |
| Docker | Local `npipe:////./pipe/dockerDesktopLinuxEngine`; Linux engine; `--pull=never` |

These are the endpoint and digest supplied by the parent after UI/local inspection. The known direct host `db.mhkoayftiuojxlrkollf.supabase.co` is not an automatic fallback. Different hosts, projects, ports, usernames, database names or image digests are refused. Supabase documents the session pooler as the IPv4 alternative for backup connections. Its general guide suggests credential reset, but **that step is explicitly excluded here**. [Supabase backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

## What the script does

1. Checks target/image, the official public CA file's exact size/hash, branch, paths and separation from the repository and the entire user's `.codex/visualizations` tree, without reading `.env` or other credentials. The CA file and its ancestors must not be reparse points. `-ValidateOnly` stops here without Docker or filesystem writes. The obsolete Git-ignore/tracked-file checks are removed because the destination is outside Git; the branch guard remains.
2. Checks the already installed image on the local Docker Desktop engine. Creates a unique directory under **`%LOCALAPPDATA%\KOCmax\PrivateBackups\mhkoayftiuojxlrkollf\`**, resolved using Windows LocalApplicationData, with protected NTFS ACLs allowing only the current user and SYSTEM. Rejects path reparse points, destinations within either served root, or an existing directory with unsuitable ACLs. It does not relax ACLs or delete previous backups. Parent handles the already authorized execution permission for this outside-workspace write; this preparation does not create that directory.
3. Before prompting, runs the pinned image's OpenSSL with PostgreSQL STARTTLS, exact SNI/hostname, `-verify_return_error` and the pinned CA, bounded to 30 seconds. No database username/password, query, credential stdin wrapper or backup-directory mount is used for this handshake. Requires exit zero plus explicit successful handshake/verification markers. OpenSSL's normal success diagnostics on stderr are handled separately; PostgreSQL tools still fail on warnings/stderr. Failure stops before credential input.
4. Prompts once. Passes the credential through an anonymous stdin pipe; a fixed container shell reads it into `PGPASSWORD` and starts the one tool. The credential is absent from Docker arguments, container configuration, log files and the manifest. Docker logging is disabled. Buffers are cleared/disposed on completion where possible; administrators/debuggers/process memory and crash dumps remain outside that guarantee. No `.pgpass` or credential file is made.
5. PGOPTIONS still request default/current transaction read-only, row_security off and a bounded lock timeout, but are defense in depth only (`requested_not_relied_on`). The metadata SQL explicitly issues `BEGIN READ ONLY`, `SET LOCAL row_security = off`, `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '15s'`, reads catalog metadata, then rolls back. The guard still requires actual transaction_read_only on and row_security off, exact database/current/session identity and PostgreSQL 17. default_read_only is recorded as on/off; it is not required to be on. Required schemas and table/schema privileges are checked. Foreign tables or extra tablespaces stop the attempt because this scope cannot fully capture them. No application row values are printed.
6. Requires the exact reviewed pg_dump **17.11**, then runs **one unfiltered `pg_dump --format=custom`** for the database and separately `pg_dumpall --roles-only --no-role-passwords`. Pinned pg_dump establishes its own READ ONLY transaction and row_security off before extraction; this does not rely on pooler startup settings. The pinned roles-only path reads catalogs with SELECT and does **not** establish a server READ ONLY transaction. Its emitted `SET default_transaction_read_only = off` is local restore-file content, not a command executed on the source. Owners, ACLs, policies and managed schemas are not deliberately excluded. The database dump uses a consistent snapshot; roles and metadata are separate and **not the same snapshot**. Native extension semantics remain. [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html)
7. Disposes the entered credential, then runs `pg_restore --list` with **no network**, checks public/auth/storage table inventory, computes SHA-256 hashes and finalizes the private manifest. This reads archive inventory; it does not restore or validate every compressed data block. [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)

Remote PostgreSQL connections retain `PGSSLMODE=verify-full` and disabled GSS encryption; `PGSSLROOTCERT` now points to **`/tls/supabase-root.crt`**, a read-only bind mount of the exact public certificate. The hash is checked before credentials and again before each TLS/database container. There is no runtime download, system-root fallback or TLS downgrade. The preflight checks TLS only; it does not prove project authentication, SQL privileges or pooler support for read-only options. [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), [OpenSSL s_client verification](https://docs.openssl.org/3.0/man1/openssl-s_client/)

Pinned trust material (public, not a private key): `scripts/integrations/certs/supabase-prod-ca-2021.crt`, **1367 bytes**, file SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`; certificate DER SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. Subject CN: Supabase Root 2021 CA; validity 2021-04-28 through 2031-04-26. File bytes and certificate fingerprint were verified locally during this patch. Parent verified the Download certificate link in the [authorized project's Database Settings](https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf/database/settings) and downloaded the [official CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) using verified HTTPS. The manifest records these provenance URLs, both hashes, the pinned image and the TLS-preflight result/time.

## Status and privacy

Successful capture contains `database.dump`, `roles.sql`, `toc.list` and `manifest.json` in its unique private directory. Only `CAPTURED_INVENTORIED_RESTORE_NOT_TESTED` means the requested capture/inventory stages finished. Neither this status nor `pg_restore --list`/hashes proves recoverability or clears the remaining migration checks.

Parent-reported attempt `20261031T164329Z-774ecfa218524b14b835a279952a7a96` stopped at `readonly_metadata` with `TLS_VERIFICATION_FAILED`, `FAILED_NOT_A_VERIFIED_BACKUP` and no artifacts. It is not a completed backup. The parent reproduced missing Supabase-root trust without credentials. That TLS repair remains effective and the failed history remains unchanged. The later v2 identity/read-only failures and v3 native strategy are separate, as recorded above.

`FAILED_NOT_A_VERIFIED_BACKUP`, `IN_PROGRESS`, a missing manifest, or `.partial` artifacts must not be reported as a completed backup. Permission/RLS failures, missing managed-schema coverage, any native warning, SSL failures, timeout and unconfirmed own-container removal stop the attempt. The helper never retries with exclusions, grants itself privileges, uses `--enable-row-security`, or converts warnings to success. A rejected connection or failure of the actual transaction/row-security guard still stops. PGOPTIONS acceptance is not proof of effective settings; do not remove explicit/native protections or weaken the actual transaction/row-security requirements.

Raw native diagnostics are deliberately held in memory and not printed/saved. The private manifest records a generic failure classification and successful catalog metadata. For managed Auth/Storage permission failures, stop and have the parent review the required coverage/access; an application-only export is not an equivalent fallback. If interrupted, the manifest records the exact active UUID container name. The parent may inspect/remove **only that local container**; never prune unrelated containers/volumes. No backup file cleanup is automatic.

`--no-role-passwords` excludes **Postgres role login passwords**. It does not strip Auth user hashes, sessions, tokens, function literals or secrets stored as application data from a full database archive. Thus the backup is sensitive, even though the connection credential is never saved by the helper. NTFS ACLs are not encryption and do not protect against SYSTEM/admin access or drive theft. Keep the archive at the fixed outside-workspace destination; do not copy it into the repository or visualization roots, upload it, attach it to chat, commit it, or dump its rows/SQL into logs. Share only sanitized status, timestamps, byte counts and hashes.

Reviewer correction: a repository-local ignored backup can still be served by the running Vite development server to someone who knows its URL; Git ignore and a same-user ACL do not prevent that. The helper therefore no longer writes to `.review-tmp/shared-backups`. The parent reports the old failed attempt contains metadata only and no data archives; leave it as historical evidence. No app/Vite configuration is changed and no old files are moved or deleted.

## Coverage and restore boundary

Included only if every capture gate succeeds: database schema/data according to pg_dump semantics, ordinary Auth/Storage database relations, ownership/ACL/policy definitions, large objects where dump privileges permit, and separate role definitions/memberships without login passwords. A managed privilege failure leaves coverage incomplete rather than silently producing a smaller backup. Extension-managed objects follow native pg_dump rules; their extension binaries are not in the archive.

Excluded: **Storage object bytes**, external files/foreign-server data, WAL/PITR history, other databases, tablespace definitions and cluster parameter grants, platform/Auth/provider configuration, deployed functions, provider credentials held outside the database, and encryption root keys. Supabase Storage files and managed-schema customizations have additional migration requirements. The database file alone is not a complete Supabase project recovery package. [Supabase backup/restore requirements](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

The separate disposable full restore has now **PASSED** using `public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9`. Restore is not implemented inside the capture helper, and its immutable capture manifest still records the earlier NOT_RUN stage. The [backup verification receipt](backup-verification-receipt.json) and [completion report](completion-report.md) record the actual later restore, bootstrap/roles adaptation, full TOC coverage and cleanup. The isolation requirements retained below apply to any future separately authorized rehearsal:

- Use a fresh, disposable local container, `--network=none`, **no published ports**, no host networking/Docker socket, local Unix-socket clients only, and no source credential or source connection string.
- Mount only this backup directory **read-only**; keep destination data separate/private. Restore dumps as executable code with no network access: extension hooks, jobs and stored functions can have effects during restoration.
- Review role/bootstrap conflicts, extension availability/versions, managed auth/storage schema prerequisites, ownership/ACLs and encryption-key dependencies first. Stop on unexpected errors; do not mask them with blanket owner/ACL removal or exclusions and then claim equivalent recovery.
- Verify restored schema/data/privileges and exact archive hashes, then report the tested limits. An ordinary PostgreSQL image may lack Supabase extensions/services; even a local Supabase DB image does not by itself verify hosted Auth, Storage object recovery or a full platform restore.

Historical source/offline validation covered PowerShell parsing, ValidateOnly and in-memory target/image/ACL/credential/TLS/argument checks. The five synthetic native checks, 12 actual metadata-guard AST tests and 28 verifier offline checks passed; Euler found no further P1/P2 in the v3 static review. Those checks alone did not prove capture or recovery. The subsequent v3 capture, complete real-archive read and disposable restore are now separately verified in [backup-verification-receipt.json](backup-verification-receipt.json). The approved application also completed with unchanged original data; no additional backup retry or migration application is pending.

Advisor findings remain open; see [advisors comparison](advisors-comparison.json). No deployment, real Instagram/Drive connection, external AI, pilot enablement, Auth account creation or persistent browser fixture occurred. Mobile/desktop evidence remains local mock/read-only D0 evidence, including the v3 390/1440 follow-up, not real Auth/JWT tenant acceptance.
