# Controlled Instagram pilot acceptance record

Candidate: same branch, base `e491e2dd30f42090458eacb82777d45b67275627`, unstaged artifact hashes in `offline-artifacts.json`. Updated 2026-11-07. Overall: **HOLD / native backend wired offline; App protocol and hosted acceptance pending**. No deployment, remote SQL, real credentials or provider connection was used.

| Scenario | Evidence | Result and limit |
|---|---|---|
| Original upload, finalize, submission, reviewer approval | upload-green-2.log; controlled-pilot-provider-schema.test.ts | PASS in PGlite using fake bytes; no remote SQL |
| Provider binding, original authority and active grant | source-green.log; review-final.log | PASS injected/PGlite; real identity not verified |
| Two preview reservations, colleague denial, fixture rejection | liveComposition.test.ts; provider schema suite | PASS local; hosted Auth/RLS NOT_RUN |
| Stop during accepted publish preserves target/media ID | review-round2-green.log | PASS fake HTTP + SQL repository; no duplicate publish |
| Processing container resumes after reconstruction | review-final.log; review-round2-green.log | PASS; delayed bounded reads |
| Five total receipt reads, no sixth call | review-round2-red.log → review-round2-green.log | PASS after reproduced failure |
| Closing while approved source load is pending | review-round2-red.log → review-round2-green.log | PASS after reproduced failure; actual durable host pending |
| Full repository regression, integrations disabled | full-suite.log | 4,571 PASS, 363 SKIP, 1 FAIL; failed case subsequently fixed/verified, no clean full rerun claimed |
| Final TypeScript / changed-file lint | typescript-round2-corrected.log; lint-round2.log | PASS |
| Default-off and Studio production builds | build-default-off.log; build-studio.log | PASS before final server-only fixes; nine fixture markers absent |
| Creator mock mission reload, five widths | IAB local port8799; final controller observation | PASS at320/390/430/1024/1440; no overflow, retained receipt, private redaction, single mock ledger |
| Same-workspace peer direct mission | IAB local port8799; controller observation | Denied at mobile/desktop; fixture persona, not real session |
| New native backend upload→publish→proof→review→settlement→collection | frozen-native-regression.log; full original schema with mocked provider | PASS, includes actual native collection/proof handlers, SQL final-JPEG lease and one 400-point original mock ledger; no real Auth/provider evidence |
| Frozen Native regression after fixes | frozen-native-regression.log | 212 PASS across31 files, no failures or skips |
| Terminal/revoked JPEG lease after worker crash | media-terminal-red.log; frozen-native-regression.log | Reproduced then PASS; all terminal/unknown states deny new reads before physical purge |
| Full atomic bundle and rollback | native-bundle.log; frozen-native-regression.log | PASS in PGlite; browser grants absent, duplicate-index review passed, empty rollback restores originals |
| Original retention and account deletion | native-cleanup-parity-final.log; frozen-native-regression.log | PASS; payloads erased, reservation fences retained, unknowns held |
| Continuation whole-repository run | continuation-full-suite.log | 4,580 PASS /2 FAIL /364 SKIP plus1 timed-out suite setup; mixed run is not a final full-suite PASS |
| Native OAuth/notice, exact App subject, partnership label | Protocol contract / B1–B3 | BLOCKED pending verified product/App evidence |
| Current shared-target restore and hosted permission matrix | B6–B7 | NOT_RUN; P5 unauthorized |
| Actual origin/CDN lease expiry, purge and restart fencing | B8 | NOT_RUN; native storage backend absent |
| Real C1 publication and expansion | B10 | NOT_AUTHORIZED; P6 separate approval |

Evidence logs live under `.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/`. Counts overlap and are not summed. Screens are synthetic and contain no real account evidence. Reload and keyboard-only status read retained receipt4cdadc1d and400/1 mock ledger; peer direct access denied at390/1440 with zero private inputs. Five-width overflow checks passed. Complete hosted native-browser and two-real-session acceptance remain P5; they are not inferred from the separate backend and existing mock-browser tests.

Use `real-launch-approval-package.md` as the canonical approval package. Do not submit it as an execution-ready request until the implementation gaps in `offline-implementation-status.md` and its B1–B10 gates are resolved.

Final isolated production bundle boundary check: **1 PASS / 1 file** (`frozen-bundle-boundary.log`). Final native regression remains **212 PASS / 31 files**; overlapping runs are not summed. Launch status remains HOLD.
