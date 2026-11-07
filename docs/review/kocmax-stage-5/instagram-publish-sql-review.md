# Instagram publishing repository — prepared SQL review

Task 3 is offline only. The migration below is unapplied. Production construction remains disabled; there is no route, environment enablement, provider transport, media hosting, or reward write in this task. PGlite verification is not live Auth/RLS or multi-session PostgreSQL acceptance.

## Scope and retention

`supabase/migrations/20261104134202_kocmax_publish_intents.sql` is the previously allocated empty migration. Only this migration is changed. It adds four private tables: expiring preview approvals; durable intents; minimal request hashes and intent references; and source-lifetime revision consumption markers. No applied migration or existing repository/policy is changed.

Preview records contain a nonce hash and authenticated session hash, never the raw nonce/session. They expire after five minutes. Successful consumption and reserve are atomic. Same complete command replays without new timestamps; any changed binding/session/nonce/request content conflicts. Separate tabs with valid approvals share one intent. Creator locks, unique source revision constraints, and compare-and-swap versions prevent a second worker claim. A transition replay always returns `applied:false` and the current safe state.

Intent records contain IDs, hashes, bounded state and provider receipt scalars, and timestamps. Caption/image content remains in canonical growth sources. Receipts accept only numeric provider IDs, allowlisted status/code, an observation time and sample flag. No URL, storage path, credential, arbitrary provider JSON or raw exception is accepted.

Cleanup accepts a batch limit of 1–100 and deletes at most that many expired previews and that many expired terminal/never-started intents. Intent metadata and request receipts have a 90-day deadline. Each intent has at most 256 command records. In-flight/unknown outcomes are held beyond the deadline and counted as `heldUnknown`, pending separately authorized exact-ID reconciliation or a reviewed privacy disposition; cleanup never silently treats them as failed or retries a POST. The small revision marker survives receipt cleanup so a new preview cannot repeat the same revision. It contains only owner/source/revision/optional intent IDs and cascades with the canonical draft, whose lifecycle/retention remains owned by the growth repository.

Canonical connection generation/account/revoke changes invalidate unused approvals and queued intents in the same transaction. In-flight work becomes stopped `outcome_unknown`. Source deletion detaches nullable composite FKs while retaining the original hashed binding and minimal unknown receipt. Owner suspension removes previews and denies service reads/writes; owner deletion also removes terminal intents. Unresolved old-target audit remains inaccessible to the deleted owner. Late receipts must match the exact original account/connection/generation and never reactivate an intent or grant.

All four tables enable RLS with no policies and no direct grants, including to service_role. One explicit service-only RPC checks an active creator in the exact workspace. Private helpers have no client/service EXECUTE privileges. Composite source/intent FKs prevent cross-owner references. A server-only injected clock supplies command time; canonical lifecycle triggers use database time. The future service must recompute policy/mission fingerprint and resolve current authority before provider writes; a stored fingerprint alone is not authorization.

## Exact rollback SQL

Stop any future worker/route that could use these objects first. Capture and review unresolved outcome evidence before removal. This rollback drops only Task 3 objects and restores no historical application data. A rollback is not permission to retry external writes. If this migration were ever used with a real provider, deleting the revision markers requires preserving a separate approved consumption record before re-enabling publishing. No live execution is authorized here.

<!-- TASK3_ROLLBACK_START -->
```sql
begin;
drop trigger creator_publish_owner_change on public.creators;
drop trigger creator_publish_asset_change on private.creator_growth_assets;
drop trigger creator_publish_draft_change on private.creator_growth_drafts;
drop trigger creator_publish_connection_change on public.integration_connections;
drop function public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz);
drop function private.creator_publish_owner_change();
drop function private.creator_publish_source_change();
drop function private.creator_publish_stop(uuid,uuid,text,uuid,timestamptz);
drop function private.creator_publish_authority(uuid,uuid,jsonb,timestamptz);
drop function private.creator_publish_dto(private.creator_publish_intents);
drop table private.creator_publish_commands;
drop table private.creator_publish_approvals;
drop table private.creator_publish_revisions;
drop table private.creator_publish_intents;
drop function private.creator_publish_time(timestamptz);
drop function private.creator_publish_receipt(jsonb);
drop function private.creator_publish_binding(jsonb);
drop function private.creator_publish_keys(jsonb,text[],text[]);
commit;
```
<!-- TASK3_ROLLBACK_END -->

