# Shared-database dependency analysis — preparation only

**Reduced compatibility-preserving review selection: 54 later migration source files, plus only public.apply_mission(uuid) from 0017_social_verification.sql (lines 93–143).** Of all 92 files, 30 are baseline-represented/already satisfied, 55 contribute a required change (including that partial baseline repair), and 7 are excluded from the reduced selection. This is a local source analysis, not an executable approval or a claim that all 62 manifest entries are pending.

**Baseline drift comes first.** The 39 observed tables already represent all 39 baseline table definitions, despite only 14 timestamped history rows. All parsed baseline added-column/index/named-constraint names exist. Of 40 captured functions, 38 match their latest local baseline body; apply_mission still matches 0010, omitting the 0017 level/social-verification gate, and rls_auto_enable is a live-only DDL helper. Table/default ACLs are broader than the source assumes. Applying the 62 later entries alone would not resolve these gaps.

The parent owns catalog extraction, forward/rollback SQL, fixture SQL and final execution gates. This sidecar writes only this Markdown file and dependency-analysis.json. No remote calls, database connections, SQL execution, tests, app/migration changes, commits, resets or deployment were performed. Existing D1 work is retained.

## Source-bound baseline

| Item | Evidence |
| --- | --- |
| Target | Existing Remix-Adfocate `mhkoayftiuojxlrkollf` |
| Workspace | `C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate` |
| Branch / HEAD | `codex/kocmax-studio-stages-1-2` / `5c60020091e8e6fee934b61c498bf7518944c433` |
| Catalog capture | `2026-10-31T14:34:38.298153+00:00`, PostgreSQL 17.6; metadata only, no application rows |
| Counts | 39 tables; 400 columns; 105 indexes; 183 constraints; 54 policies; 40 functions; 14 triggers; 14 history rows |
| Catalog SHA-256 | `bdd3191e3e3e7d31d6228895718d29de4d8ef6dccd32c0caf0affffb71d3c5dd` |
| Definitions SHA-256 | `77194248a2fa559c79457f4d33dba417e0599ed9c6f271e0b29c4215bd1e7539`; all 40 captured definition MD5s verified locally |
| Release manifest SHA-256 (raw file) | `d05efb4d5e2061c3a62e3f06613fca8c8f9486419a5ce3bb9236853efcdd4394`; all 62 migration hashes match normalized source bytes |

SQL discovery used targeted local reads because SQL is excluded from the indexed kocmax-studio graph. The graph was consulted for release/helper and application entry points; unavailable symbol coverage was followed by targeted reads. The analysis lexically separates 1,407 top-level statements, keeping dollar-quoted function bodies and DO blocks intact. The JSON records exact file versions, paths, full raw and LF-normalized SHA-256 values, statement line ranges/hashes/effects, object observations, dependency symbols, rollback limits and final-writer requirements.

## Minimal dependency closure and why it differs from the manifest

The five target files must remain ordered:

`20261030195424` → `20261031120000` → `20261031121000` → `20261031122000` → `20261031123000`.

The first file needs actual workflow/work-item and pending-reward tables, the canonical draft-save routine, assistant request persistence, deletion/consent semantics and private history permissions. Integration evidence then changes Studio source keys and wraps the existing Studio routine; privacy wraps shared assistant save/read; pilot persistence wraps the preceding integration dispatcher. Installing only the five files cannot work on the observed catalog.

| Dependency | Required source/effect |
| --- | --- |
| `20261030195424`: public.workspaces, public.creators, public.missions, public.mission_submissions, public.point_transactions, public.assistant_conversations, public.assistant_messages | observed baseline; ACL/function drift is separately gated |
| `20261030195424`: public.mission_workflows, public.mission_work_items | 20260715163350 and subsequent workflow/proof schema evolution |
| `20261030195424`: private.save_active_mission_draft | 20260720033542; normal runtime also needs workflow refresh, revision, proof and reward families |
| `20261030195424`: public.mission_pending_rewards | 20260731100000 installation; 20261029130000 normal settled-badge behavior |
| `20261030195424`: public.assistant_requests, message request_id/turn_order, claim CAS, read-only history, KB tenant policies, deleted creator status/consent | 20261022171843, 20261029000000, 20261029150000, 20261029160000, 20261029170000, 20261029180000 |
| `20261031120000`: public.creators(id,workspace_id), public.studio_sources | baseline creators + source adds unique constraint; prior Studio required by runtime invalidation |
| `20261031121000`: public.integration_connections, public.integration_resources, public.integration_snapshots, public.studio_sources, public.studio_shares, public.studio_command | 20261031120000 + 20261030195424; order-sensitive FK/rename |
| `20261031122000`: private.integration_foundation_command, private.integration_evidence_command, private.integration_use_permits, public.save_assistant_turn, public.get_assistant_request | 20261031120000, 20261031121000, 20261030195424, 20261022171843 |
| `20261031123000`: private.integration_credentials, private.integration_oauth_states, private.integration_invalidate_sources, private.integration_purge, public.integration_command, public.studio_sources | the preceding three integration files plus Studio |

The declared final-pilot closure has **50** entries. It omits **12** later manifest entries. Eleven contribute retained fixes outside that declared closure; the remaining application-decisions predecessor is fully replaced by 20261029120000. In particular, settlement is needed for a reachable settled-badge path, and KB workspace policies are needed for assistant privacy. Metadata dependsOn is an ordering convention, not a complete semantic dependency graph.

The reduced selection omits these eight entries from the 62-entry later inventory:

