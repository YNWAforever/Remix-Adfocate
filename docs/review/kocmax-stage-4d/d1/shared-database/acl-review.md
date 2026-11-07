# Existing-table browser ACL reconciliation

Prepared locally; no SQL executed and no network/database connection made. This sidecar owns only `12-baseline-acl.sql` and this rationale. It leaves all source migrations and previous D1 artifacts untouched.

**Ready for parent assembly and independent review.** Apply this fragment **after all 62 manifest sources and the parent-owned apply_mission repair**, before transaction-only fixtures. Its filename does not imply that it precedes the forward envelope. The reduced 54-file analysis remains historical; using the full 62 does not mean all 62 were pending and does not authorize rewriting the 14-row history. No enable/migrate/setup helper is called here.

## Exact scope and intended result

The patch reconciles **all 39 observed existing public tables**, not just missions/campaigns. It removes table AND independently held column privileges from PUBLIC, anon and authenticated, then restores the deliberate authenticated matrix below. The fixed table allowlist cannot include new tables. It does not revoke/regrant service_role, change owners, memberships, RLS/policies, functions, schema access or any default privileges. Parent remains responsible for new-table default-ACL normalization and function ACL review.

| Existing surface | Authenticated access after reconciliation | Supported caller / reason |
|---|---|---|
| 31 readable tables, explicitly listed in SQL | SELECT, still constrained by their RLS | Existing creator, brand, content, Academy, budget, balance and history reads |
| creators | UPDATE `display_name`, `avatar_url`, `categories`, `social_handles`, `onboarding_step`, `phone`, `level_seen` | User-token profile/onboarding and level acknowledgement |
| missions | UPDATE only the 23 authoring fields explicitly listed in SQL | Brand PUT uses a user token; RLS membership and preimage/reward guard remain |
| creator_social_accounts | INSERT `creator_id`, `workspace_id`, `platform`, `handle`, `profile_url`; UPDATE `handle`, `profile_url`; DELETE | Original connect/edit/revoke behavior; verification and owner fields remain protected from UPDATE |
| notifications | UPDATE `read_at` only | Own-notification acknowledgement |
| creator_public_passports | DELETE | Original own-passport revoke permission |
| creator_portfolio_links | INSERT, UPDATE, DELETE | Preserve original CRUD grants and RLS; current profile-media routes use service_role |
| campaigns / campaign_missions | SELECT only | Admin campaign writes use service_role; later brand hardening must remain effective |
| assistant_conversations / assistant_messages | SELECT only | Preserve October 29 browser-history write removal |

No browser read or write grant is restored on `brand_invites`, `campaign_rank_snapshots`, `creator_review_notes`, `creator_review_statuses`, `mission_shortlists`, `operator_audit_events`, `redemption_codes`, `staff_users`. No PUBLIC/anon table or column rights remain on these 39 tables. Authenticated TRUNCATE, REFERENCES, TRIGGER and (on PostgreSQL 17+) MAINTAIN are denied; no browser grant option is allowed. This is an existing-table ACL result, not a claim that RLS, all RPCs, new tables, Storage or future defaults have been fully audited.

## Why the overlay is needed

Observed metadata has broad direct anon/authenticated/service_role grants on all 39 tables, plus 13 independently granted authenticated columns. Narrow column grants do not counteract table-wide UPDATE. The overlay clears both layers, then checks effective privileges on every non-dropped column, including columns added by the forward bundle. Each privilege is checked separately; comma-separated has_* privilege arguments can accept any listed privilege.

The August review-hardening source already revokes authenticated table-wide UPDATE on missions and grants authoring plus lifecycle columns. October 29 removes the three lifecycle column grants and INSERT/DELETE. This proposal preserves those final semantics; it does not claim authenticated mission-wide UPDATE necessarily survives the full envelope.

Campaigns are different: August grants nine UPDATE columns; the October table-level UPDATE revoke does not remove those column grants. This patch explicitly clears them. The observed `redemption_codes` policy named `Enable read access for all users` has PUBLIC / USING true. Removing its browser SELECT grants is necessary even though RLS is enabled. Policy rewriting is outside this sidecar.

The SQL is one atomic DO statement with catalog-only reads, bounded REVOKE/GRANT and assertions. It requires owner execution, RLS on each fixed table, existing service privileges, final-envelope object sentinels and retained helper privileges. It rejects effective rights from unexpected inherited grants and browser grant options. RESTRICT prevents cascading into unknown dependent grants. Parent must still use a single surrounding transaction and its metadata/hash drift preflight: the sentinels do not prove the complete 62-file order or current policies.