## Future apply and restore checklist — not executed

1. Obtain separate authorization for an exact reviewed SQL checksum, verified protocol, isolated runtime and target DB. Verify all prerequisite integration/growth migrations and source constraints. Current canonical OAuth does not request the publishing scope; PGlite alone adds a synthetic grant for tests.
2. Record backup/restore point and prove restoration in a disposable database. Freeze the exact migration and rollback bytes; review table/index/trigger catalogs and existing grants before applying anything.
3. Create only disposable owner/colleague/cross-workspace fixtures and synthetic grant/source data. Save mission/submission/points/XP/badge and existing trigger/function baselines. Never seed a real provider token or reuse another owner's account.
4. Run native independent-session reserve/CAS/revoke contention tests, role/JWT checks and rollback/restore acceptance. PGlite uses one connection and cannot prove native lock scheduling or deployment grants.
5. Delete local disposable data/leases, run bounded cleanup, verify unknown holds explicitly and verify mission/reward baselines unchanged. Roll back the exact objects if acceptance fails; do not drop a shared schema or use CASCADE.

## Verification inventory

Final offline check: **62/62 repository/schema tests**, including identical memory/SQL contract execution, current-source and owner checks, canonical revoke rollback, documented object rollback, and byte-for-byte mission/points/XP/badge fixture preservation. **87/87** affected integration/Studio regressions also pass. TypeScript, focused ESLint and ESM checks report exit 0. The disposable fixture represents XP as an `xp` point-ledger row with delta 0; it does not claim live Active-mission reward acceptance.

Rollback SQL body was extracted from this document and executed inside the existing PGlite test transaction/savepoint. Every Task 3 table/helper/RPC disappears; prerequisite tables and function definitions and reward fixture rows remain unchanged. Rolling back that savepoint restores the in-flight intent. This is a local transactional DDL rehearsal, not a backup restore or native multi-session test.


## Migration identity and exact object/index inventory

- File: `supabase/migrations/20261104134202_kocmax_publish_intents.sql`.
- Before: allocated empty file, 0 bytes; SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- After: **31,867 bytes / 335 lines**, SHA-256 **`d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7`**.
- Four private tables, 10 composite foreign keys, four additive canonical lifecycle triggers, nine private helpers, one public service-only RPC. No existing trigger/function is replaced. Zero new RLS allow policies, zero direct table privileges for anon/authenticated/service_role.
- **20 indexes total**: four primary-key indexes, two additional constraint-backed unique indexes, one explicit unique revision index, and 13 nonunique lookup indexes. These include all FK leading prefixes, owner/recent and owner/expiry paths. The owner-composite intent unique constraint is needed as an exact referenced key; its columns are not repeated by a separate secondary index. The revision indexes on the intent and consumption tables protect different tables/lifetimes.

