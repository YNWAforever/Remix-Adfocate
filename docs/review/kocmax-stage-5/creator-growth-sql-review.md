# Creator Growth Private Persistence Review

## Status

Proposal only after Task 6 fix round 5 and Task 7 fix round 1.
`supabase/migrations/20261103215321_kocmax_creator_growth_private.sql` has not
been applied to a local persistent database, the existing Adfocate database, a
hosted Supabase project, or any remote service.

- Branch: `codex/kocmax-studio-stages-1-2`
- Base HEAD: `e491e2dd30f42090458eacb82777d45b67275627`
- Migration SHA-256:
  `BFE4FAB81BB23198A2F57C804A521B03B83C2A41815ACC86F8966AC49B2D0E43`
- Size: 104,096 bytes / 1,803 lines
- Runtime flag: `CREATOR_GROWTH_PERSISTENCE_ENABLED=true` is required by the
  Supabase adapter. Absence and every other value leave persistence disabled.
- No live advisor, bucket creation, Auth account, provider connection, deploy,
  publication, or external request was performed.

## Review rulings

1. `public.integration_command(..., 'revoke', ...)` remains authoritative.
   An additive trigger on `public.integration_connections` detects the single
   transition to `revoked` with one generation increment and calls the
   owner-locked growth invalidation helper in the same transaction. Growth has
   no repository mutation, SQL command action, public wrapper, or grant for
   revocation.
2. Minimal mutation receipts in `private.creator_growth_commands` do not store request, analysis, report, proposal, caption,
   manual-description, or credential JSON. They retain only an action hash, an
   entity UUID, a small numeric/status result hint, and a 90-day expiry. Replays
   reconstruct from current owner-scoped rows and fail after invalidation.
   Task 7 additionally has a SEPARATE protected `creator_growth_route_commands`
   table. Its bounded server-generated preparation may contain normalized
   analysis, report and proposal JSON. It is not a minimal mutation receipt,
   browser DTO, or publication approval; its privacy/retention rules are below.
3. Ordinary growth operations require an active owner. Owner purge uses the
   same owner lock but accepts `active` or `suspended`, so suspension can
   transition to account deletion. Post-deletion physical cleanup uses separate
   service-role-only list, claim, and finish RPCs keyed by exact owner IDs,
   object path, worker token, and lease.
4. Analysis attachment checks source-kind usability. Denied or unknown rights
   fail; public/official evidence must be public and matched; creator uploads
   must match the analysis asset and retain allowed rights; official evidence
   must retain a current authorized connection.
5. A consent is usable only when its processor exactly matches the analysis
   processor. A draft with an analysis requires the faithful asset, a skill
   requires an analysis, and upstream analysis/skill deletion cascades the
   derived draft instead of leaving caption text behind.
6. Skill invocations carry a bounded unique list of canonical media-source IDs.
   Owner/thread-safe junction rows persist those links. Task 7 rejects client
   `report` fields and builds the report from the owner/thread-scoped analysis,
   selected stored sources, and actual integration-resource metric snapshots.
   Strict scalar validation precedes persistence and projection. Repository/SQL
   lineage checks additionally bind observation, provenance, citations, and
   result refs to the canonical source set; source IDs alone do not authenticate
   arbitrary client-authored metric or coverage facts.
7. Observation and sample metadata are typed and null-safe. The observation
   sample flag equals the asset flag; report and result sample flags equal the
   OR of that asset and every actually claimed canonical source. Synthetic and
   creator-upload assets cannot cross-label each other.
8. Available or non-null metrics require canonical official source, provenance,
   and citation. The complete claimed source set must exactly equal
   `mediaSourceIds`; extra and missing IDs fail.
9. Every analysis-attached media source with a non-null asset must name the
   analysis asset, regardless of source kind.
10. The complete report observation must equal the stored normalized Task 3
    observation plus canonical asset binding fields. Missing, extra, or altered
    substantive fields fail.
