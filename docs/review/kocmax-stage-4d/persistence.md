# Stage 4D D0 persistence contracts

D0 persistence implementation, 2026-10-31. Offline implementation only; no live target is activated by these contracts. Worktree `codex/kocmax-studio-stages-1-2`, base `3fcdda1`. No commit, push, deployment, remote client, provider call or model call was made by this work package.

## OAuth handoff for the main implementation

All envelopes have exactly `{keyId, iv, ciphertext}`. Actor always comes from the authenticated server context, never callback query parameters. No secret-bearing action is routed through a browser DTO or export.

- `repo.command(actor, requestId, "oauth_start", {stateHash, sessionHash, provider, expectedGeneration, returnPath, expiresAt, secret})`: SHA-256 hex state/session hashes; expiresAt <= database now + 10 minutes. `secret` encrypts PKCE verifier/nonce and server OAuth context. `returnPath` accepts `/connections`, `/studio`, or `/home`, optionally with a query (for example `/studio?thread=...`), maximum 2,048 characters, with no percent encoding, backslash, whitespace, or control characters. Result `{}`. The wrapper validates this path, delegates old `start` with `/connections`, then stores the validated path. Old mock `start` remains unchanged. Completion returns the original discussion path.
- Service-only RPC `integration_oauth_callback(p_state_hash, p_provider, p_ticket_hash, p_code, p_expires_at)`: callback handler hashes state and a fresh opaque completion ticket; `p_code` is an envelope, never raw code. It resolves the original owner privately, atomically claims unexpired state, and stores a ticket for <=5 minutes, no later than state expiry. Returns only `{stored:true}`. No actor query parameters and no owner identifiers returned. Duplicate/expired state fails closed.
- Service-only RPC `integration_oauth_lookup(p_state_hash,p_provider)` returns `{actor:{workspaceId,creatorId},expectedGeneration,returnPath,expiresAt}` while the state is unconsumed, unexpired and generation-current. This private lookup accepts no caller-supplied actor and does not consume state. `SupabaseIntegrationRepository.lookupOAuthState(stateHash,provider)` wraps it.
- `repo.command(actor, requestId, "oauth_complete", {ticketHash, provider, sessionHash, allowRelogin:false})`: actor/workspace must match original state; session hash must match unless authenticated server explicitly establishes same-actor relogin and passes `allowRelogin:true`. Atomically consumes ticket and returns `{stateHash, expectedGeneration, returnPath, secret, code}` to the server only. Generation and state expiry are rechecked, envelopes erased. Replay denied. Browser redirect carries only opaque ticket (never code/token/PKCE).
- Direct same-session `oauth_consume` uses `{stateHash,sessionHash,provider}` and returns `{stateHash,expectedGeneration,returnPath,secret}`; this consumes state before an ordinary direct exchange. Callback-buffer and direct consume are mutually exclusive.
- `SupabaseIntegrationRepository.bufferOAuthCallback({stateHash,provider,ticketHash,code,expiresAt})` wraps the callback RPC. These two callback methods deliberately remain outside the general actor-bound `IntegrationRepository` interface.

## Other persistence contracts

- `pilot_bind`: `{id:connectionId,generation:nextGeneration,provider,environmentId,databaseProjectId,origin,providerProjectId,subjectHash:64hex,apiVersion}` -> `{bindingId}`. Private server-established record; not a runtime approval. Only D1 service wiring may use it for real provenance.
- `connect`: existing payload plus top-level `bindingId`; `connection.sampleOnly:false` requires matching owner/connection/generation binding. Mock records remain sample-only. Offline injected adapters must continue supplying sampleOnly:true without a live binding.
- Safe metadata: `mode:"mock"|"live_pilot"`, `acquisitionMethod:"mock"|"provider_api"`, `apiVersion:string|null`, `claimVerification:"unverified"`. Public metadata never includes subjectHash, providerProjectId, OAuth secret or grant-group identifiers.
- `refresh_acquire`: `{id,generation,holderId,leaseSeconds?:30}` (1..60 seconds) -> `{status:"acquired"|"busy"|"reauth_required",leaseId?,credentialVersion?,credential?,expiresAt?}`. Expired ambiguous leases require reauthentication, never replay provider refresh.
- `refresh_commit`: `{id,generation,leaseId,credentialVersion,credential,expiresAt}` -> `{credentialVersion}`. Database CAS and lease expiry check. Commit and abandon require a non-null UUID string lease ID, a numeric integer credential version in 1..2147483647, and an existing matching lease row. Missing/malformed fence fields fail `INVALID_INPUT`; a well-formed fence with no lease fails `REFRESH_LEASE_STALE`. No credential mutation occurs on either rejection.
- `refresh_abandon`: `{id,generation,leaseId,credentialVersion}` -> `{status:"reauth_required"}`. Ambiguous exchange is fenced; no blind refresh retry.
- Exported `RepositoryRefreshLease(repo,holderId)` exposes `acquire(actor,id,generation,leaseSeconds=30)`, `commit(actor,id,generation,lease,credential,expiresAt)` and `abandon(actor,id,generation,lease)`; exported `RefreshLeaseResult` and `AcquiredRefreshLease` describe the responses. No provider calls, waits or retries occur in this class.
- Existing `revoke` / `revoke_result` coordinate live Google bindings with identical subjectHash + providerProjectId privately. Caller sees only its connection. Pending/manual-action revocation blocks reconnect until confirmed; credentials and selections are never shared. Once the caller's grant is already revoked, a local purge or repeated revoke delegates only that connection to the original dispatcher; it cannot revoke a peer's later authorization, clear the peer's refresh lease, or reset the shared grant state.