## Supported paths and retained helper boundaries

Local source evidence: [me routes](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/me.ts), [onboarding routes](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/onboarding.ts), [notifications](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/notifications.ts), [brand routes](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/brand.ts), [brand authoring allowlist](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/adminMissions.ts:105), [profile-media routes](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/profileMedia.ts), [profile-media repository](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/lib/profileMedia/repo.ts) and [admin campaigns](C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate/server/routes/adminCampaigns.ts). These are local callers, not proof of the deployed caller revision.

Bootstrap upserts creators and zero-valued balance rows through serviceClient. Profile/onboarding field edits and notification acknowledgements use the user token. Onboarding completion calls the service-only award_welcome_bonus RPC; it awards points, not XP. Brand mission create/publish/close/delete and campaign mutations use serviceClient after route checks. Brand mission PUT uses the user client and needs the exact 23 authoring columns; publishing fields, workspace/id and other server fields stay denied. Profile-media and public-profile snapshot writes use serviceClient. Those service table rights and Storage policies are untouched.

The original `20260715163350_active_mission_workspace.sql` changes FUNCTION defaults at owner-global scope and in private, revoking default EXECUTE from PUBLIC/anon/authenticated, and removes browser USAGE on private. This is existing source behavior in the 62 envelope, not a new overlay change. Its global default change affects future functions of that owner beyond private; it does not rewrite existing function ACLs, nor cancel independently configured public-schema default grants. Captured public-schema function defaults explicitly grant API roles for two owners. The other owner defaults remain. New public routines therefore require their exact source explicit REVOKE/GRANT review; no blanket default/function restoration is proposed.

Existing CREATE OR REPLACE routines retain ACLs at unchanged signatures. The patch checks authenticated EXECUTE on private.current_workspace_id, creator_is_trusted, mission_brand_update_allowed and can_read_academy_track without invoking them. Stored policy expressions can retain function references without exposing private as a directly addressable API schema. Keep the later SECURITY DEFINER public Academy wrapper correction. Do not reopen private USAGE to make an older invoker wrapper work.

Retained profile-media helpers include uuid_lock_key, is_valid_public_http_url, is_valid_public_profile_highlights, enforce_creator_portfolio_highlight_limit and touch_creator_profile_media_updated_at. Their observed existing ACLs supply service access, including PUBLIC EXECUTE on legacy helpers; the private schema still permits service_role. This patch asserts those service privileges but changes no helper grants. Triggers continue to be attached; this ACL-only fragment does not fire them.

**Unavailable caller assumption:** direct authenticated legacy portfolio highlighting may enter the SECURITY INVOKER highlight trigger, which resolves private.uuid_lock_key by name. With private USAGE revoked by the original forward source, that nested lookup is a specific compatibility risk. The current profile-media routes use service_role and have the required access. The original portfolio table CRUD grants are preserved, but legacy direct-client highlighting is NOT certified. A direct-client caller inventory and targeted local role exercise are required before claiming compatibility; any narrowly scoped function redesign belongs in a separate reviewed change. Do not grant private USAGE globally or replace old functions here.

Other unavailable facts: deployed route revision, external direct PostgREST/anon consumers, and any unobserved roles/grant chains after metadata capture. The fixed owner/role and effective-ACL checks fail on relevant drift; they do not discover business callers. Removing browser access to the eight service-only tables follows source-supported access, not an assumption that permissive observed grants are intended.

## Required local cases for the parent

These are acceptance cases to implement in the parent isolated projection/transaction fixture. **Not executed by this sidecar.** Parent already imports captured per-column ACLs; retain them in the starting projection.