11. Official/public citations and provenance must match the referenced stored
    source sample flag and observation timestamp exactly.

## Dependency order

The migration depends on:

1. `public.workspaces`, `public.creators`, and `public.studio_threads`.
2. `20261031120000_creator_integrations.sql`, including composite creator and
   connection owner keys.
3. Supabase-managed `storage.buckets` and `storage.objects`.

All new application tables are in the unexposed `private` schema. Existing rows,
columns, constraints, indexes, point balances, creator scores, missions, rewards,
and provider credentials are not updated by the growth commands. The migration
adds triggers to the existing creator and integration lifecycle tables so the
canonical revoke and account-deletion transactions also update growth metadata.

## Ownership and enforcement

The repository actor is always:

```text
{ workspaceId, creatorId }
```

Every ordinary command first verifies the workspace and active creator in that
exact workspace and locks the creator row. Connection and generation checks
occur after that lock. `purge_owner` uses a non-deleted creator lock with
`active` or `suspended` status.

The cleanup maintenance RPCs intentionally do not require an active or existing
creator row because cleanup must continue after account deletion. They require
service-role execution and use:

- exact `workspace_id` and `creator_id`;
- an exact server-generated object path;
- a claim worker UUID and processing lease;
- a cleanup row ID and current worker token for completion or failure.

No browser role can execute these RPCs.

## Tables and lineage

| Table | Purpose |
| --- | --- |
| `creator_growth_assets` | Private upload metadata and owner/thread-scoped object path |
| `creator_growth_media_sources` | Official, public-image, or creator-upload provenance |
| `creator_growth_consents` | Processor consent and optional connection generation |
| `creator_growth_analyses` | Task 3 result with mandatory asset and binding lineage |
| `creator_growth_skill_invocations` | Task 4 report with mandatory analysis lineage |
| `creator_growth_skill_sources` | Owner/thread-safe canonical media-source links for a skill |
| `creator_growth_drafts` | Revisioned private draft, scrubbed revocation tombstone, or cascaded derived chain |
| `creator_growth_events` | Sanitized operation and retention events |
| `creator_growth_storage_cleanup` | Durable physical-delete queue and leases |
| `creator_growth_commands` | Minimal mutation idempotency receipts and expiry |
| `creator_growth_route_commands` | Private first-write preparation for a complete route command; caller hash, original time, lineage bindings, bounded plan and invalidation/expiry |

Composite owner keys and foreign keys enforce the workspace/creator pair across
the creator, Studio thread, asset, media source, consent, analysis, skill, draft,
and integration connection. Additional four-column relationships require the
asset, media source, analysis, skill, and draft to remain in the same thread.

`asset_id` is mandatory on analyses. SQL verifies the binding asset ID, SHA-256,
source kind, fixture ID, uploaded state, and thread against the stored asset.
`analysis_id` is mandatory on skill invocations. Analysis, skill, and draft
commands verify their complete linked chain rather than trusting browser or
model IDs.

Skill invocations also require `mediaSourceIds`, limited to 12 unique UUIDs.
Every ID must resolve to an active same-owner/same-thread source; any source with
an asset ID must match the canonical analysis asset. Official sources must retain
their current authorized generation. Public-image evidence must be public and
matched. The linked IDs are persisted in `creator_growth_skill_sources`.

The report observation and self-upload/public-image provenance must match the
canonical asset ID, digest, and source kind. Official provenance, metric periods,
citations, and result refs must resolve to listed official sources. Public-image
claims must resolve to a listed public mock; self-upload claims must use
`asset:<asset-id>`. Duplicate claims, missing citations, cross-owner/thread IDs,
and revocation-relevant result refs absent from canonical citations fail closed.
Native `native:` and curated `curated:` result refs remain allowed.

Observation shape and required field types are checked before comparison, using
`IS DISTINCT FROM` for asset identity. `observation.sampleOnly` must equal the
stored asset. The report and result sample flags must equal the OR of the asset
sample flag and all linked source sample flags. The claimed source set is derived
from citations, official/public provenance, available or valued metrics, periods,
and result refs, and must exactly equal `mediaSourceIds`.