Optional resource/source `evidence` accepts only `apiVersion`, `endpoint`, `measurementPeriod`, `selectionPeriod:{start,end}`, and `permalink`. It is copied from the server resource into immutable snapshots and imported source metadata, with lengths and types checked. Unknown fields are rejected. Evidence observations are keyed by resource ID, generation, provider content hash and `fetchedAt`; a newer observation can have a newer selection period with identical metrics and content hash. It gets a new snapshot without rewriting historical snapshots or imported evidence. Repeating the exact current observation reuses its snapshot; conflicting evidence for the exact same SQL observation is rejected. Provider content hashing is unchanged. Google `openid` is retained for offline adapters too, without changing their sample-only provenance.

## Verified Instagram notice dispatch

`SupabaseIntegrationRepository.applyProviderNotice({providerProjectId,subjectHash,receiptHash,kind})` calls service-only RPC `integration_provider_notice(p_provider_project_id,p_subject_hash,p_receipt_hash,p_kind)`. Both hashes must be 64 lowercase hexadecimal characters; kind is exactly `deauthorization` or `deletion`. Result is exactly `{confirmationCode,status:"pending"|"completed"}`. There is no actor/user ID parameter and no identity, connection count or scope in the response. `ProviderNoticeInput` and `ProviderNoticeResult` are exported from `repo.ts`.

The caller must verify the signed notice and inject an explicitly verified mapping for the exact Meta app/login product. SQL matches only private bindings with `provider='instagram'` and exact provider-project/subject hashes. It never compares a generic `user_id` with a raw Instagram subject. The app-specific mapping remains a D1 gate and routes stay default-503 until the parent deliberately configures a verified dispatcher.

The transaction takes the same pilot lock before creator locks, claims a private receipt, invalidates matching source/permit/model lineage and unfinished OAuth, and fences prepared bindings from later activation. Matching current connections are revoked; deauthorization clears their credentials as confirmed by the verified notice. Deletion uses the original private purge for matching connection history. Receipt, all local mutations and the opaque confirmation commit together; an injected later-owner failure rolls everything back. Exact receipt replay returns its saved confirmation without touching later grants. Reusing a receipt hash with a different mapping or kind is rejected.

`completed` means the matching local operation completed; a deletion request alone does not prove a separate remote token-revocation call. When a reused connection ID contains another account's history, wholesale purge would over-delete. Matching uses are quarantined, matching current credentials are removed, and the receipt remains `pending` for narrower lineage-scoped erasure. Historical-only deletion likewise remains `pending` without disabling a newer differently mapped account. That cleanup worker is deliberately not implemented or scheduled in D0; replay remains stable and does not silently claim deletion. Private receipts currently have no automatic expiry and contain no raw signed request, user ID, token or source body.

## Bounded maintenance and restore

