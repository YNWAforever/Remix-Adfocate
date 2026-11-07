# Independent execution review

Status, 2026-11-01: **the earlier P2 transaction-ownership finding is withdrawn as a blocking defect against the approved plan. No concrete P1/P2 remains from this bounded static review.** The previous review imposed atomic schema-plus-history recording as an acceptance requirement that the approved plan did not impose. This correction changes the review conclusion, not the SQL artifact or the user's authorization.

The approved plan is one transaction for the complete reviewed schema payload, with the tool's one new migration-history record checked and reconciled separately. The latest user approval authorizes the apply to existing project `mhkoayftiuojxlrkollf` on `codex/kocmax-studio-stages-1-2`, followed by mobile/desktop verification. No renewed permission is required for that approved scope. Deployment and real provider connections remain excluded. Parent owns target identity, backup/recovery evidence, live preflight, execution, and UI verification. This reviewer made no remote calls, accessed no credentials, and executed no SQL or project scripts.

## Reviewed artifact and preserved scope

- HEAD recorded by the application manifest: `5c60020091e8e6fee934b61c498bf7518944c433`.
- Apply artifact: `execution/approved-apply.sql`, 775304 bytes.
- Apply artifact SHA-256: `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`.
- Reviewed payload SHA-256: `c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff`.
- Migration name from the actual application manifest: `kocmax_studio_shared_review_c879b204`.
- Review-reference interlock: `c817e8f0-3cf0-461c-9c57-5e0715d5bfc8`.

The artifact and payload hashes were rechecked locally in this follow-up and still match. The previous static comparison established that all four original guards and the complete payload are unchanged. Identical before/after checksum projections cover the 400 original columns in all 39 captured application tables. The artifact contains no direct migration-history DML. It includes the baseline apply_mission repair, 62 source derivations, 55 new-table ACL normalizations, existing-table ACL patch, portfolio compatibility overlay, and final postconditions. It contains no fixture transaction or invocation of rollout, reward settlement, pilot enablement, or provider operations.

## Official contract investigation and its limits