The entire report observation must equal the stored normalized Task 3
observation extended with canonical `sourceKind`, `assetId`, and `sha256`.
Availability, reason, objects, visible text, composition, caption alignment,
uncertainties, sample status, and any future stored observation fields therefore
reject alteration, omission, or extras.

Official and public citations/provenance additionally compare `sampleOnly` and
`observedAt` with the referenced media-source row. Client formatting differences
are normalized by timestamptz comparison rather than raw string comparison.

An attached media source must grant `allowed` rights. `creator_upload` sources
must use the same uploaded owner asset; `public_image_mock` and
`official_instagram` sources must have `public` visibility and `matched` status.
Official sources must also retain their current authorized connection/generation.
An attached consent must use the same processor identifier as the analysis.

Draft analysis and skill relationships use composite FKs that include the
faithful asset and analysis IDs. Derived drafts cascade-delete when their
upstream analysis or skill is deleted. Internal revision of a derived draft is
therefore impossible without the complete chain.

An analysis may carry direct connection/generation lineage and also derive or
match lineage from its media source and consent. The SQL rejects conflicting
lineage. The canonical integration-generation revoke trigger therefore
invalidates analyses reached through the media source, consent, or direct
connection link, then invalidates every skill and draft reached from those
analyses. The skill-source junction is also checked directly, so revoking a
linked evidence source invalidates the skill even when its analysis remains
active under another generation.

No growth table has a `bytea` column. Image bytes belong only in private Storage.
Safe exports omit Storage paths, credentials, and bytes.

## RLS and grants

- RLS is enabled on all eleven growth tables.
- No RLS policies are installed.
- `PUBLIC`, `anon`, `authenticated`, and `service_role` have no direct table
  privileges.
- Ordinary reviewed mutation/read wrappers are executable only by
  `service_role`; their owner checks remain explicit.
- Maintenance wrappers are separately service-only and are the only operations
  allowed after creator deletion.
- All `SECURITY DEFINER` functions pin `search_path=''`; helper execution is
  revoked from browser roles and `service_role`.

Both `creator_growth_commands` and `creator_growth_route_commands` are included
in the RLS/default-deny catalog test. The new service-only
`public.creator_growth_route_command(uuid,uuid,uuid,jsonb,jsonb)` RPC pins an
empty search path, locks/checks the active owner, checks the same-owner thread,
then rechecks original asset/analysis/source/connection bindings. Service-role
access does not bypass those checks.

## Storage

- Bucket: `creator-growth-private`.
- Visibility: private.
- Limit: 8 MiB.
- MIME allowlist: JPEG, PNG, WebP.
- No browser Storage policy is added.
- Object paths are generated by SQL as
  `workspace_id/creator_id/thread_id/asset_id.extension`.
- The Supabase adapter independently checks the exact owner prefix and generated
  filename before upload or read.

The adapter reserves metadata before writing bytes and confirms after the write.
Abandonment queues cleanup at `greatest(clock_timestamp(), asset.expires_at)` so
a Storage request racing with metadata deletion cannot recreate an untracked
object after an earlier cleanup pass.

## Receipts and idempotency

Every mutation receives a server-derived
`GrowthMutationContext={idempotencyKey}`. The same key must be reused across
retries and cannot be replaced by nested payload fields. Owner IDs and request
IDs are applied after command values when the adapter builds RPC arguments.

The Supabase adapter derives stable UUID sub-operation IDs for reserve, confirm,
and abandon. Memory and SQL receipts compare the action and payload hash but do
not retain the payload or full result.

On replay:

- assets, sources, consents, analyses, skills, drafts, and events are reloaded by
  owner and entity ID;