- `maintenance_acquire {leaseSeconds?:30}` (1..60) -> `{status:"acquired",leaseId,expiresAt}` or `{status:"busy"}`. Lease is per owner/workspace.
- `maintenance {dryRun?:true,batchSize?:50,leaseId?}` -> `{dryRun,counts:{snapshots,credentials,states,permits,events},hasMore,pendingRevocations,manualAction}`. Batch size 1..100 bounds each category. No caller-provided clock is accepted. Mutations require a current lease; dry-run acquires no lease and changes no rows. Calls may be repeated with the same valid lease until counts are exhausted. A new lease is safe after expiry because no remote operation is performed.
- SQL selects expired, unreferenced snapshots only; original snapshot expiry is 30 days and original revocation caps it at 24 hours. Referenced snapshots and model-permit lineage remain. Snapshot deletion scrubs resource excerpts/metrics, saved resource-result caches and sync-result caches. Old event retention remains 90 days. Revocation credentials expire after the original 24-hour deadline and then report `manual_action`, never provider confirmation. Normal access-token expiry is not treated as permission to discard a refresh credential.
- `tombstone_export {limit?:100,after?:uuid}` -> `{tombstones,nextCursor}`. Server-only owner/workspace pages contain `{id,workspaceId,creatorId,connectionId,throughGeneration,kind,createdAt}` and no provider secrets, source text, subject or project. Tombstones have no FK to deleted content; account deletion records a permanent account fence. Tombstone export is permitted for the matching deleted creator as a service-only operation.
- `restore_import {tombstones:[...]}` accepts 1..100 exact-owner records, validates IDs/kinds/generations and sets a persistent `restore_pending` command fence. Cross-owner records and conflicting IDs fail.
- `restore_replay {batchSize?:50}` -> `{replayed,complete}`. Replays revoke/purge/account deletion before clearing that actor's command fence; repeated batches are idempotent. A restored account-deletion fence prevents new connections even if an old backup changes the creator back to active. New legitimate connection generations are not erased by old connection-scoped tombstones.
- `inspectIntegrationMaintenance`, `runIntegrationMaintenanceBatch`, and `replayIntegrationTombstones` in `lifecycle.ts` expose those algorithms over an injected repository. They create no clients and call no providers.
- `scripts/integrations/pilot-maintenance.ts` exports `dryRunPilotMaintenance`. D0 requires an actual `MemoryIntegrationRepository`, exact in-memory target ID and exact 40-hex source SHA, `dryRun:true`, 1..100 supplied actors and batch size 1..100. It deduplicates actors and returns aggregate counts without actor identifiers. It has no executable scheduler, remote URL, environment-based client constructor, or live execution switch.

## Preservation and implementation boundaries

The additive migration moves the reviewed `integration_command` dispatcher into private scope and delegates existing commands to it. The three old integration migrations are unchanged. Existing creator locking, `clock_timestamp()`, immutable snapshots, revoked-history/model redaction, permits, resource identity, canonical mission drafts, settlement and rewards remain in their existing functions. Export retains stable `request_id` ordering for sync runs and pagination across all existing public integration tables; private OAuth/bindings/tombstone tables are excluded. Defensive export scrubbing also removes OAuth/PKCE/nonce/ticket and private grant-coordination fields from malformed nested data.

The migration was created with installed Supabase CLI 2.110.0 after reading `migration new --help`, with `SUPABASE_TELEMETRY_DISABLED=1`. Its generated timestamp was before the pre-existing future-dated migrations, so the local file was renamed to `20261031123000_integration_pilot_persistence.sql` to follow `20261031122000`. No project client, linked-project command or migration application to a database service was used.

The small pilot serializes integration commands with a database transaction advisory lock before creator locks. This makes cross-owner invalidation lock order explicit and keeps all peer identifiers private. It is intentionally conservative; throughput and genuine multi-connection contention require D1 verification.

## Executed evidence

Tests were written first and observed failing on absent commands/provenance protection, absent lease behavior, malformed evidence acceptance, absent maintenance/restore, and nested export leakage. Those failures were corrected within the owned files.

Final combined command (all PGlite databases use `memory://`; provider transports are mocks):

```text
npm exec vitest -- run server/test/integrations-pilot-persistence.test.ts server/test/integrations-pilot-maintenance.test.ts server/test/integrations-pilot-memory.test.ts server/test/integrations-pilot-regression.test.ts server/test/integrations-pilot-notices.test.ts server/lib/integrations/memoryRepo.test.ts server/lib/integrations/refreshLease.test.ts server/lib/integrations/repo.test.ts server/lib/integrations/lifecycle.test.ts scripts/integrations/pilot-maintenance.test.ts server/lib/integrations/service.test.ts server/test/integrations-privacy.test.ts server/test/integrations-offline-adapters.test.ts --maxWorkers 2 --minWorkers 1
```

