# R1 / D19 local delivery review

This candidate is for one workspace's internal pilot journey. Local/disposable verification is distinct from production readiness. No deployment, real staff membership change or seven-day pilot enablement has occurred.

Creator: real password login, join, durable draft save/reload, submit, revise and resubmit, proof correction and resubmit. Operator: existing real Auth session, UI review/revision/approval, proof claim/correction/manual checklist verification, UI completion. Both reload the same pending reward snapshot and history. `browser-summary.json`, `browser-roundtrip.json` and `browser-neutrality.json` record the final full UI run. External metadata and publication were disabled; the public URLs are synthetic.

Pending and cancellation snapshots preserve XP, points, withdrawable earnings, point/cash ledgers, budget/ledger, redemption counts and reward inventory. The Creator sign-in welcome XP happens before the measured handoff; the before/after XP is compared directly. Legacy approval's existing reward behavior is tested separately, without applying it to pending handoffs.

## Schema changeset

Manifest digest: `a1cfcb804a2d369df16a2e7542cde4346429bcfb652a7707efdf929c0e62ff86`. Apply only the 37 ordered reviewed forward entries after the existing production baseline is independently proven compatible. Five SQL files are new in this working diff; old SQL/checksums are unchanged. `schema-diff.json` records 25 tables absent in observed production, 305 candidate columns across existing/new tables, RPC signatures/ACLs, grants, RLS and history. Both disposable targets pass all 468 final requirements; two removed RPC grants require actual catalog denial evidence because a dump alone cannot prove inherited ACL safety. The protected preflight continues to fail closed on unverifiable ACL/storage claims.

The three body differences after line-ending normalization are `join_mission`, `submit_mission` and `settle_campaign`. Join/submit changes extend the existing active workflow and evidence guard. Settlement's enforced points-budget guard already belongs to unchanged `20260805120000_review_hardening.sql`. The removed mission FK is superseded by workspace-qualified constraints in unchanged `20260720193637_resolve_mission_submission_relationships.sql`. Notification type expansion and narrower mission grants/RLS are intentional existing release hardening. All 14 observed history rows remain; no old numbered migration was falsely marked applied.

## Required before production

Bind a reviewed commit, CI result, exact hosted deployment and current target identity. Re-run read-only protected preflight and resolve catalog/CLI history differences with reviewed forward operations; no blind db push or history repair. A named owner must authorize real staff membership separately: prior successful login with zero active membership is still a scope problem. Record the release ticket, operator, rollback owner, formal evidence digest and real expiry using the existing release foundation. Its expiry algorithm remains unchanged. This draft does not generate or approve a protected evidence token.

## Rollback

Keep the reviewed diff, manifest/checksums and schema catalogs. For local comparison, use a separate clean checkout; do not restore/delete dirty user files. Keep the owned disposable targets and UUID receipts for inspection. Do not reset a database or disable immutable-history triggers to clean fixtures.

For a later authorized production release, pin the actual preceding live application SHA and fallback owner first; the current live SHA has not been asserted by this local run. Application rollback must preserve the membership and new-schema guards. Retain workflow/proof/reward history and ledgers. Prefer an additive forward repair; a schema down/reset or deletion of pending-reward history is not the rollback strategy. Stop only affected transitions while investigating.

## Limits and next task

No Safari/WebKit, physical mobile, 1,000/10,000-creator load test, paid-provider quality evaluation, real notification/SMS/email/social publication, payment or withdrawal-provider acceptance. Existing optional profile-media/authoring/old operator-read integration fixtures were not all executed; the old operator-read restorer disables user triggers and is deliberately excluded. Core proof ownership is covered by the separate real proof-review suite. R2/R3 cases remain open in the 107-case matrix. The core internal pilot is not an unrestricted public launch.

Next local product task: D13 (identity/onboarding/social-account projection). Protected production/pilot actions require their exact later authorization and completed remote gates.

## D08 local addendum

