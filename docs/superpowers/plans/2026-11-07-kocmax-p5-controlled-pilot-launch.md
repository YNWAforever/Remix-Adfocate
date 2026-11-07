# KOCmax P5 Controlled Pilot Launch Plan

> **For agentic workers:** Use superpowers:executing-plans with the already selected Native method after explicit scoped execution approval. Checkboxes record evidence, not permission to act.

**Goal:** Verify a named, protected Instagram pilot environment with real authentication and provider lifecycle checks, then deliver a separate P6 decision. P5 defaults to zero public posts.

**Architecture:** Compose the existing native routes, durable media/receipt repositories and original mission workflows. Default-deny external writes; separate environment, database, OAuth and optional technical-post approvals. Shared Supabase infrastructure is logically scoped, not physically isolated.

**Tech Stack:** Existing TypeScript/React/Hono, Supabase/Postgres, native Meta adapter, Vitest/PGlite and browser verification.

**Spec:** `docs/superpowers/specs/2026-11-06-kocmax-controlled-instagram-pilot-design.md`; preceding implementation plan `2026-11-06-kocmax-real-instagram-controlled-pilot.md`; authoritative gate register `docs/review/kocmax-controlled-pilot/real-launch-approval-package.md`.

## Global constraints

- Prepared 2026-11-07, Asia/Singapore. Planning only; execution status HOLD.
- Same branch `codex/kocmax-studio-stages-1-2`, base HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Preserve unstaged work; no commit/push by implication.
- No deployment, including preview, remote SQL, account creation, provider authorization, secret loading or public media exposure under this planning request.
- P6 brand publication, real rewards and C2–C5 expansion remain excluded from P5.
- Instagram only. No Google Drive, ads, messaging, scraping, Insights or scheduling. Basic/manual tasks remain available.
- Current evidence: 212 frozen native tests pass; separate bundle isolation test passes; five mock browser widths pass. The earlier mixed whole-repository run was not all green. These are not real Auth/RLS/provider acceptance.
- Existing target is Remix-Adfocate `mhkoayftiuojxlrkollf`. No alternative paid project is assumed. Current remote schema and backup have not been verified by this plan.

## Remaining blockers and release gates

| Gate | Current evidence | Required closure |
|---|---|---|
| B1 App/product | No actual App/version verified | App owner, product, supported pinned version, access levels, tester/external-user eligibility and endpoint matrix |
| B2 Brand label | Candidate documented; actual pair unverified | Sponsor/creator eligibility and exact label parameters; rendered label requires separately approved publication |
| B3 OAuth/identity | Offline boundaries only | Implement and test exact App-specific subject mapping, exchange/expiry, revoke/deauthorization/data-deletion contracts; no invented refresh-token flow |
| B4 Runtime | Native routes/storage/proof wired offline | Exact hosted verified-session and client/worker/secret composition; real browser-to-service acceptance; fixture rejection |
| B5 Database | Review bundle and empty rollback pass locally | Target prerequisite inventory, scope-impact review, immutable SQL hashes, approved application and readback |
| B6 Recovery | No current target-bound restore evidence | New encrypted backup, checksums and successful isolated restore with original task/ledger/schema/ACL checks |
| B7 Authorization | Mock identities only | Nine actual application accounts plus anonymous, direct API/RPC/RLS denial and session lifecycle evidence |
| B8 Media | SQL JPEG lease backend tested locally | Approved HTTPS origin, encryption/key controls, no-cache/expiry/purge readback; actual Meta fetch requires technical-post exception |
| B9 Operations | Owners/window/costs unfilled | Named owner roster, incident contact, dated window, spend ceiling, retention and cleanup manifest |
| B10 Authorization | P5 not approved | Explicit approval of exact candidate/resources/actions; no broad “continue” inferred as a post approval |

App-specific adapter corrections must pass offline tests and review before deployment approval. Gates established by live testing cannot be prerequisites for permission to run those very tests: approve the bounded test action first, then require its passing evidence before progression. No P6 readiness claim while any required provider gate remains open.

## Information requested from the owner

Supply nonsecret facts or redacted dashboard evidence; private account mapping belongs in a restricted local record, not Git.

