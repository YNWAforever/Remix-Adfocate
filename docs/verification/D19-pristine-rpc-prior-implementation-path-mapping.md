# Implemented path mapping

The supplied plan paths were proposals. Existing equivalent modules were extended after source review.

| Task | Planned concern | Actual implementation / verification |
| --- | --- | --- |
| D01 | Clock and audit baseline | `scripts/release/pilot.test.ts`; original seven files in `src/audit-tests/`; baseline record |
| D02 | Schema, manifest, identity | existing `scripts/release/{manifest,preflight,executor}.ts`; `scripts/run-integration-tests.mjs`; owned-target rehearsal adapters under `scripts/audit/`; five forward SQL files |
| D03 | Staff/workspace authorization | `server/lib/staffWorkspace.ts`; existing admin middleware; `AdminShell`, `StaffAuthGate.scope.test.tsx`, `server/test/audit-admin-scope.test.ts` instead of a duplicate workspace engine |
| D04 | RequestState/requestError proposals | `src/components/RequestFeedback.tsx` plus existing `AdminRequestError` handling; existing mission/queue routes; canonical wallet alias |
| D05 | Legacy evidence correction | `src/lib/submissionEvidence.ts`; existing mission/admin routes; `audit-legacy-evidence.test.ts`; forward SQL trigger/correction RPC; real schema `reviewer_notes` API alias |
| D06 | CRM commands | existing `server/lib/operatorCrm/{repo,types,serializers}.ts`, operator route and action panel; service-only command RPC and receipts |
| D07 | Workflow/proof/reward acceptance | existing activeMission modules and `deriveNextAction` retained; `auditWorkflowFixture.ts`, real roundtrip suite, existing live proof suites and `e2e/creator-operator-mission.spec.ts` |
| D08 | Creator current-work home and navigation | Existing `useCreatorActivation`, `creatorActivation`, `deriveNextAction`, `creatorRewardExperience`, `NextBestActionCard`, `ActiveMissionSummary` and shared workspace query options; `CreatorWorkHome` composes them, `navItems` keeps all destinations, actual `/_app/more` route replaces an overfilled bottom bar. No new workflow engine/schema. |
| D09 | Mission decision DTO, categories, eligibility | New small `server/lib/missionDecision.ts` projection/serializer extends existing missions, match and onboarding APIs. Existing `MissionCard`, `missionMeta`, `missionCategories`, `MissionFacts`, commitment formatter and DTO consumers share facts/qualification. Existing `MissionEditor` preserves exact historical category values. No new workflow engine/schema. |
| D10 | Queue paging and return context | existing operator repository + scoped paging RPC; `creatorQueueSearch.ts`; existing queue/detail route; 51-actor real DB test |
| D11 | Workspace dates and radar link | `workspaceCalendar.ts`; existing queue and radar routes |
| D12 | Readable authoring, policy and preview | Existing `MissionEditor`, `PublicationInstructions` and atomic `author_mission_workflow` retained. `ProofPolicyFields` adapts the existing evidence gate. Existing validator/types moved unchanged into pure `src/lib/missionWorkflowAuthoring.ts` and re-exported; client and publish endpoint reuse it. Route-level `useMissionEditorNavigation` adds tab/SPA/beforeunload guards; existing server persistence/membership model unchanged. |
| D13 | Identity and source/sync/ownership consistency | Existing PasswordAuth, AuthFeedback/callback/recovery, onboarding RPC, social repo/service/RLS and public Passport authority retained. Shared private `socialAccountPresentation` feeds `/me` and private Passport; `SocialAccountSummary` renders both. Legacy data remains distinct, no automatic migration/verification. Existing profile and query invalidations extended. Only `.codex-tmp/**` lint exclusion; no app rules changed. |
| D16 | Assistant persistence | existing assistant route/chat/LLM and panel; `assistant/requestPolicy.ts`, forward request-state RPCs and persistence tests |
| D19 | Delivery and case mapping | `adfocate-delivery.json`, case/finding/backlog CSV new columns, release review packet, fingerprints and logs |

No parallel workflow, proof, reward, payment or public-publishing engine was introduced. Global Academy content keeps the R1 staff gate; R2 capability separation remains open. Legacy business test transport now supplies real, explicitly scoped staff JWTs; security-gate tests call the application directly and retain denial assertions.

## D14 implementation mapping

Extend existing public site layout/index/creators/contact and mock passport; progressToNext/LEVELS remain the only XP authority. Existing Academy list/detail API adds body availability, cards/detail distinguish reading/introduction/preparing and retain eligibility. Existing AcademyEditor exposes every body kind with labels, changed-field writes, explicit 409 comparison/rebase and pending/error recovery; route identity gets a key. Existing admin list filter receives an accessible label. No new learning, reward, payment or eligibility engine; no SQL change.

## D15 implementation mapping

