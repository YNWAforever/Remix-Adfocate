# Controlled pilot SQL review — partial draft

Status: local PGlite only. Neither SQL file is a registered migration or an
approved remote execution packet. No remote database was read or changed.

## Current draft scope

`changes.sql` adds one private worker-checkpoint table referencing the original
publish intent through `(intent_id, workspace_id, creator_id)`. Original mission,
reward, integration, approval and publish-intent objects remain unchanged.
This is not a second publication state machine. An ambiguous `before_create`
or `before_publish` checkpoint remains a hold, including after worker restart. A `media_known` checkpoint stores a returned media ID before receipt reads and allows at most five persisted recovery claims, at least 60 seconds apart. Recovery does not publish.

Only the trusted server role receives SELECT/INSERT/UPDATE; it receives no DELETE.
Public, anon and authenticated have no grants, and RLS is enabled without browser
policies. The server still checks active creator ownership through the existing
repository before enqueue/claim. No connection string or executable scheduler is
provided. Service-role privilege is not creator consent.

## Index inventory

| Object | Purpose | Review |
| --- | --- | --- |
| controlled_pilot_jobs_pkey (intent_id) | One job per intent; exact lookup and parent-deletion lookup | Do not add another intent_id index. |
| controlled_pilot_jobs_pending (lease_until, intent_id), partial | Nonterminal lease eligibility | Different predicate/order from PK; candidate for query-plan validation at representative volume. |
| creator_publish_intents owner unique key | Composite FK parent | Reuse original index; no duplicate parent index. |

No existing index is dropped. Local correctness tests are not a production
query-plan or scale assessment. The pending index does not itself guarantee a
sort-free SKIP LOCKED claim; measure before live readiness.

## Compatibility and remaining work

Existing rows need no backfill and receive no automatic job. Enqueue currently
requires a sample-only, creator-approved intent. Original legacy binding and RPC
remain unchanged. Fixture product/app and immutable approved-version bindings now have memory/PGlite tests, including same-version app-retarget denial. The PGlite helper retains reservation tombstones without fabricating growth drafts. Authoritative production source SQL and full parity remain pending Task 4 work. Do not deploy this partial draft as a complete
pilot schema or manufacture a private growth draft to bypass that work.

## Rollback and retention

1. Keep runtime disabled; stop and drain all workers.
2. Obtain the separately approved target-bound restore point and export inventory.
3. Reconcile jobs with any possible external write. Preserve unknown tombstones;
   a local rollback cannot delete a provider's accepted publication.
4. Review an explicit cleanup manifest separately. No automatic DELETE is supplied.
5. `rollback.sql` takes an exclusive lock and refuses if **any** job remains.
   Only an empty new table can be dropped, without CASCADE. Its own indexes drop
   with it; original intents and all authoritative workflows remain.
6. Verify original object inventory, intent counts, grants and application behavior
   against the approved prechange snapshot. Re-enable nothing automatically.

Local tests cover owner-consistent FK denial, browser role denial, lease fencing,
restart with an ambiguous publish, refusal of a nonempty rollback and preservation
of the original intent when removing the empty extension. They do not prove a
remote restore point, live RLS/Auth behavior or real provider acceptance.