| Version | Reason | Replacement / treatment |
| --- | --- | --- |
| `20260719220000` | Installs only the explicit pristine-legacy-submission conversion RPC; normal new-workflow fixture does not call it. No top-level conversion. | Definition installation is optional; do not invoke rollout actions. |
| `20260720175319` | Only service_role SELECT grants on workspace_budgets and workspace_budget_transactions. Catalog already has service_role=arwdDxtm on both: no schema delta. | Observed service-role SELECT grants already satisfy it. |
| `20260725110000` | Only two routine definitions; final private create-asset body is supplied by 20260725140000 and public create-asset body by 20260728135000. No table, data, ACL or retained unique effect. | `20260725140000`, `20260728135000` |
| `20260725143000` | Only public create/finalize wrappers; final create comes from 20260728135000, final finalize from 20260725150000. No top-level DML. | `20260725150000`, `20260728135000` |
| `20260727130000` | Installs only explicit setup for already-existing publication work items. New fixture authoring snapshots instructions normally. No top-level setup. | Definition installation is optional; do not invoke rollout actions. |
| `20260731150000` | Defines service-only enable_pilot_if_empty; DOES NOT automatically enable anything. Omitted from minimal normal-workflow schema, retained as optional compatibility capability in the full manifest. Invoking it is separately excluded. | Definition installation is optional; do not invoke rollout actions. |
| `20261022182544` | Reviewer-notes correction routine and its grants are fully superseded by 20261028140709 then 20261029140000; retain those final definitions and ACLs. | `20261028140709`, `20261029140000` |
| `20261025120934` | Application decision routine and ACLs are supplied completely by 20261029120000, including reward-contract capture. No independent table or column effect. | `20261029120000` |

**enable_pilot_if_empty is not auto-execution.** Its file defines a service-only RPC and grants execution; no mission is changed by installing it. A later call locks the selected mission and conditionally changes creator_workflow_mode. scripts/release/pilot.ts:294 is the separate invocation path. Keeping that file in a larger exact ordered review bundle is permissible preparation; calling it remains excluded. The same distinction applies to pristine conversion, existing-publication setup, reward-contract backfill, staff bootstrap and settlement routines.

Minimal here means the whole-file reduction justified by already-observed grants, full supersession and optional rollout helpers while retaining the current branch workflow and later bugfix surface. Academy conflict/approval-index fixes and redemption replay remain in the compatibility overlay; they are not direct Studio foreign-key dependencies. A smaller statement-only composition requires separate equivalence analysis by the parent. No runtime validation of this reduced selection has been performed.

Do not mark omitted versions applied, rewrite the 14 live history rows, or run the unchanged full-manifest runner with a reduced history. scripts/release/manifest.ts validates the complete reviewed inventory and hashes; currentReleaseCapabilities gives later explicit requirements precedence. The parent can retain all 62 as a larger canonical review envelope, but must still address baseline drift and distinguish reviewed source from actual executed/history-recorded statements.

## Baseline drift requiring a parent packet decision

### B01 — Baseline is represented but not identical

- 39 of 39 baseline CREATE TABLE names and all parsed baseline ADD COLUMN/index/named ADD CONSTRAINT names are present.
- 38 observed functions match their latest local baseline body after LF normalization and trimming only leading/trailing body whitespace.
- public.apply_mission matches 0010 instead of 0017; public.rls_auto_enable is a live DDL helper outside local migrations.

Do not replay baseline files, rewrite remote history or claim catalog-wide equivalence. **Required:** Extract only final apply_mission definition from 0017 with current signature/ACL precondition. Preserve live rls_auto_enable and provider event triggers.

### B02 — Broad table ACL drift overrides intended column restrictions

- Catalog creators, missions, CRM tables and assistant history have anon/authenticated/service_role table-wide arwdDxtm grants.
- 0004 only adds profile column grants; it does not remove existing table-wide UPDATE.
- 20261029100000 revokes mission column UPDATE(status,published_at,closed_at), but table-wide UPDATE is still present unless separately revoked.

Current table ACLs cannot be treated as the intended baseline; applying all 62 files alone does not prove authorization repair. **Required:** Parent packet needs a deliberate effective-grant reconciliation for affected existing tables, preserving supported profile/brand paths; freeze new writes until reviewed. Use actual per-column ACL metadata before emitting exact column grants.

### B03 — Schema/default ACL changes are database-wide

- 20260715163350 revokes authenticated private-schema USAGE and alters global/private default function privileges.
- Catalog has broad public-schema default table/function grants for two owners; global default revoke does not remove explicit public-schema default additions.
- Catalog does not capture column ACLs, relation/function owners or full role memberships.

Feature flags/workspace boundaries do not isolate these schema changes; final ACLs need evaluation for the execution owner and existing callers. **Required:** Explicit effective ACL assertions after each family and final state, with existing private-helper profile/RLS regression cases; do not blanket restore default ACLs as rollback.

### B04 — Manifest closure omits later behavior and privacy fixes

- Declared closure of the final pilot is 50 entries.
- Twelve manifest entries are outside that closure, including settlement, KB scope, legacy XP/evidence and browser ACL hardening.

A literal dependsOn traversal is insufficient for normal current-branch workflows. **Required:** Retain the final writers and added semantic edges listed in this report; the four superseded-only files can be omitted only if their replacements are included.

The baseline repair has exact source statement SHA-256 `da48e0fdd9cac4cdd6af323d2aee1dfa1b21826e0404805de6868d80212a33e1`; the observed apply_mission definition MD5 is `11d391e911a06316ffd8ba21360f67b5`. Extracting the one final definition preserves the already-present columns/index and avoids reinstalling old join_mission. The parent should preserve the observed signature/ACL deliberately, rather than infer grants from body equivalence.

The captured definitions also confirm later base features absent from history names: staff, brand access/budget, campaigns, rank snapshots, resource audience and Academy content. History-name correspondence is recorded in JSON as lineage evidence only, not checksum equivalence.

## Immediate SQL effects, backfills and activation