- revoked or invalidated sources raise `SOURCE_INVALIDATED`;
- receipts at or beyond 90 days raise `IDEMPOTENCY_EXPIRED`;
- retention deletes expired receipts;
- connected-entity receipts are deleted during generation invalidation.

Draft revision checks remain mandatory and are not replaced by idempotency.

### Protected route preparations (Task 7 fix round 1)

`creator_growth_route_commands` reserves `(workspace_id, creator_id, request_id)`
for one operation, thread and SHA-256 of the complete validated caller command.
Only the hash and canonical identity bindings are retained from that command;
raw request JSON is not retained. Original `started_at` is returned before
regenerating metadata. A transaction advisory lock plus row locking makes the
first preparation immutable under concurrent retries. Changed complete commands
conflict; a fresh adapter reads the same durable preparation.

The separate `plan` column is null or an object of at most 262,144 bytes. It
contains server-produced inputs needed to resume media-source writes,
consent/analysis writes or a skill invocation. This can include safe report and
proposal text, normalized observation, source timestamps and canonical media
references. It must be treated as private content. It contains no image bytes,
raw nonce/session credentials, client-authored report facts or provider tokens.
Owner exports and route DTOs never expose the plan or its ledger. The original
minimal mutation receipt `result_hint` remains bounded to 512 bytes; no report
JSON was added to that receipt table.

Both new and replayed operations check current owner/revocation state. Completed
analysis/skill replies reload the original canonical result; partial operations
reuse their stored preparation and stable sub-operation IDs. A plan is neither
a new integration grant nor any authority to publish.

## Revocation and purge

Generation revocation:

1. The existing integration transaction validates and locks the current
   generation.
2. It increments `generation` exactly once and sets `status='revoked'`.
3. The additive trigger invokes the growth invalidation helper with the old
   generation.
4. Media sources and consents are revoked.
5. Analyses matched by media source, consent, or direct generation are
   invalidated.
6. Skills are invalidated when reached through an invalidated analysis or a
   junction link to any invalidated media source.
7. Dependent drafts become content-free tombstones with both
   `invalidated_at` and `terminal_at` set.
8. Affected minimal mutation receipts are deleted.
9. Route preparations reached by direct generation, selected source IDs or an
   invalidated analysis are scrubbed (`plan=NULL`) and marked invalidated in
   the same canonical revoke transaction. Their tombstones cannot replay or
   prepare new content.

Independent creator-upload bytes and drafts remain available.
`creator_growth_command` rejects the former `revoke_generation` action, the
public wrapper is absent, and no service-role grant exists.

Owner purge:

- works from `active` or `suspended`;
- locks and validates the exact owner;
- queues every private object path before deleting metadata;
- deletes protected route preparations as well as source metadata and counts only rows actually deleted;
- leaves queued physical cleanup intact;
- does not modify the integration connection;
- does not mutate points, balances, XP, rewards, missions, or submissions.

An account `status='deleted'` transition invokes the same purge helper before the
row update completes. A hard creator delete queues each growth asset from a
`BEFORE DELETE` trigger before cascade removal. The cleanup outbox has no creator
foreign key, so these rows survive account deletion.

## Retention

- Assets without a live private/completed/cancelled draft reference are queued
  once their 24-hour reservation expires.
- Completed, cancelled, and invalidated drafts are removed at 30 days from their
  terminal timestamp.
- Invalidated draft content is scrubbed immediately and does not pin assets.
- A derived draft is deleted when its upstream asset/analysis/skill is removed;
  such deletions are included in the retention delete count.
- Events are deleted only when created strictly before the 90-day boundary.
- Minimal mutation receipts are deleted at or beyond their 90-day expiry.
- Protected route preparations also expire after 90 days. Retention removes
  expired preparation rows; when a linked asset or analysis has been removed,
  it scrubs the plan in the same sweep, after asset cleanup, and retains an
  invalidation tombstone until expiry.
  Canonical generation revocation scrubs immediately. Explicit owner purge and
  account deletion remove preparation rows; the composite thread FK cascades
  on thread deletion. The metadata purge count includes these rows. Preparation
  expiry is distinct from the existing `receiptsDeleted` mutation-receipt count.