D08 local work is verified; see [D08 delivery](D08-delivery.md) and [current delivery JSON](adfocate-delivery.json). Earlier R1 gate records retain their historical fingerprints. The current dirty candidate fingerprint and fresh D08 gates are recorded separately; no protected release evidence/expiry or production approval was issued. No deployment occurred.

## D09 local addendum

D09 verified local/disposable; see [D09 delivery](D09-delivery.md). Earlier R1/D08 gates retain historical fingerprints. Current candidate fingerprint and fresh gates are separate. No protected evidence/expiry or production approval changed. No deployment. Next local product task: D13 (identity/onboarding/social-account projection). D09 establishes that the existing successful legacy join grants 10 XP; prior D08 welcome-XP attribution was not established, and raw history is retained.

## D12 local addendum

D12 readable mission authoring verified local/disposable; see [D12 delivery](D12-delivery.md). Original audit outcomes and prior runtime fingerprints remain preserved. Current candidate gates are separate; no protected evidence expiry or production approval changed. No deployment. Next local product task: D13 (identity/onboarding/social-account projection).

## D13 local addendum

D13 identity/profile source projection verified local/disposable; see [D13 delivery](D13-delivery.md). Real local Auth/Storage and explicit PKCE UI transport fake remain separate. No deployment or release-expiry extension. Next local task D14.

## D14 local addendum

D14 truthful public preview and Academy availability verified local/disposable; see [D14 delivery](D14-delivery.md). Release owner must confirm the reduced public promise before publication. Original four-lesson acceptance remains OPEN for D15, no automatic waiver. No schema change, deployment or release-expiry extension. Roll back only the D14 patch hunks and task-owned added paths, preserving all earlier dirty work and exact fixtures; no worktree reset or reverse migration. Next D15.

## D15 local addendum

[D15 delivery](D15-delivery.md) contains the new manifest/diff, three exact forward files and owned synthetic API/browser evidence. No deployment. Original UC-C18/UC-A51 four-real-lessons acceptance remains BLOCKED_CONTENT_NOT_PROVIDED. Current manifest needs fresh target-bound preflight/protected evidence, scoped DB-owner approval and runtime verification before any external release. Do not reuse older manifest approvals or extend expiry. Containment: preserve all unit/progress/history rows, unpublish affected parent tracks through approved operator flow if authorized; do not DROP/reverse migrations or alter history/checksums. Application rollback is a review of D15-only patch hunks, preserving earlier dirty work; no reset or fixture deletion. Re-test affected gates before any release.

## D17 local addendum

[D17 quality](2026-10-23-adfocate-quality.md) and [delivery](D17-delivery.json) provide selected local accessibility/performance, known-ledger Insights and unchanged schema/history. No deployment, migration or membership change. Entry split is not a total-transfer improvement. Hosted advisor acceptance, named owners, physical/native zoom/AT and missing saved help/review observations remain open; D15 real curriculum blocker persists. canDeploy/canEnablePilot remain false; evidence expiry unchanged. Review D17-only application/config hunks for rollback, preserving previous dirty work and every fixture/history row; no reset/delete or old migration edit. Fresh release preflight/runtime and explicit formal authorization remain final prerequisites.

## D18 local addendum

D18 role separation and safe transition materials are reviewable in D18-delivery.json and docs/operations/staff-access-transition.md. One additive migration is applied only to the two verified disposable databases; zero automatic grants, no production data/role/membership change or deployment. Fresh protected manifest/history review and exact existing-staff owner grants are prerequisites to any future cutover. Blind old-server rollback restores broad staff rights; preserve schema/audit/history and prefer fail-closed repair. D15 four real lessons remain blocked. canDeploy/canEnablePilot=false and evidence expiry unchanged. Next D19 renews complete pilot evidence; no formal release permission requested in D18.

## D19 renewed local readiness

Final local/disposable single-workspace evidence is renewed in 2026-10-24-adfocate-pilot-readiness.md and D19-delivery.json. Formal staff/owner cutover, D15 approved curriculum and hosted/protected release/pilot remain open and unexecuted; canDeploy/canEnablePilot=false. Existing accounting anchors and evidence expiry are preserved. No commit/push/merge/deploy or production data/membership/role action.