| Source | Top-level effect | Shared-target treatment |
| --- | --- | --- |
| 0003:14–16 | Backfill referral codes for existing creators | Baseline already represented; exclude replay. |
| 0007:40–42 | Insert earnings balance rows for existing creators | Exclude replay; no whole-product balance bootstrap. |
| 0008:37–38 | Recompute levels and reset level_seen | Exclude replay. Existing level-notification trigger can make updates observable. |
| 0015:4–16; 0021:108–115; 0028:49–158 | Avatar/content buckets and content/Academy seeds | Exclude baseline replay; table presence does not prove seed equality or authorize reseeding. |
| 20260715163350:631–642 | Upsert private draft bucket metadata | New scoped Storage capture has neither asset bucket; reassert absence before execution and preserve avatar policies. |
| 20260723090000:288–299 | Upsert proof bucket metadata with earlier MIME contract | Intermediate mutation; final MIME source must win atomically. |
| 20260723170000:14–25 | Backfill proof-asset owner/workflow/submission/finalization fields | Expected zero only when table was created in the same guarded transaction with no intervening writer. Existing nonempty proof table means stop/replan. |
| 20260729010000:18–42 | Upsert final proof bucket MIME contract | Preserve final source and preflight bucket collision. |
| Five target files | No top-level application-row DML; DDL/ACL/functions/triggers and DO ACL loops | Creates no credentials, active bindings, consents, staff memberships, rewards or account deletions. |

All seven reviewed DO blocks perform DDL/ACL work or metadata assertions; none backfill application data. Function-body INSERT/UPDATE/DELETE is deferred until a routine or trigger executes. Adding defaulted columns and validating/replacing constraints can still touch or scan shared tables.

creator_workflow_mode defaults to legacy; Studio public_preview_enabled defaults to false. No existing mission is opted into active workflow by those defaults. Pilot bindings default inactive, and the migration inserts none. Provider enablement remains a separate application authorization concern.

## Shared routines and triggers that must survive

| Final routine / retained body | Required version | Why |
| --- | --- | --- |
| `public.apply_mission` | `0017` | Observed legacy body drift; extract this routine only. |
| `private.author_mission_workflow_phase2` | `20260718210000` | Original author body renamed by 20260723090000; preserve alongside wrapper. |
| `private.save_active_mission_draft` | `20260720033542` | Canonical Studio draft save; never substitute fixture stub in acceptance. |
| `private.refresh_mission_workflow_state` | `20260805120000` | Final proof-aware workflow refresh shared with reward handoff. |
| `public.join_mission` | `20260805120000` | Active/legacy routing and concurrency; observed body is older 0017. |
| `public.join_active_mission` | `20260805120000` | Final active join contract. |
| `public.submit_mission` | `20261028140231` | XP-once correction replay; observed body is older 0005. |
| `public.settle_campaign` | `20260805120000` | Budget enforcement; observed body is older 0025. |
| `public.create_publication_proof_asset` | `20260728135000` | Latest public path regex. |
| `public.finalize_publication_proof_asset` | `20260725150000` | Final public lifecycle/idempotency wrapper. |
| `public.decide_mission_application` | `20261029120000` | Must include same-transaction reward contract and scoped role authorization. |
| `private.guard_pending_reward_update` | `20261029130000` | Allows guarded settlement in addition to cancellation. |
| `public.request_legacy_evidence_correction` | `20261029140000` | Latest reviewer_notes, URL authority and correction notification behavior; ACL retained from 20261028140709. |
| `public.claim_assistant_request` | `20261029000000` | CAS on reserved state. |
| `public.studio_command` | `20261031121000` | Calls private.studio_command_stage3 from original 20261030195424. |
| `public.save_assistant_turn` | `20261031122000` | Calls private.save_assistant_turn_stage3, retaining Studio creator locking. |
| `public.get_assistant_request` | `20261031122000` | Calls private.get_assistant_request_stage3 from 20261022171843. |
| `public.integration_command` | `20261031123000` | Calls private.integration_command_stage4abc from 20261031122000. |

Preserve predecessor bodies moved to private.author_mission_workflow_phase2, private.studio_command_stage3, private.save_assistant_turn_stage3, private.get_assistant_request_stage3 and private.integration_command_stage4abc. A last-function-name-only filter loses these dependencies. Keep final grants, security-definer and search-path properties as well as bodies.

On creators, existing XP-to-level and level-notification triggers coexist with new before-status integration cleanup/tombstone triggers and after-status Studio cleanup. On mission_submissions, campaign progress and submission notifications coexist with evidence guards and badge projection. Workflow/item/fulfillment/event transitions can generate notifications and dedupe rows. Studio badge projection itself does not award XP or money, but the transitions that trigger it may already do so.

Account tombstones run before a creator becomes deleted; integration cleanup needs private lineage before Studio cleanup removes it. Same-event triggers are ordered by trigger name; preserve names, timing and the whole transaction. Pilot tombstones intentionally have no cascading FK so erasure fences can outlive deleted connections. Do not remove those fences as fixture cleanup.

Pilot dispatch takes shared transaction advisory lock 431230 before creator locking; grant invalidation can span owners sharing a provider grant key. This is a contention and ownership boundary, not a workspace-only guarantee. Keep those scenarios outside normal shared fixture exercise unless every affected identity is explicitly owned by the exercise.

## Locks, preflight and rollback feasibility

### D01 — Migration-time DML differs from installed routines

There is no automatic pilot enable, staff promotion, settlement, anonymization or provider connection at installation. Bucket metadata does change; the proof backfill is not a harmless routine definition.

- Only four later top-level DML statements exist: draft bucket upsert, initial proof bucket upsert, proof-asset backfill, final proof bucket MIME upsert.
- Seven DO blocks across all 92 files perform metadata/DDL checks/ACL loops; none execute application-row DML.
- The five Studio/integration files have no top-level application-row DML.

**Required:** Assert newly-created proof tables are still empty in the same transaction before backfill. New observed-storage.json reports both proposed bucket IDs absent; reassert this at execution and preserve the four avatar policies. Real Storage behavior remains untested.

### D02 — Shared workflow/account triggers activate on ordinary later writes

A normal fixture join, correction, approval or account-status update can create XP, notification, ledger or immutable audit side effects even if a provider flag is off.

- creators: existing level + notification triggers, verification trigger on social-account updates, new before-delete-status integration cleanup/tombstone and after-status Studio cleanup.
- mission_submissions: existing campaign/notification plus new evidence and Studio badge triggers.
- Workflow/event triggers emit fulfillment/revision/publication/reward notifications.