This follow-up was explicitly offline: no web fetch, tool call to a remote service, CLI invocation, database connection, or credential inspection was made.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Parent-supplied inspection of official `api-platform.ts` at `ed5084d` | The adapter forwards the migration request to `POST /v1/projects/{ref}/database/migrations`. | Backend transaction implementation or ordering of its history write. This exact source was not locally available for independent rereading. |
| Parent-supplied review of [Apply a migration](https://supabase.com/docs/reference/api/v1-apply-a-migration) | The cited endpoint contract does not promise schema/history transaction atomicity. | A guarantee either that the backend owns a surrounding transaction or that it records history before/after the supplied SQL. The page was not fetched again under the no-remote-calls constraint. |
| Installed official `node_modules/supabase/package.json`, version 2.110.0, and its README | An official Supabase CLI package is installed and supports database/migration workflows generally. | The transaction implementation of a specific command or the hosted Management API. |
| Installed official `node_modules/supabase/dist/supabase.js:39` | The published JavaScript entry point launches the platform binary with the supplied arguments. The inspected entry point is a launcher, not a database migration implementation. | Runner-owned transactions or a verified replacement executor. The binary was not run or reverse-engineered. |
| `execution/local-apply-verification.json` | Parent-recorded local evidence for this exact apply hash: the payload and data checks run, original fixture data survives, and the wrapper commits in disposable memory; hosted catalog/extended guards were explicitly omitted. | Hosted API execution, backup availability, automatic history behavior, or live application acceptance. This reviewer inspected the report but did not rerun it. |

No runner-owned transaction contract, and no fully verified available executor alternative, was established from the bounded local official material. That absence is an evidence limit, not a new approval gate or a reason to require same-transaction history recording. There is also no evidence here that the endpoint strips the explicit transaction boundaries or executes their contents on separate connections; such behavior must not be asserted merely because backend internals are unpublished.

## Schema transaction integrity

`approved-apply.sql:6` opens the transaction and `approved-apply.sql:14113` commits it. All four guards, the before-data checksum, the unchanged reviewed payload, its final postconditions, and the after-data checksum lie between these boundaries. There is no intermediate top-level transaction boundary in the reviewed payload.

Under ordinary PostgreSQL execution of the submitted SQL on one connection, an error before COMMIT aborts that transaction, and its schema/data changes cannot partially commit. If an API runner has already issued BEGIN, the inner BEGIN does not create a nested transaction; the final COMMIT closes the actual transaction. That observation explains the possible separation from a later automatic history write. It does **not**, by itself, break atomicity of the schema statements enclosed by the artifact.

Therefore keep the current explicit BEGIN/COMMIT for this approved single-payload-transaction plan. Do not remove them based on an unverified assumption that the API supplies a replacement transaction. No executor switch or regeneration of the artifact is justified solely by the history-ordering uncertainty. Submit the exact artifact as one query/request, not pasted or split chunks. The review establishes the static transaction structure and ordinary PostgreSQL consequences; it does not claim that a hosted apply has occurred.

A direct PostgreSQL connection could be a schema-only alternative if already available and independently verified by the parent, but no such executor was verified here. It would not, by itself, supply the desired single Supabase migration-history record. No guessed CLI command, connection configuration, new credential requirement, manual history SQL, or source-migration replay is proposed by this investigation.

## Actual history risk and its treatment

The residual risk is bookkeeping divergence after a successful schema transaction. If the API writes history after the supplied COMMIT and that write fails, the complete schema can remain committed while only the original 14 history rows are present. A tool error or lost response is therefore not proof of schema rollback. This is a real reconciliation case, but it is not proof of partial schema application, altered old history, or loss of original application data.

The approved separate-history-check plan addresses this risk by observing the actual result, rather than claiming an unverified atomic API guarantee. Retain the no-blind-retry rule. Re-executing a committed payload would encounter baseline drift or existing objects and is not the way to repair missing history. If history reconciliation is needed, the parent should prepare the exact history-only correction from the proven applied artifact and receipt, preserving the original 14 entries; this note neither executes that correction nor adds a new blanket approval requirement.

| Observed state after the request is known to have finished | Interpretation and next step |
| --- | --- |
| Reviewed post-state plus exactly one expected new history row, with the original 14 unchanged | Schema application and history are separately reconciled. Preserve the request, response, hashes, observed version, and readback. |
| Reviewed post-state but no new history row | Schema committed; history is missing. Record that status explicitly and reconcile history without replaying the schema. |
| Baseline schema/history after a confirmed failed/rolled-back request | No applied schema detected; diagnose the failure before any deliberate retry. Do not infer this merely from a timeout. |
| New history without the expected schema, mixed schema, or unexpected history changes | Outcome is not reconciled. Inspect the actual state and execution evidence; do not claim success or blindly replay. |

On a timeout or transport loss, first determine whether the operation is still running. A transient readback while it is running is not a terminal outcome. Parent's read-only reconciliation must consider both schema/function fingerprints and history, not just the tool's success flag or a migration-row count.

## Receipt and provenance

Record the actual target/account identity, branch and HEAD, user approval reference, requested migration name, observed tool-assigned version, entire submitted-query SHA-256 and byte length, reviewed payload hash, source release-manifest hash, reviewed packet-manifest hash, request/response timestamps, and exact tool response. Record schema application and history reconciliation as separate statuses. Describe the API history-ordering contract as unknown; do not insert a claim of verified runner-owned atomicity into the receipt. Include no secrets or tokens.

For history acceptance, compare all captured fields of the original 14 rows, keyed by version, and require exactly one added package row. Count 15 alone is insufficient. Preserve the tool's stored statement representation when exposed, and compare it according to the actual serialization; a matching migration name is not SQL-byte provenance. If stored SQL is unavailable, state that limitation and retain the exact submitted artifact and response.

This is **one derived shared-database migration**, not 62 individually applied raw source migrations. Keep the source release manifest and original source migrations unchanged. Do not let an ordinary migration runner automatically replay those original versions against this target before its history interpretation has been reconciled.

After the apply, use postcondition/readback queries rather than weakening the old baseline guards to accept the new schema. Confirm the expected objects, ACL/RLS result, buckets, repaired function definitions, and original-data comparison. Keep those results separate from mobile/desktop, real Auth, provider, deployment, and full product acceptance. Earlier preparation-only wording does not revoke the newer apply authorization.

## Original-data checksum scope

The two queries use the same explicit original-column projection, row count, and sorted multiset of row hashes for each original table. No omitted-column or differing-before/after-query defect was found. Added columns are intentionally excluded so that the approved additive schema changes do not cause a false mismatch.

Plain BEGIN inherits the connection's isolation level. Under READ COMMITTED, ordinary concurrent writes between the scans can change the checksum and safely abort the migration. Conversely, equality of the compared visible snapshots is not a lock preventing later concurrent writes. These are limits on what the checksum proves, not a separate P1/P2 finding. Parent's maintenance/concurrency handling and separately captured original-data fingerprints remain relevant.

## Conclusion and review boundary

The earlier P2 is withdrawn because it elevated a possible history-reconciliation outcome into an unsupported requirement for schema/history atomicity. The explicit schema transaction remains statically intact for the approved plan; history must be checked separately and reported honestly. No concrete P1/P2 was found in this follow-up. No remote mutation has occurred through this reviewer, and no live API/runtime outcome is certified.

Only this review note was changed. The SQL artifact, generator, original proposal, source migrations, application files, and execution manifest remain untouched. Backup availability and the parent's pending local backup access check are outside this source/contract review; they were not investigated or turned into an additional authorization gate here.

## Backup-helper static review, 2026-11-01

Scope: `scripts/integrations/backup-shared-db.ps1`, SHA-256 `0e4b7b0d1bbc9fde2f00e211c7130a774cef90722e032ba1faffb0fc53e5ea97` (354 lines, including the added per-file ACL check). The free local-backup extension is explicitly authorized. This reviewer did not run the helper, Docker, PostgreSQL tools, a HTTP probe, or any remote query, and did not read credentials or archive contents. Only this note is appended.

**P1 — the sensitive archive directory is inside the Vite-served workspace.** At `scripts/integrations/backup-shared-db.ps1:30`, `$backupRoot` is set to the repository's `.review-tmp/shared-backups`. The current `vite.config.ts` does not exclude that directory from file serving. The installed Vite 7.3.5 implementation serves files from `server.config.root` (`node_modules/vite/dist/node/chunks/config.js:22496`), allows the workspace by default (`:25811`), and its default deny list covers environment files, certificates and `.git`, not `.review-tmp` (`:25787`). Its development file lookup also serves dot-directory files rather than applying the production directory-scan dotfile exclusion (`:22416` and `:22426`). Therefore, while this repository's Vite development server is reachable, a caller who knows an output path can request `/.review-tmp/shared-backups/<run>/database.dump` or the corresponding partial/role files. NTFS permissions do not prevent the same-user Vite process from reading and serving them, and `.gitignore` affects Git rather than HTTP access. The archive explicitly contains Auth hashes and application secrets. This is a static exposure path, not a claim that a backup has already been downloaded or that the server is publicly reachable.

Fix the location before capture: use a private backup directory outside every development-server allowed workspace, retaining the restrictive ACL and reparse-point checks; alternatively explicitly deny this directory for all relevant file-serving paths and verify denial using harmless content. A random run directory and its owner-only ACL are not a substitute for excluding it from same-user HTTP serving. No helper/config changes were made by this reviewer.

No other concrete P1/P2 was found in the inspected snapshot. The credential goes through bounded stdin framing rather than command-line arguments or Docker environment configuration; transient host buffers are cleared, the SecureString is disposed, raw stderr is not printed or persisted, and the container receives the secret only at runtime. The helper fixes the pooler/user/database and image digest, forces the local Docker named pipe, prohibits image pulling, requests full TLS verification, and supplies read-only PostgreSQL settings. Its remote commands are metadata reads, pg_dump, and role export without login secrets; no restore, migration or provider action is present. Cleanup targets only the generated container name, and incomplete cleanup/capture is not marked successful. Partial archives remain in the private attempt directory for review rather than being broadly deleted.

`-ValidateOnly` returns before Docker, credential input, backup-directory creation, or remote access; it reads local Git/filesystem metadata. It does not prove live TLS, database access, archive quality or restoreability. The success label `CAPTURED_INVENTORIED_RESTORE_NOT_TESTED`, separate role-export timing, and excluded coverage are appropriately bounded. No full PITR/enterprise specification or restore-pass requirement was added by this review.

Latest parent report: the first attempt stopped at Read-Host in a non-visible console, was marked FAILED at tool_version, PID 20904 was closed, activeContainer was null, and no database connection occurred. Those are parent-reported observations, not independently executed checks by this reviewer. A `-GuiPrompt` implementation was not present in the file snapshot above; it is not yet reviewed. This finding is returned now rather than waiting for that rewrite. Capture-quality review remains with the parent before any migration follow-on.


## Backup relocation and GUI follow-up, 2026-11-01

Reviewed helper SHA-256 `bcfbe1cbec60e514ea30515e56b9178fd4d43a4966697b44f9057bc85744b16f` (446 lines). **The backup-location P1 is resolved for the inspected configuration. No new concrete P1/P2 was found in the changed guards or GUI.**

The destination is now obtained from Windows LocalApplicationData and fixed beneath `KOCmax/PrivateBackups/mhkoayftiuojxlrkollf` (`backup-shared-db.ps1:31-37`), outside the reviewed Vite workspace and visualization root. Absolute/local-path checks, normalized case-insensitive containment checks, reparse-point rejection, and private directory/file ACL checks remain. The containment checks run before capture and again for the generated run directory (`:320`, `:347`). No archive output path points into the repository.

The GUI displays the exact target and local destination, masks input, requires an explicit Backup action, and returns no credential on cancel/close (`:49-108`). STA is required before GUI use (`:332`). Cancel exits before the first remote invocation (`:366-393`). Input is converted to a read-only SecureString; the textbox, character array and controls are cleared/disposed, and the existing stdin-only credential transfer and final SecureString disposal remain. No credential is added to command arguments, Docker configuration, logs or repository files by the GUI change. Fixed target, TLS, read-only session settings, scoped container cleanup and honest restore-not-tested status are unchanged.

This was a fast static follow-up only: no helper, GUI, Docker or database execution by this reviewer. The parent's reported validate-only success was not rerun here. Only this note was appended; migration history and unrelated execution decisions were not reopened.

## Pinned CA and credential-free TLS preflight review, 2026-11-01

Reviewed final helper SHA-256 `24e24890b5772b19b129df42a06fd9b0b52be155b680b8ae04d7a38276c01f66` (503 lines), the updated local backup guide, and the public CA file. No TLS/credential/read-only/privacy regression or security blocker was found in these additions. One P2 result-classification defect is noted below; it does not allow remote writes or bypass TLS verification.

The CA file locally hashes to `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Local X.509 parsing confirms CA=true, subject/issuer CN Supabase Root 2021 CA, validity through 2031-04-26, a valid self-signature, and certificate SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. The dashboard/verified-HTTPS provenance and successful remote handshake are parent-reported; they were not re-fetched or rerun by this reviewer.

The helper checks exact CA size/hash and rejects reparse points; it mounts that public certificate read-only. Before credential input, the isolated TLS path uses fixed host/port, PostgreSQL STARTTLS, SNI, `-verify_hostname`, `-verify_return_error`, the pinned CA file and disabled default CA path/store. It requires exit zero and both success markers. This path cannot combine with the credential-bearing Remote switch, receives no secret and no backup-directory mount, times out after 30 seconds, and retains own-container cleanup. PostgreSQL connections still independently use `verify-full`, the mounted CA and mandatory read-only settings. The normal PostgreSQL warning/stderr failure policy is not weakened to accommodate OpenSSL's success diagnostics. Outside-workspace storage, private ACLs, secure GUI/stdin handling, fixed target/image and honest capture/restore status remain.

**P2 — cancellation after successful TLS rewrites that successful TLS result as FAILED.** At `backup-shared-db.ps1:493`, the catch handler tests only whether `manifest.phase` is `tls_preflight`. After the handshake is marked VERIFIED at line 417, phase is never advanced before displaying the credential prompt. Cancelling/closing the GUI at lines 423-426 therefore enters catch and overwrites the genuine verified TLS result with FAILED, despite recording `USER_CANCELLED_NO_AUTHENTICATED_CONNECTION`. Other prompt-stage failures have the same effect. Advance the phase after successful TLS and preserve the verified TLS result for non-TLS failures, or classify the TLS result using the actual failure cause. The overall capture should still remain failed/cancelled with no artifacts. This is a reproducible static control-flow defect in the evidence record, not a reason to claim the CA is invalid or to add a new permission requirement.

The updated guide accurately distinguishes credential-free TLS from authenticated database access, records the earlier failed TLS/no-artifact attempt, and does not claim a completed backup. Parent-reported metadata/guard/history checks and the TLS probe do not replace capture-quality review. The prior attempt remains FAILED with no artifacts; restore remains untested. Only this note was appended. No helper, Docker, network request, database query/write, provider operation, or deployment was executed by this reviewer.

## TLS cancellation-status correction, 2026-11-01

**P2 closed by static review.** Helper SHA-256 is now `2eb7791a7a3ea035089ef0aa342ad0164f3839f4a6727e46b406d44553227b88` (504 lines). The only source change from the preceding reviewed snapshot is setting `manifest.phase = 'awaiting_secure_credential_input'` at line 419, after TLS success/status/time and before Write-Manifest or credential input.

Cancellation now reaches the catch handler with the credential-input phase, so the TLS-only failure branch at line 494 does not overwrite `VERIFIED_CHAIN_AND_HOSTNAME_NO_AUTH`. The overall attempt still records `FAILED_NOT_A_VERIFIED_BACKUP` and `USER_CANCELLED_NO_AUTHENTICATED_CONNECTION`, while a genuine preflight failure still records failed TLS. No credential, security, privacy, read-only or cleanup change was introduced. No outstanding P1/P2 remains from these bounded helper reviews.

No new backup attempt is claimed. The parent's local stub cancellation check is planned, not executed by this reviewer. Only this correction was appended; no helper/GUI/Docker/database execution or remote calls were made.