- Cleanup rows and completed deletion receipts are independent of source
  metadata.

Queue counters increment only when the `ON CONFLICT` insert actually creates a
row. Retention and purge deletion counters use PostgreSQL row diagnostics.

## Physical cleanup worker

`creator_growth_storage_cleanup` records:

- `state`: `queued`, `processing`, `completed`, or `exhausted`;
- `available_at`;
- `attempts` and `max_attempts`;
- `lease_token` and `lease_expires_at`;
- `last_error`;
- completion time.

The claim RPC uses `FOR UPDATE SKIP LOCKED`, claims only available queued rows or
expired processing leases, increments attempts, and assigns a worker lease. The
memory repository applies the same queued-or-expired-processing claim predicate.
finish RPC requires the exact owner, cleanup UUID, object path, and worker token.
A failure returns the row to `queued` with bounded exponential backoff until the
maximum attempt count, then records terminal `exhausted`.

Only a successful Storage adapter removal completes the queue row. Database
metadata deletion never claims that physical bytes or backups were erased.

## Index and duplicate review

A fresh offline PGlite catalog inspection of this exact migration found **11
private tables and 66 indexes**: 40 explicit secondary indexes, 11 primary-key
indexes and 15 other constraint/unique indexes. Task 7 adds one table and three
indexes to the previous 10-table/63-index schema:

| New index | Exact key | Purpose |
| --- | --- | --- |
| `creator_growth_route_commands_pkey` | `(workspace_id, creator_id, request_id)` UNIQUE | Complete caller-command lookup and uniqueness |
| `creator_growth_route_commands_thread` | `(thread_id, workspace_id, creator_id)` | Exact composite Studio-thread FK prefix and cascade |
| `creator_growth_route_commands_expiry` | `(workspace_id, creator_id, expires_at)` | Owner-scoped expiration |

The primary key does not provide a `thread_id`-first FK path or an expiry range;
the secondary indexes therefore do not duplicate it or each other. The full
catalog is retained in the Task 7 fix packet's `task-7-fix-1-results/index-catalog.json`.

The PGlite catalog test derives every foreign-key child column list and compares
it against index leftmost prefixes. It found no missing FK-prefix index.

Access paths include:

- `(workspace_id, creator_id, thread_id, created_at desc)` for owner/thread reads;
- `(workspace_id, creator_id, expires_at)` for asset retention;
- `(workspace_id, creator_id, status, terminal_at)` for draft retention;
- `(workspace_id, creator_id, created_at)` for event retention;
- `(workspace_id, creator_id, expires_at)` for command expiry;
- `(workspace_id, creator_id, state, available_at, id)` for cleanup claims;
- `(workspace_id, creator_id, media_source_id, skill_id)` for linked-source
  revocation lookup;
- exact `(skill_id, ...)` and `(media_source_id, ...)` prefixes for junction FK
  cascades;
- exact composite-FK child-column prefixes, including same-thread relationships.

Primary-key and owner-first indexes are not treated as substitutes for composite
FK support. No exact duplicate index definition exists. Existing Studio,
integration, D1, and release indexes were not changed.

## Backup and rollback

Before any later approved application:

1. Record the exact project reference, database host fingerprint, migration
   list, and schema checksum.
2. Create or identify a recoverable point immediately before migration.
3. Record non-test row counts for `workspaces`, `creators`, `studio_threads`,
   `integration_connections`, `point_transactions`, `creator_scores`, `missions`,
   `mission_submissions`, and `mission_pending_rewards`.
4. Apply only to a separately approved disposable target.
5. Compare existing-table schemas and row counts after application.
6. Restore from the recorded point if validation fails.