**Required:** Transaction-only fixture must include all created IDs and compare all affected families before unconditional ROLLBACK; no account anonymization/restore/purge on shared real rows.

### D03 — DDL locks and validations reach existing shared tables

Potential blocking/scans or failed validation; no application row counts, durations or lock waits were measured.

- ALTER TABLE and composite FKs/unique constraints touch creators, missions, submissions, notifications, workspaces, brand_users, assistant_messages, creator_review_statuses and redemptions.
- Unique indexes on existing ledgers validate mission_reward source_ref uniqueness.
- Brand nonnegative constraints are NOT VALID, but apply to every future updated/inserted row.
- Integration adds a second creator(id,workspace_id) unique key after workflow schema already adds one.

**Required:** Bound lock/statement timeouts and an owner-reviewed maintenance window. Assert no concurrent source drift. Prefer retaining redundant key over changing hash-bound source casually; parent may propose an equivalent key reuse only with independent review.

### R01 — Rollback is transactional or forward containment

A transaction boundary must be verified lexically; sending source files containing COMMIT inside BEGIN is not rollback isolation.

- CREATE/ALTER/DROP/ACL and fixture DML can be kept in an uncommitted reviewed SQL transaction; source files contain BEGIN/COMMIT markers.
- Private wrapper moves/renames, immutable ledgers/history and tombstones make global down-schema or old-function restore unsafe after committed use.

**Required:** Parent owns composited SQL: remove only parsed outer transaction-control statements, reject internal transaction/DO escape and run one final unconditional ROLLBACK for fixture exercise. No global down-schema, trigger disabling or old-function restore.

### R02 — Current D1 target gate rejects the existing product database

Prepared metadata or transaction-only design is not authorization to invoke the current pilot harness against this target.

- inspectPilotTarget excludes PRODUCT_SUPABASE_PROJECT_REF; this task targets that exact shared product.
- No remote calls, SQL, clients, tests or authorization changes were performed by this sidecar.

**Required:** Parent must retain the denial and author a separately reviewed bounded execution mode if later requested; no denylist removal/forged receipts.

### R03 — Observed DB has no pg_net/pg_cron or hooks catalogs

No observed DB network/cron/hook path is enabled in this capture. This does not inventory external Auth/API workers, hosted jobs, consumers or Storage service operations.

- Definitions metadata lists pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp and vector; optional cron and hooks catalogs are false.
- Seven enabled event triggers include ensure_rls and provider DDL-watch/access helpers; point_balances is published to supabase_realtime.

**Required:** Only exercise SQL in one rollback transaction with no SDK/provider/browser calls; transaction-bound notifications/realtime changes must not commit. Do not treat this metadata as a general no-egress guarantee.

The transaction-only fixture proposal is feasible as a bounded SQL exercise after later authorization. Merely wrapping concatenated source files in BEGIN is unsafe: many files contain COMMIT, which would commit the outer transaction. The parent must compose parsed non-transaction-control statements, hash the result, reject transaction escapes and end the fixture exercise with unconditional ROLLBACK. Database role/JWT-claim simulation inside that transaction is not real Auth, browser, Storage or provider acceptance.

After a schema installation is separately approved and committed, a fixture rollback does not reverse it. Preserve additive schema, final corrected shared functions, permission boundaries, immutable audit/financial history and tombstones. Contain affected entry points and use a reviewed forward repair. Global down-schema, old-function restore, trigger disabling, blanket cleanup and shared backup restoration are excluded.

## Normal-workflow test prerequisites — not executed

### T01 — Target/source and transaction envelope

- Explicit later execution approval for mhkoayftiuojxlrkollf with exact file/delta hashes; fresh metadata drift preflight comparing catalog and all function/trigger definitions.
- Verify SQL execution identity, effective ACLs, source HEAD/dirty fingerprint, fresh absence of the two new asset buckets, existing avatar policy preservation and exact owners before opening a write transaction.
- Compose source statements without outer BEGIN/COMMIT, inspect SQL text for transaction escapes, set finite lock/statement timeouts, and end fixture exercise with unconditional ROLLBACK.

Expected: No committed fixture data or durable schema changes in a rehearsal; no DB/client/network calls under current preparation authorization.

### T02 — Creator bootstrap/onboarding/join

- Exact new synthetic IDs in an agreed workspace; creator A/B and staff identities supplied within SQL transaction only. No Auth Admin signup/email or normal login flow that writes outside transaction.
- Bootstrap inserts creator and zero point/earnings balances; onboarding award_welcome_bonus is separate and awards 100 POINTS, not XP.
- Legacy join adds 10 XP; first legacy submit adds 25 XP; correction resubmit must add 0; level trigger can emit a level-up notification.

Expected: Capture balances/ledgers/XP/notifications before each action and after replay; all fixture effects disappear at ROLLBACK. Public apply_mission must enforce level and verified-social gate.

### T03 — Normal active mission to Studio share

- Workspace reward-processing window and draft mission/template/deliverable setup exist for fixture IDs; no conversion of real legacy submissions.
- Scoped staff role + active staff/brand membership and synthetic creator eligibility; owner bootstrap only inside separately authorized fixture transaction.
- Real private.save_active_mission_draft, author wrapper/phase2 body, workflow/review/proof/reward schema and latest state/asset fixes; no stub save function.

Expected: Create thread, add source, save brief, canonical draft share/reload/revision conflict/replay; selected sections only, same-creator/same-workspace relationships; existing private lineage remains private.

### T04 — Assistant durable generation and privacy

- Assistant requests/messages columns, final reservation claim CAS, Studio creator lock, privacy-aware save/read wrappers, read-only browser history and KB workspace scope.
- One actor, other actor and other workspace claims; direct database SET LOCAL roles/JWT claims remain simulated auth, not actual HTTP/JWT verification.
- No model/provider generation; SQL fixture answer/source lineage only.

Expected: One claim/save; replay result identical; changed payload rejected; private/revoked evidence unavailable; no browser history forgery or cross-workspace KB read.