Extend existing AcademyEditor/adminAcademy, authenticated Academy routes and track detail. New AcademyLessonsEditor/AcademyLearning and academyProgress are unit content/progress views and transport, not a parallel eligibility, workflow or reward engine. Existing LEVELS/missionMeta/private.creator_is_trusted remain authoritative. Existing guideProgress localStorage marks guide documents only and is unchanged. New academy_lessons version rows and creator_lesson_progress use forward migrations, immutable published snapshots and self-only progress RPC. Academy remains within its existing global staff gate; active workflow membership checks and brand_users(user_id) are unchanged. Release foundation gains academy_learning phase and 30 capability validators; all prior manifest entries unchanged.

## D17 implementation mapping

Extended server/lib/insights.ts, the existing adminInsights route, activeMission/metrics.ts and activationAnalytics.ts. No parallel workflow/reward/eligibility/metrics engine. Existing API workspace membership, composite workflow/workspace FK and paged operator CRM RPC are retained. API allRows makes the existing Insights projection complete beyond the Data API row cap, with a recoverable bound instead of silent partial totals. Product success event is emitted only from a saved returned draft version; the existing sink remains optional. Vite vendor partitions follow measured entry module contributions; total initial transfer is reported separately. New scripts/audit quality helpers reuse verifiedTarget, neutralitySnapshot and existing fixture helper; no shared broad-delete seed is invoked.

## D18 implementation mapping

Extended existing admin.ts staff/workspace/resource middleware with one explicit method/path capability map. Existing operator CRM, active workflow/proof/reward and release foundation remain the business engines. adminStaffAccess adds discovery and transactional normal grant transport; staffCapabilities adds typed roles, not a parallel identity/membership model. Existing shell, workspace switcher, topbar, navigation, queue counts and review/handoff controls derive presentation from server-issued access; forms remain mounted during retry. MissionEditor adds localized 403 guidance without changing draft/409 behavior. One additive migration creates grants/audit/receipt with a protected owner bootstrap; brand_users(user_id) and all previous SQL remain unchanged. Release foundation gains staff_access phase and28 current capabilities; 40 prior manifest entries are preserved. run-integration.mjs staff and run-staff-browser reuse verifiedTarget, existing fixture and neutrality helpers instead of broad seed/reset. No role-grant UI or payment/eligibility engine was added.

## D19 implementation mapping

Reused audit-workflow-roundtrip/audit-staff-capabilities and the existing creator-operator-mission/staff-access browser journeys, fixtures, workflow/proof/pending reward and release foundation. Added a bounded support runner around the original 40 integration files; only service fixture transport is constrained to captured IDs/attested owned parents, while actual app and user/RLS clients remain unwrapped. Intended capability grants are explicit on new fixture actors. One forward ACL-only migration reasserts the legacy social/passport column write boundary and internal CRM denial on production-shaped catalogs; no new workflow, payment, ledger or membership model. Release manifest/preflight now records actual removed table-grant contracts. Source and final 107-case coverage distinguish local, disposable and unperformed hosted/manual acceptance.

## D20 implementation mapping

Extended existing assistant chat/prompt/retrieve/routes; added contextPolicy as read projection/ID authorization, not another workflow engine. Existing tools.ts is retained byte-for-byte: scoped generation offers zero tools and rejects every tool request before runTool; general chat/D16 persistence is unchanged. Existing admin staff/membership/capability middleware gates the new read-only POST; no grant or membership model change. DraftEditor and ActiveMissionReview receive the lazy MissionAssistLauncher/Panel with canonical IDs and deterministic requirements. Shared missionAssist DTO records basisVersion/limitations, current approval flags and explicitly not_saved mock metadata. tests/fixtures holds the24-case oracle. The separate static Edge harness and Playwright config have no real backend/session/provider, and are not shipping product routes. No SQL or release engine change.


## R2 follow-up 2026-10-24

R2 follow-up reuses six existing support routes, RequestFeedback and AcademyEditor; AcademyMetadataFields is a UI helper, not a parallel workflow/provider engine. Scoped runner uses existing identity/fixture/neutrality helpers. See R2-ui-delivery.json.


### D17 R2 quality follow-up · 2026-10-24

D17 R2 延伸既有 AdminTopBar、PlaybookCard、AcademyTrackCard、_app.home；新增 e2e/d17-r2-quality.spec.ts、playwright.d17-r2.config.ts、scripts/audit/run-d17-r2-quality.mjs、inspect-d17-r2-advisors.mjs及其test.ts，沿用既有target guard、Auth/API/RLS、neutrality及release foundation。 詳見 [D17 R2 delivery](D17-R2-delivery.md)。


### D19 support fixture renewal

Extend `scripts/audit/run-pilot-support.mjs --fresh` through `fresh-support.mjs`; `server/test/helpers.ts` retains default demo semantics and adds attested new workspace constants. Existing support assertions use those constants. `ownedFixtureTransport.ts` blocks database-wide campaign jobs. New regression files: `support-fresh-scope.test.ts`, `support-rpc-ownership.test.ts`. No parallel product/workflow engine or schema change.