The executable whole-growth rollback is [creator-growth.rollback.sql](creator-growth.rollback.sql).
Its SHA-256 is `61c65aed95ca6ebb523bbf8ee91e01ab3543bc0c4b60d3e7524f0585b66d30cd`.
This is offline preparation only; **shared-target live backup and native restore
remain BLOCKED**. No migration, runtime, remote or persistent database was changed.

Required order and exact removal scope:

1. Quiesce growth/publication routes, uploaders and cleanup workers. Preserve the
   backup and unresolved publication/consumption evidence. A rollback cannot
   resolve an unknown provider outcome or authorize a second POST. Complete the
   separately reviewed [publication rollback](instagram-publish-sql-review.md)
   first; the growth script refuses any remaining `creator_publish_` relation,
   function or trigger, including a partially removed installation.
2. The file is one atomic `DO` statement. It can execute unchanged in autocommit or
   inside a caller transaction/savepoint and does not commit that transaction.
   It takes explicit table locks with a five-second lock timeout, restores the
   prior timeout on success, and fails on missing/drifted required objects. It is
   deliberately not an idempotent teardown. Locks fence database writes during
   checks/removal; they do not fence an external Storage upload. Quiescence and
   independent native concurrency/restore verification are still required.
3. Before mutation it requires the exact private bucket configuration, no rows in
   `storage.objects` for `creator-growth-private`, and no unfinished cleanup.
   `queued`, `processing`, `exhausted`, and `completed` without a completion time
   all refuse. Only completed receipts with timestamps may be removed when the
   bucket is empty. Drain unfinished physical cleanup through a separately
   approved cleanup process; this script never deletes Storage objects.
4. Explicitly named drops remove the three growth triggers, 20 public growth
   RPCs/wrappers (including protected route-plan preparation), 19 private growth
   helpers, then all 11 growth tables in dependency order. Their 66 indexes,
   table constraints, composite types and object-specific grants disappear with
   the owned objects. Protected route plans and minimal mutation receipts are
   both removed; neither is left callable. The empty `creator-growth-private`
   bucket row is **always retained**, whether the forward migration created it
   or reused it. `ON CONFLICT DO NOTHING` permits reuse, so matching configuration
   cannot prove origin. There is no delete option or caller/config flag. No shared
   schema, prerequisite function, Storage policy, existing table or bucket is
   dropped. There is no `CASCADE`, dynamic drop construction or broad object
   deletion; an unexpected dependency aborts the entire statement.
5. Any later exact bucket removal is a separate action requiring verified
   pre-migration provenance proving creation (rather than reuse) and explicit
   approval for that exact bucket/target, with fresh emptiness/cleanup checks.
   Absent that provenance or approval, retain it. This generic rollback never
   removes the bucket and provides no executable separate-removal path.

The new focused [rollback test](../../../server/test/creator-growth-rollback.test.ts)
executes the exact file body in disposable `memory://` PGlite after the current
unmodified growth/publication migrations. I1 reproduction: **4 failed / 9 passed**;
with unconditional bucket retention: **13 PASS**, scoped lint exit 0. The original
12-case preparation is historical evidence superseded by this fix. It checks
publication ordering/partial installation refusal, unchanged bucket/cleanup guards,
unexpected-dependency atomic refusal, all prerequisite schema/function/ACL/index/
trigger/policy definitions and fixture rows, and restoration of the removed
objects plus retained growth plans/receipts by `ROLLBACK TO SAVEPOINT`. Existing
Studio/integration migrations and the existing integration fixture are used;
Storage is a synthetic schema fixture. For a newly created bucket, tests allow
exactly its retained row beyond the prerequisite baseline; all other fixture rows
and catalog objects must match. A separate actual pre-existing matching bucket is
inserted before the real migration, with an old creation-time sentinel and
nondefault schema/table/column grants. The exact-script test proves the migration
reuses that row and rollback preserves the full before-state, ACLs and policy.
Point/XP ledger and badge sentinels are fixture preservation evidence, not live
rewards, Auth, Storage deletion or native backup restoration. Current fix evidence,
LF-normalized diff and file hashes are in
`.superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/creator-growth-rollback-fix-1-*`;
the earlier package remains historical, and independent re-review is required.