### T05 — Integration provenance/permissions

- All five target files in strict order; exact predecessor routine identities before SET SCHEMA/RENAME.
- Only mock/synthetic connection/resource/snapshot/permit data inside same transaction if later authorized; no actual provider accounts, secrets or callbacks.
- Private tables inaccessible to anon/authenticated and direct service writes; public service RPC grants/owner-aware reads as designed; expiry/generation/idempotency checks.

Expected: No false verified/available labels; cached source/brief/share preserved according to consent and provenance; expiration/revocation denies future use. External integration acceptance remains not-tested.

### T06 — Financial and notification neutrality

- Final application_reward_contract, reward_settlement, correction_notification, legacy XP-once, campaign budget and legacy decision audit fixes.
- Baseline includes point/earnings balances and transactions, workspace budgets/transactions, XP/level, notifications/dedupe, redemptions/code/stock, campaign progress, badges/events.
- Approval/settlement scenarios only within rollback transaction on exact synthetic IDs; no committed credit/debit, payout, redemption or stock changes.

Expected: Pending/cancel remain financially neutral; settlement/replay ledger semantics verified transactionally only; duplicate settlement cannot credit twice; rollback restores all persistent measured data. No claim of real wallet/payment acceptance.

### T07 — Rollback and forbidden destructive scenarios

- On failure ROLLBACK full open fixture transaction, discard client, retain failure evidence; no cleanup DELETE on shared real tables.
- No restore replay/global down migration/old function restore/trigger disabling; no live account anonymization or grant-cohort invalidation.
- If schema installation is later approved and committed, contain feature entry points and use reviewed additive forward repair; preserve history, receipts, ledgers and tombstones.

Expected: Committed shared schema is not reverted by fixture ROLLBACK; formal rollback/restore runtime acceptance requires a separately authorized disposable environment.

The welcome award is **100 points, not XP** in both the observed definition and 0003. Bootstrap seeds zero balances and does not itself call the welcome RPC. Legacy join adds 10 XP; first legacy submit adds 25 XP; the correction repair prevents a second submission-XP award. Approval and settlement can change XP, levels, budgets, points/cash ledgers and notifications. Measure each boundary separately and roll back all fixture effects; do not repeat earlier welcome-XP attribution.

server/test/helpers/integrations-fixture.ts uses in-process PGlite with a substituted canonical draft routine and simplified base schema. It is unit evidence, not proof of this catalog closure or real normal workflow. scripts/audit/apply-shaped-manifest.mjs creates and commits fixtures, loops the whole manifest and records history; do not reuse it for this transaction-only shared exercise.

## Exact 92-file classification

B = baseline-represented/already satisfied; R = required contribution; X = excluded from reduced selection. X includes optional rollout definitions, not an assertion that those files auto-execute. R for 0017 means one extracted function only. Full hashes below use UTF-8/LF normalization matching the release manifest; JSON also supplies raw-byte and statement hashes.

