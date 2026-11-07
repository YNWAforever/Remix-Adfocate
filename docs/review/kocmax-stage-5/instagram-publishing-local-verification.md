# Instagram publishing: local verification

2026-11-04–05, Asia/Singapore. Same branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2d`; subsequent work is unstaged and uncommitted. This is offline evidence, not real Auth, Meta, RLS, publication or production acceptance.

## Observed interface

The in-app browser exercised the actual development fixture at `http://127.0.0.1:8768`, with Studio/thread flags on, fixture on, an invalid example Supabase URL and a placeholder key. The fixture replaces transport and rejects external destinations. The default production composition remains disabled.

The creator composer opens the image skill in a private thread. The development-only publishing demonstration uses a fixed synthetic image and caption, never an actual uploaded image. It prominently states no Instagram connection, publication, save or reward occurs.

| Viewport | Observed journey | Result |
|---|---|---|
| 320×740 | Unsupported partnership label; full caption/disclosure; original manual route | Confirmation disabled; no horizontal overflow (314px content). Account details expand using Enter. Leaving preview shows explicitly synthetic cancelled state. |
| 390×844 | Unknown publication result and read-only reconciliation | Remains unknown; no repeated publication; action says `回到原任務核對`; no horizontal overflow (384px content). |
| 430×932 | Expired preview | Confirmation disabled, fresh preview required; no horizontal overflow (424px content). |
| 1440×1000 | Exact personal preview, checked confirmation, synthetic receipt | Account remains prominent, technical identity collapsed; complete image/caption shown; no fabricated permalink or reward; no horizontal overflow (1434px content). |

Earlier in the same controller run, the pre-copy revision also exercised the changed-draft case at430px and the original-approved-mission sample at1440px. These are separate from the final copy/layout readback above. The subsequent pending-confirmation recovery finding is accepted only by its focused fix/tests and independent re-review below, not by these earlier browser scenarios.

Screenshots of the final copy revision:

- [Desktop exact preview](instagram-preview-desktop-local.png)
- [Mobile unknown-result reconciliation](instagram-unknown-mobile-local.png)

The initial tab retained old modules during reload attempts. A sandboxed preview process could not accept browser connections. Restarting the same mock-only server outside socket isolation and using a fresh in-app tab loaded the current source. No firewall, browser security or application authorization setting was changed. The older tab's stale copy is not counted as current verification.

## Review corrections

The API reviewer found coercible enum values in two output fields. Four otherwise-valid response cases first failed (arrays/coercible objects for `mission.kind` and `state`), then passed after requiring primitive strings. The focused route/session/client suite passes53 tests. The independent re-review accepts this API subunit. A confirmation header is intent metadata, not proof of a human or substitute for session/nonce authority.

The service review found expiry after the last awaited owned read and lease cleanup after owner denial. Both were corrected and independently accepted;72 service tests and153 affected cases passed. The UI stalled-confirmation finding and the new-task route permission gap were also fixed and accepted, as recorded below. The original backend write boundary was not bypassed by the create-form display gap.

## Preservation

The controller rehashed398 frozen D1 evidence/helper files against the existing manifest: zero changes. The two `scripts/` entries are workspace-relative; the remaining entries are relative to `docs/review/kocmax-stage-4d/d1`. `git diff --check` passes and the index remains empty. No broad test-suite PASS is claimed.

No SQL was applied to Remix-Adfocate, no real account/token was created or connected, and no image was sent to Meta, RapidAPI or a vision processor. No deployment or post publication occurred.

## Final synthetic role matrix

The development fixture now includes separate owner, same-workspace peer and other-workspace peer identities. The controller used the normal-data scenario, not the generic denied-response switch. The fixed private A discussion is reseeded on reload, so a missing record cannot masquerade as ownership denial.

| Persona | 390×844 | 1440×1000 |
|---|---|---|
| Creator A, owner | Private synthetic discussion visible | Visible |
| Same-workspace creator B | Denied; no A content or private textarea | Same |
| Other-workspace creator C | Denied; no A content or private textarea | Same |
| Brand member | Denied; no A content or private textarea | Same |
| Brand owner | Denied; no A content or private textarea | Same |
| Operator | Denied; no A content or private textarea | Same |
| Reviewer | Denied; no A content or private textarea | Same |
| Finance viewer | Denied; no A content or private textarea | Same |
| Workspace admin | Denied; no A content or private textarea | Same |

No horizontal overflow was observed. B and C also stayed isolated through Back, Forward and Reload at both sizes. The error view displayed the existing read-failure/retry copy after the fixture's ownership403; it did not expose A's title, message or private inputs. These checks establish synthetic browser behavior, not actual JWT, RLS or live accounts. Publication/growth owner endpoints remain unimplemented/disabled in this fixture and are not credited as successful provider journeys.

The new-task route fix was independently approved. Operator now has zero editable inputs at390/1440 and sees `你沒有建立任務的權限。`; an authorized admin has an enabled title and existing create form at both sizes. Mock sign-out immediately removes it. Back/Forward/Reload retain zero title inputs; the settled final reload displays the signed-out Google login screen. No save/delete action was performed. The same-owner temporary draft restoration and stale-save callbacks are covered by19 focused component tests.

Raw sanitized readbacks are `task-8-browser-ownership.json`, `task-8-browser-peer-history.json` and `task-8-browser-new-mission.json` under the publishing SDD folder. Early role-switch snapshots were not used as final authorization results; the completed checks awaited the target error or permitted form.

The reusable preview's stalled-confirmation correction passed32 focused preview tests and independent re-review. Navigation remains available while the one-use confirmation stays consumed; leaving does not claim to cancel a provider request. The browser simulator uses immediate synthetic callbacks, so that never-settling transport case is component-test evidence, not a real-network browser result.

