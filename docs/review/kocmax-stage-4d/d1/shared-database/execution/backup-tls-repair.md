# Backup verification and local TLS repair

**Latest actual checkpoint — completed:** v3 attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture, full archive read and a disposable local restore. The unchanged approved SQL was applied to Remix-Adfocate as migration `20261031201901` (`kocmax_studio_shared_review_c879b204`); read-only postconditions passed. See the parent [backup verification receipt](backup-verification-receipt.json), [application receipt](application-receipt.json) and [completion report](completion-report.md).

The private archives and capture manifest remain unchanged. Its capture-time `restoreRehearsal: NOT_RUN` and the full-read result `ARCHIVE_FULL_READ_OK_RESTORE_NOT_TESTED` are historical stage records; the separate backup verification receipt now proves the later disposable restore. Earlier failure history is retained below. No new retry or SQL application is pending.

Date: 2026-11-01 HKT. Target: existing Remix-Adfocate `mhkoayftiuojxlrkollf`. Branch and application HEAD remain `codex/kocmax-studio-stages-1-2` / `5c60020091e8e6fee934b61c498bf7518944c433`.

## Preserved pre-capture failures

Historical attempt `20261031T164329Z-774ecfa218524b14b835a279952a7a96` failed at `readonly_metadata` / `TLS_VERIFICATION_FAILED`, status `FAILED_NOT_A_VERIFIED_BACKUP`, with zero artifacts. Earlier cancellation also produced no archive. The official pinned-CA repair below resolved the reproduced trust problem; this history is retained.

At an intermediate checkpoint, the reported line 442, old manifest hash and absence of a new attempt supported a stale/pre-repair-window diagnosis. The v2 launcher/prompt marker was introduced then. This explanation does not apply to the later actual new attempts.

The actual fresh v2 attempts `20261031T192631Z-596b2e80aea64d888d27c040b1e68d73` and `20261031T192949Z-823d8a4d39dc453dbfb56b36a2f3e81b` both failed at `readonly_metadata` with `REMOTE_IDENTITY_VERSION_OR_READONLY_MISMATCH` and zero artifacts. TLS, password authentication and target identity succeeded. Observed default read-only was off, current transaction read-only on, and row_security on despite requested PGOPTIONS. These are genuine new failures, not stale-window results. The intervening cancelled 19:27:46Z attempt preserved successful TLS and produced no archive.

Parent/Euler review attributes the failure to the session pooler not applying the requested startup settings. Version `3-native-readonly-20261101` establishes the metadata transaction explicitly, relies on pinned pg_dump 17.11 native READ ONLY / row_security off for database extraction, and describes pg_dumpall roles-only as catalog SELECT extraction rather than a server-enforced read-only transaction. PGOPTIONS remain defense in depth, `requested_not_relied_on`. No remote configuration, target, TLS, privacy, ACL, credential handling or full-coverage boundary was changed. See [native read-only repair](backup-native-readonly-repair.md) for current v3 hashes, strategy and proof.

The formerly pending v3 retry subsequently passed capture and full read; the disposable restore and approved migration also completed. The separate receipts at the top supersede that pending status. Earlier failed manifests remain unchanged.

## Historical TLS root cause and retained fix

- The exact pooler from the project Connect dialog is `aws-1-ap-northeast-1.pooler.supabase.com:5432`, user `postgres.mhkoayftiuojxlrkollf`, database `postgres`.
- A credential-free `openssl s_client` probe inside the pinned PostgreSQL 17 image reproduced error 19: `self-signed certificate in certificate chain`. The presented chain ends in Supabase Root 2021 CA, absent from that image's system roots.
- The authorized [project database settings](https://supabase.com/dashboard/project/mhkoayftiuojxlrkollf/database/settings) visibly linked the [official public certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). It was downloaded over verified HTTPS. This follows [Supabase's SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
- PEM size: 1,367 bytes; SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
- X.509 SHA-256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`; subject/issuer Supabase Root 2021 CA; valid 2021-04-28 through 2031-04-26; self-signature checked.
- The helper validates the pinned bytes and path before credentials and each remote tool call, mounts this public file read-only, and uses `PGSSLMODE=verify-full` with the exact CA path. No OS trust-store edit, insecure fallback, password reset, or database configuration change was made.
- A credential-free chain/hostname preflight now precedes the local password prompt. Only OpenSSL's expected success diagnostics on stderr are accepted in this separate path; pg_dump/psql error handling remains unchanged.
- The launcher now clearly prints capture complete or backup failed. Capture completion still does not claim a tested restore.

## Checks actually performed

1. Exact host with system roots: reproduced failure without authentication.
2. Exact host with official CA, hostname verification and verification errors fatal: exit 0, TLS 1.3, `Verification: OK`.
3. Actual repaired helper TLS path, including `-no-CApath`, `-no-CAstore`, pinned image and container cleanup: passed without credentials, query, or backup mount.
4. PowerShell syntax and ValidateOnly: passed. Independent review found no TLS, credential or privacy blocker.
5. Review found that cancelling the prompt could overwrite a previously successful TLS result. Phase now advances to `awaiting_secure_credential_input` before the prompt. Executing the actual outer try/catch with stubbed I/O confirmed cancellation retains verified TLS and prevents authenticated database access. An initial test assertion used the obsolete cancellation-code name; correcting that assertion to the current `USER_CANCELLED_NO_AUTHENTICATED_CONNECTION` passed. No real GUI or database was exercised by this check.
6. The parent executed the new metadata SQL read-only through MCP against the approved project: database/current user/session user postgres, server_version_num 170006, default_read_only off, transaction_read_only on, row_security off; unreadable relations, missing schema usage, foreign tables and extra tablespaces all zero. This confirms that explicit transaction SQL and catalog privileges work on that path, not successful pooler pg_dump capture.

9. The native synthetic proof passed five checks in network-none/tmpfs with no real data: explicit metadata READ ONLY; synthetic UPDATE rejected with original rows unchanged; pg_dump native READ ONLY / row_security off; roles catalog SELECT extraction; complete synthetic custom-archive read.
10. Parent reports helper parse + ValidateOnly passed; 12 tests executing the actual metadata-guard AST passed, accepting default off and rejecting transaction off, row_security on, wrong identity/version and incomplete coverage. Raman reports verifier syntax plus 28 synthetic offline checks passed. Euler static review of v3 found no further P1/P2. These are preparation/guard checks, not successful capture.

No archive, password, user row or Auth secret is copied into this review directory. Successful private capture/full-read/restore and SQL application are recorded in the parent receipts, while the TLS and v2 failures remain historical. The source archive/manifest was not rewritten. Advisor findings remain open; see [advisors comparison](advisors-comparison.json). No deployment, real Instagram/Drive connection, external AI, pilot enablement, Auth account creation or persistent browser fixture occurred. Mobile/desktop evidence remains local mock/read-only D0 evidence, including the v3 390/1440 follow-up, not real Auth/JWT tenant acceptance.