| Class | Version | Path | SHA-256 |
| --- | --- | --- | --- |
| B | `0001` | `supabase/migrations/0001_init.sql` | `d20b6490261b34fcd0e6d6ed6c3c00b30db838ea3399740bb5b2d4f4862fde1a` |
| B | `0002` | `supabase/migrations/0002_harden_rls.sql` | `80e2f23b22f85e99878c886dc328b603cb03f3379e9654336c573d3671f53e89` |
| B | `0003` | `supabase/migrations/0003_onboarding.sql` | `f0e6af66685f4d1922562374dac76e38e8bcff6b5d0bbdb99676834c9c426e6a` |
| B | `0004` | `supabase/migrations/0004_grants.sql` | `6e2ae37c745e0a60d5a3564212376980b11ad3d148acb3a17ab2018f178c8458` |
| B | `0005` | `supabase/migrations/0005_mission_submissions.sql` | `212daf37e2a9cd692e82967e615cbeab29194577abf363f8a2d9f45801e9bc78` |
| B | `0006` | `supabase/migrations/0006_redemption.sql` | `7ed1a5a1f7029f77493239aab4da5eb0af9924eaf87743eb9d92599434f0f05d` |
| B | `0007` | `supabase/migrations/0007_earnings.sql` | `a4ac74095b165a84457ec3a8730e69e61dbf01dc249c5d373eaee0f945ee03dd` |
| B | `0008` | `supabase/migrations/0008_leveling.sql` | `7bbcfdb1efd0d40fd16b59b6cb583227984f759a875e4e19139e4e9e0201b550` |
| B | `0009` | `supabase/migrations/0009_passport_scores.sql` | `7f65410dc23cd01a8bce9f0d54ef0757a9a81f15328f31cb53ca8a337e5c984f` |
| B | `0010` | `supabase/migrations/0010_applications.sql` | `0376482ce7c5f99d42516c28594ea06fa3b4c043eedbbfe2f32e4a16efe98b57` |
| B | `0011` | `supabase/migrations/0011_mission_brief.sql` | `7af23f07c0274b3190ac1b952ae80a67f968c1c855eb47d9f0e528fb42546b28` |
| B | `0012` | `supabase/migrations/0012_trust_profile_bundle.sql` | `3aff06b6f0ad82bd01183c86d03e694cbdcf190e85e4d2424fd0f65e0ed3108b` |
| B | `0013` | `supabase/migrations/0013_operator_creator_selection_crm.sql` | `cb4f1fde0e91dd99ae41ebe99a99b3fc00312447c9fd0b1dbe44bd81d7d75556` |
| B | `0014` | `supabase/migrations/0014_operator_crm_workspace_guard.sql` | `26ea349cd128e290ec4cca3da7727dca634a981689adf8f2c50313f6f18c86ea` |
| B | `0015` | `supabase/migrations/0015_creator_profile_media.sql` | `d63f3f1c33634165b4e29ec10d934cf0fab6dcc4df7e2f3cd0cf550e470bd4ba` |
| B | `0016` | `supabase/migrations/0016_assistant.sql` | `abf39c31f43bf0bed7cbde0699dda4567be6b6011af57a362365ffb5cc94d4df` |
| R | `0017` | `supabase/migrations/0017_social_verification.sql` | `3f26ea1d4e5c100794905e6637cb55d00d125752e3f228536985e5421a772da0` |
| B | `0018` | `supabase/migrations/0018_mission_authoring.sql` | `34591c7feff3dfe6a7cff51b717bc819fd5660a86de9f310e7749b7325d81279` |
| B | `0019` | `supabase/migrations/0019_mission_brief_rich.sql` | `a4fb5c6578f3fdf469d8c1559acb3486a99d296813f260e5cf221d487054d0fd` |
| B | `0020` | `supabase/migrations/0020_staff_auth.sql` | `b7fd91202a9caa4acdb7785cf71accdb7272d28b7391e3663edfe3959a058edd` |
| B | `0021` | `supabase/migrations/0021_content_hub.sql` | `51310b37bb59c94e3ff6c31ada58a375644624f73c4403021a04ab98daf78443` |
| B | `0022` | `supabase/migrations/0022_notifications.sql` | `e2c8653a85069a30b46bb4642fbd631020603d74627683ad0809a90460c33467` |
| B | `0023` | `supabase/migrations/0023_brand_access.sql` | `efe11f176a28d2699c187c7c08d8134c2bd898acd5c5c617ecd1ccf120afb283` |
| B | `0024` | `supabase/migrations/0024_brand_budget.sql` | `c8cc7e3507b20dccb9606aa23337c86597b009e906440921dc3a32b0993c5bab` |
| B | `0025` | `supabase/migrations/0025_campaigns.sql` | `d9a1ceba293a14786524181b1559dee8d17a23e2469af3a64ce66044fa00fcee` |
| B | `0026` | `supabase/migrations/0026_campaigns_s2.sql` | `289aab7ed9aa2bf19a0bec701f25b05d9adefcd2cdbe89370a79880b8e9e634f` |
| B | `0027` | `supabase/migrations/0027_brand_resources.sql` | `141846857c0fbf6ec72c8277fab0fae04b229c96a52f00ef80d5e7fa10e700f8` |
| B | `0028` | `supabase/migrations/0028_academy_content.sql` | `8eb099a555be979ba179ee1a5f01ce944d577c7c2308993b095b35bccf418e1e` |
| B | `20260618135028` | `supabase/migrations/20260618135028_profile_media_private_grants.sql` | `29b7db23b5d5ca6570514d009fa83b6646e5be1d58823ea056c16dfb90d78b5d` |
| B | `20260619013000` | `supabase/migrations/20260619013000_profile_media_url_validation.sql` | `628d539c1ce556a8f722ab3d0dc72655d49d9852739342b2a82d4789be1b9323` |
| R | `20260715163350` | `supabase/migrations/20260715163350_active_mission_workspace.sql` | `00b6a2fb39a9f5f05d5822dcc0ad906857b960130ff9ffe22774b2e3cad8ecd5` |
| R | `20260717190420` | `supabase/migrations/20260717190420_receive_mission_fulfillment.sql` | `e00bed624f8f7d13cee3d422d921e28d79d64ae70fd1b03717ac2da2b24a32e4` |
| R | `20260718134500` | `supabase/migrations/20260718134500_active_mission_operator_lifecycle.sql` | `16b757e808eaa97e2d9df160a4416b167f006d7e66c5dd5f71e95fcb9d31bf96` |
| R | `20260718193000` | `supabase/migrations/20260718193000_harden_active_mission_operator_lifecycle.sql` | `a6fc1fd8ab7b56a483ab08b4bf3bbca2151e4ea553221cf7b08f52bc48c717eb` |
| R | `20260718210000` | `supabase/migrations/20260718210000_author_active_mission_workflow_policies.sql` | `6adc69efe2ee6c4e3ec1eb5c667c8044ba208298775886ffcff9fae4e44435bb` |
| R | `20260718213000` | `supabase/migrations/20260718213000_guard_mission_authoring_snapshot_race.sql` | `f8cf31e74e9be0ea92e16b3ba060b68e37992117fa204384a58bb5b9b0c2ef8d` |
| R | `20260719133000` | `supabase/migrations/20260719133000_submit_active_mission_draft.sql` | `6f59d84a299fb09c31b8d5c1e073f47b7e75bd6200c75f57d5c1b3ad06ec25f2` |
| R | `20260719160000` | `supabase/migrations/20260719160000_abandon_active_mission_asset.sql` | `6cbb7ed6b21a5eab470f1cc31e418af7cf4859ffbda0a5ab562cbd5a41b445b0` |
| R | `20260719200000` | `supabase/migrations/20260719200000_active_mission_workflow_notifications.sql` | `f0b46aa8f23fca4ab327a12d4e22ba4ab667c7882b1558613c64c6ee828d50b1` |
| X | `20260719220000` | `supabase/migrations/20260719220000_migrate_pristine_joined_active_mission.sql` | `9bc00424e195d9daaaa218434a737c4608aade5f07d5533e46e433e13dfaeef2` |
| R | `20260720033542` | `supabase/migrations/20260720033542_final_review_active_mission_contracts.sql` | `5055cf4e22c43a968426d48b3d50c5d908786ea0428632d610ea2bf04860de3e` |
| B | `20260720175319` | `supabase/migrations/20260720175319_grant_service_role_budget_read.sql` | `d7e9f431f9effb2f3473ea1f2514c58c8cf6e2c2c7110ac44db9a7626d68955f` |
| R | `20260720193637` | `supabase/migrations/20260720193637_resolve_mission_submission_relationships.sql` | `47db6932bbfe05aff34d6f91e2f8717ae3dd14c3ccf0041d5678ee29a8e16436` |
| R | `20260723090000` | `supabase/migrations/20260723090000_publication_proof_validation.sql` | `64fa33b5f47eccdd17f4a0a8c638a055aea0472c36bb1f388d63eb208cc0f5b5` |
| R | `20260723170000` | `supabase/migrations/20260723170000_publication_proof_rollout.sql` | `5b69abffda80aac3cbf007515cc1ef0956a1edc8f2f2b4dc833ad7f44dbd97bf` |
| R | `20260725090000` | `supabase/migrations/20260725090000_publication_proof_rollout_compat.sql` | `3dd13606c2e9d70824805fc6656a2d29dd86faf5567262d0a1f41d777f6e3766` |
| X | `20260725110000` | `supabase/migrations/20260725110000_publication_proof_asset_policy.sql` | `61469f3004f292fc4678a1cb77f1e0eed16b27561eb479002fcfae3b9d49aa53` |
| R | `20260725130000` | `supabase/migrations/20260725130000_publication_proof_asset_mutation_guards.sql` | `2ec12b4e672552b018fcfdd7e5737044ade0ed790f421796e02f342a95c301b0` |
| R | `20260725140000` | `supabase/migrations/20260725140000_publication_proof_asset_guards.sql` | `e461544af2a2bfae2964a42777d6421e758c8f60298dff5297ecbd6e40c95d92` |
| X | `20260725143000` | `supabase/migrations/20260725143000_publication_proof_public_guards.sql` | `4c7a752a7b1dd41461249307a1ff0ae9153065db5ef3e81570611071c97f05ec` |
| R | `20260725150000` | `supabase/migrations/20260725150000_publication_proof_public_rpc_final.sql` | `8e7f1e4893f081d1196f7fe66268e308dbbb2d27796373d54f37ef3b34dbb7f3` |
| R | `20260727120000` | `supabase/migrations/20260727120000_publication_proof_instrumentation.sql` | `bd56dda15ee21b640ee99ee8e7b3d8bd3ce34eab95a44bb97906cb2bddb0a9af` |
| X | `20260727130000` | `supabase/migrations/20260727130000_publication_proof_existing_setup.sql` | `cbb412dc35c2d3f0ab33926229c4009ace7459c4ffaf80045b47d8cac0cbc248` |
| R | `20260728135000` | `supabase/migrations/20260728135000_fix_publication_proof_asset_path_regex.sql` | `a4a909bb7711ffcfb50a8f4b4b8947c7695bccbea319d266854b0a5733dd15b4` |
| R | `20260729010000` | `supabase/migrations/20260729010000_align_publication_proof_asset_mime_contract.sql` | `9d667de55f18307d5152201b07450e00d158a000456c538c60194030cd846d19` |
| R | `20260731100000` | `supabase/migrations/20260731100000_reward_handoff_schema.sql` | `b4966d226b2dc72759a1a5d768b90cb67cc8b84b996a0f1cf60541c2af548674` |
| R | `20260731110000` | `supabase/migrations/20260731110000_reward_contract_capture.sql` | `90e97bc465c59ce71bba076eb5aa4dd769436ac41435623fbe9583e7bbe4c973` |
| R | `20260731120000` | `supabase/migrations/20260731120000_reward_handoff_transitions.sql` | `a12096f7fc26e514dbbebb28462de365fa9d2b9a07fead61c48ccd10cd505632` |
| R | `20260731130000` | `supabase/migrations/20260731130000_reward_handoff_notifications.sql` | `2f0d71622ff3b906ceb8f07d918869c7b3ac18f9a1f46e786f779a1298a4c1a8` |
| R | `20260731140000` | `supabase/migrations/20260731140000_reward_handoff_release_hardening.sql` | `17ed4ee4542bb4f658137accfab9325976cf5a48d00ef587d7bd1d111c8c1d5b` |
| X | `20260731150000` | `supabase/migrations/20260731150000_enable_pilot_if_empty.sql` | `bd3ddfbb8fb0c5b5bf4f8544d7bffa6156630aa19775f0fd9536ce958011b95e` |
| R | `20260805120000` | `supabase/migrations/20260805120000_review_hardening.sql` | `faf4018d589db8d4702327c55e6ccc3461ea05fb0e9a8229901638e706f3d65c` |
| R | `20261022170454` | `supabase/migrations/20261022170454_audit_legacy_evidence.sql` | `ce35baaaa13b900964a830e9460b7269e7643bfc3ca9f9b56355c3649081c2ec` |
| R | `20261022170751` | `supabase/migrations/20261022170751_audit_crm_commands.sql` | `ac13fbd583edf7cedc26defb23fa6a864f9ac986e0b0e631335ef6640149bd71` |
| R | `20261022171111` | `supabase/migrations/20261022171111_audit_creator_queue.sql` | `aad787138b073d53638a24e82d14f21abf6f257c2141028577ce3c80ff79de20` |
| R | `20261022171843` | `supabase/migrations/20261022171843_audit_assistant_requests.sql` | `c86547d7929441ec3dd3c138d8c148cf2c923f35c7234d6e6148668faa25d9c7` |
| X | `20261022182544` | `supabase/migrations/20261022182544_audit_legacy_review_notes.sql` | `64080d48945ee4079b2b0d6448f849b9f568a3bfda89f4dd840e11a06fc9b27f` |
| R | `20261023091050` | `supabase/migrations/20261023091050_academy_learning.sql` | `b11ea20f0e6e483bb59f582a66f3086aa71c03990c2ceafdc9466c65917602af` |
| R | `20261023093445` | `supabase/migrations/20261023093445_academy_learning_conflicts.sql` | `e95fcaa93204e33223a6324f4af2475f548db6491ac1d1ea489573339a04984b` |
| R | `20261023095521` | `supabase/migrations/20261023095521_academy_approval_index.sql` | `771fc8faab73eabc7677a07f9881690ba115bbb1e5618045d90c89199d025e34` |
| R | `20261023124149` | `supabase/migrations/20261023124149_staff_access_capabilities.sql` | `e4fbff31e7ee64a814cc8f545d268f4413e439f8de6aa985fbad1c588553919a` |
| R | `20261023192141` | `supabase/migrations/20261023192141_pilot_legacy_access_hardening.sql` | `4669bd408714f65c152320a1ffdd0a932dc0fbf391a5c2281a642a00d1223cd2` |
| X | `20261025120934` | `supabase/migrations/20261025120934_application_decisions.sql` | `abbfc0499afbe771e36540443a93c979521be1fe70c321f6fb8ff6996a45a35c` |
| R | `20261025194402` | `supabase/migrations/20261025194402_redemption_intents.sql` | `c0bdf76d8d4dda6117c9aaeec537c238e95560c19b12ca20ab131dd89d8f78b6` |
| R | `20261028140231` | `supabase/migrations/20261028140231_legacy_submission_xp_once.sql` | `a206c9474faf71a9db95a901a9740ce359d1426b1b2a9fa80b641cd82e02c88c` |
| R | `20261028140709` | `supabase/migrations/20261028140709_legacy_evidence_url_authority.sql` | `a386b7c2d40f4e37228b2be112888b1d64cb27d20cfe9fca6b2788881e843277` |
| R | `20261028155000` | `supabase/migrations/20261028155000_legacy_evidence_review_validity.sql` | `9e71f8477ac45a7c392a28948fc089d96050deaf2f79cd63c5b196b5696356d5` |
| R | `20261029000000` | `supabase/migrations/20261029000000_assistant_reservation_claim.sql` | `8fae8aa9145bd56208f637eb55fd1c148b3e1c4ef8daaa76af8ba8e6d769afd6` |
| R | `20261029100000` | `supabase/migrations/20261029100000_brand_write_hardening.sql` | `ea99c7cf8530e789ed890160d7d80675d59408dae4ba4698f6469db901daed92` |
| R | `20261029110000` | `supabase/migrations/20261029110000_legacy_decision_audit.sql` | `4d046219c3217186ce244ca9ff6e2acfb0b000c502c11a1f09f727808a48315f` |
| R | `20261029120000` | `supabase/migrations/20261029120000_application_reward_contract.sql` | `a4a3cfd944c39548cd68d36f1aaa7a061968af1276fe63afb62d4788cc8337a8` |
| R | `20261029130000` | `supabase/migrations/20261029130000_reward_settlement.sql` | `57f9808a706e00ccf6b4da72a380ce5605b06639d6169c4c934c11eae87016d9` |
| R | `20261029140000` | `supabase/migrations/20261029140000_correction_notification.sql` | `f91bc2ee917beb68e9a5c00701281c0eaf049e8870bdfe8f41378ad007f2462c` |
| R | `20261029150000` | `supabase/migrations/20261029150000_kb_workspace_scope.sql` | `a14e2b6160ef324b1eed28625630901d1f2a2feff7317a35a272e5eeaee463ee` |
| R | `20261029160000` | `supabase/migrations/20261029160000_assistant_history_readonly.sql` | `5a31956e7197983a6ced210683e56c144b0c0167265246912e9fe935ffeadd14` |
| R | `20261029170000` | `supabase/migrations/20261029170000_creator_consents.sql` | `18197ffb547ad82068cec7a36c7dcf30a58e3e8a1344d72907af06c8e9bead13` |
| R | `20261029180000` | `supabase/migrations/20261029180000_creator_account_deletion.sql` | `3963fc91322af0bf9878664f5ab53b0a88195c71b7bd8ea7f2ce3f2b2d1562f4` |
| R | `20261030195424` | `supabase/migrations/20261030195424_creator_studio_private_artifacts.sql` | `b544d5c9b31b937cac0a3b2ac6df0b03f9becd655b4c81ca7bca9a0e9dbefbef` |
| R | `20261031120000` | `supabase/migrations/20261031120000_creator_integrations.sql` | `3dc5e7e30f998ef57a25d7c6b15e52c99cbc60532091063014e804ba7311c799` |
| R | `20261031121000` | `supabase/migrations/20261031121000_studio_integration_evidence.sql` | `853d034c054ad62aa04ad9f3d68986ee1d5af720ea4b317c21f05bd0fcd482b4` |
| R | `20261031122000` | `supabase/migrations/20261031122000_integration_privacy_cleanup.sql` | `1cdb50eda890a206b2fd28b6d6d0a4e0af9ecfd1a35fe12d7df632d6138b42cd` |
| R | `20261031123000` | `supabase/migrations/20261031123000_integration_pilot_persistence.sql` | `485bee1d9978bced3983a70a846825e410a19805dd47d972739c7ae2c55ebdbc` |

