# KOCmax Real Instagram Controlled Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Native execution is already selected. Implement the approved scope inline, then obtain one independent final review. Checkboxes are evidence gates, not repeated requests to choose individual features. This document is a plan, not implementation or live-operation approval.

**Goal:** Enable one invited creator to complete an approved Instagram brand task through direct publication, verified proof and the original settlement workflow, then expand to at most five creators after independent first-result acceptance.

**Architecture:** Keep the existing mission, proof, reward and private collection workflows authoritative. Add the missing authenticated production composition around the tested native publisher, durable intent/worker contracts and explicit creator consent. Keep mock data, mock routes and provider receipts separate; a production flag cannot convert fixture provenance into authority.

**Tech Stack:** Existing TypeScript, React, TanStack, Hono, Supabase/Postgres, Native Meta adapter, Vitest and local PGlite. No publishing intermediary or new social platform.

**Spec:** `docs/superpowers/specs/2026-11-06-kocmax-controlled-instagram-pilot-design.md`; predecessor `docs/superpowers/plans/2026-11-06-kocmax-controlled-instagram-pilot.md`; latest evidence `docs/review/kocmax-controlled-pilot/release-recovery-closeout.md`.

## Global constraints and decision record

- Same branch: `codex/kocmax-studio-stages-1-2`, current HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Preserve the existing dirty tree and all recent fixes. No staging/commit/push unless separately requested.
- This request authorizes planning and documentation only. Do not deploy even a preview, apply remote SQL, provision resources/accounts, grant permissions, connect providers, publish or delete a post.
- Preserve ordinary tasks without Instagram, visitor/creator/brand/operator navigation, manual proof submission and existing rewards. Google Drive stays disabled.
- One brand, one approved single-image JPEG per creator, C1 first; C2–C5 held. Proposed operational window:7 days with an attended first-post session. Dates, owners and monetary limits must be named in the later packet.
- No Reels, Stories, carousels, scheduling, messaging, advertising, Insights, scraping or external image-analysis service. Username/BioCode is not direct-publishing authority.
- Brand approval and creator per-post consent are separate. No automatic proof submission, settlement, XP, badge or public-post deletion.
- No production-wide database restore or index removal as a shortcut. The old local database stays preserved; its recovered copy stays stopped and never seeds a real pilot.

## Verified baseline versus remaining work

The 2026-11-06 closeout records4534 passed/363 skipped in the broad run, followed by19 affected tests on the final fixes; these are separate runs. Both production builds and enumerated mock-marker scans passed. Eight release failures are closed. Five browser widths, private-source redaction, same-workspace denial and two real local-process restarts passed. These are local/mock observations, not hosted Auth/RLS or Meta acceptance.

The damaged local database's1704 original file hashes remain unchanged. Visible-row salvage exported118 tables/81 rows, quarantined2 orphan records and stopped the recovered copy. Unknown future-XID outcomes were not reconstructed. This is **not** a current restore point for Remix-Adfocate.

| ID | Remaining blocker | Evidence required to close | Owner |
|---|---|---|---|
| B1 | Actual Meta App/product/version/access eligibility | App ID and owner, pinned supported Graph version, exact endpoint/token matrix, dashboard access levels and external-user eligibility | Meta App owner + engineer |
| B2 | Paid-partnership label and sponsor eligibility | Creator/brand relationship, required permissions, rendered label and sponsor evidence for the actual approved account pair | Brand + creator + reviewer |
| B3 | Identity, renewal, revoke and signed notices | Product-specific subject mapping, token lifecycle, verified signed callback/deletion contract and disposable-account evidence | Security engineer |
| B4 | Production composition missing | Hosted-auth actor resolution, real repositories, native HTTP transport, worker secret/claim lifecycle, safe DTOs; fixtures cannot enter live routes | Engineer |
| B5 | SQL is partial, not deployable pilot schema | Complete additive source/authority/intent/job/receipt/collection SQL, ACL/RLS parity, duplicate-index review and tested rollback | DB reviewer |
| B6 | Target-bound recovery absent | New encrypted backup of exact target, checksum/inventory and successful isolated restore rehearsal before application | DB operator |
| B7 | Real Auth/RLS and refresh replay not executed | Scoped disposable accounts, server authority matrix, concurrency/refresh denial and cleanup readback | QA + security |
| B8 | Public final-media hosting and purge unverified | HTTPS fetchability for approved JPEG, lease expiry, access restrictions, cache purge, metadata policy and exposure consent | Engineer + privacy owner |
| B9 | Roster, costs, retention and operations unnamed | Private account/resource roster, costs/caps, session window, incident owner, reviewer/settler, cleanup manifest | Pilot owner |
| B10 | Live actions not approved | Hash-bound approval packet for deployment, DB, accounts/OAuth, media exposure, post budget and cleanup | User/resource owners |