| Group | Required fields |
|---|---|
| Meta App | App name/ID; owner/contact; owning business; selected login product/use case; Development/Live mode; pinned Graph version; business verification status; per-permission Standard/Advanced access and review status; accepted App role invitations |
| Eligibility | Whether T-IG and later C1 are App-role testers or external users; evidence that the actual intended users are eligible. Tester success does not prove external-user access |
| URLs | Proposed protected application URL, exact redirect URI, deauthorization endpoint, data-deletion callback/instructions and status URL where required, privacy policy URL, media origin. Record whether each already exists; do not create it yet |
| T-IG | Consenting technical owner; professional IG handle and Business/Creator type; linked Page name/ID; IG ID if known; controlling Facebook user's Page tasks; whether access comes through Business Manager; account restrictions/required Page publishing authorization status |
| Negative account | A separate consenting account/Page for wrong-account selection and denied-scope checks; zero posts. No invented Meta identity or shared password |
| Sponsor | Brand IG handle/ID if known, consenting brand contact, actual partnership eligibility/approval and required label. Unknown IDs can be resolved only in the later approved read scope |
| Application accounts | Private alias-to-email mapping for nine roles below; dedicated pilot workspace and second workspace; authorization to create only listed disposable identities |
| Operations | Pilot owner, engineer, DB/restore operator, independent reviewer, incident contact; proposed start/end with timezone; total cost ceiling and resource breakdown; retention owner/period; approved isolated restore destination |
| Optional technical post | Separate yes/no decision; exact final JPEG/hash/dimensions, caption/hash, intended account, sponsor/label, public exposure acknowledgement, posting window and deletion decision. Omit for zero-post P5 |

**Do not send App Secret, access tokens, refresh/session tokens, passwords, service-role keys or recovery codes in chat or Git.** After resource approval, the named owner enters secrets into the agreed server secret store; record secret references and rotation owner only. Account holders perform OAuth themselves. No ownership transfer or password sharing is needed.

## Permissions and privacy