The ordered R timestamp rows are the 54-source later selection. Each file has statement effects, object observations, dependencies, inclusion/exclusion reasoning and rollback constraints in the adjacent JSON. No migration or app source has been edited.

## Completion and evidence limits

Local inventory, hash checks, exact-body comparison, dependency/side-effect review and report consistency are complete. Runtime, SQL compilation/application, data invariants, real RLS/Auth, locks/durations, Storage and deployment are not tested. No application rows were read. Fresh drift preflight, missing column-ACL/owner metadata, execution scope and a reviewed transaction envelope remain parent requirements before any later execution.

## Frozen handoff addendum

The selected 54 later versions are frozen against manifest/source hashes, with the single 0017 routine repair described above. Selection SHA-256 (canonical JSON of ordered version/path/hash plus the baseline-repair record): `e5dd0c1a36ad30671c6b8546a87e9539ecfb2478e0ad4add5c9dd3d3aa1546a6`.

New parent-supplied `observed-storage.json` has SHA-256 `24f31b7b18fd61fd4c40af744c7e2d5174a448e04be3626d871397686cb2e7cc`. The parent identifies its empty bucket result as scoped to `mission-draft-assets` and `mission-publication-proof-assets`: both are absent. It records four existing creator-avatar policies and no auth.users triggers. Preserve those policies and reassert the scoped absence before a later execution. This resolves the new-bucket collision uncertainty in this capture, not real Storage acceptance or all external side effects.

The parent reports an offline PGlite projection with Auth/Storage stubs and unavailable vector support. The sidecar has not run that projection. Its eventual result must remain separate from real Auth, Storage, vector/KB search and hosted workflow acceptance.