A rollback of ONLY the Task 7 extension must also atomically restore the
pre-fix definitions of `private.creator_growth_purge_private`,
`private.creator_growth_invalidate_generation` and `public.creator_growth_command`
from the snapshotted unapplied migration: these now reference protected plans
for purge, revocation and retention. Dropping only the new table would leave
those functions broken. Preserve the existing canonical integration/creator
triggers for a Task-7-only rollback; remove them only for whole-growth rollback.
The byte-exact pre-fix migration is in `task-7-before-fix-1/`. The new whole-growth
script does not implement a partial Task-7-only rollback. No persistent SQL
application or persistent rollback has been performed.

Rollback does not prove that Storage bytes or backups were erased, recover lost
historical rows after commit, or clear the missing shared-target live backup /
native restore gate.

## Historical Task 6 local evidence (not recertified by this section)

Focused RED before fix implementation:

```text
npx vitest run server/lib/creatorGrowth/repository.test.ts server/test/creator-growth-schema.test.ts --reporter=verbose
Test Files  2 failed (2)
Tests       18 failed | 21 passed (39)
```

Round 2 fix RED:

```text
Test Files  2 failed (2)
Tests       10 failed | 39 passed (49)
```

Round 3 fix RED:

```text
Test Files  2 failed (2)
Tests       14 failed | 47 passed (61)
```

Round 4 test-first RED group:

```text
New failing cases  8
Existing passes   66
Total focused     74
```

Round 5 test-first RED group:

```text
New failing cases  4
Existing passes   74
Total focused     78
```

Focused GREEN:

```text
npx vitest run server/lib/creatorGrowth/repository.test.ts server/test/creator-growth-schema.test.ts
PASS 78 / FAIL 0
```

Studio/integration regression:

```text
npx vitest run server/lib/creatorGrowth/repository.test.ts server/test/creator-growth-schema.test.ts server/test/studio.embedded.test.ts server/test/integrations-sql.test.ts
PASS 138 / FAIL 0
```

Additional checks:

```text
npx tsc --noEmit
npx eslint <Task 6 source and tests>
npm run check:esm
npm run build
npx vitest run scripts/creator-growth-bundle-boundary.test.ts
```

All passed. The build retains the unrelated pre-existing warning that
`src/routes/_site.smoke.test.tsx` does not export a `Route`.

## Task 7 fix round 1 current local evidence

- Focused routes/client: **67 passed** (65 route, 2 client).
- Growth modules plus PGlite schema: **276 passed**, including 56 independently
  controller-owned publish-policy tests; those policy files were not edited.
- Studio/integration UI and API regressions: **32 passed**.
- Current schema suite: **46 passed**; repository suite: **38 passed**. Fresh
  `SupabaseGrowthRepository` instances invoke the real preparation RPC against
  PGlite, including owner denial, immutable preparation/time, changed command,
  expiry, source/direct canonical revoke, purge and catalog checks.
- TypeScript, focused ESLint and ESM checks: exit 0.
- A fresh catalog-only PGlite instance verified the 11-table/66-index counts and
  was closed after the inspection. No persistent data or remote SQL was used.

The complete RED/GREEN commands, exact output logs, before/after hashes and
LF-normalized scoped diff are in the Task 7 fix packet. The preparation table
is not live Auth/RLS, durable hosted PostgreSQL, Storage or provider acceptance.
The production route factory still has no dependencies and remains disabled.

## Remaining pre-live checks

- Independent DDL review against the exact applied migration set.
- Supabase changelog/breaking-change review when a live application is proposed.
- Live advisors and PostgreSQL planner inspection on an approved disposable
  target.
- Auth/workspace token validation through guarded Task 7 routes.
- Real Storage role behavior, concurrent worker execution, and delete receipts.
- Backup restore drill and account-deletion integration on the approved target.