Result after R1-R3 and the R3 replay follow-up: **143 passed, 0 failed**. This includes all 49 existing integration SQL behavior cases, loaded against the additive migration by the separate pilot regression fixture, without editing the shared fixture; 10 mapped-notice cases; nine review regressions; and the parent's actual offline-adapter/OAuth/SQL/refresh/revoke composition case. Return-path, notice and review regressions were observed failing before their implementation. Targeted ESLint passed for the owned TypeScript/test files (the three files changed in review were rechecked, then the SQL regression test was checked again after the replay follow-up). A TypeScript program rooted in all 15 owned TypeScript/test files reported zero owned or dependency diagnostics after the replay fix. Scoped `git diff --check` passed. No broad suite or build ran in this work package.

## Copernicus re-review handoff: R1-R3

Copernicus independently re-reviewed the prior freeze: R1/R2 looked sound, but a Drive selection-intent retry exposed an R3 ordering bug. That exact failure was reproduced and fixed below. Once the incoming reviewer message supplied the address, a direct re-review notification was delivered with the replacement frozen hash and fresh test results. Final independent re-review is pending; no approval is implied by the local checks.

- R1: SQL and memory regressions parameterize old `purge` and old `revoke`: authorize A/B for the same private Google subject/project, revoke and confirm, reconnect B at generation 3, acquire B's refresh lease, then clean up A. B remains connected at generation 3 and its held lease still commits version 2. The already-revoked local branch runs before grant fanout.
- R2: SQL and memory reject absent/null/wrong-type/malformed/out-of-range fence fields for both commit and abandon, reject valid-shaped fences without a lease, preserve credentials, and accept the valid lease afterward. SQL explicitly checks `FOUND` and uses null-safe version/generation comparisons.
- R3: SQL and memory resync identical metrics/content hash under a later `fetchedAt` and selection period. The current snapshot changes; exact-observation repeat reuses it. SQL also checks historical snapshot/source evidence remains unchanged, immutable snapshot updates remain rejected, and conflicting metadata cannot rewrite one observation. No provider hashing or main service file changed.
- R3 retry follow-up: resource input is validated and normalized first. If its request ID already exists, the original dispatcher checks intent conflicts, generation and current snapshot/source availability before any observation insert or pointer update. A retry after a provider reread returns the original saved result even when the reread's `fetchedAt` is newer. A genuinely new request appends its observation; a superseded cached result remains unavailable. This adds no schema object or signature.

Focused reproduction command: `npm exec vitest -- run server/test/integrations-pilot-persistence.test.ts server/test/integrations-pilot-memory.test.ts --maxWorkers 2 --minWorkers 1`. It passes 24 tests (16 SQL and 8 memory). The combined 143-test run above includes this coverage and the original behavior suites.

Exact added regression names (nine executed cases; `%s` is parameterized with `purge` and `revoke`):

| File | Test name | Cases |
| --- | --- | --- |
| `integrations-pilot-persistence.test.ts` | `requires an existing refresh lease and non-null typed CAS fields before any credential mutation` | 1 |
| `integrations-pilot-persistence.test.ts` | `an old Google %s cannot revoke a peer's subsequent authorization` | 2 |
| `integrations-pilot-persistence.test.ts` | `appends newer observation evidence with identical metrics/hash while retaining immutable history` | 1 |
| `integrations-pilot-persistence.test.ts` | `replays a Drive selection intent before mutating newer observation metadata` | 1 |
| `integrations-pilot-memory.test.ts` | `memory old Google %s leaves a freshly authorized peer and refresh lease intact` | 2 |
| `integrations-pilot-memory.test.ts` | `memory observation evolution creates a new snapshot without changing content identity` | 1 |
| `integrations-pilot-memory.test.ts` | `memory refresh rejects malformed fences and a missing lease without mutating credentials` | 1 |

## Frozen schema inventory for the main manifest

SQL SHA-256 after the R3 replay follow-up: `485bee1d9978bced3983a70a846825e410a19805dd47d972739c7ae2c55ebdbc`. This supersedes `cf4d6ea3ebc22585d8e55638c049fda04ca6a783930fd6bb4cd5cffd1f212dd3`; SQL is frozen for the parent's manifest regeneration. Compared with the pre-review freeze, the sole schema-object shape change is `private.integration_pilot_evidence.fetched_at timestamptz NOT NULL` and expansion of its primary key to `(resource_id,generation,content_hash,fetched_at)`. No new object or RPC signature is added by R1-R3 or the replay follow-up.