After the peer history checks, switching back to A restored the fixed private title, message and textarea. The browser was returned to the creator home and its temporary viewport override reset to1280×720. The verified preview tab is retained. A cleanup attempt on an older failed tab was rejected by the browser URL policy; no security setting was changed or workaround attempted. This did not affect the verified tab.

Independent fixture review separately caught first-initialization copying of A's mutable profile. B/C now use fresh independent defaults. Two new tests first reproduced the defect, then the complete fixture suite passed19 cases; the independent re-review accepted it. The correction changes initial profile data only. The thread ownership/role/route behavior exercised by the browser matrix is unchanged; no new browser profile-mutation test is claimed.

## Final controller verification

| Check | Result |
|---|---|
| Growth/publishing repositories, policy, service, privacy, routes and client/UI; new-task route | 27 files,880 tests passed |
| Final persona-fixture suite | 1 file,19 tests passed |
| Original mission/reward/proof/state/display regressions | 146 passed;21 live-gated cases skipped, from the scoped Task8 run |
| Default-off production build | Passed, including TypeScript/ESM;152 JavaScript assets scanned,0 of24 forbidden development/sample markers |
| Studio/thread opt-in production build with fixturefalse | Passed through the build-boundary test;0 of24 forbidden development/sample markers |
| Focused lint | Passed; final fixture-specific lint also passed |
| Durable claim fix | Memory/PGlite9 RED failures, then62 passed; downstream service72 passed; independent re-review accepted |
| Native mission proof boundary | Independent review accepted the57-case offline injected contract; no runtime registration or real receipt |

Controller logs are `final-focused-tests.log`, `final-fixture-tests.log`, `final-default-build.log`, `final-default-bundle-scan.json`, `final-optin-bundle-test.log` and `final-lint.log` in the publishing SDD folder. The opt-in test uses invalid example Supabase configuration and Studio/thread flags on, fixtureoff; a default-off scan alone is not the acceptance criterion. The24-marker list also covers publishing simulator strings, sample account/asset identifiers and the private A seed.

The publication migration is still unapplied. Its final SHA-256 is `d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7`; the growth migration remains `bfe4fab81bb23198a2f57c804a521b03b83c2a41815acc86f8966ac49b2d0e43`. The repository's exact publish claim prevents a late media ID from promoting a creation/polling interruption to a published state. Minimal old-target audit after local stop remains possible without resuming publication.

Final integration review found that the new publication client supplied a Headers instance to the existing application transport's record merge, losing confirmation/idempotency headers. A new test through the real `apiFetch`, with only session and final fetch stubbed, reproduced the missing request key. The client now supplies a plain header record; the shared API helper remains byte-identical. The client/session/route suite passes54 cases and independent re-review records no remaining integration findings. There are900 distinct focused cases across the28 controller-checked files, counting this one added test once. This does not add runtime wiring or a live transport.

The opt-in production build and24-marker boundary test were repeated after the client correction and passed (`final-optin-after-client-fix.log`), including TypeScript/ESM. The default-off build above predates that narrow unwired-client fix; the final opt-in build is the later compile/bundle gate. No new visual behavior was introduced by the header correction.

The additional [executable whole-growth rollback](creator-growth.rollback.sql) initially passed12 focused disposable PGlite cases, including the controller rerun. Independent review then identified that the forward migration can reuse a pre-existing matching bucket, so deleting it would remove a pre-existing row. The corrected generic rollback always retains the empty private bucket, without a deletion flag. A new real pre-migration bucket/metadata/ACL fixture and explicit newly-created residual-bucket expectations reproduced4 failures/9 passes, then passed all13 cases after the correction. Publication/storage/cleanup refusal, original-object/row preservation, atomic refusal and savepoint restoration remain covered. Final SHA-256: `61c65aed95ca6ebb523bbf8ee91e01ab3543bc0c4b60d3e7524f0585b66d30cd`. Independent re-review accepts I1 with no new findings (`creator-growth-rollback-independent-review.md`, final appendix). This is a schema rollback rehearsal using synthetic Storage metadata, not a current shared-database backup restore or proof of physical file deletion. No runtime or migration bytes changed.

The controller's final whole-project TypeScript run after the bucket-preservation fix passes (`final-project-types-after-rollback-fix.log`). The13-case evidence is `creator-growth-rollback-fix-1-results/green.log`; the earlier controller12-test run is retained as historical evidence. The71-file scoped manifest is `final-controller-scope-manifest.json`, SHA-256 of its ordered path/content-hash list `25125b60c0dfd5d7b03658a62b7912da43204cc2ff7440ac47fefb04f388ad1d`. Only the rollback SQL and its test changed from the preceding scoped snapshot; all69 other scoped files are unchanged. The manifest identifies reviewed growth/publishing files, implicated shared boundaries, tests and unapplied SQL; it is not a full deployment fingerprint or a clean-worktree assertion.

The [pilot readiness packet](instagram-pilot-approval.md) is BLOCKED and its [execution record](instagram-pilot-execution.md) is NOT RUN. Missing live contract, native adapters/resolvers, fresh restore proof, actual accounts/grants and concrete live authorization remain explicit. The packet's independent documentation review records zero actionable findings within that blocked scope; the subsequent rollback addition is reviewed separately.

Final closure on2026-11-05: all scoped independent implementation/integration findings are closed. HEAD remains `e491e2d`, the index is empty and changes remain on the same branch. No new SQL/rollback was applied to a persistent or remote database. No real provider connection, post, public media endpoint, external vision processing or deployment occurred. The21 live-gated original-flow tests and real refresh-token replay remain unexecuted, and unrelated known broad-suite failures are not represented as passed.