| Table | Index | Exact key definition |
|---|---|---|
| `creator_publish_approvals` | `creator_publish_approvals_asset_fk` | `(asset_id, workspace_id, creator_id)` |
| `creator_publish_approvals` | `creator_publish_approvals_connection_fk` | `(connection_id, workspace_id, creator_id)` |
| `creator_publish_approvals` | `creator_publish_approvals_creator_fk` | `(creator_id, workspace_id)` |
| `creator_publish_approvals` | `creator_publish_approvals_draft_fk` | `(draft_id, workspace_id, creator_id)` |
| `creator_publish_approvals` | `creator_publish_approvals_nonce_hash_key` | `(nonce_hash)` |
| `creator_publish_approvals` | `creator_publish_approvals_owner_expiry` | `(workspace_id, creator_id, expires_at)` |
| `creator_publish_approvals` | `creator_publish_approvals_pkey` | `(id)` |
| `creator_publish_commands` | `creator_publish_commands_intent_fk` | `(intent_id, workspace_id, creator_id)` |
| `creator_publish_commands` | `creator_publish_commands_pkey` | `(workspace_id, creator_id, request_id)` |
| `creator_publish_intents` | `creator_publish_intents_asset_fk` | `(asset_id, workspace_id, creator_id)` |
| `creator_publish_intents` | `creator_publish_intents_connection_fk` | `(connection_id, workspace_id, creator_id)` |
| `creator_publish_intents` | `creator_publish_intents_draft_fk` | `(draft_id, workspace_id, creator_id)` |
| `creator_publish_intents` | `creator_publish_intents_id_workspace_id_creator_id_key` | `(id, workspace_id, creator_id)` |
| `creator_publish_intents` | `creator_publish_intents_owner_expiry` | `(workspace_id, creator_id, retention_until)` |
| `creator_publish_intents` | `creator_publish_intents_owner_recent` | `(workspace_id, creator_id, created_at DESC)` |
| `creator_publish_intents` | `creator_publish_intents_pkey` | `(id)` |
| `creator_publish_intents` | `creator_publish_intents_revision` | `(workspace_id, creator_id, ((binding ->> 'draftId'::text)), (((binding ->> 'draftRevision'::text))::integer))` |
| `creator_publish_revisions` | `creator_publish_revisions_draft_fk` | `(draft_id, workspace_id, creator_id)` |
| `creator_publish_revisions` | `creator_publish_revisions_intent_fk` | `(intent_id, workspace_id, creator_id)` |
| `creator_publish_revisions` | `creator_publish_revisions_pkey` | `(workspace_id, creator_id, draft_id, revision)` |

Catalog evidence: `.superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/task-3-results/index-catalog.json`. Tests query `pg_index` and `pg_constraint` for exact duplicates and every FK leading prefix; they do not infer index coverage from SQL text. Rollback drops all 20 indexes with their four tables and removes only the four Task 3 triggers and ten functions. It leaves the growth storage bucket, existing durable route plans/receipts, integration lifecycle and reward mechanisms intact.

The unknown-outcome hold is an explicit retention exception requiring a later authorized privacy/audit disposition. There is no live cleanup job or public operator RPC in this task. Server orchestration must handle `PUBLISH_LIMIT` safely; it cannot bypass CAS by calling a provider directly. Each new provider POST requires a successful `applied:true` claim; interrupted or replayed claims never authorize another POST.


## Independent review I1 — durable publish-claim correction

The initial offline handoff checksum was `f7ddc32123cf3989ea0fdbc6dc3afc93e222ea4dc72f8167559ec2cef0e2d53a`. Independent review found that CREATE/polling uncertainty could accept a late media ID and then become published without ever claiming a publish. Matching memory and real PGlite RPC regressions reproduced that full false-promotion trace before the fix. The current checksum above supersedes that handoff. Independent re-review accepted the correction with no new findings; see the final appendix in `.superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/task-3-independent-review.md`. Live/native acceptance remains separate.

The intent now holds four **internal** scalars: `publish_claim_request_id`, `publish_claim_version`, `publish_claim_container_id`, and `publish_claimed_at`. They are set only by the winning `provider_processing -> publish_requested` CAS after ready-container and current-source checks, atomically with the command receipt. The intent's immutable owner/account/generation/fingerprint binding supplies the exact target; the marker pins the exact ready container, request, version and original time. Replays never regenerate or overwrite it. Two CHECK constraints require all four or none, a valid matching receipt container/version, and a claim for publish-requested/published states.

Both normal and late media receipt admission require this stored claim; unknown-to-published promotion also requires it. A CREATE/polling interruption therefore cannot manufacture publication evidence by passing a media ID later. Container-only late audit is retained before publish. A genuine publish claim survives canonical revoke/source deletion: old-target media receipts remain minimal audit evidence while stopped state cannot become published. No public request field, method signature, safe DTO or provider action was added. Service compatibility is verified by 72 downstream offline tests.

Object/index counts remain exactly **4 tables, 10 FKs, 4 triggers, 9 private helpers, 1 public RPC, 20 indexes**. The four scalar columns and two checks require no additional lookup index; existing primary-key intent access covers their use. The executed index catalog is byte-identical to the original inventory. Retention/deletion remains unchanged: claim history lives/dies with the intent and remains during an unresolved-outcome hold. The exact rollback SQL above is unchanged and removes the four columns/checks with `creator_publish_intents`; it was re-executed by the passing PGlite rollback test. No applied migration, table outside this new schema, grant, storage policy or reward mechanism was changed.