B1–B3 are not cleared by documentation alone. B4–B5 require implementation after plan approval; they cannot be solved by switching the mock mode flag. A blocked label route must remain blocked, with manual publication offered only as a separately reported fallback.

## Official protocol check — read-only, 2026-11-06

The [Meta-maintained Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) describes Facebook Login using professional Instagram accounts with a linked Page, and Page/account discovery. Its scope list covers more operations than this pilot; do not copy the whole list into consent.

The [Meta-maintained organic content guide](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/creators/organic-content-creation.md) documents Facebook Login for the paid-partnership label, JPEG image publishing and Meta fetching media from a public server. It also notes additional permissions for some Business Manager-assigned Page roles. These are candidate requirements, not validation of our App or accounts.

The primary [publishing reference](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing) was inaccessible through the read tool; the [manual-login/deauthorization reference](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/#deauth-callback) returned429. Exact current version, revoke endpoint, signed-notice identity, token renewal and media limits remain evidence gates. No guessed endpoint or synthetic `v99.0` may enter a live adapter.

## Permissions and consent

Candidate product: **Instagram API with Facebook Login**, host `graph.facebook.com`. Keep it distinct from existing Instagram Login connections and their scope/subject/token families.

| Candidate scope | Purpose and restriction |
|---|---|
| `instagram_basic` | Identify the authorized professional account and verify its relevant media; not broad profile enrichment |
| `instagram_content_publish` | Publish the exact creator-confirmed approved version |
| `pages_read_engagement` | Required linked-Page/account relationship for this product; no general Page analytics feature |
| `pages_show_list` | Discover eligible Pages so the creator explicitly selects the intended linked Instagram account; store only necessary selected mapping |
| `instagram_branded_content_creator` | Conditional label requirement only if the verified product/App cannot satisfy it using the baseline permission; do not request speculatively |

`ads_management`/`business_management` are **not requested by default**. If the actual Page assignment makes them mandatory, stop B1/B2 and present the exact reason/scope to the user for an amended approval; do not pretend the original minimal grant covers them. No comments, messages, contacts, advertising, Insights or Google permissions.

- Record requested, granted and denied permissions separately, with last verification time. Missing permission means blocked, not zero data.
- OAuth entry requires the active creator session, one-use state bound to that session and product, an allowlisted exact redirect, and a server-verified account/Page relationship. Bind immutable IDs, not a username alone.
- Encrypt tokens server-side; never include them in DTOs, browser storage, logs, screenshots, Git or approval documents. Use the selected product's documented expiry/exchange/renewal behavior, not a generic refresh-token assumption.
- Local disconnect immediately blocks writes and rotates grant generation. Provider revoke remains pending/unverified until independently confirmed; signed callbacks must verify signature, App and subject before mapping to a grant.
- Before each publish, show exact account, final JPEG, caption, sponsor/label, public exposure and mission version; unchecked consent, one-use nonce and current session required. Basic tasks remain accessible if authorization is declined.

## Environment and test roster

Retain the user's existing project choice: Supabase `Remix-Adfocate` (`mhkoayftiuojxlrkollf`). The proposed database target is still a **shared existing database**, not a physically isolated environment. No new paid project/branch is assumed. Use additive objects, a dedicated pilot workspace/run ID, explicit owner allowlists and no broad seed/cleanup. If evidence shows shared-target isolation cannot be guaranteed, stop and present a separately priced isolated-resource alternative; do not provision it silently.

After approval only: use a protected pilot application URL, explicit callbacks, separate pilot worker/credentials and server-side allowlists. Exclude the pilot from general navigation/traffic. Default every external write off; enable only the named run/account/task during its attended window. A preview deployment is still a deployment and requires approval. No secrets are loaded during local tests/builds.

| Alias | Identity/purpose | Live-post allowance |
|---|---|---|
| T-IG | Rights-cleared professional technical account + linked Page, controlled by a consenting tester | Proposed maximum1 technical post, separately approved; no reward |
| T-negative | Separate consenting professional account for wrong-account/no-Page/no-scope selection checks |0; stop before any publishing action |
| C1 | First invited creator, own professional IG/Page and KOCmax creator login |1 approved brand deliverable |
| C2–C5 | Later invited creators; initially disabled |Up to1 each, only after C1 complete and gate signed |
| C-peer | Same-workspace nonowner creator |0; private data and intents denied |
| C-other | Different-workspace creator |0; cross-workspace access denied |
| B-owner / B-member | Brand owner and ordinary member |0; preserve actual existing approval capabilities, never auto-promote member |
| R-reviewer / O-operator / A-admin / F-finance | Separate sessions for verification, handoff, authorized settlement and finance read-only checks |0 provider publishing authority |
| V-visitor | Anonymous session |0; basic public journeys only |

These are logical test identities, not a requirement to create Meta accounts for every internal role. Use platform-permitted real professional tester accounts; verify App roles and accepted invitations. App-role testing does not prove eligibility for external C1–C5; any required review/access verification must pass before onboarding them. Do not borrow ordinary production users or share passwords. Store real IDs/emails in an access-controlled private roster; Git contains aliases and hashes only.

Test data: unique `runId`, dedicated mission/work item/version, rights-cleared final JPEG and hash, caption/disclosure/sponsor hashes, private draft with a synthetic canary, two revisions, expired/revoked variants and same-/cross-workspace controls. Real brand-task reward value must come from the approved original contract; do not reuse the mock400 points as a live reward assumption. Real task/proof/ledger records are business data, not disposable test rows.

## Work packages and approval boundaries

All paths below are repo-relative. Review current code before execution using graph-first discovery. Proposed new files are explicit; existing tested contracts are reused, not reimplemented.

### P1 — Freeze the protocol and operational contract

**Artifacts:** update `docs/review/kocmax-controlled-pilot/{protocol-matrix.md,protocol-evidence.md,launch-packet.md}`; create `real-protocol-contract.md`, `real-account-matrix.md` in that directory.

- [ ] Capture baseline branch/hash inventory and map each B1–B10 gate to owner/evidence/expiry. No credentials or private roster in Git.
- [ ] Bind exact App/product/version, permission dependencies, account/brand eligibility, token lifecycle, limits and revoke/callback/deletion semantics to official sources. Public-document collection is allowed only; authenticated App inspection/account changes need the later scoped approval.
- [ ] Define proposed7-day window, maximum5 brand posts plus at most1 separately approved technical post,1 publish attempt per intent, and read recovery maximum5 checks at least60 seconds apart unless the verified contract is stricter. Freeze cost ceiling in the packet before resource use.
- [ ] Review: missing protocol evidence keeps the relevant gate blocked; no unverified default is promoted to production.

### P2 — Complete authenticated service and durable database parity (offline)

**Files:** extend `server/lib/creatorGrowth/pilot/{protocol.ts,worker.ts,jobStore.ts,runtime.ts}`, `server/routes/creatorGrowthPublish.ts`, `server/lib/creatorGrowth/{publishRepo.ts,missionProofHandoff.ts}`; proposed new `pilot/liveComposition.ts` and `pilot/liveComposition.test.ts`; update review-only `{changes.sql,rollback.sql,schema-review.md}`. Inspect existing integration repository/OAuth interfaces before choosing their narrow changes.

**Contract:** `createLivePilotComposition(deps: LivePilotDependencies)` composes authenticated actor resolver, grant repository, approved-version source, durable intent/job repositories, native transport and media lease. Dependencies are explicit; transport unavailable by default. Browser role/run/receipt fields cannot supply actor authority.

- [ ] Write failing local tests for forged fixture receipt, wrong product/account, same-workspace colleague, inactive creator, service-role bypass, stale approval/instruction, brand member review, and duplicate proof/settlement. Include the existing ready-asset attachment/submission fidelity gap: start from upload, not a preapproved synthetic seed.
- [ ] Implement smallest production composition using original APIs. Map verified provider receipt to proof candidate only; creator confirmation still invokes original proof workflow. Private collections retain provenance; copied drafts reset publication/approval rights.
- [ ] Complete additive SQL for production source bindings, reservation uniqueness, job fencing and safe receipt linkage. Test real repository/RPC parity in PGlite, all minimal grants, owner-consistent FKs and RLS. Fixture helper tables/RPCs must never be registered as production migrations.
- [ ] Review indexes by key/order/predicate/include columns against PK/unique indexes. Do not drop existing indexes. Validate claims/query plans on a representative local copy; one-job-per-intent does not alone prove one-intent-per-approved-work uniqueness.
- [ ] Run targeted suites for publish routes/schema, worker/repository, original mission proof and reward handoff. Expected: no unauthorized reads/writes, one reservation, one original ledger effect, rollback rejects nonempty pilot tables. Do not apply remote SQL.

### P3 — Native HTTP, OAuth lifecycle and final-media hosting (offline)

**Files:** proposed `server/lib/creatorGrowth/pilot/nativeHttpTransport.ts`, adjacent tests; extend existing product protocol adapter and `pilot/mediaLease.ts` with injected storage; proposed `server/test/controlled-pilot-live-composition.test.ts` for fake-transport composition. Preserve existing integration refresh/revoke adapters for their original product.

- [ ] Tests first: state replay/session swap, wrong App/subject, renewal CAS races, wrong-product signed notice, notice replay, callback forgery, revoked generation during an await, and expired grant before publish. Expected: deny without token leakage or unexpected provider calls.
- [ ] Implement only the protocol verified in P1. Fixed allowlisted hosts, bounded response/timeouts, redaction and secret interfaces; no arbitrary user URL fetch. No external network calls in tests.
- [ ] Test before/after container creation and before/after publish crash points,429, lost accepted response, restart, dual workers and late receipts. Expect at most one irreversible publish attempt; ambiguous create/publish is held, never blindly retried.
- [ ] Validate/convert JPEG before brand approval; persist approved hash and metadata. Final media lease proposed900 seconds, hard cap3600; no source brief/original image in public storage. Fake host tests prove expiry/purge and forbidden reads. Actual fetch/purge remains B8 until approved hosted verification.
- [ ] Signed callback and token lifecycle contract unknown means live path unavailable; a passing fake transport cannot clear B3.

### P4 — Whole candidate acceptance and exact approval packet (offline)

**Files:** update `scripts/integrations/controlled-pilot-preflight.ts` and test, existing pilot UI/query tests and `scripts/creator-growth-bundle-boundary.test.ts`; create `docs/review/kocmax-controlled-pilot/{real-pilot-acceptance-matrix.md,real-pilot-approval-packet.md}`.

- [ ] Bind preflight review to actual artifact hashes/inventory and evidence state; do not treat a syntactically valid hash string or user-set boolean as proof. `executionAllowed` remains false in review tooling.
- [ ] Verify creator upload→approval→confirmation→receipt→proof→review→original settlement→private collection with mocks; no seeded approval shortcut for the new candidate. Verify visitor, brand member, reviewer, operator and finance regressions.
- [ ] Verify320/390/430/1024/1440, keyboard/focus and44px controls, long Traditional Chinese, exact image preview, back/forward/reload, expired session, two tabs, account switch and private cache clearing. Record role/time/viewport/result per run.
- [ ] Run relevant focused tests then one full repository suite with remote integration disabled; report actual skips. Run TypeScript, changed-file lint, both production build modes and existing mock-marker scans. Preserve local directory ownership, Vite restart and source-revocation regressions.
- [ ] One independent final review; resolve Critical/Important findings and record remaining warnings. No deploy/SQL/OAuth to prove offline readiness.
- [ ] Produce one reviewable packet naming immutable candidate hash, exact SQL/rollback files, target/env/hosts/worker, restore requirements, Meta App/product/scopes, roster aliases, image/caption/label hashes, post/read/cost caps, operators, cleanup and stop steps. Unfilled values are explicit blockers. Request approval only for concrete actions; plan approval alone is not launch approval.

### P5 — Approved infrastructure and technical verification only (NOT AUTHORIZED)

- [ ] Verify approved artifact/resource identity; take new target-specific encrypted backup and independently restore to an isolated disposable target. Recovery objective proposed: no loss of prechange authoritative task/ledger data; retain all pilot intents including unknown outcomes. If this cannot be demonstrated, no migration.
- [ ] Apply only reviewed additive SQL within the approved window; read back schema/grants/indexes/counts. Deploy the exact reviewed build to the named protected pilot URL with writes off. Verify original journeys before enabling any account.
- [ ] Create only approved disposable Auth identities; execute nine-way core permission matrix (C1,C-peer,C-other,B-owner,B-member,R-reviewer,O-operator,A-admin,F-finance) plus anonymous. Use actual sessions/JWTs and RPC/API paths; UI persona switching is insufficient. Confirm no access to nonpilot rows.
- [ ] Technical T-IG OAuth and revoked/expired/wrong-account checks occur only within approved account scope. Test actual refresh/renewal replay appropriate to the selected product. Record provider revoke and signed notices independently of local disconnect.
- [ ] Verify public JPEG fetch, expiry/cache purge and actual sponsorship label on the separately approved technical post if required. Expected failures do not authorize surprise posts. No live brand task starts until technical gates pass.
- [ ] Clean disposable technical data using an exact owner/run-bound manifest and readback; retain unknowns and audit evidence. Reset all real writes off while awaiting the brand-task window.

### P6 — C1 complete journey, then controlled expansion (NOT AUTHORIZED)

- [ ] Brand approves C1's immutable JPEG/caption/disclosure/version. Creator reviews selected official account and grants per-post consent in the product; attending operator cannot impersonate consent.
- [ ] Enable only C1+task+version for the attended window. Execute one intent, persist container/media evidence, independently inspect the correct public account and required resolved brand label. A pending/incorrect label is not success.
- [ ] Creator confirms proof; reviewer independently verifies; operator hands off; authorized admin performs original settlement. Read back exactly one ledger effect and unchanged other-account balances. Confirm private receipt/versions persist and nonowners remain denied.
- [ ] After C1 reaches verified completion and cleanup checks pass, a named reviewer signs the expansion gate. Enable C2–C5 only within the previously approved cap/window; otherwise obtain amended approval. Record completed/withdrawn/blocked individually, not just aggregate success.
- [ ] End with write flags off, private evidence inventory and cleanup readback. Manual-published fallback is labelled as such and does not satisfy direct-publishing acceptance.

## Acceptance matrix and stop rules

| Layer | Required passing evidence | Failure behavior |
|---|---|---|
| Protocol | Exact App/product/version and approved least scopes, mapped official account, brand label eligibility | No connect/publish |
| Auth/permission | Nine roles + anonymous; colleague/crossworkspace denied; no service-role authority bypass or leaked private DTO/cache | Stop run, investigate before resuming |
| Creator consent | Exact immutable final image/caption/sponsor/account; active session and single-use nonce; revision forces reapproval | Invalidate preview, no write |
| Durable publication | One reservation/attempt; reload/restart only reads; accepted response loss held; authoritative media identity | Unknown stops expansion; read-only reconciliation |
| Real output | Correct account/media/permalink, complete image/caption, required resolved platform label; independent observation | No proof acceptance/settlement |
| Original workflow | Explicit proof, reviewer decision and authorized original settlement; exactly one ledger effect | Hold settlement; no alternate credit path |
| Privacy/cleanup | Private sources never exposed; approved JPEG lease expires/purges; credentials absent; manifests read back | Stop further exposure; retain incident evidence |
| UX/regression | Five widths + keyboard; no overflow; existing tasks/manual routes/roles preserved | Fix and repeat affected acceptance |

Hard stop: any wrong-account/unconfirmed/duplicate post, duplicate reward, private data/token exposure, unresolved unknown, unauthorized SQL, revoke/cleanup failure or stale approval. No rollout expansion on a technical success alone. Reach/engagement growth is not an acceptance promise; unavailable HK/Traditional-Chinese metrics remain unverified.

Every result records candidate/run ID, environment, exact tested question/scenario, alias/role, platform/browser, timestamp, source evidence and PASS/FAIL/NOT_RUN/BLOCKED. Do not combine focused tests into a full-suite claim or promote mock evidence to provider verification.

## Rollback, cleanup and retention

1. **Contain:** disable pilot admission and all new provider writes first, revoke current local generations, stop/drain worker claims. Preserve fencing/reservation tombstones and any in-flight IDs; no blind resend. Proposed operational target: new local writes blocked within60 seconds of incident acknowledgement, verified in rehearsal; this cannot cancel Meta-accepted work.
2. **Reconcile:** read known containers/media only within approved limits. Keep unknown status if provider truth cannot be established. Hold proof/reward and later creators. A timeout is not proof of failure.
3. **Application rollback:** restore the previous reviewed application artifact with pilot disabled; preserve compatible new data. Check original tasks, approvals, manual proofs, wallets, visitor and staff journeys. No auto-reenable.
4. **Data rollback:** prefer disabling the extension over destructive down-migration. Existing `rollback.sql` covers only an empty checkpoint table and is insufficient for the full future schema. New rollback must export/count/hash the affected rows, refuse nonempty/unresolved pilot state, never CASCADE/drop original workflows, and preserve real task/proof/ledger records. Point-in-time/full shared-database restoration is an exceptional separately approved incident action because it could erase other users' subsequent work.
5. **Provider rollback:** locally stop first; use the verified product-specific revoke path only within the approved scope. Distinguish local stopped from provider confirmed. Public Instagram post deletion is a separate creator decision/approval; DB rollback does not delete it or restore remote grant state.
6. **Media cleanup:** close leases immediately after terminal use; remove hosted final-media copies and verify origin/CDN denial. Provider-copied media may remain with the public post. A random URL is not private authorization.
7. **Data cleanup:** proposed identifiable diagnostics retention7 days; disposable test data removed within7 days after closeout, with incident holds. Tokens removed/revoked according to verified lifecycle. Actual mission/proof/reward/audit retention follows the existing policy and must name its owner/period before launch; no invented retention for financial records.
8. **Exact manifest:** runId+owner+workspace+resource IDs, before counts/hashes, held IDs/reasons, foreign-key order, object paths and Auth IDs; dry-run first, apply only approved IDs, then independently read back. Never broad username/email/date-range deletion. Auth cleanup follows reference checks; real C1–C5 accounts and mission ledger are retained unless separately requested.

A current backup alone is not enough: record restore test time, target identity, inventory/grants/count checks and recovery duration. The old local salvage does not fulfill B6. Keep its physical originals and quarantined rows unchanged.

## Review focus and coverage

- Creator controls multiple Pages, selects wrong IG, or handle changes: P1/P3 immutable mapping plus P5 actual-account negative check.
- Brand changes disclosure/image after consent while worker awaits: P2/P3 current version/generation checks; P4 UI invalidation.
- Meta accepts publish but response or worker dies: P3 crash matrix, P5 nonposting fault tests, P6 held reconciliation; never duplicate publish.
- Private source revoked after collection save or JWT becomes stale: P2 owner/source checks, P4 cache/redaction, P5 real role matrix.
- Shared DB contains unrelated new work when pilot is stopped: P2 additive/rollback tests, P5 restore proof, cleanup manifest nonpilot-count comparison; no blanket restore/delete.

Self-review: all design journeys, source-sharing/privacy, official product gates, permission/roster, durable recovery, original settlement, responsive acceptance, cleanup and separate live approvals are assigned above. No code/SQL execution is implied by this plan. Native execution choice is preserved; no new method choice is needed.

## Completion and next approval

Planning deliverable: this complete plan plus corrected launch-packet status. Next implementation approval can authorize **P1–P4 offline only**, preserving all current restrictions. **P5/P6 require a later concrete live packet** with actual resource/account/cost/window/content details; no credentials should be pasted in chat. The final objective is genuine direct publication through original verification/settlement, not merely another mock pass.