Candidate: Instagram API with Facebook Login, `graph.facebook.com`; do not mix Instagram Login token/subject/scope families. Professional IG plus linked Page is the documented candidate account model. [Meta-maintained API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

| Scope | Intended minimum use |
|---|---|
| `instagram_basic` | Verify selected professional account and necessary media identity |
| `pages_show_list` | Explicit Page selection; persist necessary selected mapping only |
| `pages_read_engagement` | Required Page/account context for selected product |
| `instagram_content_publish` | Exact confirmed publication; approval of this scope alone never enables posting |
| `instagram_branded_content_creator` | Conditional only if the verified label contract requires it beyond baseline |

Meta's organic-content guide describes paid-partnership labelling for Facebook Login and additional `ads_management`/`business_management` permissions for some Business Manager-derived Page roles. These are not included by default: if required, stop and request a revised scope decision. Do not silently replace the login product or request ad permissions. [Meta-maintained organic-content guide](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/creators/organic-content-creation.md).

Record requested/granted/denied permissions and verification time independently. Bind OAuth state to session/product, use it once, allowlist exact redirects, and verify immutable App/Page/IG identities server-side. Token encryption, expiry and product-specific exchange must be explicit. Signed notices require the actual documented contract; distinguish local disconnect from confirmed provider revocation. The manual-flow documentation returned HTTP429 on this planning check, so exact notice/revoke semantics remain blocked.

Private collections/briefs/source URLs never become public media. Only separately consented final JPEG bytes may be exposed through the scoped origin. Current SQL lease implementation caps at 900 seconds; do not raise it silently. Terminal/unknown/revoked intents deny origin reads. Test whether Meta needs later reads: failure blocks progression rather than weakening the rule. Missing data stays unverified, not zero.

## Actual test roster

| Alias | Application authority | Meta/publication allowance in baseline P5 |
|---|---|---|
| C1-test | Owner creator in pilot workspace | App-session testing only; no brand post |
| C-peer | Another creator in same workspace | No Meta access/post; deny owner data |
| C-other | Creator in second workspace | Deny cross-workspace data |
| B-owner | Brand owner | Original brand workflow only; no creator impersonation |
| B-member | Brand member | Existing limited authority; no elevated approval/delete |
| R-reviewer | Authorized reviewer | Original review only; no settlement/post |
| O-operator | Operator | Original operational handoff only |
| A-admin | Authorized administrator | Original admin capability; no P5 real reward action |
| F-finance | Finance role | Existing finance capability only; no provider grant access |
| Anonymous | No session; not a tenth account | All private routes denied |

T-IG and T-negative are two separately identified Meta test assets, not nine required Instagram accounts. Bind T-IG only to its consenting application owner. Do not reuse the real future C1 identity as disposable data; create C1-test if needed. Existing role policy remains authority—this table does not grant new capabilities.

## Ordered execution after separate approval

### P5.0 Freeze protocol and approval packet — no live action

**Files:** `real-protocol-contract.md`, `real-account-matrix.md`, `real-launch-approval-package.md`, `offline-artifacts.json` under `docs/review/kocmax-controlled-pilot/`; existing native adapter modules/tests under `server/lib/creatorGrowth/pilot/`.

- [ ] Complete all owner fields, exact endpoint/identity/expiry/notice matrix and App eligibility evidence.
- [ ] For any necessary adapter correction: reproduce with fake transport, implement Native, run affected tests and independent review. No test secrets/network.
- [ ] Freeze complete application artifact/source inventory, dependencies, configuration digest and SQL hashes. The 62-file offline inventory is not a complete deployable artifact fingerprint.
- [ ] Re-run affected regressions, types/lint, both builds and bundle boundary on the frozen candidate; run a nonoverlapping full suite or explicitly enumerate unresolved failures/skips before signoff.
- [ ] Present approval scopes A–D below with actual costs/window/owners; leave unfilled fields HOLD.

### P5.1 Restore proof and database — approval A

**Files:** `native-offline-bundle.sql`, `native-offline-rollback.sql`; original migration inventory; new restricted run evidence directory (not credential storage).

- [ ] Read exact target schema/ACL/index/migration inventory and compare prerequisites; missing prerequisites are a new reviewed SQL scope, never silently applied.
- [ ] Capture encrypted target backup/checksum/inventory; restore into an explicitly approved isolated destination, never over the shared source. Validate original workflows' tables/counts/constraints/grants and measured recovery duration.
- [ ] Review shared impact, including original asset-attachment guard and parent-delete hooks. Record nonpilot baseline counts and maintenance window.
- [ ] Apply only hash-approved SQL transaction, then read back objects/ACL/RLS/indexes and unchanged nonpilot invariants. Stop on mismatch; no speculative retry or broad index deletion.

### P5.2 Protected runtime and actual application authorization — approval A+B

**Files:** `server/app.ts`, `server/routes/creatorPilot.ts`, `server/lib/creatorGrowth/pilot/nativeApplication.ts`, `sqlMediaStorage.ts`, `receiptStore.ts`; existing workspace middleware and original proof routes.

- [ ] Deploy only the immutable candidate to named protected URL; keep provider transport/publish worker disabled and general traffic excluded. Register no fixture authority.
- [ ] Wire verified session/JWT, actual repositories, secret references and scoped worker identity; verify default-disabled/private DTO behavior without provider credentials being exposed.
- [ ] Create only roster-authorized disposable application identities. Test nine roles plus anonymous with actual sessions and direct API/RPC/RLS calls; inspect cross-owner rows, objects, receipts, proofs and browser caches.
- [ ] Test expiry/signout/refresh replay against actual Auth rules, two tabs, Back/Forward/reload and workspace switch. Meta token renewal is a separate protocol test, not a generic Auth refresh-token test.
- [ ] Verify existing visitor/task/manual proof/approval/wallet navigation; no real balances changed for P5 tests. Original settlement remains offline-tested until P6.

### P5.3 Technical OAuth and media lifecycle — approval C

- [ ] Named owner connects T-IG using the actual consent screen. Record App/product, selected Page/IG identity and minimal scopes; reject wrong account and missing scope without posting.
- [ ] Verify state replay/session swap, current grant generation, logout, revoke, renewal races and signed notice/deletion behavior. Use authentic approved test events where available; fake events remain labelled mocks. No live acceptance claim from a fabricated provider notice.
- [ ] Use only rights-cleared technical JPEG for separately approved temporary exposure. Verify exact bytes, no private sources, HTTPS, headers, TTL, terminal denial, delayed writes and cleanup from the approved external verifier. No arbitrary URL fetch or private brief access.
- [ ] Test stop/restart with provider writes disabled. Keep crash/ambiguous-publish fault injection on mocks, not actual publication endpoints.
- [ ] Close baseline P5 with zero containers/publications and zero rewards. Actual Meta fetch and rendered partnership label remain NOT_RUN unless P5.4 is approved.

### P5.4 Optional single technical publication — approval D, never implicit

- [ ] Approve one exact T-IG account/content/version/label/window and explicit public exposure. Post budget maximum one; no reward. Technical original-workflow content must not silently create a payable brand mission.
- [ ] Creator confirms final preview with current session and one-use nonce. Execute one durable intent and one irreversible publish attempt; no auto resend.
- [ ] Independently observe correct public account, exact content, permalink/media ID and rendered required sponsor label. Persist private receipt; verify no nonowner access and no reward/brand proof submitted.
- [ ] Reconcile uncertainty only by known identifiers: maximum five reads, at least60 seconds apart or stricter provider limits. Unknown stays held; no replacement intent to evade the cap.
- [ ] Disable writes immediately after result, expire/purge media and record cleanup. Any creator-requested public deletion needs its own explicit authorization and observation.

### P5.5 Closeout and P6 decision

- [ ] Run mobile/desktop acceptance, produce exact cleanup dry-run manifest, apply only approved disposable IDs and independently read back.
- [ ] Record provider grants revoked/retained with explicit owner consent; no blanket token retention. Keep unknown outcomes and necessary audit/reservation fences.
- [ ] Deliver PASS/FAIL/BLOCKED/NOT_RUN per case, costs, remaining holds and write-disabled readback.
- [ ] If baseline only passed, report “P5 nonposting checks passed; Meta fetch/label pending.” P6 cannot open until required live gates pass. C1 content/account/mission/version/consent and P6 posting/reward approval remain separate.

## Acceptance and evidence

Every record includes candidate/run/environment, scenario, actor alias, platform/browser, timestamp, source and result. Redact credentials. Required UX: widths320/390/430/1024/1440, plus physical iOS Safari and Android Chrome where available. Desktop resizing alone is not real-device acceptance; unavailable devices are NOT_RUN. Verify keyboard focus/confirmation, readable errors, image preview, no horizontal overflow, reload/two-tab continuity and private cache clearing.

Required security result: owner-only receipts/media/collections; same-workspace peer and cross-workspace actor denied by server and database; stale grants/versions/nonces cannot write; service-role use does not bypass actor checks; no token in logs/URLs/browser state. No unexpected mutation of nonpilot data.

Required recovery result: original data restored in isolated rehearsal; stop blocks new local writes within proposed60 seconds of incident acknowledgement; accepted external work is not falsely cancelled; no retry after unknown; media unavailable after expiry/terminal close; exact cleanup counts and retained evidence recorded.

P5.4 additionally requires one correctly labelled public technical post, one durable receipt, no second publish after reload/restart, zero technical reward. Full real proof/review/reward acceptance belongs to P6, not this P5 exit claim.

## Stop, rollback and cleanup

1. Stop immediately for wrong-account/unconfirmed/duplicate post, secret/private-source exposure, unexpected SQL/nonpilot mutation, stale approval, unknown result, failed revoke or failed media cleanup. Hold proof/reward and all expansion.
2. Disable admission/provider writes; fence current grant generations and worker claims. Retain known container/media IDs and unknown states. Stop cannot undo a Meta-accepted publication.
3. Close media leases, remove permitted temporary copies, verify origin and cache denial. Meta's public copy may persist. Purge failure is an incident, not permission to broaden deletion.
4. Roll application back to the prior reviewed artifact with pilot off. Recheck original tasks/manual proof/approval/wallet and all role navigation. Keep compatible additive data.
5. Prefer disabling over down-migration. `native-offline-rollback.sql` is empty-only and refuses retained evidence; never delete receipts/reservations/ledger to force it. Any shared-database restore needs separate incident approval because other users may have written since backup.
6. Revoke provider access only within approved account scope and verify independently; record local stopped/provider pending separately. Public post deletion is a separate account-holder decision.
7. Cleanup by exact run/workspace/owner/resource IDs and FK order: dry-run counts, held IDs/reasons, approved deletion, independent zero/retained-count readback. Never broad email/date/username cleanup. Check references before deleting disposable Auth identities; retain real creator/brand accounts and financial records.
8. Proposed identifiable diagnostics/disposable data retention: seven days after closeout, subject to incident holds. Existing business/audit retention needs named owner/period before launch. Preserve reservation fences required for deduplication; account erasure and payload redaction follow original reviewed workflows.

## Approval scopes to present after fields are complete

| Approval | Exact actions | Exclusions |
|---|---|---|
| A | Named isolated restore destination, current backup/restore, exact shared-target SQL hashes and protected deployment/cost/window | OAuth, public media and posting |
| B | Named disposable application accounts, real permission/session tests and exact cleanup IDs | Meta login and public posts |
| C | T-IG/T-negative OAuth scopes, provider lifecycle checks, bounded read budget and temporary technical JPEG exposure | Container creation/publication and real rewards |
| D (optional) | One hash-bound technical post and independent label/fetch verification | C1 brand task, second post, reward, expansion or automatic public deletion |

No approval is requested from an incomplete packet. The owner may approve A–C together only after every action/resource is concrete; D remains explicit. Costs and dates are not estimated promises: fill them from the selected resources and owner availability. P6 is a separate packet.

## Review focus and self-review

- Multiple Pages or changed handle: P5.3 verifies immutable account selection, not username ownership.
- Protected website blocks Meta fetch: P5.3 tests narrow origin exposure; P5.4 proves actual provider fetch without exposing app routes.
- Revocation races accepted publish: P5.3 mock fault tests and P5.4 known-ID recovery retain accepted/unknown outcomes.
- Shared DB has unrelated activity: P5.1 baseline and P5.5 cleanup compare nonpilot state; no blanket restore.
- Tester passes but C1 lacks external eligibility: P5.0 records actual access class; P6 blocked until C1 eligibility is independently established.

Self-review: owner inputs, dependency gates, minimal permissions, nine-account tests, actual-device limits, optional post boundary, retention, rollback and exact action approval are covered. No code, remote state or secrets changed by this plan. Native execution choice retained.