- Service-only public functions: `integration_command(uuid,uuid,uuid,text,jsonb)`, `integration_oauth_lookup(text,text)`, `integration_oauth_callback(text,text,text,jsonb,timestamptz)`, `integration_provider_notice(text,text,text,text)`.
- Private tables (RLS enabled, direct access revoked from public/anon/authenticated/service_role): `integration_pilot_grants`, `integration_pilot_bindings`, `integration_pilot_oauth`, `integration_refresh_leases`, `integration_pilot_evidence`, `integration_pilot_tombstones`, `integration_pilot_maintenance`, `integration_pilot_notices`.
- Private helpers: `integration_pilot_return_path(text)`, `integration_pilot_metadata(uuid,integer)`, `integration_pilot_provenance()`, `integration_pilot_tombstone()`, `integration_pilot_restore_candidates(uuid,uuid)`, `integration_pilot_maintenance_command(uuid,uuid,uuid,text,jsonb)`, `integration_notice_binding_guard()`; retained original dispatcher renamed `private.integration_command_stage4abc(uuid,uuid,uuid,text,jsonb)`.
- Triggers: `integration_pilot_connection_provenance` on connections, `integration_pilot_resource_provenance` on resources, `integration_pilot_snapshot_provenance` on snapshot insertion, `integration_pilot_source_provenance` on source insertion, `integration_pilot_tombstone` on connection update/delete, `integration_pilot_account_tombstone` on creator status update, `integration_notice_binding_guard` on private binding activation.
- Existing-table changes: `private.integration_credentials.credential_version` and replacement `integration_oauth_states_return_path_check` on `private.integration_oauth_states.return_path`. The new binding table also gains `notice_invalidated_at` in the notice section. No old migration file is edited and no mission/reward schema is changed.

## Limitations and work deliberately left for D1+

- No real PostgreSQL two-connection race, Auth/JWT/PostgREST/RLS acceptance, provider refresh/revoke, deployment, real scheduler, or backup restore was performed. PGlite and mock tests do not establish any of those results.
- Runtime/target approval, allowlist enforcement, credentials keyring, OAuth coordinator and integration service wiring belong to main. Binding creation is a server-only contract, not an independent authorization or activation of a target. Injected D0 adapters must keep `sampleOnly:true` and omit live bindings.
- Notice dispatch is implemented in SQL plus the Supabase repository adapter, and tested only with explicitly known fixture mappings. Real app-verified IG mapping, signature/dispatch composition on the approved target and concurrent PostgreSQL behavior remain D1 gates; generic Facebook ASID documentation is insufficient. Receipts returning `pending` for historical/mixed-account erasure require the deliberately unscheduled narrower cleanup described above.
- Restore import/replay/tombstone export are implemented and tested in SQL/PGlite, not in the memory repository. The memory maintenance model has no historical snapshot or event ledger; use the SQL tests for retention/restore evidence.
- D1 restore orchestration must keep the whole target quarantined while obtaining and replaying the complete independently retained tombstone log. The `restore_pending` flag fences integration commands; existing direct SELECT/RLS and Studio readers are not a global restore quarantine. The schema alone does not prove the log is complete or that a restored target is safe to reopen.
- Tombstones currently have no automatic expiry. Their authoritative retention location, backup horizon and eventual disposal require the D1 privacy runbook; they must not be removed while an eligible backup can resurrect content.
- The old `expire` command is retained for compatibility. A future scheduler must use the new leased/bounded maintenance commands. The D0 script is intentionally dry-run only and performs no actual cleanup outside tests.

## Owned changed paths

- `supabase/migrations/20261031123000_integration_pilot_persistence.sql`
- `server/lib/integrations/{repo,memoryRepo,refreshLease,lifecycle}.ts`
- `server/lib/integrations/{repo,refreshLease,lifecycle}.test.ts`
- `server/test/integrations-pilot-{fixture.ts,persistence.test.ts,maintenance.test.ts,memory.test.ts,regression.test.ts,notices.test.ts}`
- `scripts/integrations/pilot-maintenance.ts` and `pilot-maintenance.test.ts`
- `docs/review/kocmax-stage-4d/persistence.md`
