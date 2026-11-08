# Newly visible authenticated RPC advisories

The applied packet adds nine authenticated SECURITY DEFINER advisor findings. Bounded static review found intentional, guarded entrypoints and no concrete unexpected exposure in the reviewed definitions and grants. The live catalog independently confirmed, for all nine: owner `postgres`, SECURITY DEFINER, fixed empty `search_path`, anonymous EXECUTE denied, authenticated EXECUTE allowed. Their live definition hashes are retained in [application-receipt.json](application-receipt.json).

This is static/catalog consistency, not actual JWT, cross-account or runtime authorization acceptance. No RPC was invoked, no award was issued and no SQL was changed merely to suppress the [Supabase advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Source line numbers refer to the immutable [approved application artifact](approved-apply.sql).

| RPC | Principal and workspace guard | State/dependency limit | Source line |
|---|---|---|---|
| `can_read_academy_track` | `auth.uid()` identifies a creator; Academy content is global. | Published track, valid required level, sufficient creator level, trust requirement for L2+. Private Academy/trust helpers; later ALTER establishes the definer wrapper. | 10460; ALTER 10601 |
| `complete_academy_lesson` | Non-null caller and Academy eligibility; progress belongs only to that creator. | Published exact track/lesson/version, locking and duplicate/version-conflict handling. Completion is self-attested, not proof of reading. | 10602 |
| `create_mission_workflow` | Own submission with matching creator/workspace, or deliberate service-role exception. | New workflow requires joined submission, active-workspace mode and required deliverables; existing workflow reused/refreshed. | Wrapper 1676; private implementation 1543 |
| `get_academy_learning` | Non-null eligible creator; progress/history filtered to caller. | Global Academy content, eligibility and published lessons; content is not partitioned by workspace. | 10516 |
| `get_assistant_request` | Creator belongs to supplied workspace; request bound to creator/workspace/request ID. | Integration sources revalidated; changed context fails. Depends on integration-source and retained private stage3 reader. | 12981 |
| `get_my_mission_reward_handoff` | Own submission with consistent workflow/workspace/mission/contract relationships. | Approval/cancellation chains checked for reward states. Read-only projection; no award or settlement. | 11516 |
| `join_active_mission` | Authenticated creator; mission and creator workspaces match. | Active/open, deadline, level/verification, duplicate prevention and atomic quota check. Joined-mission contract; associated writes roll back on transaction failure. | Wrapper 9776; private join 9666 |
| `redeem_gift_with_request` | Authenticated creator/workspace, caller-scoped request lock; conflicting gift/workspace retries rejected. | Retained baseline `redeem_gift` checks availability/dates, stock and atomic sufficient-balance deduction. This helper dependency is not replaced by wrapper review. | 10943; baseline in observed-definitions.json |
| `refresh_mission_workflow_state` | Own workflow through submission/creator/workspace joins, or deliberate service-role exception. | Preserves reward_pending/cancelled/expired; derives other states from scoped fulfillments/work items. No reward issuance. | Wrapper 1659; private implementation 9842 |

The existing [observed definitions](../observed-definitions.json) remain the baseline for the retained redemption helper. Real authenticated owner/peer/outsider checks require their separately approved identities and fixture scope; this review does not enable those tests or a provider pilot.