| Case | Required result |
|---|---|
| All 39 tables / every current column | Run the fragment after full 62 plus repair; table and per-column assertions pass for anon/authenticated. Include independent campaign UPDATE grants and broad original table grants in the starting projection. Service privileges remain. A deliberately inherited extra grant, if simulated in an isolated test, must cause rejection without partial ACL changes. |
| Profile / onboarding | User A reads own profile; updates all seven allowed fields (including avatar/phone/level_seen); documented onboarding recommendations/status remain readable. User A cannot UPDATE id, workspace_id, xp, level, scores, status or onboarding_completed or another creator. Mixed allowed + forbidden column updates fail atomically. Bootstrap service path still upserts creator and zero balance rows. |
| Social accounts | User A inserts the five allowed columns, changes handle/profile_url, and deletes own account; verification-reset trigger still behaves. UPDATE creator_id/workspace_id, verification state, arbitrary scan snapshots and cross-user rows is denied. Service verification and scan persistence still work. Exercise passport SELECT/own DELETE separately. |
| Notifications | Own SELECT and read_at update succeed. UPDATE data/type/workspace_id/user_id fields, INSERT/DELETE, and cross-user acknowledgement fail. Service notification insertion remains available. |
| Brand edits / lifecycle | Member edits each of the 23 authoring columns on an eligible mission; nonmember edits are rejected by RLS. Existing reward/preimage guard still rejects prohibited live reward changes. Browser UPDATE status/published_at/closed_at/workspace_id/filled and direct mission INSERT/DELETE fail; service create/publish/close/delete remain available through scoped intended routes. |
| Campaigns / history / service-only tables | Browser INSERT/UPDATE/DELETE campaigns/campaign_missions and history writes fail, including each of the nine formerly granted campaign UPDATE columns. Authenticated read paths remain. Neither anon nor authenticated can SELECT redemption_codes despite its permissive policy, or read the other seven service-only tables. Admin service campaign/CRM/staff/rank operations remain possible. |
| Portfolio / public profile | Known service-backed portfolio insert/update/delete, highlighted-item limit, profile snapshot publication and validation helpers work. Own authenticated SELECT and retained CRUD/RLS are checked separately. Explicitly exercise direct authenticated highlight writes to resolve the private-schema risk; failure is a caller-compatibility finding, never justification for global schema/function restoration. Existing avatar Storage policies are unchanged and need provider coverage outside the projection. |
| Onboarding award / service RPCs | User completion route can invoke the intended service-only welcome RPC with a synthetic eligible fixture; repeat is idempotent, browser direct invocation denied. Verify expected point/notification effects and no unintended XP change. All rows and points/wallet/notification effects remain inside the parent transaction and are ROLLED BACK. Do not invoke rollout enable/migrate/setup helpers. |
| Academy / shared RLS helpers | JWT-scoped reads exercise current_workspace_id and mission/Academy predicates; the corrected public Academy wrapper works without authenticated private USAGE. Inspect retained legacy helper EXECUTE/owner/definer metadata separately from actual caller success. |
| Rollback / drift | Trigger a postcondition failure in an isolated projection and verify ACL changes from the single DO statement roll back. Parent outer ROLLBACK restores pre-fixture catalog/ACL state and leaves no rows or durable points/wallets. Changed owner/RLS/missing helper or service rights must abort, not silently grant around drift. |

PGlite Auth/Storage stubs and unavailable vector support limit acceptance: they do not prove hosted Auth, Storage, PostgREST role switching, vectors or production behavior. No stage/runtime/deployment gate is changed by this proposal or local replay.

## Locks and rollback

GRANT/REVOKE modify catalogs and acquire relation/catalog locks across the fixed 39 tables. They do not scan or update application rows, run backfills, change balances or invoke user triggers. Concurrent DDL can contend; use the parent bounded lock/statement timeouts and do not hold a rehearsal transaction open while waiting for approval. Revoke checks use RESTRICT; unknown dependent grants cause review rather than CASCADE.

Parent transaction ROLLBACK is the intended reversal. No global down-schema, old-function restore or broad grant-restoration script is supplied. After commit, this reconciliation cannot recover unknown earlier ACLs by itself; any repair must use a separately captured reviewed ACL delta while retaining recent hardening. Current authorization remains preparation only.

## Frozen local evidence

Raw-byte SHA-256 at preparation:

| File | SHA-256 |
|---|---|
| 12-baseline-acl.sql | `2e63e019443f9b38baba6336dbf79b89fd7002c973480809ad4f07bf0219a53d` |
| observed-catalog.json | `bdd3191e3e3e7d31d6228895718d29de4d8ef6dccd32c0caf0affffb71d3c5dd` |
| observed-privileges.json | `735e22c4efd546e7b8a2fdc7aa1a7d9a2d54eac0a17a390beea208b43ae8ed1a` |
| observed-definitions.json | `77194248a2fa559c79457f4d33dba417e0599ed9c6f271e0b29c4215bd1e7539` |
| supabase/release-manifest.json (62 entries) | `d05efb4d5e2061c3a62e3f06613fca8c8f9486419a5ce3bb9236853efcdd4394` |

Local checks performed: fixed list equals the 39 observed public base tables; 31 authenticated-readable tables; all named grant columns exist; dollar-quoted/top-level statement splitting yields one complete DO statement; retained helper and placement sentinel names resolve in the source inventory; no SQL execution, application DML, function/schema/default-ACL mutation or transaction commit is part of this fragment. Source migrations and application files were read only.
